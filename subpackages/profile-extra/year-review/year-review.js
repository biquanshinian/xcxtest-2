const pageBase = require('../../../utils/page-base.js')
const { getMembershipState, isPro, MEMBER_ICONS } = require('../../../utils/membership.js')
const { getCachedIcon, preloadIcons } = require('../../../utils/icon-cache.js')
const { isPlaybackAllowed } = require('../../../utils/feature-flags.js')

/** 背景视频远程地址（仅进入本页才下载/读缓存） */
const YEAR_REVIEW_BG_VIDEO_REMOTE =
  'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/%E8%83%8C%E6%99%AF%E8%A7%86%E9%A2%91/1778841707632_ddgop4.mp4'
/** Storage 记录本地缓存路径；URL 变更则重新拉取 */
const YEAR_REVIEW_BG_VIDEO_STORAGE_KEY = 'year_review_detail_bg_video_v1'

function num(n) {
  const x = Number(n)
  return isNaN(x) ? 0 : x
}

function clampPct(value, max) {
  if (max <= 0) return 0
  return Math.min(100, Math.round((num(value) / max) * 100))
}

/** ease-out cubic，数字滚动尾声更稳 */
function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3)
}

function buildPersonalViz(m) {
  const M = m || {}
  const checkin = num(M.checkinDaysInYear)
  const timeline = num(M.timelineEventCount)
  const quizA = num(M.quizTotalAnswered)
  const quizC = num(M.quizCorrect)
  const ai = num(M.aiChatYear)
  const ach = num(M.achievementsUnlockedInYear)
  return [
    {
      key: 'checkin',
      glyph: '◈',
      code: 'SIG',
      label: '轨道签到',
      sub: '可还原天数',
      value: checkin,
      display: String(checkin),
      suffix: '天',
      pct: clampPct(checkin, 366),
      accent: 'cyan'
    },
    {
      key: 'timeline',
      glyph: '⎔',
      code: 'TLN',
      label: '时间线',
      sub: '记录事件',
      value: timeline,
      display: String(timeline),
      suffix: '条',
      pct: clampPct(timeline, 240),
      accent: 'violet'
    },
    {
      key: 'ai',
      glyph: '◆',
      code: 'AI',
      label: '星问对话',
      sub: '年度往返',
      value: ai,
      display: String(ai),
      suffix: '次',
      pct: clampPct(ai, 360),
      accent: 'magenta'
    },
    {
      key: 'ach',
      glyph: '✦',
      code: 'ACH',
      label: '成就解锁',
      sub: '该年新增',
      value: ach,
      display: String(ach),
      suffix: '个',
      pct: clampPct(ach, 48),
      accent: 'amber'
    }
  ]
}

function quizViz(m) {
  const M = m || {}
  const answered = num(M.quizTotalAnswered)
  const correct = num(M.quizCorrect)
  const accuracy = answered > 0 ? Math.min(100, Math.round((correct / answered) * 100)) : 0
  return {
    answered,
    correct,
    accuracy,
    volumePct: clampPct(answered, 320)
  }
}

function buildPlatformViz(p) {
  if (!p) return []
  const rows = [
    {
      key: 'profiles',
      glyph: '◎',
      code: 'USR',
      label: '用户档案',
      sub: '全站快照',
      raw: p.totalUserProfiles,
      suffix: '',
      max: 8000,
      accent: 'cyan'
    },
    {
      key: 'global',
      glyph: '⊕',
      code: 'ORB',
      label: '全球发射',
      sub: '不完全统计',
      raw: p.globalLaunchesInYear,
      suffix: '次',
      max: 260,
      accent: 'violet'
    },
    {
      key: 'sx',
      glyph: '△',
      code: 'SX',
      label: 'SpaceX 发射',
      sub: '不完全统计',
      raw: p.spacexLaunchesInYear,
      suffix: '次',
      max: 200,
      accent: 'magenta'
    },
    {
      key: 'starship',
      glyph: '⊹',
      code: 'SNS',
      label: '星舰体系',
      sub: '缓存识别',
      raw: p.spacexStarshipMissionsInYear,
      suffix: '次',
      max: 48,
      accent: 'amber'
    },
    {
      key: 'news',
      glyph: '▤',
      code: 'NWS',
      label: '新闻资讯',
      sub: '已发布',
      raw: p.newsArticlesInYear,
      suffix: '篇',
      max: 600,
      accent: 'cyan'
    },
    {
      key: 'events',
      glyph: '▥',
      code: 'EVT',
      label: '事件流',
      sub: '已发布',
      raw: p.newsEventsInYear,
      suffix: '条',
      max: 400,
      accent: 'violet'
    },
    {
      key: 'tweets',
      glyph: '⌁',
      code: 'TX',
      label: '推文动态',
      sub: '已抓取',
      raw: p.tweetPostsInYear,
      suffix: '条',
      max: 400,
      accent: 'green'
    }
  ]
  return rows.map((row) => {
    const v = row.raw
    const has = v != null && !isNaN(Number(v))
    const n = has ? num(v) : null
    return {
      ...row,
      has,
      targetNum: has ? n : null,
      display: has ? String(n) : '—',
      pct: has ? clampPct(n, row.max) : 0
    }
  })
}

function boosterViz(p) {
  if (!p) return null
  const c = p.maxBoosterReuseCount
  const has = c != null && !isNaN(Number(c))
  return {
    has,
    count: has ? num(c) : null,
    serial: p.maxBoosterSerial || '—',
    model: p.maxBoosterRocketModel || '—',
    pct: has ? clampPct(c, 36) : 0
  }
}

Page({
  behaviors: [pageBase],
  _fallbackTab: '/pages/profile/profile',

  data: {
    loading: true,
    errorMessage: '',
    year: new Date().getFullYear(),
    displayTitle: '',
    displaySubtitle: '',
    metrics: {},
    summaryIntro: '',
    summaryOutro: '',
    platformStats: null,
    platform: null,
    navTitle: '太空年鉴',
    vizPersonal: [],
    vizQuiz: { answered: 0, correct: 0, accuracy: 0, volumePct: 0 },
    vizPlatform: [],
    vizBooster: null,
    entranceActive: false,
    profileId: '',
    memberIconUrl: '',
    memberBadgeText: 'FREE',
    /** 有值后才挂载 video，避免未进入详情就请求网络 */
    yearReviewBgVideoPlaySrc: ''
  },

  onLoad(options) {
    this.initUiShell()

    wx.showShareMenu({
      withShareTicket: true,
      menus: ['shareAppMessage', 'shareTimeline']
    })

    try {
      preloadIcons([MEMBER_ICONS.FREE, MEMBER_ICONS.PRO])
    } catch (e) {}

    const y = parseInt(options.year, 10)
    const year = !isNaN(y) && y >= 2000 && y <= 2100 ? y : new Date().getFullYear()
    this.setData({
      year,
      navTitle: `${year} 太空年鉴`
    })
    this._loadReport(year)
    this._loadMemberBadge()
  },

  /** 仅进入详情页后：恢复本地缓存或下载并 saveFile 持久化 */
  onReady() {
    this._prepareYearReviewBgVideo()
  },

  _playBgVideoIfReady() {
    if (!this.data.yearReviewBgVideoPlaySrc) return
    try {
      const ctx = wx.createVideoContext('yrBgVideo', this)
      if (ctx && typeof ctx.play === 'function') ctx.play()
    } catch (e) {}
  },

  _prepareYearReviewBgVideo() {
    if (this._yrBgVideoPrepareStarted) return
    this._yrBgVideoPrepareStarted = true
    isPlaybackAllowed()
      .catch(() => false)
      .then((allowed) => {
        if (!allowed) {
          this.setData({ yearReviewBgVideoPlaySrc: '' })
          return
        }
        this._prepareYearReviewBgVideoInner()
      })
  },

  _prepareYearReviewBgVideoInner() {
    const remote = YEAR_REVIEW_BG_VIDEO_REMOTE
    const fs = wx.getFileSystemManager()

    function applyPlaySrc(path) {
      if (!path) return
      this.setData({ yearReviewBgVideoPlaySrc: path }, () => {
        setTimeout(() => this._playBgVideoIfReady(), 80)
      })
    }

    let meta = null
    try {
      meta = wx.getStorageSync(YEAR_REVIEW_BG_VIDEO_STORAGE_KEY) || null
    } catch (e) {}

    if (meta && meta.url === remote && meta.localPath) {
      try {
        fs.accessSync(meta.localPath)
        applyPlaySrc.call(this, meta.localPath)
        return
      } catch (e) {
        try {
          wx.removeStorageSync(YEAR_REVIEW_BG_VIDEO_STORAGE_KEY)
        } catch (e2) {}
      }
    }

    wx.downloadFile({
      url: remote,
      success: (res) => {
        if (res.statusCode !== 200 || !res.tempFilePath) {
          applyPlaySrc.call(this, remote)
          return
        }
        fs.saveFile({
          tempFilePath: res.tempFilePath,
          success: (sr) => {
            const saved = sr.savedFilePath || res.tempFilePath
            try {
              wx.setStorageSync(YEAR_REVIEW_BG_VIDEO_STORAGE_KEY, {
                url: remote,
                localPath: saved,
                savedAt: Date.now()
              })
            } catch (e) {}
            applyPlaySrc.call(this, saved)
          },
          fail: () => {
            applyPlaySrc.call(this, res.tempFilePath)
          }
        })
      },
      fail: () => {
        applyPlaySrc.call(this, remote)
      }
    })
  },

  onShow() {
    this._playBgVideoIfReady()
    this._loadMemberBadge()
  },

  async _loadMemberBadge() {
    try {
      const state = await getMembershipState()
      const pro = isPro(state)
      this.setData({
        memberIconUrl: getCachedIcon(pro ? MEMBER_ICONS.PRO : MEMBER_ICONS.FREE),
        memberBadgeText: pro ? 'PRO' : 'FREE'
      })
    } catch (e) {}
  },

  _cancelVizAnim() {
    if (this._vizAnimTimer) {
      clearTimeout(this._vizAnimTimer)
      this._vizAnimTimer = null
    }
    this._animFinal = null
  },

  /**
   * t ∈ [0,1]，从目标快照插值到当前展示数字与量条
   */
  _applyVizProgress(t) {
    const F = this._animFinal
    if (!F) return
    const u = easeOutCubic(Math.min(1, Math.max(0, t)))

    const personal = F.personal.map((it) => ({
      ...it,
      display: String(Math.round(it.value * u)),
      pct: Math.round(it.pct * u)
    }))

    const fq = F.quiz
    const answered = Math.round(fq.answered * u)
    const correct = Math.min(answered, Math.round(fq.correct * u))
    const accuracy = answered > 0 ? Math.min(100, Math.round((correct / answered) * 100)) : 0
    const volumePct = clampPct(answered, 320)
    const vizQuiz = { answered, correct, accuracy, volumePct }

    const platform = F.platform.map((it) => {
      if (!it.has) return { ...it, display: '—', pct: 0 }
      const n = Math.round(it.targetNum * u)
      return { ...it, display: String(n), pct: clampPct(n, it.max) }
    })

    let vizBooster = F.booster
    if (vizBooster && vizBooster.has && vizBooster.count != null) {
      const c = Math.round(vizBooster.count * u)
      vizBooster = {
        ...vizBooster,
        count: c,
        pct: Math.round(vizBooster.pct * u)
      }
    }

    this.setData({
      vizPersonal: personal,
      vizQuiz,
      vizPlatform: platform,
      vizBooster
    })
  },

  _startVizNumberAnim() {
    if (this._vizAnimTimer) {
      clearTimeout(this._vizAnimTimer)
      this._vizAnimTimer = null
    }
    const duration = 1080
    const start = Date.now()
    const step = () => {
      const elapsed = Date.now() - start
      const t = duration <= 0 ? 1 : Math.min(1, elapsed / duration)
      if (!this._animFinal) return
      this._applyVizProgress(t)
      if (t < 1) {
        this._vizAnimTimer = setTimeout(step, 16)
      } else {
        this._applyVizProgress(1)
        this._vizAnimTimer = null
      }
    }
    step()
  },

  _loadReport(year) {
    if (!wx.cloud) {
      this.setData({ loading: false, errorMessage: '请使用最新版微信客户端' })
      return
    }
    this._cancelVizAnim()
    this.setData({ loading: true, errorMessage: '', entranceActive: false, profileId: '' })
    wx.cloud
      .callFunction({
        name: 'userDataGateway',
        data: { action: 'getYearInReview', year }
      })
      .then((res) => {
        const r = res.result
        if (!r || !r.success) {
          const code = r && r.code
          const msg =
            code === 'year_review_closed'
              ? '年度报告暂未开放，请关注后续通知'
              : '加载失败，请稍后重试'
          this.setData({ loading: false, errorMessage: msg })
          return
        }
        const metrics = r.metrics || {}
        const platform = r.platform || null
        this._animFinal = {
          personal: buildPersonalViz(metrics),
          quiz: quizViz(metrics),
          platform: buildPlatformViz(platform),
          booster: boosterViz(platform)
        }
        this.setData({
          loading: false,
          displayTitle: r.displayTitle || '我的太空年鉴',
          displaySubtitle: r.displaySubtitle || '',
          metrics,
          summaryIntro: (r.summaryText && r.summaryText.intro) || '',
          summaryOutro: (r.summaryText && r.summaryText.outro) || '',
          platformStats: (r.meta && r.meta.platformStats) || null,
          platform,
          profileId: (r.meta && r.meta.profileId) || ''
        })
        this._applyVizProgress(0)
        setTimeout(() => {
          this.setData({ entranceActive: true })
          this._startVizNumberAnim()
        }, 36)
      })
      .catch(() => {
        this.setData({ loading: false, errorMessage: '网络异常，请稍后重试' })
      })
  },

  onUnload() {
    this._cancelVizAnim()
  },

  retryLoad() {
    this._loadReport(this.data.year)
  },

  /** 长按复制档案 ID（与云库 user_profile 文档一致） */
  copyProfileId() {
    const id = this.data.profileId
    if (!id) return
    wx.setClipboardData({
      data: id,
      success: () => wx.showToast({ title: '已复制档案 ID', icon: 'none' })
    })
  },

  onShareAppMessage() {
    const y = this.data.year
    return {
      title: `${y} 我的太空年鉴 · 火星探索日志`,
      path: `/subpackages/profile-extra/year-review/year-review?year=${y}`
    }
  }
})
