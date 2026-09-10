/**
 * 单测：utils/countdown-panel-gate.js 倒计时大卡门控
 * 运行：npm test   或   node --test test/countdown-panel-gate.test.js
 */
const test = require('node:test')
const assert = require('node:assert/strict')

const {
  isUncertainPanelStatusId,
  isCoarseNetPrecision,
  isCountdownPanelEligible
} = require('../utils/countdown-panel-gate.js')

test('isUncertainPanelStatusId：仅 TBD/Hold', () => {
  assert.equal(isUncertainPanelStatusId(2), true)
  assert.equal(isUncertainPanelStatusId(5), true)
  assert.equal(isUncertainPanelStatusId(8), false)
  assert.equal(isUncertainPanelStatusId(1), false)
  assert.equal(isUncertainPanelStatusId(null), false)
})

test('isCoarseNetPrecision：Day 及更粗为占位', () => {
  assert.equal(isCoarseNetPrecision('Day'), true)
  assert.equal(isCoarseNetPrecision('Month'), true)
  assert.equal(isCoarseNetPrecision('Hour'), false)
  assert.equal(isCoarseNetPrecision('Minute'), false)
  assert.equal(isCoarseNetPrecision(''), false)
})

test('isCountdownPanelEligible：TBD/Hold 不合格；TBC+Hour 合格；缺字段放行', () => {
  assert.equal(isCountdownPanelEligible({ id: 'a', statusId: 2 }), false)
  assert.equal(isCountdownPanelEligible({ id: 'a', statusId: 5 }), false)
  assert.equal(
    isCountdownPanelEligible({ id: 'a', statusId: 8, netPrecision: 'Hour' }),
    true
  )
  assert.equal(
    isCountdownPanelEligible({ id: 'a', statusId: 1, netPrecision: 'Month' }),
    false
  )
  assert.equal(isCountdownPanelEligible({ id: 'a' }), true)
  assert.equal(isCountdownPanelEligible(null), false)
  assert.equal(
    isCountdownPanelEligible({ id: 'a', statusId: 1 }, { status: { id: 5 } }),
    false
  )
})
