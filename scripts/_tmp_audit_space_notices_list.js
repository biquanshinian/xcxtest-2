/**
 * SPACE_NOTICES_FEATURE — 列表页三列卡运行时审计（目标：无 JS 抛错）
 * node scripts/_tmp_audit_space_notices_list.js
 */
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const vm = require('vm')

const ROOT = path.resolve(__dirname, '..')
const results = []

function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail || '' })
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`)
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8')
}

const LIST_JS = 'subpackages/monitor-pages/space-notices/entry-list.js'
const LIST_WXML = 'subpackages/monitor-pages/space-notices/entry-list.wxml'
const LIST_WXSS = 'subpackages/monitor-pages/space-notices/entry-list.wxss'
const LIST_JSON = 'subpackages/monitor-pages/space-notices/entry-list.json'

// ── 1) 语法 / JSON ──
;[LIST_JS, 'subpackages/monitor-pages/space-notices/utils/notice-format.js', 'subpackages/monitor-pages/space-notices/utils/api-space-notices.js'].forEach((f) => {
  const r = spawnSync(process.execPath, ['--check', path.join(ROOT, f)], { encoding: 'utf8' })
  check('syntax ' + path.basename(f), r.status === 0, r.stderr || 'ok')
})
try {
  JSON.parse(read(LIST_JSON))
  check('entry-list.json 可解析', true)
} catch (e) {
  check('entry-list.json 可解析', false, e.message)
}

// ── 2) 抽出 decorate 纯函数并在沙箱执行 ──
global.wx = {
  env: { USER_DATA_PATH: '/tmp' },
  getStorageSync: () => null,
  setStorageSync: () => {},
  getStorage: ({ fail }) => fail && fail(),
  setStorage: ({ complete }) => complete && complete(),
  getFileSystemManager: () => ({
    access: () => {},
    accessSync: () => {
      throw new Error('no file')
    },
    readdirSync: () => []
  })
}

const { decorateSpaceNoticeEntry } = require('../subpackages/monitor-pages/space-notices/utils/notice-format.js')
const listSrc = read(LIST_JS)
const fnBlock = listSrc.slice(listSrc.indexOf('function formatNet'), listSrc.indexOf('Page({'))
const sandbox = {
  decorateSpaceNoticeEntry,
  module: { exports: {} },
  exports: {},
  console
}
vm.runInNewContext(fnBlock + '\nmodule.exports = { formatNet, formatNetShort, decorateEntry }\n', sandbox)
const { formatNet, formatNetShort, decorateEntry } = sandbox.module.exports
check('抽出 formatNet/decorateEntry', typeof formatNet === 'function' && typeof decorateEntry === 'function')

const slimFixtures = [
  {
    entryKey: 'launch-f9-starlink-10-49',
    missionName: 'Starlink Group 10-49',
    missionNameZh: '星链组 10-49',
    rocketName: 'Falcon 9',
    rocketNameZh: '猎鹰9号',
    net: '2026-07-29T00:00:00.000Z',
    windowStartMs: Date.parse('2026-07-29T00:00:00.000Z'),
    isPast: false,
    agency: 'SpaceX',
    noticeCount: 7,
    hasTrajectory: false
  },
  {
    entryKey: 'launch-starship-flight-13',
    missionName: 'Flight 13',
    missionNameZh: '第13次飞行',
    rocketName: 'Starship',
    rocketNameZh: '星舰',
    net: '2026-05-01T00:00:00.000Z',
    windowStartMs: Date.parse('2026-05-01T00:00:00.000Z'),
    isPast: true,
    isStarship: true,
    agency: 'SpaceX',
    noticeCount: 3,
    hasTrajectory: true
  },
  {
    entryKey: 'launch-cz-7a-unknown',
    missionName: '',
    rocketName: '',
    net: '',
    windowStartMs: 0,
    isPast: false,
    agency: 'CASC',
    noticeCount: 0,
    hasTrajectory: false
  },
  {
    entryKey: 'launch-only-slug',
    missionName: 'launch-only-slug',
    rocketName: '',
    net: 'not-a-date',
    noticeCount: '2',
    hasTrajectory: 1
  },
  {
    entryKey: 'x',
    noticeCount: 'abc',
    hasTrajectory: null
  },
  null,
  undefined,
  {},
  { entryKey: 'launch-f9-crew-10', missionName: 'Crew-10', rocketName: 'Falcon 9', net: '2026-08-01', noticeCount: 1 }
]

let decorateThrows = []
const decorated = slimFixtures.map((row, i) => {
  try {
    return decorateEntry(row)
  } catch (e) {
    decorateThrows.push(i + ':' + ((e && e.message) || e))
    return null
  }
})
check('decorateEntry 全部不抛', decorateThrows.length === 0, decorateThrows.join(' | ') || 'ok')

const starlink = decorated[0]
check('星链标题读云端 zh', starlink && starlink.title === '星链组 10-49', starlink && starlink.title)
check('星链副标题读云端 zh', starlink && starlink.subtitle === '猎鹰9号', starlink && starlink.subtitle)
check('短日期 MM-DD', starlink && /^\d{2}-\d{2}$/.test(starlink.netShort), starlink && starlink.netShort)
check('noticeCount 为数字', starlink && starlink.noticeCount === 7, String(starlink && starlink.noticeCount))
check('无轨迹不标 hasTrajectory', starlink && !starlink.hasTrajectory)

const flight = decorated[1]
check('星舰标题读云端 zh', flight && flight.title === '第13次飞行', flight && flight.title)
check('轨迹字段保留', flight && flight.hasTrajectory === true)
check('isPast 保留', flight && flight.isPast === true)

const emptyNet = decorated[2]
check('空时间回落文案', emptyNet && emptyNet.netShort === '时间待定', emptyNet && emptyNet.netShort)
check('slug 能补火箭名', emptyNet && /长征|Long March|发射任务/.test(emptyNet.subtitle), emptyNet && emptyNet.subtitle)
check('无云端 zh 不查本地词典', emptyNet && !/第\d+次飞行|星链组/.test(emptyNet.title), emptyNet && emptyNet.title)

const badDate = decorated[3]
check('非法日期不抛且有文案', badDate && typeof badDate.netShort === 'string' && badDate.netShort.length > 0, badDate && badDate.netShort)

const nanCount = decorated[4]
check('非法 noticeCount 收敛为 0', nanCount && nanCount.noticeCount === 0, String(nanCount && nanCount.noticeCount))

const nullRow = decorated[5]
check('null 条目不抛且有标题', nullRow && typeof nullRow.title === 'string' && nullRow.title.length > 0, nullRow && nullRow.title)

const tileWxml = (read(LIST_WXML).match(/class="sn-tile[\s\S]*?<\/view>\s*<\/view>/g) || []).join('\n')
const wxmlFields = [...new Set((tileWxml.match(/item\.([A-Za-z0-9_]+)/g) || []).map((s) => s.slice(5)))]
const sample = decorated[0]
const missingFields = wxmlFields.filter((f) => sample[f] === undefined)
check('wxml item.* 字段 decorate 都产出', missingFields.length === 0, missingFields.join(',') || wxmlFields.join(','))

// 模拟 loadList 映射 + 分段
try {
  const rows = slimFixtures.filter((x) => x && x.entryKey).map(decorateEntry)
  const upcoming = rows.filter((e) => !e.isPast)
  const past = rows.filter((e) => e.isPast)
  check('分段不丢条', upcoming.length + past.length === rows.length, `${upcoming.length}+${past.length}/${rows.length}`)
  check('wx:key 都有 entryKey', rows.every((e) => e.entryKey), rows.filter((e) => !e.entryKey).length + ' missing')
  const keyed = [null, {}, { entryKey: 'keep-me', missionName: 'A' }].map(decorateEntry).filter((e) => e && e.entryKey)
  check('无 entryKey 被丢掉', keyed.length === 1 && keyed[0].entryKey === 'keep-me', String(keyed.length))
} catch (e) {
  check('分段不丢条', false, e.message)
  check('wx:key 都有 entryKey', false, e.message)
  check('无 entryKey 被丢掉', false, e.message)
}

// ── 3) 事件 / data / class 闭环 ──
const wxml = read(LIST_WXML)
const js = read(LIST_JS)
const wxss = read(LIST_WXSS)
const appWxss = read('app.wxss')
const pageBase = read('utils/page-base.js')

const handlers = [...new Set((wxml.match(/(?:bind|catch)(?:tap|touchmove)="([a-zA-Z]+)"/g) || []).map((s) => s.replace(/.*="|"/g, '')))]
const missingHandlers = handlers.filter(
  (h) => !new RegExp('(^|\\s)' + h + '\\s*\\(').test(js) && !new RegExp('(^|\\s)' + h + '\\s*\\(').test(pageBase)
)
check('bindtap 都有实现', missingHandlers.length === 0, missingHandlers.join(',') || handlers.join(','))

const dataBlock = js.slice(js.indexOf('data: {'), js.indexOf('async onLoad'))
const topRefs = new Set()
;(wxml.match(/\{\{([^}]+)\}\}/g) || []).forEach((m) => {
  const expr = m.replace(/[{}]/g, '')
  if (/\bitem\.|chinaMap\.|themeClass|statusBarHeight|menuButtonWidth|navPlaceholderHeight|isDirectEntry|pageBgColor/.test(expr)) return
  expr.replace(/'[^']*'/g, ' ').split(/[^A-Za-z0-9_]+/).filter((t) => /^[a-zA-Z_]/.test(t)).forEach((t) => {
    if (!/^(true|false|length)$/.test(t)) topRefs.add(t)
  })
})
const missingData = [...topRefs].filter((t) => !new RegExp('\\b' + t + '\\b').test(dataBlock) && !new RegExp('\\b' + t + '\\b').test(pageBase))
check('顶层 mustache 字段已声明', missingData.length === 0, missingData.join(',') || [...topRefs].join(','))

const used = new Set()
;(wxml.match(/class="([^"]*)"/g) || []).forEach((a) => {
  a.replace(/class="|"/g, '')
    .replace(/\{\{[^}]*\}\}/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .forEach((c) => used.add(c))
})
const KNOWN_GLOBAL = /^(theme-light|glass-card|card-hover|skeleton-card|skeleton-line|skeleton-shimmer|detail-skeleton|top-nav|top-nav-wrapper|top-nav--page-grid|nav-left|nav-title-wrap|nav-title-wrap--page-grid|nav-title|nav-title--page-grid|nav-right-space|top-nav-slot--back|top-nav-slot--home|top-nav-slot--spacer|icon-back|icon-back--nav)$/
const declared = wxss + appWxss
const missingClass = [...used].filter((c) => {
  if (KNOWN_GLOBAL.test(c)) return false
  if (/--$/.test(c)) return false
  return !new RegExp('\\.' + c.replace(/[-]/g, '\\-') + '(?![\\w-])').test(declared)
})
check('wxml class 都有样式', missingClass.length === 0, missingClass.join(',') || 'ok')

check('三列网格', /\.sn-grid\s*\{[^}]*grid-template-columns:\s*repeat\(3/.test(wxss.replace(/\s+/g, ' ')))
check('列表用 entryKey 打开详情', /data-key="\{\{item\.entryKey\}\}"/.test(wxml) && /openMap\(/.test(js))
check('wx:elif 链闭合', (wxml.match(/wx:if=/g) || []).length >= 3 && /wx:elif/.test(wxml) && /wx:else/.test(wxml))

const failed = results.filter((r) => !r.ok)
console.log(`\n=== list audit: ${results.length - failed.length} passed, ${failed.length} failed ===`)
if (failed.length) process.exitCode = 1
