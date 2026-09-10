/**
 * SPACE_NOTICES_FEATURE — 发射通告条目列表（只展示提前预警）
 */
const pageBase = require('../../../utils/page-base.js')
const { listSpaceNoticeEntries, syncSpaceNotices } = require('./utils/api-space-notices.js')
const { CHINESE_COLLECTION_KEY } = require('./utils/china-filter.js')
const {
  splitEntryCards,
  applyConfigImages
} = require('./utils/entry-cards.js')
const { isSpaceNoticesEnabled, SPACE_NOTICES_PRODUCT_NAME } = require('../../../utils/space-notices-feature.js')
const { ROUTES, navigateTo } = require('../../../utils/routes.js')
const { gateCheck } = require('../../../utils/membership.js')
const { getRocketConfigMeta } = require('../../../utils/api-app-services.js')
const { cleanConfigId } = require('../../../utils/rocket-config-match.js')
const { filterExpiredMissions } = require('../../../utils/index-page-helpers.js')
const { openRocketModelDetail } = require('../utils/booster-nav.js')
const {
  checkShareEntryGate,
  warmShareEntitlement,
  withShareStampPath,
  withShareStampQuery
} = require('../utils/share-gate.js')
const {
  pickRocketModelShareImageUrl,
  pickRocketModelShareSourceForDownload
} = require('../utils/rocket-model-share-image.js')
const { ensureShareImageOnPage, pageShareImage } = require('../../../utils/share-thumb.js')

const GATE_PRODUCT_ID = 'space_notices'
const GATE_PRODUCT_NAME = SPACE_NOTICES_PRODUCT_NAME

function peekHomeLaunchIndex() {
  let upcoming = []
  try {
    const { peekCachedLaunchList } = require('../../../utils/api-request.js')
    const { mapLaunchToListItem } = require('../../../utils/api-launch-list.js')
    const up = peekCachedLaunchList(
      '/launches/upcoming/',
      {
        format: 'json',
        hide_recent_previous: true,
        limit: 100,
        mode: 'detailed',
        offset: 0,
        ordering: 'net'
      },
      true
    )
    if (up && Array.isArray(up.results) && up.results.length) {
      upcoming = filterExpiredMissions(
        up.results.map((launch, index) => mapLaunchToListItem(launch, index, 0, 'upcoming'))
      )
    }
  } catch (e) { /* 无首页缓存时只靠发射时刻分类 */ }
  return { upcoming, previous: [] }
}

Page({
  behaviors: [pageBase],
  _fallbackTab: '/pages/monitor/monitor',

  data: {
    loading: true,
    errorText: '',
    upcoming: [],
    totalCount: 0,
    shareGateExpireAt: 0,
    shareImage: ''
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
        this.setData({ loading: false, errorText: '开通星际通行证或看广告后可使用发射航警地图' })
        setTimeout(() => this.goBack(), 500)
        return
      }
    }
    warmShareEntitlement(this, GATE_PRODUCT_ID)
    this.loadList()
  },

  onShow() {
    if (this._rawEntries && this._rawEntries.length) {
      this._applyEntries(this._rawEntries)
      this._upgradeRocketImages()
    }
  },

  async loadList() {
    const keepList = !!(this.data.upcoming.length)
    this.setData({ loading: !keepList, errorText: '' })
    try {
      const res = await listSpaceNoticeEntries({ limit: 40, upcomingOnly: true })
      this._refreshPreview()
      if (!res || !res.success) {
        this.setData({
          loading: false,
          errorText: (res && res.error) || '加载失败，请先部署云函数 spaceNotices'
        })
        this._quietSync()
        return
      }
      const rows = res.results || []
      this._rawEntries = rows
      this._applyEntries(rows)
      this._upgradeRocketImages()
      this._quietSync()
    } catch (e) {
      this.setData({
        loading: false,
        errorText: '加载失败：' + ((e && e.message) || '网络错误')
      })
      this._quietSync()
    }
  },

  _applyEntries(rows) {
    const home = peekHomeLaunchIndex()
    const split = splitEntryCards(rows, {
      upcomingLaunches: home.upcoming,
      previousLaunches: home.previous,
      now: Date.now()
    })
    this.setData({
      loading: false,
      upcoming: split.upcoming,
      totalCount: split.upcoming.length
    })
    this._syncShareImage(split.upcoming[0])
  },

  async _upgradeRocketImages() {
    const need = (this.data.upcoming || []).some((e) => e && !e.rocketImage)
    if (!need) return
    try {
      const meta = await getRocketConfigMeta()
      const configs = meta && meta.configs
      if (!configs || !Object.keys(configs).length) return
      const upcoming = applyConfigImages(this.data.upcoming, configs)
      this.setData({ upcoming })
      this._syncShareImage(upcoming[0])
    } catch (e) { /* 目录未缓存时保持现图 */ }
  },

  onRocketImageError(e) {
    const key = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.key
    if (!key) return
    const clear = (list) =>
      (list || []).map((item) => (item && item.entryKey === key ? Object.assign({}, item, { rocketImage: '' }) : item))
    this.setData({
      upcoming: clear(this.data.upcoming)
    })
  },

  retryLoad() {
    this._autoSynced = false
    this.loadList()
  },

  async _quietSync() {
    if (this._autoSynced) return
    this._autoSynced = true
    try {
      const res = await syncSpaceNotices()
      if (res && res.success && !res.throttled) this.loadList()
    } catch (e) { /* 定时器会继续入库 */ }
  },

  openMap(e) {
    const key = e.currentTarget.dataset.key
    if (!key) return
    navigateTo(ROUTES.SPACE_NOTICE_MAP, { entryKey: key })
  },

  async onTapRocketName(e) {
    if (this._rocketNavBusy) return
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {}
    const configId = cleanConfigId(ds.configId)
    if (!configId) {
      wx.showToast({ title: '暂无该型号档案', icon: 'none' })
      return
    }
    try { wx.vibrateShort({ type: 'light' }) } catch (err) {}
    const allowed = await gateCheck('booster_genealogy', '全球可回收火箭族谱')
    if (!allowed) return
    this._rocketNavBusy = true
    try {
      await openRocketModelDetail(configId, { skipGate: true })
    } catch (err) {
      wx.showToast({ title: '暂无该型号档案', icon: 'none' })
    } finally {
      this._rocketNavBusy = false
    }
  },

  openChinaMap() {
    navigateTo(ROUTES.SPACE_NOTICE_MAP, { entryKey: CHINESE_COLLECTION_KEY })
  },

  _refreshPreview() {
    try {
      const card = this.selectComponent('#chinaNoticePreview')
      if (card && typeof card.refresh === 'function') card.refresh()
    } catch (e) {}
  },

  _shareTitle() {
    const n = this.data.totalCount || 0
    return n ? `发射航警地图 · ${n} 场任务的危险区` : '发射航警地图 · 中国航警 / NOTAM'
  },

  _syncShareImage(card) {
    const opts = {
      displayImage: card && card.rocketImage,
      rawImage: card && card.rocketImage,
      rocketName: card && (card.rocketNameEn || card.rocketName)
    }
    const url = pickRocketModelShareImageUrl(opts)
    if (this.data.shareImage !== url) this.setData({ shareImage: url })
    ensureShareImageOnPage(this, pickRocketModelShareSourceForDownload(opts))
  },

  onShareAppMessage() {
    return {
      title: this._shareTitle(),
      path: withShareStampPath(ROUTES.SPACE_NOTICE_LIST, this),
      imageUrl: pageShareImage(this)
    }
  },

  onShareTimeline() {
    return {
      title: this._shareTitle(),
      query: withShareStampQuery('', this),
      imageUrl: pageShareImage(this)
    }
  }
})
