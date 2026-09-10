/**
 * 开屏通知换行解析：多 div / br / 真实 \\n 都应拆成多行
 */
const fs = require('fs')
const path = require('path')
const root = path.resolve(__dirname, '..')
const splash = fs.readFileSync(path.join(root, 'subpackages/index-extra/utils/index-splash.js'), 'utf8')
const fails = []
const must = (c, m) => {
  if (!c) fails.push(m)
}

must(splash.includes('splitSplashNoticeTopDivs'), 'has top-level div splitter')
must(splash.includes("replace(/\\r\\n|\\r|\\n/g, '<br/>')") || splash.includes('replace(/\\r\\n|\\r|\\n/g'), 'newline → br')
must(!/\.replace\(\/\\s\+\/g,\s*' '\)/.test(splash.match(/function cleanNoticeSegText[\s\S]*?^}/m)?.[0] || ''), 'cleanNoticeSegText not collapsing all whitespace')

// 运行时：抽出函数测
const start = splash.indexOf('function splitSplashNoticeTopDivs')
const end = splash.indexOf('function cleanNoticeSegText')
const mid = splash.slice(splash.indexOf('function clampSplashNoticeLineHeight'), end)
const parseStart = splash.indexOf('function cleanNoticeSegText')
const parseEnd = splash.indexOf('function normalizeSplashNotice')
const helpers =
  splash.slice(splash.indexOf('function decodeNoticeEntities'), splash.indexOf('function clampSplashNoticeLineHeight')) +
  mid +
  splash.slice(parseStart, parseEnd)
// eslint-disable-next-line no-new-func
const fn = new Function(`${helpers}; return { buildSplashNoticeLines, splitSplashNoticeTopDivs };`)
const { buildSplashNoticeLines } = fn()

const multiDiv =
  '<div style="text-align:left;line-height:1.2"><span style="font-size:28px;font-weight:700">由于天气原因</span></div>' +
  '<div style="text-align:left;line-height:1.2">星舰第13次飞行测试</div>' +
  '<div style="text-align:left;line-height:1.2">现已改期至7月25日 06:45 AM</div>'
const lines = buildSplashNoticeLines(multiDiv, 1.4)
must(lines.length === 3, `multi div → 3 lines (got ${lines.length})`)
must(lines[0].segs.some((s) => s.bold && s.text.includes('由于天气原因')), 'first line bold')

const brLines = buildSplashNoticeLines('<div style="text-align:left">A<br/>B<br/>C</div>', 1.4)
must(brLines.length === 3, `br → 3 lines (got ${brLines.length})`)

const nlLines = buildSplashNoticeLines('<div>A\nB\nC</div>', 1.4)
must(nlLines.length === 3, `newline → 3 lines (got ${nlLines.length})`)

if (fails.length) {
  console.error('SPLASH_LINEBREAK_RUNTIME_FAIL')
  fails.forEach((f) => console.error(' -', f))
  process.exit(1)
}
console.log('SPLASH_LINEBREAK_RUNTIME_OK')
console.log({ multi: lines.length, br: brLines.length, nl: nlLines.length })
