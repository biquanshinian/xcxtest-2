const { normalizeSearchText } = require('./aiSearch.js')
const {
  toPinyinCompact,
  toPinyinInitialsCompact,
  matchChineseWithPinyin,
  isLikelyPinyinQuery,
  hasCJK
} = require('./search-pinyin.js')
const { getAgencySearchExtraRaw } = require('./agency-search-aliases.js')

function levenshtein(a, b) {
  if (a === b) return 0
  const m = a.length
  const n = b.length
  if (!m) return n
  if (!n) return m
  const row = new Array(n + 1)
  for (let j = 0; j <= n; j++) row[j] = j
  for (let i = 1; i <= m; i++) {
    let prev = row[0]
    row[0] = i
    for (let j = 1; j <= n; j++) {
      const cur = row[j]
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + cost)
      prev = cur
    }
  }
  return row[n]
}

function latinTypoFriendlyMatch(query, target) {
  const q = String(query || '').toLowerCase()
  const t = String(target || '').toLowerCase()
  if (!q || !t) return false
  if (t.includes(q)) return true
  if (q.length < 4 || t.length < 4) return false
  if (!/^[a-z0-9]+$/.test(q)) return false
  const dist = levenshtein(q, t)
  const maxLen = Math.max(q.length, t.length)
  if (dist === 1 && maxLen <= 12) return true
  if (dist === 2 && maxLen <= 16 && dist / maxLen <= 0.36) return true
  return false
}

function isChineseOrderedSubsequence(small, large) {
  const s = String(small || '')
  const L = String(large || '')
  if (!s || !L || s.length > L.length) return false
  let i = 0
  for (let j = 0; j < L.length && i < s.length; j++) {
    if (s[i] === L[j]) i++
  }
  return i === s.length
}

function fieldMostlyAsciiLetters(val) {
  const s = String(val || '')
  if (s.length < 3) return false
  const letters = s.replace(/[^a-zA-Z]/g, '').length
  return letters >= 3 && letters / s.length >= 0.45
}

const SEARCH_FIELD_WEIGHTS = {
  missionName: 120,
  rocketName: 105,
  launchAgency: 80,
  launchSite: 64,
  padLocation: 58
}

const SEARCH_FIELD_LABELS = {
  missionName: '任务名',
  rocketName: '火箭',
  launchAgency: '机构',
  launchSite: '发射场',
  padLocation: '发射台',
  combined: '组合'
}

function getMissionSearchDocument(mission, type) {
  const launchTime = mission && mission.launchTime ? new Date(mission.launchTime).getTime() : 0
  const rawMissionName = (mission && (mission.missionName || mission.name)) || ''
  const rawRocket = (mission && mission.rocketName) || ''
  const rawAgency = (mission && mission.launchAgency) || ''
  const rawSite = (mission && mission.launchSite) || ''
  const rawPad = (mission && mission.padLocation) || ''

  const fields = {
    missionName: normalizeSearchText(rawMissionName),
    rocketName: normalizeSearchText(rawRocket),
    launchAgency: normalizeSearchText(rawAgency),
    launchSite: normalizeSearchText(rawSite),
    padLocation: normalizeSearchText(rawPad)
  }

  const rawCombined = [rawMissionName, rawRocket, rawAgency, rawSite, rawPad].join(' ')
  const pinyinFull = toPinyinCompact(rawCombined)
  const pinyinInitials = toPinyinInitialsCompact(rawCombined)

  return {
    mission,
    type,
    fields,
    rawFields: {
      missionName: rawMissionName,
      rocketName: rawRocket,
      launchAgency: rawAgency,
      launchSite: rawSite,
      padLocation: rawPad
    },
    pinyinFull,
    pinyinInitials,
    combined: normalizeSearchText(Object.values(fields).join(' ')),
    launchTime,
    isUpcoming: type === 'upcoming'
  }
}

/**
 * 为发射商生成搜索文档
 * @param {Object} agency - 发射商对象（已处理过的 agencyList item）
 * @returns {Object} 搜索文档
 */
function getAgencySearchDocument(agency) {
  if (!agency) return null
  const rawName = agency.name || ''
  const rawLaunchers = agency.launchers || ''
  const rawAbbrev = agency.abbrev || ''
  const rawCountry = agency.countryName || ''
  const rawDesc = (agency.description || '').slice(0, 200)
  const extraRaw = getAgencySearchExtraRaw(agency)

  const fields = {
    missionName: normalizeSearchText(rawName),
    rocketName: normalizeSearchText(rawLaunchers),
    launchAgency: normalizeSearchText(rawAbbrev),
    launchSite: normalizeSearchText(rawCountry),
    padLocation: normalizeSearchText(rawDesc)
  }

  const rawCombined = [rawName, rawLaunchers, rawAbbrev, rawCountry, rawDesc, extraRaw].filter(Boolean).join(' ')
  const pinyinFull = toPinyinCompact(rawCombined)
  const pinyinInitials = toPinyinInitialsCompact(rawCombined)

  const rawFields = {
    missionName: rawName,
    rocketName: rawLaunchers,
    launchAgency: rawAbbrev,
    launchSite: rawCountry,
    padLocation: rawDesc
  }
  if (extraRaw) rawFields.extraZh = extraRaw

  return {
    mission: {
      ...agency,
      _isAgency: true,
      missionName: agency.name,
      rocketName: agency.launchers || '',
      launchAgency: agency.abbrev || ''
    },
    type: 'agency',
    fields,
    rawFields,
    pinyinFull,
    pinyinInitials,
    combined: normalizeSearchText(Object.values(fields).join(' ')),
    launchTime: 0,
    isUpcoming: false
  }
}

function scoreSearchDocument(queryInfo, doc) {
  const expandedTerms = (queryInfo && queryInfo.expandedTerms) || []
  const tokens = (queryInfo && queryInfo.tokens) || []
  const normalizedQuery = (queryInfo && queryInfo.normalizedQuery) || ''

  let score = 0
  const matchedTags = []
  const matchedReasons = []

  const registerMatch = (label, reason, weight) => {
    score += weight
    const displayLabel = SEARCH_FIELD_LABELS[label] || label
    if (matchedTags.indexOf(displayLabel) === -1) matchedTags.push(displayLabel)
    if (reason && matchedReasons.indexOf(reason) === -1) matchedReasons.push(reason)
  }

  Object.keys(doc.fields).forEach((fieldKey) => {
    const fieldValue = doc.fields[fieldKey]
    if (!fieldValue) return
    const fieldWeight = SEARCH_FIELD_WEIGHTS[fieldKey] || 40

    if (normalizedQuery && fieldValue === normalizedQuery) {
      registerMatch(fieldKey, '精确匹配', fieldWeight + 80)
    } else if (normalizedQuery && fieldValue.startsWith(normalizedQuery)) {
      registerMatch(fieldKey, '前缀匹配', fieldWeight + 48)
    }

    expandedTerms.forEach((term) => {
      if (!term) return
      if (term.length < 2 && !/[\u3400-\u9FFF]/.test(term)) return
      if (fieldValue === term) {
        registerMatch(fieldKey, '别名命中', fieldWeight + 36)
      } else if (fieldValue.includes(term)) {
        registerMatch(fieldKey, '字段匹配', fieldWeight + Math.min(28, term.length * 2))
      }
    })

    if (normalizedQuery && hasCJK(normalizedQuery) && fieldValue) {
      if (isChineseOrderedSubsequence(normalizedQuery, fieldValue)) {
        registerMatch(fieldKey, '汉字序匹配', Math.round(fieldWeight * 0.55))
      }
    }

    if (normalizedQuery && isLikelyPinyinQuery(normalizedQuery) && fieldMostlyAsciiLetters(fieldValue)) {
      if (latinTypoFriendlyMatch(normalizedQuery, fieldValue)) {
        registerMatch(fieldKey, '英文模糊', Math.round(fieldWeight * 0.72))
      }
    }
  })

  const pyFull = doc.pinyinFull || ''
  const pyIni = doc.pinyinInitials || ''

  if (normalizedQuery && isLikelyPinyinQuery(normalizedQuery)) {
    if (pyFull) {
      if (pyFull === normalizedQuery) {
        registerMatch('combined', '全拼精确', 92)
      } else if (pyFull.includes(normalizedQuery)) {
        registerMatch('combined', '全拼命中', 64)
      }
    }
    if (pyIni && normalizedQuery.length >= 2 && pyIni.includes(normalizedQuery)) {
      registerMatch('combined', '简拼命中', 52)
    }

    if (doc.rawFields) {
      Object.keys(doc.rawFields).forEach((fieldKey) => {
        const raw = doc.rawFields[fieldKey]
        if (!raw || !hasCJK(raw)) return
        if (matchChineseWithPinyin(raw, normalizedQuery)) {
          registerMatch(fieldKey, '拼音匹配', (SEARCH_FIELD_WEIGHTS[fieldKey] || 40) + 40)
        }
      })
    }
  }

  expandedTerms.forEach((term) => {
    if (!term || term.length < 2) return
    if (!/^[a-z0-9]+$/.test(term)) return
    if (pyFull && pyFull.includes(term) && term.length >= 3) {
      registerMatch('combined', '全拼关联', Math.min(48, 14 + term.length * 2))
    }
    if (pyIni && pyIni.includes(term)) {
      registerMatch('combined', '简拼关联', Math.min(40, 12 + term.length * 2))
    }
  })

  if (tokens.length > 1) {
    const tokenHitCount = tokens.filter((token) => doc.combined.includes(token)).length
    if (tokenHitCount > 1) {
      registerMatch('combined', '组合搜索', tokenHitCount * 22)
    }
  }

  if (!score) {
    return null
  }

  const now = Date.now()
  if (doc.isUpcoming && doc.launchTime > now) {
    const diffDays = (doc.launchTime - now) / (1000 * 60 * 60 * 24)
    score += diffDays < 14 ? 22 : 10
  } else if (!doc.isUpcoming && doc.launchTime > 0) {
    const daysAgo = (now - doc.launchTime) / (1000 * 60 * 60 * 24)
    score += daysAgo < 30 ? 16 : 6
  }

  if (queryInfo && queryInfo.intent && queryInfo.intent.wantsUpcoming && doc.isUpcoming) {
    score += 26
  }
  if (queryInfo && queryInfo.intent && queryInfo.intent.wantsCompleted && !doc.isUpcoming) {
    score += 26
  }

  return {
    score,
    matchedTags,
    matchedReasons
  }
}

function buildHighlightedSegments(text, queryInfo) {
  const sourceText = String(text || '')
  if (!sourceText) return []

  const lowerSource = sourceText.toLowerCase()
  const rawTerms = []
    .concat((queryInfo && queryInfo.expandedTerms) || [])
    .concat((queryInfo && queryInfo.tokens) || [])
    .concat((queryInfo && queryInfo.normalizedQuery) || [])
    .map((term) => String(term || '').trim())
    .filter((term) => term && term.length >= 2)

  const uniqueTerms = Array.from(new Set(rawTerms)).sort((a, b) => b.length - a.length)
  const ranges = []

  uniqueTerms.forEach((term) => {
    const lowerTerm = term.toLowerCase()
    let startIndex = lowerSource.indexOf(lowerTerm)
    while (startIndex >= 0) {
      ranges.push({ start: startIndex, end: startIndex + lowerTerm.length })
      startIndex = lowerSource.indexOf(lowerTerm, startIndex + lowerTerm.length)
    }
  })

  if (!ranges.length) {
    return [{ text: sourceText, highlight: false }]
  }

  ranges.sort((a, b) => a.start - b.start || b.end - a.end)
  const merged = []
  ranges.forEach((range) => {
    const last = merged[merged.length - 1]
    if (!last || range.start > last.end) {
      merged.push({ ...range })
    } else if (range.end > last.end) {
      last.end = range.end
    }
  })

  const segments = []
  let cursor = 0
  merged.forEach((range) => {
    if (range.start > cursor) {
      segments.push({ text: sourceText.slice(cursor, range.start), highlight: false })
    }
    segments.push({ text: sourceText.slice(range.start, range.end), highlight: true })
    cursor = range.end
  })

  if (cursor < sourceText.length) {
    segments.push({ text: sourceText.slice(cursor), highlight: false })
  }

  return segments.filter((segment) => segment.text)
}

function decorateSearchResultItem(item, queryInfo) {
  const title = item.missionName || item.name || '未知任务'
  const meta = `${item.rocketName || '未知火箭'} · ${item.formattedTime || '时间未知'}`
  return {
    ...item,
    _titleSegments: buildHighlightedSegments(title, queryInfo),
    _metaSegments: buildHighlightedSegments(meta, queryInfo)
  }
}

function groupSearchResults(results, queryInfo) {
  const decorate = (items) => items.map((item) => decorateSearchResultItem(item, queryInfo))
  const upcoming = results.filter((item) => item._type === 'upcoming')
  const completed = results.filter((item) => item._type === 'completed')
  const agencies = results.filter((item) => item._type === 'agency')
  const groups = []

  if (agencies.length) {
    groups.push({
      key: 'agency',
      title: '发射商/机构',
      subtitle: `${agencies.length} 条结果`,
      items: decorate(agencies)
    })
  }

  if (upcoming.length) {
    groups.push({
      key: 'upcoming',
      title: '即将发射',
      subtitle: `${upcoming.length} 条结果`,
      items: decorate(upcoming)
    })
  }

  if (completed.length) {
    groups.push({
      key: 'completed',
      title: '历史发射',
      subtitle: `${completed.length} 条结果`,
      items: decorate(completed)
    })
  }

  return groups
}

function sortSearchResults(a, b) {
  if ((b._searchScore || 0) !== (a._searchScore || 0)) {
    return (b._searchScore || 0) - (a._searchScore || 0)
  }

  const timeA = a.launchTime ? new Date(a.launchTime).getTime() : 0
  const timeB = b.launchTime ? new Date(b.launchTime).getTime() : 0
  const now = Date.now()
  const aUpcoming = timeA > now
  const bUpcoming = timeB > now

  if (aUpcoming && bUpcoming) return timeA - timeB
  if (!aUpcoming && !bUpcoming) return timeB - timeA
  return aUpcoming ? -1 : 1
}

function buildSearchResults(params = {}) {
  const upcomingMissions = Array.isArray(params.upcomingMissions) ? params.upcomingMissions : []
  const completedMissions = Array.isArray(params.completedMissions) ? params.completedMissions : []
  const agenciesList = Array.isArray(params.agencies) ? params.agencies : []
  const queryInfo = params.queryInfo || {}
  const docs = upcomingMissions
    .map((mission) => getMissionSearchDocument(mission, 'upcoming'))
    .concat(completedMissions.map((mission) => getMissionSearchDocument(mission, 'completed')))
    .concat(agenciesList.map((agency) => getAgencySearchDocument(agency)).filter(Boolean))

  const flat = docs.map((doc) => {
    const scored = scoreSearchDocument(queryInfo, doc)
    if (!scored) return null
    return {
      ...doc.mission,
      _type: doc.type,
      _searchScore: scored.score,
      _searchTags: scored.matchedTags,
      _matchReason: scored.matchedReasons[0] || '相关匹配',
      _searchHint: doc.type === 'agency' ? '发射商' : (doc.isUpcoming ? '即将发射' : '历史发射')
    }
  }).filter(Boolean).sort(sortSearchResults)

  return {
    flat,
    groups: groupSearchResults(flat, queryInfo)
  }
}

function buildSearchPrefetchPlan(queryInfo, state = {}, options = {}) {
  const normalizedQuery = (queryInfo && queryInfo.normalizedQuery) || ''
  const minQueryLength = Number(options.minQueryLength) || 2
  if (!normalizedQuery || normalizedQuery.length < minQueryLength) {
    return []
  }

  const targetLimit = Math.max(Number(options.targetLimit) || 60, 1)
  const batchSize = Math.max(Number(options.batchSize) || 20, 1)
  const upcomingCount = Array.isArray(state.upcomingMissions) ? state.upcomingMissions.length : 0
  const completedCount = Array.isArray(state.completedMissions) ? state.completedMissions.length : 0
  const wantsUpcoming = !!(queryInfo && queryInfo.intent && queryInfo.intent.wantsUpcoming)
  const wantsCompleted = !!(queryInfo && queryInfo.intent && queryInfo.intent.wantsCompleted)
  const plans = []

  const appendPlan = (type, count, hasMore, offset) => {
    if (!hasMore || count >= targetLimit) return
    plans.push({
      type,
      offset: Number(offset) || 0,
      limit: Math.max(1, Math.min(batchSize, targetLimit - count))
    })
  }

  if (wantsUpcoming && !wantsCompleted) {
    appendPlan('upcoming', upcomingCount, !!state.missionsHasMore, state.missionsOffset)
    return plans
  }

  if (wantsCompleted && !wantsUpcoming) {
    appendPlan('completed', completedCount, !!state.completedMissionsHasMore, state.completedMissionsOffset)
    return plans
  }

  appendPlan('upcoming', upcomingCount, !!state.missionsHasMore, state.missionsOffset)
  appendPlan('completed', completedCount, !!state.completedMissionsHasMore, state.completedMissionsOffset)
  return plans
}

module.exports = {
  buildSearchResults,
  buildSearchPrefetchPlan,
  getAgencySearchDocument,
  scoreSearchDocument
}
