/**
 * One-time split of utils/api.js into smaller modules for main-package size reduction.
 * Run: node scripts/split-api-modules.js
 */
const fs = require('fs')
const path = require('path')

const utilsDir = path.join(__dirname, '..', 'utils')
const apiPath = path.join(utilsDir, 'api.js')
const backupPath = path.join(utilsDir, '.api-full.backup.js')
if (!fs.existsSync(backupPath)) {
  fs.copyFileSync(apiPath, backupPath)
}
const lines = fs.readFileSync(backupPath, 'utf8').split('\n')

function slice(start, end) {
  return lines.slice(start - 1, end).join('\n')
}

// 1-based line ranges (verified)
const ROCKET_HELPERS = slice(23, 122)
// Line numbers from utils/.api-full.backup.js
const REQUEST_CORE = slice(124, 997)
const LAUNCH_LIST = slice(998, 1086).trimEnd() + '\n\n' + slice(2258, 2282)
const LAUNCH_DETAIL = slice(1088, 2249)
const ROAD_CLOSURE = slice(2300, 2482)
const NEWS_BLOCK = slice(2491, 3234)
const PAYLOAD_DETAIL = slice(3248, 3279)
const MONITOR_BLOCK = slice(3291, 3895)

const apiRequestPath = path.join(utilsDir, 'api-request.js')
const apiLaunchListPath = path.join(utilsDir, 'api-launch-list.js')
const apiLaunchDetailPath = path.join(utilsDir, 'api-launch-detail.js')
const apiRoadClosurePath = path.join(utilsDir, 'api-road-closure.js')
const apiNewsPath = path.join(utilsDir, 'api-news.js')
const apiMonitorDataPath = path.join(utilsDir, 'api-monitor-data.js')

const apiRequestContent = `// utils/api-request.js — HTTP/cache layer shared by api modules
const { cleanExpiredApiCache } = require('./api-cache-clean.js')
const { CACHE_PREFIX, CACHE_DURATION } = require('./cache-constants.js')
const {
  emptyListResult,
  withTimeout,
  unwrapCacheData
} = require('./api-booster-extract.js')

${REQUEST_CORE}

module.exports = {
  request,
  getCacheKey,
  onStaleUpdate,
  formatPadLocation,
  getCountryDisplay,
  getStatusCategory,
  getStatusBadgeText,
  unwrapCacheData,
  emptyListResult,
  withTimeout,
  isLaunchExpired
}
`

const apiLaunchListContent = `// utils/api-launch-list.js — launch list APIs (upcoming/completed)
const { getRocketImage } = require('./util.js')
const {
  extractBoosterInfoForList,
  isRecoverable,
  extractLaunchAgency
} = require('./api-booster-extract.js')
const { extractRecoveryIcons } = require('./landing-icons.js')
const {
  request,
  getCacheKey,
  formatPadLocation,
  getCountryDisplay,
  getStatusCategory,
  getStatusBadgeText,
  emptyListResult
} = require('./api-request.js')

${ROCKET_HELPERS}

${LAUNCH_LIST}

module.exports = {
  getUpcomingMissions,
  getCompletedMissions,
  mapLaunchToListItem
}
`

const apiLaunchDetailContent = `// utils/api-launch-detail.js — launch detail parsing (heavy)
const { getRocketImage } = require('./util.js')
const { buildLandingIcon, inferLandingStatus, extractRecoveryIcons } = require('./landing-icons.js')
const {
  extractBoosterInfoForList,
  extractBoosterInfoSimple,
  inferRecoveryFallback,
  isRecoverable,
  extractLaunchAgency,
  resolveLauncher,
  resolveLandingType,
  REUSABLE_ROCKET_REGEX,
  SHIP_BOOSTER_REGEX
} = require('./api-booster-extract.js')
const {
  request,
  getCacheKey,
  formatPadLocation,
  getCountryDisplay,
  unwrapCacheData
} = require('./api-request.js')

${slice(23, 121)}

${LAUNCH_DETAIL}

${PAYLOAD_DETAIL}

module.exports = {
  getLaunchDetail,
  processLaunchDetail,
  getPayloadDetail,
  getLauncherInstanceDetail
}
`

const apiRoadClosureContent = `// utils/api-road-closure.js
const { request } = require('./api-request.js')

${ROAD_CLOSURE}

module.exports = {
  getRoadClosureNotice
}
`

const apiNewsContent = `// utils/api-news.js — articles & events (news tab)
const {
  request,
  getCacheKey,
  unwrapCacheData
} = require('./api-request.js')
const { emptyListResult } = require('./api-booster-extract.js')

${NEWS_BLOCK}

module.exports = {
  getArticlesList,
  invalidateArticlesMergeCache,
  getArticleDetail,
  getEventDetail,
  getEventsList,
  manualNewsDocToFormattedItem
}
`

const apiMonitorContent = `// utils/api-monitor-data.js — monitor tab heavy data
const appServices = require('./api-app-services.js')
const {
  request,
  getCacheKey,
  unwrapCacheData
} = require('./api-request.js')

${MONITOR_BLOCK}

module.exports = {
  getStationStatus,
  getAgencies,
  getAgencyDetail,
  resolveAgencyReference,
  getTelemetryData,
  getActiveAnnouncement,
  getBoosterGenealogy
}
`

fs.writeFileSync(apiRequestPath, apiRequestContent)
fs.writeFileSync(apiLaunchListPath, apiLaunchListContent)
fs.writeFileSync(apiLaunchDetailPath, apiLaunchDetailContent)
fs.writeFileSync(apiRoadClosurePath, apiRoadClosureContent)
fs.writeFileSync(apiNewsPath, apiNewsContent)
fs.writeFileSync(apiMonitorDataPath, apiMonitorContent)

// Rewrite api.js as barrel
const apiBarrel = `// utils/api.js — barrel re-export for subpackages (main tab pages use focused modules)
const launchList = require('./api-launch-list.js')
const launchDetail = require('./api-launch-detail.js')
const roadClosure = require('./api-road-closure.js')
const newsApi = require('./api-news.js')
const monitorData = require('./api-monitor-data.js')
const appServices = require('./api-app-services.js')
const { request, getCacheKey, onStaleUpdate } = require('./api-request.js')

const {
  getLaunchStatsFromDB,
  getStarshipStatusFromDB,
  getNsfStarshipChecklistFromDB,
  fetchLl2LaunchUpdates,
  fetchLl2LaunchTimeline,
  getSpaceXLaunchStats,
  getVoteStats,
  castVote,
  shareMission
} = appServices

module.exports = {
  ...launchList,
  ...launchDetail,
  ...roadClosure,
  ...newsApi,
  ...monitorData,
  getStarshipStatusFromDB,
  getNsfStarshipChecklistFromDB,
  fetchLl2LaunchUpdates,
  fetchLl2LaunchTimeline,
  getSpaceXLaunchStats,
  getLaunchStatsFromDB,
  getVoteStats,
  castVote,
  shareMission,
  getCacheKey,
  onStaleUpdate,
  request
}
`

fs.writeFileSync(apiPath, apiBarrel)
console.log('Split complete. Files written:')
console.log(' - api-request.js')
console.log(' - api-launch-list.js')
console.log(' - api-launch-detail.js')
console.log(' - api-road-closure.js')
console.log(' - api-news.js')
console.log(' - api-monitor-data.js')
console.log(' - api.js (barrel)')
