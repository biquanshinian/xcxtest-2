/**
 * node --test test/rocket-3d-list-flag.test.js
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const { ingestMediaMap } = require('../utils/rocket-3d-ready.js')
const { hasReadyRocketModel } = require('../pages/mission-detail/utils/rocket-3d-gate.js')
const {
  missionHasRocket3d,
  applyRocket3dFlags,
  buildRocket3dFlagPatch
} = require('../utils/rocket-3d-list-flag.js')

test('media map 未就绪时 failClosed，不抛错', () => {
  ingestMediaMap({})
  assert.equal(missionHasRocket3d(null), false)
  assert.equal(missionHasRocket3d({ rocketName: '星舰' }), false)
  assert.doesNotThrow(() => applyRocket3dFlags(null))
  assert.doesNotThrow(() => applyRocket3dFlags('nope'))
  const list = [null, { rocketName: '星舰' }, { rocketName: 1 }]
  assert.doesNotThrow(() => applyRocket3dFlags(list))
  assert.equal(list[1].hasRocket3d, false)
  assert.deepEqual(buildRocket3dFlagPatch(null, 'upcomingMissions'), {})
  assert.deepEqual(buildRocket3dFlagPatch(list, ''), {})
})

test('已启用 GLB 的型号才打标，其它任务不显示入口', () => {
  ingestMediaMap({
    'models/rockets/starship.glb':
      'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/models/rockets/starship.glb'
  })
  try {
    const list = [
      { rocketName: '星舰', _langPack: { rocketNameEn: 'Starship' } },
      { rocketName: 'Falcon 9', _langPack: { rocketNameEn: 'Falcon 9' } },
      { rocketName: '长征五号' }
    ]
    applyRocket3dFlags(list)
    assert.equal(list[0].hasRocket3d, true)
    assert.equal(list[1].hasRocket3d, false)
    assert.equal(list[2].hasRocket3d, false)
    assert.equal(missionHasRocket3d(list[0]), true)
    const patch = buildRocket3dFlagPatch(list, 'upcomingMissions')
    assert.deepEqual(patch, {})
    list[0].hasRocket3d = false
    assert.deepEqual(buildRocket3dFlagPatch(list, 'upcomingMissions'), {
      'upcomingMissions[0].hasRocket3d': true
    })
  } finally {
    ingestMediaMap({})
  }
})

test('列表打标与详情门控同一套：有模型一致，无模型都关', () => {
  ingestMediaMap({
    'models/rockets/starship.glb':
      'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/models/rockets/starship.glb',
    'models/rockets/long-march-series.glb':
      'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/models/rockets/long-march-series.glb'
  })
  try {
    const cases = [
      { rocketName: '星舰', rocketNameEn: 'Starship' },
      { rocketName: '猎鹰9号', rocketNameEn: 'Falcon 9' },
      { rocketName: '长征五号', rocketConfiguration: { name: 'Long March 5' } },
      { rocketName: 'Electron' }
    ]
    for (const row of cases) {
      assert.equal(
        missionHasRocket3d(row),
        hasReadyRocketModel({
          rocketName: row.rocketName,
          rocketNameEn: row.rocketNameEn,
          configuration: row.rocketConfiguration
        }),
        JSON.stringify(row)
      )
    }
    assert.equal(
      missionHasRocket3d({
        rocketName: '星舰',
        _langPack: { rocketNameEn: 'Starship' }
      }),
      true
    )
  } finally {
    ingestMediaMap({})
  }
})
