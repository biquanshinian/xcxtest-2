/**
 * 任务卡汉化质量：混排不算已译、朱雀误译纠偏、USSF、酒泉场址整句。
 * 运行：node --test test/zh-usable-i18n.test.js
 */
const test = require('node:test')
const assert = require('node:assert/strict')

const {
  isUsableZhText,
  shouldMachineTranslate,
  applyPhraseRules,
  translateLocation,
  translateCountryName
} = require('../cloudfunctions/ll2Query/space-terms-i18n.js')
const {
  repairAerospaceZhMistranslations,
  applyMissionPhraseRules,
  translateMissionSegment
} = require('../cloudfunctions/ll2Query/mission-title-i18n.js')
const { pickLocalized, zhField, setContentLangMem, isUsableZhText: feUsable } = require('../utils/locale.js')

const MIXED_LANDING =
  'The Zhuque-3 一级 助推器 will attempt to land on its downrange landing pad.'
const MIXED_PAD =
  '发射区 96 B, Jiuquan 卫星发射中心, People\'s Republic of China'
const PAD_EN =
  'Launch Area 96 B, Jiuquan Satellite Launch Center, People\'s Republic of China'

test('中英混排说明不可用，必须继续机翻', () => {
  assert.equal(isUsableZhText(MIXED_LANDING), false)
  assert.equal(shouldMachineTranslate(MIXED_LANDING), true)
  assert.equal(isUsableZhText(MIXED_PAD), false)
})

test('整句中文与保留 SpaceX 的译文可用', () => {
  assert.equal(isUsableZhText('朱雀三号一级助推器将尝试在其航区着陆场着陆。'), true)
  assert.equal(isUsableZhText('SpaceX 猎鹰9号'), true)
  assert.equal(isUsableZhText('美国太空军-51'), true)
  assert.equal(shouldMachineTranslate('朱雀三号着陆场'), false)
})

test('ZQ-3 LZ 词典为朱雀三号着陆场，禁止雀雀', () => {
  assert.equal(translateLocation('ZQ-3 LZ'), '朱雀三号着陆场')
  assert.equal(translateLocation('Zhuque-3 Landing Zone'), '朱雀三号着陆场')
  assert.equal(applyPhraseRules('ZQ-3 LZ'), '朱雀三号着陆场')
  assert.equal(repairAerospaceZhMistranslations('雀雀三号着陆场'), '朱雀三号着陆场')
  assert.equal(isUsableZhText('雀雀三号着陆场'), false)
})

test('酒泉工位整句可词典译完，不再半译', () => {
  const zh = translateLocation(PAD_EN)
  assert.match(zh, /发射区/)
  assert.match(zh, /酒泉/)
  assert.match(zh, /卫星发射中心/)
  assert.match(zh, /中国/)
  assert.equal(/Jiuquan|People|Republic|China/i.test(zh), false)
  assert.equal(isUsableZhText(zh), true)
  assert.equal(translateCountryName('People\'s Republic of China'), '中国')
})

test('USSF 译为美国太空军', () => {
  assert.equal(applyPhraseRules('USSF-51'), '美国太空军-51')
  assert.equal(applyPhraseRules('USSF'), '美国太空军')
  assert.equal(translateMissionSegment('USSF-62'), '美国太空军-62')
  assert.equal(applyMissionPhraseRules('USSF-51'), '美国太空军-51')
  assert.equal(repairAerospaceZhMistranslations('USSF-51'), '美国太空军-51')
})

test('前端 pickLocalized / zhField 拒绝混排，雀雀当场纠偏', () => {
  setContentLangMem('zh')
  assert.equal(feUsable(MIXED_LANDING), false)
  assert.equal(pickLocalized(MIXED_LANDING, 'The booster will land.'), 'The booster will land.')
  assert.equal(zhField({ descriptionZh: MIXED_LANDING }, 'description'), '')
  assert.equal(zhField({ nameZh: '雀雀三号着陆场' }, 'name'), '朱雀三号着陆场')
  assert.equal(pickLocalized('雀雀三号着陆场', 'ZQ-3 LZ'), '朱雀三号着陆场')
})

test('sync 副本与 ll2Query 词典判定一致', () => {
  const sync = require('../cloudfunctions/syncSpaceDevsData/space-terms-i18n.js')
  assert.equal(sync.translateLocation('ZQ-3 LZ'), '朱雀三号着陆场')
  assert.equal(sync.isUsableZhText(MIXED_LANDING), false)
  assert.equal(sync.shouldMachineTranslate(MIXED_LANDING), true)
  const padZh = sync.translateLocation(PAD_EN)
  assert.equal(sync.isUsableZhText(padZh), true)
})

test('朱雀三号任务卡词典路径：落点/场址/假 *Zh 可覆盖', () => {
  const landingLoc = {
    name: 'ZQ-3 LZ',
    abbrev: 'ZQ-3 LZ',
    nameZh: '雀雀三号着陆场'
  }
  const pad = {
    name: PAD_EN,
    nameZh: MIXED_PAD,
    location: {
      name: 'Jiuquan Satellite Launch Center, People\'s Republic of China',
      nameZh: 'Jiuquan 卫星发射中心, People\'s Republic of China'
    }
  }
  landingLoc.nameZh = translateLocation(landingLoc.name) || translateLocation(landingLoc.abbrev)
  pad.nameZh = translateLocation(pad.name)
  pad.location.nameZh = translateLocation(pad.location.name)
  assert.equal(landingLoc.nameZh, '朱雀三号着陆场')
  assert.equal(isUsableZhText(pad.nameZh), true)
  assert.match(pad.nameZh, /酒泉/)
  assert.match(pad.location.nameZh, /酒泉卫星发射中心/)
  assert.match(pad.location.nameZh, /中国/)
  assert.equal(/Jiuquan|People/i.test(pad.location.nameZh), false)
})

test('朱雀-3 数字型号在云端与前端都规范成朱雀三号', () => {
  const cloud = require('../cloudfunctions/ll2Query/mission-title-i18n.js')
  const fe = require('../utils/mission-title-i18n.js')
  assert.equal(cloud.repairAerospaceZhMistranslations('朱雀-3一级助推器'), '朱雀三号一级助推器')
  assert.equal(fe.repairAerospaceZhMistranslations('朱雀-3一级助推器'), '朱雀三号一级助推器')
})

test('孔雀误译纠偏为朱雀，与标题对齐', () => {
  const { repairAerospaceZhMistranslations } = require('../utils/mission-title-i18n.js')
  const { pickLocalized, zhField, setContentLangMem } = require('../utils/locale.js')
  setContentLangMem('zh')
  assert.equal(
    repairAerospaceZhMistranslations('孔雀-3第一一级助推器将尝试降落在其短程着陆台上。'),
    '朱雀三号一级助推器将尝试降落在其航区着陆场上。'
  )
  assert.equal(
    zhField({ descriptionZh: '孔雀-3第一一级助推器将尝试降落在其短程着陆台上。' }, 'description'),
    '朱雀三号一级助推器将尝试降落在其航区着陆场上。'
  )
  assert.equal(pickLocalized('孔雀三号着陆场', 'ZQ-3 LZ'), '朱雀三号着陆场')
})

test('hydrate 不得把中文展示字段写回 *En，污染缓存可洗干净', () => {
  const { applyContentLangToMission, takeDescSeed, buildTitlePair } = require('../utils/launch-card-i18n.js')
  const { setContentLangMem } = require('../utils/locale.js')
  setContentLangMem('zh')
  const mission = applyContentLangToMission({
    name: 'Falcon 9 Block 5 | Starlink Group 10-19',
    missionName: 'Starlink Group 10-19',
    rocketName: 'Falcon 9 Block 5',
    padLocation: 'Vandenberg SFB, CA, USA',
    padDetail: { padName: 'Space Launch Complex 4E' }
  })
  assert.equal(/[\u4e00-\u9fff]/.test(mission._langPack.nameEn), false)
  assert.equal(/[\u4e00-\u9fff]/.test(mission._langPack.rocketNameEn), false)
  assert.equal(/[\u4e00-\u9fff]/.test(mission._langPack.padLocationEn), false)
  assert.match(mission.name, /星链/)
  delete mission._langPack.padNameEn
  mission.padDetail.padName = '第40航天发射工位'
  applyContentLangToMission(mission)
  assert.equal(mission._langPack.padNameEn, '')

  const polluted = applyContentLangToMission({
    name: '猎鹰9号 | 星链组 10-19',
    rocketName: '猎鹰9号第5型',
    _langPack: {
      nameEn: '猎鹰9号 | 星链组 10-19',
      nameZh: '猎鹰9号 | 星链组 10-19',
      rocketNameEn: '猎鹰9号第5型',
      rocketNameZh: '猎鹰9号第5型'
    }
  })
  assert.equal(/[\u4e00-\u9fff]/.test(polluted._langPack.nameEn), false)
  assert.equal(/[\u4e00-\u9fff]/.test(polluted._langPack.rocketNameEn), false)
  assert.match(polluted.name, /星链/)

  const pair = buildTitlePair({ name: 'ObscureSat-99', mission: { name: 'ObscureSat-99' } }, 'X', 'X')
  assert.equal(/[\u4e00-\u9fff]/.test(pair.nameEn), false)
  assert.equal(pair.nameZh === pair.nameEn && /[A-Za-z]{4,}/.test(pair.nameZh), false)

  const skipped = takeDescSeed({ _textTranslateReverted: true }, {
    missionFull: { descriptionZh: '一批星链卫星将进入近地轨道。' }
  })
  assert.deepEqual(skipped, {})
  const seeded = takeDescSeed({}, {
    missionFull: { descriptionZh: '一批星链卫星将进入近地轨道。' }
  })
  assert.match(seeded.descI18n.missionDesc, /星链/)
})

test('详情长文有可用 *Zh 时首屏直接中文，不先英后中', () => {
  const { applyContentLangToMission, seedMissionDescI18n } = require('../utils/launch-card-i18n.js')
  const { setContentLangMem } = require('../utils/locale.js')
  setContentLangMem('zh')
  const mission = applyContentLangToMission({
    name: 'Falcon 9 Block 5 | Starlink Group 10-19',
    missionFull: {
      description: 'A batch of Starlink satellites to low Earth orbit.',
      descriptionZh: '一批星链卫星将进入近地轨道。'
    },
    rocketFull: {
      description: 'Falcon 9 is a reusable two-stage rocket.',
      descriptionZh: '猎鹰9号是一枚可重复使用的两级火箭。'
    },
    padDetail: {
      padDescription: 'Space Launch Complex 40',
      padDescriptionZh: '第40航天发射台'
    }
  })
  const seed = seedMissionDescI18n(mission)
  assert.equal(seed.descTranslated, true)
  assert.match(seed.descI18n.missionDesc, /星链/)
  assert.match(seed.descI18n.rocketDesc, /猎鹰/)
  assert.match(seed.descI18n.padDesc, /发射台/)
  setContentLangMem('en')
  const enSeed = seedMissionDescI18n(mission)
  assert.equal(enSeed.descTranslated, false)
  assert.equal(enSeed.descI18n.missionDesc, '')
  setContentLangMem('zh')
})

test('详情首屏缺 *Zh 时当场词典补齐，不先英后中', () => {
  const { applyContentLangToMission } = require('../utils/launch-card-i18n.js')
  const mission = applyContentLangToMission({
    name: 'Falcon 9 Block 5 | USSF-366',
    missionName: 'USSF-366',
    rocketName: 'Falcon 9 Block 5',
    padLocation: 'Vandenberg SFB, CA, USA',
    launchAgency: 'SpaceX',
    launchAgencyAbbrev: 'SpX',
    boosterInfo: {
      landingLocation: 'Of Course I Still Love You',
      landingLocationEn: 'Of Course I Still Love You'
    }
  })
  assert.match(mission.name, /美国太空军/)
  assert.match(mission.rocketName, /猎鹰9号/)
  assert.match(mission.padLocation, /范登堡/)
  assert.match(mission.boosterInfo.landingLocation, /当然我依然爱你号/)
  assert.equal(mission.launchAgency, 'SpaceX')
})

test('回收船与范登堡走同一套场址词典', () => {
  const { translateLocation } = require('../utils/space-terms-display.js')
  const { formatLandingPlaceParts } = require('../utils/landing-icons.js')
  const { pickLocalized } = require('../utils/locale.js')
  assert.equal(translateLocation('OCISLY'), '当然我依然爱你号')
  assert.equal(translateLocation('Of Course I Still Love You'), '当然我依然爱你号')
  assert.match(translateLocation('Vandenberg SFB, CA, USA'), /范登堡/)
  const place = formatLandingPlaceParts('OCISLY', 'Of Course I Still Love You', {
    name: 'Of Course I Still Love You',
    abbrev: 'OCISLY'
  })
  assert.match(place.zh, /当然我依然爱你号/)
  assert.match(pickLocalized(place.zh, place.en), /当然我依然爱你号/)
})

test('族谱火箭名与厂商走共用词典', () => {
  const { translateRocketName } = require('../utils/rocket-name-i18n.js')
  const { resolveAgencyDisplayZh } = require('../utils/launch-card-i18n.js')
  assert.equal(translateRocketName('Falcon 9 Block 5'), '猎鹰9号第5型')
  assert.match(translateRocketName('Kosmos-3M'), /宇宙/)
  assert.match(translateRocketName('Molniya-M 2BL'), /闪电/)
  assert.equal(resolveAgencyDisplayZh('Russian Space Forces', '', ''), '俄罗斯航天军')
  assert.equal(resolveAgencyDisplayZh('Strategic Rocket Forces', '', ''), '战略火箭军')
})

test('空间站飞船与图鉴同一条路', () => {
  const { translateSpacecraftName, resolveSpacecraftDisplayZh } = require('../utils/spacecraft-name-i18n.js')
  const { translateLocation } = require('../utils/space-terms-display.js')
  assert.equal(translateSpacecraftName('Soyuz MS-29'), '联盟号 MS-29')
  assert.equal(translateSpacecraftName('Progress MS-34'), '进步号-MS-34')
  assert.equal(translateSpacecraftName('Crew Dragon Freedom'), '载人龙飞船 自由号')
  assert.match(translateSpacecraftName('Cygnus CRS NG-24 (S.S. Steven R. Nagel)'), /天鹅座/)
  assert.equal(resolveSpacecraftDisplayZh('Soyuz MS-29', ''), '联盟号 MS-29')
  assert.equal(translateLocation('Harmony zenith'), '和谐号天顶')
  assert.equal(translateLocation('Prichal nadir'), '码头号天底')
})

test('星链组号格式统一：连字符两侧无空格', () => {
  const { repairAerospaceZhMistranslations, localizeMissionTitle } = require('../utils/mission-title-i18n.js')
  const { pickLocalized, zhField } = require('../utils/locale.js')
  assert.equal(repairAerospaceZhMistranslations('星链组 10 - 19'), '星链组 10-19')
  assert.equal(repairAerospaceZhMistranslations('星链组10-19'), '星链组 10-19')
  assert.equal(repairAerospaceZhMistranslations('星链 组 17 – 51'), '星链组 17-51')
  assert.equal(localizeMissionTitle('Starlink Group 10-19'), '星链组 10-19')
  assert.match(localizeMissionTitle('Falcon 9 Block 5 | Starlink Group 10-19', 'Falcon 9', '猎鹰9号'), /星链组 10-19/)
  assert.equal(pickLocalized('星链组 10 - 19', 'Starlink Group 10-19'), '星链组 10-19')
  assert.equal(zhField({ nameZh: '星链组 10 - 19' }, 'name'), '星链组 10-19')
})

test('卡片标题与详情同一条路：USSF 走 localizeMissionTitle', () => {
  const { buildTitlePair } = require('../utils/launch-card-i18n.js')
  const pair = buildTitlePair({ name: 'USSF-51', mission: { name: 'USSF-51' } }, 'Falcon 9', '猎鹰9号')
  assert.match(pair.nameZh, /美国太空军/)
  assert.match(pair.missionNameZh, /美国太空军/)
})

test('常见 LL2 发射台/发射地点整句可译，不再因半译被丢掉', () => {
  const { translateLocation } = require('../utils/space-terms-display.js')
  const { applyContentLangToMission } = require('../utils/launch-card-i18n.js')
  const { setContentLangMem } = require('../utils/locale.js')
  setContentLangMem('zh')
  assert.match(translateLocation('Cape Canaveral SFS, FL, USA'), /卡纳维拉尔/)
  assert.equal(/Cape|Canaveral|SFS|FL|USA/i.test(translateLocation('Cape Canaveral SFS, FL, USA')), false)
  assert.match(translateLocation('Kennedy Space Center, FL, USA'), /肯尼迪/)
  assert.match(translateLocation('Vandenberg SFB, CA, USA'), /范登堡/)
  assert.match(translateLocation('SpaceX Starbase, TX, USA'), /星舰基地/)
  assert.match(translateLocation('Space Launch Complex 40'), /40/)
  assert.match(translateLocation('Launch Complex 39A'), /39A/)
  assert.match(translateLocation('SLC-4E'), /4E/)
  assert.match(translateLocation('Cape Canaveral Space Force Station, Florida, USA'), /卡纳维拉尔/)
  assert.match(translateLocation('Baikonur Cosmodrome, Republic of Kazakhstan'), /拜科努尔/)
  const mission = applyContentLangToMission({
    name: 'Falcon 9 Block 5 | Starlink Group 10-19',
    padLocation: 'Cape Canaveral SFS, FL, USA',
    launchSite: 'Space Launch Complex 40, Cape Canaveral SFS, FL, USA',
    padDetail: {
      padName: 'Space Launch Complex 40',
      padNameEn: 'Space Launch Complex 40',
      locationName: 'Cape Canaveral SFS, FL, USA',
      locationNameEn: 'Cape Canaveral SFS, FL, USA'
    }
  })
  assert.match(mission.padLocation, /卡纳维拉尔|范登堡|肯尼迪|星舰/)
  assert.equal(/Cape Canaveral SFS/i.test(mission.padLocation), false)
  assert.match(mission.launchSite, /发射工位|发射台|卡纳维拉尔/)
  assert.match(mission.padDetail.padName, /发射工位|发射台/)
  assert.match(mission.padDetail.locationName, /卡纳维拉尔/)
})

test('任务类型与酒泉发射台前端回退与云端一致', () => {
  const { translateMissionType, translateLocation, translateOrbit } = require('../utils/space-terms-display.js')
  assert.equal(translateMissionType('Communications'), '通信')
  assert.equal(translateMissionType({ name: 'Test Flight' }), '试飞')
  assert.match(translateLocation('Launch Area 96 B, Jiuquan Satellite Launch Center, People\'s Republic of China'), /酒泉/)
  assert.equal(translateOrbit('LEO'), '近地轨道')
  assert.equal(translateLocation('Expedition 73'), '远征 73')
})

test('短语规则半译落点说明仍须送原文机翻', () => {
  const prepared = applyPhraseRules(
    'The Zhuque-3 first stage booster will attempt to land on its downrange landing pad.'
  )
  assert.match(prepared, /一级/)
  assert.match(prepared, /助推器/)
  assert.equal(isUsableZhText(prepared), false)
  assert.equal(shouldMachineTranslate(prepared), true)
})

test('历史瘦卡 Unknown rocket 从 name 拆出猎鹰9号，不再粘英文占位', () => {
  const { applyContentLangToMission } = require('../utils/launch-card-i18n.js')
  const { setContentLangMem } = require('../utils/locale.js')
  setContentLangMem('zh')
  const mission = applyContentLangToMission({
    name: 'Falcon 9 | Starlink Group 17-50',
    rocketName: 'Unknown rocket',
    padLocation: '未知地点',
    _langPack: {
      rocketNameEn: 'Unknown rocket',
      rocketNameZh: '',
      padLocationEn: 'Unknown location',
      padLocationZh: '未知地点',
      nameEn: 'Falcon 9 | Starlink Group 17-50'
    }
  })
  assert.equal(mission.rocketName, '猎鹰9号')
  assert.notEqual(mission.rocketName, 'Unknown rocket')
})
