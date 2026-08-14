/**
 * SPACE_NOTICES_FEATURE — 详情页 UI / 高阶功能审计
 * node scripts/_tmp_audit_space_notices_ui.js
 *
 * 覆盖：class 定义闭环、事件绑定闭环、按钮文字居中、主题反色（无裸色文字）、
 *       通告状态推导、选中高亮 / 聚焦、wxss 括号平衡。
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
  return fs.readFileSync(path.join(ROOT, rel), 'utf8')
}

const DIR = 'subpackages/monitor-pages/space-notices'
const wxml = read(`${DIR}/notice-map.wxml`)
const wxss = read(`${DIR}/notice-map.wxss`)
const js = read(`${DIR}/notice-map.js`)
const appWxss = read('app.wxss')
const tokens = read('styles/tokens.wxss')

// ── 1) class 闭环：wxml 里出现的 class 必须在页面 wxss 或 app.wxss 有定义 ──
console.log('\n[1] class 定义闭环')
const KNOWN_GLOBAL = /^(theme-light|glass-card|skeleton|detail-skeleton)/
const classAttrs = wxml.match(/class="([^"]*)"/g) || []
const used = new Set()
classAttrs.forEach((a) => {
  a.replace(/class="|"/g, '')
    .replace(/\{\{[^}]*\}\}/g, ' ') // 动态部分单独校验
    .split(/\s+/)
    .filter(Boolean)
    .forEach((c) => used.add(c))
})
// 动态 class 里的字面量（三元结果 / 拼接后缀）
const dynamic = wxml.match(/'([a-z0-9-]+)'/g) || []
dynamic.forEach((d) => {
  const c = d.replace(/'/g, '')
  if (/^sn-|^panel|^nav-/.test(c)) used.add(c)
})
// 后缀拼接类：sn-item-bar--{{item.typeTone}} / sn-tag--{{item.statusTone}}
const SUFFIX_SETS = {
  'sn-item-bar': ['notam', 'nav', 'adp'],
  'sn-chip-dot': ['notam', 'nav', 'adp', 'pad', 'live', 'soon', 'china'],
  'sn-tag': ['live', 'soon', 'off', 'plain']
}
Object.keys(SUFFIX_SETS).forEach((base) => {
  used.delete(base + '--')
  if (new RegExp(base + '--\\{\\{').test(wxml)) SUFFIX_SETS[base].forEach((s) => used.add(`${base}--${s}`))
})
const declared = wxss + appWxss
const missing = [...used].filter((c) => {
  if (KNOWN_GLOBAL.test(c)) return false
  return !new RegExp('\\.' + c.replace(/[-]/g, '\\-') + '(?![\\w-])').test(declared)
})
check('wxml class 全部有样式', missing.length === 0, missing.join(',') || 'ok')

// ── 2) 事件闭环 ──
console.log('\n[2] 事件闭环')
const handlers = [...new Set((wxml.match(/bind(?:tap|touchmove)="([a-zA-Z]+)"/g) || []).concat(wxml.match(/catchtouchmove="([a-zA-Z]+)"/g) || []).map((s) => s.replace(/.*="|"/g, '')))]
const pageBase = read('utils/page-base.js')
const missingHandlers = handlers.filter(
  (h) => !new RegExp('(^|\\s)' + h + '\\s*\\(').test(js) && !new RegExp('(^|\\s)' + h + '\\s*\\(').test(pageBase)
)
check('bindtap 全部有实现', missingHandlers.length === 0, missingHandlers.join(',') || handlers.join(','))

// ── 3) 数据字段闭环：wxml 引用的顶层字段在 data 里声明 ──
console.log('\n[3] data 字段闭环')
const dataBlock = js.slice(js.indexOf('data: {'), js.indexOf('_entry: null'))
const refs = new Set()
;(wxml.match(/\{\{([^}]+)\}\}/g) || []).forEach((m) => {
  m.replace(/[{}]/g, '')
    .replace(/'[^']*'/g, ' ') // class 三元里的字面量不是数据字段
    .split(/[^A-Za-z0-9_.]+/)
    .filter(Boolean)
    .forEach((tok) => {
      const root = tok.split('.')[0]
      if (/^(true|false|item|index)$/.test(root)) return // wx:for 作用域变量
      if (/^[a-z][A-Za-z0-9]*$/.test(root)) refs.add(root)
    })
})
const SHELL_FIELDS = ['statusBarHeight', 'themeClass', 'pageBgColor', 'isDirectEntry', 'navPlaceholderHeight', 'menuButtonWidth', 'themeLight']
const missingData = [...refs].filter(
  (r) => SHELL_FIELDS.indexOf(r) === -1 && !new RegExp('(^|\\s)' + r + ':').test(dataBlock)
)
check('wxml 引用字段已在 data 声明', missingData.length === 0, missingData.join(',') || `n=${refs.size}`)

// ── 4) 按钮文字居中 ──
console.log('\n[4] 按钮文字居中')
function rulesOf(source) {
  const css = source.replace(/\/\*[\s\S]*?\*\//g, '') // 注释会污染选择器捕获
  const map = {}
  const re = /([^{}]+)\{([^}]*)\}/g
  let m
  while ((m = re.exec(css))) {
    m[1]
      .split(',')
      .map((s) => s.trim())
      .forEach((sel) => {
        map[sel] = (map[sel] || '') + m[2]
      })
  }
  return map
}
const rules = rulesOf(wxss)
// 可点击的容器：必须 flex + 居中；其 text 必须 line-height:1 + text-align:center 或 width:100%
const TAPPABLE = ['.sn-btn', '.sn-seg-item', '.sn-chip', '.sn-sheet-close', '.panel-toggle-btn']
const notCentered = []
TAPPABLE.forEach((sel) => {
  const appRules = rulesOf(appWxss)
  const body = rules[sel] || appRules['.map-page ' + sel] || appRules[sel] || ''
  const ok = /display:\s*flex/.test(body) && /align-items:\s*center/.test(body) && /justify-content:\s*center/.test(body)
  if (!ok) notCentered.push(sel)
})
check('可点击容器 flex 居中', notCentered.length === 0, notCentered.join(',') || TAPPABLE.join(','))

const textNotCentered = []
;['.sn-btn text', '.sn-seg-item text', '.sn-sheet-close text'].forEach((sel) => {
  const body = rules[sel] || ''
  if (!(/line-height:\s*1\b/.test(body) && /text-align:\s*center/.test(body))) textNotCentered.push(sel)
})
check('按钮文字 line-height:1 + 居中', textNotCentered.length === 0, textNotCentered.join(',') || 'ok')

// 旧写法（height + line-height 定高居中）已清除
check('不再用 height+line-height 定高居中', !/line-height:\s*\d+rpx/.test(wxss))
check('列表页按钮也 flex 居中', /\.sn-btn\s*\{[^}]*display:\s*flex/.test(read(`${DIR}/entry-list.wxss`)))

// ── 5) 主题反色 ──
console.log('\n[5] 主题反色')
// 文字色必须走 token；白色文字只允许出现在品牌底/#fff 按钮内
const badTextColor = []
Object.keys(rules).forEach((sel) => {
  const body = rules[sel]
  const m = body.match(/(?:^|;)\s*color:\s*([^;]+)/g) || []
  m.forEach((decl) => {
    const val = decl.split(/color:\s*/).pop().trim()
    if (/^var\(--/.test(val)) return
    if (/#ffffff|#fff\b/i.test(val)) {
      // 仅允许品牌底按钮 / 选中分段 上的白字
      if (/--primary|--on/.test(sel)) return
      badTextColor.push(`${sel}:${val}`)
      return
    }
    // 语义色（状态标签 / 图例）允许，但必须有 theme-light 对应或本身双主题安全
    if (/^#(FF3B30|0A84FF|ffcc00|34C759|248A3D|007AFF)$/i.test(val)) return
    badTextColor.push(`${sel}:${val}`)
  })
})
check('文字色走 token / 语义色', badTextColor.length === 0, badTextColor.join(' | ') || 'ok')

check('玻璃底有浅色覆盖', /\.theme-light\s+\.glass-card/.test(wxss))
check('遮罩有浅色覆盖', /\.theme-light\s+\.sn-mask/.test(wxss))
check('分段/chip/win 有浅色覆盖', /\.theme-light\s+\.sn-seg/.test(wxss) && /\.theme-light\s+\.sn-chip/.test(wxss) && /\.theme-light\s+\.sn-win/.test(wxss))
check('绿色状态字浅色降饱和', /\.theme-light\s+\.sn-tag--live\s+text/.test(wxss))
check('themeLight 参与地图重画', /light:\s*!!this\.data\.themeLight/.test(js))
check('onShow 主题兜底', /onShow\(\)/.test(js) && /this\.syncTheme\(\)/.test(js))
check('page-meta 背景跟随主题', /background-color="\{\{pageBgColor\}\}"/.test(wxml))

// token 引用必须真实存在
const tokenRefs = [...new Set((wxss.match(/var\((--[a-z0-9-]+)/g) || []).map((s) => s.replace('var(', '')))]
const missingTokens = tokenRefs.filter((t) => !new RegExp(t + '\\s*:').test(tokens))
check('引用的 token 均已定义', missingTokens.length === 0, missingTokens.join(',') || `n=${tokenRefs.length}`)
const lightTokens = tokens.slice(tokens.indexOf('.theme-light'))
const noInvert = tokenRefs.filter((t) => /^--color-(text|divider|border|bg)/.test(t) && !new RegExp(t + '\\s*:').test(lightTokens))
check('取色 token 均有浅色覆盖', noInvert.length === 0, noInvert.join(',') || 'ok')

// ── 6) wxss 括号平衡 ──
console.log('\n[6] 语法')
let depth = 0
for (const ch of wxss) {
  if (ch === '{') depth++
  if (ch === '}') depth--
}
check('wxss 括号平衡', depth === 0, `depth=${depth}`)
const a = (wxml.match(/\{\{/g) || []).length
const b = (wxml.match(/\}\}/g) || []).length
check('wxml mustache 平衡', a === b, `${a}/${b}`)
check('block wx:if 配对', (wxml.match(/<block/g) || []).length === (wxml.match(/<\/block>/g) || []).length)

// ── 7) 高阶功能：状态推导 ──
console.log('\n[7] 通告状态推导')
global.wx = {
  env: { USER_DATA_PATH: '/tmp' },
  getStorageSync: () => null,
  setStorageSync: () => {},
  getFileSystemManager: () => ({ access: () => {}, readdirSync: () => [] })
}
const { describeDates, decorateNotice, sortNotices, buildStats, shortType, noticeTypeTone, datesFromNotice, noticeStatusVisible, formatChinaBulletinSync, extractNotamSeries, chinaNoticeTitle } = require(`../${DIR}/utils/notice-format.js`)
const NOW = Date.parse('2026-07-24T01:00:00Z')
const dates = [
  { start: '2026-07-23T23:34:00.000Z', end: '2026-07-24T02:59:00.000Z' },
  { start: '2026-07-24T23:34:00.000Z', end: '2026-07-25T02:59:00.000Z' }
]
const live = describeDates(dates, false, NOW)
check('窗口内 = 生效中', live.statusText === '生效中' && live.statusTone === 'live', live.statusText)
check('生效中带时间文案', /→/.test(live.timeText), live.timeText)
check('窗口全部列出', live.windows.length === 2, String(live.windows.length))
const soon = describeDates(dates, false, Date.parse('2026-07-24T10:00:00Z'))
check('窗口间隙 = 提前预警', soon.statusText === '提前预警' && soon.statusTone === 'soon', soon.statusText)
check('提前预警带倒计时', /后生效/.test(soon.timeText) && !!soon.leadText, soon.timeText)
const past = describeDates(dates, false, Date.parse('2026-07-26T00:00:00Z'))
check('全部过期 = 已结束', past.statusText === '已结束' && past.statusTone === 'off', past.statusText)
const cancelled = describeDates(dates, true, NOW)
check('cancelled 优先级最高', cancelled.statusText === '已取消' && cancelled.statusTone === 'off')
check('无 dates 不编状态', describeDates([], false, NOW).statusText === '')
const icaoOnly = datesFromNotice({
  rawText: 'B) 2608010000 C) 2608021200\nE) HAZARD AREA'
})
check('原文 B/C 回填 dates', icaoOnly.length === 1 && Number(icaoOnly[0].start) > 0, JSON.stringify(icaoOnly))
const icaoSoon = decorateNotice({
  name: 'ICAO-soon',
  type: 'NOTAM',
  rawText: 'B) 2608010000 C) 2608021200'
}, () => false, NOW)
check('缺 dates 的未来窗口 = 提前预警', icaoSoon.statusText === '提前预警', icaoSoon.statusText)
const endOnlySoon = decorateNotice({
  name: 'end-only',
  type: 'NOTAM',
  dates: [{ end: '2026-08-02T12:00:00.000Z' }],
  rawText: 'B) 2608010000 C) 2608021200'
}, () => false, NOW)
check('只有结束时间时用 B) 判预警', endOnlySoon.statusText === '提前预警', endOnlySoon.statusText)

check('type tone 映射', noticeTypeTone('NAVWARNING') === 'nav' && noticeTypeTone('ADP_LINK_FILE') === 'adp' && noticeTypeTone('NOTAM') === 'notam')
check('type 短标签', shortType('ADP_LINK_FILE') === 'ADP' && shortType('NAVWARNING') === 'NAVWARN')

const { hasGeometry, buildPolygonsFromNotices, fitNotice, styleForType } = require(`../${DIR}/utils/map-build.js`)
const { DEMO_NOTICES } = require('../cloudfunctions/spaceNotices/seed-demo.js')
const decorated = DEMO_NOTICES.map((n) => decorateNotice(n, hasGeometry, NOW))
check('演示通告全部识别到几何', decorated.every((n) => n.hasGeo), decorated.map((n) => `${n.typeShort}:${n.hasGeo}`).join(' '))
check('原文按行拆分', decorated.some((n) => n.rawLines.length >= 3), String(decorated[0].rawLines.length))
check('rawLines 带稳定 key', decorated[0].rawLines.every((l, i) => l.i === i))
const stats = buildStats(decorated)
check('分类计数', stats.notam >= 1 && stats.nav >= 1, JSON.stringify(stats))

const mixed = [
  decorateNotice({ name: 'C-cancel', type: 'NOTAM', dates, cancelled: true }, hasGeometry, NOW),
  decorateNotice({ name: 'A-past', type: 'NOTAM', dates: [{ start: '2026-07-01T00:00:00Z', end: '2026-07-02T00:00:00Z' }] }, hasGeometry, NOW),
  decorateNotice({ name: 'B-live', type: 'NOTAM', dates }, hasGeometry, NOW),
  decorateNotice({ name: 'D-soon', type: 'NOTAM', dates: [{ start: '2026-08-01T00:00:00Z', end: '2026-08-02T00:00:00Z' }] }, hasGeometry, NOW)
]
const mixedStats = buildStats(mixed)
check('预警计入 stats.soon', mixedStats.soon >= 1 && mixedStats.live >= 1 && mixedStats.ended >= 1 && mixedStats.cancelled >= 1, JSON.stringify(mixedStats))
check('状态筛选可关预警', !noticeStatusVisible(mixed.find((n) => n.name === 'D-soon'), { showSoon: false }))
const { isChinaNotice, extractIcaoLocations, pointInChina, isChinaPad, noticeChinaVisible, isChineseCollectionKey, normalizeEntryKey, firLabel, firCodeFromNotice } = require(`../${DIR}/utils/china-filter.js`)
check('YMMM 溅落不是中国', !isChinaNotice({ rawText: 'Q) YMMM/QRDCA\nA) YMMM\n', noticeKey: 'notam-YMMM-E2700/26', areas: [[[92.9, -21.6], [93.1, -21.6], [93.1, -21.4], [92.9, -21.6]]] }))
check('美国 ZHU 三字码不是中国', !isChinaNotice({ noticeKey: 'notam-ZHU-07/270-26', name: '07/270', rawText: 'HOUSTON ARTCC ZHU\n', areas: [[[-97.15, 25.99], [-97.1, 25.99], [-97.1, 26.1], [-97.15, 25.99]]] }))
check('ZONE/ZULU 不误判', !isChinaNotice({ rawText: 'HAZARD ZONE UNTIL 1200ZULU', name: 'ZONE' }))
check('China Lake 不是中国', !isChinaNotice({ reason: 'CHINA LAKE NAWS RESTRICTED AREA', rawText: 'A) KZLA\nCHINA LAKE' }))
check('Q) ZJHK 是中国', isChinaNotice({ rawText: 'Q) ZJHK/QRDCA/IV/BO/W/000/999\nA) ZJHK\n', noticeKey: 'notam-ZJHK-A0123/26' }))
check('A) ZBAA 是中国', isChinaNotice({ rawText: 'A) ZBAA\nE) TEMPO RESTRICTED' }))
check('文昌地名是中国', isChinaNotice({ reason: 'Wenchang coastal hazard', name: '文昌发射' }))
check('文昌坐标是中国', isChinaNotice({ areas: [[[110.95, 19.61], [111.1, 19.61], [111.1, 19.8], [110.95, 19.61]]] }))
check('苏禄海官网溅落区算中国海域', isChinaNotice({ areas: [[[119.22, 9.1], [119.37, 9.1], [119.37, 9.28], [119.22, 9.1]]] }))
check('官网中国合集 slug', isChineseCollectionKey('collection-chinese-unknown'))
check('合集 slug 去掉首尾空白', normalizeEntryKey('  collection-chinese-unknown  ') === 'collection-chinese-unknown')
check('ZLHW 显示兰州情报区', firLabel('ZLHW') === '兰州情报区')
check('空 FIR 不显示未知区域', firLabel('') === '')
check('航警编号带出 FIR', firCodeFromNotice({ noticeKey: 'notam-ZLHW-A3624/26' }) === 'ZLHW')
check('编号抽取 A3624/26', extractNotamSeries({ noticeKey: 'notam-ZLHW-A3624/26', name: 'A3624/26' }) === 'A3624/26')
check(
  '中国航警标题',
  chinaNoticeTitle({ name: 'A3624/26' }, 'ZLHW', 'A3624/26') === '兰州情报区 · A3624/26'
)
check(
  'decorate 标题带情报区',
  decorateNotice({ name: 'A3624/26', type: 'NOTAM', noticeKey: 'notam-ZLHW-A3624/26' }, () => false, NOW).displayName ===
    '兰州情报区 · A3624/26'
)
check(
  '核对无变化文案',
  formatChinaBulletinSync({ lastCheckedAt: NOW, lastChangedAt: NOW - 3600000 }, NOW).unchanged &&
    /没有新航警/.test(formatChinaBulletinSync({ lastCheckedAt: NOW, lastChangedAt: NOW - 3600000 }, NOW).changeText)
)
check(
  '刚收到新航警文案',
  !formatChinaBulletinSync({ lastCheckedAt: NOW, lastChangedAt: NOW }, NOW).unchanged
)
check(
  '核对节奏文案',
  /15 分钟/.test(formatChinaBulletinSync({ lastCheckedAt: NOW, lastChangedAt: NOW - 3600000 }, NOW).cadenceText)
)
check('Texas 坐标不是中国', !pointInChina(25.99677, -97.15799))
check('东方发射场坐标不是中国', !pointInChina(51.8844, 128.3339))
check('种子岛坐标不是中国', !pointInChina(30.401, 130.978))
check('拜科努尔坐标不是中国', !pointInChina(45.965, 63.305))
check('香港 FIR 算中国', isChinaNotice({ rawText: 'Q) VHHK/QRDCA\nA) VHHK' }))
check('台湾 FIR 算中国', isChinaNotice({ rawText: 'Q) RCAA/QRDCA\nA) RCAA' }))
check('extract 不把 ZHU 当成四字 ICAO', extractIcaoLocations({ noticeKey: 'notam-ZHU-07/270-26' }).indexOf('ZHU') === -1)
check('演示星舰通告不含中国', decorated.every((n) => !n.inChina), decorated.map((n) => n.name + ':' + n.inChina).join(' '))
const chinaRow = decorateNotice({
  name: 'A1234/26',
  type: 'NOTAM',
  rawText: 'Q) ZJHK/QRDCA/IV/BO/W/000/999\nA) ZJHK\nB) 2608200000 C) 2608210000\nE) Wenchang',
  areas: [[[110.95, 19.61], [111.2, 19.61], [111.2, 19.9], [110.95, 19.61]]]
}, hasGeometry, NOW)
check('decorateNotice.inChina', chinaRow.inChina === true)
check('chinaOnly 只留中国', noticeChinaVisible(chinaRow, { chinaOnly: true }) && !noticeChinaVisible(decorated[0], { chinaOnly: true }))
check('未开 chinaOnly 全可见', noticeChinaVisible(decorated[0], { chinaOnly: false }) && noticeChinaVisible(decorated[0], {}))
check('stats.china 计数', buildStats([chinaRow].concat(decorated)).china === 1)
check('文昌发射台 isChinaPad', isChinaPad({ name: 'Wenchang LC-1', latitude: 19.6145, longitude: 110.951 }))
check('Starbase 不是中国发射台', !isChinaPad({ name: 'Orbital Launch Pad 2', latitude: 25.99677, longitude: -97.15799 }))
const sorted = sortNotices(mixed).map((n) => n.name)
check('排序：生效中→提前预警→已结束→已取消', sorted.join(',') === 'B-live,D-soon,A-past,C-cancel', sorted.join(','))
check('排序不改变条数', sortNotices(mixed).length === mixed.length)
check('sortNotices 不原地改数组', mixed[0].name === 'C-cancel')
check('页面用排序后的列表', /sortNotices\(/.test(js))

// ── 8) 选中高亮 / 聚焦 ──
console.log('\n[8] 选中高亮与聚焦')
const allow = { NOTAM: true, NAVWARNING: true, ADP_LINK_FILE: true }
const plain = buildPolygonsFromNotices(DEMO_NOTICES, allow, {})
const target = DEMO_NOTICES.find((n) => hasGeometry(n))
const picked = buildPolygonsFromNotices(DEMO_NOTICES, allow, { selectedKey: target.noticeKey })
check('选中不改变多边形数量', picked.length === plain.length, `${picked.length}/${plain.length}`)
const selStroke = Math.max(...picked.map((p) => p.strokeWidth))
check('选中描边加粗到 4', selStroke === 4, String(selStroke))
const alphas = picked.map((p) => p.fillColor.slice(-2).toUpperCase())
check('未选中被淡化', alphas.includes('1F') && alphas.includes('73'), [...new Set(alphas)].join(','))
check('无选中时不淡化', plain.every((p) => !/1F$/i.test(p.fillColor)))

const dark = styleForType('NOTAM', { light: false })
const light = styleForType('NOTAM', { light: true })
check('浅色主题填充更实', parseInt(light.fillColor.slice(-2), 16) > parseInt(dark.fillColor.slice(-2), 16), `${dark.fillColor} → ${light.fillColor}`)
check('cancelled 走灰色', styleForType('NOTAM', { cancelled: true }).strokeColor === '#8E8E93')
check('提前预警走橙色', styleForType('NOTAM', { soon: true }).strokeColor === '#FF9500')
const soonPoly = buildPolygonsFromNotices(
  [Object.assign({}, target, { statusTone: 'soon' })],
  allow,
  {}
)
check('预警多边形橙色填充', soonPoly.length > 0 && soonPoly[0].strokeColor === '#FF9500', soonPoly[0] && soonPoly[0].strokeColor)

const focus = fitNotice(target)
check('fitNotice 返回可用视野', !!focus && focus.scale >= 3 && focus.scale <= 20 && focus.includePoints.length >= 2, focus && `scale=${focus.scale} pts=${focus.includePoints.length}`)
check('fitNotice 中心落在通告内', !!focus && Math.abs(focus.latitude) <= 90 && Math.abs(focus.longitude) <= 180)
check('fitNotice 无几何返回 null', fitNotice({ areas: [] }) === null)

// ── 9) 交互契约 ──
console.log('\n[9] 交互契约')
check('列表项可点选高亮', /bindtap="selectNotice"/.test(wxml) && /selectNotice\(e\)/.test(js))
check('详情弹层与遮罩', /sn-mask/.test(wxml) && /sn-sheet/.test(wxml) && /selectedNotice/.test(js))
check('遮罩点击收起但留高亮', /minimizeDetail/.test(js) && /selectedNotice: null \}\)/.test(js))
check('关闭按钮清除高亮', /closeDetail\(\)/.test(js) && /selectedKey: ''/.test(js))
check('复制原文/来源', /copyRawText/.test(js) && /copySourceLink/.test(js) && /setClipboardData/.test(js))
check('面板可折叠', /togglePanel/.test(js) && /panelCollapsed/.test(wxml))
check('重置视野', /resetView/.test(js) && /重置视野/.test(wxml))
check('折叠态有摘要', /mini-summary-row/.test(wxml) && /stats\.notam/.test(wxml))
check('预警状态 chip', /预警/.test(wxml) && /showSoon/.test(js) && /data-key="showSoon"/.test(wxml))
check('中国筛选 chip', /data-key="chinaOnly"/.test(wxml) && /toggleChinaView/.test(js) && /noticeChinaVisible/.test(js))
check('中国按钮在地图工具栏', /map-action-container/.test(wxml) && /bindtap="toggleChinaView"/.test(wxml) && /map-action-china-wrap/.test(wxml))
check('中国航警按情报区筛选', /toggleFirFilter/.test(js) && /firChips/.test(wxml) && /全部情报区/.test(wxml))
check('中国航警列表用情报区标题', /displayName/.test(wxml) && /chinaNoticeTitle/.test(read(`${DIR}/utils/notice-format.js`)))
check('中国航警核对条', /sn-sync/.test(wxml) && /cadenceText/.test(js) && /syncUnchanged/.test(wxml))
check('中国空态文案', /没有中国相关通告/.test(wxml))
check('四态状态筛选', /showLive/.test(js) && /showEnded/.test(js) && /showCancelled/.test(js) && /refreshVisible/.test(js))
check('详情卡提前预警文案', /selectedNotice\.leadText/.test(wxml))
check('生效窗口本地时间标注', /生效窗口（本地时间）/.test(wxml))
// map 是原生组件，数值属性写成字面量会以字符串下发；scale 区间已由 scaleFromSpan 兜住（3~20）
const mapTag = (wxml.match(/<map[\s\S]*?\/>/) || [''])[0]
check(
  'map 数值属性走 mustache 绑定',
  mapTag.length > 0 && !/\s[a-z-]+="\d+"/.test(mapTag),
  (mapTag.match(/\s[a-z-]+="\d+"/g) || []).join(' ')
)

// ── 10) 分享好友 / 朋友圈 / 分享冷启动 ──
console.log('\n[10] 分享链路')
const listJs = read(`${DIR}/entry-list.js`)
const listWxml = read(`${DIR}/entry-list.wxml`)
check('详情页有 onShareAppMessage', /onShareAppMessage\(\)/.test(js))
check('详情页有 onShareTimeline', /onShareTimeline\(\)/.test(js))
check('列表页有 onShareAppMessage', /onShareAppMessage\(\)/.test(listJs))
check('列表页有 onShareTimeline', /onShareTimeline\(\)/.test(listJs))
// onShareTimeline 只认 title/query/imageUrl，写 path 会被忽略
const timelineBlock = js.slice(js.indexOf('onShareTimeline()'))
check('朋友圈不误传 path', !/path:/.test(timelineBlock.slice(0, 200)))
check('朋友圈带 entryKey query', /entryKey=/.test(timelineBlock) && /withShareStampQuery/.test(timelineBlock))
check('列表/详情分享带 sst', /withShareStampPath/.test(js) && /withShareStampPath/.test(listJs))
check('列表/详情复用 share-gate', /checkShareEntryGate/.test(js) && /checkShareEntryGate/.test(listJs) && /space_notices/.test(js))

const { ROUTES, buildUrl } = require('../utils/routes.js')
const ENTRY_KEY = 'launch-starship-flight-13'
const sharePath = buildUrl(ROUTES.SPACE_NOTICE_MAP, { entryKey: ENTRY_KEY })
const appJson = JSON.parse(read('app.json'))
const monitorSub = (appJson.subPackages || []).find((p) => /monitor-pages/.test(p.root))
const registered = (monitorSub.pages || []).map((p) => `/${monitorSub.root.replace(/\/$/, '')}/${p}`)
check('分享 path 指向已注册页面', registered.indexOf(sharePath.split('?')[0]) !== -1, sharePath.split('?')[0])
// 冷启动还原：微信把 query 交给 onLoad(options)，页面再 decodeURIComponent
const parsedQuery = {}
;(sharePath.split('?')[1] || '').split('&').forEach((kv) => {
  const [k, v] = kv.split('=')
  parsedQuery[decodeURIComponent(k)] = decodeURIComponent(v)
})
check('分享 path 可还原 entryKey', parsedQuery.entryKey === ENTRY_KEY, parsedQuery.entryKey)
check('onLoad 解码 entryKey', /normalizeEntryKey\(/.test(js) && /options\.entryKey/.test(js) && /decodeURIComponent/.test(read(`${DIR}/utils/china-filter.js`)))
check('兼容旧 ll2Id 分享', /normalizeEntryKey\(/.test(js) && /options\.ll2Id/.test(js))
check('无 id 时回落列表页', /ROUTES\.SPACE_NOTICE_LIST/.test(js))
check('无轨迹时隐藏轨迹 chip', /hasTrajectory/.test(js) && /wx:if="\{\{hasTrajectory\}\}"/.test(wxml))
check('列表用 entryKey 打开详情', /entryKey/.test(listJs) && /data-key="\{\{item\.entryKey\}\}"/.test(listWxml))
check('列表即将/历史分段', /upcoming/.test(listJs) && /past/.test(listJs) && /即将/.test(listWxml) && /历史发射/.test(listWxml))
check('列表中国通告入口', /中国航警公告/.test(listJs) && /openChinaMap/.test(listJs) && /CHINESE_COLLECTION_KEY/.test(listJs))
check('列表页标题发射航警地图', /发射航警地图/.test(listWxml))
check('中国航警可回全部任务', /openAllMissions/.test(js) && /全部任务/.test(wxml))
check('中国加载态标题', /正在读取中国航警公告/.test(wxml))
check('无参默认进中国合集', /if \(!entryKey && !ll2Id\) entryKey = CHINESE_COLLECTION_KEY/.test(js))

// 分享冷启动不能被功能开关误杀：必须 fail-open
const flag = read('utils/space-notices-feature.js')
check('功能开关 fail-open', /failClosed:\s*false/.test(flag) && /defaultOff:\s*false/.test(flag))
// 直接进入（栈深 1）时返回键变主页图标，否则分享进来点返回是死键
check('详情页直进返回兜底', /isDirectEntry \? 'nav-back--home'/.test(wxml) && /_fallbackTab/.test(js))
check('列表页直进返回兜底', /isDirectEntry \? 'top-nav-slot--home'/.test(listWxml) && /_fallbackTab/.test(listJs))

const failed = results.filter((r) => !r.ok)
console.log(`\n=== result: ${results.length - failed.length} passed, ${failed.length} failed ===`)
if (failed.length) {
  failed.forEach((f) => console.log(' -', f.name, f.detail))
  process.exit(1)
}
