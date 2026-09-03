/**
 * 观礼详情页火箭配置图：对齐即将发射卡片左侧 cover 居中撑满
 * 运行：node scripts/_tmp_audit_watch_party_rocket_cover.js
 */
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const ROOT = path.resolve(__dirname, '..')
let issues = 0

function issue(msg) { issues++; console.log('  ✗ [问题] ' + msg) }
function pass(msg) { console.log('  ✓ ' + msg) }
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8') }

console.log('── 即将发射卡片（参照实现）──')
const idxWxml = read('pages/index/index.wxml')
const idxWxss = read('pages/index/index.wxss')
const cardWxss = read('styles/mission-card.wxss')
if (!/class="mission-rocket-image"[\s\S]*?mode="aspectFill"/.test(idxWxml)
  && !/mode="aspectFill"[\s\S]*?class="mission-rocket-image"/.test(idxWxml)) {
  // 组件写法：src 与 mode 同行
  if (!idxWxml.includes('class="mission-rocket-image"') || !idxWxml.includes('mode="aspectFill"')) {
    issue('首页即将发射卡片未使用 aspectFill')
  } else pass('首页即将发射卡片 mode=aspectFill')
} else pass('首页即将发射卡片 mode=aspectFill')
if (!cardWxss.includes('object-fit: cover') || !cardWxss.includes('object-position: center')) {
  issue('styles/mission-card 缺 cover/center')
} else pass('mission-card cover + center')
if (!idxWxss.includes('object-fit: cover')) issue('index.wxss 缺 object-fit:cover')
else pass('index.wxss object-fit:cover')

console.log('── 观礼详情页头卡配置图 ──')
const wpWxml = read('subpackages/watch-party/watch-party.wxml')
const wpWxss = read('subpackages/watch-party/watch-party.wxss')
const wpJs = read('subpackages/watch-party/watch-party.js')

const heroImgBlocks = wpWxml.match(/<image[^>]*class="wp-hero-rocket-img"[^>]*>/g) || []
if (!heroImgBlocks.length) issue('详情页缺 wp-hero-rocket-img')
else {
  heroImgBlocks.forEach((tag, i) => {
    if (!/mode="aspectFill"/.test(tag)) issue(`头卡配置图 #${i + 1} 未用 aspectFill: ${tag.slice(0, 80)}`)
    else pass(`头卡配置图 #${i + 1} mode=aspectFill`)
    if (/mode="aspectFit"/.test(tag)) issue(`头卡配置图 #${i + 1} 仍残留 aspectFit`)
  })
}

// 详情页不应再有火箭配置图走 aspectFit（排除二维码等非配置图）
const rocketFit = []
const imgRe = /<image\b[^>]*>/g
let m
while ((m = imgRe.exec(wpWxml))) {
  const tag = m[0]
  if (/wp-hero-rocket|rocketImage|rocket-img|配置图/.test(tag) && /mode="aspectFit"/.test(tag)) {
    rocketFit.push(tag)
  }
}
if (rocketFit.length) {
  rocketFit.forEach((t) => issue('详情页配置图仍用 aspectFit: ' + t.slice(0, 100)))
} else pass('详情页配置图无 aspectFit 残留')

const cssNeed = [
  ['.wp-hero-rocket', 'position: relative'],
  ['.wp-hero-rocket-img', 'position: absolute'],
  ['.wp-hero-rocket-img', 'object-fit: cover'],
  ['.wp-hero-rocket-img', 'object-position: center']
]
cssNeed.forEach(([sel, prop]) => {
  const idx = wpWxss.indexOf(sel)
  if (idx < 0) { issue(`wxss 缺选择器 ${sel}`); return }
  const chunk = wpWxss.slice(idx, idx + 280)
  if (!chunk.includes(prop)) issue(`${sel} 缺 ${prop}`)
  else pass(`${sel} 含 ${prop}`)
})

if (!wpJs.includes('rocketImage')) issue('watch-party.js 未绑定 rocketImage')
else pass('watch-party.js 绑定 rocketImage')

console.log('── JS 语法（watch-party 详情相关）──')
const jsFiles = [
  'subpackages/watch-party/watch-party.js',
  'subpackages/watch-party/utils/api.js',
  'subpackages/watch-party/merchant-list.js'
]
jsFiles.forEach((rel) => {
  try {
    const code = read(rel)
    // 小程序 CommonJS：包一层检测语法
    new vm.Script(code, { filename: rel })
    pass(rel + ' 语法 OK')
  } catch (e) {
    issue(rel + ' 语法错误: ' + (e && e.message))
  }
})

console.log('\n══ 结果 ══')
if (issues === 0) {
  console.log('全亮绿灯 · ' + jsFiles.length + ' 个 JS 无报错')
  process.exit(0)
}
console.log('问题数: ' + issues)
process.exit(1)
