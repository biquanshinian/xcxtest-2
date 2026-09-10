/**
 * 观礼分包主题色审计：原生 input 字面色 + 浅色强调覆盖 + 语法检查
 * 运行：node scripts/_tmp_audit_watch_party_theme.js
 */
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const SUB = path.join(ROOT, 'subpackages', 'watch-party')
let issues = 0
let warns = 0

function issue(msg) { issues++; console.log('  ✗ [问题] ' + msg) }
function warn(msg) { warns++; console.log('  ⚠ [提示] ' + msg) }
function pass(msg) { console.log('  ✓ ' + msg) }
function read(rel) {
  return fs.readFileSync(path.isAbsolute(rel) ? rel : path.join(ROOT, rel), 'utf8')
}

const PAGES = [
  'watch-party', 'gacha', 'album', 'screen',
  'merchant', 'merchant-edit', 'merchant-list', 'merchant-reservations'
]
const INPUT_PAGES = ['watch-party', 'gacha', 'merchant', 'merchant-edit']

/** 浅色底上易糊的「深色主题浅色字」字面色 */
const PALE_ON_LIGHT = [
  '#93C5FD', '#60A5FA', '#E9D5FF', '#FDE68A', '#FBBF24', '#FCD34D',
  'rgba(255, 255, 255', 'rgba(255,255,255'
]

console.log('── 页面根节点挂 themeClass（screen 恒深色可豁免）──')
for (const p of PAGES) {
  const wxml = read(path.join(SUB, p + '.wxml'))
  if (p === 'screen') {
    if (/themeClass/.test(wxml)) warn('screen 挂了 themeClass（大屏通常恒深色）')
    else pass('screen 未挂 themeClass（恒深色）')
    continue
  }
  if (!/class="page \{\{themeClass\}\}"/.test(wxml) && !/class="page \{\{themeClass\}\}"/.test(wxml.replace(/\s+/g, ' '))) {
    if (!/\{\{themeClass\}\}/.test(wxml)) issue(p + '.wxml 根节点未挂 themeClass')
    else pass(p + '.wxml 已挂 themeClass')
  } else pass(p + '.wxml 已挂 themeClass')
}

console.log('── 原生 input/textarea：深色字面色 + 浅色覆盖 ──')
const inputClassMap = {
  'watch-party': { dark: ['.wp-form-input', '.wp-input'], light: ['.theme-light .wp-form-input', '.theme-light .wp-input'], ph: ['.theme-light .wp-form-ph', '.theme-light .wp-input-ph'] },
  gacha: { dark: ['.gc-code-input'], light: ['.theme-light .gc-code-input'], ph: ['.theme-light .gc-code-ph'] },
  merchant: { dark: ['.wpm-bind-input'], light: ['.theme-light .wpm-bind-input'], ph: ['.theme-light .wpm-ph'] },
  'merchant-edit': { dark: ['.wpe-form-input', '.wpe-textarea'], light: ['.theme-light .wpe-form-input', '.theme-light .wpe-textarea'], ph: ['.theme-light .wpe-ph'] }
}
for (const p of INPUT_PAGES) {
  const wxss = read(path.join(SUB, p + '.wxss'))
  const conf = inputClassMap[p]
  let ok = true
  for (const sel of conf.dark) {
    // 取选择器块内是否含字面色 #F5F5F7（避免聚焦时 var 失效）
    const re = new RegExp(sel.replace(/\./g, '\\.') + '\\s*\\{[^}]{0,400}color:\\s*#F5F5F7', 'i')
    if (!re.test(wxss)) {
      issue(p + '.wxss ' + sel + ' 缺深色字面色 #F5F5F7')
      ok = false
    }
  }
  for (const sel of conf.light) {
    const re = new RegExp(sel.replace(/\./g, '\\.') + '[^{]*\\{[^}]{0,500}color:\\s*#1C1C1E', 'i')
    // 允许写在组合选择器里
    if (!re.test(wxss) && !/theme-light[\s\S]{0,80}color:\s*#1C1C1E/.test(wxss)) {
      // 更宽松：只要 theme-light 块里覆盖了对应类
      const loose = wxss.includes(sel) || (sel.includes('wpe-form-input') && /theme-light[\s\S]{0,200}wpe-form-input[\s\S]{0,200}#1C1C1E/.test(wxss))
      if (!loose) {
        issue(p + '.wxss 缺浅色覆盖 ' + sel)
        ok = false
      }
    }
  }
  for (const sel of conf.ph) {
    if (!wxss.includes(sel.replace(/^\./, '')) && !wxss.includes(sel)) {
      // class name without leading .
      const name = sel.split(' ').pop().replace(/^\./, '')
      if (!wxss.includes(name)) {
        issue(p + '.wxss 缺浅色 placeholder 覆盖 ' + sel)
        ok = false
      }
    }
  }
  if (ok) pass(p + ' 原生输入双主题字面色到位')
}

console.log('── 商家操作按钮：发射成功绿 / 下一场蓝 / 不被通用蓝覆盖 ──')
const mwx = read(path.join(SUB, 'merchant.wxss'))
const mwxml = read(path.join(SUB, 'merchant.wxml'))
const launchIdx = mwx.indexOf('.theme-light .wpm-action-btn--launch')
const nextIdx = mwx.indexOf('.theme-light .wpm-action-btn--next')
const doneIdx = mwx.indexOf('.theme-light .wpm-action-btn--done')
const genericIdx = mwx.indexOf('.theme-light .wpm-action-btn {')
if (!/wpm-action-btn--launch/.test(mwxml)) issue('merchant.wxml 确认发射成功未用 --launch')
else pass('merchant.wxml 确认发射成功用 --launch')
if (!/wpm-action-btn--next/.test(mwxml)) issue('merchant.wxml 开启下一场未用 --next')
else pass('merchant.wxml 开启下一场用 --next')
if (!/\.wpm-action-btn--launch\s*\{[^}]*background:\s*#07C160/.test(mwx)) {
  issue('merchant --launch 缺微信绿背景')
} else pass('merchant --launch 微信绿底')
if (!/\.wpm-action-btn--next\s*\{[^}]*background:\s*#3B82F6/.test(mwx)) {
  issue('merchant --next 缺蓝色背景')
} else pass('merchant --next 蓝底')
if (launchIdx < 0) issue('merchant 缺 theme-light .wpm-action-btn--launch')
else if (genericIdx >= 0 && launchIdx < genericIdx) issue('merchant launch 覆盖写在通用蓝之前')
else pass('merchant launch 浅色覆盖顺序正确')
if (nextIdx < 0) issue('merchant 缺 theme-light .wpm-action-btn--next')
else if (genericIdx >= 0 && nextIdx < genericIdx) issue('merchant next 覆盖写在通用蓝之前')
else pass('merchant next 浅色覆盖顺序正确')
if (doneIdx < 0) issue('merchant 缺 theme-light .wpm-action-btn--done')
else if (genericIdx >= 0 && doneIdx < genericIdx) issue('merchant done 覆盖写在通用蓝之前')
else pass('merchant done 浅色覆盖顺序正确')
if (!mwx.includes('.theme-light .wpm-session-ssr')) issue('merchant 缺 session-ssr 浅色覆盖')
else if (!/\.theme-light \.wpm-session-ssr\s*\{[^}]*#07C160/.test(mwx)) issue('merchant session-ssr 浅色未改微信绿')
else pass('merchant session-ssr 微信绿')
if (/#B45309|#FBBF24|#FCD34D/.test(mwx)) issue('merchant.wxss 仍残留咖啡色/琥珀强调')
else pass('merchant.wxss 无咖啡色残留')

console.log('── 浅色强调链（非大屏/非抽卡结果遮罩）──')
const accentChecks = [
  ['merchant-list', ['.theme-light .wpl-tag', '.theme-light .wpl-link']],
  ['merchant-reservations', ['.theme-light .wpr-phone', '.theme-light .wpr-act']],
  ['merchant-edit', ['.theme-light .wpe-loc-btn', '.theme-light .wpe-add-link', '.theme-light .wpe-prize-op']],
  ['gacha', ['.theme-light .gc-code-btn', '.theme-light .gc-share-btn', '.theme-light .gc-pass-title']],
  // 2026-08：落地页卡册链接/抽奖标题重构为奖品入口组（wp-entry-*，文字走 tokens 自动翻转）
  ['watch-party', ['.theme-light .wp-hero-title', '.theme-light .wp-entry-card']],
  // album 主题化表面：分档胶囊四档 + 网格分档描边全部要有浅色加深覆盖
  ['album', [
    '.theme-light .ab-rarity-pill--SSR', '.theme-light .ab-rarity-pill--SR',
    '.theme-light .ab-rarity-pill--R', '.theme-light .ab-rarity-pill--N',
    '.theme-light .ab-cell', '.theme-light .ab-cell--R',
    '.theme-light .ab-cell--SR', '.theme-light .ab-cell--SSR'
  ]]
]
for (const [p, sels] of accentChecks) {
  const wxss = read(path.join(SUB, p + '.wxss'))
  let ok = true
  for (const s of sels) {
    if (!wxss.includes(s)) {
      issue(p + ' 缺 ' + s)
      ok = false
    }
  }
  if (ok) pass(p + ' 浅色强调覆盖齐全')
}

console.log('── 共用奖品卡（styles/prize-card.wxss）恒深色约束 ──')
// 票券卡满身字面浅色（金/白），只允许出现在恒深色结果遮罩内；
// @import 文件不在上面的逐页扫描范围里，这里单独钉住两个前提：
//  1) 卡面样式不掺 tokens 变量（双主题渲染一致）
//  2) pcard 结构只出现在 gc-overlay / ab-overlay 之后（不上主题化表面）
const prizeCardPath = path.join(SUB, 'styles', 'prize-card.wxss')
if (!fs.existsSync(prizeCardPath)) {
  issue('缺 styles/prize-card.wxss（gacha/album 共用卡面）')
} else {
  const pcss = read(prizeCardPath)
  if (/var\(--/.test(pcss)) issue('prize-card.wxss 混入 tokens 变量（恒深色卡面应全字面色）')
  else pass('prize-card.wxss 全字面色（双主题渲染一致）')
  for (const [page, overlayCls] of [['gacha', 'gc-overlay'], ['album', 'ab-overlay']]) {
    const wxml = read(path.join(SUB, page + '.wxml'))
    const oIdx = wxml.indexOf(overlayCls)
    const pIdx = wxml.indexOf('pcard')
    if (pIdx < 0) {
      issue(page + '.wxml 未使用 pcard 卡面（应与共用样式配套）')
    } else if (oIdx < 0 || pIdx < oIdx) {
      issue(page + '.wxml pcard 出现在 ' + overlayCls + ' 之外（浅色主题会糊，禁止上主题化表面）')
    } else {
      pass(page + '.wxml pcard 仅在 ' + overlayCls + ' 深色遮罩内')
    }
    const wxss = read(path.join(SUB, page + '.wxss'))
    if (!/@import "styles\/prize-card\.wxss";/.test(wxss)) {
      issue(page + '.wxss 未引入共用卡面样式')
    }
  }
}

console.log('── 扫描：浅色页仍用浅色字（启发式，排除 overlay/scr）──')
for (const p of PAGES) {
  if (p === 'screen') continue
  const wxss = read(path.join(SUB, p + '.wxss'))
  // 去掉注释与 theme-light 块后，若仍大量 rgba(255,255,255 用于非 hero 可能有问题——仅提示
  const withoutLight = wxss.replace(/\.theme-light[\s\S]*?(?=\n\.[\w-]|\n\/\*|$)/g, '')
  // hero/merchant-card/overlay 允许白字
  const risky = []
  for (const pale of ['#93C5FD', '#E9D5FF', '#FDE68A']) {
    if (withoutLight.includes('color: ' + pale) || withoutLight.includes('color:' + pale)) {
      // 若存在对应 theme-light 覆盖则放过
      const hasLight = wxss.includes('theme-light') && (
        wxss.includes('#2563EB') || wxss.includes('#7C3AED') || wxss.includes('#B45309')
      )
      if (!hasLight) risky.push(pale)
    }
  }
  if (risky.length) warn(p + ' 仍有浅色强调字面色且未见浅色加深覆盖: ' + risky.join(', '))
  else pass(p + ' 浅色强调启发式通过')
}

console.log('── JS 语法 ──')
const jsFiles = []
for (const p of PAGES) jsFiles.push(path.join(SUB, p + '.js'))
for (const u of ['api.js', 'composer-input-behavior.js', 'material-poster.js']) {
  jsFiles.push(path.join(SUB, 'utils', u))
}
for (const f of jsFiles) {
  const name = path.relative(ROOT, f)
  try {
    execSync(`node --check "${f}"`, { stdio: 'pipe' })
    pass(name + ' 语法通过')
  } catch (e) {
    issue(name + ' 语法错误')
  }
}

console.log('')
if (issues === 0) {
  console.log('✅ 观礼主题色审计通过' + (warns ? `（${warns} 条提示）` : ''))
  process.exit(0)
}
console.log(`❌ 观礼主题色审计失败：${issues} 问题，${warns} 提示`)
process.exit(1)
