/**
 * 火箭对比 / 档案指数分享缩略图
 * node --test test/rocket-model-share-image.test.js
 */
const test = require('node:test')
const assert = require('node:assert/strict')

global.wx = global.wx || {
  env: { USER_DATA_PATH: '/tmp/usr' },
  getStorageSync() { return '' },
  setStorageSync() {},
  getFileSystemManager() {
    return {
      accessSync() { throw new Error('no file') },
      mkdirSync() {},
      writeFileSync() {},
      readFileSync() { throw new Error('no file') }
    }
  }
}

const {
  ROCKET_MODEL_SHARE_SAFE_FALLBACK,
  isLocalSharePath,
  pickRocketModelShareImageUrl,
  pickRocketModelShareSourceForDownload,
  rocketShareOptsFromModel
} = require('../subpackages/monitor-pages/utils/rocket-model-share-image.js')

test('webp / imageMogr2 不当远程 imageUrl，预下载走去参原链', () => {
  const raw = 'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/nsf/f9.webp?imageMogr2/thumbnail/480x/format/webp/quality/70'
  assert.equal(pickRocketModelShareImageUrl({ rawImage: raw }), ROCKET_MODEL_SHARE_SAFE_FALLBACK)
  assert.equal(
    pickRocketModelShareSourceForDownload({ rawImage: raw }),
    'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/nsf/f9.webp'
  )
})

test('COS jpg 去掉 imageMogr2 后可直接分享', () => {
  const raw = 'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/%E7%81%AB%E7%AE%AD%E9%85%8D%E7%BD%AE%E5%9B%BE/Falcon%209.jpg?imageMogr2/thumbnail/480x/format/webp/quality/70'
  const picked = pickRocketModelShareImageUrl({ rawImage: raw })
  assert.ok(picked.indexOf('Falcon') >= 0 || picked.indexOf('%E7%81%AB') >= 0, picked)
  assert.ok(!picked.includes('imageMogr2'))
  assert.ok(!picked.includes('format/webp'))
})

test('LL2 外链预下载走 Worker 代理，不当直连 imageUrl', () => {
  const raw = 'https://thespacedevs-prod.nyc3.digitaloceanspaces.com/media/images/falcon_9_image.jpeg'
  const src = pickRocketModelShareSourceForDownload({ rawImage: raw })
  assert.ok(src.includes('/image?url='), src)
  const picked = pickRocketModelShareImageUrl({ rawImage: raw })
  assert.ok(picked.includes('/image?url=') || picked === ROCKET_MODEL_SHARE_SAFE_FALLBACK, picked)
})

test('本地缓存路径可直接分享', () => {
  const local = 'wxfile://tmp_f9.jpg'
  assert.equal(isLocalSharePath(local), true)
  assert.equal(pickRocketModelShareImageUrl({ displayImage: local }), local)
})

test('default.jpg 占位不当分享图', () => {
  const def = 'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/火箭配置图/default.jpg'
  assert.equal(pickRocketModelShareImageUrl({ rawImage: def }), ROCKET_MODEL_SHARE_SAFE_FALLBACK)
  assert.equal(pickRocketModelShareSourceForDownload({ rawImage: def }), ROCKET_MODEL_SHARE_SAFE_FALLBACK)
})

test('空图回退 SpaceX logo，保证朋友圈有缩略图', () => {
  assert.equal(pickRocketModelShareImageUrl({}), ROCKET_MODEL_SHARE_SAFE_FALLBACK)
  assert.ok(/^https:\/\//.test(ROCKET_MODEL_SHARE_SAFE_FALLBACK))
})

test('空间站 COS 头图：卡片 webp 压缩不当分享，回退原 jpg', () => {
  const thumb = 'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/%E7%A9%BA%E9%97%B4%E7%AB%99/iss.jpg?imageMogr2/thumbnail/480x/format/webp/quality/70'
  const raw = 'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/%E7%A9%BA%E9%97%B4%E7%AB%99/iss.jpg'
  const picked = pickRocketModelShareImageUrl({
    displayImage: thumb,
    rawImage: thumb,
    fallbacks: [raw]
  })
  assert.equal(picked, raw)
  assert.ok(!picked.includes('imageMogr2'))
})

test('rocketShareOptsFromModel 带上 imageFallbacks', () => {
  const opts = rocketShareOptsFromModel({
    imageUrl: 'https://cdn.example/thumb.webp',
    imageFallbacks: ['https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/cfg/f9.jpg'],
    nameEn: 'Falcon 9',
    fullNameEn: 'Falcon 9 Block 5'
  })
  assert.equal(opts.rocketName, 'Falcon 9 Block 5')
  assert.equal(opts.rawImage, 'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/cfg/f9.jpg')
  const picked = pickRocketModelShareImageUrl(opts)
  assert.ok(picked.endsWith('/cfg/f9.jpg'), picked)
})
