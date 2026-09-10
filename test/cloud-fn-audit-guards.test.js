/**
 * 云函数整包审计落地守卫。
 * 运行：node --test test/cloud-fn-audit-guards.test.js
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8')
}

test('手动推送对上 sendLaunchReminder 现有 action', () => {
  const admin = read('cloudfunctions/adminGateway/index.js')
  const reminder = read('cloudfunctions/sendLaunchReminder/index.js')
  assert.match(admin, /actionMap/)
  assert.match(admin, /pending:\s*'sendPending'/)
  assert.match(admin, /name:\s*'sendLaunchReminder'/)
  assert.match(reminder, /if \(action === 'manual'\) action = 'sendPending'/)
})

test('简报读现网 cache 前缀且开关对齐 main.enableBriefing', () => {
  const briefing = read('cloudfunctions/morningBriefing/index.js')
  const admin = read('cloudfunctions/adminGateway/index.js')
  const udg = read('cloudfunctions/userDataGateway/index.js')
  const ui = read('subpackages/shared/components/morning-briefing/index.js')
  assert.match(briefing, /\/launches\/upcoming\//)
  assert.match(briefing, /enableBriefing === false/)
  assert.match(admin, /BRIEFING_CONFIG_ID/)
  assert.match(admin, /briefingEnabled: enabled/)
  assert.match(udg, /source:\s*'daily_briefing'/)
  assert.match(ui, /action:\s*'getTodayBriefing'/)
})

test('ll2Query 不再双写配额、不再回写 slim upcoming', () => {
  const src = read('cloudfunctions/ll2Query/index.js')
  assert.doesNotMatch(src, /_ll2_usage_hourly/)
  assert.match(src, /recordLl2Request/)
  assert.match(src, /ll2Query_no_slim_write/)
  assert.doesNotMatch(src, /upcomingCachePatcher\.patchUpcomingCacheWithLiveRows/)
})

test('后台 GET /users/:id 存在，media-feed 死封装已删', () => {
  const admin = read('cloudfunctions/adminGateway/index.js')
  const client = read('admin-web/src/api/client.js')
  assert.match(admin, /async function getUserById/)
  assert.match(admin, /path\.startsWith\('\/users\/'\) && method === 'GET'/)
  assert.doesNotMatch(client, /\/media-feed/)
  assert.equal(fs.existsSync(path.join(ROOT, 'admin-web/src/views/system/CacheManagementPage.vue')), false)
  assert.equal(fs.existsSync(path.join(ROOT, 'admin-web/src/views/system/BatchJobsPage.vue')), false)
})

test('station_tle 客户端只读，发货走 membership.applyPaidOrder', () => {
  const station = read('subpackages/monitor-pages/station-detail.js')
  const membership = read('cloudfunctions/membership/index.js')
  const admin = read('cloudfunctions/adminGateway/index.js')
  assert.doesNotMatch(station, /collection\('station_tle'\)[\s\S]{0,220}\.(update|add)\(/)
  assert.match(membership, /case 'applyPaidOrder':/)
  assert.match(admin, /name:\s*'membership'/)
  assert.match(admin, /action:\s*'applyPaidOrder'/)
})

test('用户路径统计只读：客户端 forceRefresh 被剥除且 launch-stats-cloud 带 readOnly', () => {
  const stats = read('cloudfunctions/getLaunchStats/index.js')
  const client = read('utils/launch-stats-cloud.js')
  assert.match(stats, /if \(!fromServer && event\.forceRefresh\)/)
  assert.match(stats, /forceRefresh:\s*false/)
  assert.match(client, /readOnly:\s*true/)
})

test('详情深链可同时带 entryKey，航警跳转双键', () => {
  const nav = read('utils/index-mission-nav.js')
  const route = read('pages/mission-detail/utils/page-route-options.js')
  const detail = read('pages/mission-detail/mission-detail.js')
  assert.match(nav, /entryKey=/)
  assert.match(route, /entryKey/)
  assert.match(detail, /if \(shortcut\.entryKey\) params\.entryKey/)
  assert.match(detail, /if \(shortcut\.ll2Id\) params\.ll2Id/)
  assert.doesNotMatch(detail, /else if \(shortcut\.ll2Id\)/)
})

test('本地 slim 只认 v6：清 v3-v5，列表不再扫 legacy 后缀', () => {
  const clean = read('utils/api-cache-clean.js')
  const req = read('utils/api-request.js')
  const stats = read('cloudfunctions/getLaunchStats/index.js')
  assert.match(clean, /_slim_v\[1-5\]/)
  assert.doesNotMatch(req, /LEGACY_SLIM_SUFFIXES\.forEach/)
  assert.match(stats, /UPCOMING_CACHE_SUFFIXES = \['_slim_v6'/)
})

test('首页统计优先 getSummary，notReady 才回捞 launch_stats', () => {
  const src = read('utils/api-app-services.js')
  const cloud = read('cloudfunctions/getLaunchStats/index.js')
  assert.match(src, /fetchLaunchSummaryFromCloud/)
  assert.match(src, /collection\('launch_stats'\)/)
  assert.match(src, /source: stats\.source \|\| 'launch_stats'/)
  assert.match(cloud, /readLaunchStatsCollectionFallback/)
})

test('publicGateway slimLaunch 对齐 launcher_stage / orbit / country_code', () => {
  const src = read('cloudfunctions/publicGateway/index.js')
  assert.match(src, /function slimLauncherStages/)
  assert.match(src, /function slimOrbit/)
  assert.match(src, /country_code: provider\.country_code/)
  assert.match(src, /launcher_stage/)
})

test('云函数页在旧网关无 canTrigger 时仍开放原白名单', () => {
  const page = read('admin-web/src/views/system/CloudFunctionsPage.vue')
  assert.match(page, /LEGACY_TRIGGER_ALLOW/)
  assert.match(page, /row\.canTrigger === false/)
})

test('后台运维工具接线：清单 24 个、知识卡模块、无 carousel_config', () => {
  const catalog = read('cloudfunctions/adminGateway/cloud-fn-catalog.js')
  const admin = read('cloudfunctions/adminGateway/index.js')
  const client = read('admin-web/src/api/client.js')
  const router = read('admin-web/src/router/index.js')
  assert.match(catalog, /name: 'lunarWishes'/)
  assert.match(catalog, /name: 'oaWebhook'/)
  assert.match(catalog, /TRIGGER_ALLOWLIST/)
  assert.match(admin, /listCloudFunctionCatalog/)
  assert.match(admin, /createKnowledgeCardsApi/)
  assert.doesNotMatch(admin, /carousel_config/)
  assert.match(client, /\/agencies\/sync/)
  assert.match(client, /\/mission-replays/)
  assert.match(client, /\/ops\/decommission-bilibili-publish/)
  assert.match(router, /ops-tools/)
  assert.equal(fs.existsSync(path.join(ROOT, 'admin-web/src/views/system/OpsToolsPage.vue')), true)
  assert.equal(fs.existsSync(path.join(ROOT, 'cloudfunctions/adminGateway/knowledgeCards.js')), true)
})

test('识图云函数文档不再当现网能力', () => {
  const doc = read('docs/wechat-ai-capability.md')
  assert.match(doc, /规划中，仓库无此云函数/)
})
