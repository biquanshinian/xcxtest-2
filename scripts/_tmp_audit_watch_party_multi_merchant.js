/**
 * 同任务多商家 + 云资源节约审计（须 0 问题 0 提示）
 * 运行：node scripts/_tmp_audit_watch_party_multi_merchant.js
 */
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
let issues = 0
let warns = 0
let passes = 0

function issue(msg) { issues++; console.log('  ✗ [问题] ' + msg) }
function warn(msg) { warns++; console.log('  ⚠ [提示] ' + msg) }
function pass(msg) { passes++; console.log('  ✓ ' + msg) }
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8') }
function section(t) { console.log('\n── ' + t + ' ──') }

section('页面与路由')
const app = JSON.parse(read('app.json'))
const sub = (app.subpackages || app.subPackages || []).find((s) => s.root === 'subpackages/watch-party')
if (!sub || !(sub.pages || []).includes('merchant-list')) issue('app.json 未注册 merchant-list')
else pass('app.json 已注册 merchant-list')
for (const ext of ['js', 'wxml', 'wxss', 'json']) {
  const f = path.join(ROOT, 'subpackages/watch-party/merchant-list.' + ext)
  if (!fs.existsSync(f)) issue('缺 merchant-list.' + ext)
  else pass('merchant-list.' + ext + ' 存在')
}
try {
  execSync('node --check "' + path.join(ROOT, 'subpackages/watch-party/merchant-list.js') + '"', { stdio: 'pipe' })
  pass('merchant-list.js 语法通过')
} catch (e) { issue('merchant-list.js 语法错误') }

section('入口一律进商家列表（不直达单场次）')
const detailJs = read('pages/mission-detail/mission-detail.js')
if (!/merchant-list\?missionId=/.test(detailJs)) issue('任务详情未跳转商家列表')
else pass('任务详情 → merchant-list')
if (/watch-party\?sessionId=/.test(detailJs) && /onWatchPartyTap[\s\S]{0,200}sessionId/.test(detailJs)) {
  issue('任务详情仍直达单场次 sessionId')
} else pass('任务详情不直达单场次')
const profile = read('pages/profile/profile.js')
if (!/merchant-list\?channel=profile/.test(profile)) issue('我的页未进商家列表')
else pass('我的 → merchant-list')
const ai = read('subpackages/shared/components/ai-chat/index.js')
if (!/merchant-list\?channel=ai/.test(ai)) issue('星问未进商家列表')
else pass('星问 → merchant-list')
if (/watch-party\?sessionId=/.test(ai) && /watch_party[\s\S]{0,200}sessionId/.test(ai)) {
  issue('星问观礼卡仍直达 sessionId')
} else pass('星问观礼卡不直达单场次')

section('详情标题商家名')
const wp = read('subpackages/watch-party/watch-party.js')
const wpx = read('subpackages/watch-party/watch-party.wxml')
if (!/merchant \+ '·火箭观礼'|merchantName[\s\S]{0,80}·火箭观礼/.test(wp)) {
  issue('详情页未拼商家名·火箭观礼')
} else pass('详情 JS 生成商家名标题')
if (!/\{\{navTitle\}\}/.test(wpx)) issue('详情 wxml 未绑定 navTitle')
else pass('详情 wxml 绑定 navTitle')

section('云资源：单次调用 / 缓存 / 轻量探测')
const cloud = read('cloudfunctions/adminGateway/watchParty.js')
const gw = read('cloudfunctions/adminGateway/index.js')
if (!/sessions\/public/.test(gw) || !/listPublicSessions/.test(cloud)) {
  issue('公开列表路由/实现缺失')
} else pass('公开列表 API 已注册')
if (!/_listCache/.test(cloud)) issue('listPublicSessions 无短缓存')
else pass('list 短缓存 _listCache')
if (!/missionSessionCount/.test(cloud)) issue('match 未回传 missionSessionCount')
else pass('match 回传 missionSessionCount')
if (!/publicSessionSummaryView/.test(cloud)) issue('缺 summary 轻量视图')
else pass('summary 轻量视图')

const aiRich = read('subpackages/shared/utils/ai-chat-rich.js')
if (/listWatchPartySessions/.test(aiRich)) {
  issue('星问入口卡仍二次调用 list（应只用 match.missionSessionCount）')
} else pass('星问入口卡无二次 list 调用')
if (!/missionSessionCount/.test(aiRich)) issue('星问未消费 missionSessionCount')
else pass('星问消费 missionSessionCount')

const entry = read('pages/mission-detail/utils/watch-party-entry.js')
if (!/summary:\s*1/.test(entry) && !/summary:\s*'1'/.test(entry)) {
  issue('任务详情入口探测未用 summary=1')
} else pass('入口探测 summary=1')
if (!/limit:\s*10/.test(entry)) issue('入口探测 limit 未收紧到 10')
else pass('入口探测 limit=10')

// list 页本身用完整列表（合理）
const listJs = read('subpackages/watch-party/merchant-list.js')
if (!/fetchPublicSessions/.test(listJs)) issue('商家列表页未调 fetchPublicSessions')
else pass('商家列表页调 fetchPublicSessions')

section('结果')
console.log(`通过 ${passes} · 问题 ${issues} · 提示 ${warns}`)
if (issues > 0 || warns > 0) process.exit(1)
