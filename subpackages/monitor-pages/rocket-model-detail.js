/**
 * 火箭型号详情页（分享主载体），参数 configId
 * 数据源：booster_genealogy/_config_meta（LL2 launcher_configurations，数据驱动）
 * 回收方式复用 landing-icons 体系：构型 reusable + 描述关键词自动推断（长十乙自动显示网系回收）
 */
const pageBase = require('../../utils/page-base.js')
const { getBoosterGenealogy, getRocketConfigMeta } = require('../../utils/api-app-services.js')
const boosterDisplay = require('./utils/booster-display.js')
const { buildLandingIcon, inferNetRecoveryFromLaunch } = require('../../utils/landing-icons.js')
const { ROUTES, navigateTo } = require('../../utils/routes.js')
const { gateCheck } = require('../../utils/membership.js')
const { openBoosterEntityDetail } = require('../../utils/booster-nav.js')
const { checkShareEntryGate, warmShareEntitlement, withShareStampPath, withShareStampQuery } = require('./utils/share-gate.js')
const { togglePageTranslation } = require('./utils/text-translate.js')
const { getRocketImage } = require('../../utils/util.js')
const { translateAgencyName } = require('../../utils/space-terms-i18n.js')

function fmtNum(v, unit, digits) {
  if (v == null || v === '') return ''
  var n = Number(v)
  if (isNaN(n)) return ''
  var text = digits != null ? n.toFixed(digits).replace(/\.0+$/, '') : String(n)
  return text + (unit || '')
}

function fmtDate(d) {
  if (!d) return ''
  try {
    var dt = new Date(d)
    if (isNaN(dt.getTime())) return String(d)
    return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0')
  } catch (e) { return String(d) }
}

Page({
  behaviors: [pageBase],
  _fallbackTab: '/pages/monitor/monitor',
  data: {
    loading: true,
    errorMessage: '',
    model: null,
    boosterCards: [],
    descTranslated: false,
    descTranslating: false,
    descI18n: { modelDesc: '' },
    heroImageLoaded: false,
    imageLoadedMap: {},
    navTitle: '火箭型号详情',
    shareTitle: '火箭型号档案 | 火星探索日志',
    statusBarHeight: 44,
    navPlaceholderHeight: 0,
    tabBarReservedHeight: 0,
    menuButtonWidth: 88
  },

  async onLoad(options) {
    this.initUiShell()
    var configId = options && options.configId ? decodeURIComponent(options.configId) : ''

    // 分享卡片 24h 免门控窗口：过期后走 gateCheck（会员放行，非会员弹开通引导）
    var shareAllowed = await checkShareEntryGate(this, options, 'booster_genealogy', '全球可回收火箭族谱')
    if (!shareAllowed) {
      this.setData({ loading: false, errorMessage: '分享链接已过期，开通星际通行证后可继续查看' })
      return
    }
    warmShareEntitlement(this, 'booster_genealogy')

    if (!configId) {
      this.setData({ loading: false, errorMessage: '缺少型号参数，请返回重试' })
      return
    }
    this._configId = configId
    this.loadDetail(configId)
  },

  async loadDetail(configId) {
    this.setData({ loading: true, errorMessage: '' })
    try {
      var results = await Promise.all([getRocketConfigMeta(), getBoosterGenealogy()])
      var configs = (results[0] && results[0].configs) || {}
      var cfg = configs[String(configId)]
      if (!cfg) {
        // 数据驱动兜底：_config_meta 尚未同步到该型号（LL2 新增构型）时按 id 直连 LL2 拉取
        cfg = await this.fetchConfigFromLl2(configId)
      }
      if (!cfg) {
        this.setData({ loading: false, errorMessage: '未找到该型号的档案数据（可能尚未同步）' })
        return
      }
      this.processAndSetData(cfg, results[1] || [], configs)
    } catch (err) {
      console.error('[RocketModel] load error:', err)
      this.setData({ loading: false, errorMessage: '型号数据加载失败，请稍后重试' })
    }
  },

  /** apiProxy.ll2RocketConfigDetail：字段与 _config_meta 记录同构，24h 云缓存 */
  async fetchConfigFromLl2(configId) {
    try {
      var res = await wx.cloud.callFunction({
        name: 'apiProxy',
        data: { action: 'll2RocketConfigDetail', configId: String(configId) }
      })
      var r = res && res.result
      return (r && r.success && r.data) ? r.data : null
    } catch (e) {
      console.warn('[RocketModel] ll2 fallback failed:', e)
      return null
    }
  },

  processAndSetData(cfg, boosterList, configsMap) {
    var countryCode = cfg.countryCode || ''
    var fullName = cfg.full_name || cfg.name || ''

    // ── 回收方式（数据驱动）：复用 landing-icons 的构型级推断 ──
    var fakeLaunch = { rocket: { configuration: {
      reusable: cfg.reusable === true,
      description: cfg.description || '',
      full_name: cfg.full_name || '',
      name: cfg.name || '',
      alias: cfg.alias || ''
    } } }
    var netRecovery = inferNetRecoveryFromLaunch(fakeLaunch)
    var recovery = null
    if (cfg.reusable === true) {
      recovery = {
        label: netRecovery ? '网系回收' : '可复用构型',
        icon: netRecovery ? buildLandingIcon('NET_CATCH', 'neutral') : buildLandingIcon('RTLS', 'neutral'),
        desc: netRecovery
          ? '通过带拦阻网与支撑框架的回收平台捕获箭体'
          : '构型设计支持回收复用（具体方式以各次任务 LL2 数据为准）'
      }
    }

    // ── 规格网格（有值才展示） ──
    var specs = []
    var pushSpec = function (label, value) { if (value) specs.push({ label: label, value: value }) }
    pushSpec('全长', fmtNum(cfg.length, ' m', 1))
    pushSpec('直径', fmtNum(cfg.diameter, ' m', 1))
    pushSpec('起飞质量', fmtNum(cfg.launch_mass, ' t'))
    pushSpec('LEO 运力', fmtNum(cfg.leo_capacity, ' kg'))
    pushSpec('GTO 运力', fmtNum(cfg.gto_capacity, ' kg'))
    pushSpec('起飞推力', fmtNum(cfg.to_thrust, ' kN'))
    pushSpec('级数', cfg.max_stage != null ? String(cfg.max_stage) : '')
    pushSpec('首飞时间', fmtDate(cfg.maiden_flight))

    // ── 构型级回收战绩 ──
    var landingRate = ''
    if (cfg.attempted_landings > 0) {
      landingRate = Math.round((cfg.successful_landings || 0) / cfg.attempted_landings * 100) + '%'
    }
    var record = {
      totalLaunches: cfg.total_launch_count != null ? cfg.total_launch_count : 0,
      successfulLaunches: cfg.successful_launches != null ? cfg.successful_launches : 0,
      attemptedLandings: cfg.attempted_landings != null ? cfg.attempted_landings : 0,
      successfulLandings: cfg.successful_landings != null ? cfg.successful_landings : 0,
      consecutiveLandings: cfg.consecutive_successful_landings != null ? cfg.consecutive_successful_landings : 0,
      landingRate: landingRate,
      fastestTurnaroundText: cfg.fastestTurnaroundText || ''
    }
    var hasRecord = record.totalLaunches > 0 || record.attemptedLandings > 0

    // ── 旗下箭实体（configId 精确匹配，兜底 rocketFamily 名称匹配） ──
    var processed = boosterDisplay.processBoosterList(boosterList, configsMap)
    this._rawBySerial = processed.rawBySerial
    var cfgId = cfg.id
    var nameLower = String(fullName).toLowerCase()
    var nameShortLower = String(cfg.name || '').toLowerCase()
    var fleet = processed.processed.filter(function (b) {
      if (b.configId != null && String(b.configId) === String(cfgId)) return true
      if (b.configId != null) return false
      var fam = String(b.rocketFamily || '').toLowerCase()
      return fam && (fam === nameLower || (nameShortLower && fam === nameShortLower))
    })
    fleet.sort(function (a, b) { return b.flights - a.flights })

    var model = {
      configId: cfg.id,
      name: cfg.name || '',
      fullName: fullName,
      alias: cfg.alias || '',
      variant: cfg.variant || '',
      manufacturer: cfg.manufacturerName || '',
      manufacturerAbbrev: cfg.manufacturerAbbrev || '',
      // 展示用中文名（与发射商详情页同源词典）；manufacturer 保留原文供跳转解析
      manufacturerDisplay: translateAgencyName(cfg.manufacturerName, cfg.manufacturerAbbrev) ||
        boosterDisplay.mfrDisplayName(cfg.manufacturerName || ''),
      countryCode: countryCode,
      countryFlag: boosterDisplay.countryCodeToFlag(countryCode),
      reusable: cfg.reusable === true,
      // 构型无图时兜底 COS 火箭配置图库（与族谱列表卡兜底链一致）
      imageUrl: cfg.cosImageUrl || cfg.image_url || cfg.thumbnail_url || getRocketImage(cfg.name || fullName) || '',
      imageCredit: cfg.imageCredit || '',
      // 默认英文原文；预翻译中文单独携带，翻译按钮命中时本地秒切
      description: cfg.description || cfg.descriptionZh || '',
      descriptionZh: cfg.descriptionZh || '',
      wikiUrl: cfg.wiki_url || '',
      maidenFlight: fmtDate(cfg.maiden_flight),
      hasFlown: !!(cfg.maiden_flight || (cfg.total_launch_count && cfg.total_launch_count > 0)),
      recovery: recovery,
      specs: specs,
      record: record,
      hasRecord: hasRecord
    }

    var isCN = countryCode === 'CN'
    var shareSuffix = netRecovery
      ? (isCN ? ' · 中国网系回收火箭档案' : ' · 网系回收火箭档案')
      : (model.reusable ? (isCN ? ' · 中国可回收火箭档案' : ' · 可回收火箭档案') : ' · 火箭型号档案')
    var displayName = model.alias || model.fullName

    this.setData({
      loading: false,
      model: model,
      boosterCards: fleet,
      navTitle: displayName,
      shareTitle: displayName + shareSuffix
    })
  },

  /** 型号简介「翻译为中文/显示原文」 */
  onToggleDescTranslate() {
    if (this.data.descTranslating) return
    var model = this.data.model || {}
    togglePageTranslation(this, {
      switchKey: 'descTranslated',
      loadingKey: 'descTranslating',
      fields: [{ path: 'descI18n.modelDesc', text: model.description || '', zh: model.descriptionZh || '' }]
    })
  },

  /** 点击发射商标签 → 会员门控 → 发射商详情页（优先缩写，回退名称） */
  async onTapManufacturer() {
    var model = this.data.model || {}
    var abbrev = model.manufacturerAbbrev || ''
    var name = model.manufacturer || ''
    if (!abbrev && !name) return
    try { wx.vibrateShort({ type: 'medium' }) } catch (e) {}
    var allowed = await gateCheck('agency_encyclopedia', '全球发射商图鉴')
    if (!allowed) return
    navigateTo(ROUTES.AGENCY_DETAIL, abbrev ? { abbrev: abbrev } : { name: name })
  },

  onHeroImageLoad() {
    this.setData({ heroImageLoaded: true })
  },

  onHeroImageTap() {
    var model = this.data.model
    if (model && model.imageUrl) {
      wx.previewImage({ current: model.imageUrl, urls: [model.imageUrl] })
    }
  },

  onFleetImageLoad(e) {
    var key = e.currentTarget.dataset.imgKey
    if (!key) return
    var kv = {}
    kv['imageLoadedMap.' + key] = true
    this.setData(kv)
  },

  /** 箭实体缩略图加载失败：沿多级兜底链逐级切换，链耗尽则清空显示占位 */
  onFleetImageError(e) {
    var idx = Number(e.currentTarget.dataset.index)
    if (!Number.isInteger(idx) || idx < 0) return
    var card = (this.data.boosterCards || [])[idx]
    if (!card) return
    var fallbacks = card.imageFallbacks || []
    var kv = {}
    kv['boosterCards[' + idx + '].thumbnailUrl'] = fallbacks[0] || ''
    kv['boosterCards[' + idx + '].imageFallbacks'] = fallbacks.slice(1)
    this.setData(kv)
  },

  async onBoosterCardTap(e) {
    var serial = e.currentTarget.dataset.serial
    if (!serial) return
    var raw = (this._rawBySerial && this._rawBySerial[serial]) || null
    var card = (this.data.boosterCards || []).find(function (b) {
      return b && String(b.serial) === String(serial)
    })
    await openBoosterEntityDetail(serial, {
      raw: raw,
      heroImage: (card && (card.thumbnailUrl || card.imageUrl)) || ''
    })
  },

  onRetryLoad() {
    if (this._configId) this.loadDetail(this._configId)
  },

  onShareAppMessage() {
    var model = this.data.model
    return {
      title: this.data.shareTitle,
      path: withShareStampPath('/subpackages/monitor-pages/rocket-model-detail?configId=' + encodeURIComponent(this._configId || ''), this),
      imageUrl: model && model.imageUrl ? model.imageUrl : ''
    }
  },

  onShareTimeline() {
    var model = this.data.model
    return {
      title: this.data.shareTitle,
      query: withShareStampQuery('configId=' + encodeURIComponent(this._configId || ''), this),
      imageUrl: model && model.imageUrl ? model.imageUrl : ''
    }
  }
})
