const { formatMapUpdateTime, buildMapStatePatch, createMapBaseState, buildMapLayoutData, buildSelectionPatch, buildMapShareOptions, copyMapText, runMapRefresh } = require('./utils/map-page-common.js')
const { getStarshipStatusFromDB } = require('../../utils/api-app-services.js')
const { STARBASE_CENTER, STARBASE_FACILITIES, toMarker } = require('./utils/map-scenes.js')
const { getThemeClassSync, isLightSync, getPageBgSync } = require('../../utils/theme.js')

const STARSHIP_SHARED_TTL = 10 * 60 * 1000

/** 优先复用 progress 页写入的全局共享星舰状态（10 分钟内新鲜），未命中再走库读 */
function getSharedStarshipStatus() {
  try {
    const app = getApp()
    const shared = app && app.globalData && app.globalData.starshipStatus
    if (shared && shared.data && Date.now() - (shared.fetchedAt || 0) < STARSHIP_SHARED_TTL) {
      return Promise.resolve(shared.data)
    }
  } catch (e) {}
  return getStarshipStatusFromDB()
}

Page({
  data: {
    themeClass: '',
    themeLight: false,
    pageBgColor: '#000000',
    statusBarHeight: 44,
    capsuleTop: 0,
    capsuleHeight: 32,
    mapActionTop: 0,
    latitude: STARBASE_CENTER.latitude,
    longitude: STARBASE_CENTER.longitude,
    scale: 14,
    markers: [],
    selectedFacility: null,
    facilities: STARBASE_FACILITIES,
    liveStatusText: '同步中',
    currentFocusText: '载具状态同步中',
    panelCollapsed: true,
    actionMenuCollapsed: true,
    ...createMapBaseState({
      dataSourceText: 'starshipStatus 云数据库',
      dataUpdatedText: '待更新',
      analyticsScene: 'starbase-map',
      shareTitle: 'Starbase 设施图'
    })
  },

  onLoad(options = {}) {
    const app = getApp()
    const markers = STARBASE_FACILITIES.map((item) => toMarker(item, { color: '#34C759', display: 'BYCLICK' }))
    this._focusFacilityId = Number(options.focusId || 0)
    const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : []
    this.setData({
      ...buildMapLayoutData(app),
      themeClass: getThemeClassSync(),
      themeLight: isLightSync(),
      pageBgColor: getPageBgSync(),
      markers,
      selectedFacility: STARBASE_FACILITIES[0] || null,
      isDirectEntry: pages.length <= 1
    })
    this.loadLiveFacilityData()
  },


  enrichFacilitiesWithLiveStatus(statusData) {
    const booster = statusData && statusData.booster ? statusData.booster : {}
    const ship = statusData && statusData.ship ? statusData.ship : {}
    const boosterDetail = booster.detail || {}
    const shipDetail = ship.detail || {}
    const liveText = [booster.id, booster.status, ship.id, ship.status].filter(Boolean).join(' / ')
    const currentFocusText = shipDetail.title || boosterDetail.title || '当前工作重心待同步'
    const facilities = STARBASE_FACILITIES.map((item) => {
      if (item.key === 'orbital-launch-mount' || item.key === 'mechazilla-tower') {
        return {
          ...item,
          status: booster.status || ship.status || item.status,
          focus: '发射 / 回收',
          detailTitle: boosterDetail.title || '发射准备',
          detailSummary: boosterDetail.summary || '塔架与发射设施状态同步中。',
          isKeyFacility: item.key === 'orbital-launch-mount',
          summary: `${item.summary} 当前组合体：${[booster.id, ship.id].filter(Boolean).join(' + ') || '暂无'}。`
        }
      }
      if (item.key === 'megabay-1' || item.key === 'build-site' || item.key === 'starfactory') {
        return {
          ...item,
          status: ship.status || booster.status || item.status,
          focus: '总装 / 制造',
          detailTitle: shipDetail.title || '总装推进',
          detailSummary: shipDetail.summary || '生产设施正在推进当前星舰制造任务。',
          isKeyFacility: item.key === 'megabay-1' && !boosterDetail.title,
          summary: `${item.summary} 当前生产焦点：${ship.id || 'Ship'} / ${booster.id || 'Booster'}。`
        }
      }
      if (item.key === 'masseys-test-site') {
        return {
          ...item,
          status: booster.status || '测试中',
          focus: '静态点火 / 验证',
          detailTitle: boosterDetail.title || '测试准备',
          detailSummary: boosterDetail.summary || '测试台状态同步中。',
          isKeyFacility: /test|点火/i.test(boosterDetail.title || boosterDetail.summary || ''),
          summary: `${item.summary} 当前高关联载具：${booster.id || 'Booster'}。`
        }
      }
      return { ...item, isKeyFacility: false }
    }).sort((a, b) => Number(!!b.isKeyFacility) - Number(!!a.isKeyFacility))
    return { facilities, liveText: liveText || '暂无实时状态', currentFocusText }
  },

  async loadLiveFacilityData() {
    this.setData(buildMapStatePatch({ loading: true, errorText: '', emptyText: '' }))
    try {
      const statusData = await getSharedStarshipStatus()
      const { facilities, liveText, currentFocusText } = this.enrichFacilitiesWithLiveStatus(statusData)
      const markers = facilities.map((item) => toMarker(item, { color: item.isKeyFacility ? '#FF9F0A' : '#34C759', display: 'BYCLICK' }))
      const preferredId = this._focusFacilityId || ((this.data.selectedFacility && this.data.selectedFacility.id) || 1)
      const selectedFacility = facilities.find((item) => item.id === preferredId) || facilities[0] || null
      this.setData({
        facilities,
        markers,
        selectedFacility,
        latitude: selectedFacility ? selectedFacility.latitude : this.data.latitude,
        longitude: selectedFacility ? selectedFacility.longitude : this.data.longitude,
        scale: selectedFacility ? 16 : this.data.scale,
        liveStatusText: liveText,
        currentFocusText,
        dataUpdatedText: formatMapUpdateTime(new Date()),
        loading: false,
        emptyText: facilities.length ? '' : '暂无设施数据'
      })
    } catch (e) {
      this.setData({
        liveStatusText: '实时状态获取失败',
        currentFocusText: '工作重心同步失败',
        ...buildMapStatePatch({ loading: false, errorText: '设施状态加载失败' })
      })
      throw e
    }
  },

  onFacilityTap(e) {
    const id = Number(e.currentTarget.dataset.id)
    this.selectFacilityById(id)
  },

  selectFacilityById(id) {
    const patch = buildSelectionPatch({
      list: this.data.facilities,
      id,
      selectedKey: 'selectedFacility'
    })
    if (!patch) return
    this.setData(patch)
  },

  onMarkerTap(e) {
    const markerId = Number((e && e.detail && e.detail.markerId) || 0)
    this.selectFacilityById(markerId)
  },

  async refreshMapData() {
    await runMapRefresh(this, async () => {
      await this.loadLiveFacilityData()
    })
  },

  resetMapView() {
    this.setData({
      latitude: STARBASE_CENTER.latitude,
      longitude: STARBASE_CENTER.longitude,
      scale: 14
    })
  },

  copySummary() {
    const facility = this.data.selectedFacility || {}
    copyMapText(
      `设施：${facility.name || '暂无'}\n分类：${facility.category || '-'}\n状态：${facility.status || '-'}\n重心：${facility.focus || '-'}\n摘要：${facility.summary || '-'}\n坐标：${facility.latitude || '-'}, ${facility.longitude || '-'}`,
      '设施信息已复制'
    )
  },

  togglePanelCollapsed() {
    this.setData({ panelCollapsed: !this.data.panelCollapsed })
  },

  toggleActionMenuCollapsed() {
    this.setData({ actionMenuCollapsed: !this.data.actionMenuCollapsed })
  },

  onShareAppMessage() {
    const facility = this.data.selectedFacility || {}
    return buildMapShareOptions({
      shareTitle: this.data.shareTitle,
      detailText: facility.shortName,
      fallbackDetailText: '设施详情',
      path: '/subpackages/progress-extra/starbase-map'
    })
  },

  /**
   * 返回按钮兜底逻辑：
   * 1) 正常导航栈（>1 页）→ navigateBack
   * 2) 通过分享卡片冷启动进入（栈只有 1 页）→ switchTab 到「星舰进度」TabBar
   * 3) 极端情况下 switchTab 仍失败 → reLaunch 兜底
   * 这样无论从哪种入口进来，左上角返回按钮都不会出现「无反应」。
   */
  goBack() {
    const FALLBACK_TAB = '/pages/progress/progress'
    const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : []

    // wx.reLaunch 不支持 tabBar 页面，所以用 setTimeout + 再试 switchTab 兜底
    const retrySwitch = () => {
      setTimeout(() => {
        wx.switchTab({
          url: FALLBACK_TAB,
          fail: () => {
            try { wx.showToast({ title: '返回失败，请重启小程序', icon: 'none' }) } catch (_) {}
          }
        })
      }, 50)
    }

    if (pages.length > 1) {
      wx.navigateBack({
        fail: () => {
          wx.switchTab({ url: FALLBACK_TAB, fail: retrySwitch })
        }
      })
      return
    }
    wx.switchTab({ url: FALLBACK_TAB, fail: retrySwitch })
  }
})
