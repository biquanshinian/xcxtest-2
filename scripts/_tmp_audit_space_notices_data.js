/**
 * SPACE_NOTICES_FEATURE — 数据打通 / 防污染审计
 * node scripts/_tmp_audit_space_notices_data.js
 */
const path = require('path')
const { spawnSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const results = []

function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail || '' })
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`)
}

const cloud = require('../cloudfunctions/spaceNotices/china-notices.js')
const client = require('../subpackages/monitor-pages/space-notices/utils/china-notices.js')
const discover = require('../cloudfunctions/spaceNotices/discover-china-firs.js')

const fixtures = [
  {
    name: '兰州 A3624',
    notice: {
      noticeKey: 'notam-ZLHW-A3624/26',
      rawText: 'A3624/26 NOTAMN\nQ) ZLHW/QWELW/IV/BO/W/000/999/3830N10015E050\nA) ZLHW\nE) ROCKET LAUNCH HAZARD AREA',
      areas: [[[100.2, 38.5], [100.4, 38.5], [100.4, 38.7], [100.2, 38.7]]]
    },
    want: true
  },
  {
    name: '香港 VHHK',
    notice: { noticeKey: 'notam-VHHK-A0258/26', rawText: 'Q) VHHK/QWELW\nA) VHHK', areas: [] },
    want: true
  },
  {
    name: '台北 RCAA',
    notice: { noticeKey: 'notam-RCAA-A2576/26', rawText: 'Q) RCAA/QWELW\nA) RCAA', areas: [] },
    want: true
  },
  {
    name: '文昌无 FIR 靠坐标',
    notice: { noticeKey: 'nav-wenchang', areas: [[[111.0, 19.3], [111.2, 19.3], [111.2, 19.5], [111.0, 19.5]]] },
    want: true
  },
  {
    name: '长征关键词无 FIR',
    notice: { noticeKey: 'x', reason: 'Long March 8A launch hazard', areas: [] },
    want: true
  },
  {
    name: '马尼拉 RPHI 近台湾坐标',
    notice: {
      noticeKey: 'notam-RPHI-B3622/26',
      entryKey: 'collection-china-firs',
      missionName: '中国航警公告',
      rawText: 'Q) RPHI/QWELW\nA) RPHI',
      areas: [[[121.2, 21.1], [121.6, 21.1], [121.6, 21.5], [121.2, 21.5]]]
    },
    want: false
  },
  {
    name: '马尼拉但长征溅落',
    notice: {
      noticeKey: 'notam-RPHI-B4090/26',
      rawText: 'Q) RPHI/QWELW\nA) RPHI\nE) LONG MARCH 5 SPLASHDOWN',
      areas: [[[121.2, 21.1], [121.6, 21.1], [121.6, 21.5], [121.2, 21.5]]]
    },
    want: true
  },
  {
    name: '美国 Houston ZHU',
    notice: { noticeKey: 'notam-ZHU-07/270-26', rawText: 'Q) KZHU/QWELW', areas: [[[-95, 29], [-94, 29], [-94, 30], [-95, 30]]] },
    want: false
  },
  {
    name: '美国 KZMA 迈阿密',
    notice: { noticeKey: 'notam-KZMA-x', rawText: 'Q) KZMA/QWELW', areas: [[[-80, 25], [-79, 25], [-79, 26], [-80, 26]]] },
    want: false
  },
  {
    name: '卡纳维拉尔星链',
    notice: {
      noticeKey: 'notam-ZMA-starlink',
      entryKey: 'launch-f9-starlink-17-51',
      missionName: 'Starlink Group 17-51',
      rawText: 'Q) KZMA/QWELW',
      areas: [[[-80.6, 28.4], [-80.4, 28.4], [-80.4, 28.6], [-80.6, 28.6]]]
    },
    want: false
  },
  {
    name: '桶名不能洗白外国通告',
    notice: {
      noticeKey: 'notam-RPHI-B3620/26',
      entryKey: 'collection-china-firs',
      missionName: '中国航警公告',
      rawText: 'Q) RPHI/QWELW\nA) RPHI',
      areas: []
    },
    want: false
  },
  {
    name: '日本 RJTG',
    notice: { noticeKey: 'notam-RJTG-A1/26', rawText: 'Q) RJTG/QWELW\nA) RJTG', areas: [[[139.7, 35.6], [140, 35.6], [140, 36], [139.7, 36]]] },
    want: false
  }
]

console.log('\n=== 云 / 端过滤对齐 ===')
fixtures.forEach((f) => {
  const c = cloud.isChinaNotice(f.notice)
  const u = client.isChinaNotice(f.notice)
  check(f.name + ' 云=端', c === u, `cloud=${c} client=${u}`)
  check(f.name + ' 判定', c === f.want, `got=${c} want=${f.want}`)
})

check('FIR 列表两端一致', cloud.CHINA_FIRS.join(',') === client.CHINA_FIRS.join(','))
check('bbox 两端一致', JSON.stringify(cloud.CHINA_BBOX) === JSON.stringify(client.CHINA_BBOX))

console.log('\n=== 发现层不收外国页 ===')
const sm = discover.parseSitemapChinaPaths(
  [
    'https://space-notices.com/notice/notam-ZLHW-A3624/26',
    'https://space-notices.com/notice/notam-RPHI-B3622/26',
    'https://space-notices.com/notice/notam-ZHU-07/270-26',
    'https://space-notices.com/notice/notam-VHHK-A0258/26',
    'https://space-notices.com/notice/notam-KZMA-08/033-26'
  ]
    .map((u) => `<loc>${u}</loc>`)
    .join('')
)
check('sitemap 含兰州+香港', sm.some((p) => /ZLHW/.test(p)) && sm.some((p) => /VHHK/.test(p)))
check('sitemap 不含 RPHI/ZHU/KZMA', !sm.some((p) => /RPHI|ZHU-07|KZMA/.test(p)), sm.join(','))

const col = discover.parseNoticePathsFromHtml(
  'href="/notice/notam-ZHWH-A3497/26" href="/notice/notam-RPHI-B3622/26" href="/notice/nav-warning-HYDROPAC 2308/26"'
)
check('合集 HTML 仍能抽出 RPHI 链接', col.some((p) => /RPHI/.test(p)))
const keptCol = col.filter((p) => cloud.isChinaNoticePath(p) || /nav-warning/i.test(p))
check('合集入库前丢掉 RPHI', !keptCol.some((p) => /RPHI/.test(p)) && keptCol.some((p) => /ZHWH/.test(p)))

console.log('\n=== 入库 / 查询契约 ===')
const fs = require('fs')
const indexJs = fs.readFileSync(path.join(ROOT, 'cloudfunctions/spaceNotices/index.js'), 'utf8')
const mapJs = fs.readFileSync(path.join(ROOT, 'subpackages/monitor-pages/space-notices/notice-map.js'), 'utf8')
const listJs = fs.readFileSync(path.join(ROOT, 'subpackages/monitor-pages/space-notices/entry-list.js'), 'utf8')
check('入库前 isChinaNotice 门禁', /if \(!isChinaNotice\(notice\)\)/.test(indexJs))
check('中国桶 keepers 再过滤', /noticeStillKeep\(n, nowMs\(\)\) && isChinaNotice\(n\)/.test(indexJs))
check('listGlobalNotams 不再用桶名洗白', /picked = filterChinaNotices\(picked\)/.test(indexJs))
check('listGlobalNotams 不把 entry.missionName 注入过滤', !/filterChinaNotices\(\[[\s\S]{0,200}missionName: entry\.missionName/.test(indexJs))
check('中国桶不进发射列表', /!d\.isCollection/.test(indexJs))
check('launch- 通告不被中国桶改挂', /keepLaunch \? prev\.entryKey : CHINA_FIR_ENTRY_KEY/.test(indexJs))
check('详情页中国区再过滤', /wantChina[\s\S]{0,180}filterChinaNotices\(rows\)/.test(mapJs))
check('列表预览再过滤', /filterChinaNotices\(\(res && res\.notices\)/.test(listJs))
check('监控预览再过滤', /filterChinaNotices\(\(res && res\.notices\)/.test(
  fs.readFileSync(path.join(ROOT, 'subpackages/monitor-pages/components/monitor-core-sections/index.js'), 'utf8')
))

console.log('\n=== 语法 ===')
;['cloudfunctions/spaceNotices/china-notices.js', 'cloudfunctions/spaceNotices/discover-china-firs.js', 'subpackages/monitor-pages/space-notices/utils/china-notices.js'].forEach((rel) => {
  const r = spawnSync(process.execPath, ['--check', path.join(ROOT, rel)], { encoding: 'utf8' })
  check('syntax ' + path.basename(rel), r.status === 0, r.stderr || 'ok')
})

const failed = results.filter((r) => !r.ok)
console.log(`\n=== DATA AUDIT: ${results.length - failed.length} passed, ${failed.length} failed ===`)
if (failed.length) {
  failed.forEach((f) => console.log(' -', f.name, f.detail))
  process.exitCode = 1
} else {
  console.log('ALL GREEN')
}
