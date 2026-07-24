/**
 * 事件头像防串 / 分享图约定路径 — 单测（放 test/，不进小程序包）
 * node test/event-share-image.test.js
 */
const assert = require('assert')
const {
  resolveTweetAccountAvatarUrl,
  resolveEventAuthorAvatarUrl
} = require('../subpackages/shared/utils/event-share-image.js')

function testResolveBySource() {
  const u = resolveTweetAccountAvatarUrl('SpaceX')
  assert.ok(u.includes('/avatars/SpaceX.jpg'), 'SpaceX 约定路径')
  assert.strictEqual(resolveTweetAccountAvatarUrl(''), '')
  assert.strictEqual(resolveTweetAccountAvatarUrl('../evil'), '')
}

function testPreventCrossAccountAvatar() {
  const wrong = resolveEventAuthorAvatarUrl({
    source: 'SpaceX',
    authorAvatar: 'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/avatars/elonmusk.jpg'
  })
  assert.ok(wrong.includes('/avatars/SpaceX.jpg'), '串号应回退到 source 路径')
  assert.ok(!wrong.includes('elonmusk'), '不得保留错误账号头像')
}

function testKeepMatchingAvatar() {
  const ok = resolveEventAuthorAvatarUrl({
    source: 'NASA',
    authorAvatar: 'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/avatars/NASA.jpg'
  })
  assert.ok(ok.includes('/avatars/NASA.jpg'), '匹配路径应保留')
}

function testRejectProxyAndFallback() {
  const fromProxy = resolveEventAuthorAvatarUrl({
    source: 'Starlink',
    authorAvatar: 'https://api.marsx.com.cn/spacex-media/avatar.png'
  })
  assert.ok(fromProxy.includes('/avatars/Starlink.jpg'), '代理脏链回退约定路径')
}

function testExtractAvatarAuthorGuard() {
  // 与云函数同口径的纯函数副本，避免拉起 wx-server-sdk
  function extractAvatarRawUrl(tweet, expectedScreenName) {
    if (!tweet) return ''
    const expect = String(expectedScreenName || '').trim().toLowerCase()
    const author = tweet.author || tweet.user || null
    if (!author) return ''
    if (expect) {
      const actual = String(
        author.screen_name || author.screenName || author.username || author.userName || ''
      ).trim().toLowerCase()
      if (!actual || actual !== expect) return ''
    }
    return author.avatar_url || author.profile_image_url_https || author.profile_image_url || ''
  }

  const rt = {
    author: { screen_name: 'elonmusk', avatar_url: 'https://pbs.twimg.com/elon.jpg' }
  }
  assert.strictEqual(extractAvatarRawUrl(rt, 'SpaceX'), '', '转推作者拒绝')
  assert.strictEqual(
    extractAvatarRawUrl({ author: { avatar_url: 'https://x/a.jpg' } }, 'SpaceX'),
    '',
    '缺 screen_name 拒绝'
  )
  assert.strictEqual(
    extractAvatarRawUrl(
      { author: { screen_name: 'SpaceX', avatar_url: 'https://x/sx.jpg' } },
      'SpaceX'
    ),
    'https://x/sx.jpg',
    '本人头像放行'
  )
}

testResolveBySource()
testPreventCrossAccountAvatar()
testKeepMatchingAvatar()
testRejectProxyAndFallback()
testExtractAvatarAuthorGuard()
console.log('event-share-image.test.js: all green')
