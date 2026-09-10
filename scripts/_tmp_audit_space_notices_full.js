/**
 * SPACE_NOTICES_FEATURE — 发射航警地图总闸（逻辑 + 子审计全绿）
 * node scripts/_tmp_audit_space_notices_full.js
 */
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const results = []

function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail || '' })
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`)
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8')
}

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

const clientLife = require('../subpackages/monitor-pages/space-notices/utils/entry-lifecycle.js')
const cloudLife = require('../cloudfunctions/spaceNotices/entry-lifecycle.js')
const {
  buildPolygonsFromNotices,
  buildPolylinesFromNotices,
  buildPadMarker,
  resolveEffectivePad,
  fitCenter,
  isUsableLatLng,
  buildPreviewLayers
} = require('../subpackages/monitor-pages/space-notices/utils/map-build.js')
const { decorateEntryCard, splitEntryCards } = require('../subpackages/monitor-pages/space-notices/utils/entry-cards.js')
const { noticeStatusVisible } = require('../subpackages/monitor-pages/space-notices/utils/notice-format.js')
const clientPad = require('../subpackages/monitor-pages/space-notices/utils/pad-coords.js')
const cloudPad = require('../cloudfunctions/spaceNotices/pad-coords.js')

const NOW = Date.parse('2026-09-07T00:00:00+08:00')

console.log('\n=== 1) 发射时刻分类对齐 ===')
const lifeRows = [
  { entryKey: 'launch-f9-starlink-10-49', net: '2026-07-29T00:00:00.000Z', windowEndMs: Date.parse('2026-12-01T00:00:00Z') },
  { entryKey: 'launch-fh-roman', net: '2026-08-30T00:00:00.000Z' },
  { entryKey: 'launch-future', net: '2026-10-01T00:00:00.000Z' },
  { entryKey: 'collection-chinese-unknown', isCollection: true },
  { entryKey: 'launch-no-time' },
  { entryKey: 'launch-success', net: '2026-10-01T00:00:00.000Z', statusAbbrev: 'Success', statusId: 3 }
]
lifeRows.forEach((row) => {
  const a = clientLife.computeEntryIsPast(row, NOW)
  const b = cloudLife.computeEntryIsPast(row, NOW)
  check(row.entryKey + ' 云=端 isPast', a === b, `client=${a} cloud=${b}`)
})
check('7月星链进历史（不用窗口结束）', clientLife.computeEntryIsPast(lifeRows[0], NOW) === true)
check('10月未来留即将', clientLife.computeEntryIsPast(lifeRows[2], NOW) === false)
check('无发射时间不占即将', clientLife.computeEntryIsPast(lifeRows[4], NOW) === true)
check(
  '航警窗口不能冒充发射时刻',
  clientLife.computeEntryIsPast({
    entryKey: 'launch-unmatched',
    windowStartMs: Date.parse('2026-09-10T00:00:00.000Z'),
    windowEndMs: Date.parse('2026-12-01T00:00:00.000Z')
  }, NOW) === true
)
check(
  'launchTimeMs 不用航警 windowStartMs',
  clientLife.launchTimeMs({ windowStartMs: Date.parse('2026-09-10T00:00:00.000Z') }) === 0
)
check(
  'launchTimeMs 不用 windowStart 字符串',
  clientLife.launchTimeMs({ windowStart: '2026-10-01T00:00:00Z' }) === 0 &&
    cloudLife.launchTimeMs({ windowStart: '2026-10-01T00:00:00Z' }) === 0
)
check('合集不算历史', clientLife.computeEntryIsPast(lifeRows[3], NOW) === false)
check('终态进历史', clientLife.computeEntryIsPast(lifeRows[5], NOW) === true)
check(
  'launchTimeMs 优先 net',
  clientLife.launchTimeMs({ net: '2026-09-01T12:00:00Z', windowStartMs: Date.parse('2026-08-01T00:00:00Z') }) ===
    Date.parse('2026-09-01T12:00:00Z')
)

const split = splitEntryCards([
  { entryKey: 'launch-old', missionName: 'Starlink Group 10-49', rocketName: 'Falcon 9', net: '2026-07-29T00:00:00.000Z' },
  { entryKey: 'launch-new', missionName: 'Starlink Group 11-1', rocketName: 'Falcon 9', net: '2026-10-12T00:00:00.000Z' },
  { entryKey: 'collection-chinese-unknown', isCollection: true, missionName: 'Chinese Notices' }
], { now: NOW })
check('即将区只有未来任务', split.upcoming.length === 1 && split.upcoming[0].entryKey === 'launch-new')
check('历史区收已飞任务', split.past.some((e) => e.entryKey === 'launch-old'))
check('合集不进网格', !split.upcoming.some((e) => e.isCollection) && !split.past.some((e) => e.isCollection))

const star17 = decorateEntryCard({
  entryKey: 'launch-f9-starlink-17-51',
  missionName: 'Starlink Group 17-51',
  rocketName: 'Falcon 9'
}, {
  now: NOW,
  upcomingLaunches: [{ id: 'u1', name: 'Starlink Group 10-49 | Falcon 9', net: '2026-10-01T00:00:00Z' }],
  previousLaunches: [{ id: 'p1', name: 'Starlink Group 17-51 | Falcon 9', net: '2026-08-01T00:00:00Z' }]
})
check('星链组号不串到 10-49', /17-51/.test(star17.title) && !/10-49/.test(star17.title), star17.title)

console.log('\n=== 2) 地图定位 / 几何对齐 ===')
const ended = {
  noticeKey: 'notam-ended',
  type: 'NOTAM',
  statusTone: 'off',
  cancelled: false,
  areas: [[[100.2, 38.4], [100.6, 38.4], [100.6, 38.8], [100.2, 38.8], [100.2, 38.4]]]
}
const endedPolys = buildPolygonsFromNotices([ended], { NOTAM: true })
check('已结束通告仍画多边形', endedPolys.length === 1)
check('已结束通告默认可见', noticeStatusVisible(ended, { showEnded: true }) === true)
check('已结束通关关闭时可藏', noticeStatusVisible(ended, { showEnded: false }) === false)

const emptyFit = fitCenter(null, [], [], { region: 'pad' })
check('无几何不回退 Starbase', !!(emptyFit.empty && Math.abs(emptyFit.latitude - 25.99) > 2), JSON.stringify(emptyFit))
check(
  '空视野不是中国概览点',
  !!(emptyFit.empty && !(emptyFit.latitude === 36 && emptyFit.longitude === 104) && !(emptyFit.latitude === 0 && emptyFit.longitude === 0)),
  JSON.stringify(emptyFit)
)

const nullPad = resolveEffectivePad({ missionName: '中国航警公告', pad: { latitude: null, longitude: null } }, [], [])
check('null pad 不变成 Number(null)=0', !nullPad || isUsableLatLng(nullPad.latitude, nullPad.longitude) === false)
check('0,0 红钉拒绝', buildPadMarker({ latitude: 0, longitude: 0 }, 'x').length === 0)
check('isUsableLatLng 拒 0,0', isUsableLatLng(0, 0) === false)
check('isUsableLatLng 拒非法纬', isUsableLatLng(100, 38) === false)

const latFirst = buildPolygonsFromNotices(
  [{ noticeKey: 'swap', type: 'NOTAM', areas: [[[38, 100], [38.2, 101], [37.8, 101], [38, 100]]] }],
  { NOTAM: true }
)
check(
  '[lat,lon] 对调后钉在 100E',
  !!(latFirst[0] && Math.abs(latFirst[0].points[0].longitude - 100) < 0.01 && Math.abs(latFirst[0].points[0].latitude - 38) < 0.01),
  JSON.stringify(latFirst[0] && latFirst[0].points[0])
)

const endedChina = {
  noticeKey: 'cn-ended',
  type: 'NOTAM',
  statusTone: 'off',
  inChina: true,
  areas: [[[100.2, 38.4], [100.6, 38.4], [100.6, 38.8], [100.2, 38.8], [100.2, 38.4]]]
}
const previewEnded = buildPreviewLayers([endedChina])
check('预览无生效区时仍画已结束', previewEnded.polygons.length === 1)
const tanegashima = {
  noticeKey: 'jp',
  type: 'NOTAM',
  areas: [[[130.9, 30.3], [131.1, 30.3], [131.1, 30.5], [130.9, 30.5]]]
}
check('预览不用粗框吃进种子岛', buildPreviewLayers([tanegashima]).polygons.length === 0)

const capeFit = fitCenter({ latitude: 28.562, longitude: -80.577 }, buildPolygonsFromNotices([{
  noticeKey: 'cape',
  type: 'NOTAM',
  areas: [[[-80.7, 28.3], [-80.4, 28.3], [-80.4, 28.7], [-80.7, 28.7]]]
}], { NOTAM: true }), [], { region: 'pad' })
check('卡纳维拉尔中心钉发射台', Math.abs(capeFit.latitude - 28.562) < 0.01 && Math.abs(capeFit.longitude + 80.577) < 0.01)

const wen = clientPad.resolvePadCoords({ name: 'Commercial LC-1', location: { name: 'Wenchang Space Launch Site' } })
const wenCloud = cloudPad.resolvePadCoords({ name: 'Commercial LC-1', location: { name: 'Wenchang Space Launch Site' } })
check('文昌坐标云=端', wen.latitude === wenCloud.latitude && Math.abs(wen.latitude - 19.6145) < 0.05)
check(
  '发射台名表两端一致',
  clientPad.PAD_COORDS_BY_NAME.length === cloudPad.PAD_COORDS_BY_NAME.length &&
    clientPad.LOCATION_COORDS.length === cloudPad.LOCATION_COORDS.length
)

console.log('\n=== 3) 页面 / 云函数契约 ===')
const mapJs = read('subpackages/monitor-pages/space-notices/notice-map.js')
const mapWxml = read('subpackages/monitor-pages/space-notices/notice-map.wxml')
const listJs = read('subpackages/monitor-pages/space-notices/entry-list.js')
const listWxml = read('subpackages/monitor-pages/space-notices/entry-list.wxml')
const cfIndex = read('cloudfunctions/spaceNotices/index.js')
const cardsJs = read('subpackages/monitor-pages/space-notices/utils/entry-cards.js')

check('详情用发射时刻写 NET', /launchTimeMs\(entry\)/.test(mapJs) && /netText/.test(mapJs))
check('历史默认打开已结束层', /showEnded:\s*past/.test(mapJs))
check('已结束 chip 在工具条', /data-key="showEnded"/.test(mapWxml) && /stats\.ended/.test(mapWxml))
check('空视野不改 lat/lon', /center\.empty/.test(mapJs))
check('红钉前校验可用坐标', /isUsableLatLng\(pad\.latitude/.test(mapJs))
check('中国合集钉 CHINA_VIEW', /CHINA_VIEW/.test(mapJs) && /isChineseCollectionKey/.test(mapJs))
check('轨迹只按 hasTrajectory', /hasTrajectory/.test(mapWxml) && /resolveTrajectory/.test(mapJs))
check('无轨迹时 ADP 走廊仍可画', /hasAdp/.test(mapJs) && /hasTrajectory \|\| hasAdp/.test(mapWxml) && /hasTrajectory \|\| hasAdp/.test(mapJs))
check('列表按 entryKey 打开详情', /data-key="\{\{item\.entryKey\}\}"/.test(listWxml) && /openMap\(/.test(listJs))
check('列表默认只拉提前预警', /upcomingOnly:\s*true/.test(listJs) && /upcomingOnly/.test(cfIndex) && /提前预警/.test(listWxml) && !/历史发射/.test(listWxml))
check('监控点预览进列表页', /SPACE_NOTICE_LIST/.test(read('pages/monitor/monitor.js')))
check(
  '监控预览复用详情腾讯图',
  /native-map="\{\{true\}\}"/.test(read('pages/monitor/monitor.wxml')) &&
    /title="中国航警"/.test(read('pages/monitor/monitor.wxml')) &&
    /CHINA_VIEW/.test(read('subpackages/monitor-pages/components/china-notice-preview/index.js')) &&
    /fitChinaPreviewMap/.test(read('subpackages/monitor-pages/components/china-notice-preview/index.js')) &&
    /nativeMap:\s*\{\s*type:\s*Boolean,\s*value:\s*true\s*\}/.test(read('subpackages/monitor-pages/components/china-notice-preview/index.js'))
)
check('列表预览用腾讯卫星图', /native-map="\{\{true\}\}"/.test(listWxml) && /sn-preview-map/.test(read('subpackages/monitor-pages/components/china-notice-preview/index.wxml')))
check('列表无手动同步空态', !/暂无提前预警/.test(listWxml) && !/同步条目/.test(listWxml) && /_quietSync/.test(listJs))
check(
  '静默同步不自环且重试可再同步',
  /if \(this\._autoSynced\) return/.test(listJs) &&
    /this\._autoSynced = true/.test(listJs) &&
    /retryLoad\(\) \{[\s\S]*?this\._autoSynced = false/.test(listJs)
)
check('云列表 upcomingOnly 默认丢掉历史', /upcomingOnly !== false/.test(cfIndex) && /upcomingOnly \? !a\.isPast/.test(cfIndex))
check('发射列表不含合集桶', /\.filter\(\(a\) => a && a\.entryKey && !a\.isCollection\)/.test(cfIndex))
check('列表配图禁 default.jpg', /isDefaultRocketSrc/.test(cardsJs) && /usableRocketImage/.test(cardsJs))
check('云列表/详情 LL2 回填', /alignEntryWithLaunch/.test(cfIndex) && /statusAbbrev/.test(cfIndex))
check('getEntry 回传 statusAbbrev', /statusAbbrev: entry\.statusAbbrev/.test(cfIndex))
check('写入条目用发射窗口不是航警窗口', /noticeWindowStartMs/.test(cfIndex) && /windowStart: launch \? launch.windowStart/.test(cfIndex))
check('列表排序只用发射时刻', /const ta = launchTimeMs\(a\) \|\| 0/.test(cfIndex) && !/launchTimeMs\(a\) \|\| a\.windowStartMs/.test(cfIndex) && !/launchTimeMs\(a\) \|\| Date\.parse/.test(cfIndex))
check('slim 回传 statusId 与发射窗口字段', /statusId: d\.statusId/.test(cfIndex) && /windowStart: d\.windowStart/.test(cfIndex))
check('同 ll2Id 多行择优', /pickBestEntryDoc/.test(cfIndex) && /limit\(20\)/.test(cfIndex))
check('星舰快捷入口也 LL2 回填', /lookupStarshipEntry[\s\S]{0,900}alignEntryWithLaunch/.test(cfIndex))
check('首页 badge 不写入 statusName', /statusName: row\.statusName \|\| launch\.statusName/.test(cardsJs) && !/statusName: launch\.status \|\|/.test(cardsJs))
check('非中国默认视野不是大陆', /EMPTY_MAP_VIEW/.test(mapJs) && /latitude: EMPTY_MAP_VIEW\.latitude/.test(mapJs))
check('中国合集仍钉大陆', /chinaCollection[\s\S]*CHINA_VIEW/.test(mapJs) || /chinaCollection\s*\n[\s\S]{0,220}CHINA_VIEW/.test(mapJs))

const { scoreMatch, dateScore, rocketScore, MATCH_THRESHOLD } = require('../cloudfunctions/spaceNotices/match-ll2.js')
const dateMeta = { missionName: 'NROL-95', rocketName: 'Falcon 9', siteDates: ['2026-01-01T00:00'] }
const dateA = { title: 'Falcon 9 | NROL-95', subtitle: 'Falcon 9', net: '2026-07-30T08:00:00Z' }
const dateB = { title: 'Falcon 9 | NROL-95', subtitle: 'Falcon 9', net: '2026-01-01T00:00:00Z' }
check('航警日期不参与 LL2 打分', scoreMatch(dateMeta, dateA) === scoreMatch(dateMeta, dateB) && dateScore() === 0)
check(
  '无组号不配 LL2 星链',
  scoreMatch(
    { missionName: 'Starlink', rocketName: 'Falcon 9' },
    { title: 'Falcon 9 Block 5 | Starlink Group 17-51', subtitle: 'Falcon 9' }
  ) < 0
)
check('首页匹配跨桶比分', /upScore >= prevScore/.test(cardsJs))
check('预览已结束可回退', /live\.length \? live : pool/.test(read('subpackages/monitor-pages/space-notices/utils/map-build.js')))
check('回填不继承旧航警 windowStart', /windowStart: launch\.windowStart \|\| ''/.test(cfIndex))
check('条目列表分页读库', /readAllEntryDocs/.test(cfIndex) && /ENTRY_READ_CAP/.test(cfIndex))
check('合集不造密度发射台', /isCollection \|\| \/\^collection-/.test(read('subpackages/monitor-pages/space-notices/utils/map-build.js')))
check('东方航天港不误识别东方发射场', /东方航天港/.test(read('cloudfunctions/spaceNotices/pad-coords.js')) && !/vostochny\|东方(?!发射场)/.test(read('cloudfunctions/spaceNotices/pad-coords.js')))

const haiyang = clientPad.resolvePadCoords({ name: '东方航天港' })
const vostochny = clientPad.resolvePadCoords({ name: 'Vostochny Cosmodrome' })
check('东方航天港钉海阳', Math.abs(haiyang.latitude - 36.529) < 0.05)
check('Vostochny 仍是东方发射场', Math.abs(vostochny.latitude - 51.8844) < 0.05)

const { fillNoticeDates } = require('../cloudfunctions/spaceNotices/parse-dates.js')
const { datesFromNotice, describeDates } = require('../subpackages/monitor-pages/space-notices/utils/notice-format.js')
check(
  '2099 占位日期不当成生效窗',
  fillNoticeDates([{ start: '2026-08-17T02:53:00Z', end: '2099-01-01T00:00:00Z' }], '').length === 0 &&
    describeDates(datesFromNotice({ dates: [{ start: '2099-01-01T00:00:00Z', end: '2099-01-01T12:00:00Z' }] }), false, NOW).statusTone === ''
)

const collectionPad = resolveEffectivePad({
  entryKey: 'collection-chinese-unknown',
  isCollection: true,
  missionName: '中国航警公告'
}, buildPolygonsFromNotices([{
  noticeKey: 'cn-live',
  type: 'NOTAM',
  inChina: true,
  areas: [[[100.2, 38.4], [100.6, 38.4], [100.6, 38.8], [100.2, 38.8]]]
}], { NOTAM: true }), [])
check('中国合集无红钉冒充发射台', !collectionPad || !isUsableLatLng(collectionPad.latitude, collectionPad.longitude))

const genericStar = decorateEntryCard({
  entryKey: 'launch-f9-starlink',
  missionName: 'Starlink',
  rocketName: 'Falcon 9'
}, {
  now: NOW,
  upcomingLaunches: [{
    id: 'u-star',
    missionName: 'Starlink Group 17-51',
    rocketName: 'Falcon 9',
    launchTime: '2026-10-01T00:00:00Z'
  }]
})
check('无组号 Starlink 不配到 17-51', genericStar.ll2Id !== 'u-star' && genericStar.homeBucket !== 'upcoming')

const naive = '2026-09-06T16:00:00'
check(
  '无时区 NET 云=端按 UTC',
  clientLife.parseTimeMs(naive) === cloudLife.parseTimeMs(naive) &&
    clientLife.parseTimeMs(naive) === Date.parse(naive + 'Z')
)

const chinaNotices = require('../cloudfunctions/spaceNotices/china-notices.js')
check('任意 Z*** 不当中国 FIR', chinaNotices.isChinaFir('ZTAA') === false && chinaNotices.isChinaFir('ZLHW') === true)
check('组号冲突时 ll2Id 也不配', /eDigits !== lDigits/.test(cardsJs) && /ll2Id: launch\.id \|\| row\.ll2Id/.test(cardsJs))

check(
  '未来 NET 不被 previous 桶推进历史',
  clientLife.computeEntryIsPast({
    entryKey: 'launch-future-prev',
    net: '2026-10-12T00:00:00.000Z',
    homeBucket: 'previous'
  }, NOW) === false &&
    cloudLife.computeEntryIsPast({
      entryKey: 'launch-future-prev',
      net: '2026-10-12T00:00:00.000Z',
      homeBucket: 'previous'
    }, NOW) === false
)
check('首页匹配阈值对齐云端 62', /HOME_MATCH_THRESHOLD = 62/.test(cardsJs))

check(
  'CZ-3B 对 Long March 3B 给正分',
  rocketScore('CZ-3B', 'Long March 3B', 'Long March 3B') > 0 &&
    rocketScore('Long March 3BE', 'Long March 3B/E', 'Long March 3B/E') > 0
)
check(
  'CZ 任务名满分不再被火箭罚掉阈值',
  scoreMatch(
    { missionName: 'Tianlian 2-06', rocketName: 'CZ-3B' },
    { title: 'Long March 3B/E | TianLian-2 (06)', subtitle: 'Long March 3B/E' }
  ) >= MATCH_THRESHOLD
)

const { parseEntryMeta, missionFromSlug } = require('../cloudfunctions/spaceNotices/discover-entries.js')
check(
  'slug 回退不带火箭数字组',
  missionFromSlug('launch-long-march-3be-tianlian-2-06') === 'tianlian 2 06' &&
    parseEntryMeta('<html></html>', 'launch-long-march-3be-tianlian-2-06').missionName === 'tianlian 2 06'
)

const { mergeEntryIdentity, preferLaunchMatch } = require('../cloudfunctions/spaceNotices/entry-identity.js')
const stickyPrev = { ll2Id: 'keep', net: '2026-10-01T00:00:00Z', pad: { latitude: 28.5, longitude: -80.5 }, ll2Score: 80 }
const stickyNext = mergeEntryIdentity(stickyPrev, { ll2Id: '', net: '', pad: null })
check('空身份不覆盖已绑 ll2Id', stickyNext.ll2Id === 'keep' && stickyNext.net === '2026-10-01T00:00:00Z')
check('更弱新匹配不改绑', preferLaunchMatch({ launch: { ll2Id: 'other' }, score: 63 }, stickyPrev).launch.ll2Id === 'keep')
check('同步粘滞身份', /preferLaunchMatch/.test(cfIndex) && /mergeEntryIdentity/.test(cfIndex))

const previewCollection = buildPreviewLayers([tanegashima], { chinaCollection: true })
check('合集预览与详情同收几何', previewCollection.polygons.length === 1)
const previewJs = read('subpackages/monitor-pages/components/china-notice-preview/index.js')
check('预览卡强制合集 inChina', /inChina = true/.test(previewJs) && /chinaCollection:\s*true/.test(previewJs))
check(
  '预览切 Tab/主题重建地图',
  /_reviveNativeMap/.test(previewJs) &&
    /onThemeChange/.test(previewJs) &&
    /offThemeChange/.test(previewJs) &&
    /pageLifetimes/.test(previewJs) &&
    /mapAlive/.test(read('subpackages/monitor-pages/components/china-notice-preview/index.wxml')) &&
    /_reviveChinaNoticePreview/.test(read('pages/monitor/monitor.js')) &&
    /applyThemeToPage\(this\)[\s\S]{0,180}_reviveChinaNoticePreview/.test(read('pages/monitor/monitor.js'))
)
check(
  '预览卫星且预警区文案不被盖',
  /enable-satellite="\{\{true\}\}"/.test(read('subpackages/monitor-pages/components/china-notice-preview/index.wxml')) &&
    /setting="\{\{mapSetting\}\}"/.test(read('subpackages/monitor-pages/components/china-notice-preview/index.wxml')) &&
    !/layer-style/.test(read('subpackages/monitor-pages/components/china-notice-preview/index.wxml')) &&
    /_zoneHint/.test(previewJs) &&
    /个预警区/.test(previewJs)
)

const { formatNoticeCoords } = require('../subpackages/monitor-pages/space-notices/utils/notam-meta.js')
check(
  '复制坐标对调 [lat,lon]',
  /^38\.\d+, 100\./.test(formatNoticeCoords({ areas: [[[38, 100], [38.2, 101], [37.8, 101]]] }))
)

console.log('\n=== 4) 子审计 / 单测 ===')
const children = [
  ['node --test test/space-notice-entry-cards.test.js', ['--test', 'test/space-notice-entry-cards.test.js']],
  ['node --test test/entity-route-links.test.js', ['--test', 'test/entity-route-links.test.js']],
  ['scripts/_tmp_audit_space_notices_list.js', ['scripts/_tmp_audit_space_notices_list.js']],
  ['scripts/_tmp_audit_space_notices_runtime.js', ['scripts/_tmp_audit_space_notices_runtime.js']],
  ['scripts/_tmp_audit_space_notices_draw.js', ['scripts/_tmp_audit_space_notices_draw.js']],
  ['scripts/_tmp_audit_space_notices_ui.js', ['scripts/_tmp_audit_space_notices_ui.js']],
  ['scripts/_tmp_audit_space_notices_data.js', ['scripts/_tmp_audit_space_notices_data.js']],
  ['scripts/_tmp_audit_space_notices_throw.js', ['scripts/_tmp_audit_space_notices_throw.js']],
  ['scripts/_tmp_audit_space_notices_deep.js', ['scripts/_tmp_audit_space_notices_deep.js']],
  ['scripts/_tmp_audit_space_notices_round.js', ['scripts/_tmp_audit_space_notices_round.js']],
  ['scripts/_tmp_smoke_sn_client.js', ['scripts/_tmp_smoke_sn_client.js']],
  ['scripts/_tmp_space_notices_parser_smoke.js', ['scripts/_tmp_space_notices_parser_smoke.js']]
]

children.forEach(([label, args]) => {
  const r = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', timeout: 120000 })
  const ok = r.status === 0
  const tail = ((r.stdout || '') + (r.stderr || '')).trim().split(/\r?\n/).slice(-4).join(' | ')
  check(label, ok, ok ? 'ALL GREEN' : tail.slice(0, 280))
})

const failed = results.filter((r) => !r.ok)
console.log('\n======== FULL SPACE NOTICES ========')
console.log(`total=${results.length} pass=${results.length - failed.length} fail=${failed.length}`)
if (failed.length) {
  failed.forEach((f) => console.log(' -', f.name, f.detail || ''))
  process.exit(1)
}
console.log('ALL GREEN')
