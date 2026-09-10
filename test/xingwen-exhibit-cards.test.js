/**
 * node --test test/xingwen-exhibit-cards.test.js
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const {
  viewExhibitCards,
  resolveExhibitCardNav,
  isTabRoute,
  looksLikeExhibitSpecAsk,
  looksLikeLaunchListAsk,
  buildExhibitSpecCard,
  fillExhibitCards
} = require('../subpackages/rocket-3d/xingwen-exhibit-cards.js')

test('展陈页问当前火箭或接下来发射，没退到主站卡也要自己出卡', () => {
  assert.equal(looksLikeExhibitSpecAsk('这火箭多高'), true)
  assert.equal(looksLikeLaunchListAsk('接下来发射'), true)
  const spec = buildExhibitSpecCard({
    rocketName: '朱雀三号',
    length: '76 m',
    diameter: '5 m',
    configId: 'zq-3'
  })
  assert.equal(spec.cardType, 'spec')
  assert.equal(spec.title, '朱雀三号')
  assert.equal(spec.rows[0].value, '76 m')
  assert.equal(spec.targetId, 'zq-3')
  const filled = fillExhibitCards('这火箭多高', { rocketName: '朱雀三号', length: '76 m' }, [])
  assert.equal(filled[0].cardType, 'spec')
  const list = fillExhibitCards('接下来发射', {}, [])
  assert.equal(list[0].cardType, 'launch_list')
  const listNav = resolveExhibitCardNav(list[0])
  assert.ok(listNav && listNav.url)
  const keep = fillExhibitCards('接下来发射', {}, [{ cardType: 'mission', name: 'A' }])
  assert.equal(keep[0].cardType, 'mission')
})

test('展陈卡压成头顶宽屏能看的薄卡', () => {
  const cards = viewExhibitCards([
    { cardType: 'mission', id: 'm1', name: 'Starlink 10-12', formattedTime: '明天' },
    {
      cardType: 'launch_list',
      id: 'list',
      title: '接下来发射',
      items: [
        { id: 'a', name: 'A', formattedTime: '今晚', detailType: 'upcoming' },
        { id: 'b', name: 'B', formattedTime: '后天' }
      ]
    },
    { cardType: 'spec', id: 's1', title: '猎鹰 9', rows: [{ label: '全长', value: '70 m' }] }
  ])
  assert.equal(cards[0].title, 'Starlink 10-12')
  assert.equal(cards[1].items.length, 2)
  assert.equal(cards[2].rows[0].value, '70 m')
  assert.deepEqual(viewExhibitCards(null), [])
})

test('点卡走详情页同一套路由', () => {
  const mission = resolveExhibitCardNav({ cardType: 'mission', id: '12', detailType: 'upcoming' })
  assert.match(mission.url, /mission-detail/)
  assert.match(mission.url, /id=12/)
  const listRow = resolveExhibitCardNav(
    { cardType: 'launch_list', items: [] },
    { row: { id: '9', detailType: 'completed' } }
  )
  assert.match(listRow.url, /type=completed/)
  const more = resolveExhibitCardNav({ cardType: 'launch_list', listMode: 'upcoming' }, { more: true })
  assert.equal(more.switchTab, true)
  assert.equal(isTabRoute('/pages/progress/progress'), true)
  const status = resolveExhibitCardNav({ cardType: 'starship_status' })
  assert.equal(status.switchTab, true)
  const spec = resolveExhibitCardNav({ cardType: 'spec', specKind: 'rocket_model', targetId: 'falcon-9' })
  assert.match(spec.url, /configId=falcon-9/)
  const entry = resolveExhibitCardNav({ cardType: 'entry', entryKind: 'watch_party', missionId: '33' })
  assert.match(entry.url, /merchant-list/)
  const stats = resolveExhibitCardNav({ cardType: 'launch_stats', year: '2026', countryKey: 'usa' })
  assert.match(stats.url, /year=2026/)
  const replay = resolveExhibitCardNav({
    cardType: 'mission_replay',
    playable: true,
    videoUrl: 'https://example.com/a.mp4',
    launchId: '88'
  })
  assert.match(replay.url, /video-player/)
  assert.equal(replay.replay, true)
})
