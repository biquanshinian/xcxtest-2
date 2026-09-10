/**
 * 观礼本轮审计：抽奖双门槛 + 导航微信绿 + 分享标题去重
 * 运行：node scripts/_tmp_audit_watch_party_gate_share.js
 */
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const ROOT = path.resolve(__dirname, '..')
let issues = 0
let warns = 0
let passes = 0

function issue(msg) { issues++; console.log('  ✗ [问题] ' + msg) }
function warn(msg) { warns++; console.log('  ⚠ [提示] ' + msg) }
function pass(msg) { passes++; console.log('  ✓ ' + msg) }
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8') }
function section(t) { console.log('\n── ' + t + ' ──') }

section('云端：扫码资格 + 发射成功双门槛')
const cloud = read('cloudfunctions/adminGateway/watchParty.js')
if (!/function isMaterialQuota\s*\(/.test(cloud)) issue('缺 isMaterialQuota')
else pass('isMaterialQuota 存在')
if (!/const fromMaterial = !!String\(body\.code/.test(cloud)) issue('scanCheckIn 未按 code 判定现场扫码')
else pass('scanCheckIn 仅 code 发现场资格')
if (!/successUnlocked:\s*!!session\.successUnlockedAt/.test(cloud)) issue('scanCheckIn 未回传 successUnlocked')
else pass('scanCheckIn 回传 successUnlocked')
if (!/4032/.test(cloud) || !/请等待商家确认发射成功后再抽奖/.test(cloud)) {
  issue('draw 缺 4032 / 发射成功文案')
} else pass('draw 校验 successUnlockedAt（4032）')
if (!/if \(!isMaterialQuota\(quota\)\) return fail\(4011/.test(cloud)) {
  issue('draw 未校验物料资格 4011')
} else pass('draw 校验物料资格（4011）')
if (!/if \(!isMaterialQuota\(q\)\) throw/.test(cloud)) issue('draw 事务内未再校验物料资格')
else pass('draw 事务内二次校验物料资格')
if (!/if \(!sess\.successUnlockedAt\) throw/.test(cloud)) issue('draw 事务内未再校验发射成功')
else pass('draw 事务内二次校验发射成功')
if (!/if \(!isMaterialQuota\(q0\)\) return fail\(4011/.test(cloud)) {
  issue('shareBonus 未要求现场资格')
} else pass('shareBonus 要求现场资格')
if (!/merchantUnlockSessionSuccess/.test(cloud)) issue('缺 merchantUnlockSessionSuccess')
else pass('merchantUnlockSessionSuccess 存在')
if (!/prizeDrawEnabled !== true[\s\S]{0,80}开启现场奖品抽奖/.test(cloud)) {
  warn('解锁成功前未强制已开抽奖（请人工确认）')
} else pass('确认发射成功前须已开抽奖')
if (/successOnly/.test(cloud)) pass('云端保留 successOnly 仅作历史发放兼容（非抽奖路径）')
else pass('无 successOnly 旧抽卡字段')

section('用户端：入口不绕过扫码')
const wpjs = read('subpackages/watch-party/watch-party.js')
const album = read('subpackages/watch-party/album.js')
const gacha = read('subpackages/watch-party/gacha.js')
const gw = read('subpackages/watch-party/gacha.wxml')
if (/gacha\?[^'"\n]*channel=app/.test(wpjs) || /gacha\?[^'"\n]*channel=app/.test(album)) {
  issue('落地页/卡册仍有 channel=app 直进抽奖')
} else pass('落地页/卡册无 channel=app 直进')
if (!/现场物料码/.test(wpjs) || !/现场物料码/.test(album)) {
  issue('落地页/卡册未引导扫物料码')
} else pass('落地页/卡册引导扫物料码')
if (!/fromMaterial/.test(gacha) || !/successUnlocked/.test(gacha)) {
  issue('gacha.js 缺双门槛状态')
} else pass('gacha.js 含 fromMaterial / successUnlocked')
if (!/!fromMaterial/.test(gw) || !/!successUnlocked/.test(gw)) {
  issue('gacha.wxml 缺门槛提示')
} else pass('gacha.wxml 门槛提示齐全')
if (!/prizeDrawEnabled && fromMaterial && successUnlocked/.test(gw)) {
  issue('抽奖台未要求双门槛同时满足')
} else pass('抽奖台需扫码+发射成功')
if (/sessionId=.*channel=app/.test(gacha)) issue('gacha 仍写 channel=app 发次数')
else pass('gacha 无 app 渠道发次数逻辑')

section('商家端：确认发射成功 / 开启下一场')
const mw = read('subpackages/watch-party/merchant.wxml')
const mjs = read('subpackages/watch-party/merchant.js')
const mew = read('subpackages/watch-party/merchant-edit.wxml')
if (!/确认发射成功/.test(mw)) issue('商家场次列表缺确认发射成功按钮')
else pass('商家列表有确认发射成功')
if (!/merchantUnlockSessionSuccess/.test(mjs)) issue('merchant.js 未调解锁接口')
else pass('merchant.js 调解锁接口')
if (!/开启下一场/.test(mw) || !/merchantStartNextCycle/.test(mjs)) {
  issue('商家端缺开启下一场（周期分账）')
} else pass('商家端开启下一场已接通')
if (!/扫现场物料码/.test(mew) && !/确认发射成功/.test(mew)) {
  issue('商家编辑页未说明双门槛')
} else pass('商家编辑页说明双门槛')

section('大屏 / 后台：横幅与状态')
const scrW = read('subpackages/watch-party/screen.wxml')
const scrJ = read('subpackages/watch-party/screen.js')
const html = read('admin-web/public/watch-screen.html')
const vue = read('admin-web/src/views/WatchPartyPage.vue')
if (!/prizeDrawEnabled && successUnlocked/.test(scrW)) issue('小程序大屏横幅未要求 successUnlocked')
else pass('小程序大屏横幅需发射成功')
if (!/successUnlocked:\s*!!\(s\.successUnlocked/.test(scrJ)) issue('screen.js 未写 successUnlocked')
else pass('screen.js 写入 successUnlocked')
if (!/prizeDrawEnabled && s\.successUnlocked/.test(html)) issue('HTML 大屏横幅未要求 successUnlocked')
else pass('HTML 大屏横幅需发射成功')
if (/解锁 SSR/.test(html)) issue('HTML 大屏仍写 SSR 旧文案')
else pass('HTML 大屏无 SSR 旧文案')
if (!/待确认发射成功|已确认发射成功/.test(vue)) issue('后台详情未展示发射成功状态')
else pass('后台详情展示发射成功状态')

section('导航按钮：微信绿白字')
const wpx = read('subpackages/watch-party/watch-party.wxss')
const wpw = read('subpackages/watch-party/watch-party.wxml')
const locBtn = wpx.match(/\.wp-loc-btn\s*\{[\s\S]*?\}/)
if (!locBtn || !/#07C160/.test(locBtn[0])) issue('.wp-loc-btn 非微信绿')
else pass('.wp-loc-btn 微信绿 #07C160')
if (!/\.wp-loc-btn text\s*\{[\s\S]*?color:\s*#fff/.test(wpx)) issue('.wp-loc-btn text 未强制白字')
else pass('.wp-loc-btn text 白字')
const parkingNav = wpw.match(/停车[\s\S]{0,280}wp-loc-btn[^>]*>[\s\S]*?导航/)
if (!parkingNav) issue('停车导航按钮结构未找到')
else if (/wp-loc-btn--ghost/.test(parkingNav[0])) issue('停车导航仍是 ghost（应为实心绿）')
else pass('停车导航用实心绿按钮')
if ((wpx.match(/\.theme-light \.wp-loc-btn\s*\{/g) || []).length > 1) {
  issue('theme-light .wp-loc-btn 样式块重复')
} else pass('theme-light 导航样式无重复块')

section('分享标题去重（观礼）')
const buildMatch = wpjs.match(/function buildWatchPartyShareTitle[\s\S]*?\n\}/)
if (!buildMatch) {
  issue('缺 buildWatchPartyShareTitle')
} else {
  pass('buildWatchPartyShareTitle 存在')
  const sandbox = { module: {}, exports: {} }
  vm.runInNewContext(buildMatch[0], sandbox)
  const fn = sandbox.buildWatchPartyShareTitle
  const cases = [
    [{ title: '长征八号发射观礼', rocketName: '长征八号' }, '长征八号发射观礼'],
    [{ title: '文昌楼顶', rocketName: '长征五号' }, '长征五号发射观礼 · 文昌楼顶'],
    [{ title: '', rocketName: '猎鹰9' }, '猎鹰9发射观礼'],
    [{ title: '猎鹰9发射观礼', rocketName: '猎鹰9' }, '猎鹰9发射观礼']
  ]
  let ok = true
  for (const [s, exp] of cases) {
    const got = fn(s)
    if (got !== exp) {
      issue(`分享标题用例失败: ${JSON.stringify(s)} => ${got}（期望 ${exp}）`)
      ok = false
    }
  }
  if (ok) pass('分享标题用例 4/4 通过')
  const friend = fn({ title: '长征八号发射观礼', rocketName: '长征八号' }, { withDistance: true })
  if (/发射观礼 · 长征八号发射观礼/.test(friend)) issue('好友分享标题仍重复场次名')
  else pass('好友分享标题无场次名重复')
}
if (/\$\{s\.rocketName[^}]*\}发射观礼 · \$\{s\.title\}/.test(wpjs)) {
  issue('仍残留旧拼接模板「火箭发射观礼 · title」')
} else pass('无旧重复拼接模板')

section('其它分享后缀扫描')
const api = read('subpackages/watch-party/utils/api.js')
if (/fetchMerchantCards/.test(api)) issue('api.js 仍导出 fetchMerchantCards')
else pass('已移除 fetchMerchantCards')
const imn = read('utils/index-mission-nav.js')
if (/火星探索日志'\s*\+\s*titleSuffix/.test(imn) || /"火星探索日志"\s*\+\s*titleSuffix/.test(imn)) {
  issue('index-mission-nav 仍会拼出「火星探索日志 | 火星探索日志」')
} else pass('index-mission-nav 无品牌双重后缀')

const shareFiles = []
function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name)
    const st = fs.statSync(p)
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === 'dist' || name === '.git') continue
      walk(p)
    } else if (/\.js$/.test(name)) shareFiles.push(p)
  }
}
;['pages', 'subpackages', 'utils'].forEach((d) => walk(path.join(ROOT, d)))

const dupBrand = []
const autoPrefixDup = []
for (const abs of shareFiles) {
  const src = fs.readFileSync(abs, 'utf8')
  if (!/onShare(AppMessage|Timeline)/.test(src)) continue
  const rel = path.relative(ROOT, abs).replace(/\\/g, '/')
  if (/火星探索日志'\s*\+\s*('|")\s*\|\s*火星探索日志|火星探索日志\s*\+\s*titleSuffix/.test(src)) {
    dupBrand.push(rel)
  }
  // 观礼类：火箭名发射观礼 · title（旧模板）
  if (/发射观礼 · \$\{/.test(src) && rel.includes('watch-party')) {
    autoPrefixDup.push(rel)
  }
}
if (dupBrand.length) issue('品牌双重后缀残留: ' + dupBrand.join(', '))
else pass('全量分享页无「品牌+品牌后缀」拼接')
if (autoPrefixDup.length) issue('观礼分享旧重复模板残留: ' + autoPrefixDup.join(', '))
else pass('观礼分享无旧重复模板')

// 提示：朋友圈 UI 会再显示小程序名；代码里主动加「| 火星探索日志」属 intentional
const brandSuffixPages = shareFiles.filter((abs) => {
  const src = fs.readFileSync(abs, 'utf8')
  return /onShareTimeline/.test(src) && /\|\s*火星探索日志/.test(src)
}).length
pass(`另有 ${brandSuffixPages} 个文件在分享标题主动带「| 火星探索日志」（朋友圈下方还会显示小程序名，属产品选择非代码重复）`)

section('结果')
console.log(`通过 ${passes} · 问题 ${issues} · 提示 ${warns}`)
if (issues > 0) process.exit(1)
