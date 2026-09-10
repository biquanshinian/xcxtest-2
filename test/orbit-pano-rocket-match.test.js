/**
 * node --test test/orbit-pano-rocket-match.test.js
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const {
  rocketIdentityKey,
  matchOrbitPanoRocket,
  translateRocketName
} = require('../utils/rocket-name-i18n.js')

test('长征十号乙与 Long March 10B / CZ-10B 同一身份键', () => {
  assert.equal(rocketIdentityKey('长征十号乙'), 'cz10b')
  assert.equal(rocketIdentityKey('Long March 10B'), 'cz10b')
  assert.equal(rocketIdentityKey('CZ-10B'), 'cz10b')
  assert.equal(rocketIdentityKey('长征十号乙 | 演示飞行'), 'cz10b')
  assert.equal(translateRocketName('Long March 10B'), '长征十号乙')
})

test('长征十号甲 / 长征十号 不与乙混用', () => {
  assert.equal(rocketIdentityKey('长征十号甲'), 'cz10a')
  assert.equal(rocketIdentityKey('Long March 10A'), 'cz10a')
  assert.equal(rocketIdentityKey('长征十号'), 'cz10')
  assert.notEqual(rocketIdentityKey('长征十号乙'), rocketIdentityKey('长征十号甲'))
  assert.notEqual(rocketIdentityKey('长征十号乙'), rocketIdentityKey('长征十号'))
})

test('中文任务详情能匹配后台英文锁定型号', () => {
  const mission = {
    rocketName: '长征十号乙',
    name: '长征十号乙 | 演示飞行',
    missionName: '演示飞行',
    _langPack: {
      rocketNameEn: 'Long March 10B',
      rocketNameZh: '长征十号乙',
      nameEn: 'Long March 10B | Demo Flight',
      nameZh: '长征十号乙 | 演示飞行'
    }
  }
  assert.equal(matchOrbitPanoRocket('Long March 10B', mission), true)
  assert.equal(matchOrbitPanoRocket('长征十号乙', mission), true)
  assert.equal(matchOrbitPanoRocket('Long March 10A', mission), false)
  assert.equal(matchOrbitPanoRocket('Falcon 9', mission), false)
})

test('仅中文显示、无 langPack 时仍能匹配', () => {
  const mission = {
    rocketName: '长征十号乙',
    name: '长征十号乙 | 演示飞行'
  }
  assert.equal(matchOrbitPanoRocket('Long March 10B', mission), true)
})

test('星舰 / 朱雀三号家族仍匹配', () => {
  assert.equal(matchOrbitPanoRocket('Starship', { rocketName: '星舰', name: 'Starbase' }), true)
  assert.equal(matchOrbitPanoRocket('Zhuque-3', { rocketName: '朱雀三号' }), true)
})
