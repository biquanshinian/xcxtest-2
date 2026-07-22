/**
 * subpackages/index-extra/utils/index-carousel.js
 * 首页轮播图/视频逻辑（从 pages/index/index.js 拆出）：
 * - 轮播素材拉取（media_assets 翻页 + 本地缓存 + stale-if-error 兜底）
 * - 账号胶囊 / 推文文案补全
 * - 定时器、视频激活与自动播门控、事件回调（非会员视频策略原样保留）
 *
 * 主包 index.js 通过 require.async + attachTo 委托加载（与 index-calendar-page 模式一致）；
 * 首页在 preloadRule 中预下载 index-extra 分包，实际几乎无加载等待。
 * 注意：_isCarouselAutoplayAllowed 因被主包同步调用（返回值判断）保留在 index.js。
 */
const { isPlaybackAllowed } = require('../../../utils/feature-flags.js')
const { DEFAULT_CAROUSEL_ITEMS } = require('../../../utils/index-page-helpers.js')
const { resolveMediaUrl } = require('../../../utils/image-config.js')
const { getCachedMediaImage } = require('../../../utils/icon-cache.js')
const { getCachedVideo } = require('./video-cache.js')
const { eventVideoAdUnlockId, playEventVideo } = require('./event-video.js')
const { toCdnUrl, carouselVideoPosterUrl } = require('../../../utils/cos-url.js')
const { ROUTES, navigateTo } = require('../../../utils/routes.js')
const {
  isMembershipEnabled,
  isProSync,
  canUsePaidCloudSync,
  canPrefetchVideoSync,
  gateCheck
} = require('../../../utils/membership.js')
const { getMemberPolicy } = require('../../../utils/member-policy.js')

const CAROUSEL_CONFIG_CACHE_KEY = '_carousel_global_config_cache'
const CAROUSEL_CONFIG_CACHE_TTL = 10 * 60 * 1000
// 轮播条目本地缓存：素材由管理员编辑或 syncCarouselFromTweets 每小时更新，
// 30 分钟内直接复用本地条目，省掉每次进首页的 media_assets 翻页拉全（最多 5 次查询/百余条读）
const CAROUSEL_DOCS_CACHE_KEY = '_carousel_docs_cache_v1'
const CAROUSEL_DOCS_CACHE_TTL = 30 * 60 * 1000
// 拉取失败时旧条目最长可用 24h（stale-if-error）
const CAROUSEL_DOCS_STALE_MAX_MS = 24 * 60 * 60 * 1000
// 推文文案一经发布不再变化：caption 映射缓存 24h，省掉每次进首页的 starship_event_updates 查询
const CAROUSEL_CAPTION_CACHE_KEY = '_carousel_caption_cache_v1'
const CAROUSEL_CAPTION_CACHE_TTL = 24 * 60 * 60 * 1000

const methods = {
  getDefaultCarouselImages() {
    return DEFAULT_CAROUSEL_ITEMS.map((item) => resolveMediaUrl(item.key, '')).filter(Boolean)
  },

  async loadCarouselImages() {
    const VIDEO_EXTS = /\.(mp4|mov|avi|mkv|webm)$/i
    const PREFIX = /^首页轮播图\//i
    let carouselDisabled = false
    let imageDuration = 5
    let videoDuration = 5
    let configFromCache = false

    try {
      const cached = await new Promise((resolve) => {
        wx.getStorage({
          key: CAROUSEL_CONFIG_CACHE_KEY,
          success: (res) => resolve(res.data),
          fail: () => resolve(null)
        })
      })
      if (cached && cached.ts && Date.now() - cached.ts < CAROUSEL_CONFIG_CACHE_TTL) {
        carouselDisabled = !!cached.disabled
        imageDuration = cached.imageDuration || 5
        videoDuration = cached.videoDuration || 5
        configFromCache = true
      }
    } catch (e) {}

    // 条目本地缓存：30 分钟内复用，过期条目留作拉取失败时的 stale 兜底
    let docs = []
    let docsFromCache = false
    let staleDocs = null
    try {
      const cachedDocs = await new Promise((resolve) => {
        wx.getStorage({
          key: CAROUSEL_DOCS_CACHE_KEY,
          success: (res) => resolve(res.data),
          fail: () => resolve(null)
        })
      })
      if (cachedDocs && Array.isArray(cachedDocs.docs) && cachedDocs.docs.length && cachedDocs.ts) {
        const age = Date.now() - cachedDocs.ts
        if (age < CAROUSEL_DOCS_CACHE_TTL) {
          docs = cachedDocs.docs
          docsFromCache = true
        } else if (age < CAROUSEL_DOCS_STALE_MAX_MS) {
          staleDocs = cachedDocs.docs
        }
      }
    } catch (e) {}

    // 配置命中本地缓存：只查条目；未命中：配置+条目并行
    try {
      const db = wx.cloud.database()
      const _ = db.command
      // 小程序端单次查询上限 20 条（.limit(100) 会被静默截断成 20）：
      // 轮播素材超过 20 张时会随机丢条目，按 20/批翻页拉全（上限 100 与原意图一致）
      const fetchCarouselDocs = async () => {
        const BATCH = 20
        const MAX_TOTAL = 100
        let out = []
        for (let i = 0; i < Math.ceil(MAX_TOTAL / BATCH); i++) {
          const res = await db
            .collection('media_assets')
            .where({ sourceTag: _.in(['carousel', 'auto-carousel']) })
            .skip(i * BATCH)
            .limit(BATCH)
            .get()
          const batch = res.data || []
          out = out.concat(batch)
          if (batch.length < BATCH) break
        }
        if (out.length) {
          wx.setStorage({ key: CAROUSEL_DOCS_CACHE_KEY, data: { docs: out, ts: Date.now() }, fail: () => {} })
        }
        return out
      }
      if (configFromCache) {
        if (!carouselDisabled && !docsFromCache) {
          docs = await fetchCarouselDocs()
        }
      } else {
        const [cfgRes, itemDocs] = await Promise.all([
          db.collection('media_assets').where({ key: '__carousel_global_config__' }).limit(1).get(),
          docsFromCache ? Promise.resolve(docs) : fetchCarouselDocs()
        ])
        const configDoc = (cfgRes.data || [])[0]
        carouselDisabled = !!(configDoc && configDoc.enabled === false)
        imageDuration = configDoc && configDoc.imageDuration ? Number(configDoc.imageDuration) : 5
        videoDuration = configDoc && configDoc.videoDuration ? Number(configDoc.videoDuration) : 5
        docs = itemDocs || []
        wx.setStorage({
          key: CAROUSEL_CONFIG_CACHE_KEY,
          data: {
            disabled: carouselDisabled,
            imageDuration,
            videoDuration,
            ts: Date.now()
          }
        })
      }
    } catch (e) {
      console.warn('动态获取轮播图失败，使用默认图片', e)
      // 拉取失败：回退过期旧条目（stale-if-error），避免轮播整块退化为默认图
      if (!docs.length && staleDocs) docs = staleDocs
    }

    if (carouselDisabled) {
      this.setData({ carouselImages: [], carouselLoadFailed: false, carouselPending: false })
      return
    }

    this.setData({
      carouselImageDuration: imageDuration * 1000,
      carouselVideoDuration: videoDuration * 1000
    })

    // 过审开关先于任何视频预热确认：未确认允许前不调 getCachedVideo（Pro 用户也一样）
    const playbackOk = await isPlaybackAllowed().catch(() => false)

    let items = []
    try {
      const filtered = (docs || [])
        .filter((d) => d && d.enabled !== false && d.key && PREFIX.test(String(d.key)))
        .sort((a, b) => {
          const sa = Number(a.sort || 0)
          const sb = Number(b.sort || 0)
          const aIsAuto = a.sourceTag === 'auto-carousel'
          const bIsAuto = b.sourceTag === 'auto-carousel'
          if (!aIsAuto && bIsAuto) return -1
          if (aIsAuto && !bIsAuto) return 1
          if (!aIsAuto && !bIsAuto) {
            if (sa !== sb) return sa - sb
            return String(a.key || '').localeCompare(String(b.key || ''))
          }
          const ta = Number(a.cosSyncedAt || 0)
          const tb = Number(b.cosSyncedAt || 0)
          return tb - ta
        })
        .slice(0, 20)
      if (filtered.length > 0) {
        items = filtered
          .map((doc) => {
            const rawSrc = doc.url || resolveMediaUrl(doc.key, '')
            const src = doc.url ? getCachedMediaImage(toCdnUrl(doc.url), 'medium') : rawSrc
            if (!src) return null
            const isVideo = doc.type === 'video' || VIDEO_EXTS.test(doc.key || '') || VIDEO_EXTS.test(doc.url || '')
            const folderMatch = String(doc.key || '').match(/^首页轮播图\/auto\/([^/]+)\//)
            const posterUrl = isVideo ? carouselVideoPosterUrl(src, doc.thumbnailUrl || '') : ''
            const poster = posterUrl ? getCachedMediaImage(posterUrl, 'thumb') : ''
            const previewSrc =
              doc.previewUrl && String(doc.previewUrl).trim() ? toCdnUrl(String(doc.previewUrl).trim()) : ''
            // 非会员：默认不预热、不写入可播地址（策略 forceNonMemberVideoPoster）；有权益才预热预览片
            // 无预览片时也不用原片做内嵌自动播（原片过大），点击全屏再按需播
            const playSrc = playbackOk && previewSrc && canPrefetchVideoSync() ? getCachedVideo(previewSrc) : ''
            return {
              // 视频项 src 不挂 mp4，避免任何回退路径误拉原片
              src: isVideo ? poster || src : src,
              playSrc,
              poster: poster || '',
              type: isVideo ? 'video' : 'image',
              caption: doc.caption || '',
              eventId: doc.eventId || '',
              cosFolder: doc.cosFolder || (folderMatch ? folderMatch[1] : ''),
              accountLabel: '',
              accountAvatar: '',
              videoActive: false,
              videoStarted: false,
              lazyPlayUrl: isVideo ? previewSrc || toCdnUrl(doc.url || rawSrc) || '' : ''
            }
          })
          .filter(Boolean)
      }
    } catch (e) {
      console.warn('解析轮播图失败，使用默认图片', e)
    }

    // 过审关闭 enableEventVideo：视频项降级为封面图，避免首页挂载 <video>
    if (!playbackOk && items.length) {
      items = items
        .map((i) => {
          if (!i || i.type !== 'video') return i
          const cover = i.poster || i.src || ''
          if (!cover) return null
          return {
            src: cover,
            playSrc: '',
            poster: '',
            type: 'image',
            caption: i.caption || '',
            eventId: i.eventId || '',
            cosFolder: i.cosFolder || '',
            accountLabel: i.accountLabel || '',
            accountAvatar: i.accountAvatar || '',
            videoActive: false,
            videoStarted: false,
            lazyPlayUrl: ''
          }
        })
        .filter(Boolean)
    }

    if (!items.length) {
      items = this.getDefaultCarouselImages().map((src) => ({ src, type: 'image' }))
    }

    // lazyPlayUrl 只留在实例旁路，不进 setData，避免非会员视图层挂远程 mp4
    this._carouselLazyPlayUrls = items.map((i) => (i && i.lazyPlayUrl) || '')
    const viewItems = items.map((i) => {
      if (!i || !i.lazyPlayUrl) return i
      const { lazyPlayUrl, ...rest } = i
      return rest
    })

    this.setData({
      carouselItems: viewItems,
      carouselImages: viewItems.map((i) => i.src),
      carouselLoadFailed: !viewItems.length,
      carouselPending: false,
      carouselCurrent: 0
    })

    if (viewItems.length > 0) {
      this._activateCarouselVideos(0)
      this._startCarouselTimer()
    }

    this._enrichCarouselCaptions(viewItems)
    this._enrichCarouselAccounts(viewItems)
  },

  /** 按 cosFolder 匹配 tweet_accounts，给轮播项补充账号名 + 头像（左上角胶囊） */
  async _enrichCarouselAccounts(items) {
    if (!items || !items.some((i) => i && i.cosFolder)) return
    const accounts = await this._getTweetAccountsCached()
    if (!accounts.length) return
    const byFolder = {}
    for (const acc of accounts) {
      if (acc.cosFolder) byFolder[acc.cosFolder] = acc
    }
    const updates = {}
    for (let i = 0; i < items.length; i++) {
      const acc = items[i] && items[i].cosFolder ? byFolder[items[i].cosFolder] : null
      if (!acc) continue
      // 头像：库里没配时按约定路径兜底（avatars/<screenName>.jpg），加载失败会自动隐藏
      const avatarUrl =
        acc.avatarUrl ||
        (acc.screenName ? `https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/avatars/${acc.screenName}.jpg` : '')
      updates[`carouselItems[${i}].accountLabel`] = acc.label || acc.screenName || ''
      updates[`carouselItems[${i}].accountAvatar`] = avatarUrl ? getCachedMediaImage(toCdnUrl(avatarUrl), 'thumb') : ''
    }
    if (Object.keys(updates).length) this.setData(updates)
  },

  /** 推文账号列表：本地缓存 24 小时，减少网关调用 */
  async _getTweetAccountsCached() {
    const CACHE_KEY = '_tweet_accounts_cache_v1'
    const TTL = 24 * 60 * 60 * 1000
    try {
      const hit = wx.getStorageSync(CACHE_KEY)
      if (hit && Array.isArray(hit.list) && hit.list.length && Date.now() - hit.at < TTL) {
        return hit.list
      }
    } catch (e) {}
    try {
      const res = await wx.cloud.callFunction({
        name: 'userDataGateway',
        data: { action: 'getTweetAccounts' }
      })
      const list = (res && res.result && res.result.accounts) || []
      if (list.length) {
        try {
          wx.setStorageSync(CACHE_KEY, { list, at: Date.now() })
        } catch (e) {}
      }
      return list
    } catch (e) {
      return []
    }
  },

  /** 账号胶囊头像加载失败 → 只显示账号名 */
  onCarouselAvatarError(e) {
    const index = Number(e.currentTarget.dataset.index)
    if (!isNaN(index) && this.data.carouselItems[index]) {
      this.setData({ [`carouselItems[${index}].accountAvatar`]: '' })
    }
  },

  async _enrichCarouselCaptions(items) {
    const needEnrich = []
    for (let i = 0; i < items.length; i++) {
      if (!items[i].caption && items[i].src) {
        // 从 URL 中提取 tweetId（格式: .../{tweetId}_video{n}.mp4 或 {tweetId}_{n}.jpg）
        const urlPath = decodeURIComponent(items[i].src).split('/').pop() || ''
        const match = urlPath.match(/^(\d+)_/)
        if (match) needEnrich.push({ index: i, tweetId: match[1] })
      }
    }
    if (!needEnrich.length) return

    // 推文文案发布后不再变化：先查本地 24h 映射缓存，只对缺失的 tweetId 回云
    let captionCache = {}
    try {
      const hit = wx.getStorageSync(CAROUSEL_CAPTION_CACHE_KEY)
      if (hit && hit.map && hit.ts && Date.now() - hit.ts < CAROUSEL_CAPTION_CACHE_TTL) {
        captionCache = hit.map
      }
    } catch (e) {}

    const applyUpdates = (eventMap) => {
      const updates = {}
      for (const { index, tweetId } of needEnrich) {
        const info = eventMap[tweetId]
        if (info) {
          updates[`carouselItems[${index}].caption`] = info.content || info.title
          updates[`carouselItems[${index}].eventId`] = info.eventId
        }
      }
      if (Object.keys(updates).length) this.setData(updates)
    }

    const missingIds = [...new Set(needEnrich.map((e) => e.tweetId))].filter((id) => !captionCache[id])
    if (!missingIds.length) {
      applyUpdates(captionCache)
      return
    }

    try {
      const db = wx.cloud.database()
      const res = await db
        .collection('starship_event_updates')
        .where({ tweetId: db.command.in(missingIds), status: 'published' })
        .field({ _id: true, tweetId: true, content: true, title: true })
        .limit(20)
        .get()
      for (const doc of res.data || []) {
        if (doc.tweetId)
          captionCache[doc.tweetId] = { eventId: doc._id, content: doc.content || '', title: doc.title || '' }
      }
      try {
        wx.setStorageSync(CAROUSEL_CAPTION_CACHE_KEY, { map: captionCache, ts: Date.now() })
      } catch (e) {}
      applyUpdates(captionCache)
    } catch (e) {
      applyUpdates(captionCache)
    }
  },

  /** 启动轮播自动翻页定时器 */
  _startCarouselTimer() {
    this._stopCarouselTimer()
    const items = this.data.carouselItems
    if (!items || items.length <= 1) return
    const current = this.data.carouselCurrent || 0
    const isVideo = items[current] && items[current].type === 'video'
    const delay = isVideo ? this.data.carouselVideoDuration || 5000 : this.data.carouselImageDuration || 5000
    this._carouselTimer = setTimeout(() => {
      const next = ((this.data.carouselCurrent || 0) + 1) % items.length
      this.setData({ carouselCurrent: next })
    }, delay)
  },

  /** 停止轮播定时器 */
  _stopCarouselTimer() {
    if (this._carouselTimer) {
      clearTimeout(this._carouselTimer)
      this._carouselTimer = null
    }
  },

  /** 停止当前视频播放 */
  _stopCarouselVideo(index) {
    if (index == null) return
    const ctx = wx.createVideoContext(`carousel-video-${index}`, this)
    if (ctx) {
      try {
        ctx.pause()
        ctx.seek(0)
      } catch (e) {}
    }
  },

  /**
   * 轮播视频自动播放门控（流量成本控制）：
   * - 会员功能未开启：所有人保持自动播放（现状）
   * - 会员功能开启：仅会员自动播放；非会员只显示封面，点击先门控再播（不预加载）
   * 结果缓存在 this._carouselAutoplayAllowed，onLoad/onShow 异步刷新
   */
  _updateCarouselAutoplayGate() {
    Promise.all([isMembershipEnabled(), getMemberPolicy()])
      .then(([enabled, policy]) => {
        // 会员关 / Pro：可自动播；非会员需策略允许且未强制封面
        let allowed = !enabled || isProSync()
        if (enabled && !isProSync()) {
          allowed = !!policy.carouselAllowVideoForNonMember && !policy.forceNonMemberVideoPoster
        }
        if (this._carouselAutoplayAllowed !== allowed) {
          this._carouselAutoplayAllowed = allowed
          this._activateCarouselVideos(this.data.carouselCurrent || 0)
        }
      })
      .catch(() => {})
  },

  /**
   * 仅激活当前视频的 src，避免多路大视频同时缓冲导致黑屏与预取流量浪费。
   * 非激活项清空 src，封面继续展示 poster。
   * 非会员（门控开启时）不激活任何视频，点击封面走全屏按需播放。
   */
  _activateCarouselVideos(current) {
    const items = this.data.carouselItems || []
    if (!items.length) return
    const n = items.length
    const cur = Math.max(0, Math.min(Number(current) || 0, n - 1))
    const autoplayAllowed = this._isCarouselAutoplayAllowed()
    const want = new Set(autoplayAllowed ? [cur] : [])

    const updates = {}
    for (let i = 0; i < n; i++) {
      if (!items[i] || items[i].type !== 'video') continue
      const active = want.has(i)
      if (!!items[i].videoActive !== active) {
        updates[`carouselItems[${i}].videoActive`] = active
      }
      if (!active && items[i].videoStarted) {
        updates[`carouselItems[${i}].videoStarted`] = false
      }
    }

    const play = () => {
      // 等 video 绑定新 src 后再 play，减少空 src 调用
      setTimeout(() => this._playCurrentVideoIfNeeded(), 80)
    }
    if (Object.keys(updates).length) {
      this.setData(updates, play)
    } else {
      play()
    }
  },

  /** 如果当前项是视频，静音自动播放 */
  _playCurrentVideoIfNeeded() {
    if (!this._isCarouselAutoplayAllowed()) return
    const items = this.data.carouselItems
    const current = this.data.carouselCurrent || 0
    if (!items || !items[current] || items[current].type !== 'video') return
    if (!items[current].videoActive) return
    const ctx = wx.createVideoContext(`carousel-video-${current}`, this)
    if (ctx) {
      try {
        ctx.play()
      } catch (e) {}
    }
  },

  /** swiper 切换回调 */
  onCarouselChange(e) {
    const current = e.detail.current
    const prev = this.data.carouselCurrent
    const items = this.data.carouselItems
    if (items && items[prev] && items[prev].type === 'video') {
      this._stopCarouselVideo(prev)
    }
    this.setData({ carouselCurrent: current })
    this._activateCarouselVideos(current)
    this._startCarouselTimer()
  },

  /** 真正出帧后再撤封面（play 事件过早，会露出原生黑底） */
  onCarouselVideoTimeUpdate(e) {
    const index = Number(e.currentTarget.dataset.index)
    const items = this.data.carouselItems
    if (isNaN(index) || !items || !items[index] || items[index].videoStarted) return
    const t = Number(e.detail && e.detail.currentTime) || 0
    if (t < 0.08) return
    this.setData({ [`carouselItems[${index}].videoStarted`]: true })
  },

  /** 视频加载失败（死链/格式不支持）→ 从轮播中移除，避免永久黑屏 */
  onCarouselVideoError(e) {
    // 预览版失败时不再回退原片：原片可达数十 MB，一次回退就会打穿流量预算；
    // 直接走图片错误路径，只保留 poster 封面
    this.onCarouselImageError(e)
  },

  /** 点击视频描述文字 → 跳转事件详情 */
  onCarouselCaptionTap(e) {
    const eventId = (e.currentTarget.dataset || {}).eventid
    if (!eventId) return
    this._stopCarouselTimer()
    navigateTo(ROUTES.EVENT_DETAIL, { id: eventId })
  },

  /** 点击视频 → 非会员先门控；通过后全屏播放（不预加载，按需缓存） */
  async onCarouselVideoTap(e) {
    const dataset = e.currentTarget.dataset || {}
    const index = dataset.index
    const item = (this.data.carouselItems || [])[index]
    if (!item || item.type !== 'video') return

    this._stopCarouselTimer()
    this._stopCarouselVideo(index)

    const playbackOk = await isPlaybackAllowed().catch(() => false)
    if (!playbackOk) {
      this._startCarouselTimer()
      return
    }

    const eventId = item.eventId
    const raw =
      item.playSrc || (this._carouselLazyPlayUrls && this._carouselLazyPlayUrls[index]) || item.src || dataset.url

    // 非会员且强制封面：点击触发门控，通过前不拉流；一次广告只解锁当前这条视频
    if (!canPrefetchVideoSync()) {
      const allowed = await gateCheck('starship_event_list_full', '星舰事件更新 · 视频播放', {
        adUnlockId: eventVideoAdUnlockId(eventId, 0, raw)
      })
      if (!allowed) {
        this._startCarouselTimer()
        return
      }
    }

    if (eventId) {
      navigateTo(ROUTES.EVENT_DETAIL, { id: eventId, autoPlayVideo: 0 })
      return
    }

    if (!raw) {
      this._startCarouselTimer()
      return
    }
    // 统一走自研播放页：长按菜单在页内做会员门控（原生 previewMedia 的 showmenu 无法按会员身份门控）
    // raw 可能是本地缓存路径（会员预热），复制链接需用远端地址
    const remote = /^https?:\/\//i.test(raw)
      ? raw
      : (this._carouselLazyPlayUrls && this._carouselLazyPlayUrls[index]) || ''
    const playRemote = remote || raw
    await playEventVideo({
      url: playRemote,
      playUrl: getCachedVideo(playRemote),
      thumb: item.poster || '',
      canSave: canUsePaidCloudSync(),
      onSaveHint: () => {}
    })
    this._startCarouselTimer()
  },

  onCarouselImageLoad() {},

  onCarouselImageError(e) {
    if (this.data.carouselLoadFailed) return

    const index = Number(e.currentTarget.dataset.index)
    const items = [...this.data.carouselItems]

    // 移除加载失败的项
    if (index >= 0 && index < items.length) {
      items.splice(index, 1)

      if (items.length === 0) {
        this._stopCarouselTimer()
        this.setData({
          carouselItems: [],
          carouselImages: [],
          carouselLoadFailed: true
        })
        return
      }

      // 移除后当前索引可能越界：收敛回首项，并重启定时器/视频播放，避免停在空白帧
      const patch = {
        carouselItems: items,
        carouselImages: items.map((i) => i.src)
      }
      if ((this.data.carouselCurrent || 0) >= items.length) {
        patch.carouselCurrent = 0
      }
      this.setData(patch, () => {
        this._activateCarouselVideos(this.data.carouselCurrent || 0)
        this._startCarouselTimer()
      })
    }
  },

  /**
   * 预览轮播图（点击直接预览）/ 视频由 onCarouselVideoTap 处理
   */
  previewCarouselImage(e) {
    const current = e.currentTarget.dataset.url
    // 只预览图片项
    const imageUrls = (this.data.carouselItems || []).filter((i) => i.type === 'image').map((i) => i.src)
    if (!imageUrls.length) return

    wx.previewImage({
      current: current,
      urls: imageUrls,
      success: () => {},
      fail: (err) => {
        wx.showToast({
          title: '预览失败',
          icon: 'none'
        })
      }
    })
  },
}

module.exports = {
  methods,
  /** 把全部方法挂到页面实例上（委托加载后调用） */
  attachTo(page) {
    Object.keys(methods).forEach((k) => {
      page[k] = methods[k].bind(page)
    })
    page.__carouselAttached = true
  }
}
