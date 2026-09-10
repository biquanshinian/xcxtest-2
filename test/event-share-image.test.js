/**
 * 事件头像防串 / 分享图约定路径 — 单测（放 test/，不进小程序包）
 * node test/event-share-image.test.js
 */
const assert = require('assert')
const {
  resolveTweetAccountAvatarUrl,
  resolveEventAuthorAvatarUrl,
  pickEventShareImageUrl
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

function testSharePrefersEventImageOverAvatar() {
  const url = pickEventShareImageUrl({
    source: 'SpaceX',
    authorAvatar: 'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/avatars/SpaceX.jpg',
    mediaList: [{
      type: 'image',
      url: 'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/tweets/demo.jpg'
    }]
  })
  assert.ok(url.includes('tweets/demo.jpg'), '详情分享优先事件图片')
  assert.ok(!url.includes('/avatars/'), '有图时不用博主头像')
  assert.ok(!/imageMogr2|format\/webp/.test(url), '分享图不转 webp')
}

function testSharePrefersVideoCoverOverAvatar() {
  const url = pickEventShareImageUrl({
    source: 'SpaceX',
    authorAvatar: 'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/avatars/SpaceX.jpg',
    mediaList: [{
      type: 'video',
      url: 'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/tweets/clip.mp4',
      thumbnailUrl: 'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/tweets/clip-cover.jpg'
    }]
  })
  assert.ok(url.includes('clip-cover.jpg'), '视频事件用封面图')
  assert.ok(!url.includes('/avatars/'), '有视频封面时不用博主头像')
}

function testShareVideoSnapshotWhenNoThumb() {
  const url = pickEventShareImageUrl({
    source: 'SpaceX',
    mediaList: [{
      type: 'video',
      url: 'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/tweets/clip.mp4'
    }]
  })
  assert.ok(/ci-process=snapshot/.test(url), '无封面时用万象截帧')
  assert.ok(!url.includes('/avatars/'), '截帧可用时不用头像')
}

function testShareAvatarOnlyWhenNoMedia() {
  const url = pickEventShareImageUrl({
    source: 'SpaceX',
    authorAvatar: 'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/avatars/SpaceX.jpg',
    mediaList: []
  })
  assert.ok(url.includes('/avatars/SpaceX.jpg'), '纯文字事件才用博主头像')
}

function testSharePreferMediaIndexVideo() {
  const url = pickEventShareImageUrl({
    source: 'NASA',
    mediaList: [{
      type: 'image',
      url: 'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/tweets/photo.jpg'
    }, {
      type: 'video',
      thumbnailRemoteUrl: 'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/tweets/vcover.jpg',
      url: 'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/tweets/clip.mp4'
    }]
  }, { preferMediaIndex: 1 })
  assert.ok(url.includes('vcover.jpg'), '播放页分享指定视频封面')
  assert.ok(!url.includes('photo.jpg'), '不误用同条事件的图片')
}

function testThinShellAvatarBeforeWarm() {
  const thin = require('../utils/event-share-image.js')
  const url = thin.pickEventShareImageUrl({ source: 'SpaceX' })
  assert.ok(url.includes('/avatars/SpaceX.jpg'), '薄壳未预热也要给出约定头像')
  assert.strictEqual(thin.resolveTweetAccountAvatarUrl('SpaceX').includes('/avatars/SpaceX.jpg'), true)
}

function testThinShellMediaBeforeAvatar() {
  const thin = require('../utils/event-share-image.js')
  const url = thin.pickEventShareImageUrl({
    source: 'SpaceX',
    mediaList: [{
      type: 'image',
      remoteUrl: 'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/tweets/thin.jpg'
    }]
  })
  assert.ok(url.includes('tweets/thin.jpg'), '薄壳未预热也优先事件图')
  assert.ok(!url.includes('/avatars/'), '薄壳有图时不用头像')
}

testSharePrefersEventImageOverAvatar()
testSharePrefersVideoCoverOverAvatar()
testShareVideoSnapshotWhenNoThumb()
testShareAvatarOnlyWhenNoMedia()
testSharePreferMediaIndexVideo()
testThinShellAvatarBeforeWarm()
testThinShellMediaBeforeAvatar()
console.log('event-share-image.test.js: all green')
