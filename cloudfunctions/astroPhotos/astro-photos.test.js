/**
 * 航天摄影轻量单测：约束 + COS PostObject 签名 + 安检自动过审门控 + fileID
 */
const assert = require('assert')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const MAX_PHOTOS = 8
const MAX_BYTES = 30 * 1024 * 1024
const MAX_EDGE = 3840
const UPLOAD_PASSWORD = 'zghtzp'

function validateClientPhoto({ size, width, height }) {
  if (!(width > 0 && height > 0)) return 'dims'
  if (size > MAX_BYTES) return 'size'
  if (Math.max(width, height) > MAX_EDGE) return 'edge'
  return ''
}

function checkUploadPassword(pwd) {
  const p = String(pwd || '').trim()
  if (!p) return false
  return p === UPLOAD_PASSWORD
}

function isCloudFileId(fileID) {
  return /^cloud:\/\//i.test(String(fileID || '').trim())
}

function normalizeSecSuggest(suggest) {
  const s = String(suggest || '').toLowerCase()
  if (s === 'pass' || s === 'risky' || s === 'review') return s
  if (s === 'error') return 'error'
  return ''
}

function textSecAllowsAutoApprove(sec) {
  if (!sec || sec.decision === 'reject') return false
  const checks = sec.checks || {}
  for (const key of Object.keys(checks)) {
    const suggest = normalizeSecSuggest(checks[key] && checks[key].suggest)
    if (suggest === 'risky' || suggest === 'review' || suggest === 'error') return false
  }
  return true
}

function isPhotoListItem(item) {
  if (!item || typeof item !== 'object') return false
  const id = item.id || item._id
  if (!id) return false
  if (item.newsSite) return false
  if (item.type && item.date && !item.authorName) return false
  const cover = item.coverUrl || item.cardImage ||
    (item.photos && item.photos[0] && (item.photos[0].url || item.photos[0].displayUrl))
  return !!(item.authorName && cover)
}

/** 腾讯云 PostObject 签名：SHA1(Policy文本) 作为 StringToSign */
function signPostObjectPolicy(secretKey, keyTime, policyObj) {
  const policyText = JSON.stringify(policyObj)
  const policy = Buffer.from(policyText).toString('base64')
  const signKey = crypto.createHmac('sha1', secretKey).update(keyTime).digest('hex')
  const stringToSign = crypto.createHash('sha1').update(policyText).digest('hex')
  const signature = crypto.createHmac('sha1', signKey).update(stringToSign).digest('hex')
  return { policy, signature, stringToSign }
}

assert.strictEqual(validateClientPhoto({ size: MAX_BYTES + 1, width: 100, height: 100 }), 'size')
assert.strictEqual(validateClientPhoto({ size: 1000, width: 4000, height: 2000 }), 'edge')
assert.strictEqual(validateClientPhoto({ size: 1000, width: 0, height: 0 }), 'dims')
assert.strictEqual(validateClientPhoto({ size: 1000, width: 3840, height: 2160 }), '')
assert.ok(MAX_PHOTOS === 8)
assert.ok(checkUploadPassword('zghtzp'))
assert.ok(!checkUploadPassword('wrong'))

function publicListWhenDisabled(enabled) {
  if (!enabled) return { list: [], total: 0, hasMore: false, enabled: false, latestAt: 0 }
  return { enabled: true }
}
const gated = publicListWhenDisabled(false)
assert.strictEqual(gated.enabled, false)
assert.strictEqual(gated.list.length, 0)
assert.strictEqual(gated.latestAt, 0, 'disabled listPublic must expose latestAt:0')

function bumpOptsForStatus(status) {
  return status === 'approved' ? { touchLatest: true } : undefined
}
assert.ok(bumpOptsForStatus('approved') && bumpOptsForStatus('approved').touchLatest)
assert.strictEqual(bumpOptsForStatus('pending'), undefined)
assert.strictEqual(bumpOptsForStatus('rejected'), undefined)

const signed = signPostObjectPolicy('testSecret', '100;200', {
  expiration: '2020-01-01T00:00:00.000Z',
  conditions: [{ bucket: 'b' }, ['eq', '$key', 'k']]
})
assert.ok(signed.policy.length > 0)
assert.strictEqual(signed.stringToSign.length, 40)
assert.strictEqual(signed.signature.length, 40)
// 错误算法（HMAC base64 policy）不得与正确签名相同
const wrongSig = crypto
  .createHmac('sha1', crypto.createHmac('sha1', 'testSecret').update('100;200').digest('hex'))
  .update(signed.policy)
  .digest('hex')
assert.notStrictEqual(signed.signature, wrongSig)

assert.ok(isCloudFileId('cloud://env.xxx/astro_photo_tmp/a.jpg'))
assert.ok(!isCloudFileId('https://example.com/a.jpg'))
assert.ok(!isCloudFileId(''))

assert.ok(textSecAllowsAutoApprove({ decision: 'pending', checks: { authorName: { suggest: 'pass' } } }))
assert.ok(!textSecAllowsAutoApprove({ decision: 'reject', checks: {} }))
assert.ok(!textSecAllowsAutoApprove({ decision: 'pending', checks: { intro: { suggest: 'review' } } }))
assert.ok(!textSecAllowsAutoApprove({ decision: 'pending', checks: { intro: { suggest: 'error' } } }))
assert.ok(!textSecAllowsAutoApprove({ decision: 'pending', checks: { intro: { suggest: 'risky' } } }))

assert.ok(isPhotoListItem({ id: '1', authorName: 'A', coverUrl: 'https://x/y.jpg' }))
assert.ok(!isPhotoListItem({ id: '1', newsSite: 'NASA', title: 't', image: 'https://x/y.jpg' }))
assert.ok(!isPhotoListItem({ id: '1', type: 'Launch', date: '2026-01-01', image: 'https://x/y.jpg' }))
assert.ok(!isPhotoListItem({ id: '1', _listKind: 'photo' }))

const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'))
assert.ok(Number(cfg.timeout) >= 60, 'astroPhotos timeout should be >= 60s for multi-image transfer')

const indexSrc = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8')
assert.ok(indexSrc.includes("case 'deleteMine'"), 'deleteMine action required')
assert.ok(indexSrc.includes("case 'editMine'"), 'editMine action required')
assert.ok(indexSrc.includes('MAX_OWNER_EDITS'), 'one-time edit limit required')
assert.ok(indexSrc.includes('每条投稿仅可重新编辑一次'), 'one-time edit message required')
assert.ok(indexSrc.includes('deviceModel'), 'deviceModel field required')
assert.ok(indexSrc.includes('_openid: openid'), 'uploader openid must be stored')
assert.ok(indexSrc.includes('只能删除自己的投稿'), 'owner-only delete guard required')
assert.ok(indexSrc.includes('collectPhotoCosKeys'), 'COS key collection required for cleanup')
assert.ok(indexSrc.includes('runTransaction'), 'editMine should use transaction for editCount')
assert.ok(indexSrc.includes('EDIT_USED'), 'editMine concurrency guard required')
assert.ok(indexSrc.includes('password_gate'), 'password auto-approve path required')
assert.ok(indexSrc.includes('isCloudFileId'), 'cloud fileID validation required')
assert.ok(indexSrc.includes('bustListPublicCache'), 'list cache bust required')
assert.ok(indexSrc.includes('bumpListEpoch'), 'cross-instance list epoch bump required')
assert.ok(indexSrc.includes('astroPhotosListEpoch'), 'list epoch field required')
assert.ok(indexSrc.includes('astroPhotosLatestAt'), 'latestAt for nav red-dot required')
assert.ok(indexSrc.includes('touchLatest'), 'touchLatest on approve/submit required')
assert.ok(indexSrc.includes('latestAt'), 'listPublic should expose latestAt')
assert.ok(indexSrc.includes('ensurePhotoCounts'), 'legacy photoCount backfill required')
assert.ok(indexSrc.includes('failClosed'), 'feature flag failClosed required')
assert.ok(indexSrc.includes('LIST_CACHE_TTL_MS'), 'listPublic short cache required')
assert.ok(indexSrc.includes('FLAG_CACHE_TTL_MS'), 'feature flag short cache required')
assert.ok(indexSrc.includes('includePhotos: false'), 'listPublic should omit photos payload')
assert.ok(!/listPublic[\s\S]{0,800}?\.count\(/.test(indexSrc), 'listPublic should not call count()')
// 拒稿编辑后安检通过应能重新上墙（不再卡 rejected）
assert.ok(
  !/if \(autoApprove\) \{\s*if \(status !== 'rejected'\) status = 'approved'/.test(indexSrc),
  'editMine autoApprove should not keep rejected'
)

function resolvePhotoCount(doc) {
  if (!doc) return 0
  if (doc.photoCount != null && doc.photoCount !== '') {
    const n = Math.max(0, Number(doc.photoCount) || 0)
    return Math.min(MAX_PHOTOS, n)
  }
  if (Array.isArray(doc.photos)) return Math.min(MAX_PHOTOS, doc.photos.length)
  return 0
}
assert.strictEqual(resolvePhotoCount({ photoCount: 3 }), 3)
assert.strictEqual(resolvePhotoCount({ photos: [{}, {}] }), 2)
assert.strictEqual(resolvePhotoCount({ photoCount: 0 }), 0)
assert.strictEqual(resolvePhotoCount({}), 0)

const newsSrc = fs.readFileSync(path.join(__dirname, '../../pages/news/news.js'), 'utf8')
assert.ok(newsSrc.includes("CACHE_KEY_PHOTOS: 'news_cache_photos_v2'"), 'news list uses photos cache v2')
const detailSrc = fs.readFileSync(path.join(__dirname, '../../subpackages/news-extra/photo-detail.js'), 'utf8')
const uploadSrc = fs.readFileSync(path.join(__dirname, '../../subpackages/news-extra/photo-upload.js'), 'utf8')
assert.ok(detailSrc.includes("news_cache_photos_v2"), 'photo-detail must invalidate v2 cache')
assert.ok(uploadSrc.includes("news_cache_photos_v2"), 'photo-upload must invalidate v2 cache')
// 看图区不得 catchtouchmove：会挡住外层 scroll-view 上下滑
const detailWxml = fs.readFileSync(path.join(__dirname, '../../subpackages/news-extra/photo-detail.wxml'), 'utf8')
assert.ok(!/photo-gallery[\s\S]{0,200}?catchtouchmove/.test(detailWxml), 'gallery must not catchtouchmove (blocks vertical scroll)')

const lazySrc = fs.readFileSync(path.join(__dirname, '../../subpackages/news-extra/utils/news-lazy.js'), 'utf8')
assert.ok(lazySrc.includes("contentType === 'photos'"), 'photos tab must not light red-dot')
assert.ok(lazySrc.includes('acknowledgePhotosNavDot'), 'photos ack required')
assert.ok(lazySrc.includes('Math.max'), 'ack/hint must merge latestAt')

const adminSrc = fs.readFileSync(path.join(__dirname, '../adminGateway/index.js'), 'utf8')
assert.ok(adminSrc.includes('bumpAstroPhotosListEpoch'), 'adminGateway must bump list epoch')
assert.ok(adminSrc.includes('beforeRes.data.status !== \'approved\''), 'admin touchLatest only on newly approved')
assert.ok(indexSrc.includes('prevStatus !== \'approved\''), 'edit/review touchLatest only on newly approved')

const newsSrc2 = fs.readFileSync(path.join(__dirname, '../../pages/news/news.js'), 'utf8')
const photosLazySrc = fs.readFileSync(path.join(__dirname, '../../subpackages/news-extra/utils/news-photos-lazy.js'), 'utf8')
assert.ok(newsSrc2.includes('acknowledgePhotosNavDot(photosLatestAt)'), 'must ack with listPublic latestAt after stale check')
assert.ok(newsSrc2.includes("type !== 'photos'") || newsSrc2.includes("type !== \"photos\""), 'skip refresh race after enter photos')
assert.ok(newsSrc2.includes('news-photos-lazy.js'), 'photo UI must load via news-photos-lazy')
assert.ok(photosLazySrc.includes('cfg._id && cfg.enableAstroPhotos === true'), 'photos nav failClosed requires valid main')
assert.ok(photosLazySrc.includes('_formatPhotosList'), 'photos format must live in news-photos-lazy')
assert.ok(photosLazySrc.includes('goPhotoUpload'), 'photo upload entry must live in news-photos-lazy')
assert.ok(
  fs.readFileSync(path.join(__dirname, '../../utils/feature-flags.js'), 'utf8').includes('allowStaleFallback'),
  'force fetch must not silently keep stale enable flag'
)

function authorAvatarChar(name) {
  const s = String(name || '').trim()
  if (!s) return '?'
  const ch = Array.from(s)[0] || '?'
  if (/^[a-z]$/i.test(ch)) return ch.toUpperCase()
  return ch
}
assert.strictEqual(authorAvatarChar('nasa'), 'N')
assert.strictEqual(authorAvatarChar('航天摄影'), '航')
assert.strictEqual(authorAvatarChar(''), '?')

function buildPhotoColumns(list) {
  const left = []
  const right = []
  let leftH = 0
  let rightH = 0
  const FOOTER = 0.62
  for (let i = 0; i < (list || []).length; i++) {
    const item = list[i]
    const ratio = Math.max(0.45, Math.min(2.4, Number(item && item.coverAspectRatio) || 1))
    const h = (1 / ratio) + FOOTER
    if (leftH <= rightH) {
      left.push(item)
      leftH += h
    } else {
      right.push(item)
      rightH += h
    }
  }
  return { left, right }
}
const cols = buildPhotoColumns([
  { id: 'a', coverAspectRatio: 0.5 },
  { id: 'b', coverAspectRatio: 2 },
  { id: 'c', coverAspectRatio: 1 }
])
assert.ok(cols.left.length + cols.right.length === 3)
assert.ok(cols.left.length >= 1 && cols.right.length >= 1)

console.log('astro-photos.test.js OK')
