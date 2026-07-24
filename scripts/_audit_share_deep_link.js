/**
 * 分享直达详情审计：详情页 / 分区分享不得默认落到 Tab；
 * 数据未就绪时优先用入口 id 拼详情 path。
 * exit 0 = 全亮绿灯
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
process.chdir(ROOT)

const bugs = []
const oks = []

function assert(name, cond, detail) {
  if (cond) {
    oks.push(name)
    console.log('OK  ', name)
  } else {
    const msg = name + (detail ? ': ' + detail : '')
    bugs.push(msg)
    console.log('FAIL', msg)
  }
}

function read(p) {
  return fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
}

function methodBody(src, name) {
  // Page 方法：`  onShareAppMessage() {` / `  async onLoad(options) {`
  const reObj = new RegExp(`(?:^|\\n)(  (?:async\\s+)?${name}\\s*\\([^)]*\\)\\s*\\{)`)
  // 对象属性：`  onShareAppMessage: function () {`
  const reColon = new RegExp(
    `(?:^|\\n)(  ${name}\\s*:\\s*(?:async\\s+)?function\\s*\\([^)]*\\)\\s*\\{)`
  )
  const m = src.match(reObj) || src.match(reColon)
  if (!m) return ''
  const start = m.index + (m[0].startsWith('\n') ? 1 : 0)
  const brace = src.indexOf('{', start)
  let depth = 0
  for (let i = brace; i < src.length; i++) {
    const c = src[i]
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return src.slice(start, i + 1)
    } else if (c === '"' || c === "'" || c === '`') {
      const q = c
      i++
      while (i < src.length) {
        if (src[i] === '\\') { i += 2; continue }
        if (src[i] === q) break
        i++
      }
    }
  }
  return ''
}

function section(title) {
  console.log('\n===== ' + title + ' =====')
}

section('1. 星链过境详情')
{
  const src = read('subpackages/monitor-pages/starlink-pass-detail.js')
  const share = methodBody(src, 'onShareAppMessage')
  const onLoad = methodBody(src, 'onLoad')
  assert('分享 path 指向 STARLINK_PASS_DETAIL / 本页', /STARLINK_PASS_DETAIL|starlink-pass-detail/.test(share))
  assert('分享 path 不再写死监控 Tab', !/path:\s*['"]\/pages\/monitor\/monitor['"]/.test(share) && !/['"]\/pages\/monitor\/monitor['"]/.test(share))
  assert('冷启动无数据不再自动 switchTab', !/switchTab[\s\S]{0,120}\/pages\/monitor\/monitor/.test(onLoad))
  assert('冷启动保留 shareLandingEmpty 空态', /shareLandingEmpty:\s*true/.test(onLoad))
  assert('空态读取 options.count 预览', /sharePreviewCount/.test(onLoad) && /options\.count/.test(onLoad))
}

section('2. 飞行剖面演示')
{
  const src = read('subpackages/mission-sim/flight-demo.js')
  const share = methodBody(src, 'onShareAppMessage')
  const onLoad = methodBody(src, 'onLoad')
  const open = methodBody(read('pages/mission-detail/mission-detail.js'), 'openFlightDemo')
  assert('分享 path 指向 flight-demo 本页', /_sharePath/.test(share) && /flight-demo/.test(src))
  assert('分享不再落到任务详情 buildMissionDetailUrl', !/buildMissionDetailUrl/.test(src))
  assert('分享不再落到进度 Tab', !/\/pages\/progress\/progress/.test(share))
  assert('冷启动可按 id 拉时间线', /_loadTimelineByMissionId|fetchLl2LaunchTimeline/.test(src))
  assert('分享门控 checkShareEntryGate', /checkShareEntryGate/.test(onLoad))
  assert('_sharePath 拼本页+id', /flight-demo/.test(methodBody(src, '_sharePath')))
  assert('openFlightDemo URL 带 id', /id=\$\{encodeURIComponent\(missionId\)\}/.test(open))
  assert('openFlightDemo eventChannel 带 id', /flightDemoContext[\s\S]{0,200}id:\s*missionId/.test(open))
}

section('2b. 星链观测地图 pass-map')
{
  const src = read('subpackages/monitor-pages/pass-map.js')
  const share = methodBody(src, 'onShareAppMessage')
  const tl = methodBody(src, 'onShareTimeline')
  assert('pass-map 分享落到 STARLINK_PASS_DETAIL', /STARLINK_PASS_DETAIL/.test(share) || /_passSharePath/.test(share))
  assert('pass-map 分享不再直落 pass-map 空 path', !/path:\s*['"]\/subpackages\/monitor-pages\/pass-map['"]/.test(share))
  assert('pass-map Timeline 带 count 或空 query', /count=/.test(tl) || /query:/.test(tl))
}

section('3. 监控中心分区分享')
{
  const src = read('pages/monitor/monitor.js')
  const share = methodBody(src, 'onShareAppMessage')
  const wxml = read('pages/monitor/monitor.wxml')
  const gal = read('subpackages/monitor-pages/components/monitor-galleries/index.wxml')
  const orbit = read('subpackages/monitor-pages/components/monitor-orbit-events/index.wxml')
  assert('orbit → event-detail ll2_event', /type === ['"]orbit['"][\s\S]{0,800}EVENT_DETAIL|mode=ll2_event/.test(share))
  assert('station → STATION_DETAIL', /type === ['"]station['"][\s\S]{0,800}STATION_DETAIL/.test(share))
  assert('starlink → STARLINK_FULLSCREEN', /type === ['"]starlink['"][\s\S]{0,400}STARLINK_FULLSCREEN/.test(share))
  assert('pass → STARLINK_PASS_DETAIL', /type === ['"]pass['"][\s\S]{0,500}STARLINK_PASS_DETAIL/.test(share))
  assert('图鉴四板块无分享按钮', !/data-share-type="agency"/.test(gal) && !/data-share-type="booster"/.test(gal) && !/data-share-type="spacecraft"/.test(gal) && !/data-share-type="launchSite"/.test(gal))
  assert('图鉴分享分支已移除', !/type === ['"]agency['"]/.test(share) && !/type === ['"]booster['"]/.test(share) && !/type === ['"]spacecraft['"]/.test(share) && !/type === ['"]launchSite['"]/.test(share))
  assert('orbit 有 first.id 时拼详情', /first\.id[\s\S]{0,300}(event-detail|EVENT_DETAIL)/.test(share))
  assert('station 有 first.id 时拼详情', /first\.id[\s\S]{0,300}STATION_DETAIL/.test(share))
  assert('分享类型兜底 _pendingShareType', /_pendingShareType/.test(share))
  assert('页面分享按钮有 markPendingShareType', /markPendingShareType/.test(wxml) && /markPendingShareType/.test(src))
  assert('在轨任务分享按钮有 markShareOrbit', /markShareOrbit/.test(orbit))
}

section('4. 发射详情 fallback')
{
  const src = read('pages/mission-detail/mission-detail.js')
  const share = methodBody(src, 'onShareAppMessage')
  const tl = methodBody(src, 'onShareTimeline')
  assert('用 _entryRoute / missionId 兜底', /_entryRoute/.test(share) && /missionId/.test(share))
  assert('无 mission 但有 id → buildMissionDetailUrl', /!mission[\s\S]{0,500}buildMissionDetailUrl/.test(share))
  assert('仅无 id 时才允许首页兜底', /if\s*\(\s*!missionId\s*\)[\s\S]{0,250}\/pages\/index\/index/.test(share))
  assert('Timeline 可用 shareMission 兜底 id', /shareMission/.test(tl) && /missionId/.test(tl))
}

section('5. 事件更新详情 fallback')
{
  const src = read('subpackages/progress-extra/event-detail.js')
  const share = methodBody(src, 'onShareAppMessage')
  const tl = methodBody(src, 'onShareTimeline')
  assert('单条用 _singleItemId 兜底', /_singleItemId/.test(share))
  assert('button 有 dataset.id 时拼详情', /buttonId[\s\S]{0,250}event-detail\?id=/.test(share))
  assert('Timeline 用 entryId/_singleItemId', /_singleItemId/.test(tl) && /entryId/.test(tl))
}

section('6. 新闻详情 fallback')
{
  const src = read('subpackages/news-extra/detail.js')
  const share = methodBody(src, 'onShareAppMessage')
  assert('用 _entryRoute 兜底', /_entryRoute/.test(share))
  assert('有 entryId 拼 news-extra/detail', /entryId[\s\S]{0,250}news-extra\/detail/.test(share))
  assert('仅无 entryId 才允许新闻 Tab', /if\s*\(\s*!entryId\s*\)[\s\S]{0,250}\/pages\/news\/news/.test(share))
}

section('7. 空间站 / 发射商 / 助推器 fallback')
{
  const station = read('subpackages/monitor-pages/station-detail.js')
  const agency = read('subpackages/monitor-pages/agency-detail.js')
  const booster = read('subpackages/monitor-pages/booster-detail.js')
  const sShare = methodBody(station, 'onShareAppMessage')
  const aShare = methodBody(agency, 'onShareAppMessage')
  const bShare = methodBody(booster, 'onShareAppMessage')
  assert('station 用 _stationId 兜底', /_stationId/.test(sShare))
  assert('agency 用 _agencyId 兜底', /_agencyId/.test(aShare))
  assert('agency onLoad 写入 _agencyId', /this\._agencyId\s*=\s*id/.test(agency))
  assert('agency loadDetail 写入 resolved.id', /this\._agencyId\s*=\s*resolved\.id/.test(agency))
  assert('booster 用 _serial 兜底', /_serial/.test(bShare))
}

section('8. 在轨飞行器追踪（回归）')
{
  const src = read('subpackages/monitor-pages/vehicle-tracker/vehicle-tracker.js')
  const share = methodBody(src, 'onShareAppMessage')
  assert('分享 path 指向 vehicle-tracker', /vehicle-tracker\/vehicle-tracker/.test(share))
  assert('不落到 Tab', !/\/pages\/(monitor|progress|index)\//.test(share))
}

section('9. 禁止复现：详情页故意落 Tab')
{
  const pass = methodBody(read('subpackages/monitor-pages/starlink-pass-detail.js'), 'onShareAppMessage')
  const demoSrc = read('subpackages/mission-sim/flight-demo.js')
  const demo = methodBody(demoSrc, 'onShareAppMessage')
  const demoPath = methodBody(demoSrc, '_sharePath')
  assert('pass-detail 无监控 Tab 硬编码 path', !/['"]\/pages\/monitor\/monitor['"]/.test(pass))
  assert('flight-demo 分享不落进度 Tab', !/['"]\/pages\/progress\/progress['"]/.test(demo + demoPath))
  assert('flight-demo 分享走本页 flight-demo', /flight-demo/.test(demoPath) && /_sharePath/.test(demo))
}

section('10. 设计如此（白名单仍可落 Tab）')
{
  const invite = methodBody(read('subpackages/profile-extra/invite/invite.js'), 'onShareAppMessage')
  const profile = methodBody(read('pages/profile/profile.js'), 'onShareAppMessage')
  const progress = methodBody(read('pages/progress/progress.js'), 'onShareAppMessage')
  assert('邀请页仍落首页带 inviter', /\/pages\/index\/index/.test(invite))
  assert('个人中心默认仍可落首页', /\/pages\/index\/index/.test(profile))
  assert('进度 Tab 默认分享仍为本 Tab', /\/pages\/progress\/progress/.test(progress))
}

section('11. 语法可解析')
{
  const acorn = require('acorn')
  const files = [
    'subpackages/monitor-pages/starlink-pass-detail.js',
    'subpackages/mission-sim/flight-demo.js',
    'pages/monitor/monitor.js',
    'pages/mission-detail/mission-detail.js',
    'subpackages/progress-extra/event-detail.js',
    'subpackages/news-extra/detail.js',
    'subpackages/monitor-pages/station-detail.js',
    'subpackages/monitor-pages/agency-detail.js',
    'subpackages/monitor-pages/booster-detail.js',
    'subpackages/monitor-pages/pass-map.js',
    'subpackages/monitor-pages/vehicle-tracker/vehicle-tracker.js'
  ]
  for (const f of files) {
    try {
      acorn.parse(read(f), { ecmaVersion: 2020, sourceType: 'script' })
      assert(f + ' 可解析', true)
    } catch (err) {
      assert(f + ' 可解析', false, err.message)
    }
  }
}

console.log('\n===== 汇总 =====')
console.log('PASS', oks.length)
console.log('FAIL', bugs.length)
if (bugs.length) {
  console.log('FAILED:')
  bugs.forEach((b) => console.log(' -', b))
  process.exit(1)
}
console.log('ALL GREEN')
process.exit(0)
