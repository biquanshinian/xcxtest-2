const pageBase = require('../../utils/page-base.js')
const romanTracker = require('./utils/roman-tracker.js')
const ephem = require('./utils/roman-ephem.js')
const { romanTracker: ROMAN_CFG } = require('../../utils/config.js')
const { checkShareEntryGate, warmShareEntitlement, withShareStampPath, withShareStampQuery } = require('./utils/share-gate.js')

const SHARE_PATH = '/subpackages/monitor-pages/roman-detail'
const SHARE_IMAGE = '/subpackages/monitor-pages/images/roman/roman-share.jpg'
const SHARE_TITLE_APP = '罗曼太空望远镜实时追踪 | 火星探索日志'
const SHARE_TITLE_TIMELINE = '罗曼太空望远镜 · 奔赴日地 L2'
const GATE_PRODUCT_ID = 'roman_tracker'
const GATE_PRODUCT_NAME = '罗曼太空望远镜追踪'

function fmtInt(n) {
  return ephem.fmtNumber(n)
}

function hasLiveSnapshot(data) {
  return !!(data && data.ok && Number.isFinite(data.distanceFromEarthKm))
}

Page({
  behaviors: [pageBase],
  _fallbackTab: '/pages/monitor/monitor',
  data: {
    loading: true,
    errorMsg: '',
    navTitle: '罗曼太空望远镜',
    missionPhase: 'cruise',
    phaseSub: '',
    summary: null,
    met: '—',
    velocityKmh: '—',
    distEarthKm: '—',
    distL2Km: '—',
    progressPct: 0,
    showProgress: false,
    lightDelay: '',
    lightDelayRt: '',
    rangeRateText: '—',
    rangeRateDir: '',
    speedKmSText: '—',
    posX: '—',
    posY: '—',
    posZ: '—',
    dsnTracking: false,
    dsnLine: '',
    dsnStation: '',
    dsnDish: '',
    dsnBand: '',
    dsnRate: '',
    dsnActivity: '',
    sourceLabel: '',
    updatedAt: '',
    creditLines: [],
    officialUrl: '',
    eyesUrl: '',
    hasLive: false,
    shareGateExpireAt: 0,
    statusBarHeight: 44,
    navPlaceholderHeight: 0
  },

  _raw: null,
  _interpTimer: null,
  _pollTimer: null,
  _fetchSeq: 0,

  async onLoad(options) {
    this.initUiShell()
    const shareAllowed = await checkShareEntryGate(this, options, GATE_PRODUCT_ID, GATE_PRODUCT_NAME)
    if (!shareAllowed) {
      this._shareBlocked = true
      this.setData({ loading: false, errorMsg: '分享链接已过期，开通星际通行证后可继续查看' })
      return
    }
    warmShareEntitlement(this, GATE_PRODUCT_ID)
    const summary = romanTracker.getRomanMissionSummary()
    const phase = romanTracker.getRomanMissionPhase()
    this.setData({
      navTitle: (summary && summary.missionName) || '罗曼太空望远镜',
      missionPhase: phase,
      phaseSub: romanTracker.getRomanPhaseSubtitle(),
      summary: summary
    })
    if (!romanTracker.shouldShowRomanSection()) {
      this.setData({ loading: false, errorMsg: '罗曼追踪暂未开放' })
      return
    }
    this.setData({ loading: phase === 'cruise' || phase === 'l2' })
    if (phase === 'before' || phase === 'ended') return
    this._fetchData(true)
  },

  onShow() {
    if (this._shareBlocked) return
    if (this._raw) this._startInterp()
    if (!romanTracker.shouldShowRomanSection()) return
    const phase = romanTracker.getRomanMissionPhase()
    if (this.data.missionPhase === 'before' && phase !== 'before' && phase !== 'ended') {
      this.setData({
        missionPhase: phase,
        phaseSub: romanTracker.getRomanPhaseSubtitle(),
        summary: romanTracker.getRomanMissionSummary()
      })
      this._fetchData(true)
    }
    if (phase === 'cruise' || phase === 'l2') this._startPoll()
  },

  onHide() {
    this._stopInterp()
    this._stopPoll()
  },

  onUnload() {
    this._stopInterp()
    this._stopPoll()
  },

  retryLoad() {
    if (this._shareBlocked) return
    this._fetchData(true)
  },

  copyOfficial() {
    const url = this.data.officialUrl || (ROMAN_CFG && ROMAN_CFG.officialUrl) ||
      'https://science.nasa.gov/mission/roman-space-telescope/'
    wx.setClipboardData({
      data: url,
      success: () => wx.showToast({ title: 'NASA 任务页已复制', icon: 'none', duration: 2200 })
    })
  },

  copyEyes() {
    const url = this.data.eyesUrl || (ROMAN_CFG && ROMAN_CFG.eyesUrl) ||
      'https://eyes.nasa.gov/apps/solar-system/'
    wx.setClipboardData({
      data: url,
      success: () => wx.showToast({ title: 'NASA Eyes 链接已复制', icon: 'none', duration: 2200 })
    })
  },

  async _fetchData(showLoading) {
    if (this._shareBlocked) return
    if (!romanTracker.shouldShowRomanSection()) return
    const phase = romanTracker.getRomanMissionPhase()
    if (phase === 'before' || phase === 'ended') {
      this._stopPoll()
      this.setData({ loading: false, errorMsg: '', missionPhase: phase, hasLive: false })
      return
    }
    const seq = ++this._fetchSeq
    if (showLoading) this.setData({ loading: true, errorMsg: '' })
    try {
      const data = await romanTracker.fetchRomanBriefing()
      if (seq !== this._fetchSeq) return
      if (!hasLiveSnapshot(data)) {
        if (showLoading || !this._raw) {
          this.setData({
            loading: false,
            errorMsg: (data && data.error) ? String(data.error) : '数据不可用'
          })
        } else {
          this.setData({ loading: false })
        }
        return
      }
      this._applySnapshot(data)
    } catch (_e) {
      if (seq !== this._fetchSeq) return
      if (showLoading || !this._raw) {
        this.setData({ loading: false, errorMsg: '网络异常，请稍后重试' })
      } else {
        this.setData({ loading: false })
      }
    }
  },

  _applySnapshot(data) {
    const rr = ephem.fmtRangeRate(data.rangeRateKmS)
    const pos = data.posKm || {}
    const dsn = data.dsn || null
    const tracking = !!(dsn && dsn.tracking)
    const phase = data.phase || romanTracker.getRomanMissionPhase()
      this.setData({
        loading: false,
        errorMsg: '',
        missionPhase: phase,
        hasLive: true,
      phaseSub: data.phaseSub || romanTracker.getRomanPhaseSubtitle(),
      met: data.missionElapsedText || '—',
      velocityKmh: fmtInt(data.velocityKmh),
      distEarthKm: fmtInt(data.distanceFromEarthKm),
      distL2Km: fmtInt(data.distanceToL2Km),
      progressPct: Number.isFinite(data.progressPct) ? data.progressPct : 0,
      showProgress: phase === 'cruise' || phase === 'l2',
      lightDelay: data.lightDelayText || '',
      lightDelayRt: ephem.roundTripLight(data.lightDelaySec),
      rangeRateText: rr.text,
      rangeRateDir: rr.dir,
      speedKmSText: Number.isFinite(data.speedKmS) ? data.speedKmS.toFixed(3) : '—',
      posX: Number.isFinite(pos.x) ? fmtInt(pos.x) : '—',
      posY: Number.isFinite(pos.y) ? fmtInt(pos.y) : '—',
      posZ: Number.isFinite(pos.z) ? fmtInt(pos.z) : '—',
      dsnTracking: tracking,
      dsnLine: data.dsnLine || '',
      dsnStation: tracking ? (dsn.stationZh || dsn.station || '') : '',
      dsnDish: tracking ? (dsn.dish || '') : '',
      dsnBand: tracking ? (dsn.band || '') : '',
      dsnRate: tracking ? (dsn.dataRateText || '') : '',
      dsnActivity: tracking ? (dsn.activity || '') : '',
      sourceLabel: data.source === 'horizons+dsn' ? 'Horizons + DSN Now' : 'NASA/JPL Horizons',
      updatedAt: data.updatedAtLabel || '',
      creditLines: Array.isArray(data.creditLines) ? data.creditLines : [],
      officialUrl: data.officialUrl || '',
      eyesUrl: data.eyesUrl || '',
      summary: this.data.summary || romanTracker.getRomanMissionSummary()
    })
    this._raw = {
      velocityKmh: data.velocityKmh || 0,
      distEarthKm: data.distanceFromEarthKm || 0,
      rangeRateKmS: Number.isFinite(data.rangeRateKmS)
        ? data.rangeRateKmS
        : (data.velocityKmh || 0) / 3600,
      snapshotMs: Date.now()
    }
    this._startInterp()
  },

  _startPoll() {
    this._stopPoll()
    const ms = Math.max(20000, Number((ROMAN_CFG || {}).pollIntervalMs) || 60000)
    this._pollTimer = setInterval(() => this._fetchData(false), ms)
  },
  _stopPoll() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer)
      this._pollTimer = null
    }
  },

  _startInterp() {
    this._stopInterp()
    this._interpTick()
    this._interpTimer = setInterval(() => this._interpTick(), 1000)
  },
  _stopInterp() {
    if (this._interpTimer) {
      clearInterval(this._interpTimer)
      this._interpTimer = null
    }
  },
  _interpTick() {
    const raw = this._raw
    if (!raw) return
    const now = Date.now()
    const launchMs = romanTracker.getRomanLaunchMs()
    const met = ephem.fmtMet(now, launchMs)
    const distEarth = raw.distEarthKm + (raw.rangeRateKmS || 0) * ((now - raw.snapshotMs) / 1000)
    const patch = {}
    if (this.data.met !== met) patch.met = met
    const distText = fmtInt(distEarth)
    if (this.data.distEarthKm !== distText) patch.distEarthKm = distText
    if (Object.keys(patch).length) this.setData(patch)
  },

  onShareAppMessage() {
    return {
      title: SHARE_TITLE_APP,
      path: withShareStampPath(SHARE_PATH, this),
      imageUrl: SHARE_IMAGE
    }
  },

  onShareTimeline() {
    return {
      title: SHARE_TITLE_TIMELINE,
      query: withShareStampQuery('', this),
      imageUrl: SHARE_IMAGE
    }
  }
})
