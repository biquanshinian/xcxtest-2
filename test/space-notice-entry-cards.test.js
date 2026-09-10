/**
 * 发射航警地图卡片：按发射时刻分段，配图与首页 mapLaunchToListItem 同源。
 * node --test test/space-notice-entry-cards.test.js
 */
const test = require('node:test')
const assert = require('node:assert/strict')

global.wx = global.wx || {
  env: { USER_DATA_PATH: '/tmp' },
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

const { isDefaultRocketSrc } = require('../utils/util.js')
const { computeEntryIsPast: clientPast } = require('../subpackages/monitor-pages/space-notices/utils/entry-lifecycle.js')
const { computeEntryIsPast: cloudPast } = require('../cloudfunctions/spaceNotices/entry-lifecycle.js')
const { humanizeEntrySlug, decorateSpaceNoticeEntry } = require('../subpackages/monitor-pages/space-notices/utils/notice-format.js')
const {
  scoreHomeLaunch,
  matchHomeLaunch,
  overlayHomeLaunch,
  resolveEntryRocketImage,
  usableRocketImage,
  decorateEntryCard,
  splitEntryCards
} = require('../subpackages/monitor-pages/space-notices/utils/entry-cards.js')

const NOW = Date.parse('2026-09-07T00:00:00+08:00')

test('客户端与云函数 isPast 规则一致', () => {
  const fixtures = [
    { entryKey: 'launch-f9-starlink-10-49', net: '2026-07-29T00:00:00.000Z', windowEndMs: Date.parse('2026-12-01T00:00:00Z'), isPast: false },
    { entryKey: 'launch-fh-roman', net: '2026-08-30T00:00:00.000Z' },
    { entryKey: 'launch-future', net: '2026-10-01T00:00:00.000Z' },
    { entryKey: 'collection-chinese-unknown', isCollection: true },
    { entryKey: 'launch-no-time' },
    { entryKey: 'launch-success', net: '2026-10-01T00:00:00.000Z', statusAbbrev: 'Success', statusId: 3 }
  ]
  fixtures.forEach((row) => {
    assert.equal(clientPast(row, NOW), cloudPast(row, NOW), JSON.stringify(row))
  })
})

test('已飞任务即使航警窗口还没结束也进历史', () => {
  const row = {
    entryKey: 'launch-f9-starlink-10-49',
    net: '2026-07-29T00:00:00.000Z',
    windowStartMs: Date.parse('2026-07-29T00:00:00.000Z'),
    windowEndMs: Date.parse('2026-12-01T00:00:00.000Z'),
    isPast: false
  }
  assert.equal(clientPast(row, NOW), true)
})

test('未来 NET 留在即将', () => {
  assert.equal(clientPast({ entryKey: 'launch-x', net: '2026-10-12T00:00:00.000Z' }, NOW), false)
})

test('没有发射时间的条目不占即将', () => {
  assert.equal(clientPast({ entryKey: 'launch-unknown' }, NOW), true)
})

test('老库 windowStart 字符串不能冒充发射时刻', () => {
  const row = { entryKey: 'launch-stale-window', windowStart: '2026-10-01T00:00:00Z' }
  assert.equal(clientPast(row, NOW), true)
  assert.equal(cloudPast(row, NOW), true)
})

test('航警窗口不能冒充发射时刻', () => {
  const row = {
    entryKey: 'launch-unmatched',
    windowStartMs: Date.parse('2026-09-10T00:00:00.000Z'),
    windowEndMs: Date.parse('2026-12-01T00:00:00.000Z')
  }
  assert.equal(clientPast(row, NOW), true)
  assert.equal(cloudPast(row, NOW), true)
})

test('合集桶不算历史', () => {
  assert.equal(clientPast({ entryKey: 'collection-chinese-unknown', isCollection: true }, NOW), false)
})

test('终态状态即使 NET 在未来也进历史', () => {
  assert.equal(clientPast({
    entryKey: 'launch-fh-roman',
    net: '2026-10-01T00:00:00.000Z',
    statusId: 3,
    statusAbbrev: 'Success'
  }, NOW), true)
})

test('首页 previous 命中直接进历史', () => {
  const entry = { entryKey: 'launch-fh-roman', missionName: 'Nancy Grace Roman Space Telescope', rocketName: 'Falcon Heavy' }
  const previous = [{
    id: 'll2-roman',
    missionName: 'Nancy Grace Roman Space Telescope',
    rocketName: 'Falcon Heavy',
    rocketImage: 'https://cdn.example/falcon-heavy.jpg',
    rocketConfiguration: { name: 'Falcon Heavy', full_name: 'Falcon Heavy' },
    launchTime: '2026-08-30T00:00:00.000Z',
    statusAbbrev: 'Success',
    statusId: 3
  }]
  const hit = matchHomeLaunch(entry, [], previous)
  assert.ok(hit && hit.homeBucket === 'previous')
  const card = decorateEntryCard(entry, { previousLaunches: previous, now: NOW })
  assert.equal(card.isPast, true)
  assert.equal(card.rocketImage, 'https://cdn.example/falcon-heavy.jpg')
})

test('ll2Id 在 previous 时不被 upcoming 弱匹配抢走', () => {
  const entry = {
    entryKey: 'launch-f9-starlink-17-51',
    ll2Id: 'abc',
    missionName: 'Starlink Group 17-51',
    rocketName: 'Falcon 9'
  }
  const upcoming = [{
    id: 'other',
    missionName: 'Starlink Group 17-51 Extra',
    rocketName: 'Falcon 9',
    launchTime: '2026-10-01T00:00:00.000Z'
  }]
  const previous = [{
    id: 'abc',
    missionName: 'Starlink Group 17-51',
    rocketName: 'Falcon 9',
    launchTime: '2026-08-01T00:00:00.000Z',
    statusId: 3,
    statusAbbrev: 'Success'
  }]
  const hit = matchHomeLaunch(entry, upcoming, previous)
  assert.ok(hit)
  assert.equal(hit.homeBucket, 'previous')
  assert.equal(hit.launch.id, 'abc')
})

test('无组号 Starlink 不能配到任意一组', () => {
  const entry = { entryKey: 'launch-f9-starlink', missionName: 'Starlink', rocketName: 'Falcon 9' }
  const upcoming = [{
    id: 'u-star',
    missionName: 'Starlink Group 17-51',
    rocketName: 'Falcon 9',
    launchTime: '2026-10-01T00:00:00.000Z'
  }]
  assert.equal(scoreHomeLaunch(entry, upcoming[0]) < 0, true)
  assert.equal(matchHomeLaunch(entry, upcoming, []), null)
})

test('星链组号不一致不能配错任务', () => {
  const entry = { entryKey: 'launch-f9-starlink-17-51', missionName: 'Starlink Group 17-51', rocketName: 'Falcon 9' }
  const upcoming = [{
    id: 'a',
    missionName: 'Starlink Group 17-52',
    rocketName: 'Falcon 9',
    rocketImage: 'https://cdn.example/f9.jpg'
  }]
  assert.equal(scoreHomeLaunch(entry, upcoming[0]) < 0, true)
  assert.equal(matchHomeLaunch(entry, upcoming, []), null)
})

test('首页中文 badge 不写入 statusName、不误判终态', () => {
  const overlaid = overlayHomeLaunch(
    {
      entryKey: 'launch-future',
      missionName: 'Demo',
      rocketName: 'Falcon 9',
      statusName: 'Go for Launch',
      net: '2026-10-01T00:00:00.000Z'
    },
    {
      id: 'u1',
      status: '发射成功',
      statusId: 1,
      statusAbbrev: 'Go',
      launchTime: '2026-10-01T00:00:00.000Z'
    },
    'upcoming'
  )
  assert.equal(overlaid.statusName, 'Go for Launch')
  assert.equal(overlaid.statusId, 1)
  assert.equal(clientPast(overlaid, NOW), false)
})

test('ll2Id 精确命中首页任务，沿用其配置图', () => {
  const entry = { entryKey: 'launch-x', ll2Id: 'abc', missionName: 'Starlink Group 10-49', rocketName: '' }
  const upcoming = [{
    id: 'abc',
    missionName: 'Starlink Group 10-49',
    rocketName: 'Falcon 9',
    rocketImage: 'https://cdn.example/f9-home.jpg',
    rocketConfiguration: { name: 'Falcon 9', full_name: 'Falcon 9 Block 5' },
    launchTime: '2026-10-08T00:00:00.000Z'
  }]
  const overlaid = overlayHomeLaunch(entry, upcoming[0], 'upcoming')
  assert.equal(overlaid.rocketName, 'Falcon 9')
  assert.equal(overlaid.ll2Id, 'abc')
  assert.equal(resolveEntryRocketImage(overlaid), 'https://cdn.example/f9-home.jpg')
})

test('陈旧 ll2Id 不能压过组号硬约束', () => {
  const entry = {
    entryKey: 'launch-f9-starlink-17-51',
    ll2Id: 'wrong-1752',
    missionName: 'Starlink Group 17-51',
    rocketName: 'Falcon 9'
  }
  const upcoming = [{
    id: 'wrong-1752',
    missionName: 'Starlink Group 17-52',
    rocketName: 'Falcon 9',
    launchTime: '2026-10-01T00:00:00.000Z'
  }]
  assert.equal(scoreHomeLaunch(entry, upcoming[0]) < 0, true)
  assert.equal(matchHomeLaunch(entry, upcoming, []), null)
})

test('叠加首页任务时改写陈旧 ll2Id', () => {
  const overlaid = overlayHomeLaunch(
    { entryKey: 'launch-x', ll2Id: 'stale', missionName: 'Starlink Group 17-51' },
    { id: 'fresh', missionName: 'Starlink Group 17-51', rocketName: 'Falcon 9' },
    'upcoming'
  )
  assert.equal(overlaid.ll2Id, 'fresh')
})

test('default 占位图不会当作配置图展示', () => {
  assert.equal(usableRocketImage(''), '')
  assert.equal(usableRocketImage('火箭配置图/default.jpg'), '')
  assert.equal(usableRocketImage('https://cdn.example/火箭配置图/default.jpg'), '')
  const img = resolveEntryRocketImage({
    rocketNameEn: 'Totally Unknown Rocket XYZ',
    homeRocketImage: 'https://cdn.example/火箭配置图/default.jpg'
  })
  assert.equal(img, '')
})

test('slug 能解析猎鹰重型 / 阿丽亚娜 / 朱雀', () => {
  assert.equal(humanizeEntrySlug('launch-fh-nancy-grace-roman').rocketName, 'Falcon Heavy')
  assert.equal(humanizeEntrySlug('launch-ariane-62-mtg-i2').rocketName, 'Ariane 62')
  assert.equal(humanizeEntrySlug('launch-zhuque-3-flight-2').rocketName, 'Zhuque-3')
})

test('decorate 不输出 default 配置图', () => {
  const row = decorateSpaceNoticeEntry({
    entryKey: 'launch-unknown-xyz',
    missionName: 'Unknown',
    rocketName: 'Totally Unknown Rocket XYZ'
  })
  assert.ok(!row.rocketImage || !isDefaultRocketSrc(row.rocketImage))
})

test('未来 NET 不被 homeBucket=previous 推进历史', () => {
  const row = {
    entryKey: 'launch-kuiper',
    missionName: 'Kuiper',
    rocketName: 'Atlas V',
    net: '2026-10-12T00:00:00.000Z',
    homeBucket: 'previous'
  }
  assert.equal(clientPast(row, NOW), false)
  assert.equal(cloudPast(row, NOW), false)
})

test('任务名子串不够配首页（Europa / Europa Clipper）', () => {
  const entry = { entryKey: 'launch-europa', missionName: 'Europa', rocketName: 'Falcon Heavy' }
  const previous = [{
    id: 'clipper',
    missionName: 'Europa Clipper',
    rocketName: 'Falcon Heavy',
    launchTime: '2024-10-14T00:00:00.000Z'
  }]
  assert.ok(scoreHomeLaunch(entry, previous[0]) < 62)
  assert.equal(matchHomeLaunch(entry, [], previous), null)
})

test('splitEntryCards 把 7–8 月任务分进历史', () => {
  const { upcoming, past } = splitEntryCards([
    {
      entryKey: 'launch-f9-starlink-10-49',
      missionName: 'Starlink Group 10-49',
      rocketName: 'Falcon 9',
      net: '2026-07-29T00:00:00.000Z',
      isPast: false
    },
    {
      entryKey: 'launch-future-demo',
      missionName: 'Future Demo',
      rocketName: 'Falcon 9',
      net: '2026-10-20T00:00:00.000Z',
      isPast: false
    },
    {
      entryKey: 'collection-chinese-unknown',
      isCollection: true,
      missionName: 'Chinese Notices'
    }
  ], { now: NOW })
  assert.equal(upcoming.length, 1)
  assert.equal(upcoming[0].entryKey, 'launch-future-demo')
  assert.equal(past.length, 1)
  assert.equal(past[0].entryKey, 'launch-f9-starlink-10-49')
})

test('航警火箭名有构型 id 才可点', () => {
  const noId = decorateEntryCard({
    entryKey: 'launch-noid',
    missionName: 'Demo',
    rocketName: 'Falcon 9',
    net: '2026-10-20T00:00:00.000Z'
  }, { now: NOW })
  assert.equal(noId.rocketClickable, false)
  assert.equal(noId.rocketConfigId, '')

  const withId = decorateEntryCard({
    entryKey: 'launch-id',
    missionName: 'Demo',
    rocketName: 'Falcon 9',
    rocketConfiguration: { id: 164, name: 'Falcon 9' },
    net: '2026-10-20T00:00:00.000Z'
  }, { now: NOW })
  assert.equal(withId.rocketClickable, true)
  assert.equal(withId.rocketConfigId, '164')

  const fromHome = decorateEntryCard({
    entryKey: 'launch-home',
    missionName: 'Starlink Group 10-49',
    rocketName: 'Falcon 9',
    net: '2026-10-20T00:00:00.000Z'
  }, {
    now: NOW,
    upcomingLaunches: [{
      id: 'abc',
      missionName: 'Starlink Group 10-49',
      rocketName: 'Falcon 9',
      rocketConfigId: 164,
      rocketConfiguration: { id: 164, name: 'Falcon 9' },
      launchTime: '2026-10-20T00:00:00.000Z'
    }]
  })
  assert.equal(fromHome.rocketClickable, true)
  assert.equal(fromHome.rocketConfigId, '164')
})

test('同步空身份不覆盖已绑 LL2', () => {
  const { mergeEntryIdentity, preferLaunchMatch } = require('../cloudfunctions/spaceNotices/entry-identity.js')
  const prev = {
    ll2Id: 'keep-me',
    net: '2026-10-01T00:00:00.000Z',
    pad: { latitude: 28.56, longitude: -80.57 },
    ll2Score: 85,
    statusId: 1
  }
  const wiped = mergeEntryIdentity(prev, {
    entryKey: 'launch-x',
    ll2Id: '',
    net: '',
    pad: null,
    statusId: 0,
    ll2Score: 0
  })
  assert.equal(wiped.ll2Id, 'keep-me')
  assert.equal(wiped.net, '2026-10-01T00:00:00.000Z')
  assert.equal(wiped.pad.latitude, 28.56)
  assert.equal(wiped.statusId, 1)

  const weaker = preferLaunchMatch({
    launch: { ll2Id: 'other' },
    score: 63
  }, prev)
  assert.equal(weaker.launch.ll2Id, 'keep-me')

  const miss = preferLaunchMatch(null, prev)
  assert.equal(miss.launch.ll2Id, 'keep-me')
})
