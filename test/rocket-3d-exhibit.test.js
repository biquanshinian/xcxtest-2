/**
 * node --test test/rocket-3d-exhibit.test.js
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const { matchRocketConfig, buildExhibit, compactKey, configFromDetailSpecs } = require('../subpackages/rocket-3d/exhibit.js')

test('compactKey 去掉空格与符号', () => {
  assert.equal(compactKey('Falcon 9'), 'falcon9')
  assert.equal(compactKey('长征五号'), '长征五号')
})

test('matchRocketConfig：优先 configId', () => {
  const configs = {
    136: { id: 136, name: 'Falcon 9', full_name: 'Falcon 9 Block 5', length: 70 }
  }
  const hit = matchRocketConfig(configs, { configId: '136', rocketName: '其他' })
  assert.equal(hit.name, 'Falcon 9')
})

test('matchRocketConfig：按中英名模糊命中', () => {
  const configs = {
    1: { id: 1, name: 'Long March 5', nameZh: '长征五号', full_name: 'Long March 5' }
  }
  const hit = matchRocketConfig(configs, { rocketName: '长征五号', rocketNameEn: '' })
  assert.equal(hit.id, 1)
})

test('matchRocketConfig：同名多构型取详情页那种整箭规格', () => {
  const configs = {
    10: { id: 10, name: 'Starship', nameZh: '星舰', length: 50, launch_mass: 45 },
    11: {
      id: 11,
      name: 'Starship',
      full_name: 'Starship V3',
      nameZh: '星舰',
      length: 124.4,
      launch_mass: 5250,
      to_thrust: 80807
    }
  }
  const hit = matchRocketConfig(configs, { rocketName: '星舰', rocketNameEn: 'Starship' })
  assert.equal(hit.id, 11)
  assert.equal(hit.length, 124.4)
})

test('matchRocketConfig：族谱传入的 detailConfig 优先于同名模糊命中', () => {
  const configs = {
    10: { id: 10, name: 'Starship', nameZh: '星舰', length: 50, launch_mass: 45 },
    11: { id: 11, name: 'Starship', nameZh: '星舰', length: 124.4, launch_mass: 5250 }
  }
  const hit = matchRocketConfig(configs, {
    rocketName: '星舰',
    rocketNameEn: 'Starship',
    detailConfig: { id: 11, name: 'Starship', length: 124.4, launch_mass: 5250, to_thrust: 80807 }
  })
  assert.equal(hit.id, 11)
  assert.equal(hit.length, 124.4)
  assert.equal(hit.to_thrust, 80807)
})

test('matchRocketConfig：详情页规格行覆盖元数据', () => {
  const configs = {
    10: { id: 10, name: 'Starship', nameZh: '星舰', length: 50, launch_mass: 45 }
  }
  const hit = matchRocketConfig(configs, {
    configId: '10',
    rocketName: '星舰',
    detailSpecs: [
      { label: '长度', line: '124.4 米' },
      { label: '直径', line: '9 米' },
      { label: '发射质量', line: '5250 吨' }
    ]
  })
  assert.equal(hit.length, 124.4)
  assert.equal(hit.diameter, 9)
  assert.equal(hit.launch_mass, 5250)
})

test('configFromDetailSpecs：按详情页规格卡字段还原', () => {
  const cfg = configFromDetailSpecs([
    { label: '长度', line: '124.4 米' },
    { label: '直径', line: '9 米' },
    { label: '发射质量', line: '5250 吨' },
    { label: '起飞推力', line: '80807 kN' },
    { label: 'LEO 运力', line: '100000 公斤' },
    { label: '级数', line: '2-2 级' }
  ])
  assert.equal(cfg.length, 124.4)
  assert.equal(cfg.diameter, 9)
  assert.equal(cfg.launch_mass, 5250)
  assert.equal(cfg.to_thrust, 80807)
  assert.equal(cfg.leo_capacity, 100000)
  assert.equal(cfg.min_stage, 2)
  assert.equal(cfg.max_stage, 2)
})

test('buildExhibit：数字格式与详情页规格一致', () => {
  const exhibit = buildExhibit(
    { length: 124.4, diameter: 9, launch_mass: 5250 },
    { rocketName: '星舰' }
  )
  assert.equal(exhibit.length, '124.4 m')
  assert.equal(exhibit.diameter, '9 m')
  assert.equal(exhibit.mass, '5250 t')
  assert.match(exhibit.sizeSummary, /全长 124.4 m/)
  assert.match(exhibit.sizeSummary, /起飞质量 5250 t/)
})

test('buildExhibit：尺寸与特征只收集有值字段', () => {
  const exhibit = buildExhibit(
    {
      full_nameZh: '猎鹰9号',
      full_name: 'Falcon 9',
      manufacturerNameZh: '太空探索技术公司',
      length: 70,
      diameter: 3.7,
      launch_mass: 549,
      reusable: true,
      max_stage: 2,
      leo_capacity: 22800,
      descriptionZh: '可回收的中型运载火箭。'
    },
    { rocketName: '猎鹰9号' }
  )
  assert.equal(exhibit.title, '猎鹰9号')
  assert.equal(exhibit.hasSize, true)
  assert.equal(exhibit.hasFeat, true)
  assert.match(exhibit.sizeSummary, /全长 70 m/)
  assert.equal(exhibit.features[0].value, '可复用')
  assert.equal(exhibit.intro, '可回收的中型运载火箭。')
})

test('buildExhibit：无构型时仍可用入口名', () => {
  const exhibit = buildExhibit(null, { rocketName: '星舰', credit: '模型由张三捐赠' })
  assert.equal(exhibit.title, '星舰')
  assert.equal(exhibit.hasSize, false)
  assert.equal(exhibit.credit, '模型由张三捐赠')
})

test('长征成员回落到全系列底模时也不标尺寸', () => {
  const { resolveRocketModel } = require('../subpackages/rocket-3d/models.js')
  const { ingestMediaMap } = require('../utils/rocket-3d-ready.js')
  ingestMediaMap({
    'models/rockets/long-march-series.glb':
      'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/models/rockets/long-march-series.glb'
  })
  try {
    const resolved = resolveRocketModel({ rocketName: '长征十二号甲' })
    assert.equal(resolved.series, true)
    assert.match(resolved.url, /long-march-series\.glb/)
    const exhibit = buildExhibit(
      { length: 69, diameter: 3.8, launch_mass: 433 },
      { rocketName: '长征十二号甲', series: resolved.series }
    )
    assert.equal(exhibit.hasSize, false)
    assert.equal(exhibit.sizeSummary, '')
  } finally {
    ingestMediaMap({})
  }
})

test('buildExhibit：全系列模型不标注尺寸和特征特写', () => {
  const exhibit = buildExhibit(
    { length: 57, diameter: 5, launch_mass: 800, reusable: false, descriptionZh: '系列示意' },
    { rocketName: '长征五号', series: true }
  )
  assert.equal(exhibit.series, true)
  assert.equal(exhibit.hasSize, false)
  assert.equal(exhibit.hasFeat, false)
  assert.equal(exhibit.sizeSummary, '')
})
