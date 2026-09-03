/**
 * 环绕全景对齐审计：用详情页真实对象形态（中文显示 + _langPack）跑匹配。
 * node --test test/orbit-pano-align-audit.test.js
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const {
  matchOrbitPanoRocket,
  inferOrbitPanoPadKey,
  pickOrbitPanoItem,
  orbitPanoMissionAttemptsRecovery
} = require('../utils/rocket-name-i18n.js')

function item(partial) {
  return {
    id: partial.id || 'op',
    videoUrl: 'https://example.com/a.mp4',
    enabled: true,
    ...partial
  }
}

/** 中文模式下任务详情：展示字段已是中文，英文留在 _langPack */
function zhMission(partial) {
  const pack = partial._langPack || {}
  return {
    rocketName: pack.rocketNameZh || partial.rocketName,
    padLocation: pack.padLocationZh || partial.padLocation,
    launchSite: pack.launchSiteZh || partial.launchSite,
    name: pack.nameZh || partial.name,
    missionName: pack.missionNameZh || partial.missionName,
    ...partial,
    _langPack: pack
  }
}

const ITEMS = [
  item({ id: 'f9-40', rocketName: 'Falcon 9 Block 5', padKey: 'slc-40', recoveryKey: 'asds' }),
  item({ id: 'f9-39a', rocketName: 'Falcon 9 Block 5', padKey: 'lc-39a', recoveryKey: 'rtls' }),
  item({ id: 'f9-4e', rocketName: 'Falcon 9 Block 5', padKey: 'slc-4e', recoveryKey: 'rtls' }),
  item({ id: 'fh-39a', rocketName: 'Falcon Heavy', padKey: 'lc-39a', recoveryKey: 'asds' })
]

test('审计：后台 Falcon 9 Block 5 能对上中文详情 猎鹰9号', () => {
  const m = zhMission({
    _langPack: {
      rocketNameEn: 'Falcon 9 Block 5',
      rocketNameZh: '猎鹰9号 Block 5',
      padLocationEn: 'Cape Canaveral SFS',
      padLocationZh: '卡纳维拉尔角太空军基地',
      launchSiteEn: 'Space Launch Complex 40, Cape Canaveral SFS',
      launchSiteZh: '卡纳维拉尔角 40 号发射工位, 卡纳维拉尔角太空军基地'
    },
    boosterInfo: { landingType: 'ASDS' }
  })
  assert.equal(matchOrbitPanoRocket('Falcon 9 Block 5', m), true)
  assert.equal(matchOrbitPanoRocket('Falcon 9', m), true)
  assert.equal(inferOrbitPanoPadKey(m), 'slc-40')
  assert.equal(pickOrbitPanoItem(ITEMS, m).id, 'f9-40')
})

test('审计：中文 39A / 范登堡 4E 工位能对上', () => {
  const ksc = zhMission({
    _langPack: {
      rocketNameEn: 'Falcon 9 Block 5',
      rocketNameZh: '猎鹰9号 Block 5',
      padLocationEn: 'Kennedy Space Center',
      padLocationZh: '肯尼迪航天中心',
      launchSiteEn: 'Launch Complex 39A, Kennedy Space Center',
      launchSiteZh: '肯尼迪航天中心 39A 发射台, 肯尼迪航天中心'
    },
    boosterInfo: { landingType: 'RTLS' }
  })
  const vafb = zhMission({
    _langPack: {
      rocketNameEn: 'Falcon 9 Block 5',
      rocketNameZh: '猎鹰9号 Block 5',
      padLocationEn: 'Vandenberg SFB',
      padLocationZh: '范登堡太空军基地',
      launchSiteEn: 'Space Launch Complex 4E, Vandenberg SFB',
      launchSiteZh: '范登堡 4E 发射工位, 范登堡太空军基地'
    },
    boosterInfo: { landingType: 'RTLS' }
  })
  assert.equal(inferOrbitPanoPadKey(ksc), 'lc-39a')
  assert.equal(pickOrbitPanoItem(ITEMS, ksc).id, 'f9-39a')
  assert.equal(inferOrbitPanoPadKey(vafb), 'slc-4e')
  assert.equal(pickOrbitPanoItem(ITEMS, vafb).id, 'f9-4e')
})

test('审计：列表卡只给场地名（不带 SLC-40）时仍能落到卡角', () => {
  const listLike = zhMission({
    _langPack: {
      rocketNameEn: 'Falcon 9 Block 5',
      rocketNameZh: '猎鹰9号 Block 5',
      padLocationEn: 'Cape Canaveral SFS',
      padLocationZh: '卡纳维拉尔角太空军基地',
      launchSiteEn: 'Cape Canaveral SFS',
      launchSiteZh: '卡纳维拉尔角太空军基地'
    },
    boosterInfo: { landingType: 'ASDS' }
  })
  assert.equal(inferOrbitPanoPadKey(listLike), 'slc-40')
  assert.equal(pickOrbitPanoItem(ITEMS, listLike).id, 'f9-40')
})

test('审计：猎鹰重型中文详情对 LC-39A，不吃猎鹰9同场片', () => {
  const m = zhMission({
    _langPack: {
      rocketNameEn: 'Falcon Heavy',
      rocketNameZh: '猎鹰重型',
      padLocationEn: 'Kennedy Space Center',
      padLocationZh: '肯尼迪航天中心',
      launchSiteEn: 'Launch Complex 39A, Kennedy Space Center',
      launchSiteZh: '肯尼迪航天中心 39A 发射台, 肯尼迪航天中心'
    },
    boosterStages: [
      { landingType: 'ASDS' },
      { landingType: 'RTLS' },
      { landingType: 'RTLS' }
    ]
  })
  assert.equal(matchOrbitPanoRocket('Falcon Heavy', m), true)
  assert.equal(matchOrbitPanoRocket('Falcon 9 Block 5', m), false)
  assert.equal(inferOrbitPanoPadKey(m), 'lc-39a')
  assert.equal(pickOrbitPanoItem(ITEMS, m).id, 'fh-39a')
})

test('审计：无 _langPack、只剩中文火箭名时 Block 5 锁定是否仍命中', () => {
  const m = {
    rocketName: '猎鹰9号',
    padLocation: '卡纳维拉尔角太空军基地',
    launchSite: '卡纳维拉尔角 40 号发射工位',
    boosterInfo: { landingType: 'ASDS' }
  }
  const rocketOk = matchOrbitPanoRocket('Falcon 9 Block 5', m)
  const padOk = inferOrbitPanoPadKey(m) === 'slc-40'
  const picked = pickOrbitPanoItem(ITEMS, m)
  console.log('[audit] no-langPack F9:', { rocketOk, padOk, picked: picked && picked.id })
  assert.equal(padOk, true, '中文工位应能推断 SLC-40')
  assert.equal(rocketOk, true, 'Falcon 9 Block 5 应能对上「猎鹰9号」')
  assert.equal(picked && picked.id, 'f9-40')
})

test('审计：本次 landing.attempt=false 但未标 EXPENDED 时按不回收处理', () => {
  const m = {
    rocketName: 'Falcon 9',
    padLocation: 'SLC-40',
    boosterInfo: { landingType: null, thisMissionLandingAttempt: false }
  }
  assert.equal(orbitPanoMissionAttemptsRecovery(m), false)
})

test('审计：列表快照只有中央芯 EXPENDED 的重型不误藏', () => {
  assert.equal(orbitPanoMissionAttemptsRecovery({
    rocketName: 'Falcon Heavy',
    boosterInfo: { landingType: 'EXPENDED' }
  }), true)
})

test('审计：同场海上船名与陆地 LZ 不串片', () => {
  const items = [
    item({ id: 'f9-40-asds', rocketName: 'Falcon 9 Block 5', padKey: 'slc-40', recoveryKey: 'asds' }),
    item({ id: 'f9-40-rtls', rocketName: 'Falcon 9 Block 5', padKey: 'slc-40', recoveryKey: 'rtls' })
  ]
  const sea = zhMission({
    _langPack: {
      rocketNameEn: 'Falcon 9 Block 5',
      rocketNameZh: '猎鹰9号',
      launchSiteZh: '卡纳维拉尔角 40 号发射工位'
    },
    boosterInfo: { landingType: 'ASDS', landingLocation: 'ASOG', landingTypeLabel: '海上回收' }
  })
  const land = zhMission({
    _langPack: {
      rocketNameEn: 'Falcon 9 Block 5',
      rocketNameZh: '猎鹰9号',
      launchSiteZh: '卡纳维拉尔角 40 号发射工位'
    },
    boosterInfo: { landingType: 'RTLS', landingLocation: 'LZ-1', landingTypeLabel: '陆地回收' }
  })
  assert.equal(pickOrbitPanoItem(items, sea).id, 'f9-40-asds')
  assert.equal(pickOrbitPanoItem(items, land).id, 'f9-40-rtls')
})
