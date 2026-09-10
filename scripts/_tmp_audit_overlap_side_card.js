/**
 * 重叠窗口副卡审计：接线 / 状态机 / 视图 / 预览开关 / 单测
 * 用法: node scripts/_tmp_audit_overlap_side_card.js
 * exit 0 = 全亮绿灯
 */
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const root = path.join(__dirname, '..')
let pass = 0
let fail = 0

function ok(name, cond, detail) {
  if (cond) {
    pass++
    console.log('PASS  ' + name + (detail ? '  — ' + detail : ''))
  } else {
    fail++
    console.log('FAIL  ' + name + (detail ? '  — ' + detail : ''))
  }
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n')
}

function hasMethod(src, name) {
  return new RegExp(
    `(?:^|\\n)\\s*(?:async\\s+)?${name}\\s*\\([^)]*\\)\\s*\\{`,
    'm'
  ).test(src)
}

const FILES = [
  'utils/countdown-window-machine.js',
  'utils/index-launch-state.js',
  'pages/index/index.js',
  'pages/index/index.wxml',
  'pages/index/index.wxss',
  'subpackages/index-extra/utils/index-live-settle.js',
  'test/countdown-window-machine.test.js'
]

console.log('===== A. 语法 =====')
for (const rel of FILES.filter((f) => f.endsWith('.js'))) {
  try {
    execSync(`node --check "${path.join(root, rel)}"`, { stdio: 'pipe' })
    ok('syntax ' + rel, true)
  } catch (e) {
    ok('syntax ' + rel, false, (e.stderr && e.stderr.toString().split('\n')[0]) || e.message)
  }
}

const machine = read('utils/countdown-window-machine.js')
const launchState = read('utils/index-launch-state.js')
const indexJs = read('pages/index/index.js')
const wxml = read('pages/index/index.wxml')
const wxss = read('pages/index/index.wxss')
const liveSettle = read('subpackages/index-extra/utils/index-live-settle.js')
const testSrc = read('test/countdown-window-machine.test.js')

console.log('\n===== B. 状态机 API =====')
ok('export resolveOverlapSideMission', /resolveOverlapSideMission/.test(machine) && /module\.exports[\s\S]*resolveOverlapSideMission/.test(machine))
ok('export getMissionWindowInterval', /function getMissionWindowInterval/.test(machine) && /getMissionWindowInterval/.test(machine.split('module.exports')[1] || ''))
ok('export windowsOverlap', /function windowsOverlap/.test(machine) && /windowsOverlap/.test(machine.split('module.exports')[1] || ''))
ok('pickOverlapSideCard exported', /function pickOverlapSideCard/.test(launchState) && /pickOverlapSideCard/.test(launchState.split('module.exports')[1] || ''))
ok('buildOverlapSideCardView exported', /function buildOverlapSideCardView/.test(launchState) && /buildOverlapSideCardView/.test(launchState.split('module.exports')[1] || ''))
ok('empty/error clear overlapSideCard', /overlapSideCard:\s*null/.test(launchState) && (launchState.match(/overlapSideCard:\s*null/g) || []).length >= 2)

console.log('\n===== C. 首页接线 =====')
ok('import pickOverlapSideCard', /pickOverlapSideCard/.test(indexJs))
ok('no TEMP force preview', !/TEMP_FORCE_COUNTDOWN_SIDE_CARD/.test(indexJs) && !/TEMP_SIDE_CARD_PREVIEW/.test(indexJs))
ok('data.overlapSideCard init null', /overlapSideCard:\s*null/.test(indexJs))
ok('method _buildOverlapSideCardState', hasMethod(indexJs, '_buildOverlapSideCardState'))
ok('method _buildOverlapSideCardPatch', hasMethod(indexJs, '_buildOverlapSideCardPatch'))
ok('method _syncCountdownOverlapSideCard', hasMethod(indexJs, '_syncCountdownOverlapSideCard'))
ok('method onOverlapSideCardTap', hasMethod(indexJs, 'onOverlapSideCardTap'))
ok('updateCountdown merges side patch', /sideCardPatch\s*=\s*this\._buildOverlapSideCardPatch\(\)/.test(indexJs) && /\.\.\.sideCardPatch/.test(indexJs))
ok('applyInitial syncs side', /_applyInitialUpcomingLaunchStateSync[\s\S]*?_syncCountdownOverlapSideCard/.test(indexJs))
ok(
  'switchToNext syncs side',
  /switchToNextUpcomingMission\([\s\S]*?_syncCountdownOverlapSideCard[\s\S]*?_switchingCountdown\s*=\s*false/.test(indexJs)
)
ok(
  'agency enrich syncs side',
  /_patchUpcomingListAfterAgencyEnrich\([\s\S]*?_syncCountdownOverlapSideCard/.test(indexJs)
)
ok('scrub syncs side', /_scrubKnownSettleableCountdown\([\s\S]*?_syncCountdownOverlapSideCard/.test(liveSettle))
ok('refilter syncs side', /_refilterUpcomingAgainstSettled\([\s\S]*?_syncCountdownOverlapSideCard/.test(liveSettle))
ok('tap → viewMissionDetail', /onOverlapSideCardTap\(e\)\s*\{[\s\S]{0,120}viewMissionDetail\(e\)/.test(indexJs))
ok('pickOverlapSideCard never forceNext', /forceNext:\s*false/.test(launchState) && !/forceNext:\s*TEMP_/.test(indexJs))
ok('page does not pass forceNext', !/forceNext\s*:/.test(indexJs))

console.log('\n===== D. WXML / WXSS =====')
ok('wxml side card block', /countdown-side-card/.test(wxml) && /overlapSideCard/.test(wxml))
ok('wxml bindtap wired', /bindtap="onOverlapSideCardTap"/.test(wxml))
ok('wxml upcoming gate', /missionType === 'upcoming' && overlapSideCard/.test(wxml))
ok(
  'wxml status always shown',
  /countdown-side-status/.test(wxml) &&
    !/countdown-side-status"[^>]*wx:if="\{\{overlapSideCard\.isExpired\}\}"/.test(wxml) &&
    /overlapSideCard\.statusTextZh/.test(wxml)
)
ok('wxml label from data', /overlapSideCard\.label/.test(wxml))
ok('wxss side card styles', /\.countdown-side-card\s*\{/.test(wxss) && /\.countdown-side-name\s*\{/.test(wxss))
ok('wxss light theme', /\.theme-light\s+\.countdown-side-card\s*\{/.test(wxss))
ok('wxss compact (no min-height inflate)', !/\.countdown-side-card[\s\S]{0,200}min-height:\s*[3-9]\d{2}rpx/.test(wxss))
ok('wxss countdown enlarged', /\.countdown-side-cd\s*\{[\s\S]*?font-size:\s*3[2-9]rpx/.test(wxss))

console.log('\n===== E. 运行时选型 =====')
// util.js → icon-cache 依赖 wx；审计里只 stub 最小环境
global.wx = global.wx || {
  env: { USER_DATA_PATH: '/tmp' },
  getFileSystemManager: () => ({
    accessSync() {},
    mkdirSync() {},
    readFileSync() { return '' },
    writeFileSync() {},
    unlinkSync() {}
  }),
  getStorageSync() { return '' },
  setStorageSync() {}
}
const wm = require(path.join(root, 'utils/countdown-window-machine.js'))
const ils = require(path.join(root, 'utils/index-launch-state.js'))

function getCountdownStub(targetTime) {
  const target = new Date(targetTime).getTime()
  const diff = target - Date.now()
  if (!Number.isFinite(target) || diff <= 0) {
    return { days: 0, hours: 0, minutes: 0, seconds: 0, total: 0, isExpired: true }
  }
  return {
    days: Math.floor(diff / 86400000),
    hours: Math.floor((diff % 86400000) / 3600000),
    minutes: Math.floor((diff % 3600000) / 60000),
    seconds: Math.floor((diff % 60000) / 1000),
    total: diff,
    isExpired: false
  }
}

const a = {
  id: 'a',
  launchTime: '2026-07-22T02:50:00Z',
  windowEnd: '2026-07-22T04:00:00Z',
  statusId: 1,
  missionName: 'Mission A',
  rocketName: 'Falcon 9'
}
const b = {
  id: 'b',
  launchTime: '2026-07-22T03:20:00Z',
  windowEnd: '2026-07-22T04:30:00Z',
  statusId: 1,
  missionName: 'Mission B',
  rocketName: 'Falcon 9',
  launchAgency: 'SpaceX'
}
const far = {
  id: 'far',
  launchTime: '2026-07-23T10:00:00Z',
  windowEnd: '2026-07-23T10:30:00Z',
  statusId: 1,
  missionName: 'Far'
}
ok('overlap picks b', wm.resolveOverlapSideMission([a, b, far], { panelMissionId: 'a' })?.id === 'b')
ok('no-overlap → null', wm.resolveOverlapSideMission([a, far], { panelMissionId: 'a' }) === null)
ok('forceNext API still works (test-only)', wm.resolveOverlapSideMission([a, far], { panelMissionId: 'a', forceNext: true })?.id === 'far')
ok('settled skip', wm.resolveOverlapSideMission(
  [a, { ...b, id: 'done', statusId: 3 }, { ...b, id: 'c' }],
  { panelMissionId: 'a' }
)?.id === 'c')
const cOverlap = {
  id: 'c',
  launchTime: '2026-07-22T04:00:00Z',
  windowEnd: '2026-07-22T05:00:00Z',
  statusId: 1
}
ok(
  'queue after promote: B main → side C',
  wm.resolveOverlapSideMission([b, cOverlap, far], { panelMissionId: 'b' })?.id === 'c'
)
ok(
  'queue after promote: no overlap → hide',
  wm.resolveOverlapSideMission([b, far], { panelMissionId: 'b' }) === null
)

const view = ils.pickOverlapSideCard([a, b], {
  panelMissionId: 'a',
  getCountdown: getCountdownStub,
  getStatusTextZh: () => '就绪'
})
ok('view has compact fields', !!(view && view.id === 'b' && view.countdownText && view.label === '相邻发射窗口'))
ok('view formatOverlapSideCountdownText expired', ils.formatOverlapSideCountdownText({ isExpired: true }) === '确认中')
ok(
  'view format with days',
  ils.formatOverlapSideCountdownText({ days: 2, hours: 3, minutes: 4, seconds: 5, isExpired: false }) ===
    '2天 03:04:05'
)

console.log('\n===== F. 单测 =====')
try {
  const out = execSync('node --test test/countdown-window-machine.test.js', {
    cwd: root,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe']
  })
  const passLine = (out.match(/info pass (\d+)/i) || out.match(/✔/g) || [])
  const failLine = out.match(/info fail (\d+)/i) || out.match(/✖/g)
  const failed = /fail\s+[1-9]/i.test(out) || (failLine && Array.isArray(failLine) && failLine.length && !/info fail 0/i.test(out))
  // node --test summary
  const mPass = out.match(/ℹ pass (\d+)/)
  const mFail = out.match(/ℹ fail (\d+)/)
  const nPass = mPass ? Number(mPass[1]) : (out.match(/✔/g) || []).length
  const nFail = mFail ? Number(mFail[1]) : 0
  ok('unit tests pass', nFail === 0 && nPass >= 24, `pass=${nPass} fail=${nFail}`)
  ok('unit covers resolveOverlapSideMission', /resolveOverlapSideMission/.test(testSrc) && /主卡换人后按新主卡再排队/.test(testSrc))
} catch (e) {
  ok('unit tests pass', false, (e.stdout || e.message || '').toString().slice(0, 200))
}

console.log('\n===== G. 产品规则 =====')
ok(
  'rule file present',
  fs.existsSync(path.join(root, '.cursor/rules/countdown-overlap-side-card.mdc'))
)
ok(
  'wxml comment: overlap-only queue',
  /仅与主卡窗口相交时显示/.test(wxml) && /无重叠则隐藏/.test(wxml)
)

console.log('\n===== SUMMARY =====')
console.log(`PASS ${pass}  FAIL ${fail}`)
if (fail === 0) {
  console.log('ALL_GREEN')
  process.exit(0)
}
console.log('HAS_FAILURES')
process.exit(1)
