/**
 * 激励广告「看满 N 秒」判定：环绕全景 15 秒，其它功能仍须看完。
 * node --test test/ad-unlock-watch.test.js
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const {
  getAdMinWatchSec,
  getAdUnlockActionLabel,
  qualifyRewardedAdClose
} = require('../utils/ad-unlock.js')

test('仅环绕全景要求看满 15 秒，其它 productId 仍须看完', () => {
  assert.equal(getAdMinWatchSec('starbase_orbit_pano'), 15)
  assert.equal(getAdMinWatchSec('mission_replay'), 0)
  assert.equal(getAdMinWatchSec('agency_encyclopedia'), 0)
  assert.equal(getAdMinWatchSec('evtvid:1'), 0)
  assert.equal(getAdMinWatchSec(''), 0)
  assert.equal(getAdMinWatchSec(null), 0)
})

test('门控文案：环绕全景写明 15 秒，其它保持原句', () => {
  assert.equal(getAdUnlockActionLabel('starbase_orbit_pano'), '看15秒广告免费体验')
  assert.equal(getAdUnlockActionLabel('mission_replay'), '看广告免费体验')
})

test('minWatchSec=0：无 res 仍视为看完（旧基础库）', () => {
  assert.equal(qualifyRewardedAdClose(null, { minWatchSec: 0, watchedMs: 0 }), true)
  assert.equal(qualifyRewardedAdClose(undefined, { minWatchSec: 0 }), true)
  assert.equal(qualifyRewardedAdClose({ isEnded: true }, { minWatchSec: 0, watchedMs: 0 }), true)
  assert.equal(qualifyRewardedAdClose({ isEnded: false }, { minWatchSec: 0, watchedMs: 99999 }), false)
})

test('minWatchSec=15：无 res 不自动放行', () => {
  assert.equal(qualifyRewardedAdClose(null, { minWatchSec: 15, watchedMs: 0 }), false)
  assert.equal(qualifyRewardedAdClose(undefined, { minWatchSec: 15, watchedMs: 14000 }), false)
  assert.equal(qualifyRewardedAdClose(null, { minWatchSec: 15, watchedMs: 15000 }), true)
})

test('minWatchSec=15：看完或前台满 15 秒才算过', () => {
  assert.equal(qualifyRewardedAdClose({ isEnded: true }, { minWatchSec: 15, watchedMs: 1000 }), true)
  assert.equal(qualifyRewardedAdClose({ isEnded: false }, { minWatchSec: 15, watchedMs: 14999 }), false)
  assert.equal(qualifyRewardedAdClose({ isEnded: false }, { minWatchSec: 15, watchedMs: 15000 }), true)
  assert.equal(qualifyRewardedAdClose({ isEnded: false }, { minWatchSec: 15, watchedMs: -5 }), false)
})

function delay(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms)
  })
}

function loadAdUnlockWithMockAd(adFactory) {
  const id = require.resolve('../utils/ad-unlock.js')
  delete require.cache[id]
  global.getCurrentPages = function () {
    return [{ route: 'pages/index/index' }]
  }
  global.wx = Object.assign({}, global.wx || {}, {
    showToast() {},
    getMenuButtonBoundingClientRect() {},
    getWindowInfo() {},
    createRewardedVideoAd: adFactory
  })
  return require('../utils/ad-unlock.js')
}

test('广告关闭后复用实例，不立刻 destroy', async () => {
  let destroyCount = 0
  let loadCount = 0
  let closeHandler = null
  const ad = {
    show() { return Promise.resolve() },
    load() {
      loadCount += 1
      return Promise.resolve()
    },
    destroy() { destroyCount += 1 },
    onError() {},
    onClose(cb) { closeHandler = cb },
    offClose() {},
    offError() {},
    offLoad() {}
  }
  const mod = loadAdUnlockWithMockAd(function () { return ad })
  const p = mod.showRewardedVideoAd({ successToast: '', failToast: '', holdMs: 0 })
  await delay(400)
  assert.equal(typeof closeHandler, 'function')
  closeHandler({ isEnded: true })
  const ok = await p
  assert.equal(ok, true)
  assert.equal(destroyCount, 0)
  assert.ok(loadCount >= 1)
  delete require.cache[require.resolve('../utils/ad-unlock.js')]
})

test('createRewardedVideoAd 抛错时不向外冒泡', async () => {
  const mod = loadAdUnlockWithMockAd(function () {
    throw new TypeError("Cannot read properties of undefined (reading 'adProxy')")
  })
  const ok = await mod.showRewardedVideoAd({ successToast: '', failToast: '', holdMs: 0 })
  assert.equal(ok, false)
  delete require.cache[require.resolve('../utils/ad-unlock.js')]
})
