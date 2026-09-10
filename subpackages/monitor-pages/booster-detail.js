const pageBase = require('../../utils/page-base.js')
const { togglePageTranslation } = require('./utils/text-translate.js')
const { getRocketConfigMeta } = require('../../utils/api-app-services.js')
const boosterDisplay = require('./utils/booster-display.js')
const { openRocketModelDetail, openEncyclopediaAgency } = require('./utils/booster-nav.js')
const { checkShareEntryGate, warmShareEntitlement, withShareStampPath, withShareStampQuery } = require('./utils/share-gate.js')
const { pickLocalized } = require('../../utils/locale.js')
const { advanceImageFallback } = require('../../utils/ll2-image.js')
const {
  isLocalSharePath,
  pickRocketModelShareImageUrl,
  pickRocketModelShareSourceForDownload
} = require('./utils/rocket-model-share-image.js')
const { isFavorite, toggleFavorite, pulseFavAnimate, syncFavoriteState } = require('../../utils/favorites.js')

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
    shareImage: '',
    statusBarHeight: 44,
    navPlaceholderHeight: 0,
    tabBarReservedHeight: 0,
    menuButtonWidth: 88,
    isFavorited: false,
    favAnimate: false
  },

  async onLoad(options) {
    var serial = ''
    var ll2Id = ''
    if (options && options.serial) {
      try { serial = decodeURIComponent(String(options.serial)) } catch (e) { serial = String(options.serial) }
    }
    if (options && (options.ll2Id || options.launcherId)) {
      try { ll2Id = decodeURIComponent(String(options.ll2Id || options.launcherId)) } catch (e) {
        ll2Id = String(options.ll2Id || options.launcherId)
      }
    }
    if (!serial && options && options.id) {
      var rawId = ''
      try { rawId = decodeURIComponent(String(options.id)) } catch (e) { rawId = String(options.id) }
      rawId = String(rawId || '').trim()
      if (/^\d+$/.test(rawId)) ll2Id = ll2Id || rawId
      else serial = rawId
    }
    serial = String(serial || '').trim()
    ll2Id = String(ll2Id || '').trim()
    if (ll2Id === 'undefined' || ll2Id === 'null') ll2Id = ''
    this.initUiShell()
    this._serial = serial
    this._ll2Id = ll2Id
    this._entryOptions = options || {}
    if (serial) syncFavoriteState(this, 'booster', serial)

    // 分享卡片 24h 免门控窗口：过期后走 gateCheck（会员放行，非会员弹开通引导）
    var shareAllowed = await checkShareEntryGate(this, options, 'booster_genealogy', '全球可回收火箭族谱')
    if (!shareAllowed) {
      this.setData({ loading: false, errorMessage: '分享链接已过期，开通星际通行证后可继续查看' })
      return
    }
    warmShareEntitlement(this, 'booster_genealogy')

    if (!serial && !ll2Id) {
      this.setData({ loading: false, errorMessage: '缺少助推器参数，请返回重试' })
      return
    }

    this.setData({ loading: true, errorMessage: '', item: null, heroImageLoaded: false })
    this.loadDetail(serial, getApp(), ll2Id)
  },

  onShow() {
    const serial = (this.data.item && this.data.item.serial) || this._serial
    if (serial) syncFavoriteState(this, 'booster', serial)
  },

  loadDetail(serial, app, ll2Id) {
    serial = String(serial || '').trim()
    ll2Id = String(ll2Id != null ? ll2Id : (this._ll2Id || '')).trim()
    if (ll2Id === 'undefined' || ll2Id === 'null') ll2Id = ''

    function matchesPrefill(item) {
      if (!item) return false
      if (ll2Id && String(item.ll2Id || item.launcherId || '') === ll2Id) return true
      if (serial) {
        var s = String(item.serialNumber || item.serial || '')
        return s === serial || s.toUpperCase() === serial.toUpperCase()
      }
      return false
    }

    var raw = (app && app._boosterDetailData) || null
    if (matchesPrefill(raw)) {
      this.processAndSetData(raw)
      if (app) app._boosterDetailData = null
      return
    }

    var self = this
    var db = wx.cloud.database()

    function failNotFound() {
      var label = serial || (ll2Id ? ('#' + ll2Id) : '')
      self.setData({ loading: false, errorMessage: '未找到助推器 ' + label + ' 的数据' })
    }

    function failLoad() {
      self.setData({ loading: false, errorMessage: '助推器数据加载失败，请稍后重试' })
    }

    function findInList() {
      return require('../../utils/api-app-services.js').getBoosterGenealogy().then(function (list) {
        var rows = list || []
        var hit = (ll2Id && rows.find(function (b) {
          return String((b && (b.ll2Id || b.launcherId)) || '') === ll2Id
        })) || (serial && rows.find(function (b) {
          var s = String((b && (b.serialNumber || b.serial)) || '')
          return s === serial || s.toUpperCase() === serial.toUpperCase()
        })) || null
        if (hit) self.processAndSetData(hit)
        else failNotFound()
      }).catch(failLoad)
    }

    function tryWhereSerial() {
      if (!serial) return findInList()
      return db.collection('booster_genealogy')
        .where({ serialNumber: serial })
        .limit(1)
        .get()
        .then(function (res) {
          var row = res && res.data && res.data[0]
          if (row) {
            self.processAndSetData(row)
            return
          }
          return findInList()
        })
        .catch(failLoad)
    }

    function tryWhereLl2(next) {
      if (!ll2Id) return next()
      var attempts = []
      var numId = Number(ll2Id)
      if (Number.isFinite(numId) && String(numId) === ll2Id) attempts.push({ ll2Id: numId })
      attempts.push({ ll2Id: ll2Id })
      function run(i) {
        if (i >= attempts.length) return next()
        return db.collection('booster_genealogy')
          .where(attempts[i])
          .limit(1)
          .get()
          .then(function (res) {
            var row = res && res.data && res.data[0]
            if (row) self.processAndSetData(row)
            else run(i + 1)
          })
          .catch(function () { run(i + 1) })
      }
      return run(0)
    }

    function tryDocThenWhere() {
      if (!serial) return tryWhereLl2(tryWhereSerial)
      var docId = serial.replace(/[^a-zA-Z0-9_-]/g, '_')
      db.collection('booster_genealogy').doc(docId).get().then(function (res) {
        if (res && res.data && (res.data.serialNumber || res.data.serial || res.data.flights != null)) {
          if (ll2Id && res.data.ll2Id != null && String(res.data.ll2Id) !== ll2Id) {
            tryWhereLl2(function () { self.processAndSetData(res.data) })
            return
          }
          self.processAndSetData(res.data)
        } else {
          tryWhereLl2(tryWhereSerial)
        }
      }).catch(function () {
        tryWhereLl2(tryWhereSerial)
      })
    }

    if (ll2Id) tryWhereLl2(function () { tryDocThenWhere() })
    else tryDocThenWhere()
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

    // 中国箭飞行史：展示「失利」而非「失败」
    var failWord = (String(raw.countryCode || '').toUpperCase() === 'CN') ? '失利' : '失败'
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
        successText: isSuccess ? '成功' : (isFailed ? failWord : '待定')
      }
    })

    var status = raw.status || 'unknown'
    // 与族谱/监控卡同一套 processBoosterItem 图链，避免详情跳过 thumbnail 导致「卡有图详无图」
    var cardImg = boosterDisplay.processBoosterItem(raw, null, { skipImageCache: true })
    var heroPassed = null
    try {
      var appRef = typeof getApp === 'function' ? getApp() : null
      if (appRef && appRef._boosterHeroImage &&
          String(appRef._boosterHeroImage.serial || '').toUpperCase() === String(cardImg.serial || '').toUpperCase()) {
        heroPassed = appRef._boosterHeroImage.src || ''
      }
      if (appRef) appRef._boosterHeroImage = null
    } catch (e) {}
    var primaryImage = heroPassed || cardImg.imageUrl || raw.cosImageUrl || raw.thumbnailUrl || raw.imageUrl || ''
    var imageFallbacks = (cardImg.imageFallbacks || []).slice()
    // 卡面图已作 primary 时，把其余链接到 fallback，避免重复
    if (heroPassed && cardImg.imageUrl && heroPassed !== cardImg.imageUrl) {
      imageFallbacks = [cardImg.imageUrl].concat(imageFallbacks).filter(function (u, i, arr) {
        return u && arr.indexOf(u) === i && u !== heroPassed
      })
    }
    var item = {
      serial: raw.serialNumber || raw.serial || '?',
      flights: flights,
      status: status,
      statusText: statusTextMap[status] || '未知',
      statusColor: statusColorMap[status] || '#8E8E93',
      rocketFamilyEn: raw.rocketFamily || 'Unknown',
      rocketFamily: pickLocalized(raw.rocketFamilyZh || '', raw.rocketFamily || 'Unknown'),
      // LL2 构型 id：型号标签跳 rocket-model-detail 用；无则标签退化为纯文本
      configId: raw.configId != null ? raw.configId : null,
      manufacturer: raw.manufacturer || '',
      // 展示用中文名（与发射商详情页同源词典）；manufacturer 保留原文供跳转解析
      manufacturerDisplay: boosterDisplay.mfrDisplayName(
        raw.manufacturer || '',
        '',
        raw.manufacturerZh || ''
      ),
      block: raw.block || null,
      imageUrl: primaryImage,
      thumbnailUrl: primaryImage,
      imageFallbacks: imageFallbacks,
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

    this._serial = item.serial && item.serial !== '?' ? item.serial : this._serial
    if (item.ll2Id != null) this._ll2Id = String(item.ll2Id)

    this.setData({
      loading: false,
      item: item,
      isFavorited: isFavorite('booster', item.serial),
      navTitle: item.serial + ' 详情',
      shareTitle: item.serial + ' ' + item.rocketFamily + ' | 火星探索日志'
    })
    this._syncShareImage(item)

    // 保留 raw 供头图 binderror 链耗尽后异步兜底
    this._rawForHeroFallback = raw

    // 箭实体无自带图时兜底：LL2 构型图 → COS 火箭配置图库（与族谱列表卡兜底链一致）
    if (!item.imageUrl) this._applyHeroImageFallback(raw, item)
  },

  _applyHeroImageFallback(raw, item) {
    var self = this
    // 查图必须用英文族名（COS/构型索引按 LL2 原文）；界面展示用已汉化的 rocketFamily
    var familyEn = (item && item.rocketFamilyEn) || (raw && raw.rocketFamily) || ''
    var applyCos = function () {
      var url = boosterDisplay.cosRocketImageOf(familyEn)
      if (url) {
        self.setData({ 'item.imageUrl': url })
        self._syncShareImage(Object.assign({}, self.data.item || item || {}, { imageUrl: url }))
      }
    }
    getRocketConfigMeta({ afterGate: true }).then(function (meta) {
      var url = boosterDisplay.configImageOf(raw.configId, familyEn, (meta && meta.configs) || {})
      if (url) {
        self.setData({ 'item.imageUrl': url })
        self._syncShareImage(Object.assign({}, self.data.item || item || {}, { imageUrl: url }))
      } else if (raw.configId == null || String(raw.configId).trim() === '') {
        applyCos()
      }
    }).catch(applyCos)
  },

  // goBack inherited from pageBase

  async onRetryLoad() {
    var shareAllowed = await checkShareEntryGate(this, this._entryOptions || {}, 'booster_genealogy', '全球可回收火箭族谱')
    if (!shareAllowed) return
    if (this._serial || this._ll2Id) {
      this.setData({ loading: true, errorMessage: '', item: null, heroImageLoaded: false })
      this.loadDetail(this._serial, getApp(), this._ll2Id)
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

  /** 点击型号标签 → 会员门控 → 族谱火箭型号详情页（与族谱型号卡同链路） */
  async onTapRocketFamily() {
    var item = this.data.item || {}
    if (item.configId == null) return
    try { wx.vibrateShort({ type: 'medium' }) } catch (e) {}
    await openRocketModelDetail(item.configId)
  },

  /** 点击发射商标签 → 全球发射商图鉴对应机构 */
  async onTapManufacturer() {
    var item = this.data.item || {}
    if (!item.manufacturerId) {
      wx.showToast({ title: '暂无该发射商档案', icon: 'none' })
      return
    }
    try { wx.vibrateShort({ type: 'medium' }) } catch (e) {}
    return openEncyclopediaAgency({ agencyId: item.manufacturerId })
  },

  onHeroImageLoad() {
    this.setData({ heroImageLoaded: true, heroImageFailed: false })
  },

  onHeroImageError() {
    var item = this.data.item || {}
    var advanced = advanceImageFallback(item.imageUrl, item.imageFallbacks)
    if (advanced.next) {
      this.setData({
        heroImageLoaded: false,
        heroImageFailed: false,
        'item.imageUrl': advanced.next,
        'item.imageFallbacks': advanced.remaining
      })
      this._syncShareImage(Object.assign({}, item, {
        imageUrl: advanced.next,
        imageFallbacks: advanced.remaining
      }))
      return
    }
    // 链耗尽：再尝试构型/COS 异步兜底（与列表卡一致）
    this.setData({ heroImageLoaded: false, 'item.imageUrl': '' })
    if (this._rawForHeroFallback) {
      this._applyHeroImageFallback(this._rawForHeroFallback, item)
    } else {
      this.setData({ heroImageFailed: true })
    }
  },

  onHeroImageTap() {
    var item = this.data.item
    if (item && item.imageUrl) {
      wx.previewImage({ current: item.imageUrl, urls: [item.imageUrl] })
    }
  },

  onToggleFavorite() {
    var item = this.data.item
    if (!item || !item.serial) {
      wx.showToast({ title: '数据加载中，请稍后', icon: 'none' })
      return
    }
    try { wx.vibrateShort({ type: 'medium' }) } catch (e) {}
    var favorited = toggleFavorite({
      type: 'booster',
      id: item.serial,
      title: item.serial,
      subtitle: item.rocketFamily || '',
      imageUrl: item.imageUrl || '',
      category: 'booster',
      extra: {
        ll2Id: item.ll2Id != null ? String(item.ll2Id) : (this._ll2Id || '')
      }
    })
    pulseFavAnimate(this, favorited)
    wx.showToast({ title: favorited ? '已收藏' : '已取消收藏', icon: 'none' })
  },

  _shareImageOpts(item) {
    var it = item || this.data.item || {}
    var fallbacks = Array.isArray(it.imageFallbacks) ? it.imageFallbacks.slice() : []
    return {
      displayImage: it.imageUrl || it.thumbnailUrl || '',
      rawImage: fallbacks[0] || it.imageUrl || '',
      fallbacks: fallbacks,
      rocketName: it.rocketFamilyEn || it.rocketFamily || ''
    }
  },

  _syncShareImage(item) {
    var opts = this._shareImageOpts(item)
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
    var item = this.data.item
    var serial = (item && item.serial && item.serial !== '?') ? item.serial : this._serial
    var ll2Id = (item && item.ll2Id != null) ? item.ll2Id : this._ll2Id
    var q = []
    if (serial) q.push('serial=' + encodeURIComponent(serial))
    if (ll2Id) q.push('ll2Id=' + encodeURIComponent(ll2Id))
    return {
      title: this.data.shareTitle,
      path: q.length
        ? withShareStampPath('/subpackages/monitor-pages/booster-detail?' + q.join('&'), this)
        : '/pages/monitor/monitor',
      imageUrl: this._buildShareImage()
    }
  },

  onShareTimeline() {
    var item = this.data.item
    var serial = (item && item.serial && item.serial !== '?') ? item.serial : this._serial
    var ll2Id = (item && item.ll2Id != null) ? item.ll2Id : this._ll2Id
    var q = []
    if (serial) q.push('serial=' + encodeURIComponent(serial))
    if (ll2Id) q.push('ll2Id=' + encodeURIComponent(ll2Id))
    return {
      title: this.data.shareTitle,
      query: q.length ? withShareStampQuery(q.join('&'), this) : '',
      imageUrl: this._buildShareImage()
    }
  }
})
