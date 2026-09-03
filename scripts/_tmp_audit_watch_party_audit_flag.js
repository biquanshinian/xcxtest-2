/**
 * 火箭观礼过审开关 enableWatchParty 严密性审计
 * 运行：node scripts/_tmp_audit_watch_party_audit_flag.js
 */
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const ROOT = path.resolve(__dirname, '..')
let issues = 0

function issue(msg) { issues++; console.log('  ✗ [问题] ' + msg) }
function pass(msg) { console.log('  ✓ ' + msg) }
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8') }

console.log('── 后台 GlobalConfig ──')
const gvue = read('admin-web/src/views/GlobalConfigPage.vue')
if (!gvue.includes("field: 'enableWatchParty'")) issue('功能开关列表缺 enableWatchParty')
else pass('功能开关含火箭观礼')
if (!/AUDIT_FIELDS\s*=\s*\[[\s\S]*?'enableWatchParty'/.test(gvue)) issue('AUDIT_FIELDS 未含 enableWatchParty')
else pass('一键过审含 enableWatchParty')
if (!gvue.includes('enableWatchParty: data.enableWatchParty !== false')) issue('load 语义应为 !== false')
else pass('load 语义 !== false')
if (!gvue.includes('form.enableWatchParty = true')) issue('退出过审未恢复 enableWatchParty=true')
else pass('退出过审恢复开启')
if (!gvue.includes('火箭观礼')) issue('AUDIT_LABEL 未提火箭观礼')
else pass('AUDIT_LABEL 含火箭观礼')

console.log('── 客户端 feature 模块 ──')
const feat = read('utils/watch-party-feature.js')
if (!feat.includes("failClosed: true")) issue('缺 failClosed')
else pass('failClosed')
if (!feat.includes('guardWatchPartyPage')) issue('缺页面门控')
else pass('guardWatchPartyPage')
if (!feat.includes('fetchMainConfig(true)')) issue('入口未强制刷新缓存')
else pass('forceRefresh 入口')
try {
  new vm.Script(feat, { filename: 'watch-party-feature.js' })
  pass('watch-party-feature.js 语法 OK')
} catch (e) {
  issue('watch-party-feature.js 语法: ' + e.message)
}

console.log('── 入口隐藏 ──')
const pw = read('pages/profile/profile.wxml')
if (!pw.includes('wx:if="{{enableWatchParty}}"')) issue('我的页入口未受开关控制')
else pass('我的页 wx:if enableWatchParty')
const pj = read('pages/profile/profile.js')
if (!pj.includes('_refreshWatchPartyEntryFlag') || !pj.includes('enableWatchParty: false')) {
  issue('profile.js 未默认隐藏 / 未刷新开关')
} else pass('profile 默认隐藏 + 刷新')
const entry = read('pages/mission-detail/utils/watch-party-entry.js')
if (!entry.includes('isWatchPartyEnabled(true)')) issue('详情入口探测未查开关')
else pass('详情入口探测查开关')
const md = read('pages/mission-detail/mission-detail.js')
if (!md.includes('watch-party-feature.js')) issue('详情点击未复核开关')
else pass('详情点击复核开关')

console.log('── 星问 ──')
const rich = read('subpackages/shared/utils/ai-chat-rich.js')
if (!rich.includes('featureOff: true') || !rich.includes('isWatchPartyEnabled')) {
  issue('星问入口卡未拦过审开关')
} else pass('resolveWatchPartyEntryCard 过审闸')
const core = read('subpackages/shared/utils/ai-chat-rich-core.js')
if (!core.includes('enrichLaunchContextWatchPartyFeatureOff')) issue('缺 featureOff 话术')
else pass('featureOff 话术（不引导我的入口）')
const chat = read('subpackages/shared/components/ai-chat/index.js')
if ((chat.match(/isWatchPartyEnabled/g) || []).length < 3) issue('星问点击跳转/快捷键未全量门控')
else pass('星问 viewing_spot / watch_party 点击门控')
// 输入栏上方「火箭观礼」快捷键：默认过滤 + 开关刷新
const svcQ = read('subpackages/shared/utils/aiService.js')
if (!/id:\s*'watch_party'[^\n]*requireWatchParty:\s*true/.test(svcQ)) {
  issue('QUICK_SHORTCUTS 火箭观礼项缺 requireWatchParty 标记')
} else pass('QUICK_SHORTCUTS 火箭观礼带 requireWatchParty')
if (!chat.includes('filterQuickShortcuts(false)') || !chat.includes('_refreshQuickShortcuts')) {
  issue('ai-chat 快捷键未默认隐藏观礼项 / 未按开关刷新')
} else pass('快捷键默认隐藏 + 开关刷新')

console.log('── 分包页 guard ──')
const pages = [
  'watch-party.js', 'merchant-list.js', 'gacha.js', 'album.js',
  'merchant.js', 'merchant-edit.js', 'screen.js', 'merchant-reservations.js'
]
pages.forEach((f) => {
  const code = read('subpackages/watch-party/' + f)
  if (!code.includes('guardWatchPartyPage')) issue(f + ' 缺 guardWatchPartyPage')
  else pass(f + ' 有页面门控')
  try {
    new vm.Script(code, { filename: f })
    pass(f + ' 语法 OK')
  } catch (e) {
    issue(f + ' 语法: ' + e.message)
  }
})

console.log('── 云端双闸 ──')
const cloud = read('cloudfunctions/adminGateway/watchParty.js')
if (!cloud.includes('isMainWatchPartyEnabled') || !cloud.includes('enableWatchParty')) {
  issue('云端未读 main.enableWatchParty')
} else pass('云端 isMainWatchPartyEnabled')
if (!cloud.includes("cfg.enableWatchParty !== false")) issue('云端缺省语义不对')
else pass('云端 !== false（缺省开）')
// serviceGate 应先查 main
const sg = cloud.indexOf('async function serviceGate')
const sgChunk = cloud.slice(sg, sg + 500)
if (!sgChunk.includes('isMainWatchPartyEnabled')) issue('serviceGate 未叠加过审闸')
else pass('serviceGate 双闸')
;['merchantBind', 'merchantMe', 'merchantUpdateSession', 'merchantCreateSession'].forEach((fn) => {
  const i = cloud.indexOf('async function ' + fn)
  if (i < 0) { issue('缺 ' + fn); return }
  const chunk = cloud.slice(i, i + 350)
  if (!chunk.includes('serviceGate')) issue(fn + ' 未走 serviceGate')
  else pass(fn + ' 走 serviceGate')
})

console.log('\n══ 结果 ══')
if (issues === 0) {
  console.log('全亮绿灯')
  process.exit(0)
}
console.log('问题数: ' + issues)
process.exit(1)
