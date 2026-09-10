const test = require('node:test')
const assert = require('node:assert/strict')
const {
  isPlaceholderMissionField,
  parseRocketMissionFromLaunchName,
  pickLl2AlignedRocketName,
  pickRicherMissionCard,
  isIncompleteCompletedListCard,
  stripWeakerIdentityPatch
} = require('../utils/mission-list-card.js')

test('占位字段识别中英 Unknown rocket / 未知地点', () => {
  assert.equal(isPlaceholderMissionField('Unknown rocket'), true)
  assert.equal(isPlaceholderMissionField('未知火箭'), true)
  assert.equal(isPlaceholderMissionField('Unknown location'), true)
  assert.equal(isPlaceholderMissionField('未知地点'), true)
  assert.equal(isPlaceholderMissionField('Falcon 9'), false)
  assert.equal(isPlaceholderMissionField(''), true)
})

test('从 LL2 name 拆出火箭与任务段', () => {
  const parsed = parseRocketMissionFromLaunchName('Falcon 9 | Starlink Group 17-50')
  assert.equal(parsed.rocketName, 'Falcon 9')
  assert.equal(parsed.missionName, 'Starlink Group 17-50')
})

test('同 id 瘦 previous 卡不能盖掉已有完整卡', () => {
  const full = {
    id: 'starlink',
    rocketName: '猎鹰9号',
    padLocation: '范登堡太空军基地',
    countryDisplay: '美国',
    rocketImage: 'https://img/f9.png'
  }
  const thin = {
    id: 'starlink',
    rocketName: 'Unknown rocket',
    padLocation: '未知地点',
    _fromRecentSettled: true
  }
  const kept = pickRicherMissionCard(full, thin)
  assert.equal(kept.rocketName, '猎鹰9号')
  assert.equal(kept.padLocation, '范登堡太空军基地')
})

test('后出现的完整 previous 卡仍覆盖旧瘦卡', () => {
  const stub = { id: 'done', rocketName: '未知火箭', padLocation: '未知地点' }
  const full = {
    id: 'done',
    rocketName: 'Falcon 9',
    padLocation: 'SLC-4E',
    countryDisplay: '美国',
    recoveryIcons: [{ type: 'ASDS' }]
  }
  const kept = pickRicherMissionCard(stub, full)
  assert.equal(kept.rocketName, 'Falcon 9')
  assert.equal(kept.recoveryIcons.length, 1)
})

test('载荷仍是未知有效载荷的历史卡视为不完整', () => {
  assert.equal(
    isIncompleteCompletedListCard({
      rocketName: '长征二号丁/远征三号',
      missionName: '未知有效载荷',
      padLocation: '酒泉卫星发射中心',
      launchSite: '酒泉卫星发射中心, 中国'
    }),
    true
  )
})

test('已公布历史卡不得被陈旧详情的二号丁打回', () => {
  const item = {
    rocketName: '长征四号乙',
    missionName: '遥感 53-01 to 03/56-01 to 03',
    name: '长征四号乙 | 遥感 53-01 to 03/56-01 to 03'
  }
  const displayPatch = {
    rocketName: '长征二号丁/远征三号',
    rocketConfiguration: { name: 'Long March 2D' }
  }
  const stripped = stripWeakerIdentityPatch(item, displayPatch, {
    rocketName: '长征二号丁/远征三号',
    missionName: '未知有效载荷',
    name: '长征二号丁/远征三号 | 未知有效载荷'
  })
  assert.equal(stripped.rocketName, undefined)
  assert.equal(stripped.rocketConfiguration, undefined)
})

test('LL2 name 与 configuration 跨家族时跟 name 显示火箭', () => {
  assert.equal(
    pickLl2AlignedRocketName('Long March 2D', 'Long March 4B | Yaogan 53-01 to 03/56-01 to 03'),
    'Long March 4B'
  )
  assert.equal(
    pickLl2AlignedRocketName('Falcon 9 Block 5', 'Falcon 9 | Starlink Group 17-50'),
    'Falcon 9 Block 5'
  )
  assert.equal(
    pickLl2AlignedRocketName('Zhuque-2E Block 2', 'Zhuque-2E Block 2 | Unknown Payload'),
    'Zhuque-2E Block 2'
  )
})

test('完整但身份错的历史卡不能压过 LL2 真名瘦卡', () => {
  const wrong = {
    id: 'yaogan',
    rocketName: '长征二号丁/远征三号',
    missionName: '未知有效载荷',
    padLocation: '酒泉卫星发射中心',
    launchSite: '酒泉',
    rocketConfiguration: { name: 'Long March 2D' }
  }
  const live = {
    id: 'yaogan',
    rocketName: 'Long March 4B',
    missionName: 'Yaogan 53-01 to 03/56-01 to 03',
    padLocation: '未知地点'
  }
  const kept = pickRicherMissionCard(wrong, live)
  assert.equal(kept.rocketName, 'Long March 4B')
  assert.equal(kept.missionName, 'Yaogan 53-01 to 03/56-01 to 03')
})

test('缺火箭或发射场的历史卡视为不完整', () => {
  assert.equal(
    isIncompleteCompletedListCard({
      rocketName: 'Unknown rocket',
      padLocation: '未知地点'
    }),
    true
  )
  assert.equal(
    isIncompleteCompletedListCard({
      rocketName: '朱雀三号',
      padLocation: '酒泉卫星发射中心',
      launchSite: '酒泉卫星发射中心, 中国'
    }),
    false
  )
})
