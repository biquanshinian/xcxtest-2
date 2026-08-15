/**
 * node --test test/orbit-pano-match.test.js
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const {
  rocketNeedsOrbitPanoPad,
  inferOrbitPanoPadKey,
  inferOrbitPanoRecoveryKey,
  pickOrbitPanoItem,
  orbitPanoMissionAttemptsRecovery
} = require('../utils/rocket-name-i18n.js')

function item(partial) {
  return {
    id: partial.id || 'op_1',
    videoUrl: partial.videoUrl || 'https://example.com/a.mp4',
    enabled: true,
    ...partial
  }
}

test('猎鹰9号 / 猎鹰重型必须锁发射场，星舰/朱雀/长征不用', () => {
  assert.equal(rocketNeedsOrbitPanoPad('Falcon 9'), true)
  assert.equal(rocketNeedsOrbitPanoPad('Falcon 9 Block 5'), true)
  assert.equal(rocketNeedsOrbitPanoPad('猎鹰9号'), true)
  assert.equal(rocketNeedsOrbitPanoPad('Falcon Heavy'), true)
  assert.equal(rocketNeedsOrbitPanoPad('猎鹰重型'), true)
  assert.equal(rocketNeedsOrbitPanoPad('Starship'), false)
  assert.equal(rocketNeedsOrbitPanoPad('朱雀三号'), false)
  assert.equal(rocketNeedsOrbitPanoPad('长征十号乙'), false)
})

test('工位名优先于场地名：SLC-40 / 39A / 4E 不混淆', () => {
  assert.equal(inferOrbitPanoPadKey({ pad: 'Space Launch Complex 40' }), 'slc-40')
  assert.equal(inferOrbitPanoPadKey({ pad: 'Launch Complex 39A', launchSite: 'Kennedy Space Center' }), 'lc-39a')
  assert.equal(inferOrbitPanoPadKey({ pad: 'Space Launch Complex 4E', launchSite: 'Vandenberg SFB' }), 'slc-4e')
  assert.equal(inferOrbitPanoPadKey({ padLocation: 'SLC-40', launchSite: 'Cape Canaveral SFS' }), 'slc-40')
  assert.equal(inferOrbitPanoPadKey({ launchSite: 'Vandenberg Space Force Base' }), 'slc-4e')
  assert.equal(inferOrbitPanoPadKey({ launchSite: 'Kennedy Space Center' }), 'lc-39a')
})

test('猎鹰9 三条场片互不串场', () => {
  const items = [
    item({ id: 'f9-40', rocketName: 'Falcon 9', padKey: 'slc-40', recoveryKey: 'asds' }),
    item({ id: 'f9-39a', rocketName: 'Falcon 9', padKey: 'lc-39a', recoveryKey: 'rtls' }),
    item({ id: 'f9-4e', rocketName: 'Falcon 9', padKey: 'slc-4e', recoveryKey: 'rtls' })
  ]
  assert.equal(pickOrbitPanoItem(items, { rocketName: '猎鹰9号', padLocation: 'SLC-40' }).id, 'f9-40')
  assert.equal(pickOrbitPanoItem(items, { rocketName: 'Falcon 9 Block 5', pad: 'LC-39A' }).id, 'f9-39a')
  assert.equal(pickOrbitPanoItem(items, { rocketName: 'Falcon 9', launchSite: 'Vandenberg SFB' }).id, 'f9-4e')
})

test('猎鹰9 未锁发射场的旧配置不落地', () => {
  const items = [item({ rocketName: 'Falcon 9' })]
  assert.equal(pickOrbitPanoItem(items, { rocketName: 'Falcon 9', padLocation: 'SLC-40' }), null)
})

test('星舰仍按型号常驻，不要求发射场', () => {
  const items = [item({ id: 'ss', rocketName: 'Starship' })]
  assert.equal(pickOrbitPanoItem(items, { rocketName: '星舰', name: 'Starbase' }).id, 'ss')
})

test('星舰工位：Starbase 上下文才分 A/B，A/B 不串', () => {
  assert.equal(inferOrbitPanoPadKey({
    rocketName: 'Starship',
    pad: 'Orbital Launch Pad 1',
    launchSite: 'SpaceX Starbase'
  }), 'starbase-a')
  assert.equal(inferOrbitPanoPadKey({
    rocketName: '星舰',
    pad: 'OLM-B',
    launchSite: 'Boca Chica'
  }), 'starbase-b')
  assert.equal(inferOrbitPanoPadKey({
    rocketName: 'Starship',
    pad: 'Pad 2',
    launchSite: '星舰基地'
  }), 'starbase-b')
  assert.equal(inferOrbitPanoPadKey({
    rocketName: 'Starship',
    launchSite: 'Starbase'
  }), 'starbase')
  assert.equal(inferOrbitPanoPadKey({
    rocketName: 'Starship',
    pad: 'Pad 2',
    launchSite: 'Kennedy Space Center'
  }), 'lc-39a')
})

test('星舰工位片互不串，整场吃 A/B，精确工位优先', () => {
  const items = [
    item({ id: 'ss-all', rocketName: 'Starship' }),
    item({ id: 'ss-sb', rocketName: 'Starship', padKey: 'starbase' }),
    item({ id: 'ss-a', rocketName: 'Starship', padKey: 'starbase-a' }),
    item({ id: 'ss-b', rocketName: 'Starship', padKey: 'starbase-b' }),
    item({ id: 'ss-39a', rocketName: 'Starship', padKey: 'lc-39a' })
  ]
  assert.equal(pickOrbitPanoItem(items, {
    rocketName: '星舰',
    pad: 'Orbital Launch Mount A',
    launchSite: 'Starbase'
  }).id, 'ss-a')
  assert.equal(pickOrbitPanoItem(items, {
    rocketName: 'Starship',
    pad: 'OLP-2',
    launchSite: 'Boca Chica'
  }).id, 'ss-b')
  assert.equal(pickOrbitPanoItem(items, {
    rocketName: 'Starship',
    launchSite: 'Starbase'
  }).id, 'ss-sb')
  assert.equal(pickOrbitPanoItem(items, {
    rocketName: 'Starship',
    pad: 'LC-39A',
    launchSite: 'Kennedy Space Center'
  }).id, 'ss-39a')
})

test('星舰 39A 不吃基地片，猎鹰 39A 不吃星舰 39A', () => {
  const items = [
    item({ id: 'ss-sb', rocketName: 'Starship', padKey: 'starbase' }),
    item({ id: 'ss-39a', rocketName: 'Starship', padKey: 'lc-39a' }),
    item({ id: 'f9-39a', rocketName: 'Falcon 9', padKey: 'lc-39a', recoveryKey: 'asds' })
  ]
  assert.equal(pickOrbitPanoItem(items, {
    rocketName: 'Starship',
    pad: 'LC-39A',
    launchSite: 'Kennedy Space Center'
  }).id, 'ss-39a')
  assert.equal(pickOrbitPanoItem(items, {
    rocketName: 'Falcon 9',
    pad: 'LC-39A',
    boosterInfo: { landingType: 'ASDS', landingLocation: 'ASOG' }
  }).id, 'f9-39a')
  assert.equal(pickOrbitPanoItem([
    item({ id: 'ss-sb', rocketName: 'Starship', padKey: 'starbase' })
  ], {
    rocketName: 'Starship',
    pad: 'LC-39A',
    launchSite: 'Kennedy Space Center'
  }), null)
})

test('星舰范登堡不落到猎鹰 SLC-4E，无工位兜底仍命中', () => {
  assert.equal(inferOrbitPanoPadKey({
    rocketName: 'Starship',
    launchSite: 'Vandenberg SFB'
  }), 'vandenberg')
  assert.equal(inferOrbitPanoPadKey({
    rocketName: 'Falcon 9',
    launchSite: 'Vandenberg Space Force Base'
  }), 'slc-4e')
  const items = [
    item({ id: 'ss-all', rocketName: 'Starship' }),
    item({ id: 'ss-vafb', rocketName: 'Starship', padKey: 'vandenberg' }),
    item({ id: 'f9-4e', rocketName: 'Falcon 9', padKey: 'slc-4e', recoveryKey: 'rtls' })
  ]
  assert.equal(pickOrbitPanoItem(items, {
    rocketName: '星舰',
    launchSite: 'Vandenberg SFB'
  }).id, 'ss-vafb')
  assert.equal(pickOrbitPanoItem([
    item({ id: 'ss-all', rocketName: 'Starship' }),
    item({ id: 'ss-sb', rocketName: 'Starship', padKey: 'starbase' })
  ], {
    rocketName: 'Starship',
    launchSite: 'Vandenberg SFB'
  }).id, 'ss-all')
})

test('同型号场片优先于无工位兜底', () => {
  const items = [
    item({ id: 'cz', rocketName: '长征十号乙' }),
    item({ id: 'f9-40', rocketName: 'Falcon 9', padKey: 'slc-40', recoveryKey: 'asds' })
  ]
  assert.equal(pickOrbitPanoItem(items, { rocketName: 'Falcon 9', padLocation: 'SLC-40' }).id, 'f9-40')
  assert.equal(pickOrbitPanoItem(items, { rocketName: '长征十号乙' }).id, 'cz')
})

test('猎鹰重型按 LC-39A 常驻，不与猎鹰9串片', () => {
  const items = [
    item({ id: 'f9-39a', rocketName: 'Falcon 9', padKey: 'lc-39a', recoveryKey: 'asds' }),
    item({ id: 'fh-39a', rocketName: 'Falcon Heavy', padKey: 'lc-39a', recoveryKey: 'asds' })
  ]
  const hit = pickOrbitPanoItem(items, {
    rocketName: '猎鹰重型',
    pad: 'LC-39A',
    boosterStages: [
      { landingType: 'ASDS' },
      { landingType: 'RTLS' },
      { landingType: 'RTLS' }
    ]
  })
  assert.equal(hit.id, 'fh-39a')
})

test('猎鹰9 / 重型不回收则不展示环绕全景', () => {
  const items = [
    item({ id: 'f9-40', rocketName: 'Falcon 9', padKey: 'slc-40', recoveryKey: 'asds' }),
    item({ id: 'fh-39a', rocketName: 'Falcon Heavy', padKey: 'lc-39a', recoveryKey: 'asds' })
  ]
  assert.equal(orbitPanoMissionAttemptsRecovery({
    rocketName: 'Falcon 9',
    boosterInfo: { landingType: 'EXPENDED' }
  }), false)
  assert.equal(pickOrbitPanoItem(items, {
    rocketName: 'Falcon 9',
    padLocation: 'SLC-40',
    boosterInfo: { landingType: 'EXPENDED' }
  }), null)
  assert.equal(orbitPanoMissionAttemptsRecovery({
    rocketName: 'Falcon Heavy',
    boosterStages: [
      { landingType: 'EXPENDED' },
      { landingType: 'EXPENDED' },
      { landingType: 'EXPENDED' }
    ]
  }), false)
  assert.equal(pickOrbitPanoItem(items, {
    rocketName: 'Falcon Heavy',
    pad: 'LC-39A',
    boosterStages: [
      { landingType: 'EXPENDED' },
      { landingType: 'EXPENDED' },
      { landingType: 'EXPENDED' }
    ]
  }), null)
})

test('猎鹰重型中央芯一次性、侧助推仍回收时继续展示', () => {
  assert.equal(orbitPanoMissionAttemptsRecovery({
    rocketName: 'Falcon Heavy',
    boosterStages: [
      { role: '中央芯', landingType: 'EXPENDED' },
      { role: '侧助推器 1', landingType: 'RTLS' },
      { role: '侧助推器 2', landingType: 'RTLS' }
    ]
  }), true)
})

test('回收数据未到时先显示，避免即将发射被误藏', () => {
  assert.equal(orbitPanoMissionAttemptsRecovery({
    rocketName: 'Falcon 9',
    padLocation: 'SLC-40'
  }), true)
})

test('同场陆地 / 海上不串片，回收船名按海上对齐', () => {
  const items = [
    item({ id: 'f9-40-rtls', rocketName: 'Falcon 9', padKey: 'slc-40', recoveryKey: 'rtls' }),
    item({ id: 'f9-40-asds', rocketName: 'Falcon 9', padKey: 'slc-40', recoveryKey: 'asds' })
  ]
  assert.equal(inferOrbitPanoRecoveryKey({
    rocketName: 'Falcon 9',
    boosterInfo: { landingType: 'ASDS', landingLocation: 'ASOG' }
  }), 'asds')
  assert.equal(inferOrbitPanoRecoveryKey({
    rocketName: 'Falcon 9',
    boosterInfo: { landingType: 'RTLS', landingLocation: 'LZ-1' }
  }), 'rtls')
  assert.equal(pickOrbitPanoItem(items, {
    rocketName: '猎鹰9号',
    padLocation: 'SLC-40',
    boosterInfo: { landingType: 'ASDS', landingLocation: 'A Shortfall of Gravitas' }
  }).id, 'f9-40-asds')
  assert.equal(pickOrbitPanoItem(items, {
    rocketName: 'Falcon 9',
    padLocation: 'SLC-40',
    boosterInfo: { landingType: 'RTLS', landingLocation: 'Landing Zone 1' }
  }).id, 'f9-40-rtls')
})

test('猎鹰重型中央芯海上优先，没有海上片再落陆地片', () => {
  const both = [
    item({ id: 'fh-asds', rocketName: 'Falcon Heavy', padKey: 'lc-39a', recoveryKey: 'asds' }),
    item({ id: 'fh-rtls', rocketName: 'Falcon Heavy', padKey: 'lc-39a', recoveryKey: 'rtls' })
  ]
  const landOnly = [
    item({ id: 'fh-rtls', rocketName: 'Falcon Heavy', padKey: 'lc-39a', recoveryKey: 'rtls' })
  ]
  const heavy = {
    rocketName: '猎鹰重型',
    pad: 'LC-39A',
    boosterStages: [
      { landingType: 'ASDS', landingLocation: 'OCISLY' },
      { landingType: 'RTLS', landingLocation: 'LZ-1' },
      { landingType: 'RTLS', landingLocation: 'LZ-2' }
    ]
  }
  assert.equal(inferOrbitPanoRecoveryKey(heavy), 'asds')
  assert.equal(pickOrbitPanoItem(both, heavy).id, 'fh-asds')
  assert.equal(pickOrbitPanoItem(landOnly, heavy).id, 'fh-rtls')
})

test('猎鹰9 只锁发射场、未锁回收方式的旧配置不落地', () => {
  const items = [item({ rocketName: 'Falcon 9', padKey: 'slc-40' })]
  assert.equal(pickOrbitPanoItem(items, {
    rocketName: 'Falcon 9',
    padLocation: 'SLC-40',
    boosterInfo: { landingType: 'ASDS', landingLocation: 'ASOG' }
  }), null)
})
