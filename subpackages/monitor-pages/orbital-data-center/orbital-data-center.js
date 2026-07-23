// 太空轨道数据中心系统 · 详情页

const orbitalCache = require('../utils/orbital-config-cache.js')
const { isPlaybackAllowed } = require('../../../utils/feature-flags.js')
const vtData = require('../utils/vehicle-tracker-data.js')

const SYS_INFO = wx.getSystemInfoSync ? wx.getSystemInfoSync() : { statusBarHeight: 44 }

/** 背景视频远程地址（与年鉴页共用同一资源，缓存命中即可直接复用） */
const ODC_BG_VIDEO_REMOTE =
  'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/%E8%83%8C%E6%99%AF%E8%A7%86%E9%A2%91/1778841707632_ddgop4.mp4'
/** 与年鉴页同 key，命中年鉴页缓存可直接秒开 */
const ODC_BG_VIDEO_STORAGE_KEY = 'year_review_detail_bg_video_v1'

// 胶囊按钮信息（用于计算自定义导航栏高度）
let MENU_BUTTON_INFO = null
try {
  MENU_BUTTON_INFO = wx.getMenuButtonBoundingClientRect ? wx.getMenuButtonBoundingClientRect() : null
} catch (e) { MENU_BUTTON_INFO = null }

// 自定义导航栏高度 = 胶囊到状态栏底的距离 * 2 + 胶囊本身高度
function calcNavBarHeight(statusBarHeight) {
  if (MENU_BUTTON_INFO && MENU_BUTTON_INFO.top && MENU_BUTTON_INFO.height) {
    const top = MENU_BUTTON_INFO.top - statusBarHeight
    return top * 2 + MENU_BUTTON_INFO.height
  }
  return 44
}

// 生成随机数（0-1）
const rnd = () => Math.random()

// 构造星空粒子
function buildStars(count) {
  const arr = []
  for (let i = 0; i < count; i++) {
    arr.push({
      id: i,
      x: +(rnd() * 100).toFixed(2),
      y: +(rnd() * 100).toFixed(2),
      size: +(rnd() * 2.4 + 1.2).toFixed(2),
      delay: +(rnd() * 4).toFixed(2),
      duration: +(rnd() * 3 + 2).toFixed(2)
    })
  }
  return arr
}

// 随机生成柱状图高度
function buildTelemetryBars(count) {
  const arr = []
  for (let i = 0; i < count; i++) {
    arr.push(+(rnd() * 70 + 18).toFixed(0))
  }
  return arr
}

// 数字补零
function pad(n, w) {
  const s = String(n)
  return s.length >= w ? s : '0'.repeat(w - s.length) + s
}

function formatTime(d) {
  return `${pad(d.getHours(), 2)}:${pad(d.getMinutes(), 2)}:${pad(d.getSeconds(), 2)} UTC`
}

// ========== Starlink 轨道物理模型（圆轨道近似，基于真实参数） ==========
// 参考真实数据：Starlink V2 主壳层 550km / 53° / 周期约 95.6 分钟
const ORBIT = {
  altitude: 550,           // km
  inclination: 53.0,       // 度
  period: 95.6 * 60,       // 秒（5736 秒）
  initialLon: -97.156,     // 起点经度（Starbase TX 上空）
  earthRadius: 6371,       // km
  mu: 398600.4418,         // 地球引力参数 km^3/s^2
  earthRotRate: 7.2921159e-5  // 地球自转角速度 rad/s
}

// 启动时间（页面加载时刻），用于计算 elapsed
const ORBIT_T0 = Date.now()

// 真实物理计算卫星位置（圆轨道近似）
function computeSatellitePosition(now) {
  const elapsed = (now - ORBIT_T0) / 1000  // 秒
  const incRad = ORBIT.inclination * Math.PI / 180
  const meanMotion = 2 * Math.PI / ORBIT.period  // rad/s
  const u = (meanMotion * elapsed) % (2 * Math.PI)  // 升交点角距

  // 球面三角：从轨道平面投影到地心赤道坐标
  const lat = Math.asin(Math.sin(incRad) * Math.sin(u))  // 弧度
  const lonOnPlane = Math.atan2(
    Math.cos(incRad) * Math.sin(u),
    Math.cos(u)
  )

  // 加上地球自转偏移
  let lon = ORBIT.initialLon * Math.PI / 180 + lonOnPlane - ORBIT.earthRotRate * elapsed
  while (lon > Math.PI)  lon -= 2 * Math.PI
  while (lon < -Math.PI) lon += 2 * Math.PI

  // 圆轨道速度（开普勒）
  const r = ORBIT.earthRadius + ORBIT.altitude
  const velocity = Math.sqrt(ORBIT.mu / r)  // km/s

  // 高度微小起伏（模拟大气阻力/轨道维持，± 0.5 km）
  const altitude = ORBIT.altitude + Math.sin(u * 2) * 0.5

  return {
    lat: lat * 180 / Math.PI,
    lon: lon * 180 / Math.PI,
    alt: altitude,
    vel: velocity
  }
}

function fmtCoords(c) {
  return {
    lat: (c.lat >= 0 ? 'N ' : 'S ') + Math.abs(c.lat).toFixed(4) + '°',
    lon: (c.lon >= 0 ? 'E ' : 'W ') + Math.abs(c.lon).toFixed(4) + '°',
    alt: c.alt.toFixed(2) + ' km',
    vel: c.vel.toFixed(3) + ' km/s'
  }
}

// 把 briefLines 字符串数组预处理为对象数组（带 accent 标志）
function normalizeBriefLines(lines) {
  if (!Array.isArray(lines) || !lines.length) return []
  return lines.filter(s => typeof s === 'string').map(s => ({
    text: s,
    accent: s.indexOf('//') === 0
  }))
}

// 默认配置（远程未加载或加载失败时使用）
const DEFAULT_BRIEF_LINES = [
  '本系统为「火星探索日志」对未来轨道数据中心与星链巨型星座下一代基础设施的预研产物。',
  '在 SpaceX 完成 V2 Starlink 全球部署、Starship 月度高频发射、以及 Starshield 国防订阅服务正式上线后，地面侧建立专门的轨道数据中心来对接、调度、聚合千万节点级别的实时遥测。',
  '// ODC 早期蓝图。'
]

const TICKER_LINES = [
  '> SYS_INIT // 接入 SpaceX Starlink V2 镜像网关',
  '> ORBIT_MODEL // 550km · 53° · T=95.6min',
  '> CHANNEL_LOCK // 已锁定 K-band 下行链路',
  '> ENCRYPTION // AES-256-GCM // 0xA47F...',
  '> MODE // SIMULATED · 基于公开 TLE 参数',
  '> AUTHORITY // FCC-2026 / ITU-R S.1428',
  '> NEXT_PASS // 00:14:32 OVER STARBASE TX',
  '> READY // 等待指令'
]

Page({
  // 沉浸式指挥控制台：恒定深色，不接入全局 themeClass（见 utils/theme.js）
  forceDarkTheme: true,

  data: {
    statusBarHeight: SYS_INFO.statusBarHeight || 44,
    navBarHeight: calcNavBarHeight(SYS_INFO.statusBarHeight || 44),
    odcBgVideoPlaySrc: '',
    starList: buildStars(45),
    tickerText: TICKER_LINES[0],
    liveCoords: fmtCoords(computeSatellitePosition(Date.now())),
    coreMetrics: [
      { id: 1, label: 'ACTIVE NODES', value: '128', unit: 'satellites', percent: 78, trend: 'up', delta: '+12' },
      { id: 2, label: 'BANDWIDTH',    value: '4.8',  unit: 'Tbps',       percent: 64, trend: 'up', delta: '+0.6' },
      { id: 3, label: 'PACKET LOSS',  value: '0.012', unit: '%',         percent: 8,  trend: 'down', delta: '-0.004' },
      { id: 4, label: 'SYS UPTIME',   value: '99.97', unit: '%',          percent: 99.97, trend: 'flat', delta: '0.00' },
      { id: 5, label: 'GROUND LINK',  value: '36',   unit: 'stations',  percent: 72, trend: 'up', delta: '+2' },
      { id: 6, label: 'POWER DRAW',   value: '1.42', unit: 'MW',         percent: 56, trend: 'flat', delta: '~' }
    ],
    nodeList: [
      { id: 'n1', code: 'STARLINK-V2 #4421', type: 'LEO RELAY',    orbit: '550 km · 53°', uplink: '92.4 Gbps', latency: '18 ms', status: 'online',  statusText: 'NOMINAL' },
      { id: 'n2', code: 'STARSHIELD-K07',    type: 'GOV PAYLOAD',  orbit: '600 km · 70°', uplink: '46.1 Gbps', latency: '21 ms', status: 'online',  statusText: 'CLASSIFIED LINK' },
      { id: 'n3', code: 'GATEWAY GW-LA-12',  type: 'GROUND ANCHOR',orbit: 'CA / 33.94°N',  uplink: '1.2 Tbps',  latency: '3 ms',  status: 'online',  statusText: 'GROUND-PRIME' },
      { id: 'n4', code: 'STARLINK-V2 #5067', type: 'LEO RELAY',    orbit: '550 km · 53°', uplink: '88.0 Gbps', latency: '17 ms', status: 'warn',    statusText: 'PARTIAL OUTAGE' },
      { id: 'n5', code: 'INTERSAT-LASER 7',  type: 'INTER-SAT XLINK',orbit: '550 km · 97°',uplink: '120 Gbps', latency: '4 ms',  status: 'online',  statusText: 'OPTICAL LOCKED' },
      { id: 'n6', code: 'NODE OFFLINE-244',  type: 'LEO RELAY',    orbit: '—',             uplink: '—',         latency: '—',     status: 'offline', statusText: 'DEORBIT QUEUE' }
    ],
    telemetryBars: buildTelemetryBars(40),
    telemetryStats: { tx: '2.41 Gbps', rx: '3.07 Gbps', pkt: '8.42 M/s' },
    missionList: [
      { id: 'm1', title: 'Phase 0 · 系统启动',          date: '2026 Q1', status: 'done',     statusText: 'COMPLETED', desc: '完成 ODC 控制台原型与遥测协议草案。' },
      { id: 'm2', title: 'Phase I · 全球地面网格接入',   date: '2026 Q2', status: 'active',   statusText: 'IN PROGRESS', desc: '对接全球 36 处 Starlink 网关地面站，建立第一批镜像节点。' },
      { id: 'm3', title: 'Phase II · Starshield 数据合规', date: '2026 Q3', status: 'pending',  statusText: 'QUEUED',    desc: '部署可信执行环境（TEE），承载政府订阅业务的隔离数据流。' },
      { id: 'm4', title: 'Phase III · 千万节点级聚合',   date: '2027',    status: 'pending',  statusText: 'PLANNED',   desc: '迎接 V3 Starlink 与 Starship 月度发射后激增的节点规模。' },
      { id: 'm5', title: 'Phase IV · 月地中继扩展',      date: '2028',    status: 'forecast', statusText: 'FORECAST',  desc: '与 Artemis 计划及 Lunar Gateway 对接，迈出地月通信骨干网第一步。' }
    ],
    systemTime: '00:00:00 UTC',
    lastSync: '00:00:00 UTC',
    currentYear: new Date().getFullYear(),
    // HUD 头部（远程可配）
    hudTitle: 'SYS-ODC // CONSOLE',
    hudSub: 'v0.1.0 · UNCLASSIFIED',
    statusText: 'ONLINE',
    // 项目简报（远程可配）
    briefLines: normalizeBriefLines(DEFAULT_BRIEF_LINES),
    // Vehicle Tracker（在轨飞行器追踪）
    vtVehicles: [],
    vtFeatured: '',
    vtMissionTime: 'T+ 0D 00:00',
    vtSpeed: '--',
    vtAltitude: '--',
    vtMode: 'LIVE',
    vtLoading: true
  },

  /** 锁定黑底白字导航/窗口底色，避免从浅色页切入或全局刷主题时被冲掉 */
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

  onLoad() {
    wx.setNavigationBarTitle({ title: 'Orbital Data Center' })
    this._lockDarkChrome()
    this.setData({
      systemTime: formatTime(new Date()),
      lastSync: formatTime(new Date())
    })
    this._resolvedOdcBgVideoUrl = null
    const cached = this._getCachedConfig()
    if (cached) {
      this._applyRemoteConfig(cached)
    } else {
      this._syncBgVideoFromDetail({})
    }
    this._loadRemoteConfig()
    this._startTickers()
  },

  /** 从全局缓存取上一次拉到的远程配置 */
  _getCachedConfig() {
    try {
      const app = getApp()
      return (app && app.globalData && app.globalData.orbitalDetailConfig) || null
    } catch (e) {
      return null
    }
  },

  /** 调缓存层取远程配置（命中本地直接用，过期后台静默刷新） */
  _loadRemoteConfig() {
    const self = this
    orbitalCache.getOrbitalConfig({
      onUpdate(data) {
        if (data && data.detail) self._applyRemoteConfig(data.detail)
      }
    }).then((data) => {
      if (data && data.detail) {
        // 同步缓存到 app.globalData，方便其他页面共享
        try {
          const app = getApp()
          if (app) app.globalData = app.globalData || {}
          if (app && app.globalData) app.globalData.orbitalDetailConfig = data.detail
        } catch (e) {}
        self._applyRemoteConfig(data.detail)
      }
    }).catch(() => { /* 静默失败，使用本地默认 */ })
  },

  /** 按后台配置的全屏背景视频地址（含入库字段 detail.bgVideo）准备播放器 */
  _syncBgVideoFromDetail(detail) {
    const d = detail && typeof detail === 'object' ? detail : {}
    const newBg = typeof d.bgVideo === 'string' ? d.bgVideo.trim() : ''
    const resolved = newBg || ODC_BG_VIDEO_REMOTE
    if (resolved === this._resolvedOdcBgVideoUrl) return
    this._resolvedOdcBgVideoUrl = resolved
    isPlaybackAllowed()
      .catch(() => false)
      .then((allowed) => {
        if (!allowed) {
          this.setData({ odcBgVideoPlaySrc: '' })
          return
        }
        this._prepareBgVideo(resolved)
      })
  },

  /** 把远程配置应用到 data，未提供的字段保持本地默认 */
  _applyRemoteConfig(detail) {
    if (!detail || typeof detail !== 'object') return
    const updates = {}
    if (detail.hudTitle)   updates.hudTitle = detail.hudTitle
    if (detail.hudSub)     updates.hudSub = detail.hudSub
    if (detail.statusText) updates.statusText = detail.statusText
    if (Array.isArray(detail.tickerLines) && detail.tickerLines.length) {
      this._tickerLines = detail.tickerLines.slice()
      updates.tickerText = this._tickerLines[0]
      this._tickerIdx = 0
    }
    if (Array.isArray(detail.coreMetrics) && detail.coreMetrics.length) {
      updates.coreMetrics = detail.coreMetrics.map((m, i) => Object.assign({ id: 'c' + i }, m))
    }
    if (Array.isArray(detail.nodeList) && detail.nodeList.length) {
      updates.nodeList = detail.nodeList.map((n, i) => Object.assign({ id: 'n' + i }, n))
    }
    if (Array.isArray(detail.missionList) && detail.missionList.length) {
      updates.missionList = detail.missionList.map((m, i) => Object.assign({ id: 'm' + i }, m))
    }
    if (Array.isArray(detail.briefLines) && detail.briefLines.length) {
      updates.briefLines = normalizeBriefLines(detail.briefLines)
    }
    this._syncBgVideoFromDetail(detail)
    if (Object.keys(updates).length) this.setData(updates)
  },

  _playBgVideoIfReady() {
    if (!this.data.odcBgVideoPlaySrc) return
    try {
      const ctx = wx.createVideoContext('odcBgVideo', this)
      if (ctx && typeof ctx.play === 'function') ctx.play()
    } catch (e) {}
  },

  _prepareBgVideo(remoteUrl) {
    const remote = (remoteUrl && String(remoteUrl).trim()) || ODC_BG_VIDEO_REMOTE
    if (!remote) {
      this.setData({ odcBgVideoPlaySrc: '' })
      return
    }

    const fs = wx.getFileSystemManager()

    const that = this
    function applyPlaySrc(path) {
      if (!path) return
      that.setData({ odcBgVideoPlaySrc: path }, () => {
        setTimeout(() => that._playBgVideoIfReady(), 80)
      })
    }

    let meta = null
    try {
      meta = wx.getStorageSync(ODC_BG_VIDEO_STORAGE_KEY) || null
    } catch (e) {}

    if (meta && meta.url === remote && meta.localPath) {
      try {
        fs.accessSync(meta.localPath)
        applyPlaySrc(meta.localPath)
        return
      } catch (e) {
        try { wx.removeStorageSync(ODC_BG_VIDEO_STORAGE_KEY) } catch (e2) {}
      }
    }

    wx.downloadFile({
      url: remote,
      success: (res) => {
        if (res.statusCode !== 200 || !res.tempFilePath) {
          applyPlaySrc(remote)
          return
        }
        fs.saveFile({
          tempFilePath: res.tempFilePath,
          success: (sr) => {
            const saved = sr.savedFilePath || res.tempFilePath
            try {
              wx.setStorageSync(ODC_BG_VIDEO_STORAGE_KEY, {
                url: remote,
                localPath: saved,
                ts: Date.now()
              })
            } catch (e) {}
            applyPlaySrc(saved)
          },
          fail: () => {
            applyPlaySrc(res.tempFilePath || remote)
          }
        })
      },
      fail: () => {
        applyPlaySrc(remote)
      }
    })
  },

  // ========== Vehicle Tracker（在轨飞行器追踪） ==========

  onReady() {
    this._initVehicleTracker()
  },

  async _initVehicleTracker() {
    try {
      const { VehicleTrackerRenderer } = require('../utils/vehicle-tracker-renderer.js')
      this._vtRenderer = new VehicleTrackerRenderer()
      await this._vtRenderer.bindCanvas(this, '#vtCanvas')
    } catch (e) {
      // 绑定失败（含等待期间页面已卸载）：放弃初始化
      this._vtRenderer = null
      if (!this._vtDestroyed) this.setData({ vtLoading: false })
      return
    }
    if (this._vtDestroyed) return
    this._vtVehicles = []
    this._vtMode = ''
    this._vtChipsSig = ''
    this._setupVtObserver()
    await this._vtPoll()
    // 首轮拉取期间页面可能已隐藏/卸载：不启动定时器（onShow 会补启动）
    if (this._vtDestroyed || this._vtHidden) return
    this._startVtTimers()
  },

  /** 板块滚出屏幕时暂停 canvas 绘帧（数据 tick 照常，回滚即无缝续播） */
  _setupVtObserver() {
    try {
      this._vtObserver = this.createIntersectionObserver()
      this._vtObserver
        .relativeToViewport({ top: 100, bottom: 100 })
        .observe('.odc-vt__canvas-wrap', (res) => {
          const visible = !!(res && res.intersectionRatio > 0)
          this._vtVisible = visible
          if (!this._vtRenderer || this._vtHidden) return
          if (visible) this._vtRenderer.resume()
          else this._vtRenderer.pause()
        })
    } catch (e) {
      this._vtObserver = null
    }
  },

  _startVtTimers() {
    this._stopVtTimers()
    this._vtTickTimer = setInterval(() => this._vtTick(), 1000)
    this._vtPollTimer = setInterval(() => { this._vtPoll() }, 15000)
  },

  _stopVtTimers() {
    if (this._vtTickTimer) clearInterval(this._vtTickTimer)
    if (this._vtPollTimer) clearInterval(this._vtPollTimer)
    this._vtTickTimer = null
    this._vtPollTimer = null
  },

  /** 轮询官网公开遥测；失败且无存量数据时进入模拟模式 */
  async _vtPoll() {
    if (this._vtDestroyed) return
    try {
      const vehicles = await vtData.fetchVehicles()
      // await 期间可能已卸载：禁止再写 data / 驱动渲染器
      if (this._vtDestroyed) return
      this._vtVehicles = vehicles
      this._vtSetMode('LIVE')
    } catch (e) {
      if (this._vtDestroyed) return
      // no vehicles = 在轨任务全部结束/被过滤，必须离开 LIVE，否则会永久钉死旧飞行器
      // 网络失败则：已有 LIVE 存量时保留待下轮重试；SIM/空列表时回退模拟
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

  /** 模拟模式：复用页面圆轨道物理模型驱动同一渲染器 */
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

  /**
   * 选中飞行器失效或未选时：优先在轨星舰，其次任意星舰/在轨机。
   * 用户未手动切换过时，星舰任务开播（数据流入）会自动对准新上线的星舰。
   */
  _vtEnsureFeatured() {
    const list = this._vtVehicles || []
    if (!list.length) return
    const cur = this.data.vtFeatured
    const curValid = cur && list.some(v => v.id === cur)
    if (curValid && this._vtUserPicked) return
    const activeShip = list.find(v => /^ship/.test(v.id) && v.active)
    const ship = list.find(v => /^ship/.test(v.id))
    const active = list.find(v => v.active)
    const pref = activeShip || ship || active || list[0]
    if (pref.id === cur) return
    this.setData({ vtFeatured: pref.id })
    if (this._vtRenderer) {
      this._vtRenderer.setFeatured(pref.id)
      if (pref.active && isFinite(pref.lat) && isFinite(pref.lng)) {
        this._vtRenderer.rotateToLocation(pref.lat, pref.lng)
      }
    }
  },

  /** 1Hz：插值位置喂渲染器 + 推进遥测数字（仅变化字段 setData） */
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
        url: '/pages/monitor/monitor',
        fail: () => {
          wx.reLaunch({ url: '/pages/monitor/monitor' })
        }
      })
    }
  },

  onUnload() {
    this._stopTickers()
    this._vtDestroyed = true
    this._stopVtTimers()
    if (this._vtObserver) {
      try { this._vtObserver.disconnect() } catch (e) {}
      this._vtObserver = null
    }
    if (this._vtRenderer) {
      this._vtRenderer.destroy()
      this._vtRenderer = null
    }
  },

  _startTickers() {
    if (!this._tickerLines || !this._tickerLines.length) {
      this._tickerLines = TICKER_LINES.slice()
    }
    if (typeof this._tickerIdx !== 'number') this._tickerIdx = 0
    this._tickerTimer = setInterval(() => {
      const lines = this._tickerLines && this._tickerLines.length ? this._tickerLines : TICKER_LINES
      this._tickerIdx = (this._tickerIdx + 1) % lines.length
      this.setData({ tickerText: lines[this._tickerIdx] })
    }, 2400)

    this._coordsTimer = setInterval(() => {
      const next = computeSatellitePosition(Date.now())
      this.setData({
        liveCoords: fmtCoords(next),
        systemTime: formatTime(new Date())
      })
    }, 1000)

    this._telemetryTimer = setInterval(() => {
      const tx = (2 + rnd() * 1.6).toFixed(2) + ' Gbps'
      const rx = (2.5 + rnd() * 1.4).toFixed(2) + ' Gbps'
      const pkt = (7 + rnd() * 3).toFixed(2) + ' M/s'
      this.setData({
        telemetryBars: buildTelemetryBars(40),
        telemetryStats: { tx, rx, pkt }
      })
    }, 1600)

    this._syncTimer = setInterval(() => {
      this.setData({ lastSync: formatTime(new Date()) })
    }, 5000)
  },

  _stopTickers() {
    if (this._tickerTimer) clearInterval(this._tickerTimer)
    if (this._coordsTimer) clearInterval(this._coordsTimer)
    if (this._telemetryTimer) clearInterval(this._telemetryTimer)
    if (this._syncTimer) clearInterval(this._syncTimer)
    this._tickerTimer = null
    this._coordsTimer = null
    this._telemetryTimer = null
    this._syncTimer = null
  },

  onHide() {
    this._stopTickers()
    this._vtHidden = true
    this._stopVtTimers()
    if (this._vtRenderer) this._vtRenderer.pause()
  },

  onShow() {
    this._lockDarkChrome()
    this._vtHidden = false
    if (!this._tickerTimer) {
      this._startTickers()
    }
    // 首次 onShow 早于 onReady，此时渲染器还未创建（由 _initVehicleTracker 启动）
    if (this._vtRenderer) {
      // 板块仍在屏幕外时不恢复绘帧（可见性由 IntersectionObserver 接管）
      if (this._vtVisible !== false) this._vtRenderer.resume()
      this._startVtTimers()
    }
  }
})
