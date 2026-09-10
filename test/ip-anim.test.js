/**
 * node --test test/ip-anim.test.js
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const { pickIpIdleClip } = require('../subpackages/rocket-3d/ip-anim.js')

test('没有片段就播不了', () => {
  assert.equal(pickIpIdleClip(null), null)
  assert.equal(pickIpIdleClip([]), null)
  assert.equal(pickIpIdleClip([{ name: 'empty', duration: 0, tracks: [] }]), null)
})

test('优先原地 idle，不抢走路', () => {
  const walk = { name: 'Walk', duration: 1.2, tracks: [{}] }
  const idle = { name: 'Idle_Breath', duration: 2, tracks: [{}] }
  const wave = { name: 'Wave', duration: 1, tracks: [{}] }
  assert.equal(pickIpIdleClip([walk, idle, wave]), idle)
  assert.equal(pickIpIdleClip([walk, wave]), wave)
  assert.equal(pickIpIdleClip([walk]), walk)
})
