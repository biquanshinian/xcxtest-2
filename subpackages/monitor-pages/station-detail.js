const { getStationStatus } = require('../../utils/api-monitor-data.js')
const { ROUTES, navigateTo } = require('../../utils/routes.js')
const { gateCheck } = require('../../utils/membership.js')
const pageBase = require('../../utils/page-base.js')
const { togglePageTranslation } = require('./utils/text-translate.js')
const { runPullRefresh } = require('../../utils/pull-refresh.js')
const { advanceImageFallback } = require('../../utils/ll2-image.js')
const {
  STATION_MARKER_ICON, resolveNoradId, pickStationTle,
  createSatrec, getCurrentPosition, computeOrbitPath,
  computePastOrbitPath, getOrbitalParams, getLookAngles,
  getPositionAndLookAngles,
  formatSpeed, formatAltitude, formatCoord
} = require('./station-orbit.js')

Page({
  behaviors: [pageBase],
  _fallbackTab: '/pages/monitor/monitor',
  data: {
    loading: true,
    errorMessage: '',
    item: null,
    isTiangong: false,
    heroImageLoaded: false,
    heroImageFailed: false,
    descExpanded: false,
    descTranslated: false,
    descTranslating: false,
    descI18n: { stationDesc: '' },
    navTitle: '空间站详情',
    shareTitle: '空间站详情 | 火星探索日志',
    statusBarHeight: 44,
    navPlaceholderHeight: 0,
    scrollRefreshing: false,
    tabBarReservedHeight: 0,
    menuButtonWidth: 88,
    // ===== 轨道追踪 =====
    orbitReady: false,
    orbitLoading: false,
    orbitError: '',
    stationLat: 0,
    stationLng: 0,
    stationAlt: '--',
    stationSpeed: '--',
    stationCoord: '--',
    mapLatitude: 20,
    mapLongitude: 0,
    mapScale: 3,
    mapMarkers: [],
    mapPolylines: [],
    orbitPeriod: '--',
    orbitInclination: '--',
    orbitApogee: '--',
    orbitPerigee: '--',
    orbitMeanMotion: '--',
    orbitEccentricity: '--',
    orbitEpoch: '--',
    lookAzimuth: '--',
    lookElevation: '--',
    lookRange: '--',
    _rawAzimuth: 0,
    _rawElevation: 0,
    _rawRange: 0,
    _lookAnimCtrl: 0,
    hasUserLocation: false,
    tleUpdateTime: '--',
    orbitMapExpanded: true,
    orbitParamsExpanded: false
  },

  _satrec: null,
  _posTimer: null,
  _orbitTimer: null,
  _stationId: null,

  async onLoad(options) {
    const id = options.id ? String(options.id).trim() : ''
    this._stationId = id

    // 如果源页面传递了封面图 URL，立即展示 Hero 大图（不等 API 返回）
    let preloadImage = options.image ? decodeURIComponent(options.image) : ''
    let preloadFallbacks = []
    try {
      const app = getApp()
      const passed = app && app._stationHeroImage
      if (passed && String(passed.id) === String(id)) {
        if (passed.src) preloadImage = passed.src
        preloadFallbacks = Array.isArray(passed.fallbacks) ? passed.fallbacks.slice() : []
        app._stationHeroImage = null
      }
    } catch (e) {}
    if (preloadImage) {
      this.setData({
        item: { image: preloadImage, imageFallbacks: preloadFallbacks },
        isTiangong: Number(id) === 18
      })
    } else if (id) {
      this.setData({ isTiangong: Number(id) === 18 })
    }

    this.initUiShell()

    if (!id) {
      this.setData({ loading: false, errorMessage: '缺少空间站参数，请返回重试' })
      return
    }

    await this.loadDetail(id)
  },

  onUnload() {
    this.stopOrbitTracking()
  },

  onHide() {
    this.stopOrbitTracking()
  },

  onShow() {
    if (this._satrec && this.data.orbitReady) {
      this.startPositionUpdater()
      this.startOrbitRefresher()
    }
  },

  async loadDetail(id, opts = {}) {
    // silent（下拉刷新）：已有内容时不回退到加载骨架，只显示微信原生刷新指示器
    if (!(opts.silent && this.data.item)) {
      this.setData({ loading: true, errorMessage: '', heroImageLoaded: false, heroImageFailed: false })
    }
    try {
      // 并行发起：空间站列表 + 轨道数据
      const numId = Number(id)
      const noradId = resolveNoradId(numId)
      const stationPromise = getStationStatus()
      const tlePromise = noradId ? this.fetchStationTLE() : Promise.resolve(null)

      const stationList = await stationPromise
      const item = (stationList || []).find(s => String(s.id) === String(id)) || null
      if (!item) throw new Error('未找到对应空间站信息')
      // 卡面已展示成功的图优先保留，避免 API 链首失败图把已成功头图冲掉
      const showing = this.data.item && this.data.item.image
      let merged = item
      if (showing && showing !== item.image) {
        const fb = [item.image].concat(item.imageFallbacks || []).filter((u, i, arr) => {
          return u && u !== showing && arr.indexOf(u) === i
        })
        merged = Object.assign({}, item, { image: showing, imageFallbacks: fb })
      }
      this.setData({
        loading: false,
        item: merged,
        isTiangong: Number(merged.id) === 18,
        navTitle: '空间站详情',
        shareTitle: `${merged.name || '空间站详情'} | 火星探索日志`
      })

      // 轨道数据在后台继续处理
      this._applyOrbitData(numId, noradId, tlePromise)
    } catch (error) {
      // 下拉刷新失败：保留上次成功数据，避免整页被错误态抹掉
      if (opts.silent && this.data.item) {
        this.setData({ loading: false })
        try {
          wx.showToast({ title: '刷新失败，仍显示缓存数据', icon: 'none' })
        } catch (e) {}
        return
      }
      this.setData({
        loading: false,
        errorMessage: (error && (error.errMsg || error.message)) || '空间站详情加载失败，请稍后重试'
      })
    }
  },

  async _applyOrbitData(stationId, noradId, tlePromise) {
    if (!noradId) {
      this.setData({ orbitError: '该空间站暂不支持轨道追踪' })
      return
    }
    this.setData({ orbitLoading: true, orbitError: '' })
    try {
      let tleData = await tlePromise
      let tle = pickStationTle(tleData, noradId)
      // 本地/云库缓存可能只有 ISS：目标站缺失时强制走 Worker，与 ISS 行为对齐
      if (!tle) {
        tleData = await this.fetchFromWorker(true).catch(() => null)
        tle = pickStationTle(tleData, noradId)
        if (tleData && tleData.tle) {
          try { wx.setStorageSync('_station_tle_cache', { data: tleData, ts: Date.now() }) } catch (e) {}
        }
      }
      if (!tle) {
        throw new Error('未获取到 TLE 数据')
      }
      const satrec = createSatrec(tle.line1, tle.line2)
      if (!satrec) throw new Error('TLE 数据解析失败')
      this._satrec = satrec

      const params = getOrbitalParams(satrec)
      const tleTs = tleData && tleData.ts
      const tleUpdateTime = tleTs ? this.formatTleTime(tleTs) : '--'

      const paramPatch = params ? {
        orbitPeriod: params.period + ' 分钟',
        orbitInclination: params.inclination + '°',
        orbitApogee: params.apogee + ' km',
        orbitPerigee: params.perigee + ' km',
        orbitMeanMotion: params.meanMotion + ' 圈/天',
        orbitEccentricity: params.eccentricity,
        orbitEpoch: params.epoch
      } : {}

      this.setData({
        orbitLoading: false,
        orbitReady: true,
        tleUpdateTime,
        ...paramPatch
      })

      this.tryGetUserLocation()
      this.updatePosition()
      this.updateOrbitLines()
      this.startPositionUpdater()
      this.startOrbitRefresher()
    } catch (error) {
      this.setData({
        orbitLoading: false,
        orbitError: (error && error.message) || '轨道数据加载失败'
      })
    }
  },

  fetchStationTLE() {
    const CACHE_KEY = '_station_tle_cache'
    const CACHE_TTL = 10 * 60 * 1000 // 10 分钟

    // 先查本地缓存
    try {
      const cached = wx.getStorageSync(CACHE_KEY)
      if (cached && cached.ts && (Date.now() - cached.ts < CACHE_TTL) && cached.data) {
        // 后台静默刷新
        this._silentRefreshFromWorker()
        return Promise.resolve(cached.data)
      }
    } catch (e) {}

    // 优先云数据库（< 500ms），后台静默更新 Worker
    const self = this
    return this.fetchFromCloudDB().then(dbData => {
      // 写入本地缓存
      try { wx.setStorageSync(CACHE_KEY, { data: dbData, ts: Date.now() }) } catch (e) {}
      self._silentRefreshFromWorker()
      return dbData
    }).catch(() => {
      // 云数据库无数据（首次），回退 Worker
      return self.fetchFromWorker().then(workerData => {
        try { wx.setStorageSync(CACHE_KEY, { data: workerData, ts: Date.now() }) } catch (e) {}
        return workerData
      })
    })
  },

  _silentRefreshFromWorker() {
    // 后台静默请求 Worker，成功后写入云数据库供下次使用
    this.fetchFromWorker().then(workerData => {
      if (!workerData || !workerData.tle) return
      const db = wx.cloud.database()
      const record = {
        tle: workerData.tle,
        source: 'Worker-silent',
        fetchedAt: workerData.ts || Date.now(),
        updatedAtMs: Date.now(),
        stationCount: Object.keys(workerData.tle).filter(k => workerData.tle[k]).length
      }
      db.collection('station_tle').where({ recordId: 'latest' }).limit(1).get().then(res => {
        if (res.data && res.data.length > 0) {
          db.collection('station_tle').doc(res.data[0]._id).update({ data: record }).catch(() => {})
        } else {
          db.collection('station_tle').add({ data: { recordId: 'latest', ...record } }).catch(() => {})
        }
      }).catch(() => {})
    }).catch(() => {})
  },

  fetchFromWorker(force) {
    const { fetchStationTleFromWorker } = require('./utils/tle-fetch.js')
    return fetchStationTleFromWorker(force ? { force: true } : undefined)
  },

  fetchFromCloudDB() {
    const db = wx.cloud.database()
    return db.collection('station_tle').where({ recordId: 'latest' }).limit(1).get().then(res => {
      if (!res.data || !res.data.length || !res.data[0].tle) {
        throw new Error('云数据库无 TLE 数据')
      }
      const record = res.data[0]
      return {
        code: 0,
        ts: record.fetchedAt || record.updatedAtMs || Date.now(),
        tle: record.tle
      }
    })
  },

  formatTleTime(ts) {
    const d = new Date(ts)
    if (isNaN(d.getTime())) return '--'
    const pad = n => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  },

  updatePosition() {
    if (!this._satrec) return
    const hasLoc = this.data.hasUserLocation && this._userLat !== undefined
    const result = hasLoc
      ? getPositionAndLookAngles(this._satrec, this._userLat, this._userLng, 0)
      : getCurrentPosition(this._satrec)
    if (!result) return

    const altText = formatAltitude(result.alt) + ' km'
    const speedText = formatSpeed(result.speed) + ' km/h'
    const coordText = formatCoord(result.lat, result.lng)
    const stationName = this.data.item ? this.data.item.name : '空间站'

    // 差量 setData：只推变化的字段
    const patch = {}
    if (result.lat !== this.data.stationLat) patch.stationLat = result.lat
    if (result.lng !== this.data.stationLng) patch.stationLng = result.lng
    if (altText !== this.data.stationAlt) patch.stationAlt = altText
    if (speedText !== this.data.stationSpeed) patch.stationSpeed = speedText
    if (coordText !== this.data.stationCoord) patch.stationCoord = coordText

    // 观测角：传递原始数值（供 WXS 插值动画使用）
    if (hasLoc && result.azimuth !== null) {
      const az = Math.round(result.azimuth * 10) / 10
      const el = Math.round(result.elevation * 10) / 10
      const rng = Math.round(result.rangeSat * 10) / 10
      if (az !== this.data._rawAzimuth) patch._rawAzimuth = az
      if (el !== this.data._rawElevation) patch._rawElevation = el
      if (rng !== this.data._rawRange) patch._rawRange = rng
    }

    // 首次：创建 marker 并自动定位到空间站；后续：只用 translateMarker 平滑移动
    if (!this._markerCreated) {
      patch.mapMarkers = [this._buildMarker(result, stationName, altText, speedText)]
      patch.mapLatitude = result.lat
      patch.mapLongitude = result.lng
      patch.mapScale = 5
      this._markerCreated = true
      this.setData(patch)
    } else {
      if (Object.keys(patch).length > 0) this.setData(patch)
      this._smoothMoveMarker(result, stationName, altText, speedText)
    }
  },

  _calloutStyle() {
    const light = !!this.data.themeLight
    return light
      ? {
          bgColor: 'rgba(255,255,255,0.92)',
          color: '#248A3D',
          borderColor: 'rgba(52,199,89,0.35)'
        }
      : {
          bgColor: 'rgba(0,0,0,0.82)',
          color: '#00ff88',
          borderColor: 'rgba(0,255,136,0.4)'
        }
  },

  _buildMarker(pos, name, altText, speedText) {
    const style = this._calloutStyle()
    return {
      id: 1,
      latitude: pos.lat,
      longitude: pos.lng,
      iconPath: STATION_MARKER_ICON,
      width: 20,
      height: 20,
      callout: {
        content: name + '\n' + altText + ' · ' + speedText,
        display: 'ALWAYS',
        fontSize: 11,
        borderRadius: 10,
        padding: 8,
        bgColor: style.bgColor,
        color: style.color,
        borderWidth: 1,
        borderColor: style.borderColor,
        textAlign: 'center'
      }
    }
  },

  _smoothMoveMarker(pos, name, altText, speedText) {
    const style = this._calloutStyle()
    const callout = {
      content: name + '\n' + altText + ' · ' + speedText,
      display: 'ALWAYS',
      fontSize: 11,
      borderRadius: 10,
      padding: 8,
      bgColor: style.bgColor,
      color: style.color,
      borderWidth: 1,
      borderColor: style.borderColor,
      textAlign: 'center'
    }
    // 预览地图的 translateMarker
    if (!this._mapCtx) {
      this._mapCtx = wx.createMapContext('orbitMapPreview', this)
    }
    if (this._mapCtx) {
      this._mapCtx.translateMarker({
        markerId: 1,
        destination: { latitude: pos.lat, longitude: pos.lng },
        duration: 900,
        autoRotate: false,
        callout,
        fail: () => {
          // translateMarker 失败时回退到 setData
          this.setData({
            mapMarkers: [this._buildMarker(pos, name, altText, speedText)]
          })
        }
      })
    }
  },

  updateOrbitLines() {
    if (!this._satrec) return
    const futureSegments = computeOrbitPath(this._satrec, 92, 30)
    const pastSegments = computePastOrbitPath(this._satrec, 45, 30)
    const polylines = []

    pastSegments.forEach(seg => {
      polylines.push({
        points: seg,
        color: '#4ea1ff66',
        width: 3,
        dottedLine: true
      })
    })

    futureSegments.forEach(seg => {
      polylines.push({
        points: seg,
        color: '#00ff88',
        width: 3,
        dottedLine: false
      })
    })

    this.setData({ mapPolylines: polylines })
  },

  startPositionUpdater() {
    this.stopPositionUpdater()
    this._posTimer = setInterval(() => { this.updatePosition() }, 1000)
  },

  stopPositionUpdater() {
    if (this._posTimer) { clearInterval(this._posTimer); this._posTimer = null }
  },

  startOrbitRefresher() {
    this.stopOrbitRefresher()
    this._orbitTimer = setInterval(() => { this.updateOrbitLines() }, 180000)
  },

  stopOrbitRefresher() {
    if (this._orbitTimer) { clearInterval(this._orbitTimer); this._orbitTimer = null }
  },

  stopOrbitTracking() {
    this.stopPositionUpdater()
    this.stopOrbitRefresher()
    this._mapCtx = null
    this._markerCreated = false
    this._stopLookAngleAnim()
  },

  _stopLookAngleAnim() {
    this.setData({ _lookAnimCtrl: Date.now() })
  },

  tryGetUserLocation() {
    wx.getFuzzyLocation({
      type: 'wgs84',
      success: (res) => {
        this._userLat = res.latitude
        this._userLng = res.longitude
        this.setData({ hasUserLocation: true })
      },
      fail: () => { this.setData({ hasUserLocation: false }) }
    })
  },

  // WXS 插值动画回调：在渲染层每帧更新后同步显示值
  _wxsUpdateLookAngles(data) {
    this.setData({
      lookAzimuth: data.az,
      lookElevation: data.el,
      lookRange: data.rng
    })
  },

  toggleOrbitMap() {
    this.setData({ orbitMapExpanded: !this.data.orbitMapExpanded })
  },

  toggleOrbitParams() {
    this.setData({ orbitParamsExpanded: !this.data.orbitParamsExpanded })
  },

  openOrbitMap() {
    const id = (this.data.item && this.data.item.id != null) ? this.data.item.id : this._stationId
    const name = encodeURIComponent((this.data.item && this.data.item.name) || '空间站')
    let url = `${ROUTES.ORBIT_MAP}?stationId=${id}&stationName=${name}`
    // 把详情页已算出的实时坐标带过去，全屏图一打开就对准空间站，无需再找
    if (this._markerCreated && Number.isFinite(this.data.stationLat) && Number.isFinite(this.data.stationLng)) {
      url += `&lat=${this.data.stationLat}&lng=${this.data.stationLng}`
    }
    wx.navigateTo({ url })
  },

  centerOnStation() {
    // 纬度可为 0（赤道附近），不能用真值判断
    if (!Number.isFinite(this.data.stationLat) || !Number.isFinite(this.data.stationLng)) return
    if (!this._markerCreated) return
    this.setData({
      mapLatitude: this.data.stationLat,
      mapLongitude: this.data.stationLng,
      mapScale: 4
    })
  },

  refreshOrbitData() {
    if (this.data.orbitLoading) return
    const id = this._stationId
    if (!id) return
    const numId = Number(id)
    const noradId = resolveNoradId(numId)
    if (!noradId) {
      this.setData({ orbitError: '该空间站暂不支持轨道追踪' })
      return
    }
    this.stopOrbitTracking()
    try { wx.removeStorageSync('_station_tle_cache') } catch (e) {}
    this._applyOrbitData(numId, noradId, this.fetchStationTLE())
  },

  retryOrbitLoad() {
    this.refreshOrbitData()
  },

  // ===== 原有方法 =====

  retryLoad() {
    const pages = getCurrentPages()
    const currentPage = pages[pages.length - 1]
    const options = (currentPage && currentPage.options) || {}
    const id = options.id ? String(options.id).trim() : ''
    if (!id) return
    this.loadDetail(id)
  },

  /** 原生三点下拉刷新：重读云缓存空间站详情 + 刷新实时轨道 */
  onScrollRefresh() {
    this._runStationDetailPullRefresh('scrollRefreshing')
  },

  onPullDownRefresh() {
    this._runStationDetailPullRefresh()
  },

  _runStationDetailPullRefresh(key) {
    const id = this._stationId
    runPullRefresh(this, () => {
      if (!id) return Promise.resolve()
      return this.loadDetail(id, { silent: true })
    }, key)
  },

  // goBack inherited from pageBase

  /** 停靠飞船卡片点击 → 飞船详情页（LL2 构型 id；与发射商详情页跳飞船详情行为一致，不做门控） */
  onShipTap(e) {
    const ds = (e.currentTarget && e.currentTarget.dataset) || {}
    if (ds.cid == null || ds.cid === '') return
    try { wx.vibrateShort({ type: 'medium' }) } catch (err) {}
    navigateTo(ROUTES.SPACECRAFT_DETAIL, { id: ds.cid, name: ds.name || '' })
  },

  /** 所属机构卡片点击 → 会员门控 → 发射商详情页（优先 id，回退缩写/名称） */
  async onOwnerAgencyTap(e) {
    const ds = (e.currentTarget && e.currentTarget.dataset) || {}
    if (!ds.id && !ds.abbrev && !ds.name) return
    try { wx.vibrateShort({ type: 'medium' }) } catch (err) {}
    const allowed = await gateCheck('agency_encyclopedia', '全球发射商图鉴')
    if (!allowed) return
    let params
    if (ds.id) params = { id: ds.id }
    else if (ds.abbrev) params = { abbrev: ds.abbrev }
    else params = { name: ds.name }
    navigateTo(ROUTES.AGENCY_DETAIL, params)
  },

  onHeroImageLoad() {
    this.setData({ heroImageLoaded: true, heroImageFailed: false })
  },

  onHeroImageError() {
    const item = this.data.item || {}
    const advanced = advanceImageFallback(item.image, item.imageFallbacks)
    if (advanced.next) {
      this.setData({
        heroImageLoaded: false,
        heroImageFailed: false,
        'item.image': advanced.next,
        'item.imageFallbacks': advanced.remaining
      })
      return
    }
    // 链耗尽才启用 CSS 视觉兜底（与卡片「清空」不同：详情仍有视觉层）
    this.setData({ heroImageLoaded: false, heroImageFailed: true })
  },

  toggleDescription() {
    this.setData({ descExpanded: !this.data.descExpanded })
  },

  /** 空间站简介「翻译/原文」 */
  onToggleDescTranslate() {
    if (this.data.descTranslating) return
    const item = this.data.item || {}
    togglePageTranslation(this, {
      switchKey: 'descTranslated',
      loadingKey: 'descTranslating',
      fields: [{ path: 'descI18n.stationDesc', text: item.description || '' }]
    })
  },

  onCrewAvatarTap(e) {
    const url = e.currentTarget.dataset.url
    if (!url) return
    wx.previewImage({ current: url, urls: [url] })
  },

  onShipImageTap(e) {
    const url = e.currentTarget.dataset.url
    if (!url) return
    wx.previewImage({ current: url, urls: [url] })
  },

  copyText(e) {
    const text = e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.text : ''
    if (!text) return
    wx.setClipboardData({
      data: String(text),
      success: () => { wx.showToast({ title: '已复制', icon: 'success' }) }
    })
  },

  onShareAppMessage() {
    const item = this.data.item
    return {
      title: this.data.shareTitle,
      path: item ? `/subpackages/monitor-pages/station-detail?id=${item.id}` : '/pages/monitor/monitor',
      imageUrl: item && item.image ? item.image : ''
    }
  },

  onShareTimeline() {
    const item = this.data.item
    return {
      title: this.data.shareTitle,
      query: item ? `id=${item.id}` : '',
      imageUrl: item && item.image ? item.image : ''
    }
  }
})
