/**
 * 通用分享缩略图
 * node --test test/share-thumb.test.js
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
  SHARE_THUMB_FALLBACK,
  isLocalSharePath,
  pickShareImageUrl,
  pickShareDownloadSrc,
  shareOptsFromCard
} = require('../utils/share-thumb.js')

test('webp / imageMogr2 不当远程 imageUrl，预下载走去参原链', () => {
  const raw = 'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/nsf/f9.webp?imageMogr2/thumbnail/480x/format/webp/quality/70'
  assert.equal(pickShareImageUrl({ rawImage: raw }), SHARE_THUMB_FALLBACK)
  assert.equal(
    pickShareDownloadSrc({ rawImage: raw }),
    'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/nsf/f9.webp'
  )
})

test('COS jpg 去掉 imageMogr2 后可直接分享', () => {
  const raw = 'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/%E7%81%AB%E7%AE%AD%E9%85%8D%E7%BD%AE%E5%9B%BE/Falcon%209.jpg?imageMogr2/thumbnail/480x/format/webp/quality/70'
  const picked = pickShareImageUrl({ rawImage: raw })
  assert.ok(picked.indexOf('Falcon') >= 0 || picked.indexOf('%E7%81%AB') >= 0, picked)
  assert.ok(!picked.includes('imageMogr2'))
  assert.ok(!picked.includes('format/webp'))
})

test('LL2 外链预下载走 Worker 代理', () => {
  const raw = 'https://thespacedevs-prod.nyc3.digitaloceanspaces.com/media/images/dragon_image.jpeg'
  const src = pickShareDownloadSrc({ rawImage: raw })
  assert.ok(src.includes('/image?url='), src)
  const picked = pickShareImageUrl({ rawImage: raw })
  assert.ok(picked.includes('/image?url=') || picked === SHARE_THUMB_FALLBACK, picked)
})

test('cloud:// 不当远程 imageUrl，预下载保留 fileID', () => {
  const fileId = 'cloud://prod.xxxx/nsf/ship39.jpg'
  assert.equal(pickShareImageUrl({ rawImage: fileId }), SHARE_THUMB_FALLBACK)
  assert.equal(pickShareDownloadSrc({ rawImage: fileId }), fileId)
})

test('本地缓存路径可直接分享', () => {
  const local = 'wxfile://tmp_share.jpg'
  assert.equal(isLocalSharePath(local), true)
  assert.equal(pickShareImageUrl({ displayImage: local }), local)
})

test('default.jpg 占位不当分享图', () => {
  const def = 'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/火箭配置图/default.jpg'
  assert.equal(pickShareImageUrl({ rawImage: def }), SHARE_THUMB_FALLBACK)
  assert.equal(pickShareDownloadSrc({ rawImage: def }), SHARE_THUMB_FALLBACK)
})

test('空图回退 SpaceX logo', () => {
  assert.equal(pickShareImageUrl({}), SHARE_THUMB_FALLBACK)
  assert.ok(/^https:\/\//.test(SHARE_THUMB_FALLBACK))
})

test('卡片 webp 压缩回退原 jpg', () => {
  const thumb = 'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/%E7%A9%BA%E9%97%B4%E7%AB%99/iss.jpg?imageMogr2/thumbnail/480x/format/webp/quality/70'
  const raw = 'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/%E7%A9%BA%E9%97%B4%E7%AB%99/iss.jpg'
  const picked = pickShareImageUrl(shareOptsFromCard({
    imageUrl: thumb,
    imageFallbacks: [raw]
  }))
  assert.equal(picked, raw)
})
