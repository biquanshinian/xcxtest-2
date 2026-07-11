const { formatMapUpdateTime, buildMapStatePatch, createMapBaseState, buildMapLayoutData, buildSelectionPatch, buildMapShareOptions, copyMapText, runMapRefresh } = require('./utils/map-page-common.js')
const { getUpcomingMissions, getCompletedMissions } = require('../../utils/api-launch-list.js')
const { LAUNCH_SITES, toMarker } = require('./utils/map-scenes.js')
const pageBase = require('../../utils/page-base.js')

Page({
  behaviors: [pageBase],
  _fallbackTab: '/pages/monitor/monitor',
  data: {
    statusBarHeight: 44,
    capsuleTop: 0,
    capsuleHeight: 32,
    mapActionTop: 0,
    latitude: 28.6,
    longitude: -80.6,
    scale: 3,
    markers: [],
    launchSites: LAUNCH_SITES,
    selectedSite: null,
    siteStatsLoading: false,
    selectedMissionType: 'all',
    panelCollapsed: true,
    actionMenuCollapsed: true,
    ...createMapBaseState({
      dataSourceText: 'Upcoming + Completed Missions',
      dataUpdatedText: '待更新',
      analyticsScene: 'launch-site-map',
      shareTitle: '全球发射基地'
    }),
    missionTypeOptions: [
      { id: 'all', label: '全部' },
      { id: 'starlink', label: 'Starlink' },
      { id: 'crewed', label: '载人' },
      { id: 'cargo', label: '货运' },
      { id: 'starship', label: 'Starship' }
    ]
  },

  onLoad(options = {}) {
    this.initUiShell()
    const app = getApp()
    const markers = LAUNCH_SITES.map((item) => toMarker(item, { color: item.accentColor || '#0A84FF' }))
    this._focusSiteId = Number(options.focusId || 0)
    this.setData({
      ...buildMapLayoutData(app),
      markers,
      selectedSite: LAUNCH_SITES[0] || null
    })
    this.loadLaunchSiteStats()
  },


  getMissionType(mission) {
    const text = [mission.missionName, mission.name, mission.rocketName, mission.launchSite, mission.padLocation].filter(Boolean).join(' ').toLowerCase()
    if (/starlink/.test(text)) return 'starlink'
    if (/crew|astronaut|dragon|shenzhou|神舟|soyuz|联盟|starliner/.test(text)) return 'crewed'
    if (/cargo|resupply|crs|tianzhou|天舟|progress|进步/.test(text)) return 'cargo'
    if (/starship|super heavy|booster|ship\s*\d+/.test(text)) return 'starship'
    return 'other'
  },

  formatMissionTime(value) {
    if (!value) return '暂无'
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return '暂无'
    const month = date.getMonth() + 1
    const day = date.getDate()
    const hour = String(date.getHours()).padStart(2, '0')
    const minute = String(date.getMinutes()).padStart(2, '0')
    return `${month}/${day} ${hour}:${minute}`
  },

  getActivityMeta(site) {
    const upcomingCount = Number(site && site.upcomingCount) || 0
    const totalMissions = Number(site && site.totalMissions) || 0
    if (upcomingCount >= 2) {
      return { label: '高活跃', color: '#34C759' }
    }
    if (upcomingCount >= 1 || totalMissions >= 8) {
      return { label: '中活跃', color: '#0A84FF' }
    }
    return { label: '低活跃', color: '#8E8E93' }
  },

  inferSiteKey(mission) {
    const text = [mission.launchSite, mission.padLocation, mission.missionName, mission.rocketName].filter(Boolean).join(' ').toLowerCase()
    // SpaceX
    if (/starbase|boca chica|texas/.test(text)) return 'starbase'
    if (/39a|kennedy/.test(text)) return 'lc-39a'
    if (/slc-40|cape canaveral/.test(text)) return 'slc-40'
    if (/slc-4e|vandenberg/.test(text)) return 'slc-4e'
    if (/omelek|kwajalein|falcon 1/.test(text)) return 'oca'
    // 中国
    if (/wenchang|文昌/.test(text)) return 'wenchang'
    if (/jiuquan|酒泉/.test(text)) return 'jiuquan'
    if (/xichang|西昌/.test(text)) return 'xichang'
    if (/taiyuan|太原/.test(text)) return 'taiyuan'
    // 俄罗斯
    if (/baikonur/.test(text)) return 'baikonur'
    if (/vostochny/.test(text)) return 'vostochny'
    if (/plesetsk/.test(text)) return 'plesetsk'
    // 欧洲
    if (/kourou|guiana/.test(text)) return 'kourou'
    // 印度
    if (/sriharikota|satish dhawan|shar/.test(text)) return 'sriharikota'
    // 日本
    if (/tanegashima/.test(text)) return 'tanegashima'
    // 韩国
    if (/naro|goheung/.test(text)) return 'naro'
    // 伊朗
    if (/semnan/.test(text)) return 'semnan'
    // 美国其他
    if (/wallops|mid-atlantic|mars/.test(text)) return 'wallops'
    // 新西兰 Rocket Lab
    if (/mahia|rocket lab lc-?1/.test(text)) return 'mahia'
    return ''
  },

  async loadLaunchSiteStats() {
    this.setData({ siteStatsLoading: true, ...buildMapStatePatch({ loading: true, errorText: '', emptyText: '' }) })
    try {
      const [upRes, compRes] = await Promise.all([
        getUpcomingMissions(80, 0),
        getCompletedMissions(120, 0)
      ])
      this._allMissions = [].concat(upRes && upRes.list ? upRes.list : [], compRes && compRes.list ? compRes.list : [])
      this.applyMissionTypeFilter(this.data.selectedMissionType || 'all')
      this.setData({ siteStatsLoading: false, loading: false, dataUpdatedText: formatMapUpdateTime(new Date()) })
    } catch (e) {
      this.setData({ siteStatsLoading: false, ...buildMapStatePatch({ loading: false, errorText: '发射场数据加载失败' }) })
      throw e
    }
  },

  applyMissionTypeFilter(type) {
    const currentType = type || 'all'
    const allMissions = Array.isArray(this._allMissions) ? this._allMissions : []
    const filteredMissions = currentType === 'all'
      ? allMissions
      : allMissions.filter((mission) => this.getMissionType(mission) === currentType)

    const siteMap = {}
    filteredMissions.forEach((mission) => {
      const key = this.inferSiteKey(mission)
      if (!key) return
      if (!siteMap[key]) {
        siteMap[key] = {
          totalMissions: 0,
          upcomingCount: 0,
          completedCount: 0,
          rockets: new Set(),
          latestMission: '',
          latestTime: 0,
          nextMission: '',
          nextTime: 0,
          latestTimeText: '暂无',
          nextTimeText: '暂无'
        }
      }
      const bucket = siteMap[key]
      bucket.totalMissions += 1
      const ts = mission.launchTime ? new Date(mission.launchTime).getTime() : 0
      const isUpcoming = mission.statusCategory === 'pending' || mission.statusCategory === 'go' || mission.statusCategory === 'hold'
      if (isUpcoming) {
        bucket.upcomingCount += 1
        if (ts && (!bucket.nextTime || ts < bucket.nextTime)) {
          bucket.nextTime = ts
          bucket.nextMission = mission.missionName || mission.name || ''
          bucket.nextTimeText = this.formatMissionTime(mission.launchTime)
        }
      } else {
        bucket.completedCount += 1
        if (ts && ts > bucket.latestTime) {
          bucket.latestTime = ts
          bucket.latestMission = mission.missionName || mission.name || ''
          bucket.latestTimeText = this.formatMissionTime(mission.launchTime)
        }
      }
      if (mission.rocketName) bucket.rockets.add(mission.rocketName)
    })

    const launchSites = LAUNCH_SITES.map((site) => {
      const stats = siteMap[site.key] || {}
      const activityMeta = this.getActivityMeta({
        upcomingCount: stats.upcomingCount || 0,
        totalMissions: stats.totalMissions || 0
      })
      return {
        ...site,
        totalMissions: stats.totalMissions || 0,
        upcomingCount: stats.upcomingCount || 0,
        completedCount: stats.completedCount || 0,
        rocketSummary: stats.rockets ? Array.from(stats.rockets).slice(0, 3).join(' / ') : site.vehicle,
        latestMission: stats.latestMission || '暂无任务记录',
        latestTimeText: stats.latestTimeText || '暂无',
        nextMission: stats.nextMission || '暂无待发任务',
        nextTimeText: stats.nextTimeText || '暂无',
        activityLabel: activityMeta.label,
        activityColor: activityMeta.color
      }
    })
    const markers = launchSites.map((item) => toMarker(item, { color: item.activityColor || item.accentColor || '#0A84FF' }))
    const preferredId = this._focusSiteId || ((this.data.selectedSite && this.data.selectedSite.id) || 101)
    const selectedSite = launchSites.find((item) => item.id === preferredId) || launchSites[0] || null
    this.setData({
      launchSites,
      selectedSite,
      selectedMissionType: currentType,
      markers,
      latitude: selectedSite ? selectedSite.latitude : this.data.latitude,
      longitude: selectedSite ? selectedSite.longitude : this.data.longitude,
      scale: selectedSite ? 7 : this.data.scale,
      emptyText: launchSites.length ? '' : '暂无发射场数据'
    })
  },

  onMissionTypeTap(e) {
    const type = e.currentTarget.dataset.type || 'all'
    if (type === this.data.selectedMissionType) return
    this.applyMissionTypeFilter(type)
  },

  onSiteTap(e) {
    const id = Number(e.currentTarget.dataset.id)
    this.selectSiteById(id)
  },

  selectSiteById(id) {
    const patch = buildSelectionPatch({
      list: this.data.launchSites,
      id,
      selectedKey: 'selectedSite',
      scale: 7
    })
    if (!patch) return
    this.setData(patch)
  },

  onMarkerTap(e) {
    const markerId = Number((e && e.detail && e.detail.markerId) || 0)
    this.selectSiteById(markerId)
  },

  async refreshMapData() {
    await runMapRefresh(this, async () => {
      await this.loadLaunchSiteStats()
    })
  },

  resetWorldView() {
    this.setData({
      latitude: 28.6,
      longitude: -80.6,
      scale: 3
    })
  },

  copySummary() {
    const site = this.data.selectedSite || {}
    copyMapText(
      `发射场：${site.name || '暂无'}\n区域：${site.region || '-'}\n总任务：${site.totalMissions || 0}\n待发：${site.upcomingCount || 0}\n下次任务：${site.nextMission || '暂无'}\n下次时间：${site.nextTimeText || '暂无'}`,
      '发射场信息已复制'
    )
  },

  togglePanelCollapsed() {
    this.setData({ panelCollapsed: !this.data.panelCollapsed })
  },

  toggleActionMenuCollapsed() {
    this.setData({ actionMenuCollapsed: !this.data.actionMenuCollapsed })
  },

  onShareAppMessage() {
    const site = this.data.selectedSite || {}
    return buildMapShareOptions({
      shareTitle: this.data.shareTitle,
      detailText: site.shortName,
      fallbackDetailText: '全球发射场',
      path: '/subpackages/monitor-pages/launch-site-map'
    })
  },

  // goBack inherited from pageBase
})
