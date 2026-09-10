/**
 * 安全拆分：把日历全球/SpaceX 统计样式移到 calendar-stats 组件
 */
const fs = require('fs')

const PAGE = 'pages/index/index.wxss'
const COMP = 'subpackages/index-extra/components/calendar-stats/index.wxss'

let s = fs.readFileSync(PAGE, 'utf8').replace(/\r\n/g, '\n')
const before = s.length

// 去掉 AI 图片识别残留样式（若仍在）
const aiStart = s.indexOf('/* ========== AI 图片识别')
if (aiStart >= 0) {
  const nextSection = s.indexOf('/* ==========', aiStart + 10)
  const end = nextSection >= 0 ? nextSection : s.length
  s = s.slice(0, aiStart) + s.slice(end)
  console.log('removed AI recognize CSS')
}

const statsStart = s.indexOf('/* ========== 日历内全球发射数据 ========== */')
const spacexStart = s.indexOf('/* ========== SpaceX 官网发射统计 ========== */')
const nextStart = s.indexOf('/* ========== 倒计时卡片底部操作栏 ========== */')
if (statsStart < 0 || nextStart < 0) {
  throw new Error('markers missing: ' + [statsStart, spacexStart, nextStart].join(','))
}

// 同时带走 .calendar-empty（在 stats 之前）
let cutStart = statsStart
const emptyIdx = s.lastIndexOf('.calendar-empty {', statsStart)
if (emptyIdx > 0 && statsStart - emptyIdx < 200) {
  cutStart = emptyIdx
}

const moved = s.slice(cutStart, nextStart)
s = s.slice(0, cutStart) + s.slice(nextStart)

const compWxss =
  '/* 日历统计 / SpaceX 统计（自 pages/index/index.wxss 拆出） */\n' +
  ':host { display: block; }\n\n' +
  moved.trim() +
  '\n'

fs.writeFileSync(COMP, compWxss)
fs.writeFileSync(PAGE, s)

console.log('page', (before / 1024).toFixed(1), '->', (s.length / 1024).toFixed(1), 'KB')
console.log('comp', (compWxss.length / 1024).toFixed(1), 'KB')
console.log('has literal n?', /\\n/.test(s.slice(cutStart, cutStart + 50)))
console.log('countdown ok', s.includes('倒计时卡片底部操作栏'))
console.log('stats gone from page', !s.includes('日历内全球发射数据'))
