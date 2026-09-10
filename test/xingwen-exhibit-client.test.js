/**
 * node --test test/xingwen-exhibit-client.test.js
 */
if (!global.wx) {
  global.wx = {
    getStorageSync() { return '' },
    setStorageSync() {},
    showToast() {},
    cloud: {}
  }
}

const test = require('node:test')
const assert = require('node:assert/strict')
const { buildLaunchContext, qualifyExhibitQuery, historyToApi, quotaDate, tickStreamHaptic, pulseCardHaptic } = require('../subpackages/rocket-3d/xingwen-exhibit-client.js')

test('本地日配额日期跟主站星问同一把尺子', () => {
  assert.equal(quotaDate(), new Date().toDateString())
  assert.notEqual(quotaDate(), '2026-09-08')
})

test('展陈问句会补上当前火箭名，方便对上型号卡', () => {
  const ctx = { rocketName: '朱雀三号' }
  assert.equal(qualifyExhibitQuery('多高', ctx), '朱雀三号 多高')
  assert.equal(qualifyExhibitQuery('朱雀三号多重', ctx), '朱雀三号多重')
  assert.equal(qualifyExhibitQuery('你好', ctx), '你好')
  assert.equal(qualifyExhibitQuery('多高', {}), '多高')
})

test('展陈上下文带上当前火箭，历史会丢掉报错气泡', () => {
  const ctx = buildLaunchContext({
    rocketName: '朱雀三号',
    length: '76 m',
    diameter: '5 m',
    intro: '可重复使用液体运载火箭'
  })
  assert.match(ctx.focusHint, /朱雀三号/)
  assert.match(ctx.focusHint, /76 m/)
  assert.equal(ctx.focusMission.name, '朱雀三号')
  assert.equal(ctx.uiCardReady, true)
  const api = historyToApi([
    { role: 'assistant', content: '嗨' },
    { role: 'user', content: '多高' },
    { role: 'assistant', content: '忙', error: true },
    { role: 'system', content: 'nope' }
  ])
  assert.deepEqual(api, [
    { role: 'assistant', content: '嗨' },
    { role: 'user', content: '多高' }
  ])
})

test('回复震动跟主站星问同一套：流式轻震节流，出卡中震', () => {
  const types = []
  const prev = global.wx.vibrateShort
  global.wx.vibrateShort = function (opts) {
    types.push((opts && opts.type) || '')
  }
  const bucket = { at: 0 }
  assert.equal(tickStreamHaptic(bucket), true)
  assert.equal(tickStreamHaptic(bucket), false)
  pulseCardHaptic()
  assert.deepEqual(types, ['light', 'medium'])
  global.wx.vibrateShort = prev
})
