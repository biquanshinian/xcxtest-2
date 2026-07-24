/**
 * 星问欢迎区节日帽审计
 * node scripts/_audit_ai_welcome_festival_hat.js
 */
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const hatUtil = require(path.join(root, 'utils/festival-hat.js'))
const wxml = fs.readFileSync(path.join(root, 'subpackages/shared/components/ai-chat/index.wxml'), 'utf8')
const wxss = fs.readFileSync(path.join(root, 'subpackages/shared/components/ai-chat/index.wxss'), 'utf8')
const js = fs.readFileSync(path.join(root, 'subpackages/shared/components/ai-chat/index.js'), 'utf8')
const hatCompWxml = fs.readFileSync(path.join(root, 'components/festival-hat/index.wxml'), 'utf8')
const hatCompJs = fs.readFileSync(path.join(root, 'components/festival-hat/index.js'), 'utf8')
const indexWxml = fs.readFileSync(path.join(root, 'pages/index/index.wxml'), 'utf8')
const indexJs = fs.readFileSync(path.join(root, 'pages/index/index.js'), 'utf8')
const indexJson = fs.readFileSync(path.join(root, 'pages/index/index.json'), 'utf8')

let failed = 0
function ok(msg) { console.log('  OK  ' + msg) }
function bad(msg) { failed += 1; console.error('  BAD ' + msg) }
function warn(msg) { console.warn('  WARN ' + msg) }

function day(y, m, d) { return new Date(y, m - 1, d) }

console.log('\n======== 1. 清单与残留 ========')
const ids = hatUtil.FESTIVAL_HATS.map((h) => h.id)
const expectIds = ['spring', 'duanwu', 'zhongqiu', 'guoqing', 'laodong', 'christmas']
if (ids.join(',') === expectIds.join(',')) ok('FESTIVAL_HATS = ' + ids.join(','))
else bad('FESTIVAL_HATS 不符: ' + ids.join(','))

const utilSrc = fs.readFileSync(path.join(root, 'utils/festival-hat.js'), 'utf8')
if (!/qingming|清明|hat-qing/.test(wxml + wxss + js + utilSrc + hatCompWxml + indexWxml)) {
  ok('无清明节残留')
} else bad('仍有清明节相关代码')

if (/MATCH_ORDER\s*=\s*\[/.test(utilSrc) && !/MATCH_ORDER,/.test(utilSrc.split('module.exports')[1] || '')) {
  ok('MATCH_ORDER 为模块内部常量且未导出')
} else if (/MATCH_ORDER\s*=\s*\[/.test(utilSrc)) {
  ok('MATCH_ORDER 存在')
} else bad('缺 MATCH_ORDER')

console.log('\n======== 2. 结构：复用组件 + 贴头 ========')
if (wxml.includes('<festival-hat') && wxml.includes('size="{{112}}"')) {
  ok('星问欢迎区使用 festival-hat size=112')
} else bad('星问未复用 festival-hat 或 size 不对')

if (indexWxml.includes('<festival-hat') && indexWxml.includes('size="{{132}}"') && indexWxml.includes('countdown-rocket')) {
  ok('倒计时圆图使用 festival-hat size=132')
} else bad('倒计时未挂 festival-hat')

if (indexJson.includes('festival-hat') && fs.readFileSync(path.join(root, 'subpackages/shared/components/ai-chat/index.json'), 'utf8').includes('festival-hat')) {
  ok('index / ai-chat 均注册 festival-hat')
} else bad('组件未注册完整')

if (hatCompJs.includes('BASE_SIZE') && hatCompJs.includes('scale')) {
  ok('组件按圆直径 scale 贴合')
} else bad('组件缺缩放逻辑')

const faceOpen = wxml.indexOf('ai-welcome-mascot-face')
const shadowOpen = wxml.indexOf('ai-welcome-mascot-shadow')
const hatOpen = wxml.indexOf('<festival-hat')
if (faceOpen >= 0 && hatOpen > faceOpen && shadowOpen > hatOpen) {
  ok('星问帽挂在 face 内（shadow 前）')
} else bad('星问帽位置错误')

console.log('\n======== 3. id ↔ 组件 wxml 对齐 ========')
ids.forEach((id) => {
  if (hatCompWxml.includes("hat === '" + id + "'")) ok('组件分支 ' + id)
  else bad('组件缺分支 ' + id)
})
const styleMarks = {
  spring: 'hat-spring-shell',
  duanwu: 'hat-duan-band',
  zhongqiu: 'hat-moon-ear',
  guoqing: 'hat-gq-band',
  laodong: 'hat-ld-shell',
  christmas: 'hat-xmas-shell'
}
const hatCompWxss = fs.readFileSync(path.join(root, 'components/festival-hat/index.wxss'), 'utf8')
ids.forEach((id) => {
  if (hatCompWxss.includes(styleMarks[id])) ok('组件样式 ' + id)
  else bad('组件缺样式 ' + id)
})

console.log('\n======== 4. 组件接线 ========')
;[
  ["require('../../../../utils/festival-hat.js')", 'ai-chat require 主包 festival-hat 工具'],
  ['_initFestivalHat()', 'attached 初始化'],
  ['_stopFestivalHatDevCycle()', 'detached 清定时器'],
  ['onFestivalHatDevPick', '开发点选'],
  ['if (!isFestivalHatDevMode()) this._initFestivalHat()', 'page show 生产再解析']
].forEach(([needle, label]) => {
  if (js.includes(needle)) ok(label)
  else bad('缺: ' + label)
})

if (wxml.includes('ai-welcome-hat-dev') && wxml.includes('festivalHatDev')) ok('开发预览条在 wxml')
else bad('开发预览条缺失')

;[
  ["require('../../utils/festival-hat.js')", 'index require festival-hat 工具'],
  ['_syncFestivalHat()', 'index 同步节日帽'],
  ['_stopFestivalHatDevCycle()', 'index 清开发轮播']
].forEach(([needle, label]) => {
  if (indexJs.includes(needle)) ok(label)
  else bad('缺: ' + label)
})

console.log('\n======== 5. 法定假日窗口（抽样） ========')
const cases = [
  // 2026 国办发明电〔2025〕7号
  [2026, 2, 14, ''],
  [2026, 2, 15, 'spring'],
  [2026, 2, 23, 'spring'],
  [2026, 2, 24, ''],
  [2026, 5, 1, 'laodong'],
  [2026, 5, 5, 'laodong'],
  [2026, 5, 6, ''],
  [2026, 6, 19, 'duanwu'],
  [2026, 6, 21, 'duanwu'],
  [2026, 6, 22, ''],
  [2026, 9, 25, 'zhongqiu'],
  [2026, 9, 27, 'zhongqiu'],
  [2026, 9, 28, ''],
  [2026, 10, 1, 'guoqing'],
  [2026, 10, 7, 'guoqing'],
  [2026, 10, 8, ''],
  [2026, 7, 24, ''],
  // 2025 合并假
  [2025, 1, 28, 'spring'],
  [2025, 2, 4, 'spring'],
  [2025, 2, 5, ''],
  [2025, 10, 5, 'guoqing'],
  [2025, 10, 6, 'zhongqiu'],
  [2025, 10, 8, 'zhongqiu'],
  [2025, 10, 9, ''],
  // 2024
  [2024, 2, 10, 'spring'],
  [2024, 2, 17, 'spring'],
  [2024, 6, 8, 'duanwu'],
  [2024, 6, 10, 'duanwu'],
  [2024, 6, 11, ''],
  [2024, 9, 15, 'zhongqiu'],
  [2024, 10, 1, 'guoqing']
]
let caseFail = 0
cases.forEach(([y, m, d, exp]) => {
  const got = hatUtil.resolveFestivalHatId(day(y, m, d)) || ''
  if (got !== exp) {
    caseFail += 1
    bad(y + '-' + m + '-' + d + ' got=' + (got || '(none)') + ' want=' + (exp || '(none)'))
  }
})
if (!caseFail) ok(cases.length + ' 个边界日全部命中')

console.log('\n======== 6. 表完整性（官方 + 预估至 2030） ========')
if (hatUtil.HOLIDAY_TABLE_THROUGH_YEAR !== 2030) {
  bad('HOLIDAY_TABLE_THROUGH_YEAR 应为 2030，got ' + hatUtil.HOLIDAY_TABLE_THROUGH_YEAR)
} else ok('覆盖上界 = 2030')

;[2024, 2025, 2026].forEach((y) => {
  const row = hatUtil.OFFICIAL_HOLIDAY_WINDOWS[y]
  if (!row) return bad('缺官方年份表 ' + y)
  expectIds.forEach((id) => {
    if (!row[id] || !row[id][0] || !row[id][1]) bad(y + ' 缺窗口 ' + id)
  })
  ok(y + ' 官方窗口齐全（含圣诞）')
})

;[2027, 2028, 2029, 2030].forEach((y) => {
  const row = typeof hatUtil.getHolidayWindowsForYear === 'function'
    ? hatUtil.getHolidayWindowsForYear(y)
    : null
  if (!row) return bad('缺预估年份表 ' + y)
  expectIds.forEach((id) => {
    if (!row[id] || !row[id][0] || !row[id][1]) bad(y + ' 预估缺窗口 ' + id)
  })
  if (hatUtil.isHolidayYearEstimated && !hatUtil.isHolidayYearEstimated(y)) {
    warn(y + ' 已是官方表（可接受）')
  }
  ok(y + ' 预估窗口齐全（含圣诞）' + (row._estimated ? '（estimated）' : ''))
})

// 预估抽样：春节除夕起、国庆周、2028 中秋落入国庆合并
const estCases = [
  [2027, 2, 5, 'spring'], // 除夕
  [2027, 2, 12, 'spring'],
  [2027, 2, 13, ''],
  [2027, 6, 9, 'duanwu'], // 周三仅当日
  [2027, 6, 10, ''],
  [2027, 9, 15, 'zhongqiu'],
  [2027, 10, 1, 'guoqing'],
  [2028, 10, 3, 'zhongqiu'], // 中秋在国庆周内
  [2028, 10, 1, 'guoqing'],
  [2028, 10, 8, 'zhongqiu'],
  [2030, 5, 1, 'laodong'],
  [2030, 5, 5, 'laodong'],
  [2026, 12, 23, ''],
  [2026, 12, 24, 'christmas'],
  [2026, 12, 25, 'christmas'],
  [2026, 12, 26, 'christmas'],
  [2026, 12, 27, ''],
  [2030, 12, 25, 'christmas'],
  [2031, 2, 3, ''] // 超上界
]
let estFail = 0
estCases.forEach(([y, m, d, exp]) => {
  const got = hatUtil.resolveFestivalHatId(day(y, m, d)) || ''
  if (got !== exp) {
    estFail += 1
    bad('est ' + y + '-' + m + '-' + d + ' got=' + (got || '(none)') + ' want=' + (exp || '(none)'))
  }
})
if (!estFail) ok(estCases.length + ' 个 2027–2031 预估/越界抽样通过')

console.log('\n======== 7. 上线门禁 ========')
if (hatUtil.FESTIVAL_HAT_DEV_MODE) {
  warn('FESTIVAL_HAT_DEV_MODE=true（开发预览中，上线前必须改 false）')
} else {
  ok('FESTIVAL_HAT_DEV_MODE=false（生产）')
}

warn('每年国办通知发布后：把该年写入 OFFICIAL_HOLIDAY_WINDOWS（覆盖预估）')

console.log('\n======== summary ========')
if (failed) {
  console.error(failed + ' checks RED')
  process.exit(1)
}
console.log('all GREEN' + (hatUtil.FESTIVAL_HAT_DEV_MODE ? ' (with DEV_MODE warn)' : ''))
