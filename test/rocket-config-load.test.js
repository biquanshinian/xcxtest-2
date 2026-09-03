/**
 * node --test test/rocket-config-load.test.js
 * 首页/改期弹窗火箭配置图加载链路：thumb 展示、原图可升级压缩、启动预热。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')

global.wx = global.wx || {
  env: { USER_DATA_PATH: '/tmp' },
  getStorageSync() { return {} },
  setStorageSync() {},
  setStorage() {},
  getStorage() {},
  removeStorage() {},
  getFileSystemManager() {
    return {
      accessSync() { throw new Error('no file') },
      mkdirSync() {},
      unlink() {},
      unlinkSync() {},
      readdirSync() { return [] }
    }
  },
  getNetworkType(o) { o && o.success && o.success({ networkType: 'wifi' }) },
  downloadFile(o) { o && o.fail && o.fail(new Error('mock')) },
  getImageInfo() {}
}

const { getCachedRocketConfig } = require('../utils/icon-cache.js')
const { shouldReplaceRocketImage, isDefaultRocketSrc } = require('../utils/util.js')

test('首页火箭配置图默认走 thumb 480，而不是 960 medium', () => {
  const src = getCachedRocketConfig('https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/x.jpg')
  assert.match(String(src), /imageMogr2\/thumbnail\/480x/)
  assert.doesNotMatch(String(src), /thumbnail\/960x/)
})

test('旧 medium 盖章会改写成 thumb，避免继续拉 960w', () => {
  const src = getCachedRocketConfig(
    'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/x.jpg?imageMogr2/thumbnail/960x/format/webp/quality/80'
  )
  assert.match(String(src), /imageMogr2\/thumbnail\/480x/)
})

test('详情头图可显式升到 medium 960', () => {
  const src = getCachedRocketConfig(
    'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/x.jpg',
    'medium'
  )
  assert.match(String(src), /imageMogr2\/thumbnail\/960x/)
})

test('shouldReplaceRocketImage：未压缩原链应被压缩链替换', () => {
  const raw = 'https://cdn.example/f9.jpg'
  const compressed = raw + '?imageMogr2/thumbnail/480x/format/webp/quality/70'
  assert.equal(shouldReplaceRocketImage(raw, compressed), true)
  assert.equal(shouldReplaceRocketImage(compressed, raw), false)
})

test('shouldReplaceRocketImage：不同压缩档允许换成新结果', () => {
  const thumb = 'https://cdn.example/f9.jpg?imageMogr2/thumbnail/480x/format/webp/quality/70'
  const medium = 'https://cdn.example/f9.jpg?imageMogr2/thumbnail/960x/format/webp/quality/80'
  assert.equal(shouldReplaceRocketImage(thumb, medium), true)
  assert.equal(shouldReplaceRocketImage(medium, thumb), true)
})

test('shouldReplaceRocketImage：禁止非 default 被 default 盖掉', () => {
  const real = 'https://cdn.example/f9.jpg?imageMogr2/thumbnail/480x/format/webp/quality/70'
  assert.equal(isDefaultRocketSrc(real), false)
  assert.equal(shouldReplaceRocketImage(real, '火箭配置图/default.jpg'), false)
})

test('media map 冷启动不再调 COS 列举云函数', () => {
  const src = fs.readFileSync(path.join(ROOT, 'utils/image-config.js'), 'utf8')
  assert.doesNotMatch(src, /maybeInvokeRocketCosSync/)
  assert.doesNotMatch(src, /syncRocketCosIndex/)
  assert.doesNotMatch(
    src,
    /await maybeInvokeRocketCosSync\(\)\s*\n\s*try \{\s*\n\s*let fetchedMap/
  )
})

test('开屏预拉不在 onLaunch 打 media map 云函数', () => {
  const src = fs.readFileSync(path.join(ROOT, 'subpackages/index-extra/utils/splash-prefetch.js'), 'utf8')
  assert.doesNotMatch(src, /loadCloudMediaMap/)
})

test('详情页头图升 medium，避免 thumb 发糊', () => {
  const src = fs.readFileSync(path.join(ROOT, 'pages/mission-detail/mission-detail.js'), 'utf8')
  assert.match(src, /getCachedRocketConfig\(u, 'medium'\)/)
  assert.match(src, /function toDetailRocketSrc/)
})
