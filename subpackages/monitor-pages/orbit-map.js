const pageBase = require('../../utils/page-base.js')
const { buildMapLayoutData } = require('./utils/map-page-common.js')
const {
  STATION_MARKER_ICON, resolveNoradId, pickStationTle,
  createSatrec, getCurrentPosition, getPositionAt,
  getOrbitalParams, getLookAngles,
  formatSpeed, formatAltitude, formatCoord
} = require('./station-orbit.js')

Page({
  behaviors: [pageBase],
  _fallbackTab: '/pages/monitor/monitor',
  data: {
    statusBarHeight: 44,
    capsuleTop: 0,
    capsuleHeight: 32,
    mapActionTop: 0,
    latitude: 20,
    longitude: 0,
    scale: 3,
    markers: [],
    polylines: [],
    stationName: '空间站',
    stationCoord: '--',
    stationAlt: '--',
    stationSpeed: '--',
    orbitReady: false,
    orbitPeriod: '--',
    orbitInclination: '--',
    orbitApogee: '--',
    orbitPerigee: '--',
    lookRange: '--',
    hasUserLocation: false,
    tleUpdateTime: '--',
    panelCollapsed: true,
    actionMenuCollapsed: true,
    refreshing: false
  },

  _satrec: null,
  _posTimer: null,
  _centerTimer: null,
  _mapCtx: null,
  _markerCreated: false,
  _seedCentered: false,
  _stationId: null,
  _pageAlive: true,
  _fullOrbitPoints: null,  // 预计算的完整轨道点（含时间戳）
  _orbitBuiltAt: 0,        // 轨道点构建时间，用于判断是否需要重建

  onLoad(options) {
    this._pageAlive = true
    this.initUiShell()
    const app = getApp()
    this.setData(buildMapLayoutData(app))

    this._stationId = options.stationId || ''
    let name = '空间站'
    try {
      name = decodeURIComponent(options.stationName || '空间站')
    } catch (e) {
      name = options.stationName || '空间站'
    }
    const seedLat = options.lat != null ? Number(options.lat) : NaN
    const seedLng = options.lng != null ? Number(options.lng) : NaN
    const patch = { stationName: name }
    // 详情页传入坐标时立刻居中，不等 TLE；否则保持世界总览，等首次定位
    if (Number.isFinite(seedLat) && Number.isFinite(seedLng)) {
      patch.latitude = seedLat
      patch.longitude = seedLng
      patch.scale = 5
      this._seedCentered = true
    }
    this.setData(patch)

    this.loadOrbitData()
  },

  onUnload() {
    this._pageAlive = false
    this.stopTracking()
  },

  onHide() {
    this.stopTracking()
  },

  onShow() {
    if (this._satrec && this.data.orbitReady) {
      this.startPositionUpdater()
    }
  },

  async loadOrbitData() {
    const noradId = resolveNoradId(this._stationId)
    if (!noradId) return

    try {
      let tleData = await this.fetchTLE()
      let tle = pickStationTle(tleData, noradId)
      // 云库/缓存可能只有 ISS：天宫缺失时再拉 Worker，保证两站默认可用
      if (!tle) {
        const { fetchStationTleFromWorker } = require('./utils/tle-fetch.js')
        tleData = await fetchStationTleFromWorker({ force: true }).catch(() => null)
        tle = pickStationTle(tleData, noradId)
      }
      if (!tle) return

      const satrec = createSatrec(tle.line1, tle.line2)
      if (!satrec) return
      this._satrec = satrec

      const params = getOrbitalParams(satrec)
      const tleUpdateTime = tleData && tleData.ts ? this.fmtTime(tleData.ts) : '--'

      this.setData({
        orbitReady: true,
        tleUpdateTime,
        ...(params ? {
          orbitPeriod: params.period + ' 分钟',
          orbitInclination: params.inclination + '°',
          orbitApogee: params.apogee + ' km',
          orbitPerigee: params.perigee + ' km'
        } : {})
      })

      this.tryGetUserLocation()
      this.updatePosition()
      this._buildFullOrbitPoints()
      this._splitOrbitByTime()
      this.startPositionUpdater()
      // 进入全屏即对准空间站（有种子坐标也再校正一次到最新 TLE 位置）
      this.centerOnStation()
    } catch (e) {
      console.warn('[orbit-map] loadOrbitData failed:', e && e.message)
    }
  },

  fetchTLE() {
    // 优先云数据库
    const db = wx.cloud.database()
    return db.collection('station_tle').where({ recordId: 'latest' }).limit(1).get().then(res => {
      if (res.data && res.data.length && res.data[0].tle) {
        return { code: 0, ts: res.data[0].fetchedAt || res.data[0].updatedAtMs || Date.now(), tle: res.data[0].tle }
      }
      throw new Error('no db data')
    }).catch(() => {
      const { fetchStationTleFromWorker } = require('./utils/tle-fetch.js')
      return fetchStationTleFromWorker()
    })
  },

  fmtTime(ts) {
    const d = new Date(ts)
    if (isNaN(d.getTime())) return '--'
    const p = n => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
  },

  updatePosition() {
    if (!this._pageAlive || !this._satrec) return
    const pos = getCurrentPosition(this._satrec)
    if (!pos) return

    const altText = formatAltitude(pos.alt) + ' km'
    const speedText = formatSpeed(pos.speed) + ' km/h'
    const coordText = formatCoord(pos.lat, pos.lng)
    const name = this.data.stationName

    const patch = {
      stationAlt: altText,
      stationSpeed: speedText,
      stationCoord: coordText
    }

    if (this.data.hasUserLocation && this._userLat !== undefined) {
      const look = getLookAngles(this._satrec, this._userLat, this._userLng, 0)
      if (look) patch.lookRange = look.rangeSat + ' km'
    }

    if (!this._markerCreated) {
      // 首次出点：未带种子坐标时在此对准；已带种子则只挂 marker，保持已居中视角
      patch.markers = [this._buildMarker(pos, name, altText, speedText)]
      if (!this._seedCentered) {
        patch.latitude = pos.lat
        patch.longitude = pos.lng
        patch.scale = 5
      }
      this._markerCreated = true
      this.setData(patch)
    } else {
      this.setData(patch)
      this._smoothMove(pos, name, altText, speedText)
    }

    // 实时切分轨道线：图标走到哪，虚线就跟到哪
    this._splitOrbitByTime()

    // 每 5 分钟重建完整轨道点（补充新的未来轨迹）
    if (this._orbitBuiltAt && Date.now() - this._orbitBuiltAt > 5 * 60 * 1000) {
      this._buildFullOrbitPoints()
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

  _smoothMove(pos, name, altText, speedText) {
    if (!this._mapCtx) this._mapCtx = wx.createMapContext('orbitMap', this)
    if (!this._mapCtx) return
    const style = this._calloutStyle()
    this._mapCtx.translateMarker({
      markerId: 1,
      destination: { latitude: pos.lat, longitude: pos.lng },
      duration: 1800,
      autoRotate: false,
      callout: {
        content: name + '\n' + altText + ' · ' + speedText,
        display: 'ALWAYS', fontSize: 11, borderRadius: 10, padding: 8,
        bgColor: style.bgColor, color: style.color,
        borderWidth: 1, borderColor: style.borderColor, textAlign: 'center'
      },
      fail: () => {
        this.setData({ markers: [this._buildMarker(pos, name, altText, speedText)] })
      }
    })
  },

  // ---- 轨道线：预计算 + 实时按时间切分虚实 ----

  _buildFullOrbitPoints() {
    if (!this._satrec) return
    const now = Date.now()
    const pastMinutes = 45
    const futureMinutes = 92
    const stepSeconds = 30
    const points = []
    const startMs = now - pastMinutes * 60 * 1000
    const endMs = now + futureMinutes * 60 * 1000
    for (let t = startMs; t <= endMs; t += stepSeconds * 1000) {
      const pos = getPositionAt(this._satrec, new Date(t))
      if (!pos) continue
      points.push({ latitude: pos.lat, longitude: pos.lng, time: t })
    }
    this._fullOrbitPoints = points
    this._orbitBuiltAt = now
  },

  _splitOrbitByTime() {
    if (!this._fullOrbitPoints || !this._fullOrbitPoints.length) return
    const now = Date.now()

    // 轨道点步长 30s：分界点索引没变时 polyline 内容不变，跳过整条线的 setData
    let splitIdx = 0
    while (splitIdx < this._fullOrbitPoints.length && this._fullOrbitPoints[splitIdx].time <= now) splitIdx++
    if (this._lastOrbitSplitIdx === splitIdx && this._orbitBuiltAt === this._lastOrbitBuiltAtUsed) return
    this._lastOrbitSplitIdx = splitIdx
    this._lastOrbitBuiltAtUsed = this._orbitBuiltAt

    const pastPoints = []
    const futurePoints = []
    this._fullOrbitPoints.forEach(function (p) {
      if (p.time <= now) {
        pastPoints.push({ latitude: p.latitude, longitude: p.longitude })
      } else {
        futurePoints.push({ latitude: p.latitude, longitude: p.longitude })
      }
    })
    const pastSegs = this._splitByDateline(pastPoints)
    const futureSegs = this._splitByDateline(futurePoints)
    const polylines = []
    pastSegs.forEach(function (seg) {
      polylines.push({ points: seg, color: '#4ea1ff66', width: 3, dottedLine: true })
    })
    futureSegs.forEach(function (seg) {
      polylines.push({ points: seg, color: '#00ff88', width: 3, dottedLine: false })
    })
    this.setData({ polylines: polylines })
  },

  _splitByDateline(points) {
    var segments = []
    var seg = []
    var prevLng = null
    points.forEach(function (p) {
      if (prevLng !== null && Math.abs(p.longitude - prevLng) > 180) {
        if (seg.length > 1) segments.push(seg)
        seg = []
      }
      seg.push(p)
      prevLng = p.longitude
    })
    if (seg.length > 1) segments.push(seg)
    return segments
  },

  startPositionUpdater() {
    this.stopPositionUpdater()
    this._posTimer = setInterval(() => { this.updatePosition() }, 2000)
  },
  stopPositionUpdater() {
    if (this._posTimer) { clearInterval(this._posTimer); this._posTimer = null }
  },
  stopTracking() {
    this.stopPositionUpdater()
    if (this._centerTimer) {
      clearTimeout(this._centerTimer)
      this._centerTimer = null
    }
    this._mapCtx = null
    this._markerCreated = false
  },

  tryGetUserLocation() {
    wx.getFuzzyLocation({
      type: 'wgs84',
      success: (res) => {
        if (!this._pageAlive) return
        this._userLat = res.latitude
        this._userLng = res.longitude
        this.setData({ hasUserLocation: true })
      },
      fail: () => {
        if (!this._pageAlive) return
        this.setData({ hasUserLocation: false })
      }
    })
  },

  // 地图操作
  centerOnStation() {
    if (!this._pageAlive) return
    const pos = this._satrec ? getCurrentPosition(this._satrec) : null
    const lat = pos ? pos.lat : this.data.latitude
    const lng = pos ? pos.lng : this.data.longitude
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return
    // 同值时部分机型不刷新镜头：先微偏再回正
    const scale = 5
    if (this._centerTimer) {
      clearTimeout(this._centerTimer)
      this._centerTimer = null
    }
    if (this.data.latitude === lat && this.data.longitude === lng && this.data.scale === scale) {
      this.setData({ latitude: lat + 0.00001, longitude: lng, scale })
      this._centerTimer = setTimeout(() => {
        this._centerTimer = null
        if (!this._pageAlive) return
        this.setData({ latitude: lat, longitude: lng, scale })
      }, 32)
      return
    }
    this.setData({ latitude: lat, longitude: lng, scale })
  },

  resetMapView() {
    this.setData({ latitude: 20, longitude: 0, scale: 3 })
  },

  refreshOrbitData() {
    if (this.data.refreshing) return
    this.setData({ refreshing: true })
    this.stopTracking()
    this.loadOrbitData().finally(() => {
      if (this._pageAlive) this.setData({ refreshing: false })
    })
  },

  togglePanel() {
    this.setData({ panelCollapsed: !this.data.panelCollapsed })
  },

  toggleActionMenu() {
    this.setData({ actionMenuCollapsed: !this.data.actionMenuCollapsed })
  },

  // goBack inherited from pageBase
})
