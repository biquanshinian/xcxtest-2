/**
 * SPACE_NOTICES_FEATURE — 发射通告条目列表（即将 / 历史分段）
 */
const pageBase = require('../../../utils/page-base.js')
const { listSpaceNoticeEntries, syncSpaceNotices } = require('./utils/api-space-notices.js')
const { isSpaceNoticesEnabled } = require('../../../utils/space-notices-feature.js')
const { ROUTES, navigateTo } = require('../../../utils/routes.js')
const { gateCheck } = require('../../../utils/membership.js')
const {
  checkShareEntryGate,
  warmShareEntitlement,
  withShareStampPath,
  withShareStampQuery
} = require('../utils/share-gate.js')

const GATE_PRODUCT_ID = 'space_notices'
const GATE_PRODUCT_NAME = '发射通告地图'

function formatNet(net, windowStartMs) {
  const raw = net || (windowStartMs ? new Date(windowStartMs).toISOString() : '')
  if (!raw) return '时间待定'
  try {
    const d = new Date(raw)
    if (Number.isNaN(d.getTime())) return String(raw)
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  } catch (e) {
    return String(raw)
  }
}

function decorateEntry(e) {
  const mission = e.missionName || e.entryKey || '未命名任务'
  const rocket = e.rocketName || ''
  const metaBits = []
  metaBits.push(formatNet(e.net, e.windowStartMs))
  metaBits.push('通告 ' + (e.noticeCount || 0))
  if (e.hasTrajectory) metaBits.push('含轨迹')
  if (e.agency) metaBits.push(e.agency)
  return Object.assign({}, e, {
    title: mission,
    subtitle: rocket || (e.isStarship ? 'Starship' : '发射任务'),
    netText: formatNet(e.net, e.windowStartMs),
    metaText: metaBits.join(' · ')
  })
}

Page({
  behaviors: [pageBase],
  _fallbackTab: '/pages/monitor/monitor',

  data: {
    loading: true,
    errorText: '',
    upcoming: [],
    past: [],
    progressText: '',
    totalCount: 0,
    shareGateExpireAt: 0
  },

  async onLoad(options) {
    this.initUiShell()
    const on = await isSpaceNoticesEnabled().catch(() => true)
    if (!on) {
      wx.showToast({ title: '功能已关闭', icon: 'none' })
      setTimeout(() => this.goBack(), 400)
      return
    }

    // 分享卡片 24h 免门控；过期走会员/广告门控
    const shareAllowed = await checkShareEntryGate(this, options, GATE_PRODUCT_ID, GATE_PRODUCT_NAME)
    if (!shareAllowed) {
      this.setData({
        loading: false,
        errorText: '分享链接已过期，开通星际通行证或看广告后可继续查看'
      })
      return
    }
    // 无 sst 的冷启动（监控区分享/旧卡片）：走完整门控；App 内从监控入口进来已 gateCheck
    const stack = typeof getCurrentPages === 'function' ? getCurrentPages() : []
    if (!this._shareSst && stack.length <= 1) {
      const allowed = await gateCheck(GATE_PRODUCT_ID, GATE_PRODUCT_NAME)
      if (!allowed) {
        this.setData({ loading: false, errorText: '开通星际通行证或看广告后可使用发射通告地图' })
        setTimeout(() => this.goBack(), 500)
        return
      }
    }
    warmShareEntitlement(this, GATE_PRODUCT_ID)
    this.loadList()
  },

  async loadList() {
    this.setData({ loading: true, errorText: '' })
    try {
      const res = await listSpaceNoticeEntries(40)
      if (!res || !res.success) {
        this.setData({
          loading: false,
          errorText: (res && res.error) || '加载失败，请先部署云函数 spaceNotices'
        })
        return
      }
      const rows = (res.results || []).map(decorateEntry)
      const upcoming = rows.filter((e) => !e.isPast)
      const past = rows.filter((e) => e.isPast)
      const prog = res.progress || {}
      const covered = Number(prog.covered || 0)
      const total = Number(prog.total || rows.length)
      let progressText = ''
      if (total > 0 && covered < total) {
        progressText = `已同步 ${covered}/${total} 场 · 定时器每 15 分钟继续补拉`
      } else if (total > 0) {
        progressText = `共 ${rows.length} 场任务`
      }
      this.setData({
        loading: false,
        upcoming,
        past,
        totalCount: rows.length,
        progressText
      })
    } catch (e) {
      this.setData({
        loading: false,
        errorText: '加载失败：' + ((e && e.message) || '网络错误')
      })
    }
  },

  retryLoad() {
    this.loadList()
  },

  async onSync() {
    wx.showLoading({ title: '同步中', mask: true })
    try {
      const res = await syncSpaceNotices()
      wx.hideLoading()
      if (!res || !res.success) {
        wx.showToast({ title: (res && res.error) || '同步失败', icon: 'none' })
        return
      }
      if (res.throttled) {
        wx.showToast({ title: '同步过于频繁，请稍后再试', icon: 'none' })
        return
      }
      const processed = Number(res.entriesProcessed || 0)
      const total = Number(res.entryTotal || 0)
      const tip = total
        ? `本轮 ${processed} 场 · 索引 ${total}（定时器会继续轮转）`
        : `已处理 ${processed} 场`
      wx.showToast({ title: tip, icon: 'none', duration: 2500 })
      this.loadList()
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: '同步失败', icon: 'none' })
    }
  },

  openMap(e) {
    const key = e.currentTarget.dataset.key
    if (!key) return
    navigateTo(ROUTES.SPACE_NOTICE_MAP, { entryKey: key })
  },

  _shareTitle() {
    const n = this.data.totalCount || 0
    return n ? `发射通告地图 · ${n} 场任务的危险区` : '发射通告地图 · NOTAM / 航海警告'
  },

  onShareAppMessage() {
    return {
      title: this._shareTitle(),
      path: withShareStampPath(ROUTES.SPACE_NOTICE_LIST, this)
    }
  },

  onShareTimeline() {
    return {
      title: this._shareTitle(),
      query: withShareStampQuery('', this)
    }
  }
})
