/**
 * 首页封路灯箱文案：压成单行，带上全部时段/延迟，不截成 schedule[0]。
 * 运行：node --test test/progress-road-closure-ticker.test.js
 */
const test = require('node:test')
const assert = require('node:assert/strict')

const { buildRoadClosureTickerText } = require('../utils/progress-road-closure.js')

test('多条海滩时段全部进入灯箱，不只取第一条', () => {
  const ticker = buildRoadClosureTickerText({
    beachStatus: 'Boca Chica Beach 计划封闭时段',
    beachClosureSchedule: [
      '8月23日 08:00–12:00',
      '8月23日 18:00–22:00'
    ],
    message: 'Boca Chica Beach 计划封闭时段\n8月23日 08:00–12:00'
  })
  assert.match(ticker.displayText, /08:00/)
  assert.match(ticker.displayText, /18:00/)
  assert.ok(!/[\r\n]/.test(ticker.displayText))
  assert.equal(ticker.statusText, 'Boca Chica Beach 计划封闭时段')
  assert.match(ticker.detailText, /18:00–22:00/)
})

test('道路更新与延迟都保留，换行压成间隔点', () => {
  const ticker = buildRoadClosureTickerText({
    beachStatus: 'Boca Chica Beach 当前开放',
    roadStatusLabel: '道路延迟',
    roadUpdates: [{ description: '发射台至产线', date: 'July 17 11:30 AM to July 17 2:30 PM' }],
    roadDelays: ['July 17 11:30 AM to July 17 2:30 PM'],
    timeRange: 'July 17 11:30 AM to July 17 2:30 PM',
    message: 'Boca Chica Beach 当前开放\n道路延迟\n发射台至产线（July 17 11:30 AM to July 17 2:30 PM）'
  })
  assert.match(ticker.statusText, /Beach 当前开放/)
  assert.match(ticker.statusText, /道路延迟/)
  assert.match(ticker.detailText, /发射台至产线/)
  assert.match(ticker.detailText, /11:30/)
  assert.ok(!/[\r\n]/.test(ticker.displayText))
  assert.ok(ticker.displayText.indexOf('  ·  ') >= 0)
})

test('无结构化字段时回退到扁平 message', () => {
  const ticker = buildRoadClosureTickerText({
    message: '星舰基地发射前道路封路通知\n今晚 20:00-23:00'
  })
  assert.match(ticker.displayText, /今晚 20:00-23:00/)
  assert.ok(!/[\r\n]/.test(ticker.displayText))
})
