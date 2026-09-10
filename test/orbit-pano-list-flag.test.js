/**
 * node --test test/orbit-pano-list-flag.test.js
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const {
  missionHasOrbitPano,
  applyOrbitPanoFlags,
  buildOrbitPanoFlagPatch
} = require('../utils/orbit-pano-list-flag.js')

test('配置未就绪时 failClosed，不抛错', () => {
  assert.equal(missionHasOrbitPano(null), false)
  assert.equal(missionHasOrbitPano({ rocketName: 'Falcon 9' }), false)
  assert.doesNotThrow(() => applyOrbitPanoFlags(null))
  assert.doesNotThrow(() => applyOrbitPanoFlags('nope'))
  const list = [
    null,
    { rocketName: '星舰', name: 'Starbase' },
    { boosterInfo: 'not-an-object', rocketName: 1 },
    { rocketName: 'Falcon 9', padLocation: 'SLC-40', boosterInfo: { landingType: 'ASDS' } }
  ]
  assert.doesNotThrow(() => applyOrbitPanoFlags(list))
  assert.equal(list[1].hasOrbitPano, false)
  assert.equal(list[3].hasOrbitPano, false)
  assert.deepEqual(buildOrbitPanoFlagPatch(null, 'upcomingMissions'), {})
  assert.deepEqual(buildOrbitPanoFlagPatch(list, ''), {})
})
