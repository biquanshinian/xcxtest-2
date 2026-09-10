/**
 * node --test test/privacy-tap-guard.test.js
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const {
  PRIVACY_TAP_GUARD_MS,
  PRIVACY_MODAL_HIDE_DELAY_MS,
  isPrivacyTapGuarded,
  nextPrivacyTapGuardUntil
} = require('../utils/privacy-tap-guard.js')

test('守卫时长覆盖同意按钮抬起后的残余点击', () => {
  assert.ok(PRIVACY_TAP_GUARD_MS >= 500)
  assert.ok(PRIVACY_MODAL_HIDE_DELAY_MS >= 200)
  assert.ok(PRIVACY_TAP_GUARD_MS > PRIVACY_MODAL_HIDE_DELAY_MS)
})

test('弹窗仍可见时一律挡住轮播点击', () => {
  assert.equal(
    isPrivacyTapGuarded({ globalData: { privacyModalVisible: true }, _privacyTapGuardUntil: 0 }, 1000),
    true
  )
})

test('改期弹窗可见时同样挡住轮播点击', () => {
  assert.equal(
    isPrivacyTapGuarded({ globalData: { netChangeModalVisible: true }, _privacyTapGuardUntil: 0 }, 1000),
    true
  )
})

test('守卫窗口内挡住，过期后放行', () => {
  const app = { globalData: {}, _privacyTapGuardUntil: 1500 }
  assert.equal(isPrivacyTapGuarded(app, 1499), true)
  assert.equal(isPrivacyTapGuarded(app, 1500), false)
  assert.equal(isPrivacyTapGuarded(app, 1501), false)
})

test('nextPrivacyTapGuardUntil 按指定窗口延后', () => {
  assert.equal(nextPrivacyTapGuardUntil(1000, 800), 1800)
  assert.equal(nextPrivacyTapGuardUntil(1000), 1000 + PRIVACY_TAP_GUARD_MS)
})
