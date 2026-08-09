/**
 * 现场大屏模式（小程序原生版）
 *
 * 与 admin-web/public/watch-screen.html 同源逻辑：
 *   - 阶段编排：checkin（签到）→ teach（讲解）→ final（冲刺）→ launched（升空）
 *   - 科普卡上滑自动循环：签到期 20s / 讲解期 15s；可暂停；轻触翻页
 *   - 左侧展示本场火箭配置图（getRocketImage）
 *   - 云资源友好自适应轮询：距发射越近越快，闲时大幅放慢
 * 商家拿平板/手机打开即用（默认竖屏 + 常亮，可一键切横屏），不依赖浏览器与静态托管网址。
 */

const watchParty = require('./utils/api.js')
const { getRocketImage } = require('../../utils/util.js')
const rocketArtUtil = require('../../utils/rocket-config-art.js')
const { ROUTES, navigateTo } = require('../../utils/routes.js')
const { gateCheck, canUsePaidCloudSync } = require('../../utils/membership.js')
const { openRocketModelDetail } = require('../../utils/booster-nav.js')
const { getCompletedMissions, getUpcomingMissions } = require('../../utils/api-launch-list.js')
const { isFeatureEnabled } = require('../../utils/feature-flags.js')
const { guardWatchPartyPage } = require('../../utils/watch-party-feature.js')
const themeUtil = require('../../utils/theme.js')

const PHASE_LABELS = {
  checkin: '签到入场 · 扫码抽奖',
  teach: '科普讲解中',
  final: '发射倒计时',
  launched: '已点火升空'
}

/** 冲刺期固定展示的观礼提示（停自动轮播） */
const FINAL_CARD = {
  title: '即将点火',
  body: '请留在安全区域，收好随身物品。点火后约 30 秒轰鸣声才会到达楼顶，属正常现象，请安抚小朋友不要惊慌。'
}

/** 升空后科普卡提示 */
const LAUNCHED_CARD = {
  title: '点火升空',
  body: '火箭已进入发射窗口。请注视天空方向；若有本型号近期集锦将在左侧自动播放，方便对照讲解。'
}

/** 正文超过该字数时启用卡内上滑循环，便于长科普读完 */
const SCI_TEXT_SCROLL_MIN = 48

function pad2(n) { return n < 10 ? '0' + n : '' + n }

function buildExplainButtons(s) {
  if (!s) return []
  const buttons = []
  const hasMission = !!(s.missionId || s.rocketName || s.agencyName || s.agencyId || s.rocketConfigId)
  // 有关联任务/火箭名即展示讲解入口（缺 id 时点击前客户端补全）
  if (hasMission) {
    buttons.push({
      key: 'agency',
      label: '发射商',
      value: s.agencyName || s.agencyAbbrev || '详情'
    })
    buttons.push({
      key: 'rocket',
      label: '型号',
      value: s.rocketName || '详情'
    })
  }
  buttons.push({ key: 'stats', label: '全球统计', value: '' })
  buttons.push({
    key: 'pad',
    label: '发射场',
    value: s.padLocationName || (hasMission ? '地图' : '')
  })
  return buttons
}

/** 科普卡解析：支持「标题|正文」（半角/全角竖线），纯文本行向后兼容 */
function parseSciCards(points) {
  const cards = []
  const list = Array.isArray(points) ? points : []
  for (let i = 0; i < list.length; i++) {
    const line = String(list[i] || '').trim()
    if (!line) continue
    const sep = line.indexOf('|') >= 0 ? '|' : (line.indexOf('｜') >= 0 ? '｜' : '')
    if (sep) {
      const at = line.indexOf(sep)
      cards.push({ title: line.slice(0, at).trim(), body: line.slice(at + 1).trim() })
    } else {
      cards.push({ title: '', body: line })
    }
  }
  return cards
}

/** 轮播序列 = 科普文字卡 + 商家上传的发射配置图（图片卡整幅展示） */
function buildSciCards(points, images) {
  const cards = parseSciCards(points)
  const imgs = Array.isArray(images) ? images : []
  for (let i = 0; i < imgs.length; i++) {
    if (imgs[i]) cards.push({ image: imgs[i] })
  }
  return cards
}

Page({
  data: {
    loading: true,
    error: '',
    title: '',
    subtitle: '',
    address: '',
    rocketImage: '',
    explainButtons: [],
    replayVideoUrl: '',
    replayPoster: '',
    replayTitle: '',
    replayMuted: true,
    replayStatus: '', // '' | loading | empty | off | ready
    phaseLabel: '',
    phase: 'checkin',
    cd: null,            // { d, h, m, s }
    cdDone: false,
    sciTitle: '',
    sciBody: '',
    sciImage: '',
    sciProgress: '',
    sciSlide: 'in',      // out | in（上滑切换）
    sciTextScroll: false,
    sciPaused: false,
    vote: null,          // { question, gePct, geLabel, bugeLabel }
    prizeDrawEnabled: false,
    successUnlocked: false,
    statLine: '',
    clock: '',
    qrUrl: '',
    landscapeMode: false,
    themeClass: '',
    themeLight: false,
    pageBgColor: '#05070f',
    /** 内容区从微信胶囊下沿起算（px） */
    contentPadTop: 48,
    exitTop: 8,
    orientTop: 8,
    orientRight: 12
  },

  onLoad(options) {
    this._options = options || {}
    this._session = null
    this._sciCards = []
    this._sciIndex = 0
    this._phase = ''
    this._sciPaused = false
    this._sciTimer = null
    this._sciAnimTimer = null
    this._voteTimer = null
    this._sessionTimer = null
    this._tickTimer = null
    this._syncTheme()
    this._syncCapsuleLayout()
    this._syncOrientationFlag()
    guardWatchPartyPage(this).then((ok) => {
      if (!ok || this._unloaded) return
      this.refreshSession(true)
    })
  },

  onShow() {
    try { wx.setKeepScreenOn({ keepScreenOn: true, fail: () => {} }) } catch (e) {}
    this._syncTheme()
    this._syncCapsuleLayout()
    this._syncOrientationFlag()
    // 默认竖屏；需要投屏横屏时点右上角「横屏」手动切换
    if (!this._orientBootstrapped) {
      this._orientBootstrapped = true
      this._applyOrientation('portrait', { silent: true })
    }
    rocketArtUtil.applyRocketConfigArtIfNeeded(this)
  },

  refreshRocketConfigArt() {
    if (this._session) this.renderSession(this._session)
  },

  onHide() {
    try { wx.setKeepScreenOn({ keepScreenOn: false, fail: () => {} }) } catch (e) {}
  },

  onUnload() {
    this._unloaded = true
    if (this._sciTimer) clearTimeout(this._sciTimer)
    if (this._sciAnimTimer) clearTimeout(this._sciAnimTimer)
    if (this._voteTimer) clearTimeout(this._voteTimer)
    if (this._sessionTimer) clearTimeout(this._sessionTimer)
    if (this._tickTimer) clearInterval(this._tickTimer)
    try { wx.setKeepScreenOn({ keepScreenOn: false, fail: () => {} }) } catch (e) {}
    // 离开大屏后恢复竖屏，避免影响后续页面
    try {
      if (typeof wx.setPageOrientation === 'function') {
        wx.setPageOrientation({ orientation: 'portrait', fail: () => {} })
      }
    } catch (e) {}
  },

  onResize() {
    this._syncCapsuleLayout()
    this._syncOrientationFlag()
  },

  /** 页面整体落在微信胶囊下沿之下；横屏钮贴胶囊左侧 */
  _syncCapsuleLayout() {
    try {
      const menu = typeof wx.getMenuButtonBoundingClientRect === 'function'
        ? wx.getMenuButtonBoundingClientRect()
        : null
      const info = (typeof wx.getWindowInfo === 'function')
        ? wx.getWindowInfo()
        : wx.getSystemInfoSync()
      const statusBar = Number(info.statusBarHeight || 20)
      const gap = 8
      if (menu && menu.bottom > 0) {
        const contentPadTop = Math.ceil(menu.bottom + gap)
        const exitTop = Math.max(4, Math.round(menu.top))
        const orientTop = Math.max(4, Math.round(menu.top + (menu.height - 28) / 2))
        const winW = Number(info.windowWidth || 375)
        const orientRight = Math.max(12, Math.ceil(winW - menu.left + gap))
        this._safeSetData({ contentPadTop, exitTop, orientTop, orientRight })
        return
      }
      this._safeSetData({
        contentPadTop: statusBar + 48,
        exitTop: statusBar + 4,
        orientTop: statusBar + 8,
        orientRight: 12
      })
    } catch (err) {}
  },

  /** 根据窗口宽高同步横屏状态（物理旋转 / API 切换后） */
  _syncOrientationFlag() {
    try {
      const info = (typeof wx.getWindowInfo === 'function')
        ? wx.getWindowInfo()
        : wx.getSystemInfoSync()
      const w = Number(info.windowWidth || info.screenWidth || 0)
      const h = Number(info.windowHeight || info.screenHeight || 0)
      if (w > 0 && h > 0) {
        this._safeSetData({ landscapeMode: w > h })
      }
    } catch (e) {}
  },

  /**
   * 切换页面方向。需 pageOrientation=auto；部分模拟器/旧基础库可能失败。
   * @param {'landscape'|'portrait'} orientation
   * @param {{ silent?: boolean }} [opts]
   */
  _applyOrientation(orientation, opts) {
    const silent = !!(opts && opts.silent)
    if (typeof wx.setPageOrientation !== 'function') {
      if (!silent) {
        wx.showToast({ title: '当前基础库不支持横屏切换，请旋转设备', icon: 'none' })
      }
      return
    }
    wx.setPageOrientation({
      orientation,
      success: () => {
        this._safeSetData({ landscapeMode: orientation === 'landscape' })
      },
      fail: () => {
        this._syncOrientationFlag()
        if (!silent) {
          wx.showToast({ title: '切换失败，请手动旋转设备或检查系统旋转锁', icon: 'none' })
        }
      }
    })
  },
  _safeSetData(patch) {
    if (this._unloaded) return
    this.setData(patch)
  },

  // ── 场次数据 ──

  refreshSession(first) {
    const opts = this._options
    const params = opts.sessionId
      ? { sessionId: opts.sessionId }
      : (opts.code ? { code: opts.code } : {})
    watchParty.fetchScreenData(params).then((s) => {
      if (this._unloaded || !s) return
      this.renderSession(s)
      if (first) {
        this._tickTimer = setInterval(() => this.tick(), 1000)
        this.tick()
        this.scheduleVote(true)
      }
      this.scheduleSessionPoll()
    }).catch((err) => {
      if (this._unloaded) return
      if (first || !this._session) {
        this._safeSetData({
          loading: false,
          error: (err && err.message) || '大屏数据加载失败，请检查网络后重试'
        })
      }
      // 非首次失败保留旧画面静默重试，现场弱网不闪断
      this.scheduleSessionPoll()
    })
  },

  renderSession(s) {
    this._session = s
    const stat = []
    if (s.reserveCount) stat.push('已预约 ' + s.reserveCount + ' 组')
    if (s.drawCount) stat.push('现场已抽奖 ' + s.drawCount + ' 次')

    const nextCards = buildSciCards(s.sciencePoints, s.scienceImages)
    const changed = JSON.stringify(nextCards) !== JSON.stringify(this._sciCards)
    this._sciCards = nextCards

    // 优先用锁定的 rocketImageName（手动改火箭名不换图）
    const rocketName = String(s.rocketImageName || '').trim() || (s.rocketName ? String(s.rocketName).trim() : '')
    const rocketImage = rocketName ? (getRocketImage(rocketName) || '') : ''
    const missionText = s.missionDisplayName || s.missionName || ''

    this._safeSetData({
      loading: false,
      error: '',
      title: s.title || '火箭观礼',
      subtitle: (s.rocketName || '') + (missionText ? ' · ' + missionText : ''),
      address: s.address || '',
      rocketImage,
      explainButtons: buildExplainButtons(s),
      statLine: stat.join(' · '),
      qrUrl: s.qrCodeUrl || '',
      prizeDrawEnabled: !!s.prizeDrawEnabled,
      successUnlocked: !!(s.successUnlocked || s.successUnlockedAt)
    })

    // 保留讲解跳转所需 id，供点击处理使用
    const nextMissionId = s.missionId || ''
    if (String(this._explainMissionId || '') !== String(nextMissionId)) {
      this._explainPromise = null
      this._explainMissionId = nextMissionId
    }
    this._explain = {
      agencyId: s.agencyId || '',
      agencyName: s.agencyName || '',
      agencyAbbrev: s.agencyAbbrev || '',
      rocketConfigId: s.rocketConfigId || '',
      rocketName: s.rocketName || '',
      padLocationId: s.padLocationId || '',
      padLocationName: s.padLocationName || ''
    }

    // 场次未落库讲解元数据时，按 missionId 客户端补全（不依赖云函数是否已部署回填）
    this._ensureExplainMeta()

    if (changed && this._phase !== 'final' && this._phase !== 'launched') {
      this._sciIndex = 0
      this.showSciCard(0, false)
      this.scheduleSci()
    }
  },

  /** 用 upcoming/completed/详情 补齐发射商、型号构型、发射场 locationId */
  _ensureExplainMeta() {
    const info = this._explain || {}
    if (info.agencyId && info.rocketConfigId && info.padLocationId) {
      return Promise.resolve(info)
    }
    const missionId = this._session && this._session.missionId
    if (!missionId) return Promise.resolve(info)
    if (this._explainPromise) return this._explainPromise

    const applyMission = (m) => {
      if (!m || this._unloaded) return this._explain || info
      const next = {
        agencyId: String(m.launchAgencyId != null ? m.launchAgencyId : (info.agencyId || '')),
        agencyName: String(m.launchAgency || m.agencyName || info.agencyName || '').trim(),
        agencyAbbrev: String(m.launchAgencyAbbrev || m.agencyAbbrev || info.agencyAbbrev || '').trim(),
        rocketConfigId: String(
          m.rocketConfigId != null ? m.rocketConfigId : (info.rocketConfigId || '')
        ),
        rocketName: String(m.rocketName || info.rocketName || '').trim(),
        padLocationId: String(
          m.padLocationId != null
            ? m.padLocationId
            : ((m.padDetail && m.padDetail.locationId) || info.padLocationId || '')
        ),
        padLocationName: String(
          m.padLocationName
          || (m.padDetail && (m.padDetail.locationName || m.padDetail.padName))
          || m.launchSite
          || info.padLocationName
          || ''
        ).trim()
      }
      this._explain = next
      if (this._session) {
        this._session.agencyId = next.agencyId
        this._session.agencyName = next.agencyName
        this._session.agencyAbbrev = next.agencyAbbrev
        this._session.rocketConfigId = next.rocketConfigId
        this._session.padLocationId = next.padLocationId
        this._session.padLocationName = next.padLocationName
        if (next.rocketName && !this._session.rocketName) this._session.rocketName = next.rocketName
      }
      this._safeSetData({
        explainButtons: buildExplainButtons(Object.assign({}, this._session || {}, next)),
        subtitle: (next.rocketName || (this._session && this._session.rocketName) || '')
          + ((this._session && this._session.missionName) ? ' · ' + this._session.missionName : '')
      })
      return next
    }

    const findInList = (list) => (list || []).find((x) => x && String(x.id) === String(missionId))

    this._explainPromise = getUpcomingMissions(50, 0).then((res) => {
      const hit = findInList(res && res.list)
      if (hit) return hit
      return getCompletedMissions(60, 0).then((r) => findInList(r && r.list) || null)
    }).then((m) => {
      this._explainPromise = null
      return applyMission(m)
    }).catch(() => {
      this._explainPromise = null
      return this._explain || info
    })

    return this._explainPromise
  },

  // ── 倒计时 + 阶段编排 ──

  _launchDiff() {
    const s = this._session
    if (!s || !s.launchTime) return null
    const t = new Date(s.launchTime).getTime()
    if (!t || isNaN(t)) return null
    return t - Date.now()
  },

  _computePhase() {
    const diff = this._launchDiff()
    if (diff === null) return 'checkin'
    if (diff <= 0) return 'launched'
    if (diff <= 10 * 60000) return 'final'
    if (diff <= 60 * 60000) return 'teach'
    return 'checkin'
  },

  tick() {
    if (this._unloaded) return
    const now = new Date()
    const patch = {
      clock: pad2(now.getHours()) + ':' + pad2(now.getMinutes()) + ':' + pad2(now.getSeconds())
    }
    const diff = this._launchDiff()
    if (diff !== null) {
      if (diff <= 0) {
        patch.cd = null
        patch.cdDone = true
      } else {
        patch.cd = {
          d: Math.floor(diff / 86400000),
          h: pad2(Math.floor(diff % 86400000 / 3600000)),
          m: pad2(Math.floor(diff % 3600000 / 60000)),
          s: pad2(Math.floor(diff % 60000 / 1000))
        }
        patch.cdDone = false
      }
    }
    this._safeSetData(patch)
    this.applyPhase(this._computePhase())
  },

  applyPhase(next) {
    if (next === this._phase) return
    this._phase = next
    this._safeSetData({ phase: next, phaseLabel: PHASE_LABELS[next] || '' })
    if (next === 'final') {
      if (this._sciTimer) { clearTimeout(this._sciTimer); this._sciTimer = null }
      this._safeSetData({
        sciTitle: FINAL_CARD.title,
        sciBody: FINAL_CARD.body,
        sciImage: '',
        sciProgress: '',
        sciSlide: 'in',
        sciTextScroll: FINAL_CARD.body.length >= SCI_TEXT_SCROLL_MIN,
        sciPaused: false
      })
      this._sciPaused = false
    } else if (next === 'launched') {
      if (this._sciTimer) { clearTimeout(this._sciTimer); this._sciTimer = null }
      this._safeSetData({
        sciTitle: LAUNCHED_CARD.title,
        sciBody: LAUNCHED_CARD.body,
        sciImage: '',
        sciProgress: '',
        sciSlide: 'in',
        sciTextScroll: false,
        sciPaused: false
      })
      this._sciPaused = false
      this.startRocketReplay()
    } else {
      this.showSciCard(this._sciIndex, false)
      this.scheduleSci()
    }
    // 阶段切换按新节奏重排轮询
    this.scheduleVote(true)
    this.scheduleSessionPoll()
  },

  /**
   * 倒计时归零后：按本场火箭型号匹配「已完成任务」里最近一场，拉取压缩集锦并自动播放。
   * 过审开关 enableMissionReplay（failClosed）；无片源则展示空态提示。
   */
  startRocketReplay() {
    if (this._replayStarted || this._unloaded) return
    this._replayStarted = true
    this._safeSetData({ replayStatus: 'loading', replayVideoUrl: '', replayPoster: '', replayTitle: '' })

    // 先补齐讲解元数据，避免旧场次仅有 missionId 时过早判空且永不重试
    Promise.resolve(this._ensureExplainMeta()).catch(() => null).then(() => {
      if (this._unloaded) return
      this._runRocketReplayFetch()
    })
  },

  _runRocketReplayFetch() {
    const cfgId = this._explain && this._explain.rocketConfigId
      ? String(this._explain.rocketConfigId)
      : ''
    const rocketName = (
      (this._explain && this._explain.rocketName)
      || (this._session && this._session.rocketName)
      || ''
    ).trim()

    const fetchReplay = (launchId) => wx.cloud.callFunction({
      name: 'apiProxy',
      data: { action: 'missionReplay', launchId: String(launchId) }
    }).then((res) => {
      const r = res && res.result
      return (r && r.success && r.data) ? r.data : null
    }).catch(() => null)

    const pickClip = (data) => {
      if (!data) return null
      const clips = Array.isArray(data.clips) ? data.clips : []
      for (let i = 0; i < clips.length; i++) {
        if (clips[i] && clips[i].videoUrl) return clips[i]
      }
      if (data.videoUrl) {
        return { videoUrl: data.videoUrl, thumbnailUrl: '', title: '发射回放' }
      }
      return null
    }

    const matchMission = (m) => {
      if (!m) return false
      if (cfgId && m.rocketConfigId != null && String(m.rocketConfigId) === cfgId) return true
      if (!rocketName || !m.rocketName) return false
      const a = String(m.rocketName).toLowerCase()
      const b = rocketName.toLowerCase()
      return a === b || a.indexOf(b) >= 0 || b.indexOf(a) >= 0
    }

    isFeatureEnabled('enableMissionReplay', { failClosed: true }).catch(() => false).then((on) => {
      if (this._unloaded) return
      if (!on) {
        this._safeSetData({ replayStatus: 'off' })
        return
      }
      if (!cfgId && !rocketName) {
        this._safeSetData({ replayStatus: 'empty' })
        return
      }
      return getCompletedMissions(40, 0).then((res) => {
        if (this._unloaded) return
        const list = ((res && res.list) || []).filter(matchMission)
        const tryNext = (idx) => {
          if (this._unloaded) return
          if (idx >= list.length || idx >= 6) {
            this._safeSetData({ replayStatus: 'empty' })
            return
          }
          const m = list[idx]
          fetchReplay(m.id).then((data) => {
            if (this._unloaded) return
            const clip = pickClip(data)
            if (!clip) {
              tryNext(idx + 1)
              return
            }
            // 非会员策略：禁止预挂可播地址；仅封面 + 点击后门控再赋 src
            const canPlay = !!canUsePaidCloudSync()
            if (!canPlay) {
              this._replayPendingUrl = clip.videoUrl
              this._safeSetData({
                replayStatus: 'gated',
                replayVideoUrl: '',
                replayPoster: clip.thumbnailUrl || '',
                replayTitle: clip.title || m.missionName || m.name || '发射集锦',
                replayMuted: true
              })
              return
            }
            this._replayPendingUrl = ''
            this._safeSetData({
              replayStatus: 'ready',
              replayVideoUrl: clip.videoUrl,
              replayPoster: clip.thumbnailUrl || '',
              replayTitle: clip.title || m.missionName || m.name || '发射集锦',
              replayMuted: true
            })
          })
        }
        tryNext(0)
      }).catch(() => {
        if (this._unloaded) return
        this._safeSetData({ replayStatus: 'empty' })
      })
    })
  },

  async onReplayUnmute() {
    if (this._unloaded) return
    // 非会员：点按封面后走门控，通过再赋可播地址
    if (this.data.replayStatus === 'gated' && this._replayPendingUrl) {
      const allowed = await gateCheck('mission_replay', '发射回放集锦')
      if (this._unloaded) return
      if (!allowed) return
      this._safeSetData({
        replayStatus: 'ready',
        replayVideoUrl: this._replayPendingUrl,
        replayMuted: false
      })
      this._replayPendingUrl = ''
      return
    }
    if (this.data.replayMuted) this._safeSetData({ replayMuted: false })
  },

  // ── 科普卡轮播 ──

  showSciCard(idx, animate) {
    const cards = this._sciCards
    if (!cards.length) {
      this._safeSetData({
        sciTitle: '',
        sciBody: '欢迎来到火箭观礼现场',
        sciImage: '',
        sciProgress: '',
        sciSlide: 'in',
        sciTextScroll: false
      })
      return
    }
    const card = cards[idx % cards.length]
    const apply = () => {
      const body = card.image ? '' : (card.body || '')
      this._safeSetData({
        sciTitle: card.image ? '' : (card.title || ''),
        sciBody: body,
        sciImage: card.image || '',
        sciProgress: (idx % cards.length + 1) + ' / ' + cards.length,
        sciSlide: 'in',
        sciTextScroll: !card.image && body.length >= SCI_TEXT_SCROLL_MIN
      })
    }
    if (this._sciAnimTimer) {
      clearTimeout(this._sciAnimTimer)
      this._sciAnimTimer = null
    }
    if (animate) {
      this._safeSetData({ sciSlide: 'out' })
      this._sciAnimTimer = setTimeout(() => {
        this._sciAnimTimer = null
        if (this._unloaded) return
        apply()
      }, 320)
    } else {
      apply()
    }
  },

  /** 分阶段轮播间隔：签到期 20s，讲解期 15s，冲刺/升空期暂停（主持人轻触手动切换） */
  _sciIntervalMs() {
    if (this._phase === 'teach') return 15000
    if (this._phase === 'checkin') return 20000
    return 0
  },

  scheduleSci() {
    if (this._sciTimer) { clearTimeout(this._sciTimer); this._sciTimer = null }
    if (this._sciPaused || this._phase === 'final' || this._phase === 'launched') return
    const ms = this._sciIntervalMs()
    if (!ms || this._sciCards.length <= 1) return
    this._sciTimer = setTimeout(() => {
      if (this._unloaded || this._sciPaused) return
      this._sciIndex++
      this.showSciCard(this._sciIndex, true)
      this.scheduleSci()
    }, ms)
  },

  /** 主持人手动切换：轻触科普卡 → 下一条（暂停态下仍可翻页） */
  onSciTap() {
    if (!this._sciCards.length || this._phase === 'final' || this._phase === 'launched') return
    this._sciIndex++
    this.showSciCard(this._sciIndex, true)
    this.scheduleSci()
  },

  onToggleSciPause() {
    if (this._phase === 'final' || this._phase === 'launched') return
    this._sciPaused = !this._sciPaused
    this._safeSetData({ sciPaused: this._sciPaused })
    if (this._sciPaused) {
      if (this._sciTimer) { clearTimeout(this._sciTimer); this._sciTimer = null }
    } else {
      this.scheduleSci()
    }
  },

  // ── 现场竞猜 ──

  refreshVote() {
    const s = this._session
    if (!s || !s.missionId) return
    watchParty.fetchVoteStats(s.missionId).then((v) => {
      if (this._unloaded || !v) return
      const ge = Number(v.geCount || 0)
      const buge = Number(v.buGeCount || v.bugeCount || 0)
      const total = ge + buge
      if (total <= 0) return
      const gePct = Math.round(ge / total * 100)
      this._safeSetData({
        vote: {
          question: '现场竞猜 · ' + (v.customQuestion || '会准时发射吗？') + '（' + total + ' 人参与）',
          gePct,
          geLabel: (v.geLabel || '鸽') + ' ' + ge,
          bugeLabel: (v.bugeLabel || '不鸽') + ' ' + buge
        }
      })
    }).catch(() => {})
  },

  // ── 云资源友好自适应轮询（与网页大屏同节奏） ──

  _votePollMs() {
    const diff = this._launchDiff()
    if (diff === null) return 600000
    if (diff <= 10 * 60000 && diff > -3600000) return 15000
    if (diff > 0 && diff <= 6 * 3600000) return 60000
    return 300000
  },

  _sessionPollMs() {
    const diff = this._launchDiff()
    if (diff === null) return 600000
    if (diff <= 10 * 60000 && diff > -3600000) return 60000
    if (diff > 0 && diff <= 6 * 3600000) return 120000
    return 600000
  },

  scheduleVote(immediate) {
    if (this._voteTimer) { clearTimeout(this._voteTimer); this._voteTimer = null }
    if (immediate) this.refreshVote()
    this._voteTimer = setTimeout(() => {
      if (this._unloaded) return
      this.scheduleVote(true)
    }, this._votePollMs())
  },

  scheduleSessionPoll() {
    if (this._sessionTimer) { clearTimeout(this._sessionTimer); this._sessionTimer = null }
    this._sessionTimer = setTimeout(() => {
      if (this._unloaded) return
      this.refreshSession(false)
    }, this._sessionPollMs())
  },

  // ── 交互 ──

  /** 现场讲解：跳转发射商 / 型号 / 全球统计 / 本场发射场地图（与站内详情同源门控） */
  async onExplainTap(e) {
    const key = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.key
    if (!key) return
    try { wx.vibrateShort({ type: 'light', fail: () => {} }) } catch (err) {}

    // 点击时再补一次元数据，避免场次文档尚未带回填
    if (key !== 'stats') {
      try { await this._ensureExplainMeta() } catch (err) {}
      if (this._unloaded) return
    }
    const info = this._explain || {}

    if (key === 'agency') {
      if (!info.agencyId && !info.agencyName && !info.agencyAbbrev) {
        wx.showToast({ title: '暂无发射商信息，请确认场次已关联任务', icon: 'none' })
        return
      }
      const allowed = await gateCheck('agency_encyclopedia', '全球发射商图鉴')
      if (this._unloaded || !allowed) return
      const params = {}
      if (info.agencyId) params.id = info.agencyId
      if (info.agencyName) params.name = info.agencyName
      if (info.agencyAbbrev) params.abbrev = info.agencyAbbrev
      navigateTo(ROUTES.AGENCY_DETAIL, params)
      return
    }

    if (key === 'rocket') {
      if (!info.rocketConfigId) {
        wx.showToast({ title: '暂无型号档案，请确认场次已关联发射任务', icon: 'none' })
        return
      }
      await openRocketModelDetail(info.rocketConfigId)
      return
    }

    if (key === 'stats') {
      const allowed = await gateCheck('global_launch_stats', '全球发射统计')
      if (this._unloaded || !allowed) return
      navigateTo(ROUTES.GLOBAL_LAUNCH_STATS)
      return
    }

    if (key === 'pad') {
      if (!info.padLocationId) {
        wx.showToast({ title: '暂无本场发射场坐标，请确认场次已关联任务', icon: 'none' })
        return
      }
      const allowed = await gateCheck('launch_site_encyclopedia', '全球发射场分布')
      if (this._unloaded || !allowed) return
      // 跳本场对应发射场详情地图（非全球总览）
      navigateTo(ROUTES.LAUNCH_SITE_DETAIL, { id: info.padLocationId })
      return
    }
  },

  onRetry() {
    this.setData({ loading: true, error: '' })
    this.refreshSession(!this._tickTimer)
  },

  onExit() {
    const pages = getCurrentPages()
    if (pages.length > 1) {
      wx.navigateBack()
    } else {
      wx.redirectTo({ url: '/subpackages/watch-party/watch-party' })
    }
  },

  /** 同步全局主题到本页（投屏页可明暗切换，便于日间观礼） */
  _syncTheme() {
    themeUtil.applyThemeToPage(this)
    themeUtil.syncWindowBackground()
  },

  /** 右上角：深色 / 浅色一键切换（写回全局主题） */
  onToggleTheme() {
    try { wx.vibrateShort({ type: 'light', fail: () => {} }) } catch (e) {}
    const next = themeUtil.isLightSync() ? themeUtil.THEME_DARK : themeUtil.THEME_LIGHT
    themeUtil.setThemeMode(next)
  },

  /** 右上角：横屏 / 竖屏一键切换 */
  onToggleOrientation() {
    try { wx.vibrateShort({ type: 'light', fail: () => {} }) } catch (e) {}
    const next = this.data.landscapeMode ? 'portrait' : 'landscape'
    this._applyOrientation(next, { silent: false })
  }
})
