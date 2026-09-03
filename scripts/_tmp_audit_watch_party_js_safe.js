/**
 * 观礼前端 JS 报错风险扫描（对齐仓库惯例：_safeSetData / 震动容错 / 空值安全）
 * 运行：node scripts/_tmp_audit_watch_party_js_safe.js
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const SUB = path.join(ROOT, 'subpackages', 'watch-party')
let issues = 0
let warns = 0

function issue(m) { issues++; console.log('  ✗ [问题] ' + m) }
function warn(m) { warns++; console.log('  ⚠ [提示] ' + m) }
function pass(m) { console.log('  ✓ ' + m) }

const pages = ['watch-party', 'merchant-list', 'gacha', 'album', 'screen', 'merchant', 'merchant-edit', 'merchant-reservations']

console.log('── 异步 setData 卸载保护 ──')
for (const p of pages) {
  const src = fs.readFileSync(path.join(SUB, p + '.js'), 'utf8')
  if (!src.includes('_unloaded') || !src.includes('_safeSetData')) {
    issue(p + '.js 缺少 _unloaded / _safeSetData')
    continue
  }
  // 仅抓「回调开头立刻裸 setData」；避免 fail:()=>{} / 跨方法误伤
  const badPatterns = [
    /\.then\(\s*\([^)]*\)\s*=>\s*\{\s*this\.setData\(/,
    /\.then\(\s*function\s*\([^)]*\)\s*\{\s*this\.setData\(/,
    /success\s*:\s*\([^)]*\)\s*=>\s*\{\s*this\.setData\(/,
    /success\s*:\s*\([^)]*\)\s*=>\s*\{\s*if\s*\([^)]*\)\s*return\s*\n\s*this\.setData\(/
  ]
  let hit = 0
  for (const re of badPatterns) {
    if (re.test(src)) hit++
  }
  if (hit) issue(p + '.js 有异步回调开头裸 setData（须改 _safeSetData）')
  else pass(p + '.js 异步 setData 保护基本到位')
}

console.log('── wx.vibrateShort 容错 ──')
for (const p of pages) {
  const src = fs.readFileSync(path.join(SUB, p + '.js'), 'utf8')
  if (!src.includes('wx.vibrateShort')) continue
  if (/wx\.vibrateShort\([^)]*fail\s*:/.test(src) || /try\s*\{[\s\S]{0,120}wx\.vibrateShort/.test(src)) {
    pass(p + '.js vibrateShort 有容错')
  } else {
    issue(p + '.js vibrateShort 无 try/fail')
  }
}

console.log('── WXML 危险空链 ──')
for (const p of pages) {
  const wxml = fs.readFileSync(path.join(SUB, p + '.wxml'), 'utf8')
  // item.stats.xxx 无兜底
  if (/item\.stats\.\w+(?!\s*\|\|)/.test(wxml) && !/stats:\s*s\.stats\s*\|\|/.test(fs.readFileSync(path.join(SUB, p + '.js'), 'utf8'))) {
    // only merchant has stats
  }
  if (p === 'merchant') {
    const js = fs.readFileSync(path.join(SUB, p + '.js'), 'utf8')
    if (!js.includes('stats: s.stats ||')) issue('merchant.js 场次 stats 无空对象兜底')
    else pass('merchant.js stats 空对象兜底')
  }
}

console.log('── chooseLocation / chooseMedia 容错 ──')
const me = fs.readFileSync(path.join(SUB, 'merchant-edit.js'), 'utf8')
if (!/typeof\s+wx\.chooseLocation\s*!==\s*['"]function['"]|!wx\.chooseLocation/.test(me) && me.includes('wx.chooseLocation')) {
  warn('merchant-edit chooseLocation 未做 API 存在性检查（极旧基础库）')
} else pass('chooseLocation API 检查或可接受')
if (me.includes('wx.chooseMedia') && !me.includes('chooseMedia') /* always true */) {
  // check fail handler on chooseMedia
}
if (/wx\.chooseMedia\(\{[\s\S]*?success:[\s\S]*?\}\)/.test(me) && !/wx\.chooseMedia\(\{[\s\S]*?fail\s*:/.test(me)) {
  warn('merchant-edit chooseMedia 无 fail 回调')
} else pass('chooseMedia fail 已处理或无需')

console.log('── hideLoading 容错 ──')
if (/wx\.hideLoading\(\)/.test(me) && !/try\s*\{[\s\S]{0,40}wx\.hideLoading/.test(me)) {
  warn('merchant-edit hideLoading 无 try（页面已销毁时可能打 WARN）')
} else pass('hideLoading 有容错')

console.log('\n结果：' + issues + ' 问题 / ' + warns + ' 提示')
process.exit(issues || warns ? 1 : 0)
