/**
 * 冒烟：公众号日更流水线视频支持
 * 1) oaStudioHelpers 视频提取 / 截帧封面 / 标注 / 丢图清理
 * 2) gatherTopics（假 db）：视频事件选题带 videos + 封面截图进配图池
 */
const assert = require('assert')
const helpers = require('../cloudfunctions/adminGateway/oaStudioHelpers')
const wechatApi = require('../cloudfunctions/adminGateway/oaWechatApi')
const { createOaContentStudioApi } = require('../cloudfunctions/adminGateway/oaContentStudio')

const COS = 'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com'
let passed = 0
const check = (name, fn) => {
  try {
    fn()
    passed += 1
    console.log('  ok -', name)
  } catch (e) {
    console.error('  FAIL -', name, '\n   ', e.message)
    process.exitCode = 1
  }
}

console.log('[1] helpers')

check('pickImageUrls 放行万象截帧、仍剔除裸视频', () => {
  const snap = `${COS}/t/v.mp4?ci-process=snapshot&time=1&format=jpg&width=720`
  const urls = helpers.pickImageUrls([`${COS}/t/v.mp4`, snap, `${COS}/t/a.jpg`])
  assert.deepStrictEqual(urls, [snap, `${COS}/t/a.jpg`])
})

check('pickImageUrls 识别 LL2 image_url 对象（发射配图）', () => {
  const urls = helpers.pickImageUrls(
    { image_url: `${COS}/launch.jpg`, thumbnail_url: `${COS}/launch-thumb.jpg` },
    { image: { image_url: `${COS}/rocket.png` } }
  )
  assert.ok(urls.includes(`${COS}/launch.jpg`))
  assert.ok(urls.includes(`${COS}/rocket.png`))
})

check('pickVideoEntries：长视频（未存 COS）→ 缩略图作封面截图 + 推文页观看链', () => {
  const list = helpers.pickVideoEntries([
    {
      type: 'video',
      url: 'https://x.com/SpaceX/status/123',
      thumbnailUrl: `${COS}/tweets/123_v0.jpg`,
      sourceUrl: 'https://x.com/SpaceX/status/123',
      videoUrl: 'https://video.twimg.com/amplify_video/123/vid/720x720/a.mp4',
      isLongVideo: true
    }
  ])
  assert.strictEqual(list.length, 1)
  assert.strictEqual(list[0].isLong, true)
  assert.strictEqual(list[0].posterUrl, `${COS}/tweets/123_v0.jpg`)
  assert.strictEqual(list[0].pageUrl, 'https://x.com/SpaceX/status/123')
  assert.strictEqual(list[0].watchUrl, 'https://x.com/SpaceX/status/123')
})

check('pickVideoEntries：COS 短视频无缩略图 → 万象截帧兜底；观看链=COS 原片', () => {
  const list = helpers.pickVideoEntries([
    { type: 'video', url: `${COS}/tweets/456_video0.mp4`, sourceUrl: 'https://x.com/s/456' }
  ])
  assert.strictEqual(list.length, 1)
  assert.ok(/ci-process=snapshot/.test(list[0].posterUrl), 'posterUrl 应为截帧: ' + list[0].posterUrl)
  assert.strictEqual(list[0].watchUrl, `${COS}/tweets/456_video0.mp4`)
  assert.strictEqual(list[0].isLong, false)
})

check('pickVideoEntries：观看链优先 COS 压缩预览（回填/同步产物）', () => {
  const list = helpers.pickVideoEntries([
    {
      type: 'video',
      url: `${COS}/tweets/789_video0.mp4`,
      previewUrl: `${COS}/tweets/preview/789_video0_fast.mp4`,
      sourceUrl: 'https://x.com/s/789'
    }
  ])
  assert.strictEqual(list[0].watchUrl, `${COS}/tweets/preview/789_video0_fast.mp4`)
})

check('pickVideoEntries：回填终态（isLongVideo 已摘、带 wasLongVideo/durationSec）仍判长视频', () => {
  const list = helpers.pickVideoEntries([
    {
      type: 'video',
      url: `${COS}/tweets/123_video_bf0.mp4`,
      previewUrl: `${COS}/tweets/preview/123_video_bf0_fast.mp4`,
      thumbnailUrl: `${COS}/tweets/123_v0.jpg`,
      sourceUrl: 'https://x.com/s/123',
      wasLongVideo: true,
      durationSec: 3960
    }
  ])
  assert.strictEqual(list[0].isLong, true, 'wasLongVideo/durationSec 应判长')
  assert.strictEqual(list[0].watchUrl, `${COS}/tweets/preview/123_video_bf0_fast.mp4`)
  assert.strictEqual(list[0].posterUrl, `${COS}/tweets/123_v0.jpg`)
})

check('pickVideoEntries：duration>120 判长视频；裸 mp4 字符串可收；去重', () => {
  const list = helpers.pickVideoEntries(
    [{ type: 'video', url: `${COS}/a.mp4`, duration: 300 }],
    `${COS}/a.mp4`,
    [`${COS}/b.mp4`]
  )
  assert.strictEqual(list.length, 2)
  assert.strictEqual(list[0].isLong, true)
  assert.ok(/ci-process=snapshot/.test(list[1].posterUrl))
})

check('annotateVideoPostersInMarkdown：有事件 id 引导点封面播放；无 id 才按阅读原文', () => {
  const poster = `${COS}/tweets/123_v0.jpg`
  const videos = [{ posterUrl: poster, watchUrl: 'https://x.com/s/123', pageUrl: 'https://x.com/s/123', isLong: true }]
  const md = `开头\n\n![配图1](${poster})\n\n结尾`
  const withEvent = helpers.annotateVideoPostersInMarkdown(md, videos, { eventId: 'ev_long' })
  assert.ok(withEvent.includes(`![配图1](${poster})\n\n> ▶ 视频封面，点击封面可在小程序查看该条动态`), withEvent)
  const twice = helpers.annotateVideoPostersInMarkdown(withEvent, videos, { eventId: 'ev_long' })
  assert.strictEqual(twice, withEvent, '重复标注应幂等')
  const noEventTwitter = helpers.annotateVideoPostersInMarkdown(md, videos, {
    readMoreUrl: 'https://x.com/s/123'
  })
  assert.ok(noEventTwitter.includes('> ▶ 视频封面\n'), noEventTwitter)
  assert.ok(!noEventTwitter.includes('阅读原文'), '推特不得提示阅读原文')
  const nsf = 'https://www.nasaspaceflight.com/2026/08/foo/'
  const byPage = helpers.annotateVideoPostersInMarkdown(md, [{ ...videos[0], pageUrl: nsf, watchUrl: nsf }], {
    readMoreUrl: nsf
  })
  assert.ok(byPage.includes('完整视频点文末「阅读原文」'), byPage)
})

check('resolveDraftSourceUrl / sanitizeContentSourceUrl：禁裸视频与推特，视频事件走 oa-watch', () => {
  const cosMp4 = `${COS}/tweets/a.mp4`
  const page = 'https://x.com/SpaceX/status/1'
  const nsf = 'https://www.nasaspaceflight.com/2026/08/foo/'
  assert.strictEqual(helpers.sanitizeContentSourceUrl(cosMp4), '')
  assert.strictEqual(helpers.sanitizeContentSourceUrl(page), '')
  assert.strictEqual(helpers.sanitizeContentSourceUrl(nsf), nsf)
  assert.strictEqual(helpers.isHttpPageUrl(cosMp4), false)
  assert.strictEqual(
    helpers.resolveDraftSourceUrl({ sourceUrl: page, sourceId: 'ev_short' }, [{ watchUrl: cosMp4 }]),
    'https://api.marsx.com.cn/oa-watch?e=ev_short&i=0'
  )
  assert.strictEqual(
    helpers.resolveDraftSourceUrl({ sourceUrl: cosMp4 }, [{ watchUrl: cosMp4, pageUrl: page }]),
    '',
    '无事件 id 时推特/mp4 都不挂阅读原文'
  )
  assert.strictEqual(helpers.resolveDraftSourceUrl({}, [{ watchUrl: cosMp4 }]), '')
  assert.strictEqual(helpers.resolveDraftSourceUrl({ sourceUrl: nsf }, []), nsf)
  assert.strictEqual(
    helpers.buildVideoPlayerMiniprogramPath({ eventId: 'ev_short', videoIndex: 0 }),
    'pages/video-player/video-player?e=ev_short'
  )
  assert.strictEqual(
    helpers.buildVideoPlayerMiniprogramPath({ eventId: 'ev_short', videoIndex: 1 }),
    'pages/video-player/video-player?e=ev_short__1'
  )
  assert.strictEqual(
    helpers.buildEventDetailMiniprogramPath({ eventId: 'ev_short' }),
    'subpackages/progress-extra/event-detail?id=ev_short'
  )
  assert.strictEqual(
    helpers.buildEventDetailMiniprogramPath({ eventId: 'ev_short', videoIndex: 0 }),
    'subpackages/progress-extra/event-detail?id=ev_short__0'
  )
  assert.deepStrictEqual(helpers.parseEventDetailMiniprogramId('ev_short__1'), {
    eventId: 'ev_short',
    videoIndex: 1
  })
})

check('stripMarkdownImages：丢弃视频封面时连带清掉说明行', () => {
  const poster = `${COS}/tweets/123_v0.jpg`
  const md = `开头\n\n![配图1](${poster})\n\n> ▶ 视频封面，点击封面可在小程序查看该条动态\n\n结尾`
  const out = helpers.stripMarkdownImages(md, [poster])
  assert.strictEqual(out, '开头\n\n结尾')
})

check('videoPosterSrcPathMap：封面绑定该事件详情；有 COS 时带视频下标', () => {
  const poster = `${COS}/tweets/123_v0.jpg`
  const map = helpers.videoPosterSrcPathMap({
    sourceId: 'ev_long',
    videos: [{ posterUrl: poster, url: `${COS}/tweets/123_video0.mp4` }]
  })
  assert.strictEqual(map[poster], 'subpackages/progress-extra/event-detail?id=ev_long__0')
  const mmbiz = 'https://mmbiz.qpic.cn/mmbiz_jpg/abc/0'
  const mapped = helpers.videoPosterSrcPathMap({
    sourceId: 'ev_long',
    videos: [{ posterUrl: poster, url: `${COS}/tweets/123_video0.mp4` }],
    imageMap: { [poster]: mmbiz }
  })
  assert.strictEqual(mapped[mmbiz], 'subpackages/progress-extra/event-detail?id=ev_long__0', '转存后的微信图床也要指向该事件页')
  const longNoCos = helpers.videoPosterSrcPathMap({
    sourceId: 'ev_long',
    videos: [{ posterUrl: poster, pageUrl: 'https://x.com/s/123' }]
  })
  assert.strictEqual(
    longNoCos[poster],
    'subpackages/progress-extra/event-detail?id=ev_long',
    '无 COS 成片也应进事件详情'
  )
})

check('sanitizeMiniprogramPath 允许事件详情 query（含 __ 下标）', () => {
  assert.strictEqual(
    wechatApi.sanitizeMiniprogramPath('pages/video-player/video-player?e=ev1'),
    'pages/video-player/video-player?e=ev1'
  )
  assert.strictEqual(
    wechatApi.sanitizeMiniprogramPath(
      'subpackages/progress-extra/event-detail?id=3dcd4ae66a92757a00e7f8951e1458e3'
    ),
    'subpackages/progress-extra/event-detail?id=3dcd4ae66a92757a00e7f8951e1458e3'
  )
  assert.strictEqual(
    wechatApi.sanitizeMiniprogramPath(
      'subpackages/progress-extra/event-detail?id=ev_long__0'
    ),
    'subpackages/progress-extra/event-detail?id=ev_long__0'
  )
  const launchId = 'd5a5e3a4-1111-2222-3333-abcdef123456'
  assert.strictEqual(
    wechatApi.sanitizeMiniprogramPath(`pages/mission-detail/mission-detail?id=${launchId}`),
    `pages/mission-detail/mission-detail?id=${launchId}`
  )
})

check('resolveOaMiniprogramPath：按选题落到对应详情页，首页占位可被覆盖', () => {
  assert.strictEqual(
    helpers.resolveOaMiniprogramPath(
      { sourceType: 'starship_event', sourceId: 'ev_long', miniprogramPath: 'pages/index/index' },
      { miniprogramPath: 'pages/index/index' }
    ),
    'subpackages/progress-extra/event-detail?id=ev_long'
  )
  assert.strictEqual(
    helpers.resolveOaMiniprogramPath(
      { sourceType: 'launch', sourceId: 'd5a5e3a4-1111-2222-3333-abcdef123456' },
      {}
    ),
    'pages/mission-detail/mission-detail?id=d5a5e3a4-1111-2222-3333-abcdef123456'
  )
  assert.strictEqual(
    helpers.resolveOaMiniprogramPath({ sourceType: 'news_article', sourceId: 'n1' }, {}),
    'subpackages/news-extra/detail?id=manual_n1'
  )
  assert.strictEqual(
    helpers.resolveOaMiniprogramPath(
      { sourceType: 'starship_event', sourceId: 'ev_long', miniprogramPath: 'pages/about/about' },
      { miniprogramPath: 'pages/index/index' }
    ),
    'pages/about/about',
    '运营手填深链应保留'
  )
})

check('wrapImagesWithMiniprogram：视频封面独立 path + 播放文字链；普通图不加点播', () => {
  const poster = `${COS}/p.jpg`
  const other = `${COS}/a.jpg`
  const html = `<p><img src="${poster}" /></p><p><img src="${other}" /></p>`
  const posterPath = 'subpackages/progress-extra/event-detail?id=ev1__0'
  const out = wechatApi.wrapImagesWithMiniprogram(html, {
    path: 'pages/index/index',
    mode: 'none',
    srcPathMap: { [poster]: posterPath }
  })
  assert.ok(out.includes(`data-miniprogram-path="${posterPath}"`), out)
  assert.ok(out.includes('▶ 点击播放视频'), out)
  assert.ok(!/pages\/index\/index/.test(out), 'mode=none 时不应出现默认首页 path')
  const twice = wechatApi.wrapImagesWithMiniprogram(out, {
    path: 'pages/index/index',
    mode: 'none',
    srcPathMap: { [poster]: posterPath }
  })
  assert.strictEqual((twice.match(/▶ 点击播放视频/g) || []).length, 1, '重复 wrap 不应叠加播放链')
})

check('wrapImagesWithMiniprogram：转存后的 mmbiz 封面仍走事件详情而不是首页', () => {
  const mmbiz = 'https://mmbiz.qpic.cn/mmbiz_jpg/abc/0'
  const posterPath = 'subpackages/progress-extra/event-detail?id=ev1__0'
  const out = wechatApi.wrapImagesWithMiniprogram(`<p><img src="${mmbiz}" /></p>`, {
    path: 'pages/index/index',
    mode: 'all',
    srcPathMap: { [mmbiz]: posterPath }
  })
  assert.ok(out.includes(`data-miniprogram-path="${posterPath}"`), out)
  assert.ok(!out.includes('pages/index/index'), out)
})

check('wrapImagesWithMiniprogram：普通配图与视频封面都进事件详情', () => {
  const poster = `${COS}/p.jpg`
  const other = `${COS}/a.jpg`
  const eventPath = 'subpackages/progress-extra/event-detail?id=ev1'
  const posterPath = 'subpackages/progress-extra/event-detail?id=ev1__0'
  const out = wechatApi.wrapImagesWithMiniprogram(
    `<p><img src="${poster}" /></p><p><img src="${other}" /></p>`,
    {
      path: eventPath,
      mode: 'all',
      srcPathMap: { [poster]: posterPath }
    }
  )
  assert.ok(out.includes(`data-miniprogram-path="${posterPath}"`), out)
  assert.ok(out.includes(`data-miniprogram-path="${eventPath}"`), out)
})

const newsRoute = require('../subpackages/news-extra/utils/page-route-options')
check('新闻详情：manual_ id 不带 type 也按文章打开', () => {
  const r = newsRoute.resolveNewsDetailRoute({ id: 'manual_abc' })
  assert.strictEqual(r.detailType, 'article')
  assert.strictEqual(r.id, 'manual_abc')
})

console.log('[2] backfillEventVideos 状态机（vm 沙箱，stub wx-server-sdk/COS）')

const vm = require('vm')
const fs = require('fs')
const path = require('path')
const bfSrc = fs.readFileSync(
  path.join(__dirname, '../cloudfunctions/backfillEventVideos/index.js'),
  'utf8'
)
const bfSandbox = {
  require: (name) => {
    if (name === 'wx-server-sdk') {
      return { init() {}, database: () => ({ collection() { return {} } }), DYNAMIC_CURRENT_ENV: Symbol('env') }
    }
    if (name === 'cos-nodejs-sdk-v5') return function COSStub() {}
    return require(name)
  },
  exports: {},
  module: { exports: {} },
  process,
  console,
  Buffer,
  setTimeout,
  clearTimeout
}
vm.createContext(bfSandbox)
vm.runInContext(bfSrc, bfSandbox)
const bf = bfSandbox.exports._internal

check('needsCosBackfill：长视频（推文页 url + 直链）→ 需回填；已存 COS / 无直链信息 → 不回填', () => {
  assert.strictEqual(
    bf.needsCosBackfill({ type: 'video', url: 'https://x.com/s/1', videoUrl: 'https://v.twimg.com/a.mp4', isLongVideo: true }),
    true
  )
  assert.strictEqual(bf.needsCosBackfill({ type: 'video', url: `${COS}/t/1_video0.mp4` }), false)
  assert.strictEqual(bf.needsCosBackfill({ type: 'video', url: 'https://x.com/s/1' }), false)
  assert.strictEqual(bf.needsCosBackfill({ type: 'image', url: 'https://x.com/a.jpg' }), false)
})

check('isMidBackfillState：COS 原片 + 未摘 videoUrl/isLongVideo → 中间态；终态/普通视频 → 否', () => {
  assert.strictEqual(
    bf.isMidBackfillState({ type: 'video', url: `${COS}/t/1_video_bf0.mp4`, videoUrl: 'https://v.twimg.com/a.mp4', isLongVideo: true }),
    true
  )
  // 终态（已摘标记）与普通短视频（从未带 videoUrl）都不再处理
  assert.strictEqual(bf.isMidBackfillState({ type: 'video', url: `${COS}/t/1_video_bf0.mp4`, previewUrl: `${COS}/t/preview/1_video_bf0_fast.mp4`, wasLongVideo: true }), false)
  assert.strictEqual(bf.isMidBackfillState({ type: 'video', url: `${COS}/t/1_video0.mp4` }), false)
})

check('eventPreviewKey 与同步函数约定一致（folder/preview/name_fast.mp4）', () => {
  assert.strictEqual(
    bf.eventPreviewKey('SpaceX推文图片/123_video_bf1.mp4'),
    'SpaceX推文图片/preview/123_video_bf1_fast.mp4'
  )
})

check('deriveCosFolder：跟随事件已有 COS 素材目录（中文目录、preview 子目录回父级）', () => {
  const folder = bf.deriveCosFolder([
    { type: 'video', url: 'https://x.com/s/1', thumbnailUrl: `${COS}/SpaceX%E6%8E%A8%E6%96%87%E5%9B%BE%E7%89%87/123_v0.jpg` }
  ])
  assert.strictEqual(folder, 'SpaceX推文图片')
  const fromPreview = bf.deriveCosFolder([
    { type: 'video', url: `${COS}/t/preview/x_fast.mp4` }
  ])
  assert.strictEqual(fromPreview, 't')
  assert.strictEqual(bf.deriveCosFolder([{ type: 'video', url: 'https://x.com/s/1' }]), 'EventVideos')
})

check('looksLikeMp4Head：ftyp 认 MP4，HTML 错误页拒收', () => {
  const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 32]), Buffer.from('ftypisom....................')])
  assert.strictEqual(bf.looksLikeMp4Head(mp4), true)
  assert.strictEqual(bf.looksLikeMp4Head(Buffer.from('<!DOCTYPE html><html><head>....')), false)
})

console.log('[3] gatherTopics（假 db）')

const makeFakeDb = (events, upcoming = []) => {
  const chain = (rows) => ({
    where() { return this },
    orderBy() { return this },
    limit() { return this },
    async get() { return { data: rows } }
  })
  return {
    createCollection: async () => ({}),
    collection(name) {
      if (name === 'starship_event_updates') {
        return {
          ...chain(events),
          doc: (id) => ({
            async get() { return { data: events.find((e) => e._id === id) || null } }
          })
        }
      }
      if (name === 'space_devs_cache') {
        return {
          ...chain(upcoming.length ? [{ cacheKey: 'upcoming', data: upcoming }] : []),
          doc: () => ({ async get() { return { data: null } } })
        }
      }
      return {
        ...chain([]),
        doc: () => ({ async get() { return { data: null } }, async update() { return {} } }),
        add: async () => ({ _id: 'x' })
      }
    }
  }
}

const nowMs = Date.now()
const events = [
  {
    _id: 'ev_long',
    status: 'published',
    title: '星舰 S40 完整飞行录像',
    content: 'S40 完成第 14 次飞行测试，全程约 66 分钟。',
    source: 'SpaceX',
    author: 'SpaceX自动追踪',
    authorAvatar: `${COS}/avatars/SpaceX.jpg`,
    tweetId: '123',
    tweetUrl: 'https://x.com/SpaceX/status/123',
    translated: true,
    originalText: 'S40 completed flight test 14.',
    publishedAt: nowMs - 2 * 60 * 60 * 1000,
    mediaList: [
      {
        type: 'video',
        url: 'https://x.com/SpaceX/status/123',
        thumbnailUrl: `${COS}/tweets/123_v0.jpg`,
        sourceUrl: 'https://x.com/SpaceX/status/123',
        videoUrl: 'https://video.twimg.com/amplify_video/123/vid/720x720/a.mp4',
        isLongVideo: true
      },
      { type: 'image', url: `${COS}/tweets/123_0.jpg` }
    ]
  },
  {
    _id: 'ev_short',
    status: 'published',
    title: '发射集锦短片',
    content: '30 秒集锦。',
    source: 'NASASpaceflight',
    author: 'NSF自动追踪',
    authorAvatar: `${COS}/avatars/NASASpaceflight.jpg`,
    tweetId: '456',
    tweetUrl: 'https://x.com/NASASpaceflight/status/456',
    publishedAt: nowMs - 6 * 60 * 60 * 1000,
    mediaList: [
      { type: 'video', url: `${COS}/tweets/456_video0.mp4`, previewUrl: `${COS}/tweets/preview/456_fast.mp4`, sourceUrl: 'https://x.com/s/456' }
    ]
  },
  {
    _id: 'ev_text_only',
    status: 'published',
    title: '纯文字推文',
    content: '没有配图的动态。',
    source: 'elonmusk',
    author: 'Elon Musk自动追踪',
    tweetId: '789',
    tweetUrl: 'https://x.com/elonmusk/status/789',
    publishedAt: nowMs - 30 * 60 * 1000,
    mediaList: []
  },
  {
    _id: 'ev_old',
    status: 'published',
    title: '五天前的旧推文',
    content: '过期事件。',
    source: 'Starlink',
    tweetId: '999',
    publishedAt: nowMs - 5 * 24 * 60 * 60 * 1000,
    mediaList: [{ type: 'image', url: `${COS}/tweets/999_0.jpg` }]
  }
]

const upcoming = [
  {
    id: 'lnch1',
    name: 'Starlink Group 10-18',
    net: new Date(nowMs + 36 * 60 * 60 * 1000).toISOString(),
    rocket: { name: 'Falcon 9', image: { image_url: `${COS}/f9.jpg` } },
    pad: { name: 'SLC-40', location: { name: 'Cape Canaveral' } },
    launch_service_provider: { name: 'SpaceX', logo: { image_url: `${COS}/spacex-logo.png` } },
    status: { name: 'Go' },
    url: 'https://ll.thespacedevs.com/2.2.0/launch/lnch1/'
  }
]

const api = createOaContentStudioApi({
  db: makeFakeDb(events, upcoming),
  _: {},
  ok: (data) => ({ code: 0, data }),
  fail: (code, message) => ({ code, message }),
  now: () => nowMs,
  writeOpLog: async () => {},
  cloud: null,
  checkPerm: () => null
})

;(async () => {
  const res = await api.gatherTopics({ limit: 10 })
  assert.strictEqual(res.code, 0)
  const topics = res.data.list
  const eventTopics = topics.filter((t) => t.sourceType === 'starship_event')
  assert.strictEqual(eventTopics.length, 2, '近3天且有配图的星舰事件应为 2 条，纯文字/过期应过滤')
  assert.ok(!eventTopics.some((t) => t.sourceId === 'ev_text_only'), '无配图推文不应出现')
  assert.ok(!eventTopics.some((t) => t.sourceId === 'ev_old'), '超过 3 天的推文不应出现')

  const long = eventTopics.find((t) => t.sourceId === 'ev_long')
  check('长视频事件：videos 带 isLong + 封面截图并入配图', () => {
    assert.strictEqual(long.videos.length, 1)
    assert.strictEqual(long.videos[0].isLong, true)
    assert.ok(long.imageUrls.includes(`${COS}/tweets/123_v0.jpg`), '缩略图应进配图池')
    assert.ok(long.imageUrls.includes(`${COS}/tweets/123_0.jpg`))
    assert.strictEqual(long.coverUrl, `${COS}/tweets/123_0.jpg`, '真图在前作封面')
  })
  check('推文事件带账号来源/头像/推文链接/原文', () => {
    assert.strictEqual(long.accountSource, 'SpaceX')
    assert.strictEqual(long.accountLabel, 'SpaceX')
    assert.ok(long.authorAvatar)
    assert.strictEqual(long.tweetUrl, 'https://x.com/SpaceX/status/123')
    assert.strictEqual(long.originalText, 'S40 completed flight test 14.')
    assert.strictEqual(long.translated, true)
  })

  const short = eventTopics.find((t) => t.sourceId === 'ev_short')
  check('纯视频事件不再无图：封面=万象截帧', () => {
    assert.strictEqual(short.videos.length, 1)
    assert.ok(/ci-process=snapshot/.test(short.coverUrl), '封面应为截帧: ' + short.coverUrl)
    assert.strictEqual(short.imageUrls.length, 1)
    assert.strictEqual(short.accountSource, 'NASASpaceflight')
    assert.strictEqual(short.accountLabel, 'NSF')
  })

  const launch = topics.find((t) => t.sourceType === 'launch')
  check('发射选题带火箭/工位/NET/发射商 Logo 配图', () => {
    assert.ok(launch, '应有发射选题')
    assert.strictEqual(launch.rocket, 'Falcon 9')
    assert.strictEqual(launch.pad, 'SLC-40')
    assert.strictEqual(launch.provider, 'SpaceX')
    assert.ok(launch.netMs > nowMs)
    assert.ok(launch.imageUrls.includes(`${COS}/f9.jpg`))
    assert.ok(launch.imageUrls.includes(`${COS}/spacex-logo.png`))
    assert.ok(launch.sourceUrl)
  })

  console.log(`\n${passed} checks passed${process.exitCode ? '（有失败）' : ''}`)
})().catch((e) => {
  console.error('FATAL', e)
  process.exitCode = 1
})
