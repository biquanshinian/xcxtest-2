/**
 * node cloudfunctions/sendLaunchReminder/pre-alert-gate.test.js
 * 发射前推送状态门控：TBD/Hold/粗精度占位时间不发；TBC/Go 放行。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const {
  isUncertainPreAlertStatusId,
  isCoarseNetPrecision,
  isLaunchPreAlertEligible,
  isNetChangeAnnouncable
} = require('./pre-alert-gate.js')

test('状态门控：TBD/Hold 拦截，Go/TBC/飞行前未知放行', () => {
  assert.equal(isUncertainPreAlertStatusId(2), true, 'TBD 拦截')
  assert.equal(isUncertainPreAlertStatusId(5), true, 'Hold 拦截')
  assert.equal(isUncertainPreAlertStatusId(1), false, 'Go 放行')
  assert.equal(isUncertainPreAlertStatusId(8), false, 'TBC 放行（中国发射常态）')
  assert.equal(isUncertainPreAlertStatusId(null), false, '无状态放行（旧文档兼容）')
})

test('精度门控：Day/Month 等占位拦截，Second/Minute/Hour 放行', () => {
  assert.equal(isCoarseNetPrecision('Day'), true)
  assert.equal(isCoarseNetPrecision('Week'), true)
  assert.equal(isCoarseNetPrecision('Month'), true)
  assert.equal(isCoarseNetPrecision('Quarter 3'), true)
  assert.equal(isCoarseNetPrecision('Year'), true)
  assert.equal(isCoarseNetPrecision('Second'), false)
  assert.equal(isCoarseNetPrecision('Minute'), false)
  assert.equal(isCoarseNetPrecision('Hour'), false)
  assert.equal(isCoarseNetPrecision(''), false, '缺失放行（旧文档兼容）')
  assert.equal(isCoarseNetPrecision(null), false)
})

test('组合门控 isLaunchPreAlertEligible', () => {
  assert.equal(isLaunchPreAlertEligible({ statusId: 1, netPrecision: 'Minute' }), true, 'Go+分钟级 → 发')
  assert.equal(isLaunchPreAlertEligible({ statusId: 8, netPrecision: 'Hour' }), true, 'TBC+小时级 → 发')
  assert.equal(isLaunchPreAlertEligible({ statusId: 2, netPrecision: 'Month' }), false, 'TBD 占位 → 不发')
  assert.equal(isLaunchPreAlertEligible({ statusId: 1, netPrecision: 'Day' }), false, 'Go 但 Day 占位 → 不发')
  assert.equal(isLaunchPreAlertEligible({ statusId: 5, netPrecision: 'Minute' }), false, 'Hold → 不发')
  assert.equal(isLaunchPreAlertEligible({}), true, '旧文档无字段 → 放行不误伤')
  assert.equal(isLaunchPreAlertEligible(null), false, '空对象 → 不发')
})

test('改期播报判定 isNetChangeAnnouncable：Hold 放行、TBD/占位拦截', () => {
  assert.equal(isNetChangeAnnouncable({ statusId: 5, netPrecision: 'Minute' }), true, 'Hold+推迟 → 正是要播报的')
  assert.equal(isNetChangeAnnouncable({ statusId: 1, netPrecision: 'Second' }), true)
  assert.equal(isNetChangeAnnouncable({ statusId: 2, netPrecision: 'Minute' }), false, 'TBD 新时间不可信')
  assert.equal(isNetChangeAnnouncable({ statusId: 1, netPrecision: 'Month' }), false, '月末占位新日期不播报')
  assert.equal(isNetChangeAnnouncable({}), true, '旧文档无字段 → 放行')
})

console.log('pre-alert-gate.test.js: all assertions queued (node:test will report)')
