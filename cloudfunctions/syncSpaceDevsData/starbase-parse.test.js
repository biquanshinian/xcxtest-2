/**
 * starbase.texas.gov 封路解析回归测试
 * fixture 为 2026-07-17 官网真实快照：横幅写 "Jul. 17"（缩写），Road Updates 明细写 "July 17"（全称），
 * 且 Road Updates 区块即使有延迟也常驻 "No road delays." 占位文本 —— 三个历史 bug 的复现页面。
 * 运行：npm test（node --test）
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')

const {
  parseStarbaseHtml,
  parseStarbaseTimeRange,
  usCentralOffsetHours,
  parseRoadUpdateItems,
  parsePublicOrders
} = require('./starbase-parse.js')

const FIXTURE = fs.readFileSync(
  path.join(__dirname, 'fixtures', 'starbase-2026-07-17.html'),
  'utf8'
)

// 官网快照当天：2026-07-17 10:00 AM CDT（延迟窗口 11:30 AM ~ 2:30 PM 之前）
const NOW = Date.UTC(2026, 6, 17, 15, 0)

test('fixture: 有延迟明细时判为道路延迟，不被 "No road delays." 占位文本误导', () => {
  const r = parseStarbaseHtml(FIXTURE, NOW)
  assert.strictEqual(r.success, true)
  assert.strictEqual(r.roadOpen, false)
  assert.strictEqual(r.roadStatusLabel, '道路延迟')
})

test('fixture: Road Updates 全称月份（July）明细解析成功', () => {
  const r = parseStarbaseHtml(FIXTURE, NOW)
  assert.strictEqual(r.roadUpdates.length, 1)
  // enrich 后 description 已翻译（Pad to Production → 发射台至产线），date 保留英文
  assert.strictEqual(r.roadUpdates[0].description, '发射台至产线')
  assert.strictEqual(r.roadUpdates[0].date, 'July 17 11:30 AM to July 17 2:30 PM')
  assert.ok(r.roadDelays.some((s) => /July 17 11:30 AM to July 17 2:30 PM/.test(s)))
  assert.ok(/July 17 11:30 AM to July 17 2:30 PM/.test(r.timeRange))
})

test('fixture: 横幅告警保留（不再被清空）', () => {
  const r = parseStarbaseHtml(FIXTURE, NOW)
  assert.ok(r.bannerAlerts.length > 0)
  assert.ok(r.bannerAlerts.some((s) => /Jul\.\s*17 11:30 AM/.test(s)))
})

test('fixture: 市长令 Order No.（带点）切块解析成功', () => {
  const r = parseStarbaseHtml(FIXTURE, NOW)
  assert.strictEqual(r.publicOrders.length, 2)
  // enrich 后 orderNo 已翻译（Order No. → 令号）
  assert.ok(/2026-14/.test(r.publicOrders[0].orderNo))
  assert.ok(/2026-13/.test(r.publicOrders[1].orderNo))
  assert.strictEqual(r.publicOrders[0].primaryPeriod, 'July 18 from 12:00 PM to 8:30 PM')
  assert.ok(r.publicOrders[0].bodyTextZh && r.publicOrders[0].bodyTextZh.length > 0)
  assert.ok(r.publicNotice.length > 0)
})

test('fixture: 海滩 "Boca Chica Beach is open." 判定为开放', () => {
  const r = parseStarbaseHtml(FIXTURE, NOW)
  assert.strictEqual(r.beachOpen, true)
})

test('fixture: 延迟时间窗解析为 CDT epoch（11:30 AM ~ 2:30 PM = UTC 16:30 ~ 19:30）', () => {
  const r = parseStarbaseHtml(FIXTURE, NOW)
  assert.ok(r.delayWindow)
  assert.strictEqual(r.delayWindow.startAt, Date.UTC(2026, 6, 17, 16, 30))
  assert.strictEqual(r.delayWindow.endAt, Date.UTC(2026, 6, 17, 19, 30))
})

test('fixture: message 包含道路延迟与明细', () => {
  const r = parseStarbaseHtml(FIXTURE, NOW)
  assert.ok(/道路延迟/.test(r.message))
  assert.ok(/发射台至产线/.test(r.message))
})

test('真无延迟页面：不误报', () => {
  const html = `
    <html><body>
      <h1>Beach And Road Access</h1>
      <h2>BEACH Access Status</h2>
      <div>Boca Chica Beach is open.</div>
      <h2>Road Updates</h2>
      <div>No road delays.</div>
      <h2>Public Notice of Mayor's Order</h2>
      <h2>OTHER BEACHES TO VISIT</h2>
    </body></html>`
  const r = parseStarbaseHtml(html, NOW)
  assert.strictEqual(r.roadOpen, true)
  assert.strictEqual(r.roadStatusLabel, '当前无道路延迟')
  assert.strictEqual(r.beachOpen, true)
  assert.strictEqual(r.roadUpdates.length, 0)
  assert.strictEqual(r.delayWindow, null)
})

test('parseRoadUpdateItems: 缩写月份（旧格式）仍兼容', () => {
  const items = parseRoadUpdateItems(
    'Road Updates Description: Production to Pad Date: Jul. 20 8:00 AM to Jul. 20 11:00 AM',
    ''
  )
  assert.strictEqual(items.length, 1)
  assert.strictEqual(items[0].description, 'Production to Pad')
  assert.strictEqual(items[0].date, 'Jul. 20 8:00 AM to Jul. 20 11:00 AM')
})

test('parsePublicOrders: 正文引用的 Order No. 不会误切块', () => {
  const section =
    'Public Notice of Mayor\'s Order Order No. 2026-14 Pursuant to Mayor\'s Order No. 2026-14, ' +
    'issued under Texas Space Commission Order No. 2025-02, the City is temporarily closing the beach. ' +
    'Primary Closure Period July 18 from 12:00 PM to 8:30 PM Alternate Dates Revocation of Closure'
  const orders = parsePublicOrders(section)
  assert.strictEqual(orders.length, 1)
  assert.strictEqual(orders[0].orderNo, 'Order No. 2026-14')
  assert.ok(/temporarily closing/.test(orders[0].bodyText))
  assert.strictEqual(orders[0].primaryPeriod, 'July 18 from 12:00 PM to 8:30 PM')
})

test('parseStarbaseTimeRange: 全称/缩写/跨年与 DST 处理', () => {
  // CDT（夏令时，UTC-5）
  const summer = parseStarbaseTimeRange('July 17 11:30 AM to July 17 2:30 PM', NOW)
  assert.deepStrictEqual(summer, {
    startAt: Date.UTC(2026, 6, 17, 16, 30),
    endAt: Date.UTC(2026, 6, 17, 19, 30)
  })

  // 缩写月份等价
  const abbr = parseStarbaseTimeRange('Jul. 17 11:30 AM to Jul. 17 2:30 PM', NOW)
  assert.deepStrictEqual(abbr, summer)

  // CST（冬令时，UTC-6）
  const winterNow = Date.UTC(2026, 0, 10, 12, 0)
  const winter = parseStarbaseTimeRange('Jan. 15 9:00 AM to Jan. 15 5:00 PM', winterNow)
  assert.deepStrictEqual(winter, {
    startAt: Date.UTC(2026, 0, 15, 15, 0),
    endAt: Date.UTC(2026, 0, 15, 23, 0)
  })

  // 跨年时段：Dec 31 → Jan 1
  const nearNewYear = Date.UTC(2026, 11, 30, 12, 0)
  const cross = parseStarbaseTimeRange('Dec. 31 10:00 PM to Jan. 1 2:00 AM', nearNewYear)
  assert.ok(cross)
  assert.ok(cross.endAt > cross.startAt)
  assert.strictEqual(new Date(cross.endAt).getUTCFullYear(), 2027)

  // 无法解析时返回 null
  assert.strictEqual(parseStarbaseTimeRange('No road delays.', NOW), null)
})

test('usCentralOffsetHours: DST 边界', () => {
  assert.strictEqual(usCentralOffsetHours(2026, 0, 15), 6) // 1月 CST
  assert.strictEqual(usCentralOffsetHours(2026, 6, 17), 5) // 7月 CDT
  assert.strictEqual(usCentralOffsetHours(2026, 2, 7), 6) // DST 开始（3月第二个周日=3/8）之前
  assert.strictEqual(usCentralOffsetHours(2026, 2, 8), 5) // DST 开始当天
  assert.strictEqual(usCentralOffsetHours(2026, 10, 1), 6) // DST 结束（11月第一个周日=11/1）当天
})
