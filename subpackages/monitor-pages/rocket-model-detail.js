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
const { openBoosterEntityDetail, openRocketCompare, openRocketScore, openEncyclopediaAgency, pickAgencyId } = require('./utils/booster-nav.js')
const { checkShareEntryGate, warmShareEntitlement, withShareStampPath, withShareStampQuery } = require('./utils/share-gate.js')
const { togglePageTranslation } = require('./utils/text-translate.js')
const { getRocketImage } = require('../../utils/util.js')
const { pickLocalized, isUsableZhText, takeDescI18nSeed } = require('../../utils/locale.js')
const { translateRocketName } = require('../../utils/rocket-name-i18n.js')
const { isFavorite, toggleFavorite, pulseFavAnimate, syncFavoriteState } = require('../../utils/favorites.js')
const { loadCloudMediaMap } = require('../../utils/image-config.js')
const {
  isLocalSharePath,
  pickRocketModelShareImageUrl,
  pickRocketModelShareSourceForDownload,
  rocketShareOptsFromModel
} = require('./utils/rocket-model-share-image.js')
const {
  alignDedicatedRocket3d,
  pickExhibitConfig,
  stashRocket3dSpecs,
  buildRocket3dNavUrl
} = require('./utils/rocket-3d-bind.js')

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
    rocket3dEnabled: false,
    imageLoadedMap: {},
    isFavorited: false,
    favAnimate: false,
    navTitle: '火箭型号详情',
    shareTitle: '火箭型号档案 | 火星探索日志',
    shareImage: '',
    shareGateExpireAt: 0,
    statusBarHeight: 44,
    navPlaceholderHeight: 0,
    tabBarReservedHeight: 0,
    menuButtonWidth: 88
  },

  async onLoad(options) {
    this.initUiShell()
    var configId = ''
    if (options && options.configId) {
      try { configId = decodeURIComponent(String(options.configId)) } catch (e) { configId = String(options.configId) }
    }
    if (!configId && options && options.id) {
      try { configId = decodeURIComponent(String(options.id)) } catch (e) { configId = String(options.id) }
    }
    configId = String(configId || '').trim()
    this._configId = configId
    this._entryOptions = options || {}
    var fromAgencyId = ''
    if (options && options.agencyId) {
      try { fromAgencyId = decodeURIComponent(String(options.agencyId)) } catch (e) { fromAgencyId = String(options.agencyId) }
    }
    this._fromAgencyId = String(fromAgencyId || '').trim()
    var fromAgencyName = ''
    if (options && options.agencyName) {
      try { fromAgencyName = decodeURIComponent(String(options.agencyName)) } catch (e) { fromAgencyName = String(options.agencyName) }
    }
    this._fromAgencyName = String(fromAgencyName || '').trim()
    if (configId) syncFavoriteState(this, 'rocket_model', configId)

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
    this.loadDetail(configId)
  },

  onShow() {
    const configId = (this.data.model && this.data.model.configId) || this._configId
    if (configId != null && String(configId) !== '') syncFavoriteState(this, 'rocket_model', configId)
  },

  async loadDetail(configId) {
    this.setData({ loading: true, errorMessage: '' })
    try {
      var results = await Promise.all([
        getRocketConfigMeta({ afterGate: true }),
        getBoosterGenealogy(),
        loadCloudMediaMap().catch(function () {})
      ])
      var configs = (results[0] && results[0].configs) || {}
      var cfg = configs[String(configId)]
      if (!cfg) {
        // 数据驱动兜底：_config_meta 尚未同步到该型号（LL2 新增构型）时按 id 直连 LL2 拉取
        cfg = await this.fetchConfigFromLl2(configId)
      }
      if (!cfg) {
        this._rocket3dBind = null
        this._exhibitCfg = null
        this.setData({ loading: false, errorMessage: '未找到该型号的档案数据（可能尚未同步）', rocket3dEnabled: false })
        return
      }
      this.processAndSetData(cfg, results[1] || [], configs)
    } catch (err) {
      console.error('[RocketModel] load error:', err)
      this._rocket3dBind = null
      this._exhibitCfg = null
      this.setData({ loading: false, errorMessage: '型号数据加载失败，请稍后重试', rocket3dEnabled: false })
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
          : '构型设计支持回收复用'
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

    // ── 旗下箭实体（configId 精确匹配，兜底 rocketFamily 英文名匹配） ──
    var processed = boosterDisplay.processBoosterList(boosterList, configsMap)
    this._rawBySerial = processed.rawBySerial
    var cfgId = cfg.id
    var nameLower = String(fullName).toLowerCase()
    var nameShortLower = String(cfg.name || '').toLowerCase()
    var fleet = processed.processed.filter(function (b) {
      if (b.configId != null && String(b.configId) === String(cfgId)) return true
      if (b.configId != null) return false
      var fam = String(b.rocketFamilyEn || b.rocketFamily || '').toLowerCase()
      return fam && (fam === nameLower || (nameShortLower && fam === nameShortLower))
    })
    fleet.sort(function (a, b) { return b.flights - a.flights })

    var nameDict = translateRocketName(cfg.name || '') || ''
    var fullDict = translateRocketName(fullName) || ''
    var nameZh = pickLocalized(cfg.nameZh || '', '') || nameDict || (cfg.name || '')
    var fullNameZh = pickLocalized(cfg.full_nameZh || '', '') || fullDict || fullName
    var mfrName = cfg.manufacturerName || ''
    var mfrAbbrev = cfg.manufacturerAbbrev || ''
    var mfrId = this._fromAgencyId || pickAgencyId(cfg.manufacturerId)
    var heroCandidates = []
    ;[cfg.cosImageUrl, cfg.thumbnail_url, cfg.image_url, getRocketImage(cfg.name || fullName)].forEach(function (u) {
      var s = String(u || '').trim()
      if (s && heroCandidates.indexOf(s) < 0) heroCandidates.push(s)
    })
    var model = {
      configId: cfg.id,
      nameEn: cfg.name || '',
      fullNameEn: fullName,
      name: nameZh,
      fullName: fullNameZh,
      alias: cfg.alias || '',
      variant: cfg.variant || '',
      manufacturer: mfrName,
      manufacturerAbbrev: mfrAbbrev,
      manufacturerId: mfrId,
      manufacturerDisplay: this._fromAgencyName || boosterDisplay.mfrDisplayName(
        mfrName,
        mfrAbbrev,
        cfg.manufacturerNameZh || ''
      ),
      countryCode: countryCode,
      countryFlag: boosterDisplay.countryCodeToFlag(countryCode),
      reusable: cfg.reusable === true,
      // 构型无图时兜底 COS 火箭配置图库（与族谱列表卡兜底链一致；查图用英文原名）
      imageUrl: heroCandidates[0] || '',
      imageFallbacks: heroCandidates.slice(1),
      imageCredit: cfg.imageCredit || '',
      // 默认英文原文；预翻译中文单独携带，首屏有 *Zh 则直接上中文
      description: cfg.description || '',
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
    var rocket3d = alignDedicatedRocket3d({
      fullNameEn: cfg.full_name || '',
      nameEn: cfg.name || '',
      fullName: fullNameZh,
      name: nameZh,
      alias: cfg.alias || ''
    })
    this._rocket3dBind = rocket3d
    this._exhibitCfg = pickExhibitConfig(cfg)

    this.setData(Object.assign({
      loading: false,
      model: model,
      boosterCards: fleet,
      navTitle: displayName,
      shareTitle: displayName + shareSuffix,
      rocket3dEnabled: !!rocket3d.aligned,
      isFavorited: !!(model.configId != null && isFavorite('rocket_model', model.configId)),
      favAnimate: false
    }, takeDescI18nSeed(this, { modelDesc: model.descriptionZh })))
    this._syncShareImage(model)
  },

  onToggleFavorite() {
    var model = this.data.model
    if (!model || model.configId == null) {
      wx.showToast({ title: '数据加载中，请稍后', icon: 'none' })
      return
    }
    try { wx.vibrateShort({ type: 'medium' }) } catch (e) {}
    var favorited = toggleFavorite({
      type: 'rocket_model',
      id: model.configId,
      title: model.fullName || model.name || '',
      subtitle: model.manufacturerDisplay || model.manufacturer || '',
      imageUrl: model.imageUrl || '',
      category: 'booster',
      route: ROUTES.ROCKET_MODEL_DETAIL + '?configId=' + encodeURIComponent(String(model.configId))
    })
    pulseFavAnimate(this, favorited)
    wx.showToast({ title: favorited ? '已收藏' : '已取消收藏', icon: 'none' })
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

  /** 底部悬浮 PK：带上当前型号，打开对比页（与任务详情同款） */
  onTapRocketCompare() {
    var model = this.data.model || {}
    if (model.configId == null) return
    try { wx.vibrateShort({ type: 'light' }) } catch (e) {}
    return openRocketCompare(model.configId)
  },

  /** 底部悬浮档案指数：PK 右侧（任务详情已有，族谱列表不加） */
  onTapRocketScore() {
    var model = this.data.model || {}
    if (model.configId == null) return
    try { wx.vibrateShort({ type: 'light' }) } catch (e) {}
    return openRocketScore(model.configId, {
      name: model.fullName || model.name || '',
      nameEn: model.fullNameEn || model.nameEn || ''
    })
  },

  /** 点击发射商标签 → 会员门控 → 图鉴详情（只带 LL2 id） */
  async onTapManufacturer() {
    var model = this.data.model || {}
    var agencyId = this._fromAgencyId || model.manufacturerId
    if (!agencyId) {
      wx.showToast({ title: '暂无该发射商档案', icon: 'none' })
      return
    }
    try { wx.vibrateShort({ type: 'medium' }) } catch (e) {}
    return openEncyclopediaAgency({ agencyId: agencyId })
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

  /** 头图 3D：只打开本型号对齐过的专用 GLB，不内嵌 WebGL */
  async onTapRocket3d() {
    try { wx.vibrateShort({ type: 'medium' }) } catch (e) {}
    if (this._rocket3dBusy) return
    var bind = this._rocket3dBind
    if (!bind || !bind.aligned || !bind.url) {
      wx.showToast({ title: '该型号暂无对应 3D 模型', icon: 'none' })
      return
    }
    var model = this.data.model || {}
    this._rocket3dBusy = true
    try {
      var allowed = await gateCheck('rocket_3d', '火箭 3D 模型', { allowAd: false })
      if (!allowed) return
      stashRocket3dSpecs({
        configId: model.configId || this._configId || '',
        detailConfig: this._exhibitCfg || null,
        specs: []
      })
      wx.navigateTo({
        url: buildRocket3dNavUrl(bind, {
          rocketName: model.fullName || model.name || '',
          rocketNameEn: model.fullNameEn || model.nameEn || '',
          poster: model.imageUrl || '',
          configId: model.configId || this._configId || ''
        }),
        fail() {
          wx.showToast({ title: '打开 3D 页失败', icon: 'none' })
        }
      })
    } catch (e) {
      wx.showToast({ title: '打开 3D 页失败', icon: 'none' })
    } finally {
      this._rocket3dBusy = false
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
    var ds = (e.currentTarget && e.currentTarget.dataset) || {}
    var serial = ds.serial
    var launcherId = ds.launcherId
    var card = (this.data.boosterCards || []).find(function (b) {
      return b && ((serial && String(b.serial) === String(serial)) ||
        (launcherId && String(b.launcherId || '') === String(launcherId)))
    })
    var raw = (serial && this._rawBySerial && this._rawBySerial[serial]) ||
      (card && card.serial && this._rawBySerial && this._rawBySerial[card.serial]) || null
    if (!serial && !launcherId && !(card && card.launcherId) && !(raw && raw.ll2Id)) return
    await openBoosterEntityDetail(serial, {
      raw: raw,
      ll2Id: launcherId || (card && card.launcherId) || (raw && raw.ll2Id) || '',
      heroImage: (card && (card.thumbnailUrl || card.imageUrl)) || ''
    })
  },

  async onRetryLoad() {
    var shareAllowed = await checkShareEntryGate(this, this._entryOptions || {}, 'booster_genealogy', '全球可回收火箭族谱')
    if (!shareAllowed) return
    if (this._configId) this.loadDetail(this._configId)
  },

  _shareImageOpts(model) {
    return rocketShareOptsFromModel(model || this.data.model)
  },

  _syncShareImage(model) {
    var opts = this._shareImageOpts(model)
    var url = pickRocketModelShareImageUrl(opts)
    if (this.data.shareImage !== url) this.setData({ shareImage: url })
    this.ensureShareImageHttpUrl(pickRocketModelShareSourceForDownload(opts))
  },

  ensureShareImageHttpUrl(imageUrl) {
    if (!imageUrl || typeof imageUrl !== 'string') return
    var trimmed = imageUrl.trim()
    if (!trimmed) return
    if (isLocalSharePath(trimmed)) {
      if (this.data.shareImage !== trimmed) this.setData({ shareImage: trimmed })
      return
    }
    if (this._shareImageSourceUrl === trimmed && this.data.shareImage && isLocalSharePath(this.data.shareImage)) {
      return
    }
    this._shareImageSourceUrl = trimmed
    var self = this
    wx.getImageInfo({
      src: trimmed,
      success: function (res) {
        if (res && res.path && self._shareImageSourceUrl === trimmed) {
          self.setData({ shareImage: res.path })
        }
      },
      fail: function () {
        if (self._shareImageSourceUrl === trimmed) self._shareImageSourceUrl = ''
      }
    })
  },

  _buildShareImage() {
    return this.data.shareImage || pickRocketModelShareImageUrl(this._shareImageOpts())
  },

  onShareAppMessage() {
    return {
      title: this.data.shareTitle,
      path: withShareStampPath('/subpackages/monitor-pages/rocket-model-detail?configId=' + encodeURIComponent(this._configId || ''), this),
      imageUrl: this._buildShareImage()
    }
  },

  onShareTimeline() {
    return {
      title: this.data.shareTitle,
      query: withShareStampQuery('configId=' + encodeURIComponent(this._configId || ''), this),
      imageUrl: this._buildShareImage()
    }
  }
})
