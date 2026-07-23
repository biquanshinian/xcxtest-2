/**
 * 在轨飞行器追踪 · 独立详情页（SpaceX 风格全屏 HUD）
 *
 * 数据层 / 渲染器与 ODC 控制台共用：
 *   ../utils/vehicle-tracker-data.js
 *   ../utils/vehicle-tracker-renderer.js
 */

const vtData = require('../utils/vehicle-tracker-data.js')
const shareGate = require('../utils/share-gate.js')

const GATE_PRODUCT_ID = 'orbital_data_center'
const GATE_PRODUCT_NAME = '在轨飞行器追踪'
const POLL_MS = 10000

const SYS_INFO = wx.getSystemInfoSync ? wx.getSystemInfoSync() : { statusBarHeight: 44 }

let MENU_BUTTON_INFO = null
try {
  MENU_BUTTON_INFO = wx.getMenuButtonBoundingClientRect ? wx.getMenuButtonBoundingClientRect() : null
} catch (e) { MENU_BUTTON_INFO = null }

function calcNavBarHeight(statusBarHeight) {
  if (MENU_BUTTON_INFO && MENU_BUTTON_INFO.top && MENU_BUTTON_INFO.height) {
    const top = MENU_BUTTON_INFO.top - statusBarHeight
    return top * 2 + MENU_BUTTON_INFO.height
  }
  return 44
}

// ── Starlink 圆轨道物理模型（SIMULATED 模式驱动源） ──
const ORBIT = {
  altitude: 550,
  inclination: 53.0,
  period: 95.6 * 60,
  initialLon: -97.156,
  earthRadius: 6371,
  mu: 398600.4418,
  earthRotRate: 7.2921159e-5
}

const ORBIT_T0 = Date.now()

function computeSatellitePosition(now) {
  const elapsed = (now - ORBIT_T0) / 1000
  const incRad = ORBIT.inclination * Math.PI / 180
  const meanMotion = 2 * Math.PI / ORBIT.period
  const u = (meanMotion * elapsed) % (2 * Math.PI)

  const lat = Math.asin(Math.sin(incRad) * Math.sin(u))
  const lonOnPlane = Math.atan2(Math.cos(incRad) * Math.sin(u), Math.cos(u))

  let lon = ORBIT.initialLon * Math.PI / 180 + lonOnPlane - ORBIT.earthRotRate * elapsed
  while (lon > Math.PI) lon -= 2 * Math.PI
  while (lon < -Math.PI) lon += 2 * Math.PI

  const r = ORBIT.earthRadius + ORBIT.altitude
  const velocity = Math.sqrt(ORBIT.mu / r)
  const altitude = ORBIT.altitude + Math.sin(u * 2) * 0.5

  return {
    lat: lat * 180 / Math.PI,
    lon: lon * 180 / Math.PI,
    alt: altitude,
    vel: velocity
  }
}

function pickFeatured(list, cur, userPicked) {
  if (!list || !list.length) return null
  const curValid = cur && list.some(v => v.id === cur)
  if (curValid && userPicked) return list.find(v => v.id === cur)
  // 官网偏好：优先星舰；有在轨 active 时优先 active 星舰
  const activeShip = list.find(v => /^ship/.test(v.id) && v.active)
  if (activeShip) return activeShip
  const ship = list.find(v => /^ship/.test(v.id))
  if (ship) return ship
  const active = list.find(v => v.active)
  return active || list[0]
}

Page({
  forceDarkTheme: true,

  data: {
    statusBarHeight: SYS_INFO.statusBarHeight || 44,
    navBarHeight: calcNavBarHeight(SYS_INFO.statusBarHeight || 44),
    enabled: true,
    disabledText: '',
    momentsHint: false,
    shareGateExpireAt: 0,
    vtVehicles: [],
    vtFeatured: '',
    vtMissionTime: 'T+ 0D 00:00',
    vtSpeed: '--',
    vtAltitude: '--',
    vtMode: 'LIVE',
    vtLoading: true
  },

  _lockDarkChrome() {
    try {
      wx.setNavigationBarColor({
        frontColor: '#ffffff',
        backgroundColor: '#000000',
        fail: () => {}
      })
    } catch (e) {}
    try {
      wx.setBackgroundColor({
        backgroundColor: '#000000',
        backgroundColorTop: '#000000',
        backgroundColorBottom: '#000000'
      })
    } catch (e) {}
  },

  _isMomentsSinglePage() {
    try {
      const enter = (typeof wx.getEnterOptionsSync === 'function' && wx.getEnterOptionsSync()) || wx.getLaunchOptionsSync()
      return !!enter && enter.scene === 1154
    } catch (e) {
      return false
    }
  },

  onLoad(options) {
    wx.setNavigationBarTitle({ title: '在轨飞行器追踪' })
    this._lockDarkChrome()
    if (this._isMomentsSinglePage()) {
      this.setData({ momentsHint: true, enabled: false })
      this._gatePromise = Promise.resolve(false)
      return
    }
    wx.showShareMenu({ menus: ['shareAppMessage', 'shareTimeline'] })
    this._gatePromise = shareGate.checkShareEntryGate(this, options, GATE_PRODUCT_ID, GATE_PRODUCT_NAME)
      .then((allowed) => {
        if (!allowed) {
          this.setData({ enabled: false, disabledText: '分享链接已过期，开通星际通行证后可继续查看' })
          return false
        }
        shareGate.warmShareEntitlement(this, GATE_PRODUCT_ID)
        return true
      })
      .catch(() => {
        this.setData({ enabled: false, disabledText: '暂时无法验证访问权限，请稍后重试' })
        return false
      })
  },

  async onReady() {
    const allowed = this._gatePromise ? await this._gatePromise : false
    if (!allowed || this._vtDestroyed || this.data.momentsHint) return
    this._initVehicleTracker()
  },

  async _initVehicleTracker() {
    try {
      const { VehicleTrackerRenderer } = require('../utils/vehicle-tracker-renderer.js')
      this._vtRenderer = new VehicleTrackerRenderer()
      await this._vtRenderer.bindCanvas(this, '#vtCanvas')
    } catch (e) {
      this._vtRenderer = null
      if (!this._vtDestroyed) this.setData({ vtLoading: false })
      return
    }
    if (this._vtDestroyed) return
    this._vtVehicles = []
    this._vtMode = ''
    this._vtChipsSig = ''
    await this._vtPoll()
    if (this._vtDestroyed || this._vtHidden) return
    this._startVtTimers()
  },

  _startVtTimers() {
    this._stopVtTimers()
    this._vtTickTimer = setInterval(() => this._vtTick(), 1000)
    this._vtPollTimer = setInterval(() => { this._vtPoll() }, POLL_MS)
  },

  _stopVtTimers() {
    if (this._vtTickTimer) clearInterval(this._vtTickTimer)
    if (this._vtPollTimer) clearInterval(this._vtPollTimer)
    this._vtTickTimer = null
    this._vtPollTimer = null
  },

  /** 轮询官网公开遥测；失败且无存量列表时进入模拟模式 */
  async _vtPoll() {
    if (this._vtDestroyed) return
    try {
      const vehicles = await vtData.fetchVehicles()
      if (this._vtDestroyed) return
      this._vtVehicles = vehicles
      this._vtSetMode('LIVE')
    } catch (e) {
      if (this._vtDestroyed) return
      const emptied = !!(e && /no vehicles/i.test(String(e.message || e)))
      if (emptied || !this._vtVehicles || !this._vtVehicles.length || this._vtMode === 'SIMULATED') {
        this._vtEnterSimulated()
      }
    }
    if (this._vtDestroyed) return
    if (this.data.vtLoading) this.setData({ vtLoading: false })
    this._vtSyncChips()
    this._vtEnsureFeatured()
    this._vtTick()
  },

  _vtEnterSimulated() {
    this._vtVehicles = [vtData.buildSimulated((t) => computeSatellitePosition(t), ORBIT_T0)]
    this._vtSetMode('SIMULATED')
  },

  _vtSetMode(mode) {
    this._vtMode = mode
    if (this.data.vtMode !== mode) this.setData({ vtMode: mode })
  },

  _vtSyncChips() {
    const chips = (this._vtVehicles || []).map(v => ({ id: v.id, label: v.label }))
    const sig = chips.map(c => c.id + ':' + c.label).join('|')
    if (sig !== this._vtChipsSig) {
      this._vtChipsSig = sig
      this.setData({ vtVehicles: chips })
    }
  },

  _vtEnsureFeatured() {
    const list = this._vtVehicles || []
    if (!list.length) return
    const pref = pickFeatured(list, this.data.vtFeatured, this._vtUserPicked)
    if (!pref) return
    const cur = this.data.vtFeatured
    if (pref.id === cur) return
    this.setData({ vtFeatured: pref.id })
    if (this._vtRenderer) {
      this._vtRenderer.setFeatured(pref.id)
      if (pref.active && isFinite(pref.lat) && isFinite(pref.lng)) {
        this._vtRenderer.rotateToLocation(pref.lat, pref.lng)
      }
    }
  },

  _vtTick() {
    const list = this._vtVehicles
    if (!this._vtRenderer || !list || !list.length) return
    const now = Date.now()
    const rendered = []
    let featured = null
    for (let i = 0; i < list.length; i++) {
      const v = list[i]
      if (v.sim) {
        const p = computeSatellitePosition(now)
        v._lat = p.lat
        v._lng = p.lon
        v._curAltM = p.alt * 1000
        v._curSpeedMs = p.vel * 1000
        v._curMissionSec = (now - v.simStartMs) / 1000
      } else if (v.active) {
        const p = vtData.interpPosition(v, now)
        v._lat = p.lat
        v._lng = p.lng
        v._curAltM = p.alt != null ? p.alt : v.altitudeM
        v._curSpeedMs = v.speedMs
        v._curMissionSec = v.missionTime + (now - v.fetchedAt) / 1000
        // ISS 同步插值，避免龙飞船独走、对接判定抖动
        const iss = vtData.interpIssPosition(v, now)
        if (iss) {
          v._issLat = iss.lat
          v._issLng = iss.lng
          v._issAltM = iss.alt
        } else {
          v._issLat = v.issLat
          v._issLng = v.issLng
          v._issAltM = v.issAltM
        }
      } else {
        // 未在轨：固定零遥测（对齐官网）
        v._lat = v.lat
        v._lng = v.lng
        v._curAltM = 0
        v._curSpeedMs = 0
        v._curMissionSec = 0
        v._issLat = null
        v._issLng = null
      }
      rendered.push({
        id: v.id,
        label: v.label,
        group: v.group,
        lat: v._lat,
        lng: v._lng,
        altM: v._curAltM,
        track: v.showTrack ? v.track : [],
        showTrack: !!v.showTrack,
        active: v.active !== false,
        issLat: v._issLat != null ? v._issLat : v.issLat,
        issLng: v._issLng != null ? v._issLng : v.issLng,
        issAltM: v._issAltM != null ? v._issAltM : v.issAltM
      })
      if (v.id === this.data.vtFeatured) featured = v
    }
    this._vtRenderer.setVehicles(rendered)
    if (featured) {
      const updates = {}
      let mt = vtData.fmtMissionTime(featured._curMissionSec)
      const sp = vtData.fmtSpeed(featured._curSpeedMs)
      const alt = vtData.fmtAltitude(featured._curAltM)
      // 官网：Speed/Altitude 显示均为 0 时，Mission Time 归零
      if (sp === '0 KM/H' && alt === '0 KM') mt = 'T+ 0D 00:00'
      if (mt !== this.data.vtMissionTime) updates.vtMissionTime = mt
      if (sp !== this.data.vtSpeed) updates.vtSpeed = sp
      if (alt !== this.data.vtAltitude) updates.vtAltitude = alt
      if (Object.keys(updates).length) this.setData(updates)
    }
  },

  onVtVehicleTap(e) {
    const id = e.currentTarget.dataset.id
    if (!id || id === this.data.vtFeatured) return
    this._vtUserPicked = true
    this.setData({ vtFeatured: id })
    const v = (this._vtVehicles || []).find(x => x.id === id)
    if (this._vtRenderer) this._vtRenderer.setFeatured(id)
    // 先刷新轨迹/遥测，再飞镜（避免飞镜期间重复重绘完整海岸线）
    this._vtTick()
    if (this._vtRenderer && v && v.active) {
      const lat = v._lat != null ? v._lat : v.lat
      const lng = v._lng != null ? v._lng : v.lng
      if (isFinite(lat) && isFinite(lng)) {
        this._vtRenderer.rotateToLocation(lat, lng)
      }
    }
  },

  onVtTouchStart(e) { if (this._vtRenderer) this._vtRenderer.onTouchStart(e) },
  onVtTouchMove(e) { if (this._vtRenderer) this._vtRenderer.onTouchMove(e) },
  onVtTouchEnd() { if (this._vtRenderer) this._vtRenderer.onTouchEnd() },

  onBack() {
    const pages = getCurrentPages()
    if (pages.length > 1) {
      wx.navigateBack({ delta: 1 })
    } else {
      wx.switchTab({
        url: '/pages/progress/progress',
        fail: () => {
          wx.reLaunch({ url: '/pages/progress/progress' })
        }
      })
    }
  },

  onHide() {
    this._vtHidden = true
    this._stopVtTimers()
    if (this._vtRenderer) this._vtRenderer.pause()
  },

  onShow() {
    this._lockDarkChrome()
    this._vtHidden = false
    if (this._vtRenderer) {
      this._vtRenderer.resume()
      this._startVtTimers()
    }
  },

  onUnload() {
    this._vtDestroyed = true
    this._stopVtTimers()
    if (this._vtRenderer) {
      this._vtRenderer.destroy()
      this._vtRenderer = null
    }
  },

  onShareAppMessage() {
    return {
      title: '在轨飞行器追踪：3D 地球实时定位在飞星舰与龙飞船',
      path: shareGate.withShareStampPath('/subpackages/monitor-pages/vehicle-tracker/vehicle-tracker', this)
    }
  },

  onShareTimeline() {
    return {
      title: '在轨飞行器追踪：3D 地球实时定位在飞星舰与龙飞船',
      query: shareGate.withShareStampQuery('', this)
    }
  }
})
