/**
 * NSF 星舰飞行检查清单翻译
 * 运行：node --test test/nsf-checklist-i18n.test.js
 */
const test = require('node:test')
const assert = require('node:assert/strict')

const {
  translateNsfChecklistTitle,
  translateCategory,
  needsMachineTitle
} = require('../cloudfunctions/syncSpaceDevsData/nsf-checklist-i18n.js')
const { isUsableZhText } = require('../cloudfunctions/syncSpaceDevsData/space-terms-i18n.js')
const client = require('../subpackages/progress-extra/utils/nsf-checklist-i18n.js')

test('载具编号跟英文走，不因旧 id 映射错成上一轮编号', () => {
  assert.equal(translateNsfChecklistTitle('Booster 21 Proof Campaign'), '助推器21加压测试流程')
  assert.equal(translateNsfChecklistTitle('Ship 41 Proof Campaign'), '星舰41加压测试流程')
  assert.equal(translateNsfChecklistTitle('Booster 21 Raptor V3 Engines Installed'), '助推器21安装猛禽3发动机')
  assert.equal(translateNsfChecklistTitle('Booster 21 Raptor 3 Engines Installed'), '助推器21安装猛禽3发动机')
  assert.equal(translateNsfChecklistTitle('Ship 41 Raptor Vacuum Engines Installed'), '星舰41安装猛禽真空发动机')
})

test('常见清单动作整句可直接用', () => {
  const cases = [
    ['Booster 21 Rollout', '助推器21转运'],
    ['Ship 41 at Launch Site', '星舰41运抵发射场'],
    ['Ship 41 Stacked', '星舰41吊装至助推器顶部'],
    ['Confirmation from SpaceX', 'SpaceX 官方确认'],
    ['Ship 41 Full Duration Static Fire', '星舰41全时长静态点火'],
    ['Booster 21 Wet Dress Rehearsal', '助推器21湿彩排'],
    ['Booster 21 at Massey Outpost', '助推器21运抵梅西前哨']
  ]
  for (const [en, zh] of cases) {
    assert.equal(translateNsfChecklistTitle(en), zh, en)
    assert.equal(isUsableZhText(zh), true, zh)
    assert.equal(client.translateNsfChecklistTitle(en), zh, 'client:' + en)
  }
})

test('过时 id 映射不再覆盖当前英文标题', () => {
  assert.equal(translateNsfChecklistTitle('Booster 21 Proof Campaign', 10), '助推器21加压测试流程')
})

test('半译或纯英文需要机翻补齐', () => {
  assert.equal(needsMachineTitle('Booster 21 Proof Campaign', 'Booster 21 Proof Campaign'), true)
  assert.equal(needsMachineTitle('助推器21加压测试流程', 'Booster 21 Proof Campaign'), false)
  assert.equal(needsMachineTitle('助推器21 Spin Prime', 'Booster 21 Spin Prime'), true)
  assert.equal(needsMachineTitle('助推器19加压测试流程', 'Booster 21 Proof Campaign'), true)
})

test('展示回退会丢掉编号错位的旧译文', () => {
  assert.equal(
    client.pickDisplayTitle('Booster 21 Proof Campaign', '助推器19加压测试流程'),
    '助推器21加压测试流程'
  )
})

test('云端与小程序短语对同一英文标题结果一致', () => {
  const samples = [
    'Booster 21 Proof Campaign',
    'Ship 41 Raptor Vacuum Engines Installed',
    'Booster 21 at Massey Outpost',
    'Ship 41 Stacked',
    'Confirmation from SpaceX',
    'Booster 21 Raptor 3 Engines Installed'
  ]
  for (const en of samples) {
    assert.equal(client.translateNsfChecklistTitle(en), translateNsfChecklistTitle(en), en)
  }
})

test('分类标签汉化', () => {
  assert.equal(translateCategory('Booster'), '助推器')
  assert.equal(translateCategory('Ship'), '星舰')
  assert.equal(translateCategory('Cosmic_Penguin'), 'Cosmic_Penguin')
})
