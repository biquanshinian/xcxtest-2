/**
 * 单测：罗曼望远镜 Horizons / DSN 解析
 * 运行：node --test test/roman-tracker.test.js
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const ephem = require('../subpackages/monitor-pages/utils/roman-ephem.js')

const HORIZONS_FIXTURE = `
*******************************************************************************
$$SOE
2461286.135543982 = A.D. 2026-Sep-02 15:15:11.0000 TDB
 X = 3.823037985755780E+05 Y =-2.344629218906952E+05 Z =-8.879604303510247E+04
 VX= 9.387070399228716E-01 VY=-3.908321619875579E-01 VZ=-1.860767036618138E-01
 LT= 1.524989209629506E+00 RG= 4.571802635783068E+05 RR= 1.021544082221304E+00
2461286.136238426 = A.D. 2026-Sep-02 15:16:11.0000 TDB
 X = 3.823601181373904E+05 Y =-2.344863700936390E+05 Z =-8.880720696343333E+04
 VX= 9.386116847192514E-01 VY=-3.907745996470767E-01 VZ=-1.860542398420821E-01
 LT= 1.525193648844537E+00 RG= 4.572415529130924E+05 RR= 1.021433739910503E+00
$$EOE
*******************************************************************************
`

const L2_FIXTURE = `
$$SOE
2461286.135543982 = A.D. 2026-Sep-02 15:15:11.0000 TDB
 X = 1.430698263459063E+06 Y =-5.217304639734547E+05 Z = 4.311805065075168E+02
 VX= 8.912260224885662E-02 VY= 2.889822817928058E-01 VZ= 1.917627410410877E-04
 LT= 5.079711775556871E+00 RG= 1.522859279125739E+06 RR=-1.527601750338721E-02
$$EOE
`

const DSN_FIXTURE = `<?xml version="1.0"?>
<dsn>
  <station name="cdscc" friendlyName="Canberra" timeUTC="1" timeZoneOffset="1"/>
  <dish name="DSS34" azimuthAngle="295" elevationAngle="65" activity="Spacecraft Telemetry, Tracking, and Command">
    <upSignal active="true" signalType="data" dataRate="0" band="S" power="0.4" spacecraft="RST" spacecraftID="-211"/>
    <downSignal active="true" signalType="data" dataRate="354500" band="S" power="-110" spacecraft="RST" spacecraftID="-211"/>
    <target name="RST" id="211" uplegRange="-1" downlegRange="-1" rtlt="-1"/>
  </dish>
  <dish name="DSS36" activity="Spacecraft Telemetry, Tracking, and Command">
    <downSignal active="true" spacecraft="JWST" spacecraftID="-170" dataRate="28000000" band="K"/>
    <target name="JWST" id="170"/>
  </dish>
</dsn>`

test('解析 Horizons 矢量：距地、速率、光延时', () => {
  const rows = ephem.parseHorizonsVectors(HORIZONS_FIXTURE)
  assert.equal(rows.length, 2)
  assert.ok(Math.abs(rows[0].rgKm - 457180.26) < 1)
  assert.ok(rows[0].speedKmS > 1.0 && rows[0].speedKmS < 1.1)
  assert.ok(Math.abs(rows[0].ltSec - 1.525) < 0.01)
  assert.ok(Math.abs(rows[0].rrKmS - 1.0215) < 0.001)
})

test('选取最接近当前时刻的星历行', () => {
  const rows = ephem.parseHorizonsVectors(HORIZONS_FIXTURE)
  const t = Date.UTC(2026, 8, 2, 15, 16, 11)
  const row = ephem.pickClosest(rows, t)
  assert.ok(Math.abs(row.rgKm - 457241.55) < 1)
})

test('DSN Now 解析 RST：堪培拉 DSS34 S 波段', () => {
  const dsn = ephem.parseDsnRst(DSN_FIXTURE, 'RST')
  assert.equal(dsn.tracking, true)
  assert.equal(dsn.dish, 'DSS34')
  assert.equal(dsn.station, 'Canberra')
  assert.equal(dsn.stationZh, '堪培拉')
  assert.equal(dsn.band, 'S')
  assert.equal(dsn.dataRate, 354500)
  assert.equal(dsn.dataRateText, '354.5 kbps')
  const line = ephem.formatDsnLine(dsn)
  assert.match(line, /堪培拉/)
  assert.match(line, /DSS34/)
  assert.match(line, /S 波段跟踪中/)
})

test('DSN 多天线时优先正在跟踪的 RST', () => {
  const xml = `<?xml version="1.0"?>
<dsn>
  <station name="mdscc" friendlyName="Madrid"/>
  <dish name="DSS55" activity="none">
    <downSignal active="false" spacecraft="RST" dataRate="0" band="S"/>
    <target name="RST"/>
  </dish>
  <station name="cdscc" friendlyName="Canberra"/>
  <dish name="DSS34" activity="Spacecraft Telemetry, Tracking, and Command">
    <downSignal active="true" spacecraft="RST" dataRate="354500" band="S"/>
    <target name="RST"/>
  </dish>
  <dish name="DSS36">
    <downSignal active="false" spacecraft="RST" dataRate="0" band="X"/>
    <target name="RST"/>
  </dish>
</dsn>`
  const dsn = ephem.parseDsnRst(xml, 'RST')
  assert.equal(dsn.dish, 'DSS34')
  assert.equal(dsn.tracking, true)
  assert.equal(dsn.stationZh, '堪培拉')
})

test('DSN 未跟踪时不生成状态行', () => {
  const xml = '<dsn><dish name="DSS34"><downSignal active="false" spacecraft="RST" dataRate="0" band="S"/><target name="RST"/></dish></dsn>'
  const dsn = ephem.parseDsnRst(xml, 'RST')
  assert.equal(dsn.tracking, false)
  assert.equal(ephem.formatDsnLine(dsn), '')
})

test('无 L2 星历时仍能出距地快照', () => {
  const roman = ephem.pickClosest(ephem.parseHorizonsVectors(HORIZONS_FIXTURE), Date.UTC(2026, 8, 2, 15, 15, 11))
  const snap = ephem.buildSnapshot({
    nowMs: Date.parse('2026-09-02T15:15:11.000Z'),
    launchMs: Date.parse('2026-08-30T11:26:04.000Z'),
    roman,
    l2: null,
    phase: 'cruise',
    source: 'horizons'
  })
  assert.equal(snap.ok, true)
  assert.equal(snap.distanceFromEarthKm, 457180)
  assert.equal(snap.distanceToL2Km, null)
  assert.equal(snap.progressPct, 0)
})

test('DSN 忽略 JWST 天线，未出现 RST 时返回空', () => {
  const xml = '<dsn><dish name="DSS36"><downSignal active="true" spacecraft="JWST" dataRate="1" band="K"/><target name="JWST"/></dish></dsn>'
  assert.equal(ephem.parseDsnRst(xml, 'RST'), null)
})

test('赴 L2 进度：巡航约 30%，抵达后 100%', () => {
  assert.equal(ephem.l2ProgressPct(457180, 1090000, 'cruise'), 30)
  assert.equal(ephem.l2ProgressPct(1500000, 20000, 'cruise'), 100)
  assert.equal(ephem.l2ProgressPct(1500000, 200000, 'l2'), 100)
  assert.equal(ephem.l2ProgressPct(NaN, 1, 'cruise'), 0)
})

test('任务阶段：发射前 / 巡航 / L2 / 结束', () => {
  const cfg = {
    launchUtcIso: '2026-08-30T11:26:04.000Z',
    cruiseEndUtcIso: '2026-11-28T00:00:00.000Z',
    missionEndUtcIso: '2031-08-30T00:00:00.000Z'
  }
  assert.equal(ephem.getMissionPhase(cfg, Date.parse('2026-08-29T00:00:00.000Z')), 'before')
  assert.equal(ephem.getMissionPhase(cfg, Date.parse('2026-09-02T12:00:00.000Z')), 'cruise')
  assert.equal(ephem.getMissionPhase(cfg, Date.parse('2026-11-28T00:00:00.000Z')), 'l2')
  assert.equal(ephem.getMissionPhase(cfg, Date.parse('2031-08-30T00:00:00.000Z')), 'ended')
  assert.equal(ephem.phaseSubtitle('cruise'), '奔赴日地 L2')
  assert.equal(ephem.phaseSubtitle('l2'), '日地 L2 · 晕轨道')
  assert.equal(ephem.phaseSubtitle('ended'), '任务已结束')
})

test('监控页生命周期：任务结束后隐藏，开关关闭也隐藏', () => {
  const live = {
    enabled: true,
    launchUtcIso: '2026-08-30T11:26:04.000Z',
    cruiseEndUtcIso: '2026-11-28T00:00:00.000Z',
    missionEndUtcIso: '2031-08-30T00:00:00.000Z'
  }
  const now = Date.parse('2026-09-03T00:00:00.000Z')
  assert.equal(ephem.isSectionVisible(live, now), true)
  assert.equal(ephem.isMonitorVisible(live, now), true)
  assert.equal(ephem.isMonitorVisible(live, Date.parse('2031-08-30T00:00:00.000Z')), false)
  assert.equal(ephem.isSectionVisible(live, Date.parse('2031-08-30T00:00:00.000Z')), true)
  assert.equal(ephem.isMonitorVisible({ enabled: false }, now), false)
  assert.equal(ephem.isMonitorVisible({
    enabled: true,
    visibleAfterIso: '2027-01-01T00:00:00.000Z'
  }, now), false)
})

test('MET 与光延时格式', () => {
  const launch = Date.parse('2026-08-30T11:26:04.000Z')
  const now = Date.parse('2026-09-02T11:26:04.000Z')
  assert.equal(ephem.fmtMet(now, launch), '03:00:00:00')
  assert.equal(ephem.fmtLightDelay(1.525), '1.5 秒')
  assert.equal(ephem.fmtNumber(457180), '457,180')
})

test('buildSnapshot 组合距地 / 距 L2 / DSN', () => {
  const roman = ephem.pickClosest(ephem.parseHorizonsVectors(HORIZONS_FIXTURE), Date.UTC(2026, 8, 2, 15, 15, 11))
  const l2 = ephem.pickClosest(ephem.parseHorizonsVectors(L2_FIXTURE), Date.UTC(2026, 8, 2, 15, 15, 11))
  const dsn = ephem.parseDsnRst(DSN_FIXTURE, 'RST')
  const snap = ephem.buildSnapshot({
    nowMs: Date.parse('2026-09-02T15:15:11.000Z'),
    launchMs: Date.parse('2026-08-30T11:26:04.000Z'),
    roman,
    l2,
    dsn,
    phase: 'cruise',
    source: 'horizons'
  })
  assert.equal(snap.ok, true)
  assert.equal(snap.distanceFromEarthKm, 457180)
  assert.ok(snap.distanceToL2Km > 1000000 && snap.distanceToL2Km < 1200000)
  assert.ok(snap.velocityKmh > 3500 && snap.velocityKmh < 4000)
  assert.equal(snap.progressPct, 30)
  assert.match(snap.dsnLine, /DSS34/)
})

test('径向速率与往返光延时', () => {
  const away = ephem.fmtRangeRate(1.0215)
  assert.equal(away.dir, '远离地球')
  assert.ok(away.signedKmh > 3600)
  const toward = ephem.fmtRangeRate(-0.5)
  assert.equal(toward.dir, '接近地球')
  assert.equal(ephem.roundTripLight(1.525), '3 秒')
  assert.equal(ephem.roundTripLight(-1), '')
  assert.match(
    ephem.cruiseRemainLabel({ cruiseEndUtcIso: '2026-11-28T00:00:00.000Z' }, Date.parse('2026-09-03T00:00:00.000Z')),
    /天后抵达 L2/
  )
})

test('buildSnapshot 含地心矢量', () => {
  const roman = ephem.pickClosest(ephem.parseHorizonsVectors(HORIZONS_FIXTURE), Date.UTC(2026, 8, 2, 15, 15, 11))
  const snap = ephem.buildSnapshot({
    nowMs: Date.parse('2026-09-02T15:15:11.000Z'),
    launchMs: Date.parse('2026-08-30T11:26:04.000Z'),
    roman,
    l2: null,
    phase: 'cruise',
    source: 'horizons'
  })
  assert.ok(snap.posKm)
  assert.equal(snap.posKm.x, Math.round(roman.pos.x))
  assert.ok(snap.speedKmS > 1 && snap.speedKmS < 1.1)
})

test('NASA 发射商详情：罗曼卡片在 Artemis 上方且复用组件', () => {
  const wxml = fs.readFileSync(
    path.join(__dirname, '../subpackages/monitor-pages/agency-detail.wxml'),
    'utf8'
  )
  const roman = wxml.indexOf('monitor-roman-card')
  const artemis = wxml.indexOf('monitor-artemis-card')
  assert.ok(roman > 0, '应包含罗曼卡片组件')
  assert.ok(artemis > roman, '罗曼区块应在 Artemis 卡片上方')
  assert.match(wxml, /scene="agency"/)
  const js = fs.readFileSync(
    path.join(__dirname, '../subpackages/monitor-pages/agency-detail.js'),
    'utf8'
  )
  assert.match(js, /_initRomanSection/)
  assert.match(js, /shouldShowRomanSection/)
  assert.match(js, /_initArtemisSection/)
  assert.doesNotMatch(js, /fetchRomanBriefing/)
  assert.doesNotMatch(js, /fetchArtemisIiBriefing/)
  assert.doesNotMatch(js, /gateCheck\('roman/)
  const json = JSON.parse(fs.readFileSync(
    path.join(__dirname, '../subpackages/monitor-pages/agency-detail.json'),
    'utf8'
  ))
  assert.ok(json.usingComponents['monitor-artemis-card'])
  const cardJs = fs.readFileSync(
    path.join(__dirname, '../subpackages/monitor-pages/components/monitor-roman-card/index.js'),
    'utf8'
  )
  assert.match(cardJs, /shouldShowRomanOnMonitor/)
  assert.match(cardJs, /phase === 'ended'/)
  assert.match(cardJs, /GATE_PRODUCT_ID = 'roman_tracker'/)
  assert.match(cardJs, /gateCheck\(GATE_PRODUCT_ID/)
  assert.doesNotMatch(cardJs, /allowAd:\s*false/)
  assert.match(cardJs, /ROUTES\.ROMAN_DETAIL/)
  const artemisJs = fs.readFileSync(
    path.join(__dirname, '../subpackages/monitor-pages/components/monitor-artemis-card/index.js'),
    'utf8'
  )
  assert.match(artemisJs, /gateCheck\('artemis_telemetry'/)
  assert.match(artemisJs, /ROUTES\.ARTEMIS_DETAIL/)
})

test('监控页：罗曼卡在轨道数据中心上方，结束后自动隐藏', () => {
  const wxml = fs.readFileSync(path.join(__dirname, '../pages/monitor/monitor.wxml'), 'utf8')
  const roman = wxml.indexOf('monitor-roman-card')
  const orbital = wxml.indexOf('monitor-orbital-card')
  assert.ok(roman > 0)
  assert.ok(orbital > roman, '罗曼卡应在太空轨道数据中心上方')
  assert.match(wxml, /scene="monitor"/)
  const json = JSON.parse(fs.readFileSync(path.join(__dirname, '../pages/monitor/monitor.json'), 'utf8'))
  assert.ok(json.usingComponents['monitor-roman-card'])
  const cardJs = fs.readFileSync(
    path.join(__dirname, '../subpackages/monitor-pages/components/monitor-roman-card/index.js'),
    'utf8'
  )
  assert.match(cardJs, /shouldShowRomanOnMonitor/)
  assert.match(cardJs, /pageLifetimes/)
})

test('罗曼详情页：路由、分享免门控窗口、图片体积', () => {
  const appJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../app.json'), 'utf8'))
  const monitor = appJson.subPackages.find((p) => p.name === 'monitor-pages')
  assert.ok(monitor.pages.includes('roman-detail'))
  const routes = fs.readFileSync(path.join(__dirname, '../utils/routes.js'), 'utf8')
  assert.match(routes, /ROMAN_DETAIL:\s*'\/subpackages\/monitor-pages\/roman-detail'/)
  const pageJs = fs.readFileSync(
    path.join(__dirname, '../subpackages/monitor-pages/roman-detail.js'),
    'utf8'
  )
  const pageWxml = fs.readFileSync(
    path.join(__dirname, '../subpackages/monitor-pages/roman-detail.wxml'),
    'utf8'
  )
  assert.match(pageJs, /onShareAppMessage/)
  assert.match(pageJs, /onShareTimeline/)
  assert.match(pageJs, /SHARE_IMAGE = '\/subpackages\/monitor-pages\/images\/roman\/roman-share\.jpg'/)
  assert.match(pageJs, /imageUrl:\s*SHARE_IMAGE/)
  assert.match(pageWxml, /\/subpackages\/monitor-pages\/images\/roman\/roman-craft\.png/)
  assert.match(pageJs, /path:\s*withShareStampPath\(SHARE_PATH/)
  assert.match(pageJs, /checkShareEntryGate/)
  assert.match(pageJs, /GATE_PRODUCT_ID = 'roman_tracker'/)
  assert.match(pageWxml, /share-gate-countdown/)
  assert.doesNotMatch(pageWxml, /分享给好友|朋友圈请点右上角|open-type="share"/)
  assert.match(pageWxml, /page-meta/)
  assert.match(pageWxml, /pageBgColor/)
  assert.match(pageWxml, /glass-card/)
  assert.doesNotMatch(pageWxml, /roman-hero-glow|roman-hud/)
  const pageWxss = fs.readFileSync(
    path.join(__dirname, '../subpackages/monitor-pages/roman-detail.wxss'),
    'utf8'
  )
  assert.match(pageWxss, /--color-bg-page/)
  assert.match(pageWxss, /--bg-glass/)
  assert.match(pageWxss, /--color-text-primary/)
  assert.match(pageWxss, /\.detail-page\.theme-light/)
  assert.match(pageWxss, /\.theme-light \.roman-met-value/)
  assert.match(pageWxss, /\.theme-light \.roman-kv-row/)
  assert.match(pageWxss, /\.theme-light \.roman-action/)
  assert.match(pageWxss, /\.theme-light \.roman-chip--l2/)
  assert.doesNotMatch(pageWxss, /#07060d|#6B21A8|#A855F7|#E879F9|#F5F3FF/)
  const cardWxss = fs.readFileSync(
    path.join(__dirname, '../subpackages/monitor-pages/components/monitor-roman-card/index.wxss'),
    'utf8'
  )
  assert.doesNotMatch(cardWxss, /#6B21A8|#A855F7|#E879F9|#7C3AED/)
  const agencyWxss = fs.readFileSync(
    path.join(__dirname, '../subpackages/monitor-pages/agency-detail.wxss'),
    'utf8'
  )
  assert.doesNotMatch(agencyWxss, /#6B21A8|#A855F7|#E879F9|#7C3AED/)
  const craft = fs.readFileSync(path.join(__dirname, '../subpackages/monitor-pages/images/roman/roman-craft.png'))
  const share = fs.readFileSync(path.join(__dirname, '../subpackages/monitor-pages/images/roman/roman-share.jpg'))
  const cardBg = fs.readFileSync(path.join(__dirname, '../subpackages/monitor-pages/images/roman/roman-card-bg.jpg'))
  assert.ok(craft.length < 80 * 1024, 'craft 文件应远小于 200KB')
  assert.ok(share.length < 80 * 1024, 'share 文件应远小于 200KB')
  assert.ok(cardBg.length < 20 * 1024, '监控卡背景仅留压缩预览，大图走 COS')
  assert.equal(craft.readUInt32BE(16) * craft.readUInt32BE(20) * 4 < 200 * 1024, true)
})
