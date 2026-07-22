/**
 * 首页「发射日历」Tab 逻辑 — 分包异步加载，减轻主包体积
 */
const { formatDate, resolveMissionRocketImage } = require('../../../utils/util.js')
const { attachMissionDetailMeta } = require('../../../utils/index-mission-nav.js')
const { getMissionNextOffset } = require('../../../utils/index-mission-services.js')
const { CALENDAR_SITE_META } = require('../../../utils/index-page-helpers.js')
const { getLaunchStatsFromDB } = require('../../../utils/api-app-services.js')
const { ROUTES, navigateTo } = require('../../../utils/routes.js')
const {
  computeLaunchCalendarSignature,
  LAUNCH_CALENDAR_ACK_SIG_KEY
} = require('../../../utils/launch-calendar-signature.js')
const storageCache = require('../../../utils/storage-sync-cache.js')

const CALENDAR_CACHE_MAX_AGE_MS = 5 * 60 * 1000
const CALENDAR_PAGE_LIMIT = 80
const LAUNCH_STATS_REFRESH_TTL = 5 * 60 * 1000
// 单个月份「自动补数」的最大触发次数（翻月后自动重置），防止极端情况下的死循环/过量请求
const CALENDAR_AUTO_LOAD_MAX = 12

function shouldHydrateCalendarFromMissionLists(options = {}) {
  const {
    missionType,
    upcomingMissions,
    completedMissions,
    calendarAllMissions,
    calendarDataLoaded
  } = options

  if (missionType !== 'calendar') return false

  const upcomingCount = Array.isArray(upcomingMissions) ? upcomingMissions.length : 0
  const completedCount = Array.isArray(completedMissions) ? completedMissions.length : 0
  const loadedCount = upcomingCount + completedCount
  const currentCount = Array.isArray(calendarAllMissions) ? calendarAllMissions.length : 0

  if (!loadedCount) return false
  return !calendarDataLoaded || currentCount === 0 || loadedCount > currentCount
}

function buildCalendarExpandedState(options = {}) {
  const {
    keepExpanded = true,
    expandedDateKey,
    byDate
  } = options

  const nextExpandedDateKey = keepExpanded ? expandedDateKey : ''
  const expandedDateMissions = nextExpandedDateKey ? ((byDate && byDate[nextExpandedDateKey]) || []) : []
  const expandedDateTitle = nextExpandedDateKey && String(nextExpandedDateKey).split('-').length === 3
    ? `${parseInt(String(nextExpandedDateKey).split('-')[1])}月${parseInt(String(nextExpandedDateKey).split('-')[2])}日`
    : ''

  return {
    expandedDateKey: expandedDateMissions.length || keepExpanded ? nextExpandedDateKey : '',
    expandedDateTitle: expandedDateMissions.length || keepExpanded ? expandedDateTitle : '',
    expandedDateMissions: expandedDateMissions.length || keepExpanded ? expandedDateMissions : []
  }
}

function buildCalendarDerivedSetData(options = {}) {
  const {
    filteredMissions,
    expandedState,
    calendarSiteOptions,
    calendarFilterSummaryText
  } = options

  return {
    calendarFilteredCount: Array.isArray(filteredMissions) ? filteredMissions.length : 0,
    expandedDateKey: expandedState.expandedDateKey,
    expandedDateTitle: expandedState.expandedDateTitle,
    expandedDateMissions: expandedState.expandedDateMissions,
    calendarSiteOptions,
    calendarFilterSummaryText
  }
}

function getValidCalendarCache(cache, maxAgeMs = CALENDAR_CACHE_MAX_AGE_MS) {
  const cached = cache && typeof cache === 'object' ? cache : null
  const cachedAll = cached && Array.isArray(cached.all) ? cached.all : []
  const cachedAt = cached && Number(cached.ts)
  const hasUsableCache = !!(
    cached &&
    cached.byDate &&
    cachedAt &&
    cachedAll.length > 0 &&
    Date.now() - cachedAt < maxAgeMs
  )

  if (!hasUsableCache) {
    return null
  }

  return {
    allMissions: cachedAll,
    upOffset: Math.max(0, Number(cached.upOffset) || 0),
    compOffset: Math.max(0, Number(cached.compOffset) || 0),
    upHasMore: cached.upHasMore !== false,
    compHasMore: cached.compHasMore !== false
  }
}

function buildCalendarMissionBatch(options) {
  const {
    upcomingResult,
    completedResult,
    processMission,
    currentMissions = []
  } = options || {}

  const upList = ((upcomingResult && upcomingResult.list) || []).map((mission, index) => processMission(mission, index, true))
  const compList = ((completedResult && completedResult.list) || []).map((mission, index) => processMission(mission, index, false))
  const appendedMissions = [...upList, ...compList]

  return {
    allMissions: [...(Array.isArray(currentMissions) ? currentMissions : []), ...appendedMissions],
    appendedMissions,
    nextState: {
      upOffset: getMissionNextOffset(upcomingResult && upcomingResult.res, upcomingResult && upcomingResult.offset),
      compOffset: getMissionNextOffset(completedResult && completedResult.res, completedResult && completedResult.offset),
      upHasMore: !!(upcomingResult && upcomingResult.res && upcomingResult.res.hasMore),
      compHasMore: !!(completedResult && completedResult.res && completedResult.res.hasMore)
    }
  }
}

const calendarMethods = {
  _processCalendarMission(m, idx, isUpcoming) {
    const mission = attachMissionDetailMeta({
      ...this._withResolvedRocketImage(m),
      _wxkey: `cal-${isUpcoming ? 'up' : 'comp'}-${idx}-${m.id || ''}`,
      _isUpcoming: isUpcoming,
      formattedTime: m.launchTime ? formatDate(m.launchTime, 'MM月DD日 HH:mm') : '时间未知'
    }, {
      id: m.id,
      detailType: isUpcoming ? 'upcoming' : 'completed'
    })
    const linkMeta = this.getMissionMapLinkMeta(mission)
    return {
      ...mission,
      _calendarQueryMeta: this.buildCalendarMissionQueryMeta(mission),
      _mapLinkMeta: linkMeta,
      _hasMapLink: !!(linkMeta && linkMeta.entries && linkMeta.entries.length)
    }
  },
  getMissionTypeCategory(mission) {
    const missionText = [mission.missionName, mission.name, mission.rocketName].filter(Boolean).join(' ').toLowerCase()
    const typeText = missionText.replace(/[-_]/g, ' ')

    const isStarshipMission = /starship|super heavy|integrated flight test|orbital flight test|星舰/.test(typeText)
      || /\bift\s*-?\s*\d+\b/.test(typeText)
      || (/\bship\s*\d+\b/.test(typeText) && /\bbooster\s*\d+\b/.test(typeText))

    if (isStarshipMission) return 'starship'
    if (/starlink/.test(typeText)) return 'starlink'
    return 'other'
  },

  inferLaunchSiteKey(mission) {
    const text = [mission.launchSite, mission.padLocation, mission.missionName, mission.rocketName].filter(Boolean).join(' ').toLowerCase()
    if (/starbase|boca chica|texas|德州/.test(text)) return 'starbase'
    if (/39a|kennedy|肯尼迪/.test(text)) return 'lc-39a'
    if (/slc-40|cape canaveral|卡纳维拉尔/.test(text)) return 'slc-40'
    if (/slc-4e|vandenberg|范登堡/.test(text)) return 'slc-4e'
    if (/omelek|kwajalein|falcon 1/.test(text)) return 'oca'
    return ''
  },

  getMissionStatusCategoryForCalendar(mission) {
    const status = String(mission && mission.statusCategory || '').toLowerCase()
    if (mission && mission._isUpcoming) return 'upcoming'
    if (status === 'success') return 'success'
    if (status === 'failure' || status === 'partial') return 'failure'
    return 'completed'
  },

  buildCalendarMissionQueryMeta(mission) {
    const siteKey = this.inferLaunchSiteKey(mission)
    return {
      type: this.getMissionTypeCategory(mission),
      siteKey,
      status: this.getMissionStatusCategoryForCalendar(mission)
    }
  },

  buildCalendarSiteOptions(allMissions) {
    const seen = {}
    const options = [{ id: 'all', label: '全部基地' }]
    ;(allMissions || []).forEach((mission) => {
      const siteKey = mission && mission._calendarQueryMeta ? mission._calendarQueryMeta.siteKey : this.inferLaunchSiteKey(mission)
      if (!siteKey || seen[siteKey] || !CALENDAR_SITE_META[siteKey]) return
      seen[siteKey] = true
      options.push({ id: siteKey, label: CALENDAR_SITE_META[siteKey].label })
    })
    return options
  },

  getCalendarFilterSummaryText() {
    const parts = []
    const quickMap = {
      starship: '星舰',
      starlink: 'Starlink'
    }
    const statusMap = {
      upcoming: '待发',
      completed: '已完成',
      success: '成功',
      failure: '失败/部分'
    }

    if (quickMap[this.data.calendarQuickFilter]) {
      parts.push(quickMap[this.data.calendarQuickFilter])
    }

    if (this.data.calendarSiteFilter && this.data.calendarSiteFilter !== 'all') {
      const site = (this.data.calendarSiteOptions || []).find(item => item.id === this.data.calendarSiteFilter)
      if (site && site.label) parts.push(site.label)
    }

    if (statusMap[this.data.calendarStatusFilter]) {
      parts.push(statusMap[this.data.calendarStatusFilter])
    }

    return parts.length ? parts.join(' · ') : '全部任务'
  },

  getMissionMapLinkMeta(mission) {
    const siteKey = this.inferLaunchSiteKey(mission)
    const siteMeta = CALENDAR_SITE_META[siteKey]
    const entries = []
    if (siteMeta && siteMeta.launchSiteId) {
      entries.push({
        key: 'launch-site',
        label: '发射场地图',
        path: '/subpackages/monitor-pages/launch-site-map',
        query: `focusId=${siteMeta.launchSiteId}`
      })
    }

    if (siteKey === 'starbase') {
      entries.push({
        key: 'starbase',
        label: 'Starbase 设施图',
        path: '/subpackages/progress-extra/starbase-map',
        query: this.buildStarbaseFacilityQuery(mission)
      })
      entries.push({
        key: 'road-closure',
        label: '封路地图',
        path: '/subpackages/progress-extra/road-closure-map',
        query: this.buildRoadClosureQuery()
      })
    }

    return {
      siteKey,
      siteLabel: siteMeta ? siteMeta.label : '',
      entries
    }
  },

  buildStarbaseFacilityQuery(mission) {
    const text = [mission.missionName, mission.name, mission.rocketName, mission.padLocation, mission.launchSite].filter(Boolean).join(' ').toLowerCase()
    let focusId = 1
    if (/test|点火|raptor|engine/.test(text)) {
      focusId = 5
    } else if (/build|factory|ship|booster|starfactory|megabay|组装|总装/.test(text)) {
      focusId = 3
    }
    return `focusId=${focusId}`
  },

  buildRoadClosureQuery() {
    const notice = this.data.roadClosureNotice || {}
    const query = []
    if (notice.message) query.push(`message=${encodeURIComponent(notice.message)}`)
    if (notice.timeRange) query.push(`timeRange=${encodeURIComponent(notice.timeRange)}`)
    return query.join('&')
  },

  getFilteredCalendarMissions(source) {
    const allMissions = Array.isArray(source) ? source : (this.data.calendarAllMissions || [])
    const quickFilter = this.data.calendarQuickFilter || 'all'
    const siteFilter = this.data.calendarSiteFilter || 'all'
    const statusFilter = this.data.calendarStatusFilter || 'all'
    return allMissions.filter((mission) => {
      const meta = mission._calendarQueryMeta || this.buildCalendarMissionQueryMeta(mission)
      if (quickFilter !== 'all' && meta.type !== quickFilter) return false
      if (siteFilter !== 'all' && meta.siteKey !== siteFilter) return false
      if (statusFilter !== 'all' && meta.status !== statusFilter) return false
      return true
    })
  },

  buildCalendarDateMapFromMissions(missions) {
    const byDate = {}
    ;(missions || []).forEach((m) => {
      const t = m.launchTime || m.net || m.window_start
      if (!t) return
      const d = t instanceof Date ? t : new Date(t)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      if (!byDate[key]) byDate[key] = []
      byDate[key].push(m)
    })
    return byDate
  },

  scheduleUpcomingAgencyChipsOverflowHint() {
    if (this.data.missionType !== 'upcoming') return
    const self = this
    setTimeout(function () {
      self.updateUpcomingAgencyChipsOverflowHint()
    }, 0)
  },

  updateUpcomingAgencyChipsOverflowHint() {
    if (this.data.missionType !== 'upcoming') return
    const query = wx.createSelectorQuery().in(this)
    query.select('.upcoming-agency-scroll').boundingClientRect()
    query.select('.upcoming-agency-chips-row').boundingClientRect()
    query.exec((res) => {
      const scrollRect = res && res[0]
      const gridRect = res && res[1]
      const hasOverflow = !!(scrollRect && gridRect && gridRect.width > scrollRect.width + 2)
      if (hasOverflow !== this.data.upcomingAgencyChipsHasOverflow) {
        this.setData({ upcomingAgencyChipsHasOverflow: hasOverflow })
      }
    })
  },

  buildCalendarDerivedPayload(options = {}) {
    const keepExpanded = options.keepExpanded !== false
    const filteredMissions = this.getFilteredCalendarMissions(options.sourceMissions)
    const byDate = this.buildCalendarDateMapFromMissions(filteredMissions)
    const expandedState = buildCalendarExpandedState({
      keepExpanded,
      expandedDateKey: this.data.expandedDateKey,
      byDate
    })

    return {
      filteredMissions,
      byDate,
      expandedState,
      calendarSiteOptions: this.buildCalendarSiteOptions(Array.isArray(options.allMissions) ? options.allMissions : this.data.calendarAllMissions),
      calendarFilterSummaryText: this.getCalendarFilterSummaryText()
    }
  },

  updateCalendarDerivedState(options = {}, callback) {
    const payload = this.buildCalendarDerivedPayload(options)
    // 以下两项视图层不直接消费（wxml 仅用 calendarFilteredCount），存为实例变量减少 setData 体积
    this._calendarFilteredMissions = payload.filteredMissions
    this._calendarMissionsByDate = payload.byDate
    this.setData(buildCalendarDerivedSetData(payload), () => {
      if (typeof callback === 'function') callback(payload)
    })
  },

  applyCalendarBatchState(batch) {
    this._calendarUpOffset = batch.nextState.upOffset
    this._calendarCompOffset = batch.nextState.compOffset
    this._calendarUpHasMore = batch.nextState.upHasMore
    this._calendarCompHasMore = batch.nextState.compHasMore
  },

  restoreCalendarCacheSnapshot(cached) {
    this._calendarUpOffset = cached.upOffset || CALENDAR_PAGE_LIMIT
    this._calendarCompOffset = cached.compOffset || CALENDAR_PAGE_LIMIT
    this._calendarUpHasMore = cached.upHasMore
    this._calendarCompHasMore = cached.compHasMore
    this.applyCalendarMissionSnapshot(cached.allMissions, { saveCache: false })
  },

  fetchCalendarMissionPage(type, offset, enabled = true) {
    const safeOffset = Number(offset) || 0
    if (!enabled) {
      return Promise.resolve({
        res: { list: [], hasMore: false },
        list: [],
        offset: safeOffset
      })
    }

    return this.fetchMissionList(type, CALENDAR_PAGE_LIMIT, safeOffset).then(({ res, list }) => ({
      res,
      list,
      offset: safeOffset
    }))
  },

  async fetchCalendarMissionBatch(options = {}) {
    const appendMode = !!options.appendMode
    const processMission = this._processCalendarMission.bind(this)
    const [upcomingResult, completedResult] = await Promise.all([
      this.fetchCalendarMissionPage('upcoming', appendMode ? (this._calendarUpOffset || 0) : 0, appendMode ? this._calendarUpHasMore : true),
      this.fetchCalendarMissionPage('completed', appendMode ? (this._calendarCompOffset || 0) : 0, appendMode ? this._calendarCompHasMore : true)
    ])

    return buildCalendarMissionBatch({
      upcomingResult,
      completedResult,
      processMission,
      currentMissions: appendMode ? this.data.calendarAllMissions : undefined
    })
  },

  resetCalendarLoadFailureState() {
    this._calendarDataLoaded = false
    this._calendarFilteredMissions = []
    this._calendarMissionsByDate = {}
    this.setData({
      calendarLoading: false,
      calendarAllMissions: [],
      calendarFilteredCount: 0,
      calendarMapEntryList: [],
      expandedDateKey: '',
      expandedDateTitle: '',
      expandedDateMissions: []
    }, () => {
      this.buildCalendarDays()
      this._refreshLaunchCalendarDot([])
    })
  },

  finishCalendarAppendWithoutChanges() {
    this.setData({ calendarLoading: false })
    this._calendarExpandLoading = false
    this.buildCalendarDays()
  },

  applyCalendarMissionSnapshot(allMissions, options = {}) {
    const missions = (Array.isArray(allMissions) ? allMissions : []).map((m) => this._withResolvedRocketImage(m))
    const keepExpanded = options.keepExpanded !== false
    const saveCache = options.saveCache !== false
    this.setData({
      calendarAllMissions: missions,
      calendarLoading: false
    }, () => {
      this.updateCalendarDerivedState({ sourceMissions: missions, keepExpanded, allMissions: missions }, () => {
        this._calendarDataLoaded = true
        if (saveCache) {
          this._saveCalendarCache(missions, this._calendarMissionsByDate || {})
        }
        this.buildCalendarDays()
        try {
          const briefingComp = this.selectComponent('#morningBriefing')
          if (briefingComp && typeof briefingComp._loadBriefing === 'function') {
            briefingComp._loadBriefing()
          }
        } catch (e) {}
        this._refreshLaunchCalendarDot(missions)
      })
    })
  },

  /** 日历合并列表变更后刷新「发射日历」红点（与本地已读摘要比对） */
  _refreshLaunchCalendarDot(missions) {
    const list = Array.isArray(missions) ? missions : (this.data.calendarAllMissions || [])
    const sig = computeLaunchCalendarSignature(list)

    const applyDotState = (ack) => {
      if (this._calendarDotSuppressNextRefresh) {
        this._calendarDotSuppressNextRefresh = false
        if (sig) {
          storageCache.persistAsync(LAUNCH_CALENDAR_ACK_SIG_KEY, sig)
        }
        if (this.data.showLaunchCalendarDot) this.setData({ showLaunchCalendarDot: false })
        return
      }

      const ackStr = String(ack || '')
      if (!sig) {
        if (this.data.showLaunchCalendarDot) this.setData({ showLaunchCalendarDot: false })
        return
      }
      if (!ackStr) {
        storageCache.persistAsync(LAUNCH_CALENDAR_ACK_SIG_KEY, sig)
        if (this.data.showLaunchCalendarDot) this.setData({ showLaunchCalendarDot: false })
        return
      }
      const show = sig !== ackStr
      if (show !== this.data.showLaunchCalendarDot) {
        this.setData({ showLaunchCalendarDot: show })
      }
    }

    // 已加载则命中内存，否则异步预热一次（storage-sync-cache 内共享，避免重复读）
    storageCache.warmAsync(LAUNCH_CALENDAR_ACK_SIG_KEY, '').then(applyDotState)
  },

  hydrateCalendarFromLoadedMissionLists() {
    const upcomingSource = Array.isArray(this.data.upcomingMissions) ? this.data.upcomingMissions : []
    const completedSource = Array.isArray(this.data.completedMissions) ? this.data.completedMissions : []
    if (!upcomingSource.length && !completedSource.length) return false

    const processMission = this._processCalendarMission.bind(this)
    const upList = upcomingSource.map((m, i) => processMission(m, i, true))
    const compList = completedSource.map((m, i) => processMission(m, i, false))
    const allMissions = [...upList, ...compList]

    if (!allMissions.length) return false

    this._calendarUpOffset = this.data.missionsOffset || upList.length || 0
    this._calendarCompOffset = this.data.completedMissionsOffset || compList.length || 0
    this._calendarUpHasMore = typeof this.data.missionsHasMore === 'boolean' ? this.data.missionsHasMore : true
    this._calendarCompHasMore = typeof this.data.completedMissionsHasMore === 'boolean' ? this.data.completedMissionsHasMore : true

    this.applyCalendarMissionSnapshot(allMissions)
    return true
  },

  syncCalendarFromMissionListsIfNeeded() {
    const up = this.data.upcomingMissions || []
    const comp = this.data.completedMissions || []
    const cal = this.data.calendarAllMissions || []

    const shouldHydrate = shouldHydrateCalendarFromMissionLists({
      missionType: this.data.missionType,
      upcomingMissions: up,
      completedMissions: comp,
      calendarAllMissions: cal,
      calendarDataLoaded: this._calendarDataLoaded
    })

    // 非「发射日历」Tab 时默认不会 hydrate；但日历为空会导致简报「昨日回顾」缺数据。有待合并列表则补一份日历快照。
    const needCalendarBackfill = cal.length === 0 && (up.length > 0 || comp.length > 0)

    if (shouldHydrate || needCalendarBackfill) {
      this.hydrateCalendarFromLoadedMissionLists()
    }
  },

  _getTodayKey() {
    const n = new Date()
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`
  },

  async loadLaunchStats(options = {}) {
    const safeOptions = options || {}
    const forceRefresh = !!safeOptions.forceRefresh
    const loadSeq = (this._launchStatsLoadSeq = (this._launchStatsLoadSeq || 0) + 1)

    return this.runTimedManagedPageRequest({
      forceRefresh,
      strategy: 'launchStats',
      stats: this.data.launchStats,
      lastLoadedAt: this._launchStatsLoadedAt,
      ttlMs: LAUNCH_STATS_REFRESH_TTL,
      errorMessage: this.data.launchStatsError,
      getCachedValue: () => this.data.launchStats,
      promiseKey: '_loadLaunchStatsPromise',
      requestFactory: async () => {
      this.setData({ launchStatsLoading: true, launchStatsError: '' })
      try {
        const stats = await getLaunchStatsFromDB({ forceRefresh })
        if (loadSeq !== this._launchStatsLoadSeq) return stats
        this._launchStatsLoadedAt = Date.now()
        this.setData({ launchStats: stats, launchStatsLoading: false, launchStatsError: '' })
        return stats
      } catch (err) {
        if (loadSeq !== this._launchStatsLoadSeq) return null
        let msg = (err && (err.message || err.errMsg)) ? (err.message || err.errMsg) : '统计加载失败'
        if (msg.includes('统计数据不存在')) msg = '统计生成中，请稍后刷新'
        this.setData({ launchStats: {}, launchStatsLoading: false, launchStatsError: msg })
        return null
      }
      }
    })
  },

  async goGlobalLaunchStats() {
    // 专属 id 不在 PRODUCTS 单品表内 → 门控弹窗只提供开通星际通行证，无永久购买
    const { gateCheck } = require('../../../utils/membership.js')
    const allowed = await gateCheck('global_launch_stats', '全球发射统计')
    if (!allowed) return
    navigateTo(ROUTES.GLOBAL_LAUNCH_STATS)
  },

  /**
   * 加载日历数据（渐进式：首次80+80，不够时追加）
   * @param {Boolean} useCache 是否优先使用本地缓存
   */
  async loadCalendarData(useCache) {
    if (this.data.calendarLoading) return

    if (useCache && this._calendarDataLoaded) {
      if ((this.data.calendarAllMissions || []).length > 0) {
        this.buildCalendarDays()
        return
      }
      if (this.hydrateCalendarFromLoadedMissionLists()) {
        return
      }
    }

    if (useCache) {
      // 经 storage-sync-cache 异步预热：读入内存后 morning-briefing 等消费方可直接命中内存
      storageCache.warmAsync('calendar_missions_cache', null).then((rawCached) => {
        try {
          const cached = getValidCalendarCache(rawCached)
          if (cached) {
            this.restoreCalendarCacheSnapshot(cached)
            return
          }
          if (rawCached && rawCached.ts && Array.isArray(rawCached.all) && rawCached.all.length === 0) {
            storageCache.invalidate('calendar_missions_cache')
            wx.removeStorage({ key: 'calendar_missions_cache', fail: () => {} })
          }
        } catch (e) {}
        this._continueLoadCalendarDataAfterCacheMiss()
      })
      return
    }

    this._continueLoadCalendarDataAfterCacheMiss()
  },

  _continueLoadCalendarDataAfterCacheMiss() {
    if (this.hydrateCalendarFromLoadedMissionLists()) {
      return
    }

    this.setData({ calendarLoading: true })
    this.fetchCalendarMissionBatch()
      .then((batch) => {
        this.applyCalendarBatchState(batch)
        this.applyCalendarMissionSnapshot(batch.allMissions)
      })
      .catch(() => {
        if (this.hydrateCalendarFromLoadedMissionLists()) {
          return
        }
        this.resetCalendarLoadFailureState()
      })
  },

  /**
   * 追加加载更多日历数据（当切换到的月份无数据时自动触发）
   */
  async _loadMoreCalendarData() {
    if (this.data.calendarLoading || this._calendarExpandLoading) return
    if (!this._calendarUpHasMore && !this._calendarCompHasMore) return

    this._calendarExpandLoading = true
    this.setData({ calendarLoading: true })
    try {
      const batch = await this.fetchCalendarMissionBatch({ appendMode: true })
      this.applyCalendarBatchState(batch)

      if (batch.appendedMissions.length > 0) {
        this._calendarExpandLoading = false
        this.applyCalendarMissionSnapshot(batch.allMissions)
        return
      }

      this.finishCalendarAppendWithoutChanges()
    } catch (e) {
      this.finishCalendarAppendWithoutChanges()
    }
  },

  /**
   * 保存日历缓存（含偏移量信息，便于恢复后继续追加）
   */
  _saveCalendarCache(allMissions, byDate) {
    try {
      const all = Array.isArray(allMissions) ? allMissions : []
      if (!all.length) {
        storageCache.invalidate('calendar_missions_cache')
        wx.removeStorage({ key: 'calendar_missions_cache', fail: () => {} })
        return
      }
      storageCache.persistAsync('calendar_missions_cache', {
        all,
        byDate: byDate || {},
        ts: Date.now(),
        upOffset: this._calendarUpOffset || 0,
        compOffset: this._calendarCompOffset || 0,
        upHasMore: this._calendarUpHasMore !== false,
        compHasMore: this._calendarCompHasMore !== false
      })
    } catch (e) {}
  },

  /**
   * 检查目标月份是否有数据覆盖
   */
  _isMonthCovered(year, month) {
    const byDate = this._calendarMissionsByDate || {}
    const prefix = `${year}-${String(month).padStart(2, '0')}-`
    return Object.keys(byDate).some(key => key.startsWith(prefix))
  },

  buildCalendarDayCells(calendarYear, calendarMonth, calendarMissionsByDate, expandedDateKey, todayKey) {
    const first = new Date(calendarYear, calendarMonth - 1, 1)
    const last = new Date(calendarYear, calendarMonth, 0)
    const startWeekday = first.getDay()
    const daysInMonth = last.getDate()
    const cells = []
    const monthMissions = []

    for (let i = 0; i < startWeekday; i++) {
      cells.push({ key: `empty-${i}`, day: '', empty: true, hasLaunch: false })
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const key = `${calendarYear}-${String(calendarMonth).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      const missions = calendarMissionsByDate[key] || []
      const hasUpcoming = missions.some(m => m._isUpcoming)
      const hasCompleted = missions.some(m => !m._isUpcoming)
      const missionCount = missions.length
      if (missionCount) monthMissions.push(...missions)

      let heat = 0
      if (missionCount === 1) heat = 1
      else if (missionCount === 2) heat = 2
      else if (missionCount >= 3) heat = 3

      const hasStarship = missions.some(m => {
        const meta = m._calendarQueryMeta || this.buildCalendarMissionQueryMeta(m)
        return meta.type === 'starship'
      })

      cells.push({
        key,
        day: d,
        empty: false,
        hasLaunch: missionCount > 0,
        hasUpcoming,
        hasCompleted,
        selected: expandedDateKey === key,
        isToday: key === todayKey,
        heat,
        hasStarship,
        missionCount
      })
    }

    const remainder = (7 - (cells.length % 7)) % 7
    for (let i = 0; i < remainder; i++) {
      cells.push({ key: `tail-${i}`, day: '', empty: true, hasLaunch: false })
    }

    return {
      cells,
      monthMissions
    }
  },

  /**
   * 已加载日历数据的时间边界（基于 launchTime 本地时间，与 byDate 分桶口径一致）
   * 返回 { min, max } 毫秒时间戳；无可用数据时为 { min: null, max: null }
   */
  _getCalendarLoadedTimeBounds() {
    const missions = this.data.calendarAllMissions || []
    let min = null
    let max = null
    for (let i = 0; i < missions.length; i++) {
      const m = missions[i]
      const raw = m && (m.launchTime || m.net || m.window_start)
      if (!raw) continue
      const t = (raw instanceof Date ? raw : new Date(raw)).getTime()
      if (!Number.isFinite(t)) continue
      if (min === null || t < min) min = t
      if (max === null || t > max) max = t
    }
    return { min, max }
  },

  /**
   * 目标月是否「落在已加载时间边界附近、可能尚未拉全」：
   *  - 月份触达/越过未来边界(max) 且仍有更多未来数据(upHasMore) → 可能漏算
   *  - 月份触达/越过历史边界(min) 且仍有更多历史数据(compHasMore) → 可能漏算
   */
  _isCalendarMonthMaybeIncomplete(year, month) {
    const { min, max } = this._getCalendarLoadedTimeBounds()
    if (min === null || max === null) return true
    const monthStart = new Date(year, month - 1, 1).getTime()
    const monthEnd = new Date(year, month, 0, 23, 59, 59, 999).getTime()
    if (monthEnd >= max && this._calendarUpHasMore) return true
    if (monthStart <= min && this._calendarCompHasMore) return true
    return false
  },

  shouldAutoLoadMoreCalendarMonth(total) {
    if (this.data.calendarQuickFilter !== 'all' ||
      this.data.calendarSiteFilter !== 'all' ||
      this.data.calendarStatusFilter !== 'all') return false
    if (!this._calendarDataLoaded || this._calendarExpandLoading) return false
    if (!this._calendarUpHasMore && !this._calendarCompHasMore) return false

    // 整月空 → 补数；部分覆盖但落在已加载边界（可能未拉全）→ 也补数
    const needMore = total === 0 ||
      this._isCalendarMonthMaybeIncomplete(this.data.calendarYear, this.data.calendarMonth)
    if (!needMore) return false

    // 最大补数次数保护：按当前月计数，翻月自动重置；hasMore 终止由上面两个判断保证
    const monthKey = `${this.data.calendarYear}-${this.data.calendarMonth}`
    if (this._calendarAutoLoadMonthKey !== monthKey) {
      this._calendarAutoLoadMonthKey = monthKey
      this._calendarAutoLoadCount = 0
    }
    if ((this._calendarAutoLoadCount || 0) >= CALENDAR_AUTO_LOAD_MAX) return false
    this._calendarAutoLoadCount = (this._calendarAutoLoadCount || 0) + 1
    return true
  },

  buildCalendarDays() {
    const { calendarYear, calendarMonth, expandedDateKey } = this.data
    const calendarMissionsByDate = this._calendarMissionsByDate || {}
    const todayKey = this._getTodayKey()
    const now = new Date()
    const isCurrentMonth = calendarYear === now.getFullYear() && calendarMonth === now.getMonth() + 1
    const dayState = this.buildCalendarDayCells(calendarYear, calendarMonth, calendarMissionsByDate, expandedDateKey, todayKey)

    let expandedTitle = ''
    if (expandedDateKey) {
      const parts = expandedDateKey.split('-')
      if (parts.length === 3) expandedTitle = `${parseInt(parts[1])}月${parseInt(parts[2])}日`
    }

    const monthMissionCount = dayState.monthMissions.length
    this.setData({
      calendarDays: dayState.cells,
      calendarTodayKey: todayKey,
      calendarIsCurrentMonth: isCurrentMonth,
      expandedDateTitle: expandedTitle,
      expandedDateMissions: expandedDateKey ? (calendarMissionsByDate[expandedDateKey] || []) : [],
      calendarMapEntryList: expandedDateKey ? this.buildMapEntryList(calendarMissionsByDate[expandedDateKey] || []) : []
    })

    if (this.shouldAutoLoadMoreCalendarMonth(monthMissionCount)) {
      this._loadMoreCalendarData()
    }
  },

  switchCalendarMonth(nextYear, nextMonth, direction = 'forward') {
    if (this._calendarMonthAnimating) return
    this._calendarMonthAnimating = true
    const enterClass = direction === 'backward' ? 'calendar-page-anim--enter-prev' : 'calendar-page-anim--enter-next'
    this.setData({
      calendarPageAnimClass: direction === 'backward' ? 'calendar-page-anim--leave-next' : 'calendar-page-anim--leave-prev'
    })
    setTimeout(() => {
      this.setData({
        calendarYear: nextYear,
        calendarMonth: nextMonth,
        expandedDateKey: '',
        expandedDateTitle: '',
        expandedDateMissions: [],
        calendarPageAnimClass: enterClass
      }, () => {
        this.buildCalendarDays()
        setTimeout(() => {
          this.setData({ calendarPageAnimClass: '' })
          this._calendarMonthAnimating = false
        }, 220)
      })
    }, 110)
  },

  calendarPrevMonth() {
    this._vibrateLight()
    let y = this.data.calendarYear
    let m = this.data.calendarMonth - 1
    if (m < 1) { m = 12; y-- }
    this.switchCalendarMonth(y, m, 'backward')
  },

  calendarNextMonth() {
    this._vibrateLight()
    let y = this.data.calendarYear
    let m = this.data.calendarMonth + 1
    if (m > 12) { m = 1; y++ }
    this.switchCalendarMonth(y, m, 'forward')
  },

  calendarGoToday() {
    this._vibrateLight()
    const now = new Date()
    const direction = (now.getFullYear() < this.data.calendarYear ||
      (now.getFullYear() === this.data.calendarYear && now.getMonth() + 1 < this.data.calendarMonth))
      ? 'backward'
      : 'forward'
    this.switchCalendarMonth(now.getFullYear(), now.getMonth() + 1, direction)
  },

  onCalendarMonthTitleTap() {
    this._vibrateLight()
  },

  onCalendarMonthPickerChange(e) {
    const val = e.detail.value
    if (!val) return
    const parts = val.split('-')
    const y = parseInt(parts[0])
    const m = parseInt(parts[1])
    if (y && m) {
      this._vibrateLight()
      const direction = (y < this.data.calendarYear || (y === this.data.calendarYear && m < this.data.calendarMonth))
        ? 'backward'
        : 'forward'
      this.switchCalendarMonth(y, m, direction)
    }
  },

  onCalendarDateTap(e) {
    // launch-calendar 组件事件走 e.detail；保留 dataset 兼容旧绑定
    const key = (e.detail && e.detail.key) || (e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.key)
    if (!key || key.startsWith('empty') || key.startsWith('tail')) return
    this._vibrateLight()
    const missions = (this._calendarMissionsByDate || {})[key] || []
    if (missions.length === 0) {
      const parts = key.split('-')
      const label = parts.length === 3 ? `${parseInt(parts[1])}月${parseInt(parts[2])}日` : key
      wx.showToast({ title: `${label} 暂无发射`, icon: 'none', duration: 1500 })
      return
    }
    const newKey = this.data.expandedDateKey === key ? '' : key
    const newMissions = newKey ? missions : []
    this.setData({
      expandedDateKey: newKey,
      expandedDateMissions: newMissions,
      calendarMapEntryList: newKey ? this.buildMapEntryList(newMissions) : []
    }, () => this.buildCalendarDays())
  },

  toggleCalendarFilterPanel() {
    this._vibrateLight()
    this.setData({ calendarFilterCollapsed: !this.data.calendarFilterCollapsed })
  },

  applyCalendarFilterState(updateData = {}) {
    this.setData({
      ...updateData,
      expandedDateKey: '',
      expandedDateTitle: '',
      expandedDateMissions: [],
      calendarMapEntryList: []
    })
    this.updateCalendarDerivedState({ keepExpanded: false }, () => {
      this.buildCalendarDays()
    })
  },

  onCalendarQuickFilterTap(e) {
    const value = (e.detail && e.detail.value) || (e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.value) || 'all'
    if (value === this.data.calendarQuickFilter) return
    this.applyCalendarFilterState({ calendarQuickFilter: value })
  },

  onCalendarSiteFilterTap(e) {
    const value = (e.detail && e.detail.value) || (e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.value) || 'all'
    if (value === this.data.calendarSiteFilter) return
    this.applyCalendarFilterState({ calendarSiteFilter: value })
  },

  onCalendarStatusFilterTap(e) {
    const value = (e.detail && e.detail.value) || (e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.value) || 'all'
    if (value === this.data.calendarStatusFilter) return
    this.applyCalendarFilterState({ calendarStatusFilter: value })
  },

  resetCalendarFilters() {
    this.applyCalendarFilterState({
      calendarQuickFilter: 'all',
      calendarSiteFilter: 'all',
      calendarStatusFilter: 'all'
    })
  },

  buildMapEntryList(missions) {
    const entryMap = {}
    ;(missions || []).forEach((mission) => {
      const meta = mission && mission._mapLinkMeta
      const entries = meta && meta.entries ? meta.entries : []
      entries.forEach((item) => {
        const uniqueKey = `${item.key}-${item.query || ''}`
        if (!entryMap[uniqueKey]) {
          entryMap[uniqueKey] = {
            ...item,
            count: 1
          }
        } else {
          entryMap[uniqueKey].count += 1
        }
      })
    })
    return Object.keys(entryMap).map((key) => entryMap[key])
  },

  openCalendarMapLink(e) {
    const path = e.currentTarget.dataset.path
    const query = e.currentTarget.dataset.query || ''
    if (!path) return
    const url = query ? `${path}?${query}` : path
    wx.navigateTo({ url })
  },

  // 左右滑动翻月的手势检测已移入 launch-calendar 组件内部，
  // 组件仅回传 prevmonth / nextmonth 事件（switchCalendarMonth 自带动画期间防抖）

  _patchCalendarMissionRocketImage(missionId, nextImage) {
    const allMissions = this.data.calendarAllMissions || []
    const idx = allMissions.findIndex((m) => m && String(m.id) === String(missionId))
    if (idx < 0) return false

    const nextAll = allMissions.slice()
    nextAll[idx] = { ...nextAll[idx], rocketImage: nextImage, image: nextImage }
    const expandedMissions = (this.data.expandedDateMissions || []).map((m) =>
      m && String(m.id) === String(missionId) ? { ...m, rocketImage: nextImage, image: nextImage } : m
    )
    this.setData({
      calendarAllMissions: nextAll,
      expandedDateMissions: expandedMissions
    })
    return true
  },
}

function attachTo(page) {
  if (page.__calendarAttached) return calendarMethods
  Object.keys(calendarMethods).forEach((key) => {
    page[key] = calendarMethods[key]
  })
  page.__calendarAttached = true
  return calendarMethods
}

module.exports = {
  attachTo,
  computeLaunchCalendarSignature,
  LAUNCH_CALENDAR_ACK_SIG_KEY
}
