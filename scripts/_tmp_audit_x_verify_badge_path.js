/**
 * X 认证标路径审计：后台设标 → 云函数读写 → 前端胶囊/作者条
 * node scripts/_tmp_audit_x_verify_badge_path.js
 */
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const ROOT = path.resolve(__dirname, '..')
let fail = 0
function ok(m) { console.log('  [ok]', m) }
function bad(m) { fail++; console.log('  [FAIL]', m) }
function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n')
}
function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel))
}

console.log('== 资源 ==')
;[
  ['images/x-verify/grey.svg', '#829aab'],
  ['images/x-verify/blue.svg', '#1D9BF0'],
  ['images/x-verify/gold.svg', '#d18800']
].forEach(([rel, token]) => {
  if (!exists(rel)) bad('缺 ' + rel)
  else if (!read(rel).includes(token)) bad(rel + ' 缺特征色 ' + token)
  else ok(rel)
})
exists('admin-web/src/components/x-verify/XVerifyBadge.vue') ? ok('后台 SVG 组件') : bad('缺 XVerifyBadge.vue')
const badgeCopies = [
  'subpackages/progress-extra/utils/x-verify-badge.js',
  'subpackages/index-extra/utils/x-verify-badge.js',
  'subpackages/shared/utils/x-verify-badge.js'
]
badgeCopies.forEach((rel) => exists(rel) ? ok(rel) : bad('缺 ' + rel))
exists('utils/x-verify-badge.js') ? bad('主包仍有仅分包使用的 x-verify-badge.js') : ok('主包已移出 x-verify-badge.js')
const badgeBody = badgeCopies.map(read)
badgeBody[0] === badgeBody[1] && badgeBody[0] === badgeBody[2]
  ? ok('三份认证标副本一致')
  : bad('认证标分包副本未同步')

const pack = JSON.parse(read('project.config.json'))
const ignores = ((pack.packOptions && pack.packOptions.ignore) || []).map((i) => i.value || '')
const blocked = ignores.some((v) => /images\/x-verify|\/x-verify/.test(v))
blocked ? bad('packOptions.ignore 排除了认证标图') : ok('认证标图会进主包')

console.log('== 语法 ==')
;[
  'subpackages/progress-extra/utils/x-verify-badge.js',
  'subpackages/progress-extra/utils/tweet-account-stats.js',
  'subpackages/progress-extra/utils/progress-lazy.js',
  'subpackages/progress-extra/event-detail.js',
  'cloudfunctions/userDataGateway/index.js',
  'cloudfunctions/adminGateway/index.js',
  'subpackages/shared/components/morning-briefing/index.js'
].forEach((f) => {
  try { new vm.Script(read(f)); ok(f) } catch (e) { bad(f + ': ' + e.message) }
})

console.log('== 后台写路径 ==')
const page = read('admin-web/src/views/launch/TweetMonitorPage.vue')
const client = read('admin-web/src/api/client.js')
const gw = read('cloudfunctions/adminGateway/index.js')
page.includes('onSetVerifyBadge') && page.includes('XVerifyBadge') ? ok('追踪账号管理可点选灰/蓝/金') : bad('后台页未接设标 UI')
page.includes("api.updateTweetAccountBadge(row._id, next)") ? ok('点选走 updateTweetAccountBadge') : bad('点选未调 API')
page.includes('verifyBadge: newAccount.verifyBadge') ? ok('添加账号带上认证标') : bad('添加账号丢掉认证标')
client.includes("/tweet-monitor/accounts/${id}/badge") ? ok('client PUT /badge') : bad('client 缺 /badge')
gw.includes("path.endsWith('/badge') && method === 'PUT'") ? ok('adminGateway 注册 PUT /badge') : bad('网关未注册 /badge')
gw.includes('async function updateTweetAccountBadge') && gw.includes("data: { verifyBadge, updatedAt:")
  ? ok('网关写入 tweet_accounts.verifyBadge')
  : bad('网关未写入 verifyBadge')
gw.includes('normalizeTweetVerifyBadge(body.verifyBadge)') && gw.includes('verifyBadge,')
  ? ok('新增账号也会落库 verifyBadge')
  : bad('新增账号未写 verifyBadge')

console.log('== 客户端读路径 ==')
const udg = read('cloudfunctions/userDataGateway/index.js')
const helper = read('subpackages/progress-extra/utils/tweet-account-stats.js')
const lazy = read('subpackages/progress-extra/utils/progress-lazy.js')
const detailJs = read('subpackages/progress-extra/event-detail.js')
udg.includes("case 'getTodayTweetStats'") && udg.includes('verifyBadgeSrc: verifyBadgeSrc(verifyBadge)')
  ? ok('getTodayTweetStats 下发 verifyBadge / src')
  : bad('统计接口未下发认证标')
udg.includes('badgeBySource[acc.screenName] = verifyBadge') ? ok('全量 badgeBySource（含今日 0 条账号）') : bad('缺 badgeBySource')
udg.includes("case 'getTweetAccounts'") && udg.includes('verifyBadge: verifyBadge')
  ? ok('getTweetAccounts 也带认证标')
  : bad('账号列表未带认证标')
helper.includes("require('./x-verify-badge.js')") ? ok('胶囊 helper 引用分包本地归一化') : bad('helper 未引用 x-verify-badge')
helper.includes('attachVerifyBadgeToItem') && helper.includes('lookupVerifyBadge')
  ? ok('事件项按 source 对齐认证标')
  : bad('缺 attach/lookup')
lazy.includes('attachVerifyBadgeToItem') && lazy.includes('attachVerifyBadgeToList')
  ? ok('进展页 enrich + 统计回调回写认证标')
  : bad('进展页未接 attach')
lazy.includes('fetchTodayTweetAccountStats()') ? ok('拉事件时并行预热认证标') : bad('事件列表未并行拉认证标')
const progressJs = read('pages/progress/progress.js')
const statsIdx = progressJs.indexOf('this._loadTweetAccountStats()')
const eventsIdx = progressJs.indexOf('this.loadEventUpdates(false')
statsIdx >= 0 && eventsIdx > statsIdx && eventsIdx - statsIdx < 120
  ? ok('进展页 50ms 与事件列表同时拉统计')
  : bad('进展页统计仍只挂在 1.2s 折叠区定时器')
lazy.includes('const statsP = fetchTodayTweetAccountStats()') && lazy.includes('await statsP')
  ? ok('事件列表上屏前等待认证标')
  : bad('事件列表未等待认证标就 setData')
detailJs.includes('await fetchTodayTweetAccountStats()') || detailJs.includes('await statsP')
  ? ok('详情页上屏前等待认证标')
  : bad('详情页未等待认证标')
detailJs.includes('attachVerifyBadgeToItem') && detailJs.includes('attachVerifyBadgeToList')
  ? ok('详情页 enrich + 胶囊回调回写认证标')
  : bad('详情页未接 attach')

console.log('== 展示面 ==')
const chips = read('subpackages/progress-extra/components/tweet-account-chips/index.wxml')
const updates = read('subpackages/progress-extra/components/event-updates/index.wxml')
const detail = read('subpackages/progress-extra/event-detail.wxml')
const briefing = read('subpackages/shared/components/morning-briefing/index.wxml')
const briefingJs = read('subpackages/shared/components/morning-briefing/index.js')
;(chips.match(/item\.verifyBadgeSrc/g) || []).length >= 1 ? ok('账号胶囊展示认证标') : bad('胶囊未绑 verifyBadgeSrc')
;(updates.match(/item\.verifyBadgeSrc/g) || []).length >= 2 ? ok('事件更新折叠+列表作者条都有标') : bad('事件更新作者条缺标')
;(detail.match(/verifyBadgeSrc/g) || []).length >= 2 ? ok('详情列表+单条作者条都有标') : bad('详情作者条缺标')
briefing.includes('item.verifyBadgeSrc') ? ok('晨间简报胶囊有标') : bad('简报胶囊缺标')
briefingJs.includes('verifyBadgeSrc: item.verifyBadgeSrc || verifyBadgeSrc(badge)') || briefingJs.includes('verifyBadgeSrc(badge)')
  ? ok('简报映射透传/兜底 src')
  : bad('简报映射丢掉 src')
briefingJs.includes('_briefing_tweet_stats_cache_v2') ? ok('简报缓存已换键，避免旧数据挡住标') : bad('简报仍用旧缓存键')

const carouselJs = read('subpackages/index-extra/utils/index-carousel.js')
const carouselWxml = read('subpackages/index-extra/components/index-carousel/index.wxml')
carouselJs.includes('_tweet_accounts_cache_v2') ? ok('首页轮播账号缓存已换键') : bad('轮播仍用无认证标的旧缓存')
carouselJs.includes('accountVerifyBadgeSrc') ? ok('轮播 enrich 写入认证标') : bad('轮播未写认证标')
carouselWxml.includes('accountVerifyBadgeSrc') ? ok('首页轮播账号胶囊展示认证标') : bad('首页轮播胶囊未绑认证标')

console.log('== 归一化口径一致 ==')
const util = read('subpackages/progress-extra/utils/x-verify-badge.js')
function hasAliases(src, label) {
  const need = ["'grey'", "'gold'", "'blue'", 'government', 'business']
  const miss = need.filter((t) => !src.includes(t))
  if (miss.length) bad(label + ' 缺别名 ' + miss.join(','))
  else ok(label + ' 灰/蓝/金别名齐全')
}
hasAliases(util, '分包 helper')
hasAliases(udg, 'userDataGateway')
hasAliases(gw, 'adminGateway')

console.log('\n' + (fail ? '共 ' + fail + ' 项失败' : '全部通过'))
process.exit(fail ? 1 : 0)
