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
  const many = Array.from({ length: 40 }, (_, i) => `href="/notice/notam-ZLHW-A${i}/26"`).join(' ')
  ok(extractNoticeLinks(many).length === 28, '默认可截 28 条')
  ok(extractNoticeLinks(many, { max: 100 }).length === 40, 'extractNoticeLinks 可抬到 100')
  ok(extractNoticeLinks(many, { max: Infinity }).length === 40, 'max Infinity 不截断')

  console.log('\n[2b] 中国情报区 sitemap / FIR 扫描')
  const chinaFirs = require('../cloudfunctions/spaceNotices/discover-china-firs.js')
  ok(chinaFirs.CHINA_FIR_CODES.indexOf('ZLHW') === 0, '扫描优先兰州情报区')
  ok(chinaFirs.CHINA_FIR_CODES.indexOf('ZYSH') >= 0 && chinaFirs.CHINA_FIR_CODES.indexOf('RCAA') >= 0, '含沈阳与台北')
  ok(chinaFirs.titleIndicatesNotice('<title>A3624/26 - NOTAM | Space Notices</title>'), '真通告 title')
  ok(!chinaFirs.titleIndicatesNotice('<title>Space Notices</title>'), '占位 200 title 不算命中')
  ok(chinaFirs.noticePathForSeries('ZLHW', 'A', 3624, '26') === '/notice/notam-ZLHW-A3624/26', '编号拼路径')
  ok(chinaFirs.advanceContiguous(3379, [3380, 3381, 3383]) === 3381, 'scanned 只连续推进')
  const sitemapXml = [
    '<?xml version="1.0"?><urlset>',
    '<url><loc>https://space-notices.com/notice/notam-ZLHW-A3378%2F26</loc><lastmod>2026-08-05T06:17:14.132Z</lastmod></url>',
    '<url><loc>https://space-notices.com/notice/notam-ZHWH-A3497%2F26</loc><lastmod>2026-08-10T08:58:07.427Z</lastmod></url>',
    '<url><loc>https://space-notices.com/notice/notam-YMMM-E2700%2F26</loc><lastmod>2026-08-01T00:00:00.000Z</lastmod></url>',
    '<url><loc>https://space-notices.com/notice/notam-RPHI-B4090%2F26</loc><lastmod>2026-08-12T07:45:10.132Z</lastmod></url>',
    '</urlset>'
  ].join('')
  const smRows = chinaFirs.parseSitemapChinaNoticePaths(sitemapXml)
  ok(smRows.length === 2 && smRows.some((r) => r.fir === 'ZLHW') && smRows.some((r) => r.fir === 'ZHWH'), 'sitemap 只收中国 FIR', smRows.map((r) => r.fir))
  ok(!smRows.some((r) => r.fir === 'YMMM' || r.fir === 'RPHI'), '澳洲/马尼拉不进中国扫描')
  ok(chinaFirs.allowChinaIngestKey('notam-RPHI-B4090/26', { 'notam-RPHI-B4090/26': true }), '合集页挂上的马尼拉溅落可收')
  ok(!chinaFirs.allowChinaIngestKey('notam-RPHI-B4090/26', {}), '未上合集的马尼拉通告不收')
  ok(chinaFirs.allowChinaIngestKey('notam-ZGZU-A2863/26', {}), '广州情报区可收')
  ok(
    chinaFirs.resolveNoticeOwner('launch-long-march-3be-tianlian-2-06', 'collection-chinese-unknown') ===
      'launch-long-march-3be-tianlian-2-06',
    '中国桶不能抢走任务通告'
  )
  ok(
    chinaFirs.resolveNoticeOwner('collection-chinese-unknown', 'launch-long-march-3be-tianlian-2-06') ===
      'launch-long-march-3be-tianlian-2-06',
    '具名任务可认领孤儿通告'
  )
  ok(chinaFirs.resolveNoticeOwner('launch-a', 'launch-b') === 'launch-a', '任务之间不互抢')
  ok(chinaFirs.titleIndicatesNotice('<title>A3624/26 - NOTAM | Space Notices</title>', 'A3624/26'), '标题带目标编号')
  ok(!chinaFirs.titleIndicatesNotice('<title>A3624/26 - NOTAM | Space Notices</title>', 'A3497/26'), '标题对不上则拒收')
  const { noticeKeysAlign } = require('../cloudfunctions/spaceNotices/fetch-external.js')
  ok(noticeKeysAlign('notam-ZLHW-A3624/26', '/notice/notam-ZLHW-A3624%2F26'), '编号与路径对齐')
  ok(!noticeKeysAlign('notam-ZGZU-A2863/26', '/notice/notam-ZLHW-A3624/26'), '串页 id 拒收')
  const plan = chinaFirs.pickProbeTargets({
    firs: ['ZLHW', 'ZHWH'],
    yy: '26',
    sitemapMax: { ZLHW: 3379, ZHWH: 3497 },
    state: { yy: '26', cursors: {} },
    budget: 260
  })
  ok(plan.targets[0] && plan.targets[0].fir === 'ZLHW' && plan.targets[0].num === 3380, '从 sitemap 最大编号之后扫', plan.targets[0])
  ok(plan.targets.some((t) => t.fir === 'ZLHW' && t.num === 3624), '一轮能扫到 A3624', plan.targets.length)
  ok(plan.nextState.cursors.ZLHW.scanned === 3379, '计划前 scanned 落在 sitemap 最大号')
  const after = chinaFirs.applyProbeResults(plan.nextState, [
    { fir: 'ZLHW', num: 3624, ok: true, exists: true },
    { fir: 'ZLHW', num: 3380, ok: true, exists: false }
  ], '26')
  ok(after.cursors.ZLHW.scanned === 3380, '只连续推进到已返回的编号', after.cursors.ZLHW)
  ok(after.cursors.ZLHW.lastHit === 3624, '命中页提升 lastHit', after.cursors.ZLHW)
  const future = { noticeKey: 'notam-ZLHW-A3624/26', dates: [{ start: '2026-08-18T23:27:00Z', end: '2026-08-19T00:04:00Z' }] }
  const old = { noticeKey: 'notam-ZLHW-A0312/26', dates: [{ start: '2026-01-01T00:00:00Z', end: '2026-01-02T00:00:00Z' }] }
  ok(chinaFirs.shouldKeepStoredNotice(future, {}, Date.parse('2026-08-14T00:00:00Z'), chinaFirs.KEEP_ENDED_MS), '未上合集的未来窗口不删')
  ok(!chinaFirs.shouldKeepStoredNotice(old, {}, Date.parse('2026-08-14T00:00:00Z'), chinaFirs.KEEP_ENDED_MS), '过期很久且不在发现集才删')
  ok(chinaFirs.shouldKeepStoredNotice(old, { 'notam-ZLHW-A0312/26': true }, Date.parse('2026-08-14T00:00:00Z'), chinaFirs.KEEP_ENDED_MS), '仍在 sitemap 的过期条保留到源站下架')
  const rphi = { noticeKey: 'notam-RPHI-B3623/26', dates: [{ start: '2026-08-20T00:00:00Z', end: '2026-08-21T00:00:00Z' }] }
  ok(!chinaFirs.shouldKeepStoredNotice(rphi, {}, Date.parse('2026-08-14T00:00:00Z'), chinaFirs.KEEP_ENDED_MS), '未上合集的马尼拉通告不靠窗口留在中国桶')
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
    const { firCodeFromNotice } = require('../subpackages/monitor-pages/space-notices/utils/china-filter.js')
    const { fillNoticeDates } = require('../cloudfunctions/spaceNotices/parse-dates.js')
    res.notices.forEach((n) => {
      const fir = firCodeFromNotice(n)
      const series = String(n.name || n.noticeKey || '').match(/[A-Z]\d{3,5}\/\d{2}|HYDROPAC\s+\d+\/\d+/i)
      const dates = fillNoticeDates(n.dates, n.rawText)
      ok(!!fir, `${n.name} 抽出情报区 ${fir || '空'}`)
      ok(!!series, `${n.name} 抽出编号 ${series && series[0]}`)
      ok((dates && dates.length) || /HYDROPAC|NAV/i.test(n.noticeKey + n.name), `${n.name} 有生效窗口`)
    })
    const uncapped = extractNoticeLinks(html, { max: Infinity })
    ok(uncapped.length >= paths.length, `中国合集页链接 ${uncapped.length}`)
  }

  console.log('\n[6c] sitemap 全国 FIR + 孤儿通告探测')
  {
    const chinaFirs = require('../cloudfunctions/spaceNotices/discover-china-firs.js')
    const rows = await chinaFirs.fetchSitemapChinaNoticePaths()
    const firs = [...new Set(rows.map((r) => r.fir))]
    ok(rows.length >= 40, `sitemap 中国 FIR 通告 ${rows.length} 条`)
    ok(firs.indexOf('ZLHW') >= 0 && firs.indexOf('ZWUQ') >= 0, 'sitemap 含兰州与乌鲁木齐', firs)
    ok(firs.indexOf('RPHI') < 0, '中国扫描不含马尼拉整库', firs)
    ok(firs.filter((c) => /^Z/.test(c)).length >= 6, `大陆情报区 ${firs.filter((c) => /^Z/.test(c)).length} 个`, firs)
    const missHtml = await require('../cloudfunctions/spaceNotices/fetch-external.js').httpGet(
      'https://space-notices.com/notice/notam-ZLHW-A0001/26'
    )
    ok(!chinaFirs.titleIndicatesNotice(missHtml), '不存在的编号是占位页')
    const probed = await chinaFirs.probeFirNoticePages([
      { fir: 'ZLHW', letter: 'A', num: 3624, yy: '26', path: '/notice/notam-ZLHW-A3624/26' }
    ], { deadline: Date.now() + 15000, concurrency: 1 })
    const hit = probed[0]
    if (hit && hit.exists && hit.notice) {
      ok(/ZLHW/i.test(hit.notice.noticeKey || ''), `扫到孤儿 A3624 ${hit.notice.name}`)
      ok((hit.notice.areas || []).length >= 1, 'A3624 带多边形')
    } else {
      const sitemapZlhw = rows.filter((r) => r.fir === 'ZLHW')
      ok(sitemapZlhw.length >= 10, 'A3624 已下架时 sitemap 仍覆盖兰州情报区', sitemapZlhw.length)
    }
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
