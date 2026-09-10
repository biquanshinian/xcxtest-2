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
const {
  shouldReplaceRocketImage,
  shouldReplaceRocketImageForArt,
  isDefaultRocketSrc,
  isBrokenRocketDisplaySrc
} = require('../utils/util.js')
const rocketArtUtil = require('../utils/rocket-config-art.js')

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

test('失效 wxfile 必须被换掉，且不能盖住好图', () => {
  const dead = 'wxfile://tmp/dead-rocket.jpg'
  const https = 'https://cdn.example/f9.jpg?imageMogr2/thumbnail/480x/format/webp/quality/70'
  assert.equal(isBrokenRocketDisplaySrc(''), true)
  assert.equal(isBrokenRocketDisplaySrc(dead), true)
  assert.equal(isBrokenRocketDisplaySrc(https), false)
  assert.equal(shouldReplaceRocketImage(dead, https), true)
  assert.equal(shouldReplaceRocketImage(https, dead), false)
  assert.equal(shouldReplaceRocketImage(https, '火箭配置图/default.jpg'), false)
  assert.equal(shouldReplaceRocketImageForArt(https, '火箭配置图/default.jpg'), false)
  assert.equal(shouldReplaceRocketImageForArt(https, dead), false)
  assert.equal(shouldReplaceRocketImageForArt(dead, https), true)
})

test('getCachedRocketConfig：memo 命中 wxfile 必须先 accessSync', () => {
  const src = fs.readFileSync(path.join(ROOT, 'utils/icon-cache.js'), 'utf8')
  const start = src.indexOf('function getCachedRocketConfig')
  const end = src.indexOf('function _downloadRocketInBackground')
  assert.ok(start >= 0 && end > start)
  const fn = src.slice(start, end)
  assert.match(fn, /accessSync\(memo\)/)
  assert.match(fn, /delete _rocketUrlMemo\[url\]/)
})

test('回首页修补失效/default 配置图，首次 onShow 不 art 重刷', () => {
  const indexJs = fs.readFileSync(path.join(ROOT, 'pages/index/index.js'), 'utf8')
  const interaction = fs.readFileSync(
    path.join(ROOT, 'subpackages/index-extra/utils/index-interaction.js'),
    'utf8'
  )
  assert.match(indexJs, /"_repairVisibleRocketImages"/)
  assert.match(indexJs, /this\._repairVisibleRocketImages\(\)/)
  assert.match(interaction, /_repairVisibleRocketImages\s*\(/)
  assert.match(interaction, /isBrokenRocketDisplaySrc/)
  assert.match(interaction, /loadCloudMediaMap\(\)/)

  let calls = 0
  const page = {
    refreshRocketConfigArt() {
      calls += 1
    }
  }
  assert.equal(rocketArtUtil.applyRocketConfigArtIfNeeded(page), false)
  assert.equal(calls, 0)
  assert.equal(page._rocketArtAppliedVersion, rocketArtUtil.getRocketConfigArtVersion())
  assert.equal(rocketArtUtil.applyRocketConfigArtIfNeeded(page), false)
  assert.equal(calls, 0)

  const stale = {
    _rocketArtAppliedVersion: 0,
    refreshRocketConfigArt() {
      calls += 1
    }
  }
  rocketArtUtil.applyRocketConfigArtIfNeeded(stale)
  assert.equal(calls, 0, 'media map 未就绪时不得 art 重刷')
  assert.equal(stale._rocketArtAppliedVersion, 0)
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

test('未登记火箭配置图不猜 COS 文件名，避免 ZhuQue/Starship 404', () => {
  const { resolveMediaUrl } = require('../utils/image-config.js')
  const zhuque = String(resolveMediaUrl('火箭配置图/ZhuQue-3.jpg', ''))
  const starship = String(resolveMediaUrl('火箭配置图/Starship V3 Flight 12.jpg', ''))
  assert.doesNotMatch(zhuque, /ZhuQue-3\.jpg/)
  assert.doesNotMatch(starship, /Starship V3 Flight 12/)
  assert.match(zhuque, /default\.jpg/)
  assert.match(starship, /default\.jpg/)
})

test('Worker /image 代理与首页轮播不走 downloadFile', () => {
  let downloads = 0
  const orig = wx.downloadFile
  wx.downloadFile = function (o) {
    downloads += 1
    o && o.fail && o.fail(new Error('mock'))
  }
  const { getCachedMediaImage } = require('../utils/icon-cache.js')
  const proxy = 'https://api.marsx.com.cn/image?url=' + encodeURIComponent('https://thespacedevs-prod.nyc3.digitaloceanspaces.com/x.jpg')
  assert.equal(getCachedMediaImage(proxy, 'thumb'), proxy)
  const banner = 'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/' + encodeURI('首页轮播图/preview/a.jpg')
  const bannerOut = String(getCachedMediaImage(banner, 'medium'))
  assert.match(bannerOut, /imageMogr2\/thumbnail\/960x/)
  assert.equal(downloads, 0)
  wx.downloadFile = orig
})

test('详情页头图升 medium，避免 thumb 发糊', () => {
  const src = fs.readFileSync(path.join(ROOT, 'pages/mission-detail/mission-detail.js'), 'utf8')
  assert.match(src, /getCachedRocketConfig\(u, 'medium'\)/)
  assert.match(src, /function toDetailRocketSrc/)
})
