/**
 * 星舰硬件 / 型号详情分享缩略图
 * node --test test/hardware-share-image.test.js
 */
const test = require('node:test')
const assert = require('node:assert/strict')

global.wx = global.wx || {
  env: { USER_DATA_PATH: '/tmp/usr' },
  getStorageSync() { return '' },
  setStorageSync() {}
}

const {
  HARDWARE_SHARE_SAFE_FALLBACK,
  isLocalSharePath,
  pickHardwareShareImageUrl,
  pickHardwareShareSourceForDownload
} = require('../subpackages/progress-extra/utils/hardware-share-image.js')

test('cloud:// 头图不能直接当 imageUrl，先落到 SpaceX logo', () => {
  const fileId = 'cloud://prod-env.bucket/nsf_hardware/b19.jpg'
  const picked = pickHardwareShareImageUrl({ rawImage: fileId, displayImage: fileId })
  assert.equal(picked, HARDWARE_SHARE_SAFE_FALLBACK)
  assert.ok(/^https:\/\//.test(picked))
  assert.ok(!picked.includes('cloud://'))
})

test('cloud:// 预下载源保持 fileID，交给 getImageInfo', () => {
  const fileId = 'cloud://prod-env.bucket/nsf_hardware/s39.jpg'
  assert.equal(
    pickHardwareShareSourceForDownload({ rawImage: fileId, displayImage: fileId }),
    fileId
  )
})

test('本地缓存路径可直接分享', () => {
  const local = 'wxfile://tmp_nsf_b19.jpg'
  assert.equal(isLocalSharePath(local), true)
  assert.equal(pickHardwareShareImageUrl({ displayImage: local, rawImage: 'cloud://x/y' }), local)
  assert.equal(pickHardwareShareSourceForDownload({ displayImage: local }), local)
})

test('COS https jpg 可作远程分享图，并去掉 imageMogr2', () => {
  const raw = 'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/nsf/b19.jpg?imageMogr2/thumbnail/960x/format/webp/quality/80'
  const picked = pickHardwareShareImageUrl({ rawImage: raw })
  assert.equal(picked, 'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/nsf/b19.jpg')
  assert.ok(!picked.includes('imageMogr2'))
})

test('webp 原链不当远程 imageUrl，预下载仍走原图', () => {
  const webp = 'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/starship/b19_spacex3.webp'
  assert.equal(pickHardwareShareImageUrl({ rawImage: webp }), HARDWARE_SHARE_SAFE_FALLBACK)
  assert.equal(pickHardwareShareSourceForDownload({ rawImage: webp }), webp)
})

test('外链头图预下载走 Worker 代理', () => {
  const raw = 'https://nextspaceflight.com/img/hardware/s40.jpg'
  const src = pickHardwareShareSourceForDownload({ rawImage: raw })
  assert.ok(src.includes('/image?url='), src)
  assert.ok(src.includes(encodeURIComponent(raw)))
})

test('空头图回退 SpaceX logo，保证朋友圈有缩略图', () => {
  assert.equal(pickHardwareShareImageUrl({}), HARDWARE_SHARE_SAFE_FALLBACK)
  assert.equal(pickHardwareShareSourceForDownload({}), HARDWARE_SHARE_SAFE_FALLBACK)
})
