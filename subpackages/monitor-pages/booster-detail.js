const pageBase = require('../../utils/page-base.js')
const { togglePageTranslation } = require('../../utils/text-translate.js')
const { getRocketConfigMeta } = require('../../utils/api-app-services.js')
const boosterDisplay = require('../../utils/booster-display.js')
const { ROUTES, navigateTo } = require('../../utils/routes.js')
const { gateCheck } = require('../../utils/membership.js')
const { checkShareEntryGate, warmShareEntitlement, withShareStampPath, withShareStampQuery } = require('./utils/share-gate.js')
const { translateAgencyName } = require('../../utils/space-terms-i18n.js')

Page({
  behaviors: [pageBase],
  _fallbackTab: '/pages/monitor/monitor',
  data: {
    loading: true,
    errorMessage: '',
    item: null,
    heroImageLoaded: false,
    heroImageFailed: false,
    descTranslated: false,
    descTranslating: false,
    descI18n: { boosterDesc: '' },
    navTitle: '助推器详情',
    shareTitle: '助推器详情 | 火星探索日志',
    statusBarHeight: 44,
    navPlaceholderHeight: 0,
    tabBarReservedHeight: 0,
    menuButtonWidth: 88
  },

  async onLoad(options) {
    var serial = options.serial ? decodeURIComponent(options.serial) : ''
    this.initUiShell()

    // 分享卡片 24h 免门控窗口：过期后走 gateCheck（会员放行，非会员弹开通引导）
    var shareAllowed = await checkShareEntryGate(this, options, 'booster_genealogy', '全球可回收火箭族谱')
    if (!shareAllowed) {
      this.setData({ loading: false, errorMessage: '分享链接已过期，开通星际通行证后可继续查看' })
      return
    }
    warmShareEntitlement(this, 'booster_genealogy')

    if (!serial) {
      this.setData({ loading: false, errorMessage: '缺少助推器参数，请返回重试' })
      return
    }

    this._serial = serial
    this.setData({ loading: true, errorMessage: '', item: null, heroImageLoaded: false })
    this.loadDetail(serial, getApp())
  },

  loadDetail(serial, app) {
    // 从全局临时变量读取原始数据
    var raw = (app && app._boosterDetailData) || null
    if (raw && (raw.serialNumber === serial || raw.serial === serial)) {
      this.processAndSetData(raw)
      // 清理临时数据
      if (app) app._boosterDetailData = null
      return
    }

    // 兜底：从云数据库直接查询
    var self = this
    var db = wx.cloud.database()
    var docId = serial.replace(/[^a-zA-Z0-9_-]/g, '_')
    db.collection('booster_genealogy').doc(docId).get().then(function (res) {
      if (res && res.data) {
        self.processAndSetData(res.data)
      } else {
        self.setData({ loading: false, errorMessage: '未找到助推器 ' + serial + ' 的数据' })
      }
    }).catch(function () {
      self.setData({ loading: false, errorMessage: '助推器数据加载失败，请稍后重试' })
    })
  },

  processAndSetData(raw) {
    var statusTextMap = { active: '现役', retired: '退役', destroyed: '损毁', expended: '已消耗', unknown: '未知' }
    var statusColorMap = { active: '#34C759', retired: '#8E8E93', destroyed: '#FF3B30', expended: '#FF9500', unknown: '#8E8E93' }

    // 格式化日期
    function fmtDate(d) {
      if (!d) return '—'
      try {
        var dt = new Date(d)
        if (isNaN(dt.getTime())) return d
        return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0')
      } catch (e) { return d }
    }

    function fmtDateTime(d) {
      if (!d) return '—'
      try {
        var dt = new Date(d)
        if (isNaN(dt.getTime())) return d
        return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0') + ' ' + String(dt.getHours()).padStart(2, '0') + ':' + String(dt.getMinutes()).padStart(2, '0')
      } catch (e) { return d }
    }

    // 计算服役天数
    var serviceDays = ''
    if (raw.firstFlight) {
      var start = new Date(raw.firstFlight)
      var end = raw.lastFlight ? new Date(raw.lastFlight) : new Date()
      if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
        serviceDays = Math.floor((end - start) / (1000 * 60 * 60 * 24)) + ' 天'
      }
    }

    // 着陆成功率
    var landingRate = ''
    if (raw.attemptedLandings && raw.attemptedLandings > 0) {
      landingRate = Math.round((raw.successfulLandings || 0) / raw.attemptedLandings * 100) + '%'
    }

    // 飞行方块
    var flightBlocks = []
    var history = raw.flightHistory || []
    var flights = raw.flights || 0
    for (var i = 0; i < flights; i++) {
      var h = history[i]
      if (h) {
        // success 三态：true=成功, false=失败, null=待定/未知
        var isSuccess = h.success === true
        var isFailed = h.success === false
        var isPending = h.success === null || h.success === undefined
        flightBlocks.push({ idx: i, success: isSuccess, failed: isFailed, pending: isPending, known: true })
      } else {
        // 没有具体记录的飞行（历史数据未补全）
        flightBlocks.push({ idx: i, success: false, failed: false, pending: true, known: false })
      }
    }

    // 格式化飞行历史
    var formattedHistory = history.map(function (h, idx) {
      var isSuccess = h.success === true
      var isFailed = h.success === false
      var isPending = h.success === null || h.success === undefined
      return {
        index: idx + 1,
        mission: h.mission || h.name || '未知任务',
        date: fmtDate(h.date),
        dateTime: fmtDateTime(h.date),
        success: isSuccess,
        failed: isFailed,
        pending: isPending,
        successText: isSuccess ? '成功' : (isFailed ? '失败' : '待定')
      }
    })

    var status = raw.status || 'unknown'
    var item = {
      serial: raw.serialNumber || raw.serial || '?',
      flights: flights,
      status: status,
      statusText: statusTextMap[status] || '未知',
      statusColor: statusColorMap[status] || '#8E8E93',
      rocketFamily: raw.rocketFamily || 'Unknown',
      manufacturer: raw.manufacturer || '',
      // 展示用中文名（与发射商详情页同源词典）；manufacturer 保留原文供跳转解析
      manufacturerDisplay: translateAgencyName(raw.manufacturer, '') ||
        boosterDisplay.mfrDisplayName(raw.manufacturer || ''),
      block: raw.block || null,
      imageUrl: raw.cosImageUrl || raw.imageUrl || '',
      thumbnailUrl: raw.cosImageUrl || raw.thumbnailUrl || '',
      imageCredit: raw.imageCredit || '',
      details: raw.details || raw.lastUpdate || '',
      successfulLandings: raw.successfulLandings || 0,
      attemptedLandings: raw.attemptedLandings || 0,
      landingRate: landingRate,
      rtlsLandings: raw.rtlsLandings || 0,
      asdsLandings: raw.asdsLandings || 0,
      reuseCount: raw.reuseCount || 0,
      firstFlight: fmtDate(raw.firstFlight),
      lastFlight: fmtDate(raw.lastFlight),
      serviceDays: serviceDays,
      fastestTurnaround: raw.fastestTurnaround || '',
      fastestTurnaroundText: raw.fastestTurnaroundText || '',
      flightBlocks: flightBlocks,
      flightHistory: formattedHistory,
      historyComplete: history.length >= flights,
      historyGap: Math.max(0, flights - history.length),
      ll2Url: raw.ll2Url || '',
      ll2Id: raw.ll2Id || null,
      updatedAt: fmtDateTime(raw.updatedAt || raw.syncedAt)
    }

    this.setData({
      loading: false,
      item: item,
      navTitle: item.serial + ' 详情',
      shareTitle: item.serial + ' ' + item.rocketFamily + ' | 火星探索日志'
    })

    // 箭实体无自带图时兜底：LL2 构型图 → COS 火箭配置图库（与族谱列表卡兜底链一致）
    if (!item.imageUrl) this._applyHeroImageFallback(raw, item)
  },

  _applyHeroImageFallback(raw, item) {
    var self = this
    var applyCos = function () {
      var url = boosterDisplay.cosRocketImageOf(item.rocketFamily)
      if (url) self.setData({ 'item.imageUrl': url })
    }
    getRocketConfigMeta().then(function (meta) {
      var url = boosterDisplay.configImageOf(raw.configId, item.rocketFamily, (meta && meta.configs) || {})
      if (url) {
        self.setData({ 'item.imageUrl': url })
      } else {
        applyCos()
      }
    }).catch(applyCos)
  },

  // goBack inherited from pageBase

  onRetryLoad() {
    if (this._serial) {
      this.setData({ loading: true, errorMessage: '', item: null, heroImageLoaded: false })
      this.loadDetail(this._serial, getApp())
    }
  },

  /** 助推器描述「翻译/原文」 */
  onToggleDescTranslate() {
    if (this.data.descTranslating) return
    var item = this.data.item || {}
    togglePageTranslation(this, {
      switchKey: 'descTranslated',
      loadingKey: 'descTranslating',
      fields: [{ path: 'descI18n.boosterDesc', text: item.details || '' }]
    })
  },

  /** 点击发射商标签 → 会员门控 → 发射商详情页（按名称解析，agency-detail 支持 name 入参） */
  async onTapManufacturer() {
    var item = this.data.item || {}
    var name = item.manufacturer || ''
    if (!name) return
    try { wx.vibrateShort({ type: 'medium' }) } catch (e) {}
    var allowed = await gateCheck('agency_encyclopedia', '全球发射商图鉴')
    if (!allowed) return
    navigateTo(ROUTES.AGENCY_DETAIL, { name: name })
  },

  onHeroImageLoad() {
    this.setData({ heroImageLoaded: true, heroImageFailed: false })
  },

  onHeroImageError() {
    this.setData({ heroImageLoaded: false, heroImageFailed: true })
  },

  onHeroImageTap() {
    var item = this.data.item
    if (item && item.imageUrl) {
      wx.previewImage({ current: item.imageUrl, urls: [item.imageUrl] })
    }
  },

  onShareAppMessage() {
    var item = this.data.item
    return {
      title: this.data.shareTitle,
      path: item
        ? withShareStampPath('/subpackages/monitor-pages/booster-detail?serial=' + encodeURIComponent(item.serial), this)
        : '/pages/monitor/monitor',
      imageUrl: item && item.imageUrl ? item.imageUrl : ''
    }
  },

  onShareTimeline() {
    var item = this.data.item
    return {
      title: this.data.shareTitle,
      query: item ? withShareStampQuery('serial=' + encodeURIComponent(item.serial), this) : '',
      imageUrl: item && item.imageUrl ? item.imageUrl : ''
    }
  }
})
