/**
 * node --test test/rocket-config-match.test.js
 */
const test = require('node:test')
const assert = require('node:assert/strict')

const {
  foldRocketKey,
  cleanConfigId,
  pickConfigById,
  pickLatestRocketConfigByName,
  pickLatestRocketConfig
} = require('../utils/rocket-config-match.js')

test('cleanConfigId 丢掉微信 dataset 假值', () => {
  assert.equal(cleanConfigId(null), '')
  assert.equal(cleanConfigId('undefined'), '')
  assert.equal(cleanConfigId('null'), '')
  assert.equal(cleanConfigId(' 164 '), '164')
})

test('foldRocketKey 去掉空格和符号', () => {
  assert.equal(foldRocketKey('Falcon 9'), 'falcon9')
  assert.equal(foldRocketKey('长征二号丁'), '长征二号丁')
  assert.equal(foldRocketKey(''), '')
})

test('pickConfigById 只认构型 id', () => {
  const configs = {
    90: { id: 90, name: 'Falcon 9', full_name: 'Falcon 9 v1.0' },
    164: { id: 164, name: 'Falcon 9', full_name: 'Falcon 9 Block 5' }
  }
  assert.equal(pickConfigById(configs, 164).id, 164)
  assert.equal(pickConfigById(configs, '90').id, 90)
  assert.equal(pickConfigById(configs, 'Falcon 9'), null)
  assert.equal(pickConfigById([{ id: 188, name: 'Falcon Heavy' }], 188).name, 'Falcon Heavy')
  assert.equal(pickConfigById({}, ''), null)
})

test('rocket-config-match 不再导出按名反查', () => {
  const match = require('../utils/rocket-config-match.js')
  assert.equal(match.matchRocketConfigByName, undefined)
})

const FALCON_FAMILY = {
  90: {
    id: 90,
    name: 'Falcon 9',
    full_name: 'Falcon 9 v1.0',
    maiden_flight: '2010-06-04',
    active: false,
    total_launch_count: 5
  },
  164: {
    id: 164,
    name: 'Falcon 9',
    full_name: 'Falcon 9 Block 5',
    maiden_flight: '2018-05-11',
    active: true,
    total_launch_count: 400
  },
  188: {
    id: 188,
    name: 'Falcon Heavy',
    full_name: 'Falcon Heavy',
    maiden_flight: '2018-02-06',
    active: true,
    total_launch_count: 11
  },
  215: {
    id: 215,
    name: 'Long March 2D',
    full_name: 'Long March 2D',
    maiden_flight: '2003-09-03',
    active: true,
    total_launch_count: 80
  },
  63: {
    id: 63,
    name: 'Long March 2C',
    full_name: 'Long March 2C',
    maiden_flight: '1982-09-09',
    active: true,
    total_launch_count: 70
  },
  20: {
    id: 20,
    name: 'Long March 1',
    full_name: 'Long March 1',
    maiden_flight: '1970-04-24',
    active: false,
    total_launch_count: 3
  },
  214: {
    id: 214,
    name: 'Long March 11',
    full_name: 'Long March 11',
    maiden_flight: '2015-09-25',
    active: true,
    total_launch_count: 16
  },
  199: {
    id: 199,
    name: 'H3-22',
    full_name: 'H3-22',
    maiden_flight: '2023-03-07',
    active: true,
    total_launch_count: 2
  },
  200: {
    id: 200,
    name: 'H3-24',
    full_name: 'H3-24L',
    maiden_flight: '2024-07-01',
    active: true,
    total_launch_count: 1
  }
}

test('pickLatestRocketConfigByName 同系列取最新款，不误伤 Falcon Heavy', () => {
  assert.equal(pickLatestRocketConfigByName(FALCON_FAMILY, 'Falcon 9').id, 164)
  assert.equal(pickLatestRocketConfigByName(FALCON_FAMILY, 'Falcon Heavy').id, 188)
  assert.equal(pickLatestRocketConfigByName(FALCON_FAMILY, 'Long March 2D').id, 215)
  assert.equal(pickLatestRocketConfigByName(FALCON_FAMILY, 'Electron'), null)
  assert.equal(pickLatestRocketConfigByName([], 'Falcon 9'), null)
})

test('pickLatestRocketConfigByName 精确系列名优先，Long March 1 不误跳 11', () => {
  assert.equal(pickLatestRocketConfigByName(FALCON_FAMILY, 'Long March 1').id, 20)
  assert.equal(pickLatestRocketConfigByName(FALCON_FAMILY, 'Long March 11').id, 214)
  assert.equal(pickLatestRocketConfigByName(FALCON_FAMILY, 'H3').id, 200)
})

test('pickLatestRocketConfig 有旧构型 id 仍升到同系列最新款', () => {
  assert.equal(pickLatestRocketConfig(FALCON_FAMILY, { configId: 90, name: 'Falcon 9' }).id, 164)
  assert.equal(pickLatestRocketConfig(FALCON_FAMILY, { name: 'Falcon 9' }).id, 164)
  assert.equal(pickLatestRocketConfig(FALCON_FAMILY, { configId: 20 }).id, 20)
  assert.equal(pickLatestRocketConfig({}, { configId: 90, name: 'Falcon 9' }), null)
})
