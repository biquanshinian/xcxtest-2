// 飞船构型详情页：数据来自 apiProxy ll2SpacecraftDetail（LL2 spacecraft_configurations）
const pageBase = require('../../utils/page-base.js')
const { togglePageTranslation } = require('../../utils/text-translate.js')
const { translateAgencyName } = require('../../utils/space-terms-i18n.js')
const { cachedImage, proxiedImageUrl } = require('../../utils/spacecraft-display.js')
const { ROUTES, navigateTo } = require('../../utils/routes.js')
const { gateCheck } = require('../../utils/membership.js')
const { checkShareEntryGate, warmShareEntitlement, withShareStampPath, withShareStampQuery } = require('./utils/share-gate.js')

const CACHE_TTL = 24 * 60 * 60 * 1000

function fmtNum(v, unit, digits) {
  if (v == null || v === '') return ''
  const n = Number(v)
  if (isNaN(n)) return ''
  const t = digits != null ? n.toFixed(digits).replace(/\.0+$/, '') : String(n)
  return t + (unit || '')
}

/** LL2 原始飞船构型对象（snake_case，来自发射商详情内嵌列表）→ 与 apiProxy 瘦身结果同构 */
function normalizeLl2Spacecraft(raw) {
  if (!raw || raw.typeName !== undefined) return raw // 已是瘦身结构
  const agency = raw.agency || {}
  const family = Array.isArray(raw.family) && raw.family[0] ? raw.family[0] : null
  return {
    id: raw.id,
    name: raw.name || '',
    typeName: raw.type && raw.type.name ? raw.type.name : '',
    agencyId: agency.id || null,
    agencyName: agency.name || '',
    agencyAbbrev: agency.abbrev || '',
    familyName: family && family.name ? family.name : '',
    inUse: !!raw.in_use,
    // 缩略图优先（与全项目一致）：LL2 原图托管在海外，国内直连原图经常超时
    imageUrl: raw.image && (raw.image.thumbnail_url || raw.image.image_url) || '',
    fullImageUrl: raw.image && (raw.image.image_url || raw.image.thumbnail_url) || '',
    capability: raw.capability || '',
    history: raw.history || '',
    details: raw.details || '',
    maidenFlight: raw.maiden_flight || '',
    height: raw.height != null ? raw.height : null,
    diameter: raw.diameter != null ? raw.diameter : null,
    humanRated: !!raw.human_rated,
    crewCapacity: raw.crew_capacity != null ? raw.crew_capacity : null,
    payloadCapacity: raw.payload_capacity != null ? raw.payload_capacity : null,
    payloadReturnCapacity: raw.payload_return_capacity != null ? raw.payload_return_capacity : null,
    flightLife: raw.flight_life || '',
    wikiLink: raw.wiki_link || '',
    infoLink: raw.info_link || '',
    spacecraftFlown: raw.spacecraft_flown != null ? raw.spacecraft_flown : null,
    totalLaunchCount: raw.total_launch_count != null ? raw.total_launch_count : null,
    successfulLaunches: raw.successful_launches != null ? raw.successful_launches : null,
    failedLaunches: raw.failed_launches != null ? raw.failed_launches : null,
    attemptedLandings: raw.attempted_landings != null ? raw.attempted_landings : null,
    successfulLandings: raw.successful_landings != null ? raw.successful_landings : null,
    failedLandings: raw.failed_landings != null ? raw.failed_landings : null
  }
}

/** 头图兜底链：原图直连 → 代理缩略图 → 缩略图直连（去重、去空） */
function buildHeroFallbacks(fullUrl, thumbUrl) {
  const chain = []
  ;[fullUrl, proxiedImageUrl(thumbUrl), thumbUrl].forEach((u) => {
    if (u && chain.indexOf(u) < 0) chain.push(u)
  })
  return chain
}

function formatSpacecraft(raw) {
  if (!raw) return null

  const specs = []
  const push = (label, value) => { if (value) specs.push({ label, value }) }
  push('高度', fmtNum(raw.height, ' m', 2))
  push('直径', fmtNum(raw.diameter, ' m', 2))
  push('乘员容量', raw.crewCapacity != null ? raw.crewCapacity + ' 人' : '')
  push('上行载荷', fmtNum(raw.payloadCapacity, ' kg'))
  push('下行载荷', fmtNum(raw.payloadReturnCapacity, ' kg'))
  push('飞行寿命', raw.flightLife || '')
  push('首飞时间', raw.maidenFlight || '')
  push('载人评级', raw.humanRated ? '已通过' : '未载人')

  const total = raw.totalLaunchCount
  const success = raw.successfulLaunches
  const successRate = (total && total > 0 && success != null)
    ? Math.round(success / total * 100) + '%'
    : ''

  return {
    id: raw.id,
    name: raw.name || '未知飞船',
    typeName: raw.typeName || '',
    agencyName: translateAgencyName(raw.agencyName, raw.agencyAbbrev) || raw.agencyName || '',
    // 原文名/缩写保留供发射商详情页路由解析
    agencyNameEn: raw.agencyName || '',
    agencyAbbrev: raw.agencyAbbrev || '',
    agencyId: raw.agencyId || null,
    familyName: raw.familyName || '',
    inUse: !!raw.inUse,
    // 头图：原图优先（与火箭型号详情页一致，缩略图放大显示会糊），走代理 + 本地缓存
    imageUrl: cachedImage(proxiedImageUrl(raw.fullImageUrl || raw.imageUrl) || raw.fullImageUrl || raw.imageUrl || ''),
    // 兜底链（binderror 逐级切换）：原图直连 → 代理缩略图 → 缩略图直连
    imageFallbacks: buildHeroFallbacks(raw.fullImageUrl, raw.imageUrl),
    fullImageUrl: raw.fullImageUrl || raw.imageUrl || '',
    capability: raw.capability || '',
    history: raw.history || '',
    details: raw.details || '',
    hasDesc: !!(raw.capability || raw.history || raw.details),
    specs,
    totalLaunchCount: total != null ? total : null,
    successfulLaunches: success != null ? success : null,
    failedLaunches: raw.failedLaunches != null ? raw.failedLaunches : null,
    spacecraftFlown: raw.spacecraftFlown != null ? raw.spacecraftFlown : null,
    successRate,
    attemptedLandings: raw.attemptedLandings != null ? raw.attemptedLandings : null,
    successfulLandings: raw.successfulLandings != null ? raw.successfulLandings : null,
    wikiLink: raw.wikiLink || '',
    infoLink: raw.infoLink || ''
  }
}

Page({
  behaviors: [pageBase],
  _fallbackTab: '/pages/monitor/monitor',
  data: {
    loading: true,
    errorMessage: '',
    item: null,
    heroImageLoaded: false,
    descTranslated: false,
    descTranslating: false,
    descI18n: { capability: '', history: '', details: '' },
    navTitle: '飞船详情',
    shareTitle: '飞船档案 | 火星探索日志',
    statusBarHeight: 44,
    navPlaceholderHeight: 0,
    tabBarReservedHeight: 0,
    menuButtonWidth: 88
  },

  async onLoad(options) {
    this.initUiShell()
    const id = options && options.id ? String(options.id).trim() : ''
    const name = options && options.name ? decodeURIComponent(String(options.name)).trim() : ''

    // 分享卡片 24h 免门控窗口：过期后走 gateCheck（会员放行，非会员弹开通引导）
    const shareAllowed = await checkShareEntryGate(this, options, 'spacecraft_encyclopedia', '全球飞船图鉴')
    if (!shareAllowed) {
      this.setData({ loading: false, errorMessage: '分享链接已过期，开通星际通行证后可继续查看' })
      return
    }
    warmShareEntitlement(this, 'spacecraft_encyclopedia')

    if (!id) {
      this.setData({ loading: false, errorMessage: '缺少飞船参数，请返回重试' })
      return
    }
    this._spacecraftId = id
    if (name) this.setData({ shareTitle: `${name} | 火星探索日志` })

    // 列表卡片直传的已显示图（同一张缩略图，可能是本地缓存路径）：头图零加载复用
    const appRef = getApp && getApp()
    const heroPassed = appRef && appRef._spacecraftHeroImage
    if (heroPassed && String(heroPassed.id) === String(id) && heroPassed.src) {
      this._heroOverrideSrc = heroPassed.src
      appRef._spacecraftHeroImage = null
    }

    // 发射商详情页直传的内嵌构型对象：免请求秒开
    const app = getApp && getApp()
    const passed = app && app._spacecraftDetailData
    if (passed && String(passed.id) === String(id)) {
      app._spacecraftDetailData = null
      this.applyData(normalizeLl2Spacecraft(passed))
      return
    }
    this.loadDetail(id)
  },

  async loadDetail(id) {
    this.setData({
      loading: true,
      errorMessage: '',
      heroImageLoaded: false,
      descTranslated: false,
      descTranslating: false,
      descI18n: { capability: '', history: '', details: '' }
    })
    this._textTranslateCache = null

    // v2: 缩略图优先 + fullImageUrl 字段；升版本使旧缓存失效
    const cacheKey = `_spacecraft_detail_v2_${id}`
    try {
      const cached = wx.getStorageSync(cacheKey)
      if (cached && cached.data && Date.now() - cached.ts < CACHE_TTL) {
        this.applyData(cached.data)
        return
      }
    } catch (e) {}

    try {
      const res = await wx.cloud.callFunction({
        name: 'apiProxy',
        data: { action: 'll2SpacecraftDetail', spacecraftId: id }
      })
      const result = res && res.result
      if (!result || !result.success || !result.data) {
        throw new Error((result && result.error) || '未获取到飞船数据')
      }
      try { wx.setStorageSync(cacheKey, { data: result.data, ts: Date.now() }) } catch (e) {}
      this.applyData(result.data)
    } catch (error) {
      console.error('[spacecraft-detail] load error:', error)
      this.setData({
        loading: false,
        errorMessage: (error && (error.errMsg || error.message)) || '飞船详情加载失败，请稍后重试'
      })
    }
  },

  applyData(raw) {
    const item = formatSpacecraft(raw)
    // 卡片直传图优先：与卡片同一张图零加载；原首选图降级为兜底
    if (this._heroOverrideSrc && item && this._heroOverrideSrc !== item.imageUrl) {
      item.imageFallbacks = [item.imageUrl].concat(item.imageFallbacks || []).filter(Boolean)
      item.imageUrl = this._heroOverrideSrc
    }
    this.setData({
      loading: false,
      item,
      navTitle: '飞船详情',
      shareTitle: `${(item && item.name) || '飞船详情'} | 火星探索日志`
    })
  },

  retryLoad() {
    if (this._spacecraftId) this.loadDetail(this._spacecraftId)
  },

  onHeroImageLoad() {
    this.setData({ heroImageLoaded: true })
  },

  onHeroImageError() {
    // 沿兜底链切换（本地缓存文件异常时回退远程原图），链耗尽清空显示占位
    var item = this.data.item || {}
    var fallbacks = item.imageFallbacks || []
    var next = fallbacks[0] || ''
    // 避免本地缓存路径与远程 URL 相同导致死循环
    if (next && next === item.imageUrl) next = fallbacks[1] || ''
    this.setData({
      heroImageLoaded: false,
      'item.imageUrl': next,
      'item.imageFallbacks': fallbacks.slice(1)
    })
  },

  /** 点击发射商胶囊按钮 → 会员门控 → 发射商详情页（优先 id，回退缩写/名称） */
  async onTapAgency() {
    const item = this.data.item || {}
    if (!item.agencyId && !item.agencyAbbrev && !item.agencyNameEn) return
    try { wx.vibrateShort({ type: 'medium' }) } catch (e) {}
    const allowed = await gateCheck('agency_encyclopedia', '全球发射商图鉴')
    if (!allowed) return
    let params
    if (item.agencyId) params = { id: item.agencyId }
    else if (item.agencyAbbrev) params = { abbrev: item.agencyAbbrev }
    else params = { name: item.agencyNameEn }
    navigateTo(ROUTES.AGENCY_DETAIL, params)
  },

  onHeroImageTap() {
    const item = this.data.item
    const url = item && (item.fullImageUrl || item.imageUrl)
    if (url) {
      wx.previewImage({ current: url, urls: [url] })
    }
  },

  /** 飞船简介「翻译/原文」（用途 + 历史 + 详细说明） */
  onToggleDescTranslate() {
    if (this.data.descTranslating) return
    const item = this.data.item || {}
    togglePageTranslation(this, {
      switchKey: 'descTranslated',
      loadingKey: 'descTranslating',
      fields: [
        { path: 'descI18n.capability', text: item.capability || '' },
        { path: 'descI18n.history', text: item.history || '' },
        { path: 'descI18n.details', text: item.details || '' }
      ]
    })
  },

  copyLink(e) {
    const url = e.currentTarget.dataset.url
    if (!url) return
    wx.setClipboardData({
      data: url,
      success: () => { wx.showToast({ title: '链接已复制', icon: 'none' }) }
    })
  },

  onShareAppMessage() {
    const item = this.data.item
    return {
      title: this.data.shareTitle,
      path: withShareStampPath(`/subpackages/monitor-pages/spacecraft-detail?id=${encodeURIComponent(this._spacecraftId || '')}`, this),
      imageUrl: item && item.imageUrl ? item.imageUrl : ''
    }
  },

  onShareTimeline() {
    const item = this.data.item
    return {
      title: this.data.shareTitle,
      query: withShareStampQuery(`id=${encodeURIComponent(this._spacecraftId || '')}`, this),
      imageUrl: item && item.imageUrl ? item.imageUrl : ''
    }
  }
})
