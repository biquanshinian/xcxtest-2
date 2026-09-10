/**
 * node --test test/ip-fx.test.js
 */
if (!global.wx) {
  global.wx = {}
}

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const ipFx = require('../subpackages/rocket-3d/ip-fx.js')

test('展开 IP 窗会中度震动并播科技音', () => {
  const types = []
  let played = false
  const prevV = global.wx.vibrateShort
  const prevA = global.wx.createInnerAudioContext
  global.wx.vibrateShort = function (opts) {
    types.push((opts && opts.type) || '')
  }
  global.wx.createInnerAudioContext = function () {
    return {
      src: '',
      volume: 1,
      obeyMuteSwitch: false,
      play: function () { played = true },
      stop: function () {},
      seek: function () {},
      destroy: function () {}
    }
  }
  ipFx.dispose()
  ipFx.playOpen()
  assert.deepEqual(types, ['medium'])
  assert.equal(played, true)
  assert.match(ipFx.OPEN_SRC, /ip-open\.wav$/)
  const wav = path.join(__dirname, '../subpackages/rocket-3d/assets/ip-open.wav')
  assert.equal(fs.existsSync(wav), true)
  assert.ok(fs.statSync(wav).size < 4 * 1024, '开窗音应远小于代码包图音 200KB 预算')
  ipFx.dispose()
  global.wx.vibrateShort = prevV
  global.wx.createInnerAudioContext = prevA
})
