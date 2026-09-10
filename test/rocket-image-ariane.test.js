/**
 * node --test test/rocket-image-ariane.test.js
 * 后台命中预览用英文 Ariane 6；前端展示名是阿丽亚娜6，必须仍能配到 Ariane 64.jpg。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const Module = require('module')

global.wx = {
  env: { USER_DATA_PATH: '/tmp' },
  getStorageSync() { return '' },
  setStorageSync() {},
  setStorage() {},
  getStorage() {},
  getFileSystemManager() {
    return {
      accessSync() { throw new Error('no file') },
      mkdirSync() {},
      writeFileSync() {},
      readFileSync() { throw new Error('no file') }
    }
  }
}

const ROOT = path.join(__dirname, '..')
const imgAbs = path.join(ROOT, 'utils', 'image-config.js')
const src = fs.readFileSync(imgAbs, 'utf8')
const m = new Module(imgAbs)
m.filename = imgAbs
m.paths = Module._nodeModulePaths(path.dirname(imgAbs))
m._compile(
  src +
    '\nmodule.exports.__setCloudMediaMap = function (map) {\n' +
    '  runtimeCloudMediaMap = map || {}\n' +
    '  cloudMapLoaded = true\n' +
    '  rebuildCanonicalIndex()\n' +
    '}\nmodule.exports.__findFuzzy = findFuzzyRocketConfigUrl\n',
  imgAbs
)
require.cache[imgAbs] = m

const ARIANE_URL = 'https://cdn.example/火箭配置图/Ariane 64.jpg'
m.exports.__setCloudMediaMap({
  '火箭配置图/Ariane 64.jpg': ARIANE_URL,
  '火箭配置图/Falcon 9 Block 5.jpg': 'https://cdn.example/f9.jpg',
  '火箭配置图/default.jpg': 'https://cdn.example/default.jpg'
})

const {
  getRocketImage,
  isDefaultRocketSrc,
  resolveMissionRocketImage
} = require('../utils/util.js')

test('英文 Ariane 6 / 62 / 64 都配到 Ariane 64.jpg', () => {
  for (const name of ['Ariane 6', 'Ariane 62', 'Ariane 64', 'Ariane 64 Block 2']) {
    const url = getRocketImage(name)
    assert.equal(isDefaultRocketSrc(url), false, name)
    assert.match(String(url), /Ariane%2064\.jpg|Ariane 64\.jpg/)
  }
})

test('中文阿丽亚娜 / 阿里安与后台英文命中预览对齐', () => {
  for (const name of ['阿丽亚娜6', '阿丽亚娜62', '阿丽亚娜64', '阿里安 6']) {
    const url = getRocketImage(name)
    assert.equal(isDefaultRocketSrc(url), false, name)
    assert.match(String(url), /Ariane%2064\.jpg|Ariane 64\.jpg/, name)
  }
})

test('Ariane 64 Block 2 不被 64block 型号拦截', () => {
  const fuzzy = m.exports.__findFuzzy('Ariane 64 Block 2')
  assert.equal(fuzzy, ARIANE_URL)
})

test('前端 resolve 仅有中文展示名时也不再掉 default', () => {
  const url = resolveMissionRocketImage('', '阿丽亚娜6', null, true)
  assert.equal(isDefaultRocketSrc(url), false)
  assert.match(String(url), /Ariane%2064\.jpg|Ariane 64\.jpg/)
})
