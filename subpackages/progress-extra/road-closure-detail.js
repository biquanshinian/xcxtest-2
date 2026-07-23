const { getRoadClosureNotice } = require('./utils/api-road-closure.js')
const { ROAD_CLOSURE_SCENE } = require('./utils/map-scenes.js')
const { ROUTES } = require('../../utils/routes.js')
const pageBase = require('../../utils/page-base.js')
const { resolveRoadClosureStatus } = require('../../utils/progress-road-closure.js')
const { applyStarbaseI18n, resolveRoadStatusDisplay, translateMayorOrderBody } = require('./utils/starbase-i18n.js')
const { decodeHtmlEntities } = require('./utils/decode-html-entities.js')
const { SPACEX_LAUNCH_SERVICE_PROVIDER_LOGO_URL } = require('../../utils/agency-logo-overrides.js')
const { optimizeImageUrl } = require('../../utils/cos-url.js')

/** 封路通知分享缩略图：固定 SpaceX logo（与全球发射统计/发射商详情同源） */
const ROAD_CLOSURE_SHARE_IMAGE =
  optimizeImageUrl(SPACEX_LAUNCH_SERVICE_PROVIDER_LOGO_URL, 'thumb') || SPACEX_LAUNCH_SERVICE_PROVIDER_LOGO_URL

const BODY_COLLAPSE_LEN = 120

function formatUpdateTime(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const pad = n => String(n).padStart(2, '0')
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes())
}

const SOURCE_LABELS = {
  starbase_gov: 'Starbase.gov',
  spacedevs: 'SpaceDevs',
  manual: '管理员'
}

function normalizeScheduleLine(line) {
  const s = String(line || '').trim()
  const m = s.match(/^(Primary|Backup|主要时段|备用时段)\s*:\s*(.+)$/i)
  if (m) {
    const kind = /backup|备用/i.test(m[1]) ? 'backup' : 'primary'
    return {
      kind,
      kindLabel: kind === 'primary' ? '主要时段' : '备用时段',
      timeText: m[2].trim()
    }
  }
  return { kind: 'slot', kindLabel: '时段', timeText: applyStarbaseI18n(s) }
}

function normalizeRoadItem(item) {
  if (item && typeof item === 'object') {
    return {
      description: applyStarbaseI18n(item.description || ''),
      date: item.date || ''
    }
  }
  const s = String(item || '').trim()
  const m = s.match(/^(.+?)\s*[（(](.+)[）)]$/)
  if (m) {
    return {
      description: applyStarbaseI18n(m[1].trim()),
      date: m[2].trim()
    }
  }
  return { description: applyStarbaseI18n(s), date: '' }
}

function normalizePublicOrder(o) {
  const bodyTextZh = decodeHtmlEntities(o.bodyTextZh || translateMayorOrderBody(o.bodyText || ''))
  return {
    orderNo: applyStarbaseI18n(o.orderNo || 'Mayor Order'),
    bodyTextZh,
    bodyLong: bodyTextZh.length > BODY_COLLAPSE_LEN,
    bodyExpanded: false,
    primaryPeriod: applyStarbaseI18n(o.primaryPeriod || ''),
    alternateDates: applyStarbaseI18n(o.alternateDates || ''),
    revocation: applyStarbaseI18n(o.revocation || '')
  }
}

function isMeaningfulNoticeText(text) {
  const s = String(text || '').trim()
  if (!s) return false
  if (/no\s+public\s+notice|at\s+this\s+time|目前没有公开通知|暂无公开通知|没有公开通知|无公开通知/i.test(s)) return false
  return /[\u4e00-\u9fa5]/.test(s)
}

function isMeaningfulOrder(o) {
  if (!o) return false
  if (isMeaningfulNoticeText(o.bodyTextZh)) return true
  return !!(o.primaryPeriod || o.alternateDates || o.revocation)
}

function buildDisplayModel(data) {
  const beachOpen = data.beachOpen
  const roadOpen = data.roadOpen
  let statusTitle = '交通管制信息'
  if (beachOpen === false && roadOpen === false) statusTitle = '海滩及道路管制中'
  else if (beachOpen === false) statusTitle = '海滩封闭 / 计划封闭'
  else if (roadOpen === false) statusTitle = '道路延迟或管制'
  else if (beachOpen === true && roadOpen === true) statusTitle = '海滩与道路当前开放'

  const beachSlots = (data.beachClosureSchedule || []).map(normalizeScheduleLine).filter((s) => s.timeText)
  const roadItems = (data.roadUpdates || []).map(normalizeRoadItem).filter((r) => r.description)
  const bannerAlerts = ((data.bannerAlerts && data.bannerAlerts.length)
    ? data.bannerAlerts.map((a) => applyStarbaseI18n(a))
    : (data.roadDelays || []).map((a) => applyStarbaseI18n(a))).filter(Boolean)

  const publicOrders = (data.publicOrders || []).map(normalizePublicOrder).filter(isMeaningfulOrder)

  if (!publicOrders.length && data.publicNotice && isMeaningfulNoticeText(data.publicNotice)) {
    const bodyTextZh = translateMayorOrderBody(data.publicNotice)
    publicOrders.push({
      orderNo: '市长令摘要',
      bodyTextZh,
      bodyLong: bodyTextZh.length > BODY_COLLAPSE_LEN,
      bodyExpanded: false,
      primaryPeriod: '',
      alternateDates: '',
      revocation: ''
    })
  }

  return {
    ...data,
    statusTitle,
    beachSlots,
    roadItems,
    bannerAlerts,
    publicOrders,
    beachStatusText: applyStarbaseI18n(data.beachStatus) || (beachOpen === false ? '海滩未开放' : beachOpen === true ? '海滩开放' : ''),
    roadStatusText: resolveRoadStatusDisplay(data) || (roadOpen === false ? '道路管制中' : roadOpen === true ? '无道路延迟' : ''),
    showBeachSection: beachSlots.length > 0 || beachOpen === false || !!data.beachStatus,
    showRoadSection: roadItems.length > 0 || roadOpen === false || !!data.roadStatusLabel,
    showBanner: bannerAlerts.length > 0,
    showPublicNotice: publicOrders.length > 0
  }
}

/**
 * 分享链接 query 兜底：朋友圈单页等场景读不到云库时，用分享方带来的文案渲染，
 * 避免详情页空白。仅取 message/timeRange/source 三个字段。
 */
function buildFallbackFromOptions(options) {
  const dec = (v) => {
    if (!v) return ''
    try { return decodeURIComponent(v) } catch (_) { return String(v) }
  }
  const message = dec(options && options.message)
  if (!message) return null
  const timeRange = dec(options && options.timeRange)
  return buildDisplayModel({
    isActive: true,
    message,
    timeRange,
    sourceLabel: dec(options && options.source),
    bannerAlerts: timeRange ? ['封路时间：' + timeRange] : []
  })
}

Page({
  behaviors: [pageBase],
  _fallbackTab: '/pages/progress/progress',
  _launchOptions: null,

  data: {
    loading: true,
    errorMessage: '',
    emptyState: false,
    isMomentsPreview: false,
    item: null,
    shareTitle: '星舰基地封路通知 | 火星探索日志',
    /** 分享缩略图：SpaceX logo（本地预下载），避免朋友圈落到截图/默认图 */
    shareImage: ROAD_CLOSURE_SHARE_IMAGE,
    statusBarHeight: 44,
    navPlaceholderHeight: 0,
    tabBarReservedHeight: 0,
    menuButtonWidth: 88,
    mapLatitude: ROAD_CLOSURE_SCENE.center.latitude,
    mapLongitude: ROAD_CLOSURE_SCENE.center.longitude,
    mapScale: 13,
    mapMarkers: ROAD_CLOSURE_SCENE.markers,
    mapPolylines: ROAD_CLOSURE_SCENE.polylines,
    mapPolygons: ROAD_CLOSURE_SCENE.polygons
  },

  onLoad(options) {
    this._launchOptions = options || {}
    this.initUiShell()

    // 朋友圈单页模式（scene 1154）：原生 map 组件与分享菜单接口受限，需跳过
    let isMomentsPreview = false
    try {
      isMomentsPreview = wx.getLaunchOptionsSync().scene === 1154
    } catch (_) {}
    if (isMomentsPreview) {
      this.setData({ isMomentsPreview: true })
    } else {
      wx.showShareMenu({
        withShareTicket: true,
        menus: ['shareAppMessage', 'shareTimeline']
      })
    }

    this.loadData()
    this.ensureShareImageHttpUrl(ROAD_CLOSURE_SHARE_IMAGE)
  },

  /** 将 SpaceX logo 落到本地临时路径，规避 iOS 朋友圈远程缩略图加载失败 */
  ensureShareImageHttpUrl(imageUrl) {
    if (!imageUrl || typeof imageUrl !== 'string') return
    const trimmed = imageUrl.trim()
    if (!trimmed) return
    if (
      trimmed.indexOf('wxfile://') === 0 ||
      /^http:\/\/(tmp|usr)\b/i.test(trimmed) ||
      (typeof wx !== 'undefined' && wx.env && wx.env.USER_DATA_PATH && trimmed.indexOf(wx.env.USER_DATA_PATH) === 0)
    ) {
      if (this.data.shareImage !== trimmed) this.setData({ shareImage: trimmed })
      return
    }
    if (this._shareImageSourceUrl === trimmed && this.data.shareImage) return
    this._shareImageSourceUrl = trimmed
    const self = this
    wx.getImageInfo({
      src: trimmed,
      success(res) {
        if (res && res.path && self._shareImageSourceUrl === trimmed) {
          self.setData({ shareImage: res.path })
        }
      },
      fail() {
        if (self._shareImageSourceUrl === trimmed) self._shareImageSourceUrl = ''
      }
    })
  },

  async loadData() {
    this.setData({ loading: true, errorMessage: '', emptyState: false })
    try {
      const data = await getRoadClosureNotice()
      const status = resolveRoadClosureStatus(data)
      if (status !== 'active') {
        // 取数失败（或朋友圈单页拿不到数据）时用分享 query 里的文案兜底；
        // 正常模式下官网确认"无封路"（clear）仍显示空态，避免展示过期信息
        const fallbackItem = (status === 'error' || this.data.isMomentsPreview)
          ? buildFallbackFromOptions(this._launchOptions)
          : null
        if (fallbackItem) {
          this.setData({ loading: false, item: fallbackItem })
          return
        }
        if (status === 'error') {
          this.setData({ loading: false, item: null, emptyState: false, errorMessage: '封路数据获取失败，请稍后重试' })
        } else {
          this.setData({ loading: false, item: null, emptyState: true })
        }
        return
      }

      const sourceLabel = SOURCE_LABELS[data.source] || data.source || ''
      const updatedAtText = formatUpdateTime(data.updatedAt || data.syncedAt)
      const item = buildDisplayModel({
        ...data,
        message: applyStarbaseI18n(data.message),
        sourceLabel,
        updatedAtText
      })

      const lines = ['星舰基地封路通知', item.statusTitle]
      if (item.message) lines.push(item.message)

      this.setData({
        loading: false,
        item,
        shareTitle: lines.join(' | ') + ' | 火星探索日志'
      })
    } catch (error) {
      const fallbackItem = buildFallbackFromOptions(this._launchOptions)
      if (fallbackItem) {
        this.setData({ loading: false, item: fallbackItem })
        return
      }
      this.setData({
        loading: false,
        errorMessage: (error && (error.errMsg || error.message)) || '封路通知加载失败'
      })
    }
  },

  retryLoad() {
    this.loadData()
  },

  toggleOrderBody(e) {
    const index = Number(e.currentTarget.dataset.index)
    if (Number.isNaN(index) || !this.data.item || !this.data.item.publicOrders) return
    const key = `item.publicOrders[${index}].bodyExpanded`
    this.setData({ [key]: !this.data.item.publicOrders[index].bodyExpanded })
  },

  openFullMap() {
    const item = this.data.item
    const query = [
      'message=' + encodeURIComponent((item && item.message) || ''),
      'timeRange=' + encodeURIComponent((item && item.timeRange) || '')
    ].join('&')
    wx.navigateTo({ url: ROUTES.ROAD_CLOSURE_MAP + '?' + query })
  },

  /** 分享 query：携带当前封路文案，供接收方在读不到云库时兜底渲染 */
  _buildShareQuery() {
    const item = this.data.item
    if (!item || !item.message) return ''
    const parts = ['message=' + encodeURIComponent(String(item.message).slice(0, 120))]
    if (item.timeRange) parts.push('timeRange=' + encodeURIComponent(item.timeRange))
    if (item.sourceLabel) parts.push('source=' + encodeURIComponent(item.sourceLabel))
    return parts.join('&')
  },

  onShareAppMessage() {
    const query = this._buildShareQuery()
    const imageUrl = this.data.shareImage || ROAD_CLOSURE_SHARE_IMAGE
    const result = {
      title: this.data.shareTitle,
      path: '/subpackages/progress-extra/road-closure-detail' + (query ? '?' + query : '')
    }
    if (imageUrl) result.imageUrl = imageUrl
    return result
  },

  onShareTimeline() {
    const imageUrl = this.data.shareImage || ROAD_CLOSURE_SHARE_IMAGE
    const result = {
      title: this.data.shareTitle,
      query: this._buildShareQuery()
    }
    if (imageUrl) result.imageUrl = imageUrl
    return result
  }
})
