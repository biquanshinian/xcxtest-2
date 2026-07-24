/**
 * subpackages/monitor-pages/utils/monitor-orbital.js
 * 监控页「太空轨道数据中心卡」「即将进行的在轨任务」逻辑（从 pages/monitor/monitor.js 拆出）：
 * - 轨道数据中心：远程配置拉取/应用（含非会员视频背景降级）、入口门控跳转
 * - 在轨任务：懒加载拉取、格式化、每秒倒计时（clearOrbitalCountdown 因 onHide/onUnload
 *   需要同步调用保留在主包 monitor.js）
 *
 * 主包 monitor.js 通过 require.async + attachTo 委托加载（与 monitor-galleries 一致）。
 */
const { getSpaceXLaunchStats } = require('../../../utils/api-app-services.js')
const { getOrbitalConfig: getOrbitalConfigCached } = require('./orbital-config-cache.js')
const { ROUTES, navigateTo } = require('../../../utils/routes.js')
const { gateCheck, canUsePaidCloudSync } = require('../../../utils/membership.js')
const { getMemberPolicySync } = require('../../../utils/member-policy.js')
const { optimizeImageUrl, toCdnUrl, isVideoUrl, videoSnapshotUrl } = require('../../../utils/cos-url.js')
const { getCachedVideo } = require('./video-cache.js')
const { buildLl2ImageChain, advanceImageFallback } = require('../../../utils/ll2-image.js')

/** 监控页入口卡背景视频（远程 card.bgImage 为空时的本地兜底） */
const ORBITAL_CARD_BG_VIDEO_DEFAULT =
  'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/%E8%83%8C%E6%99%AF%E8%A7%86%E9%A2%91/1784884993160_b2tlgu.mp4'

const methods = {
  /** 把 LL2 events 数据格式化为卡片所需展示字段 */
  _formatUpcomingOrbitalEvents(list) {
    if (!Array.isArray(list)) return []
    const now = Date.now()
    return list.map((ev) => {
      const dateMs = ev.dateMs || (ev.date ? Date.parse(ev.date) : NaN)
      let countdownText = ''
      let countdownClass = ''
      if (isFinite(dateMs)) {
        const diff = dateMs - now
        const absDay = Math.floor(Math.abs(diff) / 86400000)
        const absHour = Math.floor((Math.abs(diff) % 86400000) / 3600000)
        if (diff <= 0) {
          countdownText = '进行中/已开始'
          countdownClass = 'live'
        } else if (absDay >= 1) {
          countdownText = `${absDay}天${absHour}小时后`
        } else {
          const min = Math.floor((Math.abs(diff) % 3600000) / 60000)
          countdownText = absHour >= 1 ? `${absHour}小时${min}分后` : `${Math.max(1, min)}分钟后`
          countdownClass = 'soon'
        }
      }
      const dateText = isFinite(dateMs) ? this._formatLocalDate(dateMs) : ''
      // 与飞船/发射商一致：Worker 代理优先，原链作 binderror 兜底
      const imageChain = buildLl2ImageChain(ev.imageUrl)
      return {
        ...ev,
        imageUrl: imageChain[0] || ev.imageUrl || '',
        imageFallbacks: imageChain.slice(1),
        countdownText,
        countdownClass,
        dateText
      }
    })
  },

  _formatLocalDate(ms) {
    const d = new Date(ms)
    const m = d.getMonth() + 1
    const day = d.getDate()
    const hh = String(d.getHours()).padStart(2, '0')
    const mm = String(d.getMinutes()).padStart(2, '0')
    return `${m}月${day}日 ${hh}:${mm}`
  },

  /** 在轨任务配图失败：沿代理/原链推进 */
  onOrbitEventImageError(e) {
    const idx = Number((e.currentTarget.dataset || {}).index)
    if (!Number.isInteger(idx) || idx < 0) return
    const list = this.data.upcomingOrbitalEvents || []
    const item = list[idx]
    if (!item) return
    const advanced = advanceImageFallback(item.imageUrl, item.imageFallbacks)
    this.setData({
      [`upcomingOrbitalEvents[${idx}].imageUrl`]: advanced.next,
      [`upcomingOrbitalEvents[${idx}].imageFallbacks`]: advanced.remaining
    })
  },

  /** 点击「加载在轨任务」触发懒加载（节约资源；不在首屏自动调用） */
  async onLoadUpcomingOrbitalEvents() {
    if (this.data.orbitalReady || this.data.orbitalLoading) return
    this.setData({ orbitalReady: true, orbitalLoading: true })
    try {
      const stats = await getSpaceXLaunchStats()
      const list = stats && Array.isArray(stats.upcomingOrbitalEvents) ? stats.upcomingOrbitalEvents : []
      this.setData({
        orbitalLoading: false,
        upcomingOrbitalEvents: this._formatUpcomingOrbitalEvents(list)
      })
      this.startOrbitalCountdown()
    } catch (e) {
      this.setData({ orbitalLoading: false, upcomingOrbitalEvents: [] })
      wx.showToast({ title: '加载失败，请稍后重试', icon: 'none' })
    }
  },

  /** 点击在轨事件卡片，跳转事件详情（复用 event-detail 页，传 ll2_event 模式） */
  onUpcomingEventTap(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    const item = (this.data.upcomingOrbitalEvents || []).find(ev => String(ev.id) === String(id))
    try {
      const app = getApp()
      if (app && item) {
        app._ll2EventHeroImage = {
          id: String(id),
          src: item.imageUrl || '',
          fallbacks: (item.imageFallbacks || []).slice(),
          raw: item
        }
      }
    } catch (err) {}
    wx.navigateTo({
      url: `/subpackages/progress-extra/event-detail?mode=ll2_event&id=${encodeURIComponent(id)}`
    })
  },

  /** 启动在轨任务倒计时（第一个事件） */
  startOrbitalCountdown() {
    this.clearOrbitalCountdown()
    this.updateOrbitalCountdown()
    this._orbitalCountdownTimer = setInterval(() => this.updateOrbitalCountdown(), 1000)
  },

  /** 每秒更新在轨任务倒计时 */
  updateOrbitalCountdown() {
    const list = this.data.upcomingOrbitalEvents
    if (!list || !list.length) return
    const first = list[0]
    const dateMs = first.dateMs || (first.date ? Date.parse(first.date) : NaN)
    if (!isFinite(dateMs)) return
    const diff = dateMs - Date.now()
    if (diff <= 0) {
      this.setData({ orbitalCountdown: { days: '00', hours: '00', minutes: '00', seconds: '00', isExpired: true } })
      this.clearOrbitalCountdown()
      return
    }
    const days = String(Math.floor(diff / 86400000)).padStart(2, '0')
    const hours = String(Math.floor((diff % 86400000) / 3600000)).padStart(2, '0')
    const minutes = String(Math.floor((diff % 3600000) / 60000)).padStart(2, '0')
    const seconds = String(Math.floor((diff % 60000) / 1000)).padStart(2, '0')
    // 路径更新：每秒只有变化字段进渲染层（通常只有秒位变化）
    const cur = this.data.orbitalCountdown || {}
    const patch = {}
    if (cur.days !== days) patch['orbitalCountdown.days'] = days
    if (cur.hours !== hours) patch['orbitalCountdown.hours'] = hours
    if (cur.minutes !== minutes) patch['orbitalCountdown.minutes'] = minutes
    if (cur.seconds !== seconds) patch['orbitalCountdown.seconds'] = seconds
    if (cur.isExpired !== false) patch['orbitalCountdown.isExpired'] = false
    if (Object.keys(patch).length) this.setData(patch)
  },

  /** 打开太空轨道数据中心系统（超前科幻入口，会员门控） */
  async openOrbitalDataCenter() {
    if (this._orbitalGateChecking) return
    this._orbitalGateChecking = true
    try {
      const allowed = await gateCheck('orbital_data_center', '太空轨道数据中心')
      if (!allowed) return
      navigateTo(ROUTES.ORBITAL_DATA_CENTER)
    } finally {
      this._orbitalGateChecking = false
    }
  },

  /** 卡片背景图加载失败 */
  onOrbitalBgError() {
    this.setData({ orbitalCardBg: '', orbitalCardBgIsVideo: false })
  },

  /** 加载远程「太空轨道数据中心」配置（保留本地默认作为 fallback） */
  loadOrbitalConfig() {
    const self = this
    getOrbitalConfigCached({
      onUpdate(data) {
        // 后台拉到新版数据时，再覆盖一次（仅当卡片字段有变）
        self._applyOrbitalConfig(data)
      }
    }).then((data) => {
      self._applyOrbitalConfig(data)
    }).catch(() => { /* 静默失败，使用本地默认 */ })
  },

  /** 把远程配置应用到 data */
  _applyOrbitalConfig(data) {
    if (!data) return
    this._lastOrbitalConfig = data
    const card = data.card
    const detail = data.detail
    const updates = {}
    function isOrbitalBgVideoUrl(url) {
      if (!url || typeof url !== 'string') return false
      return isVideoUrl(url)
    }
    if (card) {
      // 入口卡背景以本地常量为准，避免云库旧 bgImage 盖住新视频
      const rawBg = ORBITAL_CARD_BG_VIDEO_DEFAULT
      if (rawBg) {
        const asVideo = isOrbitalBgVideoUrl(rawBg)
        // 过审关闭可播视频时不渲染卡片背景 <video>（未解析前也先不播）
        if (asVideo && this._orbitalBgVideoAllowed !== true) {
          updates.orbitalCardBg = ''
          updates.orbitalCardBgIsVideo = false
        } else if (asVideo) {
          // 非会员 / 紧急流量档：不挂轨道卡 mp4（进 Tab 循环拉流是 COS 大头）
          const emergency = !!(getMemberPolicySync().emergencyMedia)
          if (!canUsePaidCloudSync() || emergency) {
            // 非会员/紧急档：不挂 mp4，回落静帧避免卡片空白
            updates.orbitalCardBg = videoSnapshotUrl(toCdnUrl(rawBg)) || ''
            updates.orbitalCardBgIsVideo = false
          } else {
            updates.orbitalCardBg = getCachedVideo(toCdnUrl(rawBg))
            updates.orbitalCardBgIsVideo = true
          }
        } else {
          updates.orbitalCardBg = optimizeImageUrl(rawBg, 'medium')
          updates.orbitalCardBgIsVideo = false
        }
      }
      if (card.metrics) {
        updates.orbitalLiveStats = {
          activeNodes: card.metrics.activeNodes || this.data.orbitalLiveStats.activeNodes,
          bandwidth: card.metrics.bandwidth || this.data.orbitalLiveStats.bandwidth,
          uptime: card.metrics.uptime || this.data.orbitalLiveStats.uptime
        }
      }
      if (typeof card.enabled === 'boolean') updates.orbitalCardEnabled = card.enabled
      if (card.badge) updates.orbitalCardBadge = card.badge
      if (card.titleEn) updates.orbitalCardTitleEn = card.titleEn
      if (card.titleCn) updates.orbitalCardTitleCn = card.titleCn
      if (card.desc) updates.orbitalCardDesc = card.desc
      if (card.ctaText) updates.orbitalCardCta = card.ctaText
    }
    if (detail) {
      try {
        const app = getApp()
        if (app) app.globalData = app.globalData || {}
        if (app && app.globalData) app.globalData.orbitalDetailConfig = detail
      } catch (e) {}
    }
    if (Object.keys(updates).length) this.setData(updates)
  }
}

module.exports = {
  methods,
  attachTo(page) {
    Object.keys(methods).forEach((name) => {
      page[name] = methods[name].bind(page)
    })
    page.__orbitalAttached = true
  }
}
