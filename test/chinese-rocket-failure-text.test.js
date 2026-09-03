const test = require('node:test')
const assert = require('node:assert/strict')
const {
  getStatusBadgeText,
  getStatusCategory,
  getCountryDisplay,
  isChineseRocketContext,
  softenChineseRocketFailureText
} = require('../utils/api-request.js')
const { getStatusTextZh } = require('../utils/index-page-helpers.js')
const { projectBadgeOntoMission } = require('../utils/launch-status-store.js')

test('softenChineseRocketFailureText：部分失败优先整词替换', () => {
  assert.equal(softenChineseRocketFailureText('部分失败'), '部分失利')
  assert.equal(softenChineseRocketFailureText('失败'), '失利')
  assert.equal(softenChineseRocketFailureText('发射失败'), '发射失利')
  assert.equal(softenChineseRocketFailureText('已成功'), '已成功')
})

test('isChineseRocketContext：countryDisplay / 火箭名启发式', () => {
  assert.equal(isChineseRocketContext({ countryDisplay: '中国' }), true)
  assert.equal(isChineseRocketContext({ chineseRocket: true }), true)
  assert.equal(isChineseRocketContext({ name: 'Long March 2C | Test' }), true)
  assert.equal(isChineseRocketContext({ rocketName: 'Gravity-1' }), true)
  assert.equal(isChineseRocketContext({ countryDisplay: '美国' }), false)
  assert.equal(isChineseRocketContext({ name: 'Falcon 9 | Starlink' }), false)
})

test('getStatusBadgeText：中国箭失败/部分失败→失利', () => {
  const fail = { id: 4, name: 'Launch Failure', abbrev: 'Failure' }
  const partial = { id: 7, name: 'Partial Failure', abbrev: 'Partial Failure' }
  assert.equal(getStatusBadgeText(fail, getStatusCategory(fail)), '失败')
  assert.equal(
    getStatusBadgeText(fail, getStatusCategory(fail), { countryDisplay: '中国' }),
    '失利'
  )
  assert.equal(
    getStatusBadgeText(partial, getStatusCategory(partial), { chineseRocket: true }),
    '部分失利'
  )
  assert.equal(
    getStatusBadgeText(fail, getStatusCategory(fail), { countryDisplay: '美国' }),
    '失败'
  )
})

test('getStatusTextZh：字符串路径也软化', () => {
  assert.equal(getStatusTextZh('Launch Failure', { countryDisplay: '中国' }), '失利')
  assert.equal(getStatusTextZh('Partial Failure', true), '部分失利')
  assert.equal(getStatusTextZh('失败', { countryDisplay: '中国' }), '失利')
  assert.equal(getStatusTextZh('失败', { countryDisplay: '美国' }), '失败')
})

test('projectBadgeOntoMission：中国箭投影角标为失利', () => {
  const mission = {
    id: 'cn-fail-1',
    name: '长征二号丙 | 试验卫星',
    countryDisplay: '中国',
    statusBadgeText: '就绪'
  }
  const projected = projectBadgeOntoMission(mission, {
    id: 'cn-fail-1',
    status: { id: 4, name: 'Launch Failure', abbrev: 'Failure' },
    observedAtMs: Date.now(),
    source: 'resolve'
  })
  assert.equal(projected.statusBadgeText, '失利')
  assert.equal(projected.status, '失利')
  assert.equal(projected.statusCategory, 'failure')
})

test('结算瘦卡路径：Gravity-1 名推断中国并软化角标', () => {
  const name = 'Gravity-1 | Demo'
  const statusObj = { id: 4, name: 'Launch Failure', abbrev: 'Failure' }
  const category = getStatusCategory(statusObj)
  const countryDisplay = getCountryDisplay(null, null, { name })
  const badge = getStatusBadgeText(statusObj, category, {
    chineseRocket: countryDisplay === '中国',
    countryDisplay
  })
  assert.equal(countryDisplay, '中国')
  assert.equal(badge, '失利')
})
