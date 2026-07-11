const { getUpcomingMissions, getCompletedMissions } = require('../../utils/api-launch-list.js')
const { getAgencies } = require('../../utils/api-monitor-data.js')
const { ROUTES, navigateTo } = require('../../utils/routes.js')
const {
  filterExpiredMissions,
  DEFAULT_ROCKET_IMAGE,
  setMissionDetailCacheEntry
} = require('../../utils/index-page-helpers.js')
const { formatDate } = require('../../utils/util.js')
const {
  fetchMissionListData,
  buildMissionListSetData,
  getMissionNextOffset,
  mergeMissionPages
} = require('../../utils/index-mission-services.js')
const { analyzeSearchQuery, getDefaultSearchSuggestions } = require('./aiSearch.js')
const {
  loadSearchHistory,
  persistSearchHistory,
  updateSearchHistoryList,
  buildSearchInitializeState,
  buildEmptySearchResultState,
  buildSearchLoadingState,
  buildSearchAppliedState,
  buildSearchErrorState,
  buildSearchCacheKey,
  upsertSearchCache,
  getSearchDisplaySummary
} = require('./index-search-state.js')
const { buildSearchResults: buildMissionSearchResults, buildSearchPrefetchPlan } = require('./index-search-engine.js')
const {
  resolveMissionDetailSourceData,
  buildMissionDetailNavigation,
  collectMissionShareCandidates,
  buildMissionShareOptions
} = require('../../utils/index-mission-nav.js')
const { answerQuestion } = require('../../utils/aiService.js')
const { loadCloudMediaMap, resolveMediaUrl } = require('../../utils/image-config.js')
const { buildMissionReadyState, buildMissionCardHapticState } = require('../../utils/index-mission-state.js')
const pageBase = require('../../utils/page-base.js')
const storageCache = require('../../utils/storage-sync-cache.js')
const { isProSync } = require('../../utils/membership.js')

const SEARCH_HISTORY_KEY = 'index_search_history_v2'
const SEARCH_HISTORY_LIMIT = 8
const SEARCH_PREFETCH_TARGET_LIMIT = 60
const SEARCH_PREFETCH_BATCH_SIZE = 20
const SEARCH_PREFETCH_MIN_QUERY_LENGTH = 2

Page({
  behaviors: [pageBase],
  _fallbackTab: '/pages/index/index',
  data: {
    isProUser: false,
    missionType: 'upcoming',
    upcomingMissions: [],
    completedMissions: [],
    missionsOffset: 0,
    completedMissionsOffset: 0,
    missionsHasMore: true,
    completedMissionsHasMore: true,
    searchKeyword: '',
    searchResults: [],
    searchGroupedResults: [],
    searchLoading: false,
    searchTimer: null,
    searchSuggestions: [],
    searchHistory: [],
    searchSummary: '',
    searchResultCountText: '',
    searchSuggestedKeyword: '',
    searchEmptyHint: '',
    searchContextLabel: '',
    searchScrollTop: 0,
    searchInputFocus: false,
    navTitle: '智能搜索',
    statusBarHeight: 44,
    navPlaceholderHeight: 0,
    menuButtonWidth: 88,
    /** 与首页开屏一致，用于朋友圈分享配图（避免误用火箭配置图） */
    splashShareImageUrl: '',
    /** AI 智能回答 */
    aiAnswerLoading: false,
    aiAnswer: '',
    aiAnswerError: ''
  },

  onLoad(options) {
    this._pendingQuery = (options && (options.q || options.keyword)) ? String(options.q || options.keyword).trim() : ''

    this.initUiShell()

    this.setData({ isProUser: isProSync() })

    void loadCloudMediaMap().catch(() => {})
    void this.loadSplashShareImageForTimeline()

    const searchHistory = loadSearchHistory(SEARCH_HISTORY_KEY, SEARCH_HISTORY_LIMIT)
    this._searchResultCache = Object.create(null)
    this._searchResultCacheOrder = []
    this.setData({
      ...buildSearchInitializeState({
        searchHistory,
        defaultSuggestions: getDefaultSearchSuggestions()
      }),
      navTitle: '智能搜索'
    })
    this._resetSearchCardHaptics()

    Promise.all([
      this.ensureMissionListsReady(['upcoming', 'completed']),
      this._preloadAgenciesForSearch()
    ]).finally(() => {
      const q = this._pendingQuery
      this._pendingQuery = ''
      if (q) {
        this.setData({ searchKeyword: q })
        this.doSearch(q)
      } else {
        this._triggerSearchInputFocus(120)
      }
    })
  },

  // goBack inherited from pageBase,

  onUnload() {
    this._clearSearchTimers()
  },

  onShow() {
    this.setData({ isProUser: isProSync() })
  },

  onHide() {
    this._clearSearchTimers()
  },

  _clearSearchTimers() {
    if (this.data.searchTimer) {
      clearTimeout(this.data.searchTimer)
    }
    if (this._searchInputFocusTimer) {
      clearTimeout(this._searchInputFocusTimer)
      this._searchInputFocusTimer = null
    }
    if (this._searchCardMeasureTimer) {
      clearTimeout(this._searchCardMeasureTimer)
      this._searchCardMeasureTimer = null
    }
    this._clearSearchScrollSyncTimer()
  },

  updateSearchHistory(keyword) {
    const history = updateSearchHistoryList(keyword, this.data.searchHistory, SEARCH_HISTORY_LIMIT)
    this.setData({ searchHistory: history })
    persistSearchHistory(SEARCH_HISTORY_KEY, history, SEARCH_HISTORY_LIMIT)
  },

  clearSearchHistory() {
    this.setData({
      searchHistory: [],
      searchSummary: '试试搜索火箭、任务、机构或发射场'
    })
    persistSearchHistory(SEARCH_HISTORY_KEY, [], SEARCH_HISTORY_LIMIT)
  },

  clearSearchKeyword() {
    this.setData({
      searchKeyword: '',
      searchResults: [],
      searchGroupedResults: [],
      searchSummary: '',
      searchResultCountText: '',
      searchContextLabel: '',
      aiAnswer: '',
      aiAnswerError: '',
      aiAnswerLoading: false
    })
  },

  buildSearchSourcePrefetchState(plans = []) {
    const safePlans = Array.isArray(plans) ? plans : []
    const nextState = {}

    return Promise.all(safePlans.map((plan) => {
      return this.fetchMissionList(plan.type, plan.limit, plan.offset).then(({ res, list }) => {
        const currentList = this.getMissionListByType(plan.type)
        const merged = mergeMissionPages(plan.type, currentList, list, filterExpiredMissions)

        if (plan.type === 'completed') {
          nextState.completedMissions = merged
          nextState.completedMissionsOffset = getMissionNextOffset(res, this.data.completedMissionsOffset)
          nextState.completedMissionsHasMore = !!res.hasMore
        } else {
          nextState.upcomingMissions = merged
          nextState.missionsOffset = getMissionNextOffset(res, this.data.missionsOffset)
          nextState.missionsHasMore = !!res.hasMore
        }
      }).catch(() => {})
    })).then(() => nextState)
  },

  async ensureSearchSourceReady(queryInfo) {
    await this.ensureMissionListsReady(['upcoming', 'completed'])

    const plans = buildSearchPrefetchPlan(queryInfo, this.data, {
      targetLimit: SEARCH_PREFETCH_TARGET_LIMIT,
      batchSize: SEARCH_PREFETCH_BATCH_SIZE,
      minQueryLength: SEARCH_PREFETCH_MIN_QUERY_LENGTH
    })

    if (!plans.length) {
      return
    }

    const nextState = await this.buildSearchSourcePrefetchState(plans)
    if (Object.keys(nextState).length) {
      this.setData(nextState)
    }
  },

  getMissionListByType(type) {
    return type === 'completed' ? (this.data.completedMissions || []) : (this.data.upcomingMissions || [])
  },

  resolveMissingMissionTypes(types = []) {
    const queue = Array.isArray(types) ? types : [types]
    const normalizedTypes = queue
      .map((type) => (type === 'completed' ? 'completed' : (type === 'upcoming' ? 'upcoming' : '')))
      .filter(Boolean)
    const uniqueTypes = normalizedTypes.filter((type, index) => normalizedTypes.indexOf(type) === index)

    return uniqueTypes.filter((type) => {
      const list = this.getMissionListByType(type)
      return !Array.isArray(list) || list.length === 0
    })
  },

  buildMissionListReadyState(results = [], missingTypes = []) {
    const safeResults = Array.isArray(results) ? results : []
    const safeMissingTypes = Array.isArray(missingTypes) ? missingTypes : []
    const updateData = buildMissionReadyState()

    safeResults.forEach((result, index) => {
      const type = safeMissingTypes[index]
      Object.assign(updateData, buildMissionListSetData(type, result.list, result.res, filterExpiredMissions))
    })

    return updateData
  },

  async ensureMissionListsReady(types = []) {
    await loadCloudMediaMap().catch(() => {})

    const missingTypes = this.resolveMissingMissionTypes(types)
    if (!missingTypes.length) {
      this.setData(buildMissionReadyState())
      return
    }

    const results = await Promise.all(missingTypes.map((type) => this.fetchMissionList(type, 50, 0)))
    const updateData = this.buildMissionListReadyState(results, missingTypes)
    this.setData(buildMissionReadyState(updateData))
  },

  async fetchMissionList(type, limit = 50, offset = 0) {
    return fetchMissionListData({
      type,
      limit,
      offset,
      getUpcomingMissions,
      getCompletedMissions,
      formatDate,
      filterExpiredMissions
    })
  },

  getMissionDetailCacheStore() {
    try {
      const stored = storageCache.readMemOrSync('mission_detail_cache', {})
      if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
        return { ...stored }
      }
    } catch (err) {}
    return {}
  },

  setMissionDetailCacheStore(cache) {
    try {
      // 共享内存层立即生效；磁盘写异步（详情页同进程读内存层）
      storageCache.persistAsync('mission_detail_cache', cache && typeof cache === 'object' && !Array.isArray(cache) ? cache : {})
    } catch (err) {}
  },

  updateMissionDetailCacheEntries(entries = [], options = {}) {
    const safeEntries = Array.isArray(entries) ? entries : []
    let cache = options && options.cache && typeof options.cache === 'object' && !Array.isArray(options.cache)
      ? { ...options.cache }
      : this.getMissionDetailCacheStore()

    safeEntries.forEach((entry) => {
      const safeEntry = entry && typeof entry === 'object' ? entry : null
      if (!safeEntry || safeEntry.id == null || !safeEntry.mission) return
      cache = setMissionDetailCacheEntry(cache, safeEntry.id, safeEntry.detailType, safeEntry.mission, {
        source: safeEntry.source,
        cachedAt: safeEntry.cachedAt
      })
    })

    if (safeEntries.length > 0 && options.persist !== false) {
      this.setMissionDetailCacheStore(cache)
    }

    return cache
  },

  buildMissionDetailViewContext(dataset = {}) {
    const safeDataset = dataset && typeof dataset === 'object' ? dataset : {}
    const id = safeDataset.id
    if (!id) return null

    const missionType = this.data.missionType || 'upcoming'
    const state = {
      missionType,
      upcomingMissions: this.data.upcomingMissions,
      completedMissions: this.data.completedMissions,
      calendarAllMissions: []
    }

    const resolved = resolveMissionDetailSourceData(state, safeDataset.type, id)
    const navigation = buildMissionDetailNavigation({
      id: resolved.id,
      detailType: resolved.detailType,
      fromSearch: safeDataset.source === 'search'
    })
    const mission = collectMissionShareCandidates(state).find((item) => String(item && item.id) === String(resolved.id)) || null

    return {
      resolved,
      navigation,
      mission
    }
  },

  persistMissionDetailListSnapshot(context) {
    const safeContext = context && typeof context === 'object' ? context : {}
    const resolved = safeContext.resolved || {}
    const mission = safeContext.mission
    if (!resolved.id || !mission) return

    this.updateMissionDetailCacheEntries([{
      id: resolved.id,
      detailType: resolved.detailType,
      mission,
      source: 'list'
    }])
  },

  viewMissionDetail(e) {
    const dataset = e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset : {}
    const context = this.buildMissionDetailViewContext(dataset)
    if (!context) return

    this.persistMissionDetailListSnapshot(context)

    wx.navigateTo({
      url: context.navigation.url
    })
  },

  applySearchResults(keyword, queryInfo, resultsPayload) {
    this._resetSearchCardHaptics()
    const nextState = buildSearchAppliedState({
      keyword,
      queryInfo,
      resultsPayload,
      defaultSuggestions: getDefaultSearchSuggestions(),
      summaryText: getSearchDisplaySummary(queryInfo, this.data.searchHistory)
    })

    this.setData(nextState, () => {
      if (nextState.searchGroupedResults && nextState.searchGroupedResults.length) {
        this._scheduleSearchCardMeasurement(true, 0)
      }
    })
  },

  resolveSearchExecutionContext(keywordOverride) {
    const isEventObject = keywordOverride && typeof keywordOverride === 'object' && keywordOverride.currentTarget
    const rawKeyword = isEventObject ? this.data.searchKeyword : (keywordOverride != null ? keywordOverride : this.data.searchKeyword || '')
    const keyword = String(rawKeyword || '').trim()
    const queryInfo = analyzeSearchQuery(keyword)
    const summaryText = getSearchDisplaySummary(queryInfo, this.data.searchHistory)
    const cacheKey = buildSearchCacheKey(queryInfo, this.data)

    return {
      keyword,
      queryInfo,
      summaryText,
      cacheKey
    }
  },

  ensureSearchCacheStore() {
    if (!this._searchResultCache) {
      this._searchResultCache = Object.create(null)
    }
    if (!Array.isArray(this._searchResultCacheOrder)) {
      this._searchResultCacheOrder = []
    }
  },

  getSearchCachedResult(cacheKey) {
    if (!cacheKey || !this._searchResultCache) return null
    return this._searchResultCache[cacheKey] || null
  },

  applySearchCacheHit(keyword, queryInfo, cacheKey) {
    const cached = this.getSearchCachedResult(cacheKey)
    if (!cached) return false
    this.applySearchResults(keyword, queryInfo, cached)
    this.updateSearchHistory(keyword)
    return true
  },

  cacheSearchResults(cacheKey, results) {
    if (!cacheKey) return
    this.ensureSearchCacheStore()
    const cacheState = upsertSearchCache(this._searchResultCache, this._searchResultCacheOrder, cacheKey, results)
    this._searchResultCache = cacheState.cacheStore
    this._searchResultCacheOrder = cacheState.cacheOrder
  },

  handleEmptySearchKeyword() {
    this._resetSearchCardHaptics()
    this.setData({
      aiAnswer: '',
      aiAnswerLoading: false,
      aiAnswerError: '',
      ...buildEmptySearchResultState({
        searchHistory: this.data.searchHistory,
        defaultSuggestions: getDefaultSearchSuggestions(),
        extraState: {
          searchInputFocus: true
        }
      })
    })
  },

  handleSearchExecutionError() {
    this._resetSearchCardHaptics()
    this.setData(buildSearchErrorState({
      defaultSuggestions: getDefaultSearchSuggestions()
    }))
  },

  useSearchSuggestion(e) {
    const keyword = e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.keyword : ''
    if (!keyword) return
    this.setData({
      searchKeyword: keyword,
      searchSuggestedKeyword: ''
    })
    this.doSearch(keyword)
  },

  onSearchInput(e) {
    const keyword = e.detail.value
    const queryInfo = analyzeSearchQuery(keyword)
    this.setData({
      searchKeyword: keyword,
      searchSummary: getSearchDisplaySummary(queryInfo, this.data.searchHistory),
      searchSuggestions: queryInfo.suggestions && queryInfo.suggestions.length ? queryInfo.suggestions : getDefaultSearchSuggestions(),
      searchSuggestedKeyword: ''
    })

    if (this.data.searchTimer) {
      clearTimeout(this.data.searchTimer)
    }

    if (!keyword || !keyword.trim()) {
      this._resetSearchCardHaptics()
      this.setData({
        searchTimer: null,
        aiAnswer: '',
        aiAnswerLoading: false,
        aiAnswerError: '',
        ...buildEmptySearchResultState({
          searchHistory: this.data.searchHistory,
          defaultSuggestions: getDefaultSearchSuggestions(),
          extraState: {
            searchInputFocus: true
          }
        })
      })
      return
    }

    const timer = setTimeout(() => {
      this.doSearch(keyword)
    }, 500)

    this.setData({ searchTimer: timer })
  },

  async doSearch(keywordOverride) {
    const searchContext = this.resolveSearchExecutionContext(keywordOverride)
    const kw = searchContext.keyword

    if (!kw) {
      this.handleEmptySearchKeyword()
      return
    }

    // 重置 AI 回答 + 搜索状态
    this.setData({
      aiAnswer: '',
      aiAnswerLoading: true,
      aiAnswerError: '',
      ...buildSearchLoadingState({
        keyword: kw,
        queryInfo: searchContext.queryInfo,
        defaultSuggestions: getDefaultSearchSuggestions(),
        summaryText: searchContext.summaryText
      })
    })

    // ★ 每次搜索都并行：AI 回答 + 本地卡片匹配
    this._fetchAIAnswer(kw, searchContext.queryInfo)

    try {
      if (this.applySearchCacheHit(kw, searchContext.queryInfo, searchContext.cacheKey)) {
        this.updateSearchHistory(kw)
        return
      }

      await this.ensureSearchSourceReady(searchContext.queryInfo)
      const refreshedCacheKey = buildSearchCacheKey(searchContext.queryInfo, this.data)
      if (this.applySearchCacheHit(kw, searchContext.queryInfo, refreshedCacheKey)) {
        this.updateSearchHistory(kw)
        return
      }

      const results = buildMissionSearchResults({
        queryInfo: searchContext.queryInfo,
        upcomingMissions: this.data.upcomingMissions,
        completedMissions: this.data.completedMissions,
        agencies: this._agenciesForSearch || []
      })
      this.cacheSearchResults(refreshedCacheKey || searchContext.cacheKey, results)
      this.applySearchResults(kw, searchContext.queryInfo, results)
      this.updateSearchHistory(kw)
    } catch (error) {
      this.handleSearchExecutionError()
    }
  },

  /**
   * AI 智能回答 — 每次搜索都调用混元大模型
   * 与本地卡片搜索并行执行，不阻塞
   */
  async _fetchAIAnswer(question, queryInfo) {
    // 收集任务数据作为 AI 上下文
    let contextData = null
    const allMissions = [].concat(this.data.upcomingMissions || [], this.data.completedMissions || [])
    if (allMissions.length > 0) {
      const topMissions = allMissions.slice(0, 8)
      const missionSummary = topMissions.map(m => {
        const parts = []
        if (m.name || m.missionName) parts.push(m.name || m.missionName)
        if (m.rocketName) parts.push('火箭: ' + m.rocketName)
        if (m.launchAgency) parts.push('机构: ' + m.launchAgency)
        if (m.formattedTime) parts.push('时间: ' + m.formattedTime)
        return parts.join(' | ')
      }).join('\n')
      if (missionSummary) {
        contextData = { _extraContext: missionSummary }
      }
    }

    try {
      const answer = await answerQuestion(question, contextData)
      // 只在当前搜索词未变时更新（防止旧请求覆盖新结果）
      if (this.data.searchKeyword === question || this.data.searchKeyword.trim() === question.trim()) {
        this.setData({ aiAnswer: answer || '', aiAnswerLoading: false })
      }
    } catch (e) {
      console.warn('[Search] AI 回答失败:', e.message || e)
      if (this.data.searchKeyword === question || this.data.searchKeyword.trim() === question.trim()) {
        this.setData({
          aiAnswerLoading: false,
          aiAnswer: '',
          aiAnswerError: e.type === 'auth_error' ? 'AI 服务未配置' : ''
        })
      }
    }
  },

  onSearchItemTap(e) {
    const id = e.currentTarget.dataset.id
    const type = e.currentTarget.dataset.type

    if (type === 'agency') {
      // switchTab 不能带 query：用 globalData 内存交接，避免 storage 读写
      try {
        const app = getApp()
        if (app && app.globalData) app.globalData.pendingAgencyDetailId = id
      } catch (err) {}
      wx.switchTab({ url: '/pages/monitor/monitor' })
      return
    }

    this.setData({ missionType: type })
    wx.nextTick(() => {
      const missions = type === 'upcoming' ? this.data.upcomingMissions : this.data.completedMissions
      const mission = missions.find(m => m.id === id)
      if (mission) {
        this.viewMissionDetail({ currentTarget: { dataset: { id, type, source: 'search' } } })
      }
    })
  },

  onSearchResultsScroll(e) {
    const scrollTop = e && e.detail ? (e.detail.scrollTop || 0) : 0
    this._latestSearchScrollTop = scrollTop
    this._handleSearchCardScrollHaptics(scrollTop)

    this._clearSearchScrollSyncTimer()
    this._searchScrollSyncTimer = setTimeout(() => {
      this._searchScrollSyncTimer = null
      if (Math.abs((this.data.searchScrollTop || 0) - scrollTop) > 8) {
        this.setData({ searchScrollTop: scrollTop })
      }
    }, 120)
  },

  onSearchInputFocus() {
    if (!this.data.searchInputFocus) {
      this.setData({ searchInputFocus: true })
    }
  },

  onSearchInputBlur() {
    if (this.data.searchInputFocus) {
      this.setData({ searchInputFocus: false })
    }
  },

  stopPropagation() {},

  _vibrateMedium() {
    try {
      wx.vibrateShort({ type: 'medium' })
    } catch (e) {
      try { wx.vibrateShort() } catch (err) {}
    }
  },

  _clearSearchCardMeasureTimer() {
    if (this._searchCardMeasureTimer) {
      clearTimeout(this._searchCardMeasureTimer)
      this._searchCardMeasureTimer = null
    }
  },

  _clearSearchScrollSyncTimer() {
    if (this._searchScrollSyncTimer) {
      clearTimeout(this._searchScrollSyncTimer)
      this._searchScrollSyncTimer = null
    }
  },

  _resetSearchCardHaptics() {
    this._clearSearchCardMeasureTimer()
    this._searchCardMetrics = null
    this._searchCardActiveIndex = -1
    this._lastSearchCardVibrateAt = 0
    this._latestSearchScrollTop = 0
    this._searchCardNeedsFreshMeasure = true
  },

  _triggerSearchInputFocus(delay = 30) {
    if (this._searchInputFocusTimer) {
      clearTimeout(this._searchInputFocusTimer)
      this._searchInputFocusTimer = null
    }

    this.setData({ searchInputFocus: false }, () => {
      this._searchInputFocusTimer = setTimeout(() => {
        this._searchInputFocusTimer = null
        this.setData({ searchInputFocus: true })
      }, delay)
    })
  },

  _getSearchCardFocusIndex(scrollTop) {
    const metrics = this._searchCardMetrics
    if (!metrics || !Array.isArray(metrics.centers) || !metrics.centers.length) return -1

    const anchor = (typeof scrollTop === 'number' ? scrollTop : (this._latestSearchScrollTop || 0)) + ((metrics.viewportHeight || 0) * 0.32)
    let bestIndex = -1
    let bestDistance = Infinity

    metrics.centers.forEach((center, index) => {
      const distance = Math.abs(center - anchor)
      if (distance < bestDistance) {
        bestDistance = distance
        bestIndex = index
      }
    })

    return bestIndex
  },

  _syncSearchCardHapticIndex(scrollTop) {
    const focusIndex = this._getSearchCardFocusIndex(typeof scrollTop === 'number' ? scrollTop : this._latestSearchScrollTop)
    this._searchCardActiveIndex = focusIndex
    this._searchCardNeedsFreshMeasure = false
  },

  _applyScrollCardHapticState(options = {}) {
    const hapticState = buildMissionCardHapticState({
      focusIndex: options.focusIndex,
      activeIndex: options.activeIndex,
      lastVibrateAt: options.lastVibrateAt,
      now: Date.now(),
      vibrateIntervalMs: 120
    })
    if (hapticState.shouldSyncActiveIndex && typeof options.setActiveIndex === 'function') {
      options.setActiveIndex(hapticState.nextActiveIndex)
    }
    if (hapticState.shouldVibrate && typeof options.setLastVibrateAt === 'function') {
      options.setLastVibrateAt(hapticState.nextLastVibrateAt)
      this._vibrateMedium()
    }
    return hapticState
  },

  _handleSearchCardScrollHaptics(scrollTop) {
    this._latestSearchScrollTop = scrollTop
    if (this.data.searchLoading) return
    if (!this.data.searchGroupedResults || !this.data.searchGroupedResults.length) return

    if (!this._searchCardMetrics || this._searchCardNeedsFreshMeasure) {
      this._scheduleSearchCardMeasurement(true, scrollTop)
      return
    }

    const focusIndex = this._getSearchCardFocusIndex(scrollTop)
    if (focusIndex < 0) return

    this._applyScrollCardHapticState({
      focusIndex,
      activeIndex: this._searchCardActiveIndex,
      lastVibrateAt: this._lastSearchCardVibrateAt,
      setActiveIndex: (nextIndex) => {
        this._searchCardActiveIndex = nextIndex
      },
      setLastVibrateAt: (nextTime) => {
        this._lastSearchCardVibrateAt = nextTime
      }
    })
  },

  _scheduleSearchCardMeasurement(syncActiveCard = false, scrollTopOverride) {
    this._clearSearchCardMeasureTimer()
    const measureDelay = typeof scrollTopOverride === 'number' ? 16 : 0

    this._searchCardMeasureTimer = setTimeout(() => {
      wx.nextTick(() => {
        const query = wx.createSelectorQuery().in(this)
        query.select('.search-results').boundingClientRect()
        query.selectAll('.search-group .search-result-item').boundingClientRect()
        query.exec((res) => {
          this._searchCardMeasureTimer = null
          const scrollViewRect = res && res[0]
          const cardRects = (res && res[1]) || []
          if (!scrollViewRect || !cardRects.length) {
            this._searchCardMetrics = null
            this._searchCardActiveIndex = -1
            return
          }

          const currentScrollTop = typeof scrollTopOverride === 'number' ? scrollTopOverride : (this._latestSearchScrollTop || 0)
          this._searchCardMetrics = {
            viewportHeight: scrollViewRect.height || 0,
            centers: cardRects.map((rect) => currentScrollTop + rect.top - scrollViewRect.top + ((rect.height || 0) / 2))
          }
          this._searchCardNeedsFreshMeasure = false

          if (syncActiveCard) {
            this._syncSearchCardHapticIndex(currentScrollTop)
          }
        })
      })
    }, measureDelay)
  },

  async _preloadAgenciesForSearch() {
    try {
      const data = await getAgencies({ featured: true, limit: 50, offset: 0 })
      const results = (data && data.results) || []
      this._agenciesForSearch = results.map(a => ({
        id: a.id,
        name: a.name || '',
        abbrev: a.abbrev || '',
        typeName: a.type ? a.type.name : '',
        countryName: a.country && a.country[0] ? a.country[0].name : '',
        countryFlag: this._agencyCountryFlag(a.country),
        description: a.description || '',
        launchers: a.launchers || '',
        spacecraft: a.spacecraft || '',
        logoUrl: a.logo ? (a.logo.thumbnail_url || a.logo.image_url) : '',
        imageUrl: a.image ? (a.image.thumbnail_url || a.image.image_url) : '',
        featured: !!a.featured
      }))
    } catch (e) {
      this._agenciesForSearch = []
    }
  },

  _agencyCountryFlag(countries) {
    if (!countries || !countries.length) return '🌍'
    const code = countries[0].alpha_2_code
    if (!code) return '🌍'
    try {
      return String.fromCodePoint(
        ...code.toUpperCase().split('').map(c => 0x1F1E6 + c.charCodeAt(0) - 65)
      )
    } catch (e) { return '🌍' }
  },

  _shareTimelineSearchQuery() {
    const q = String(this.data.searchKeyword || '').trim()
    return q ? ('q=' + encodeURIComponent(q)) : ''
  },

  /**
   * 拉取开屏配置中的图片 URL，与首页 starship_splash_config 一致，作朋友圈分享小图。
   * 仅图片开屏用 mediaUrl；视频开屏可配 shareImageUrl / posterUrl（若有）。
   */
  async loadSplashShareImageForTimeline() {
    try {
      if (!wx.cloud || !wx.cloud.database) return
      const db = wx.cloud.database()
      const res = await Promise.race([
        db.collection('starship_splash_config').doc('current').get(),
        new Promise((resolve) => setTimeout(() => resolve(null), 4000))
      ])
      const cfg = res && res.data
      if (!cfg || !cfg.enabled) return

      const shareExtra =
        (typeof cfg.shareImageUrl === 'string' && cfg.shareImageUrl.trim()) ||
        (typeof cfg.posterUrl === 'string' && cfg.posterUrl.trim()) ||
        ''
      const imageFromSplash =
        cfg.mediaType === 'image' && typeof cfg.mediaUrl === 'string' ? cfg.mediaUrl.trim() : ''

      const url = shareExtra || imageFromSplash
      if (url) {
        this.setData({ splashShareImageUrl: url })
      }
    } catch (e) {
      // 静默失败：不传 imageUrl 时由客户端使用小程序默认预览
    }
  },

  onShareAppMessage() {
    const q = String(this.data.searchKeyword || '').trim()
    const title = q
      ? ('智能搜索：' + q + ' | 火星探索日志')
      : '智能搜索火箭与发射任务 | 火星探索日志'
    return {
      title,
      path: '/pages/search/search' + (q ? ('?' + this._shareTimelineSearchQuery()) : '')
    }
  },

  onShareTimeline() {
    const q = String(this.data.searchKeyword || '').trim()
    const title = q
      ? ('智能搜索：' + q + ' | 火星探索日志')
      : '智能搜索火箭与发射任务 | 火星探索日志'
    const payload = {
      title,
      query: this._shareTimelineSearchQuery()
    }
    const img = String(this.data.splashShareImageUrl || '').trim()
    if (img) {
      payload.imageUrl = img
    }
    return payload
  }
})
