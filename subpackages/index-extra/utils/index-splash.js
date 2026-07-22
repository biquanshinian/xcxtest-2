/**
 * subpackages/index-extra/utils/index-splash.js
 * 首页开屏动画逻辑（从 pages/index/index.js 拆出）：
 * - 开屏配置拉取（本地缓存池 + 云端 starship_splash_config，短等/长等策略不变）
 * - 展示 / 倒计时 / 跳过 / 关闭、媒体预下载
 * - 开屏视频对非会员开放（压缩预览片）；仅省流/紧急流量档时非 Pro 降级封面
 *
 * 主包 index.js 通过 require.async + attachTo 委托加载；
 * 首页在 preloadRule 中预下载 index-extra 分包。首次安装时分包未就绪的
 * 几百毫秒等待与原逻辑等云端配置的 600~2500ms 短等同量级，感知一致。
 */
const { isPlaybackAllowed } = require('../../../utils/feature-flags.js')
const { toCdnUrl, optimizeImageUrl, carouselVideoPosterUrl } = require('../../../utils/cos-url.js')
const { isMembershipEnabled, isProSync, getMembershipState, isPro } = require('../../../utils/membership.js')
const { getMemberPolicy } = require('../../../utils/member-policy.js')
const { getUpcomingMissions } = require('../../../utils/api-launch-list.js')
const { buildMissionDetailUrl } = require('../../../utils/index-mission-nav.js')
const { fetchLaunchStatusSnapshot } = require('../../../utils/api-app-services.js')

// LL2 状态：6 = In Flight（飞行中）；3/4/7/9 = 终态（成功/失败/部分失败/中止）
const SPLASH_STATUS_INFLIGHT = 6
const SPLASH_STATUS_TERMINAL = { 3: true, 4: true, 7: true, 9: true }
// 距发射 ±2 小时内才做实时状态确认（飞行中可能性窗口，避免平时多打一次云函数）
const SPLASH_LIVE_CHECK_WINDOW_MS = 2 * 60 * 60 * 1000
// 开屏视频最长展示 12 秒（与云端预览转码截取一致；原片兜底也硬切）
const SPLASH_VIDEO_MAX_SEC = 12
const SPLASH_VIDEO_MAX_MS = SPLASH_VIDEO_MAX_SEC * 1000
// 起播保障：超时强制 play；再超时则降级封面图，避免一直卡在封面上「假死」
const SPLASH_VIDEO_FORCE_PLAY_MS = 1200
const SPLASH_VIDEO_FALLBACK_MS = 2800
// 元数据已就绪（流量在动、即将起播）时，把降级窗口一次性延长，慢网不误降级
const SPLASH_VIDEO_META_EXTEND_MS = 2000
const SPLASH_VIDEO_PREFETCH_MS = 700
// isProSync 缓存过期时，短等云端会员状态确认的上限
const SPLASH_PRO_CONFIRM_MS = 1500
const SPLASH_VIDEO_ID = 'splash-video'

// 开屏动画：本地缓存的配置 + 已下载媒体文件路径（冷启动零网络等待）
const SPLASH_CACHE_KEY = '_splash_screen_cache'
// 任务倒计时卡片：上次匹配命中的任务（秒显快路径，云端返回后校正）
const SPLASH_MISSION_HIT_KEY = '_splash_mission_hit'

/**
 * 旧 COS 截帧同时写死宽高会被拉伸；客户端即时改写为等比截帧（height=0），
 * 不等云端 ensure 回写也能立刻看到正确封面。
 */
function fixSplashPosterUrl(url) {
  if (!url || typeof url !== 'string') return ''
  let u = url.trim()
  if (!/ci-process=snapshot/i.test(u)) return u
  u = u.replace(/([?&])scaletype=[^&]*/gi, '$1')
  if (/[?&]width=\d+/i.test(u) && /[?&]height=[1-9]\d*/i.test(u)) {
    u = u.replace(/([?&])height=[1-9]\d*/i, '$1height=0')
  } else if (!/[?&]height=/i.test(u) && /[?&]width=\d+/i.test(u)) {
    // 已有单边宽则可
  }
  // 清理可能产生的 ?& / && / 末尾多余分隔
  u = u.replace(/\?&/g, '?').replace(/&&/g, '&').replace(/[?&]$/g, '')
  return u
}

const methods = {
  async loadSplashScreen() {
    try {
      // 用内存变量控制：冷启动时显示，切后台回来不重复显示
      const app = getApp()
      if (app._splashShownThisSession) return
      app._splashShownThisSession = true

      const normalizeItems = (cfg) => {
        if (!cfg) return []
        // 视频预览：仅 ready 可播；processing/pending/failed 不用（防 _fast12 未生成 404）
        // 本地缓存项往往不带 previewStatus，但若已有 previewUrl 则信任（上次 ready 时写入）
        const pickPreviewUrl = (it, isVideoItem) => {
          if (!isVideoItem || !it || !it.previewUrl) return ''
          const st = String(it.previewStatus || '').trim().toLowerCase()
          if (st && st !== 'ready') return ''
          return toCdnUrl(String(it.previewUrl).trim())
        }
        if (Array.isArray(cfg.mediaItems) && cfg.mediaItems.length) {
          return cfg.mediaItems
            .filter((it) => it && it.mediaUrl)
            .map((it) => {
              // 与原逻辑一致：显式 mediaType 优先，缺省时按扩展名推断
              const itemType = it.mediaType || (/\.(mp4|mov|m4v|webm)(\?|#|$)/i.test(it.mediaUrl) ? 'video' : 'image')
              const isVideoItem = itemType === 'video'
              return {
                id: String(it.id || it.mediaUrl || ''),
                mediaType: itemType,
                // 图片开屏全屏展示：medium 压缩（960w WebP），原图动辄数 MB
                mediaUrl: isVideoItem ? toCdnUrl(it.mediaUrl) : optimizeImageUrl(it.mediaUrl, 'medium'),
                previewUrl: pickPreviewUrl(it, isVideoItem),
                posterUrl: it.posterUrl
                  ? optimizeImageUrl(fixSplashPosterUrl(String(it.posterUrl).trim()), 'medium')
                  : isVideoItem
                    ? carouselVideoPosterUrl(it.mediaUrl, '')
                    : '',
                missionName: String(it.missionName || '').trim()
              }
            })
        }
        // 旧单字段：仅作兜底，不算完整媒体池
        if (cfg.mediaUrl) {
          const isVideoCfg = cfg.mediaType === 'video'
          return [
            {
              id: String(cfg.mediaUrl),
              mediaType: cfg.mediaType || 'image',
              mediaUrl: isVideoCfg ? toCdnUrl(cfg.mediaUrl) : optimizeImageUrl(cfg.mediaUrl, 'medium'),
              previewUrl: pickPreviewUrl(cfg, isVideoCfg),
              posterUrl: cfg.posterUrl
                ? optimizeImageUrl(fixSplashPosterUrl(String(cfg.posterUrl).trim()), 'medium')
                : isVideoCfg
                  ? carouselVideoPosterUrl(cfg.mediaUrl, '')
                  : '',
              missionName: String(cfg.missionName || '').trim()
            }
          ]
        }
        return []
      }

      const resolvePlay = (item) => {
        if (!item) return null
        const playUrl = item.previewUrl || item.mediaUrl
        return {
          id: item.id || '',
          mediaType: item.mediaType || 'image',
          mediaUrl: playUrl,
          posterUrl: item.posterUrl || '',
          originalUrl: item.mediaUrl,
          playUrl,
          missionName: item.missionName || ''
        }
      }

      // 池子 ≥2 时：尽量不连续重复上一次，保证多轮测试能看到不同视频
      const pickSplashItem = (list, lastId) => {
        const arr = Array.isArray(list) ? list.filter((it) => it && it.mediaUrl) : []
        if (!arr.length) return null
        if (arr.length === 1) return arr[0]
        let pool = arr
        if (lastId) {
          const others = arr.filter((it) => String(it.id) !== String(lastId))
          if (others.length) pool = others
        }
        return pool[Math.floor(Math.random() * pool.length)]
      }

      let cached = null
      try {
        cached = wx.getStorageSync(SPLASH_CACHE_KEY) || null
      } catch (e) {}
      const cachedItems = normalizeItems(cached)
      // 只有显式 mediaItems 数组才视为「完整池」；旧单条缓存不能挡住云端多视频
      const cacheHasPool = !!(
        cached &&
        cached.enabled &&
        Array.isArray(cached.mediaItems) &&
        cached.mediaItems.length > 0
      )
      const lastSplashId = cached && cached.lastSplashId ? String(cached.lastSplashId) : ''

      // ── 并行拉云端；有完整本地池则短等，否则多等一会再展示 ──
      let cfg = null
      if (wx.cloud && wx.cloud.database) {
        const waitMs = cacheHasPool ? 600 : 2500
        try {
          const db = wx.cloud.database()
          const res = await Promise.race([
            db.collection('starship_splash_config').doc('current').get(),
            new Promise((resolve) => setTimeout(() => resolve(null), waitMs))
          ])
          cfg = res && res.data ? res.data : null
        } catch (e) {
          cfg = null
        }
        // 短等未返回时，若本地没有完整池，再补一次较长等待
        if (!cfg && !cacheHasPool) {
          try {
            const db = wx.cloud.database()
            const res = await Promise.race([
              db.collection('starship_splash_config').doc('current').get(),
              new Promise((resolve) => setTimeout(() => resolve(null), 2000))
            ])
            cfg = res && res.data ? res.data : null
          } catch (e) {}
        }
      }

      const cloudItems = normalizeItems(cfg)
      // 优先云端完整池，其次本地池，最后旧单条
      let pool = []
      if (cloudItems.length > 1 || (cfg && Array.isArray(cfg.mediaItems) && cfg.mediaItems.length)) {
        pool = cloudItems
      } else if (cacheHasPool) {
        pool = cachedItems
      } else {
        pool = cloudItems.length ? cloudItems : cachedItems
      }

      // 开关：云端优先；无云端时看本地缓存
      if (cfg) {
        if (cfg.enabled === false) {
          try {
            wx.setStorageSync(SPLASH_CACHE_KEY, { enabled: false })
          } catch (e) {}
          return
        }
      } else if (cached && cached.enabled === false) {
        return
      }

      if (!pool.length) return

      // 过审关闭 enableEventVideo：开屏不挑视频项，避免挂载 <video>
      const playbackOk = await isPlaybackAllowed().catch(() => false)
      let pickPool = pool
      if (!playbackOk) {
        const imagesOnly = pool.filter((it) => it && it.mediaType !== 'video')
        if (imagesOnly.length) pickPool = imagesOnly
      }

      const picked = pickSplashItem(pickPool, lastSplashId)
      const resolved = resolvePlay(picked)
      if (!resolved) return

      // 配了任务名：立刻预热即将发射列表（fire-and-forget），
      // 让 _showSplash 后的倒计时卡片匹配少等一整段网络往返
      // （下方会员门控 / 视频预取的 await 期间请求已在路上，withListSnapshot 会去重复用）
      if (resolved.missionName) {
        try {
          getUpcomingMissions(20, 0).catch(() => {})
        } catch (e) {}
      }

      // 可播门控：过审关视频 → 降级封面，不挂 <video>。
      // 开屏视频对非会员开放（播的是压缩预览片，体积小），不走非会员强制封面策略；
      // 仅省流/紧急流量档收紧为「非 Pro 降级封面」，作为 COS 成本熔断
      let splashVideoAllowed = true
      if (resolved.mediaType === 'video') {
        if (!playbackOk) {
          splashVideoAllowed = false
        } else {
          try {
            const memberEnabled = await isMembershipEnabled()
            if (memberEnabled) {
              const policy = await getMemberPolicy()
              if (policy.mediaTrafficMode !== 'normal' && !isProSync()) {
                // isProSync 只读本地缓存（TTL 10 分钟），冷启动缓存过期会把 Pro 误判成非会员。
                // 短等云端确认一次（复用 isProSync 已触发的 in-flight 请求）；超时按非会员降级
                const state = await Promise.race([
                  getMembershipState().catch(() => null),
                  new Promise((resolve) => setTimeout(() => resolve(null), SPLASH_PRO_CONFIRM_MS))
                ])
                splashVideoAllowed = isPro(state)
              }
            }
          } catch (e) {}
        }
        if (!splashVideoAllowed) {
          if (!resolved.posterUrl) return
          resolved.mediaType = 'image'
          resolved.playUrl = resolved.posterUrl
          resolved.mediaUrl = resolved.posterUrl
        }
      }

      const localMap = cached && cached.localPaths && typeof cached.localPaths === 'object' ? cached.localPaths : {}
      let src = localMap[resolved.playUrl] || ''
      if (src) {
        try {
          wx.getFileSystemManager().accessSync(src)
        } catch (e) {
          src = ''
        }
      }

      // 视频且预览未就绪：不要硬播原片（易长时间缓冲、封面假死），本轮用封面图秒开
      if (
        splashVideoAllowed &&
        resolved.mediaType === 'video' &&
        !src &&
        !(picked && picked.previewUrl) &&
        resolved.posterUrl
      ) {
        resolved.mediaType = 'image'
        resolved.playUrl = resolved.posterUrl
        resolved.mediaUrl = resolved.posterUrl
      }

      // 有可播 https 预览时短等预取本地，降低首帧黑屏/卡住概率
      if (
        splashVideoAllowed &&
        resolved.mediaType === 'video' &&
        !src &&
        resolved.playUrl &&
        /^https?:\/\//i.test(resolved.playUrl) &&
        !(resolved.originalUrl && resolved.playUrl === resolved.originalUrl)
      ) {
        try {
          src = (await this._prefetchSplashPlayUrl(resolved.playUrl, SPLASH_VIDEO_PREFETCH_MS)) || ''
        } catch (e) {
          src = ''
        }
      }

      const countdown = Math.min(
        SPLASH_VIDEO_MAX_SEC,
        Math.max(1, Number((cfg && cfg.countdownSeconds) || (cached && cached.countdownSeconds) || 5) || 5)
      )
      this._showSplash({
        mediaType: resolved.mediaType,
        mediaUrl: src || resolved.playUrl,
        posterUrl: resolved.posterUrl,
        originalUrl: resolved.originalUrl,
        countdown,
        missionName: resolved.missionName
      })

      // 后台刷新完整配置与本地预下载（不改变本次已展示内容）
      // mediaItems 优先存云端原数组（含 previewStatus），避免二次 normalize 丢状态后误退原片
      const cacheMediaItems =
        cfg && Array.isArray(cfg.mediaItems) && cfg.mediaItems.length
          ? cfg.mediaItems
          : cloudItems.length
            ? cloudItems
            : pool
      this._cacheSplashMedia(
        {
          enabled: true,
          countdownSeconds: countdown,
          mediaItems: cacheMediaItems,
          lastSplashId: resolved.id || resolved.originalUrl || resolved.playUrl,
          mediaType: resolved.mediaType,
          mediaUrl: resolved.originalUrl,
          originalUrl: resolved.originalUrl,
          playUrl: resolved.playUrl,
          previewUrl: picked && picked.previewUrl ? picked.previewUrl : '',
          posterUrl: resolved.posterUrl
        },
        cached,
        { skipMediaDownload: !splashVideoAllowed }
      )

      // 若刚才短等没拿到云端，后台再拉一次补全缓存池
      if (!cloudItems.length && wx.cloud && wx.cloud.database) {
        try {
          const db = wx.cloud.database()
          const late = await db.collection('starship_splash_config').doc('current').get()
          const lateCfg = late && late.data ? late.data : null
          const lateItems = normalizeItems(lateCfg)
          if (lateCfg && lateCfg.enabled !== false && lateItems.length) {
            this._cacheSplashMedia(
              {
                enabled: true,
                countdownSeconds: lateCfg.countdownSeconds || countdown,
                mediaItems:
                  Array.isArray(lateCfg.mediaItems) && lateCfg.mediaItems.length
                    ? lateCfg.mediaItems
                    : lateItems,
                lastSplashId: resolved.id || resolved.originalUrl || resolved.playUrl,
                mediaType: resolved.mediaType,
                mediaUrl: resolved.originalUrl,
                originalUrl: resolved.originalUrl,
                playUrl: resolved.playUrl,
                previewUrl: picked && picked.previewUrl ? picked.previewUrl : '',
                posterUrl: resolved.posterUrl
              },
              wx.getStorageSync(SPLASH_CACHE_KEY) || cached,
              { skipMediaDownload: !splashVideoAllowed }
            )
          }
        } catch (e) {}
      }
    } catch (e) {
      // 静默失败，不影响主页加载
    }
  },

  _showSplash(opts) {
    if (this.data.splashVisible) return
    const mediaType = opts.mediaType || 'image'
    const mediaUrl = opts.mediaUrl || ''
    const posterUrl = opts.posterUrl || ''
    const originalUrl = opts.originalUrl || mediaUrl
    const countdown = Math.min(
      SPLASH_VIDEO_MAX_SEC,
      Math.max(1, Number(opts.countdown || 5) || 5)
    )
    // 开屏期间让隐私禁触遮罩让位（遮罩在 root-portal 根层级，会压住开屏层吞掉「跳过」点击）；
    // 开屏自身全屏遮挡 + TabBar 守卫仍读 privacyGateActive，门控不失效
    const app = getApp()
    if (app && typeof app.setSplashActive === 'function') app.setSplashActive(true)
    this.setData({
      splashVisible: true,
      splashVideoReady: mediaType !== 'video',
      splashConfig: {
        mediaType,
        mediaUrl,
        posterUrl,
        originalUrl
      },
      splashCountdown: countdown
    })

    this._startSplashTick(mediaType)
    this._armSplashVideoMaxGuard(mediaType)
    this._armSplashVideoPlayGuards(mediaType)

    // 运营配置了任务名称：异步匹配最近的即将发射任务，叠加可点击倒计时卡片
    if (opts.missionName) {
      this._loadSplashMission(String(opts.missionName).trim())
    }
  },

  /**
   * 短等预取开屏可播地址；超时返回空，不阻塞展示。
   * 超时后下载不作废：完整 promise 记到 _splashPrefetching，交给 _cacheSplashMedia 复用，
   * 避免同一 URL 再起一路下载与 <video> 拉流抢带宽（慢网下会拖垮起播、触发封面降级）。
   */
  _prefetchSplashPlayUrl(playUrl, maxWaitMs) {
    const wait = Math.max(200, Number(maxWaitMs) || SPLASH_VIDEO_PREFETCH_MS)
    const downloadPromise = new Promise((resolve) => {
      try {
        wx.downloadFile({
          url: playUrl,
          success: (res) => {
            resolve(res && res.statusCode === 200 && res.tempFilePath ? res.tempFilePath : '')
          },
          fail: () => resolve('')
        })
      } catch (e) {
        resolve('')
      }
    })
    this._splashPrefetching = { url: playUrl, promise: downloadPromise }
    return Promise.race([
      downloadPromise,
      new Promise((resolve) => setTimeout(() => resolve(''), wait))
    ])
  },

  _markSplashVideoReady() {
    if (!this.data.splashVisible || this.data.splashFading) return
    if (this.data.splashVideoReady) return
    this.setData({ splashVideoReady: true })
  },

  _forceSplashVideoPlay() {
    try {
      const ctx = wx.createVideoContext(SPLASH_VIDEO_ID, this)
      if (ctx && typeof ctx.play === 'function') ctx.play()
    } catch (e) {}
  },

  /** 起播失败/缓冲过久：降级为封面图，按图片倒计时关闭，避免一直假死 */
  _fallbackSplashVideoToPoster() {
    if (!this.data.splashVisible || this.data.splashFading) return
    if (this.data.splashVideoReady) return
    const cfg = this.data.splashConfig || {}
    if (cfg.mediaType !== 'video') return
    const poster = cfg.posterUrl || ''
    if (!poster) {
      this.closeSplash()
      return
    }
    this._clearSplashVideoPlayGuards()
    // 已降级为图片：清掉视频 12s 墙钟，改由图片倒计时负责关闭
    this._clearSplashVideoMaxGuard()
    this._splashVideoShownAt = 0
    const left = Math.max(1, Number(this.data.splashCountdown) || 1)
    this.setData({
      splashVideoReady: true,
      splashCountdown: left,
      splashConfig: {
        ...cfg,
        mediaType: 'image',
        mediaUrl: poster
      }
    })
    this._startSplashTick('image')
  },

  _armSplashVideoPlayGuards(mediaType, opts) {
    this._clearSplashVideoPlayGuards({ keepStartedAt: !!(opts && opts.preserveStart) })
    if (mediaType !== 'video') return
    if (!(opts && opts.preserveStart) || !this._splashVideoGuardStartedAt) {
      this._splashVideoGuardStartedAt = Date.now()
    }
    const elapsed = Math.max(0, Date.now() - Number(this._splashVideoGuardStartedAt || Date.now()))
    const forceLeft = Math.max(0, SPLASH_VIDEO_FORCE_PLAY_MS - elapsed)
    // 元数据已就绪过：降级预算包含 loadedmetadata 的延长额度，
    // 否则切后台回来 re-arm 时会按 2.8s 立即降级，吞掉延长窗口
    const fallBudget =
      SPLASH_VIDEO_FALLBACK_MS + (this._splashVideoMetaExtended ? SPLASH_VIDEO_META_EXTEND_MS : 0)
    const fallLeft = Math.max(0, fallBudget - elapsed)
    if (forceLeft <= 0) {
      this._forceSplashVideoPlay()
    } else {
      this._splashVideoForcePlayTimer = setTimeout(() => {
        this._splashVideoForcePlayTimer = null
        if (!this.data.splashVisible || this.data.splashFading || this.data.splashVideoReady) return
        this._forceSplashVideoPlay()
      }, forceLeft)
    }
    if (fallLeft <= 0) {
      // 已超时：下一 macrotask 再降级，避免在 resume/setData 调用栈里同步拆掉 <video>
      this._splashVideoFallbackTimer = setTimeout(() => {
        this._splashVideoFallbackTimer = null
        this._fallbackSplashVideoToPoster()
      }, 0)
    } else {
      this._splashVideoFallbackTimer = setTimeout(() => {
        this._splashVideoFallbackTimer = null
        this._fallbackSplashVideoToPoster()
      }, fallLeft)
    }
  },

  _clearSplashVideoPlayGuards(opts) {
    if (this._splashVideoForcePlayTimer) {
      clearTimeout(this._splashVideoForcePlayTimer)
      this._splashVideoForcePlayTimer = null
    }
    if (this._splashVideoFallbackTimer) {
      clearTimeout(this._splashVideoFallbackTimer)
      this._splashVideoFallbackTimer = null
    }
    if (!(opts && opts.keepStartedAt)) {
      this._splashVideoGuardStartedAt = 0
      this._splashVideoMetaExtended = false
    }
  },

  /** 视频开屏硬上限：到点强制关闭（防预览未就绪时播原片超时、或 timeupdate 丢失） */
  _armSplashVideoMaxGuard(mediaType) {
    if (this._splashVideoMaxTimer) {
      clearTimeout(this._splashVideoMaxTimer)
      this._splashVideoMaxTimer = null
    }
    if (mediaType !== 'video') return
    this._splashVideoShownAt = Date.now()
    this._splashVideoMaxTimer = setTimeout(() => {
      this._splashVideoMaxTimer = null
      if (this.data.splashVisible && !this.data.splashFading) this.closeSplash()
    }, SPLASH_VIDEO_MAX_MS)
  },

  _clearSplashVideoMaxGuard() {
    if (this._splashVideoMaxTimer) {
      clearTimeout(this._splashVideoMaxTimer)
      this._splashVideoMaxTimer = null
    }
  },

  onSplashVideoPlay() {
    this._markSplashVideoReady()
    this._clearSplashVideoPlayGuards()
  },

  onSplashVideoTimeUpdate(e) {
    const t = Number(e.detail && e.detail.currentTime) || 0
    // 播到上限立即关闭（截取预览未就绪、或仍在播原片时兜底）
    if (t >= SPLASH_VIDEO_MAX_SEC) {
      if (this.data.splashVisible && !this.data.splashFading) this.closeSplash()
      return
    }
    // 仅在真正开播后揭封面；不要仅凭 duration>0（元数据就绪）揭开，否则会露出黑屏缓冲
    if (t > 0) {
      this._markSplashVideoReady()
      this._clearSplashVideoPlayGuards()
    }
  },

  /** 元数据就绪：流量在动、即将起播。再踢一次 play，并把降级窗口一次性延长，慢网不误降级封面 */
  onSplashVideoLoadedMeta() {
    if (!this.data.splashVisible || this.data.splashFading || this.data.splashVideoReady) return
    const cfg = this.data.splashConfig || {}
    if (cfg.mediaType !== 'video') return
    if (this._splashVideoMetaExtended) return
    this._splashVideoMetaExtended = true
    this._forceSplashVideoPlay()
    if (this._splashVideoFallbackTimer) {
      clearTimeout(this._splashVideoFallbackTimer)
      this._splashVideoFallbackTimer = setTimeout(() => {
        this._splashVideoFallbackTimer = null
        this._fallbackSplashVideoToPoster()
      }, SPLASH_VIDEO_META_EXTEND_MS)
    }
  },

  /** 预览版失败：降级封面图，避免黑屏假死 */
  onSplashVideoError() {
    const cfg = this.data.splashConfig || {}
    if (!cfg || cfg.mediaType !== 'video') return
    this._fallbackSplashVideoToPoster()
  },

  /** 按后台配置的任务名称，在即将发射列表中匹配最近的一条 */
  async _loadSplashMission(missionName) {
    if (!missionName) return

    // 秒显快路径：上次同名配置匹配到的任务本地有缓存 → 先展示卡片（~0ms），云端返回后校正。
    // 距发射 ≤2h 不快显：此时可能已在飞行中/终态，等实时确认，避免卡片闪现后又整屏关闭
    let fastShown = false
    try {
      const cachedHit = wx.getStorageSync(SPLASH_MISSION_HIT_KEY) || null
      if (
        cachedHit &&
        cachedHit.id &&
        cachedHit.launchTime &&
        String(cachedHit.configName || '') === String(missionName)
      ) {
        const ts = new Date(cachedHit.launchTime).getTime()
        if (Number.isFinite(ts) && ts - Date.now() > SPLASH_LIVE_CHECK_WINDOW_MS) {
          this.setData({
            splashMission: {
              id: cachedHit.id,
              name: cachedHit.name || '',
              launchTime: cachedHit.launchTime
            }
          })
          this._startSplashMissionTick()
          fastShown = true
        }
      }
    } catch (e) {}

    try {
      const result = await getUpcomingMissions(20, 0)
      const list = result && Array.isArray(result.list) ? result.list : []
      // 归一化：小写、去空格与标点，互相包含即视为命中
      const norm = (s) =>
        String(s || '')
          .toLowerCase()
          .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '')
      // 兼容 "Starship Flight 13" ↔ "Starship Flight Test 13" / "Starship IFT-13"
      // softNorm 已去空格标点，"starshipift13" 里 ift 无词边界，必须用 ift(?=\d)
      const softNorm = (s) =>
        norm(s)
          .replace(/integratedflighttest/g, 'flight')
          .replace(/flighttest/g, 'flight')
          .replace(/ift(?=\d)/g, 'flight')
      const extractFlightNo = (s) => {
        const m = String(s || '').match(/flight\s*(?:test\s*)?#?\s*(\d+)/i) ||
          String(s || '').match(/\bift[-\s]?(\d+)/i)
        return m ? Number(m[1]) : 0
      }
      const target = softNorm(missionName)
      const targetFlight = extractFlightNo(missionName)
      if (!target && !targetFlight) return

      const nowTs = Date.now()
      const nameMatches = (m) => {
        const candidates = [m.name, m.missionName]
        if (targetFlight) {
          const byNo = candidates.some((c) => extractFlightNo(c) === targetFlight) &&
            candidates.some((c) => /starship/i.test(String(c || '')) || /星舰/.test(String(c || '')))
          // 仅当双方都能抽出同一 Flight 号且候选侧含星舰时，用编号命中（避免 Falcon Flight 误配）
          if (byNo) return true
          // 配置侧无星舰关键字时，纯编号命中也放行（运营手填「Flight 13」）
          if (!/starship|星舰/i.test(missionName) && candidates.some((c) => extractFlightNo(c) === targetFlight)) {
            return true
          }
        }
        return candidates.some((c) => {
          const n = softNorm(c)
          return n && target && (n.indexOf(target) !== -1 || target.indexOf(n) !== -1)
        })
      }
      const matches = list.filter((m) => {
        if (!m || !m.id || !m.launchTime) return false
        const ts = new Date(m.launchTime).getTime()
        if (!Number.isFinite(ts) || ts <= nowTs) return false
        return nameMatches(m)
      })

      // 生命周期：列表缓存里同名任务已是飞行中 → 直接关闭开屏（不显示卡片）
      const inflightHit = list.find((m) => m && m.id && Number(m.statusId) === SPLASH_STATUS_INFLIGHT && nameMatches(m))
      if (inflightHit) {
        if (this.data.splashVisible && !this.data.splashFading) this.closeSplash()
        return
      }

      if (!matches.length) {
        // 快显的缓存卡片已过时（任务不在即将发射列表里了）：移除并清缓存
        if (fastShown) this._clearSplashMissionCard(true)
        return
      }

      // 命中多条取发射时间最近的
      matches.sort((a, b) => new Date(a.launchTime).getTime() - new Date(b.launchTime).getTime())
      const hit = matches[0]

      // 临近发射（±2h）：用状态探针库（launch_status，零 LL2 成本）实时确认；
      // 探明飞行中 → 自动关闭开屏；终态 → 不显示卡片
      const launchTs = new Date(hit.launchTime).getTime()
      if (Math.abs(nowTs - launchTs) <= SPLASH_LIVE_CHECK_WINDOW_MS) {
        try {
          const rows = await fetchLaunchStatusSnapshot([hit.id])
          const row = Array.isArray(rows)
            ? rows.find((r) => r && String(r.id) === String(hit.id))
            : null
          const sid = row && row.status ? Number(row.status.id) : 0
          if (sid === SPLASH_STATUS_INFLIGHT) {
            if (this.data.splashVisible && !this.data.splashFading) this.closeSplash()
            return
          }
          if (SPLASH_STATUS_TERMINAL[sid]) {
            if (fastShown) this._clearSplashMissionCard(true)
            return
          }
        } catch (e) {}
      }

      // 命中即写缓存（无论开屏是否还在）：下次同名配置的开屏可秒显卡片
      try {
        wx.setStorageSync(SPLASH_MISSION_HIT_KEY, {
          configName: String(missionName),
          id: hit.id,
          name: hit.missionName || hit.name || '',
          launchTime: hit.launchTime,
          savedAt: Date.now()
        })
      } catch (e) {}

      // 异步返回时开屏可能已关闭/正在淡出，避免闪现
      if (!this.data.splashVisible || this.data.splashFading) return

      this.setData({
        splashMission: {
          id: hit.id,
          name: hit.missionName || hit.name || '',
          launchTime: hit.launchTime
        }
      })
      this._startSplashMissionTick()
    } catch (e) {
      // 匹配失败静默降级：只影响倒计时卡片，不影响开屏本身（快显卡片保留，误差由缓存时效兜底）
    }
  },

  /** 移除任务倒计时卡片；removeCache 为真时同时清掉秒显缓存 */
  _clearSplashMissionCard(removeCache) {
    if (this._splashMissionTimer) {
      clearInterval(this._splashMissionTimer)
      this._splashMissionTimer = null
    }
    if (this.data.splashMission || this.data.splashMissionCd) {
      this.setData({ splashMission: null, splashMissionCd: null })
    }
    if (removeCache) {
      try {
        wx.removeStorageSync(SPLASH_MISSION_HIT_KEY)
      } catch (e) {}
    }
  },

  /** 任务倒计时每秒刷新（独立于开屏跳过倒计时的 timer） */
  _startSplashMissionTick() {
    if (this._splashMissionTimer) {
      clearInterval(this._splashMissionTimer)
      this._splashMissionTimer = null
    }
    const update = () => {
      const mission = this.data.splashMission
      if (!mission || !this.data.splashVisible) {
        if (this._splashMissionTimer) {
          clearInterval(this._splashMissionTimer)
          this._splashMissionTimer = null
        }
        return
      }
      const diff = new Date(mission.launchTime).getTime() - Date.now()
      if (diff <= 0) {
        if (this._splashMissionTimer) {
          clearInterval(this._splashMissionTimer)
          this._splashMissionTimer = null
        }
        this.setData({ splashMissionCd: { imminent: true, d: '0', h: '00', m: '00', s: '00' } })
        return
      }
      const pad2 = (n) => (n < 10 ? '0' + n : String(n))
      const totalSec = Math.floor(diff / 1000)
      const d = Math.floor(totalSec / 86400)
      const h = Math.floor((totalSec % 86400) / 3600)
      const m = Math.floor((totalSec % 3600) / 60)
      const s = totalSec % 60
      this.setData({
        splashMissionCd: {
          imminent: false,
          d: String(d),
          h: pad2(h),
          m: pad2(m),
          s: pad2(s)
        }
      })
    }
    update()
    this._splashMissionTimer = setInterval(update, 1000)
  },

  /** 点击开屏任务倒计时卡片：关闭开屏并跳转任务详情 */
  onSplashMissionTap() {
    if (this.data.splashFading) return
    const mission = this.data.splashMission
    if (!mission || !mission.id) return
    try {
      wx.vibrateShort({ type: 'medium' })
    } catch (e) {}
    const app = getApp()
    const privacyBlocked = !!(app && app.globalData && app.globalData.privacyGateActive)
    this.closeSplash()
    // 隐私未授权：只关开屏，交给 closeSplash 内的隐私弹窗接力，不跳转
    if (privacyBlocked) return
    wx.navigateTo({
      url: buildMissionDetailUrl({ id: mission.id, detailType: 'upcoming' }),
      fail: () => {}
    })
  },

  /** 启动开屏倒计时 interval（onHide 停表后由 _resumeSplashTimer 复用） */
  _startSplashTick(mediaType) {
    if (this._splashTimer) {
      clearInterval(this._splashTimer)
      this._splashTimer = null
    }
    if (mediaType === 'image') {
      this._splashTimer = setInterval(() => {
        const next = this.data.splashCountdown - 1
        if (next <= 0) {
          this.closeSplash()
        } else {
          this.setData({ splashCountdown: next })
        }
      }, 1000)
    } else {
      this._splashTimer = setInterval(() => {
        const next = this.data.splashCountdown - 1
        if (next <= 0) {
          clearInterval(this._splashTimer)
          this._splashTimer = null
          this.setData({ splashCountdown: 0 })
        } else {
          this.setData({ splashCountdown: next })
        }
      }, 1000)
    }
  },

  _resumeSplashTimer() {
    const cfg = this.data.splashConfig || {}
    // 视频分支倒计时到 0 后 timer 已自清，剩余秒数 > 0 才需要续跑
    if (this.data.splashCountdown > 0) {
      this._startSplashTick(cfg.mediaType || 'image')
    }
    // 视频硬上限按墙钟剩余时间续跑（切后台期间也计入 12 秒额度）
    if (cfg.mediaType === 'video' && this.data.splashVisible && !this.data.splashFading) {
      const startedAt = Number(this._splashVideoShownAt || 0)
      const elapsed = startedAt ? Date.now() - startedAt : SPLASH_VIDEO_MAX_MS
      const left = Math.max(0, SPLASH_VIDEO_MAX_MS - elapsed)
      this._clearSplashVideoMaxGuard()
      if (left <= 0) {
        this.closeSplash()
      } else {
        this._splashVideoMaxTimer = setTimeout(() => {
          this._splashVideoMaxTimer = null
          if (this.data.splashVisible && !this.data.splashFading) this.closeSplash()
        }, left)
      }
      // 回前台若仍未起播：立刻再踢 play，降级定时按首次展示起算剩余时间（不整段重计）
      // 注意：已因 12s 墙钟用尽而 closeSplash 时不要再 arm（避免 fading 中同步 fallback）
      if (left > 0 && !this.data.splashVideoReady) {
        this._forceSplashVideoPlay()
        this._armSplashVideoPlayGuards('video', { preserveStart: true })
      }
    }
    // 任务倒计时按绝对时间重算，直接重启即可
    if (this.data.splashMission) {
      this._startSplashMissionTick()
    }
  },

  /** 缓存完整媒体池；仅预下载本次开屏用的压缩预览（不再预拉池内其它条） */
  _cacheSplashMedia(cfg, prevCached, opts) {
    const prev = prevCached || {}
    const items = Array.isArray(cfg.mediaItems) ? cfg.mediaItems : []
    const prevLocalPaths = prev.localPaths && typeof prev.localPaths === 'object' ? { ...prev.localPaths } : {}
    const baseEntry = {
      enabled: true,
      mediaItems: items,
      lastSplashId: cfg.lastSplashId || '',
      mediaUrl: cfg.mediaUrl || '',
      playUrl: cfg.playUrl || '',
      previewUrl: cfg.previewUrl || '',
      posterUrl: cfg.posterUrl || '',
      mediaType: cfg.mediaType || 'image',
      countdownSeconds: cfg.countdownSeconds || 5,
      localPath: prev.localPath || '',
      localPaths: prevLocalPaths,
      cachedAt: Date.now()
    }
    try {
      wx.setStorageSync(SPLASH_CACHE_KEY, baseEntry)
    } catch (e) {}

    // 视频被降级为静态图（过审关视频 / 省流·紧急档非 Pro）：只缓存配置，跳过视频预下载
    if (opts && opts.skipMediaDownload) return

    // 只预下载本次选中的压缩预览，避免冷启动额外拉未播视频；原片不落盘
    const playUrls = []
    if (cfg.playUrl && !(cfg.originalUrl && cfg.playUrl === cfg.originalUrl)) {
      playUrls.push(cfg.playUrl)
    } else if (cfg.previewUrl) {
      playUrls.push(cfg.previewUrl)
    }

    const fs = wx.getFileSystemManager()
    const saveTemp = (playUrl, tempFilePath) => {
      fs.saveFile({
        tempFilePath,
        success: (saveRes) => {
          try {
            const cur = wx.getStorageSync(SPLASH_CACHE_KEY) || baseEntry
            const map = cur.localPaths && typeof cur.localPaths === 'object' ? { ...cur.localPaths } : {}
            if (map[playUrl] && map[playUrl] !== saveRes.savedFilePath) {
              try {
                fs.removeSavedFile({ filePath: map[playUrl], fail: () => {} })
              } catch (e) {}
            }
            map[playUrl] = saveRes.savedFilePath
            const keys = Object.keys(map)
            if (keys.length > 6) {
              const drop = keys.slice(0, keys.length - 6)
              drop.forEach((k) => {
                try {
                  fs.removeSavedFile({ filePath: map[k], fail: () => {} })
                } catch (e) {}
                delete map[k]
              })
            }
            wx.setStorageSync(SPLASH_CACHE_KEY, {
              ...cur,
              mediaItems: cur.mediaItems && cur.mediaItems.length ? cur.mediaItems : items,
              localPaths: map,
              localPath: (cfg.playUrl && map[cfg.playUrl]) || cur.localPath || ''
            })
          } catch (e) {}
        },
        fail: () => {}
      })
    }
    const startDownload = (playUrl) => {
      wx.downloadFile({
        url: playUrl,
        success: (res) => {
          if (!res || res.statusCode !== 200 || !res.tempFilePath) return
          saveTemp(playUrl, res.tempFilePath)
        },
        fail: () => {}
      })
    }
    const downloadOne = (playUrl) => {
      if (!playUrl || !/^https?:\/\//i.test(playUrl)) return
      // 原片不预下（仅缓存 preview 压缩片）
      if (cfg.originalUrl && playUrl === cfg.originalUrl && cfg.playUrl && cfg.playUrl !== cfg.originalUrl) return
      const existing = prevLocalPaths[playUrl]
      if (existing) {
        try {
          fs.accessSync(existing)
          return
        } catch (e) {
          delete prevLocalPaths[playUrl]
        }
      }
      // 开屏前 _prefetchSplashPlayUrl 已在下载同一 URL：复用其结果，不再另起一路下载抢带宽
      const pending = this._splashPrefetching
      if (pending && pending.url === playUrl && pending.promise) {
        this._splashPrefetching = null
        pending.promise.then((tempFilePath) => {
          if (!tempFilePath) return
          const playingSrc = this.data && this.data.splashConfig ? this.data.splashConfig.mediaUrl : ''
          // saveFile 会移动临时文件；正在从该临时文件播放时移动会中断播放，此时退回独立下载
          if (tempFilePath === playingSrc && this.data.splashVisible) {
            startDownload(playUrl)
            return
          }
          saveTemp(playUrl, tempFilePath)
        })
        return
      }
      startDownload(playUrl)
    }

    playUrls.forEach(downloadOne)
  },

  onSplashVideoEnded() {
    this.closeSplash()
  },

  /** 用户手动点「跳过」：中度震动反馈（倒计时自动结束走 closeSplash，不震动） */
  onSplashSkipTap() {
    if (this.data.splashFading) return
    try {
      wx.vibrateShort({ type: 'medium' })
    } catch (e) {}
    this.closeSplash()
  },

  closeSplash() {
    if (this.data.splashFading) return
    if (this._splashTimer) {
      clearInterval(this._splashTimer)
      this._splashTimer = null
    }
    if (this._splashMissionTimer) {
      clearInterval(this._splashMissionTimer)
      this._splashMissionTimer = null
    }
    this._clearSplashVideoMaxGuard()
    this._clearSplashVideoPlayGuards()
    this._splashVideoShownAt = 0
    this.setData({ splashFading: true })
    setTimeout(() => {
      this.setData({
        splashVisible: false,
        splashFading: false,
        splashVideoReady: false,
        splashMission: null,
        splashMissionCd: null
      })
      // 开屏结束：恢复隐私禁触遮罩（若门控仍激活），并接力弹隐私授权窗
      const app = getApp()
      if (app && typeof app.setSplashActive === 'function') app.setSplashActive(false)
      // 开屏结束后再检查隐私授权，避免弹窗被品牌开屏盖住
      setTimeout(() => this._maybePromptPrivacy(), 200)
    }, 500)
  },
}

module.exports = {
  methods,
  /** 把全部方法挂到页面实例上（委托加载后调用） */
  attachTo(page) {
    Object.keys(methods).forEach((k) => {
      page[k] = methods[k].bind(page)
    })
    page.__splashAttached = true
  }
}
