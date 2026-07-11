const { normalizeSearchText } = require('./aiSearch.js')

const DEFAULT_SEARCH_SUMMARY = '试试搜索火箭、任务、机构或发射场'
const RECENT_SEARCH_SUMMARY = '继续搜索你最近关注的任务'
const UPCOMING_SEARCH_SUMMARY = '已优先匹配即将发射的相关任务'
const COMPLETED_SEARCH_SUMMARY = '已优先匹配历史发射记录'
const GENERAL_SEARCH_SUMMARY = '按任务名、火箭名、发射商和发射场综合匹配'
const SEARCH_CACHE_MAX_ENTRIES = 12

function cloneSuggestions(defaultSuggestions) {
  return Array.isArray(defaultSuggestions) ? defaultSuggestions.slice() : []
}

function getDefaultSearchSummary(searchHistory) {
  return Array.isArray(searchHistory) && searchHistory.length ? RECENT_SEARCH_SUMMARY : DEFAULT_SEARCH_SUMMARY
}

function getSearchDisplaySummary(queryInfo, searchHistory) {
  if (!queryInfo || !queryInfo.normalizedQuery) {
    return getDefaultSearchSummary(searchHistory)
  }

  if (queryInfo.intent && queryInfo.intent.wantsUpcoming) {
    return UPCOMING_SEARCH_SUMMARY
  }
  if (queryInfo.intent && queryInfo.intent.wantsCompleted) {
    return COMPLETED_SEARCH_SUMMARY
  }

  return GENERAL_SEARCH_SUMMARY
}

function loadSearchHistory(storageKey, limit) {
  try {
    const stored = wx.getStorageSync(storageKey)
    if (!Array.isArray(stored)) return []
    return stored
      .map((item) => String(item || '').trim())
      .filter(Boolean)
      .slice(0, limit)
  } catch (error) {
    return []
  }
}

function persistSearchHistory(storageKey, history, limit) {
  try {
    wx.setStorageSync(storageKey, (Array.isArray(history) ? history : []).slice(0, limit))
  } catch (error) {}
}

function updateSearchHistoryList(keyword, currentHistory, limit) {
  const cleanKeyword = String(keyword || '').trim()
  if (!cleanKeyword) return Array.isArray(currentHistory) ? currentHistory.slice(0, limit) : []

  return [cleanKeyword]
    .concat((Array.isArray(currentHistory) ? currentHistory : []).filter((item) => normalizeSearchText(item) !== normalizeSearchText(cleanKeyword)))
    .slice(0, limit)
}

function buildSearchInitializeState(params = {}) {
  const searchHistory = Array.isArray(params.searchHistory) ? params.searchHistory : []
  const defaultSuggestions = cloneSuggestions(params.defaultSuggestions)
  return {
    searchHistory,
    searchSuggestions: defaultSuggestions,
    searchSummary: getDefaultSearchSummary(searchHistory),
    searchResultCountText: '',
    searchSuggestedKeyword: '',
    searchEmptyHint: '',
    searchContextLabel: '',
    searchScrollTop: 0,
    searchInputFocus: false,
    searchModalAnimClass: ''
  }
}

function buildSearchModalBaseState(params = {}) {
  const persistedState = params.persistedState
  const searchHistory = Array.isArray(params.searchHistory) ? params.searchHistory : []
  const defaultSuggestions = cloneSuggestions(params.defaultSuggestions)

  if (persistedState && typeof persistedState === 'object') {
    return {
      ...persistedState,
      showSearchModal: true,
      searchLoading: false,
      searchInputFocus: true,
      searchModalAnimClass: ''
    }
  }

  return {
    showSearchModal: true,
    searchKeyword: '',
    searchResults: [],
    searchGroupedResults: [],
    searchLoading: false,
    searchSummary: getDefaultSearchSummary(searchHistory),
    searchResultCountText: '',
    searchSuggestedKeyword: '',
    searchEmptyHint: '',
    searchContextLabel: '',
    searchSuggestions: defaultSuggestions,
    searchScrollTop: 0,
    searchInputFocus: true,
    searchModalAnimClass: ''
  }
}

function buildEmptySearchResultState(params = {}) {
  const searchHistory = Array.isArray(params.searchHistory) ? params.searchHistory : []
  const defaultSuggestions = cloneSuggestions(params.defaultSuggestions)
  const extraState = params.extraState && typeof params.extraState === 'object' ? params.extraState : {}

  return {
    searchResults: [],
    searchGroupedResults: [],
    searchLoading: false,
    searchResultCountText: '',
    searchSuggestedKeyword: '',
    searchEmptyHint: '',
    searchContextLabel: '',
    searchSuggestions: defaultSuggestions,
    searchSummary: getDefaultSearchSummary(searchHistory),
    searchScrollTop: 0,
    ...extraState
  }
}

function buildSearchLoadingState(params = {}) {
  const queryInfo = params.queryInfo || {}
  const keyword = String(params.keyword || '').trim()
  const defaultSuggestions = cloneSuggestions(params.defaultSuggestions)
  const searchSuggestions = Array.isArray(queryInfo.suggestions) && queryInfo.suggestions.length
    ? queryInfo.suggestions
    : defaultSuggestions

  return {
    searchKeyword: keyword,
    searchLoading: true,
    searchSummary: params.summaryText || DEFAULT_SEARCH_SUMMARY,
    searchSuggestions,
    searchResultCountText: '',
    searchEmptyHint: '',
    searchSuggestedKeyword: '',
    searchInputFocus: true
  }
}

function buildSearchAppliedState(params = {}) {
  const keyword = String(params.keyword || '').trim()
  const queryInfo = params.queryInfo || {}
  const resultsPayload = params.resultsPayload || {}
  const defaultSuggestions = cloneSuggestions(params.defaultSuggestions)
  const flatResults = Array.isArray(resultsPayload.flat) ? resultsPayload.flat : []
  const groupedResults = Array.isArray(resultsPayload.groups) ? resultsPayload.groups : []
  const searchSuggestions = Array.isArray(queryInfo.suggestions) && queryInfo.suggestions.length
    ? queryInfo.suggestions
    : defaultSuggestions

  return {
    searchResults: flatResults,
    searchGroupedResults: groupedResults,
    searchLoading: false,
    searchSuggestions,
    searchSummary: params.summaryText || DEFAULT_SEARCH_SUMMARY,
    searchResultCountText: flatResults.length ? `找到 ${flatResults.length} 个相关任务` : '',
    searchSuggestedKeyword: !flatResults.length && searchSuggestions.length ? searchSuggestions[0] : '',
    searchEmptyHint: !flatResults.length
      ? (keyword.length <= 2 ? '试试更完整的火箭名、任务名或发射场关键字' : '没有直接命中，换个别名或更短关键词试试')
      : '',
    searchContextLabel: keyword ? `搜索：${keyword}` : '',
    searchScrollTop: 0
  }
}

function buildSearchErrorState(params = {}) {
  const defaultSuggestions = cloneSuggestions(params.defaultSuggestions)
  const extraState = params.extraState && typeof params.extraState === 'object' ? params.extraState : {}

  return {
    searchResults: [],
    searchGroupedResults: [],
    searchLoading: false,
    searchResultCountText: '',
    searchEmptyHint: '搜索准备失败，请稍后重试',
    searchSuggestedKeyword: '',
    searchContextLabel: '',
    searchSuggestions: defaultSuggestions,
    searchScrollTop: 0,
    searchInputFocus: true,
    ...extraState
  }
}

function buildSearchRestoreState(data) {
  const source = data && typeof data === 'object' ? data : {}
  return {
    showSearchModal: true,
    searchKeyword: source.searchKeyword || '',
    searchResults: Array.isArray(source.searchResults) ? source.searchResults : [],
    searchGroupedResults: Array.isArray(source.searchGroupedResults) ? source.searchGroupedResults : [],
    searchLoading: false,
    searchSummary: source.searchSummary || getDefaultSearchSummary(source.searchHistory || []),
    searchResultCountText: source.searchResultCountText || '',
    searchSuggestedKeyword: source.searchSuggestedKeyword || '',
    searchEmptyHint: source.searchEmptyHint || '',
    searchContextLabel: source.searchContextLabel || '',
    searchSuggestions: Array.isArray(source.searchSuggestions) ? source.searchSuggestions : [],
    searchScrollTop: typeof source.searchScrollTop === 'number' ? source.searchScrollTop : 0,
    searchInputFocus: true,
    searchModalAnimClass: ''
  }
}

function getMissionListSignature(list) {
  const source = Array.isArray(list) ? list : []
  const first = source[0] && source[0].id ? source[0].id : ''
  const last = source[source.length - 1] && source[source.length - 1].id ? source[source.length - 1].id : ''
  return [source.length, first, last]
}

function buildSearchCacheKey(queryInfo, state) {
  const query = queryInfo && queryInfo.normalizedQuery ? queryInfo.normalizedQuery : ''
  if (!query) return ''

  const currentState = state && typeof state === 'object' ? state : {}
  const upcomingSignature = getMissionListSignature(currentState.upcomingMissions)
  const completedSignature = getMissionListSignature(currentState.completedMissions)
  const wantsUpcoming = queryInfo && queryInfo.intent && queryInfo.intent.wantsUpcoming ? 1 : 0
  const wantsCompleted = queryInfo && queryInfo.intent && queryInfo.intent.wantsCompleted ? 1 : 0

  return [
    query,
    wantsUpcoming,
    wantsCompleted,
    ...upcomingSignature,
    Number(currentState.missionsOffset) || 0,
    currentState.missionsHasMore ? 1 : 0,
    ...completedSignature,
    Number(currentState.completedMissionsOffset) || 0,
    currentState.completedMissionsHasMore ? 1 : 0
  ].join('|')
}

function upsertSearchCache(cacheStore, cacheOrder, cacheKey, resultsPayload) {
  if (!cacheKey) {
    return {
      cacheStore: cacheStore || Object.create(null),
      cacheOrder: Array.isArray(cacheOrder) ? cacheOrder.slice() : []
    }
  }

  const nextStore = cacheStore && typeof cacheStore === 'object' ? cacheStore : Object.create(null)
  const nextOrder = Array.isArray(cacheOrder) ? cacheOrder.filter((item) => item !== cacheKey) : []
  nextStore[cacheKey] = resultsPayload
  nextOrder.push(cacheKey)

  while (nextOrder.length > SEARCH_CACHE_MAX_ENTRIES) {
    const removedKey = nextOrder.shift()
    if (removedKey) {
      delete nextStore[removedKey]
    }
  }

  return {
    cacheStore: nextStore,
    cacheOrder: nextOrder
  }
}

module.exports = {
  getDefaultSearchSummary,
  getSearchDisplaySummary,
  loadSearchHistory,
  persistSearchHistory,
  updateSearchHistoryList,
  buildSearchInitializeState,
  buildSearchModalBaseState,
  buildEmptySearchResultState,
  buildSearchLoadingState,
  buildSearchAppliedState,
  buildSearchErrorState,
  buildSearchRestoreState,
  buildSearchCacheKey,
  upsertSearchCache
}
