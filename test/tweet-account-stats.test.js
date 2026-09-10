/**
 * 今日推文账号胶囊：映射 / 解析 / 详情页复用
 */
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const {
  mapTodayTweetAccountStats,
  resolveTweetAccountChip,
  rememberTodayTweetAccountStats,
  peekTodayTweetAccountStatsCache,
  resetTodayTweetAccountStatsCacheForTest,
  attachVerifyBadgeToItem,
  TTL_MS
} = require('../subpackages/progress-extra/utils/tweet-account-stats.js')

function testMapStats() {
  assert.strictEqual(mapTodayTweetAccountStats({ success: false }), null)
  assert.strictEqual(mapTodayTweetAccountStats({}), null, '缺 success 不得当成成功')
  const mapped = mapTodayTweetAccountStats({
    success: true,
    total: 4,
    badgeBySource: { NASA: 'grey', SpaceX: 'gold' },
    tweetStats: [
      { screenName: 'NASASpaceflight', label: 'NSF', avatarUrl: 'https://x/nsf.jpg', todayCount: 2 },
      { screenName: '', todayCount: 1 },
      { screenName: 'SpaceX', todayCount: 3, verifyBadge: 'gold' }
    ]
  })
  assert.strictEqual(mapped.total, 4)
  assert.strictEqual(mapped.stats.length, 2)
  assert.strictEqual(mapped.stats[0].label, 'NSF')
  assert.strictEqual(mapped.stats[0].todayCount, 2)
  assert.strictEqual(mapped.stats[0].verifyBadge, 'none')
  assert.strictEqual(mapped.stats[1].screenName, 'SpaceX')
  assert.strictEqual(mapped.stats[1].label, 'SpaceX')
  assert.strictEqual(mapped.stats[1].verifyBadge, 'gold')
  assert.strictEqual(mapped.stats[1].verifyBadgeSrc, '/images/x-verify/gold.svg')
  assert.strictEqual(mapped.badgeBySource.NASA, 'grey')
  assert.strictEqual(mapped.badgeBySource.SpaceX, 'gold')
}

function testResolveChip() {
  const list = [
    { screenName: 'NASA', label: 'NASA' },
    { screenName: 'elonmusk', label: 'Elon Musk' }
  ]
  const byIndex = resolveTweetAccountChip(list, { index: 1 })
  assert.strictEqual(byIndex.screenName, 'elonmusk')
  assert.strictEqual(byIndex.label, 'Elon Musk')
  const bySource = resolveTweetAccountChip([], { source: 'Starlink', label: 'Starlink' })
  assert.strictEqual(bySource.screenName, 'Starlink')
  const empty = resolveTweetAccountChip(null, {})
  assert.strictEqual(empty.screenName, '')
}

function testCacheTtl() {
  resetTodayTweetAccountStatsCacheForTest()
  rememberTodayTweetAccountStats({ total: 1, stats: [{ screenName: 'A', label: 'A', avatarUrl: '', todayCount: 1 }] }, 1000)
  assert.ok(peekTodayTweetAccountStatsCache(1000 + TTL_MS - 1))
  assert.strictEqual(peekTodayTweetAccountStatsCache(1000 + TTL_MS), null)
  resetTodayTweetAccountStatsCacheForTest()
}

function testDetailReusesProgressChips() {
  const root = path.join(__dirname, '..')
  const updates = fs.readFileSync(path.join(root, 'subpackages/progress-extra/components/event-updates/index.wxml'), 'utf8')
  const detail = fs.readFileSync(path.join(root, 'subpackages/progress-extra/event-detail.wxml'), 'utf8')
  const detailJs = fs.readFileSync(path.join(root, 'subpackages/progress-extra/event-detail.js'), 'utf8')
  const detailJson = fs.readFileSync(path.join(root, 'subpackages/progress-extra/event-detail.json'), 'utf8')
  assert.ok(updates.includes('<tweet-account-chips'), '进展页事件更新复用胶囊组件')
  assert.ok(detail.includes('<tweet-account-chips'), '事件详情复用胶囊组件')
  assert.ok(detail.includes('showTweetAccountChips'), '详情页按开关显示胶囊')
  assert.ok(detailJson.includes('tweet-account-chips'), '详情页注册胶囊组件')
  assert.ok(detailJs.includes('_enableGenericTweetAccountChips()'), '通用事件详情打开胶囊')
  assert.ok(detailJs.includes("options.mode === 'll2_event'") && detailJs.indexOf("options.mode === 'll2_event'") < detailJs.indexOf('_enableGenericTweetAccountChips()'), 'NSF/LL2 早退后再开胶囊')
  const chips = fs.readFileSync(path.join(root, 'subpackages/progress-extra/components/tweet-account-chips/index.wxml'), 'utf8')
  assert.ok(chips.includes('item.verifyBadgeSrc'), '账号胶囊展示认证标')
  assert.ok(updates.includes('item.verifyBadgeSrc'), '事件更新作者条展示认证标')
  assert.ok(detail.includes('verifyBadgeSrc'), '事件详情作者条展示认证标')
}

testMapStats()
testResolveChip()
testCacheTtl()
testDetailReusesProgressChips()

function testAttachVerifyBadge() {
  const attached = attachVerifyBadgeToItem({ source: 'NASA', author: 'NASA' }, { NASA: 'grey' })
  assert.strictEqual(attached.verifyBadge, 'grey')
  assert.strictEqual(attached.verifyBadgeSrc, '/images/x-verify/grey.svg')
  const none = attachVerifyBadgeToItem({ source: 'foo', author: 'Foo' }, {})
  assert.strictEqual(none.verifyBadge, 'none')
  assert.strictEqual(none.verifyBadgeSrc, '')
  const ci = attachVerifyBadgeToItem({ source: 'nasagoddard', author: 'Goddard' }, { NASAGoddard: 'grey' })
  assert.strictEqual(ci.verifyBadge, 'grey')
}

testAttachVerifyBadge()
console.log('tweet-account-stats tests passed')
