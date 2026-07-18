const test = require('node:test')
const assert = require('node:assert/strict')
const { inferTerminalStatusFromUpdates } = require('../utils/ll2-updates-outcome.js')

test('不把上一发火箭失败导致延期误判为当前任务失败', () => {
  const result = inferTerminalStatusFromUpdates([{ comment: 'Delayed to TBD due to previous H3 launch failure.' }])
  assert.equal(result, null)
})

test('仍识别 LL2 对当前任务的直接失败结论', () => {
  const result = inferTerminalStatusFromUpdates([{ comment: 'Launch failure.' }])
  assert.equal(result.kind, 'failure')
  assert.equal(result.status.id, 4)
})
