/**
 * 构型档案目录：LL2 reusable 筛选无效，须按 is_placeholder=false 翻完全量。
 * 当前全量约 527 条；只翻 3 页会丢掉 Spectrum 等后半段型号。
 * 全量清单只在档案不足下限时跑一次；之后常驻，只补缺失或实质变更。
 */

var CONFIG_LIST_PAGE_LIMIT = 8
var CONFIG_LIST_PAGE_SIZE = 100
var CONFIG_LIST_MIN_COUNT = 480
var CONFIG_DESC_MAX_LEN = 600

var CONFIG_COMPARE_SKIP = {
  fetchedAt: 1,
  nameZh: 1,
  full_nameZh: 1,
  manufacturerNameZh: 1,
  descriptionZh: 1,
  cosImageUrl: 1,
  fastestTurnaroundText: 1
}

function configListUrl() {
  return 'https://ll.thespacedevs.com/2.3.0/launcher_configurations/?is_placeholder=false&mode=detailed&limit=' +
    CONFIG_LIST_PAGE_SIZE + '&format=json'
}

function catalogCount(configs) {
  return Object.keys(configs || {}).length
}

function catalogNeedsFullRefresh(existing, options) {
  var opts = options && typeof options === 'object' ? options : {}
  if (opts.fillCatalog) return true
  return catalogCount(existing) < CONFIG_LIST_MIN_COUNT
}

function configFieldKey(v) {
  return v == null ? '' : String(v)
}

function configRecordChanged(oldRow, nextRow) {
  if (!oldRow) return true
  if (!nextRow) return false
  var seen = {}
  var keys = Object.keys(oldRow).concat(Object.keys(nextRow))
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i]
    if (seen[k] || CONFIG_COMPARE_SKIP[k]) continue
    seen[k] = 1
    if (configFieldKey(oldRow[k]) !== configFieldKey(nextRow[k])) return true
  }
  return false
}

function shouldFetchExistingConfig(row, now, ttl) {
  if (!row) return true
  var age = Number(now) - Number(row.fetchedAt || 0)
  return age >= Number(ttl || 0)
}

function collectConfigIdsFromLaunches(launches) {
  var ids = []
  var seen = {}
  ;(launches || []).forEach(function (launch) {
    var cfg = launch && launch.rocket && launch.rocket.configuration
    if (!cfg || cfg.id == null) return
    var id = Number(cfg.id)
    if (!id || seen[id]) return
    seen[id] = true
    ids.push(id)
  })
  return ids
}

function collectConfigIdsFromAgencies(agencies) {
  var ids = []
  var seen = {}
  ;(agencies || []).forEach(function (agency) {
    var list = (agency && agency.launcher_list) || []
    list.forEach(function (entry) {
      if (!entry || entry.id == null) return
      var id = Number(entry.id)
      if (!id || seen[id]) return
      seen[id] = true
      ids.push(id)
    })
  })
  return ids
}

function truncateConfigDescription(text, maxLen) {
  var limit = maxLen != null ? maxLen : CONFIG_DESC_MAX_LEN
  var s = String(text || '')
  if (s.length <= limit) return s
  return s.slice(0, limit)
}

module.exports = {
  CONFIG_LIST_PAGE_LIMIT: CONFIG_LIST_PAGE_LIMIT,
  CONFIG_LIST_PAGE_SIZE: CONFIG_LIST_PAGE_SIZE,
  CONFIG_LIST_MIN_COUNT: CONFIG_LIST_MIN_COUNT,
  CONFIG_DESC_MAX_LEN: CONFIG_DESC_MAX_LEN,
  configListUrl: configListUrl,
  catalogCount: catalogCount,
  catalogNeedsFullRefresh: catalogNeedsFullRefresh,
  configRecordChanged: configRecordChanged,
  shouldFetchExistingConfig: shouldFetchExistingConfig,
  collectConfigIdsFromLaunches: collectConfigIdsFromLaunches,
  collectConfigIdsFromAgencies: collectConfigIdsFromAgencies,
  truncateConfigDescription: truncateConfigDescription
}
