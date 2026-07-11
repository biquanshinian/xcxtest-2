const pageBase = require('../../utils/page-base.js')
const { ROUTES } = require('../../utils/routes.js')
const { isVideoUrl } = require('../../utils/cos-url.js')
const { enrichVideoMediaItem, playEventVideo } = require('../../utils/event-video.js')
const {
  fetchArtemisIiBriefing,
  shouldShowArtemisArowSection,
  getArtemisLaunchMs,
  getArtemisMissionPhase,
  getArtemisMissionSummary
} = require('./utils/artemis-arow.js')
const {
  artemisArow: ARTEMIS_CFG
} = require('../../utils/config.js')

// stub — filled below
const pad2 = (n) => String(n).padStart(2, '0')
const fmtInt = (n) => {
  if (!Number.isFinite(n)) return '—'
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}
const fmtRate = (n) => {
  if (n == null || !Number.isFinite(n)) return '—'
  return n.toFixed(4)
}
const fmtDeg = (n) => {
  if (n == null || !Number.isFinite(n)) return '—'
  return n.toFixed(2)
}
// 四元数 → 欧拉角 (°)
const quatToEuler = (qw, qx, qy, qz) => {
  if (qw == null || qx == null || qy == null || qz == null) return null
  const r2d = 180 / Math.PI
  const sinr = 2 * (qw * qx + qy * qz)
  const cosr = 1 - 2 * (qx * qx + qy * qy)
  const roll = Math.atan2(sinr, cosr) * r2d
  const sinp = 2 * (qw * qy - qz * qx)
  const pitch = Math.abs(sinp) >= 1 ? (Math.sign(sinp) * 90) : (Math.asin(sinp) * r2d)
  const siny = 2 * (qw * qz + qx * qy)
  const cosy = 1 - 2 * (qy * qy + qz * qz)
  const yaw = Math.atan2(siny, cosy) * r2d
  return { roll: fmtDeg(roll), pitch: fmtDeg(pitch), yaw: fmtDeg(yaw) }
}

Page({
  behaviors: [pageBase],
  _fallbackTab: '/pages/monitor/monitor',
  data: {
    loading: true,
    errorMsg: '',
    missionPhase: 'active',
    missionSummary: null,
    met: '—',
    velocityKmh: '—',
    distEarthKm: '—',
    distMoonKm: '—',
    altitudeKm: '—',
    rates: null,
    euler: null,
    orbitParams: null,
    power: null,
    rcsItems: [],
    solarDetail: null,
    commMode: '',
    detailExpanded: false,
    nasaTweets: [],
    nasaTweetsExpanded: true,
    nasaTweetsHasMore: false,
    enableEventVideo: false,
    statusItems: [],
    updatedAt: '',
    creditLines: [],
    statusBarHeight: 44,
    navPlaceholderHeight: 0
  },

  _raw: null,
  _interpTimer: null,
  _pollTimer: null,

  onLoad() {
    this.initUiShell()
    const phase = getArtemisMissionPhase()
    this.setData({
      missionPhase: phase
    })
    if (phase !== 'active') {
      this.setData({ loading: false, missionSummary: getArtemisMissionSummary() })
      return
    }
    this._fetchData(true)
    this._loadNasaTweets(true)
    this._loadEventVideoConfig()
  },

  onShow() {
    if (this._raw) this._startInterp()
    if (!this._pollTimer) this._startPoll()
  },

  onHide() {
    this._stopInterp()
    this._stopPoll()
  },

  onUnload() {
    this._stopInterp()
    this._stopPoll()
    this._orbitCtx = null
    this._orbitCanvas = null
  },

  // goBack inherited from pageBase

  toggleDetailExpand() {
    this.setData({ detailExpanded: !this.data.detailExpanded })
  },

  toggleNasaTweets() {
    this.setData({ nasaTweetsExpanded: !this.data.nasaTweetsExpanded })
  },

  openNasaTweetDetail(e) {
    const id = e.currentTarget.dataset.id
    if (id) {
      wx.navigateTo({ url: ROUTES.EVENT_DETAIL + '?id=' + id })
    }
  },

  onNasaVideoTap(e) {
    const ds = e.currentTarget.dataset || {}
    const url = ds.url
    const eventId = ds.eventid || ''
    const mIdx = ds.midx
    const videoUrl = ds.videourl || ''
    const isLong = !!ds.islong
    if (!url && !ds.playurl) return
    // 长视频未存储，点击直接复制视频直链
    if (isLong || videoUrl) {
      wx.setClipboardData({
        data: videoUrl || url,
        success() { wx.showToast({ title: '视频链接已复制，请在浏览器中打开', icon: 'none', duration: 2500 }) }
      })
      return
    }
    if (isVideoUrl(url) || isVideoUrl(ds.playurl)) {
      if (eventId) {
        wx.navigateTo({ url: ROUTES.EVENT_DETAIL + '?id=' + encodeURIComponent(eventId) + '&autoPlayVideo=' + mIdx })
      } else {
        playEventVideo({
          url,
          playUrl: ds.playurl || url,
          originalUrl: ds.original || url,
          thumb: ds.thumb || '',
          canSave: false
        })
      }
      return
    }
    wx.setClipboardData({
      data: url,
      success() { wx.showToast({ title: '链接已复制，请在浏览器中打开', icon: 'none', duration: 2500 }) }
    })
  },

  onNasaImagePreview(e) {
    const urls = e.currentTarget.dataset.urls || []
    const current = e.currentTarget.dataset.current || ''
    if (urls.length) {
      wx.previewImage({ urls, current })
    }
  },

  loadMoreNasaTweets() {
    this._loadNasaTweets(false)
  },

  _nasaTweetsPage: 0,

  async _loadEventVideoConfig() {
    try {
      const db = wx.cloud.database()
      const res = await db.collection('global_config').doc('main').get()
      const cfg = res && res.data ? res.data : null
      if (cfg) {
        this.setData({ enableEventVideo: cfg.enableEventVideo !== false })
      }
    } catch (e) {}
  },

  async _loadNasaTweets(refresh) {
    try {
      const db = wx.cloud.database()
      const limit = 10
      const skip = refresh ? 0 : (this._nasaTweetsPage || 0) * limit
      const res = await db.collection('starship_event_updates')
        .where({
          status: 'published',
          author: db.RegExp({ regexp: 'NASA', options: 'i' })
        })
        .orderBy('publishedAt', 'desc')
        .skip(skip)
        .limit(limit)
        .get()

      const pad2 = (n) => String(n).padStart(2, '0')
      const fmtTime = (t) => {
        if (!t) return ''
        const d = new Date(t)
        return d.getFullYear() + '/' + pad2(d.getMonth() + 1) + '/' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes())
      }

      const newItems = (res.data || []).map(item => {
        const enrichedMedia = (item.mediaList || []).map(m => {
          if (m.type !== 'video') return m
          return enrichVideoMediaItem(m)
        })
        return {
          ...item,
          publishedAtText: fmtTime(item.publishedAt),
          mediaList: enrichedMedia,
          imageUrls: enrichedMedia.filter(m => m.type === 'image').map(m => m.url)
        }
      })

      const merged = refresh ? newItems : this.data.nasaTweets.concat(newItems)
      this._nasaTweetsPage = refresh ? 1 : (this._nasaTweetsPage || 0) + 1
      this.setData({
        nasaTweets: merged,
        nasaTweetsHasMore: newItems.length >= limit
      })
    } catch (e) {
      console.warn('NASA tweets load error', e)
    }
  },

  retryLoad() {
    this._fetchData(true)
  },

  openArowOfficial() {
    wx.setClipboardData({
      data: 'https://www.nasa.gov/missions/artemis-ii/arow/',
      success: () => wx.showToast({ title: 'AROW 链接已复制', icon: 'none', duration: 2500 })
    })
  },

  // ========== 数据获取 ==========
  async _fetchData(showLoading) {
    if (showLoading) this.setData({ loading: true, errorMsg: '' })
    try {
      const data = await fetchArtemisIiBriefing()
      if (!data || !data.ok) {
        this.setData({ loading: false, errorMsg: (data && data.error) || '数据不可用' })
        return
      }
      // 飞船状态
      const statusItems = []
      if (data.solar) {
        const solarVals = data.solar.wing1 || []
        statusItems.push({ label: '太阳能板', active: solarVals.some(v => v != null && v > 0) })
      }
      if (data.thrusters) {
        statusItems.push({ label: '推进器', active: Object.values(data.thrusters).some(v => v > 0) })
      }
      statusItems.push({ label: '遥测链路', active: true })

      let ratesData = null
      if (data.rates && (data.rates.roll != null || data.rates.pitch != null)) {
        ratesData = { roll: fmtRate(data.rates.roll), pitch: fmtRate(data.rates.pitch), yaw: fmtRate(data.rates.yaw) }
      }

      // 姿态四元数 → 欧拉角
      let eulerData = null
      if (data.attitude) {
        eulerData = quatToEuler(data.attitude.qw, data.attitude.qx, data.attitude.qy, data.attitude.qz)
      }

      // 轨道参数
      let orbitParams = null
      if (data.orbit) {
        const o = data.orbit
        orbitParams = {
          latitude: fmtDeg(o.latitude),
          longitude: fmtDeg(o.longitude),
          heading: fmtDeg(o.heading),
          flightPathAngle: fmtDeg(o.flightPathAngle),
          rightAscension: fmtDeg(o.rightAscension),
          declination: fmtDeg(o.declination)
        }
      }

      // 电力系统
      let powerData = null
      if (data.power && (data.power.busVoltage1 != null)) {
        powerData = {
          v1: fmtDeg(data.power.busVoltage1),
          v2: fmtDeg(data.power.busVoltage2),
          v3: fmtDeg(data.power.busVoltage3)
        }
      }

      // RCS
      let rcsItems = []
      if (data.rcs) {
        const names = ['RCS-1', 'RCS-2', 'RCS-3', 'RCS-4', 'RCS-5']
        const vals = [data.rcs.r1, data.rcs.r2, data.rcs.r3, data.rcs.r4, data.rcs.r5]
        rcsItems = vals.map((v, i) => ({ label: names[i], active: v != null && v > 0 }))
      }

      // 太阳能板详细
      let solarDetail = null
      if (data.solar) {
        const fmtCh = (arr) => (arr || []).map(v => v != null ? v.toFixed(2) : '—')
        solarDetail = [
          { name: '翼 A', channels: fmtCh(data.solar.wing1) },
          { name: '翼 B', channels: fmtCh(data.solar.wing2) },
          { name: '翼 C', channels: fmtCh(data.solar.wing3) }
        ]
      }

      // 通信模式
      const commMode = data.commMode != null ? String(data.commMode) : ''

      // 距月球
      const distMoonVal = data.distanceToMoonKm != null ? data.distanceToMoonKm : null

      this.setData({
        loading: false,
        errorMsg: '',
        met: data.missionElapsedText || '—',
        velocityKmh: fmtInt(data.velocityKmh),
        distEarthKm: fmtInt(data.distanceFromEarthKm),
        distMoonKm: distMoonVal != null ? fmtInt(distMoonVal) : '—',
        altitudeKm: fmtInt(data.altitudeKm),
        rates: ratesData,
        euler: eulerData,
        orbitParams,
        power: powerData,
        rcsItems,
        solarDetail,
        commMode,
        statusItems,
        updatedAt: data.updatedAtLabel || '',
        creditLines: Array.isArray(data.creditLines) ? data.creditLines : []
      })

      this._raw = {
        velocityKmh: data.velocityKmh || 0,
        distEarthKm: data.distanceFromEarthKm || 0,
        distMoonKm: distMoonVal,
        altitudeKm: data.altitudeKm || null,
        posKm: data.posKm || null,
        snapshotMs: Date.now()
      }
      this._startInterp()
      this._drawOrbit(data.posKm)
    } catch (e) {
      this.setData({ loading: false, errorMsg: '网络异常，请稍后重试' })
    }
  },

  // ========== 轮询 ==========
  _startPoll() {
    this._stopPoll()
    const ms = Math.max(12000, Number((ARTEMIS_CFG || {}).pollIntervalMs) || 15000)
    this._pollTimer = setInterval(() => this._fetchData(false), ms)
  },
  _stopPoll() {
    if (this._pollTimer) { clearInterval(this._pollTimer); this._pollTimer = null }
  },

  // ========== 每秒插值 ==========
  _startInterp() {
    this._stopInterp()
    this._interpTick()
    this._interpTimer = setInterval(() => this._interpTick(), 1000)
  },
  _stopInterp() {
    if (this._interpTimer) { clearInterval(this._interpTimer); this._interpTimer = null }
  },
  _interpTick() {
    const raw = this._raw
    if (!raw) return
    const now = Date.now()
    const dtS = (now - raw.snapshotMs) / 1000
    const launchMs = getArtemisLaunchMs()

    // MET
    let met = '—'
    if (isFinite(launchMs) && now >= launchMs) {
      let s = Math.floor((now - launchMs) / 1000)
      const d = Math.floor(s / 86400); s -= d * 86400
      const h = Math.floor(s / 3600); s -= h * 3600
      const m = Math.floor(s / 60); s -= m * 60
      met = pad2(d) + ':' + pad2(h) + ':' + pad2(m) + ':' + pad2(s)
    }

    const vKmS = raw.velocityKmh / 3600
    const distEarth = raw.distEarthKm + vKmS * dtS
    // 距月球：用 Worker 返回的真实三维距离插值
    let distMoon = null
    if (raw.distMoonKm != null) {
      // 飞向月球时距离减小，用速率近似插值
      distMoon = Math.max(0, raw.distMoonKm - vKmS * dtS)
    }

    const update = {
      met,
      velocityKmh: fmtInt(raw.velocityKmh),
      distEarthKm: fmtInt(distEarth)
    }
    if (distMoon != null) update.distMoonKm = fmtInt(distMoon)
    this.setData(update)

    // 每秒重绘 canvas（距离标注同步）
    this._redrawOrbit(distEarth)
  },

  // ========== 2D 轨道 Canvas ==========
  _drawOrbit(posKm) {
    if (!posKm) return
    const query = this.createSelectorQuery()
    query.select('#artemisOrbitCanvas')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (!res || !res[0] || !res[0].node) return
        const canvas = res[0].node
        const dpr = wx.getWindowInfo().pixelRatio || 2
        const w = res[0].width
        const h = res[0].height
        canvas.width = w * dpr
        canvas.height = h * dpr
        // 缓存 canvas 引用
        this._orbitCanvas = canvas
        this._orbitCtx = canvas.getContext('2d')
        this._orbitDpr = dpr
        this._orbitW = w
        this._orbitH = h
        const distCenter = Math.sqrt(posKm.x * posKm.x + posKm.y * posKm.y + posKm.z * posKm.z)
        this._redrawOrbit(Math.max(0, distCenter - 6371))
      })
  },

  _redrawOrbit(distFromEarthKm) {
    const ctx = this._orbitCtx
    if (!ctx) return
    const dpr = this._orbitDpr
    const w = this._orbitW
    const h = this._orbitH

    ctx.save()
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)

    const pad = 40, centerY = h / 2
    const earthX = pad + 20, moonX = w - pad - 20
    const trackLen = moonX - earthX
    const EARTH_MOON_KM = 384400
    const EARTH_RADIUS_KM = 6371
    // distFromEarthKm 是地表距离，加回地球半径得到地心距离用于画图比例
    const distCenter = (distFromEarthKm || 0) + EARTH_RADIUS_KM
    const dist = distFromEarthKm || 0
    const ratio = Math.min(Math.max(distCenter / EARTH_MOON_KM, 0.02), 0.98)
    const orionX = earthX + trackLen * ratio

    // 星空
    ctx.fillStyle = 'rgba(255,255,255,0.12)'
    for (let i = 0; i < 50; i++) {
      ctx.beginPath()
      ctx.arc((Math.sin(i * 137.5) * 0.5 + 0.5) * w, (Math.cos(i * 73.1) * 0.5 + 0.5) * h, 0.8, 0, Math.PI * 2)
      ctx.fill()
    }

    // 虚线轨道
    ctx.setLineDash([4, 4])
    ctx.strokeStyle = 'rgba(90,200,250,0.25)'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(earthX, centerY)
    ctx.quadraticCurveTo(earthX + trackLen * 0.5, centerY - 25, moonX, centerY)
    ctx.stroke()
    ctx.setLineDash([])

    // 已走轨道
    ctx.strokeStyle = 'rgba(90,200,250,0.6)'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(earthX, centerY)
    const oy = centerY - 25 * ratio * (1 - ratio) * 2
    ctx.quadraticCurveTo(earthX + (orionX - earthX) * 0.5, centerY - 25 * ratio, orionX, oy)
    ctx.stroke()

    // 地球
    const eg = ctx.createRadialGradient(earthX - 3, centerY - 3, 2, earthX, centerY, 14)
    eg.addColorStop(0, '#5AC8FA'); eg.addColorStop(0.6, '#34AADC'); eg.addColorStop(1, '#1a6b9c')
    ctx.beginPath(); ctx.arc(earthX, centerY, 14, 0, Math.PI * 2); ctx.fillStyle = eg; ctx.fill()
    ctx.beginPath(); ctx.arc(earthX, centerY, 18, 0, Math.PI * 2)
    ctx.strokeStyle = 'rgba(90,200,250,0.2)'; ctx.lineWidth = 3; ctx.stroke()

    // 月球
    const mg = ctx.createRadialGradient(moonX - 2, centerY - 2, 1, moonX, centerY, 10)
    mg.addColorStop(0, '#E5E5EA'); mg.addColorStop(0.7, '#AEAEB2'); mg.addColorStop(1, '#636366')
    ctx.beginPath(); ctx.arc(moonX, centerY, 10, 0, Math.PI * 2); ctx.fillStyle = mg; ctx.fill()

    // 猎户座光点（涟漪用 CSS 实现）
    const og = ctx.createRadialGradient(orionX, oy, 0, orionX, oy, 8)
    og.addColorStop(0, 'rgba(255,214,10,0.9)'); og.addColorStop(1, 'rgba(255,214,10,0)')
    ctx.beginPath(); ctx.arc(orionX, oy, 5, 0, Math.PI * 2); ctx.fillStyle = og; ctx.fill()
    // 实心核心
    ctx.beginPath(); ctx.arc(orionX, oy, 3, 0, Math.PI * 2); ctx.fillStyle = '#FFD60A'; ctx.fill()

    // 更新涟漪位置（百分比，供 WXML 定位）
    this.setData({
      _orionLeft: ((orionX / w) * 100).toFixed(2),
      _orionTop: ((oy / h) * 100).toFixed(2)
    })

    // 标注
    ctx.font = '10px -apple-system, sans-serif'; ctx.textAlign = 'center'
    ctx.fillStyle = '#8E8E93'
    ctx.fillText('地球', earthX, centerY + 28)
    ctx.fillText('月球', moonX, centerY + 24)

    // 猎户座距离（实时数字）
    ctx.fillStyle = '#FFD60A'; ctx.font = '9px -apple-system, sans-serif'
    const distText = Math.round(dist).toLocaleString() + ' km'
    ctx.fillText(distText, orionX, oy - 12)
    ctx.fillText('猎户座', orionX, oy + 16)

    // 进度
    ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.textAlign = 'right'; ctx.font = '9px -apple-system, sans-serif'
    ctx.fillText(Math.round(ratio * 100) + '%', w - 8, h - 6)

    ctx.restore()
  },

  onShareAppMessage() {
    return {
      title: 'Artemis II 实时遥测 | 火星探索日志',
      path: '/subpackages/monitor-pages/artemis-detail'
    }
  },

  onShareTimeline() {
    return {
      title: 'Artemis II 实时遥测 | 火星探索日志'
    }
  }
})
