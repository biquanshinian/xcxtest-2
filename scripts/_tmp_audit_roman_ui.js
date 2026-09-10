/**
 * 罗曼太空望远镜 — 本轮改动审计
 * node scripts/_tmp_audit_roman_ui.js
 *
 * 覆盖：标题反色、Adopt a Pixel 入口、紫色闭环、残留品牌蓝、
 *       事件/门控、class 闭环、wxss 括号。
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const results = []

function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail || '' })
  console.log(`  ${ok ? 'OK ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`)
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n')
}

function braceBalance(src) {
  let n = 0
  for (const ch of src) {
    if (ch === '{') n++
    if (ch === '}') n--
    if (n < 0) return false
  }
  return n === 0
}

const cardWxml = read('subpackages/monitor-pages/components/monitor-roman-card/index.wxml')
const cardWxss = read('subpackages/monitor-pages/components/monitor-roman-card/index.wxss')
const cardJs = read('subpackages/monitor-pages/components/monitor-roman-card/index.js')
const pageWxml = read('subpackages/monitor-pages/roman-detail.wxml')
const pageWxss = read('subpackages/monitor-pages/roman-detail.wxss')
const pageJs = read('subpackages/monitor-pages/roman-detail.js')
const tracker = read('subpackages/monitor-pages/utils/roman-tracker.js')
const cfg = read('utils/config.js')
const monitorWxml = read('pages/monitor/monitor.wxml')
const nasaWxml = read('pages/nasa-data/nasa-data.wxml')
const agencyWxml = read('subpackages/monitor-pages/agency-detail.wxml')

const BRAND_BLUE_RE = /#2563EB|#7DD3FC|#0284C7|125,\s*211,\s*252/
const NEON_PURPLE_RE = /#6B21A8|#A855F7|#E879F9|#7C3AED|#07060d|#F5F3FF/
const ROMAN_PURPLE_RE = /#6A3D9A|#B57AC9/

console.log('\n[1] 标题反色')
check(
  '卡片根节点挂 themeClass',
  /roman-card-root monitor-block \{\{themeClass\}\}/.test(cardWxml)
)
check(
  '卡片标题用主题文字色',
  /\.roman-card-root \.roman-card-title[\s\S]{0,80}--color-text-primary/.test(cardWxss)
)
check(
  '浅色标题选择器挂在组件根上',
  /\.theme-light\.roman-card-root \.roman-card-title/.test(cardWxss)
)
check(
  '切主题会刷新 themeClass',
  /onThemeChange/.test(cardJs) && /_syncTheme/.test(cardJs) && /offThemeChange/.test(cardJs)
)
check(
  '详情页浅色覆盖存在',
  /\.detail-page\.theme-light/.test(pageWxss) && /\.theme-light \.roman-hero-name/.test(pageWxss)
)

console.log('\n[2] Adopt a Pixel 入口')
check(
  '配置指向 NASA 认领页',
  /adoptPixelUrl:[\s\S]*roman-space-telescope\/adopt-a-pixel/.test(cfg)
)
check(
  'tracker 复制官方链，不自造像素',
  /function getAdoptPixelUrl/.test(tracker) &&
    /function copyAdoptPixelLink/.test(tracker) &&
    /setClipboardData/.test(tracker)
)
check(
  '卡片认领用 catchtap，不冒泡进详情',
  /catchtap="openAdoptPixel"/.test(cardWxml)
)
const adoptFn = cardJs.match(/openAdoptPixel\(\)[\s\S]*?,\s*async openDetail/)
check(
  '卡片认领不走会员门控',
  !!(adoptFn && /copyAdoptPixelLink/.test(adoptFn[0]) && !/gateCheck/.test(adoptFn[0]))
)
check(
  '详情认领入口存在',
  /roman-adopt-card/.test(pageWxml) && /openAdoptPixel\(\)[\s\S]{0,80}copyAdoptPixelLink/.test(pageJs)
)
check(
  '监控 / NASA / 发射商都复用卡片',
  /monitor-roman-card/.test(monitorWxml) &&
    /monitor-roman-card/.test(nasaWxml) &&
    /monitor-roman-card/.test(agencyWxml)
)

console.log('\n[3] 罗曼紫闭环 / 残留蓝')
check('卡片含证书罗曼紫', ROMAN_PURPLE_RE.test(cardWxss))
check('详情含罗曼紫变量', /--roman-accent:\s*#B57AC9/.test(pageWxss))
check('详情浅色紫变量', /\.detail-page\.theme-light[\s\S]{0,220}--roman-accent:\s*#6A3D9A/.test(pageWxss))
check('详情页无残留品牌蓝', !BRAND_BLUE_RE.test(pageWxss), BRAND_BLUE_RE.test(pageWxss) ? '仍有蓝' : '')
check(
  '卡片只把罗曼轨道改紫',
  /\.roman-viz__cruise[\s\S]{0,160}181,\s*122,\s*201/.test(cardWxss) &&
    /\.roman-viz__earth[\s\S]{0,360}#60A5FA/.test(cardWxss) &&
    /\.roman-viz__l2[\s\S]{0,360}#FFD60A/.test(cardWxss) &&
    /roman-viz__craft/.test(cardWxml)
)
check(
  '卡片重试钮无残留蓝',
  !/roman-hero__retry[\s\S]{0,180}59,\s*130,\s*246/.test(cardWxss),
  /roman-hero__retry[\s\S]{0,180}59,\s*130,\s*246/.test(cardWxss) ? 'retry 仍是品牌蓝' : ''
)
check('未回潮整页霓虹紫', !NEON_PURPLE_RE.test(cardWxss) && !NEON_PURPLE_RE.test(pageWxss))
check(
  '进度条地球蓝 / 罗曼紫 / L2 金',
  /#3B82F6 0%, #6A3D9A 48%, #FFD60A/.test(cardWxss) &&
    /#3B82F6 0%, #6A3D9A 48%, #FFD60A/.test(pageWxss)
)
check('认领按钮用证书紫实底', /\.roman-adopt[\s\S]{0,280}#6A3D9A/.test(cardWxss))

console.log('\n[4] class / 事件闭环')
const cardClasses = new Set()
;(cardWxml.match(/class="([^"]*)"/g) || []).forEach((a) => {
  a.replace(/class="|"/g, '')
    .replace(/\{\{[^}]*\}\}/g, ' ')
    .split(/\s+/)
    .filter((c) => c && c.startsWith('roman-'))
    .forEach((c) => cardClasses.add(c))
})
const missingCard = [...cardClasses].filter((c) => !cardWxss.includes('.' + c))
check('卡片 roman-* class 都有样式', missingCard.length === 0, missingCard.join(', '))

const pageClasses = new Set()
;(pageWxml.match(/class="([^"]*)"/g) || []).forEach((a) => {
  a.replace(/class="|"/g, '')
    .replace(/\{\{[^}]*\}\}/g, ' ')
    .split(/\s+/)
    .filter((c) => c && c.startsWith('roman-'))
    .forEach((c) => pageClasses.add(c))
})
const missingPage = [...pageClasses].filter((c) => !pageWxss.includes('.' + c))
check('详情 roman-* class 都有样式', missingPage.length === 0, missingPage.join(', '))

const cardTaps = [...cardWxml.matchAll(/(?:bind|catch)tap="(\w+)"/g)].map((m) => m[1])
const missingTap = cardTaps.filter((fn) => !new RegExp(fn + '\\s*\\(').test(cardJs))
check('卡片 tap 都有方法', missingTap.length === 0, missingTap.join(', '))

const pageTaps = [...pageWxml.matchAll(/(?:bind|catch)tap="(\w+)"/g)].map((m) => m[1])
const inherited = new Set(['goBack'])
const missingPageTap = pageTaps.filter((fn) => !inherited.has(fn) && !new RegExp(fn + '\\s*\\(').test(pageJs))
check('详情 tap 都有方法', missingPageTap.length === 0, missingPageTap.join(', '))

console.log('\n[5] wxss 括号')
check('卡片 wxss 括号平衡', braceBalance(cardWxss))
check('详情 wxss 括号平衡', braceBalance(pageWxss))

const fail = results.filter((r) => !r.ok)
const warn = results.filter((r) => r.ok && r.detail)
console.log('\n── 汇总 ──')
console.log(`OK ${results.filter((r) => r.ok).length} / ${results.length}，FAIL ${fail.length}`)
if (fail.length) {
  fail.forEach((r) => console.log('  FAIL  ' + r.name + (r.detail ? ' — ' + r.detail : '')))
  process.exitCode = 1
}
if (warn.length) {
  console.log('备注：')
  warn.forEach((r) => console.log('  · ' + r.name + ' — ' + r.detail))
}
