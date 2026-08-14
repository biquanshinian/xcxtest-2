/**
 * SPACE_NOTICES_FEATURE — 多任务扩展冒烟：entry 发现 / 标题切分 / LL2 模糊匹配 / 通告抓取
 * 只测不依赖 wx-server-sdk 的纯模块 + 真实站点抓取
 */
const {
  parseEntrySlugs,
  splitTitle,
  parseEntryMeta,
  discoverEntrySlugs,
  fetchEntryPage,
  decodeEntities,
  withPinnedEntries,
  CHINESE_COLLECTION_KEY
} = require('../cloudfunctions/spaceNotices/discover-entries.js')
const { extractNoticeLinks, fetchNoticesByPaths } = require('../cloudfunctions/spaceNotices/fetch-external.js')
const { matchEntryToLaunch, scoreMatch, digitGroups } = require('../cloudfunctions/spaceNotices/match-ll2.js')
const { slimFromCacheRow } = require('../cloudfunctions/spaceNotices/pad-coords.js')

let pass = 0
let fail = 0
function ok(cond, label, extra) {
  if (cond) {
    pass += 1
    console.log('  PASS ' + label)
  } else {
    fail += 1
    console.log('  FAIL ' + label + (extra != null ? ' → ' + JSON.stringify(extra) : ''))
  }
}

function testPureParsing() {
  console.log('\n[1] 标题切分与实体解码')
  ok(splitTitle('Starlink Group 17-51 - Falcon 9 | Space Notices').missionName === 'Starlink Group 17-51', 'F9 任务名')
  ok(splitTitle('Starlink Group 17-51 - Falcon 9 | Space Notices').rocketName === 'Falcon 9', 'F9 火箭名')
  ok(splitTitle('Tianlian 2-06 - Long March 3B/E | Space Notices').rocketName === 'Long March 3B/E', '长征火箭名')
  ok(splitTitle('NROL-95 - Falcon 9 | Space Notices').missionName === 'NROL-95', '任务名含连字符不被误切')
  ok(splitTitle('Flight 13 - Starship | Space Notices').missionName === 'Flight 13', '星舰任务名')
  ok(decodeEntities('SpaceX&#x27;s Falcon 9') === "SpaceX's Falcon 9", 'HTML 实体解码')

  console.log('\n[2] entry slug 过滤（普通 collection 不进首页；中国合集另行置顶）')
  const html = 'a href="/entry/launch-f9-nrol-95" b href="/entry/collection-chinese-unknown" c href="/entry/launch-f9-nrol-95" d href="/entry/collection-starbase-testing"'
  const slugs = parseEntrySlugs(html)
  ok(slugs.length === 1 && slugs[0] === 'launch-f9-nrol-95', '首页解析只保留 launch-* 且去重', slugs)
  const pinned = withPinnedEntries(slugs)
  ok(pinned[0] === CHINESE_COLLECTION_KEY && pinned.indexOf('launch-f9-nrol-95') === 1, '置顶中国合集', pinned)
  ok(pinned.indexOf('collection-starbase-testing') < 0, '不置顶其它 collection')
  const metaCn = parseEntryMeta(
    '<title>Chinese Notices - Unknown launches | Space Notices</title>2099-01-01T00:00 2026-08-17T02:53',
    CHINESE_COLLECTION_KEY
  )
  ok(metaCn.missionName === 'Chinese Notices' && metaCn.rocketName === 'Unknown launches', '中国合集标题')
  ok(metaCn.siteDates.join(',') === '2026-08-17T02:53', '丢掉 2099 占位日期', metaCn.siteDates)

  console.log('\n[3] 数字序列硬约束')
  ok(digitGroups('starlink group 17 51').join('-') === '17-51', '数字组抽取')
  ok(digitGroups('tianlian 2 06').join('-') === '2-6', '前导零归一')
}

function testMatching() {
  console.log('\n[4] LL2 模糊匹配（含近似干扰项）')
  // 造 LL2 slim 行：17-51 / 17-52 只差一位，必须不能混
  const rows = [
    { id: 'uuid-1751', name: 'Falcon 9 Block 5 | Starlink Group 17-51', net: '2026-07-25T18:30:00Z', rocket: { configuration: { name: 'Falcon 9 Block 5' } }, pad: { name: 'Space Launch Complex 4E', latitude: '34.632', longitude: '-120.611' }, status: { name: 'Launch Successful' }, launch_service_provider: { name: 'SpaceX' } },
    { id: 'uuid-1752', name: 'Falcon 9 Block 5 | Starlink Group 17-52', net: '2026-07-28T18:30:00Z', rocket: { configuration: { name: 'Falcon 9 Block 5' } }, pad: { name: 'Space Launch Complex 4E', latitude: '34.632', longitude: '-120.611' }, status: { name: 'Go for Launch' }, launch_service_provider: { name: 'SpaceX' } },
    { id: 'uuid-tl', name: 'Long March 3B/E | TianLian-2 (06)', net: '2026-07-23T13:00:00Z', rocket: { configuration: { name: 'Long March 3B/E' } }, pad: { name: 'Launch Complex 2', latitude: '27.9', longitude: '102.02' }, status: { name: 'Launch Successful' }, launch_service_provider: { name: 'CASC' } },
    { id: 'uuid-nrol', name: 'Falcon 9 Block 5 | NROL-95', net: '2026-07-30T08:00:00Z', rocket: { configuration: { name: 'Falcon 9 Block 5' } }, pad: { name: 'Space Launch Complex 40', latitude: '28.562', longitude: '-80.577' }, status: { name: 'Go for Launch' }, launch_service_provider: { name: 'SpaceX' } },
    { id: 'uuid-f13', name: 'Starship | Flight 13', net: '2026-07-24T22:45:00Z', rocket: { configuration: { name: 'Starship' } }, pad: { name: 'Orbital Launch Pad 2' }, status: { name: 'Go for Launch' }, launch_service_provider: { name: 'SpaceX' } }
  ]
  const launches = rows.map((r) => slimFromCacheRow(r)).filter(Boolean)
  ok(launches.length === 5, '全量收录（不再只筛星舰）', launches.length)
  ok(launches.some((l) => !l.isStarship), '非星舰任务能进列表')
  ok(launches.find((l) => l.ll2Id === 'uuid-nrol').pad.latitude === 28.562, '非星舰发射台坐标透传')

  const cases = [
    { meta: { entryKey: 'launch-f9-starlink-17-51', missionName: 'Starlink Group 17-51', rocketName: 'Falcon 9', siteDates: ['2026-07-25T18:23'] }, want: 'uuid-1751' },
    { meta: { entryKey: 'launch-f9-starlink-17-52', missionName: 'Starlink Group 17-52', rocketName: 'Falcon 9', siteDates: ['2026-07-28T18:00'] }, want: 'uuid-1752' },
    { meta: { entryKey: 'launch-long-march-3be-tianlian-2-06', missionName: 'Tianlian 2-06', rocketName: 'Long March 3B/E', siteDates: ['2026-07-23T12:54'] }, want: 'uuid-tl' },
    { meta: { entryKey: 'launch-f9-nrol-95', missionName: 'NROL-95', rocketName: 'Falcon 9', siteDates: ['2026-07-30T08:04'] }, want: 'uuid-nrol' },
    { meta: { entryKey: 'launch-starship-flight-13', missionName: 'Flight 13', rocketName: 'Starship', siteDates: ['2026-07-24T22:45'] }, want: 'uuid-f13' }
  ]
  cases.forEach((c) => {
    const m = matchEntryToLaunch(c.meta, launches)
    ok(m && m.launch.ll2Id === c.want, `匹配 ${c.meta.missionName}`, m ? { got: m.launch.ll2Id, score: m.score } : null)
  })

  // 数字不同必须判负，避免 17-51 落到 17-52 上
  const cross = scoreMatch(
    { missionName: 'Starlink Group 17-51', rocketName: 'Falcon 9', siteDates: ['2026-07-25T18:23'] },
    launches.find((l) => l.ll2Id === 'uuid-1752')
  )
  ok(cross < 0, '17-51 对 17-52 判负', cross)

  // 库里没有对应发射时不能硬凑
  const none = matchEntryToLaunch(
    { missionName: 'Unknown Payload 999', rocketName: 'Long March 6A', siteDates: ['2026-07-01T00:00'] },
    launches
  )
  ok(none === null, '无对应发射时返回 null', none)
}

async function testLive() {
  console.log('\n[5] 真实站点：entry 索引')
  const slugs = await discoverEntrySlugs()
  ok(slugs.length >= 8, `首页发现 ${slugs.length} 个 entry`, slugs.length)
  ok(slugs[0] === CHINESE_COLLECTION_KEY, '中国合集置顶', slugs[0])
  ok(!slugs.some((s) => s.indexOf('collection-') === 0 && s !== CHINESE_COLLECTION_KEY), '不含其它 collection 汇总页')
  ok(slugs.some((s) => /f9|falcon/.test(s)), '含猎鹰9')
  ok(slugs.some((s) => /long-march/.test(s)), '含长征')
  // 星舰不常驻首页；出现时必须被索引（当前站没有则跳过）
  const hasStarship = slugs.some((s) => /starship/.test(s))
  ok(hasStarship || slugs.length >= 8, hasStarship ? '含星舰' : '首页当前无星舰条目（已跳过）')
  console.log('     ' + slugs.join('\n     '))

  console.log('\n[6] 真实站点：非星舰 entry 元信息 + 通告几何')
  for (const slug of ['launch-f9-nrol-95', 'launch-long-march-3be-tianlian-2-06']) {
    const { meta, html } = await fetchEntryPage(slug)
    const paths = extractNoticeLinks(html)
    ok(!!meta.missionName, `${slug} 任务名 = ${meta.missionName}`)
    ok(!!meta.rocketName, `${slug} 火箭名 = ${meta.rocketName}`)
    ok(paths.length > 0, `${slug} 通告链接 ${paths.length} 条`)
    const res = await fetchNoticesByPaths(paths.slice(0, 4), { deadline: Date.now() + 30000 })
    const withGeo = res.notices.filter((n) => (n.areas || []).length)
    const pts = res.notices.reduce((s, n) => s + (n.areas || []).reduce((a, r) => a + r.length, 0), 0)
    ok(withGeo.length === res.notices.length && res.notices.length > 0,
      `${slug} 抽样 ${res.notices.length} 条通告全部带多边形（${pts} 点）`,
      { parsed: res.notices.length, withGeo: withGeo.length, errors: res.errors })
    ok(res.notices.every((n) => n.type && n.name), `${slug} 通告类型/编号完整`)
  }

  console.log('\n[6b] 官网中国合集 collection-chinese-unknown')
  {
    const { meta, html } = await fetchEntryPage(CHINESE_COLLECTION_KEY)
    const paths = extractNoticeLinks(html)
    ok(/chinese notices/i.test(meta.missionName || meta.siteTitle), `合集标题 ${meta.missionName}`)
    ok(paths.length >= 3, `合集通告链接 ${paths.length} 条`, paths)
    ok(paths.some((p) => /ZHWH|ZJHK|ZLHW|ZJSY/i.test(p)), '含中国 FIR NOTAM', paths)
    const res = await fetchNoticesByPaths(paths, { deadline: Date.now() + 40000 })
    const withGeo = res.notices.filter((n) => (n.areas || []).length)
    ok(res.notices.length >= 3 && withGeo.length === res.notices.length,
      `合集 ${res.notices.length} 条通告全部带多边形`,
      { names: res.notices.map((n) => n.name), errors: res.errors })
  }

  console.log('\n[7] 抓取预算：deadline 已过时立即返回不卡死')
  const past = await fetchNoticesByPaths(['/notice/notam-A0975%2F26'], { deadline: Date.now() - 1 })
  ok(past.notices.length === 0 && past.errors.indexOf('fetch budget exceeded') >= 0, '超预算直接停', past)
}

async function main() {
  testPureParsing()
  testMatching()
  await testLive()
  console.log(`\n=== ${pass} passed, ${fail} failed ===`)
  process.exit(fail ? 1 : 0)
}

main().catch((e) => {
  console.error('fatal', e)
  process.exit(1)
})
