/**
 * 终态身份不得冻死：航行警告占位必须能被 LL2 事后更正覆盖。
 * 本轮审计执行真实函数，不只做字符串存在检查。
 * node scripts/_tmp_audit_launch_identity_upgrade.js
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

const ident = require(path.join(ROOT, 'cloudfunctions/syncSpaceDevsData/launch-identity-upgrade.js'))
const identLl2 = require(path.join(ROOT, 'cloudfunctions/ll2Query/launch-identity-upgrade.js'))
const {
  applyLaunchIdentityUpgrade,
  hasWeakLaunchIdentity,
  isGenericMissionTitle,
  shouldUpgradeLaunchIdentity,
  shouldRefreshCachedLaunchIdentity,
  mergeLaunchSourcesForStub
} = ident
const { pickLl2AlignedRocketName } = require(path.join(ROOT, 'utils/mission-list-card.js'))
function getRocketDisplayNameFromLaunch(launch) {
  const configuration =
    (launch && launch.rocket && launch.rocket.configuration) ||
    (launch && launch.rocket && launch.rocket.rocket && launch.rocket.rocket.configuration)
  const fromCfg = configuration && (configuration.name || configuration.full_name)
  return pickLl2AlignedRocketName(fromCfg, launch && launch.name) || fromCfg || ''
}
const { stripWeakerIdentityPatch, isIncompleteCompletedListCard } = require(path.join(
  ROOT,
  'utils/mission-list-card.js'
))
const { pickBetterRocketName, isGenericMissionTitle: cardGeneric } = require(path.join(
  ROOT,
  'utils/launch-card-i18n.js'
))

const YAO = '95eb9265-bdbe-43ad-b08c-6be7eb4e58f4'
function placeholderRow() {
  return {
    id: YAO,
    name: 'Long March 2D | Unknown Payload',
    net: '2026-09-10T09:00:00Z',
    status: { id: 3, abbrev: 'Success' },
    mission: { name: 'Unknown Payload' },
    rocket: { configuration: { id: 64, name: 'Long March 2D', full_name: 'Long March 2D/Yuanzheng-3' } },
    pad: { name: 'Launch Area 94', location: { name: 'Jiuquan' } }
  }
}
function liveRow() {
  return {
    id: YAO,
    name: 'Long March 4B | Yaogan 53-01 to 03/56-01 to 03',
    net: '2026-09-10T09:00:00Z',
    status: { id: 3, abbrev: 'Success' },
    mission: {
      name: 'Yaogan 53-01 to 03/56-01 to 03',
      type: 'Government/Top Secret',
      orbit: { id: 8, name: 'Low Earth Orbit', abbrev: 'LEO' }
    },
    rocket: { configuration: { id: 10, name: 'Long March 4B', full_name: 'Long March 4B' } }
  }
}

console.log('=== launch identity audit ===\n')

const identSrc = read('cloudfunctions/syncSpaceDevsData/launch-identity-upgrade.js')
const identLl2Src = read('cloudfunctions/ll2Query/launch-identity-upgrade.js')
check(
  '双副本身份模块一致',
  identSrc.replace(/\r\n/g, '\n') === identLl2Src.replace(/\r\n/g, '\n')
)

const full = placeholderRow()
const upFull = applyLaunchIdentityUpgrade(full, liveRow(), { trustIncoming: true })
check(
  '完整 LL2 行覆盖二号丁+Unknown Payload',
  upFull.changed &&
    full.rocket.configuration.name === 'Long March 4B' &&
    full.mission.name.indexOf('Yaogan') === 0 &&
    full.mission.orbit.abbrev === 'LEO'
)

const titleOnly = placeholderRow()
applyLaunchIdentityUpgrade(
  titleOnly,
  { id: YAO, name: 'Long March 4B | Yaogan 53-01 to 03/56-01 to 03' },
  { trustIncoming: true }
)
check(
  '仅有 name 的 hourly/launch_status 路径也改 configuration',
  titleOnly.rocket.configuration.name === 'Long March 4B' &&
    titleOnly.mission.name.indexOf('Yaogan') === 0,
  `rocket=${titleOnly.rocket.configuration.name} mission=${titleOnly.mission.name}`
)
check(
  '升级后列表映射不再读出二号丁',
  getRocketDisplayNameFromLaunch(titleOnly).indexOf('Long March 4B') === 0,
  getRocketDisplayNameFromLaunch(titleOnly)
)

const staleCfg = placeholderRow()
applyLaunchIdentityUpgrade(
  staleCfg,
  {
    id: YAO,
    name: 'Long March 4B | Yaogan 53-01 to 03/56-01 to 03',
    mission: { name: 'Unknown Payload' },
    rocket: { configuration: { name: 'Long March 2D' } }
  },
  { trustIncoming: true }
)
check(
  'title 已更正但 mission/cfg 仍占位时按 title 升级',
  staleCfg.rocket.configuration.name === 'Long March 4B' &&
    staleCfg.mission.name.indexOf('Yaogan') === 0,
  `rocket=${staleCfg.rocket.configuration.name} mission=${staleCfg.mission.name}`
)

const keep = liveRow()
applyLaunchIdentityUpgrade(keep, placeholderRow(), { trustIncoming: false })
check(
  '未信任 upcoming 占位不得打回已公布身份',
  keep.rocket.configuration.name === 'Long March 4B' && keep.mission.name.indexOf('Yaogan') === 0
)

const merged = mergeLaunchSourcesForStub(placeholderRow(), liveRow())
check(
  'attach stub 合并 live 更好身份',
  merged.rocket.configuration.name === 'Long March 4B' && merged.pad.name.indexOf('Launch Area 94') === 0
)

check('未知载荷 / Unknown Payload 是弱身份', isGenericMissionTitle('未知载荷') && isGenericMissionTitle('Unknown Payload'))
check('Yaogan 不是弱身份', !isGenericMissionTitle('Yaogan 53-01 to 03/56-01 to 03'))

const now = Date.parse('2026-09-10T12:00:00Z')
check(
  '占位详情 cacheAge≥10min 必须刷新',
  shouldRefreshCachedLaunchIdentity(placeholderRow(), { cacheAge: 11 * 60 * 1000 }, now) === true
)
check(
  '占位详情刚写入 1min 不刷',
  shouldRefreshCachedLaunchIdentity(placeholderRow(), { cacheAge: 60 * 1000 }, now) === false
)

const { isPlaceholderMissionField } = require(path.join(ROOT, 'utils/mission-list-card.js'))
check(
  '未知有效载荷历史卡视为不完整',
  isIncompleteCompletedListCard({
    rocketName: '长征二号丁/远征三号',
    missionName: '未知有效载荷',
    padLocation: '酒泉卫星发射中心',
    launchSite: '酒泉'
  })
)

const stripped = stripWeakerIdentityPatch(
  {
    rocketName: '长征四号乙',
    missionName: '遥感 53-01 to 03/56-01 to 03',
    name: '长征四号乙 | 遥感'
  },
  { rocketName: '长征二号丁/远征三号', rocketConfiguration: { name: 'Long March 2D' } },
  { rocketName: '长征二号丁/远征三号', missionName: '未知有效载荷' }
)
check(
  '已公布列表不被陈旧详情二号丁打回',
  stripped.rocketName == null && stripped.rocketConfiguration == null
)

check(
  '两边都是真名时详情火箭胜出（正向治愈）',
  pickBetterRocketName('长征二号丁/远征三号', '长征四号乙') === '长征四号乙'
)

const staleZh = placeholderRow()
staleZh.nameZh = '长征二号丁/远征三号 | 未知有效载荷'
staleZh.mission.nameZh = '未知有效载荷'
staleZh.rocket.configuration.nameZh = '长征二号丁'
staleZh.rocket.configuration.full_nameZh = '长征二号丁/远征三号'
applyLaunchIdentityUpgrade(staleZh, liveRow(), { trustIncoming: true })
check(
  '升级后丢掉旧 nameZh（否则列表继续画二号丁）',
  staleZh.rocket.configuration.name === 'Long March 4B' &&
    staleZh.rocket.configuration.nameZh == null &&
    staleZh.nameZh == null
)

const { buildRocketNamePair, applyContentLangToMission } = require(path.join(ROOT, 'utils/launch-card-i18n.js'))
try {
  require(path.join(ROOT, 'utils/locale.js')).setContentLangMem('zh')
} catch (e) {}
const displayPair = buildRocketNamePair('Long March 4B', {
  name: 'Long March 4B',
  nameZh: '长征二号丁',
  full_nameZh: '长征二号丁/远征三号'
})
check(
  '列表火箭中文跟英文构型，不跟陈旧 nameZh',
  /四号乙/.test(displayPair.rocketNameZh) && !/二号丁/.test(displayPair.rocketNameZh),
  displayPair.rocketNameZh
)
const displayCard = applyContentLangToMission({
  rocketName: 'Long March 4B',
  missionName: 'Yaogan 53-01 to 03/56-01 to 03',
  name: 'Long March 4B | Yaogan 53-01 to 03/56-01 to 03',
  _langPack: {
    rocketNameEn: 'Long March 4B',
    rocketNameZh: '长征二号丁',
    missionNameEn: 'Yaogan 53-01 to 03/56-01 to 03',
    missionNameZh: '未知有效载荷',
    nameEn: 'Long March 4B | Yaogan 53-01 to 03/56-01 to 03',
    nameZh: '长征二号丁/远征三号 | 未知有效载荷'
  }
})
check(
  '套中文后不得再显示二号丁/未知有效载荷',
  /四号乙/.test(displayCard.rocketName) &&
    !/二号丁/.test(displayCard.rocketName) &&
    !/未知有效载荷/.test(displayCard.missionName) &&
    /遥感/.test(displayCard.missionName),
  `rocket=${displayCard.rocketName} mission=${displayCard.missionName}`
)

const upcomingWeak = {
  id: 'de446468-057f-4c9d-a6a1-af99c93b541e',
  name: 'Zhuque-2E Block 2 | Unknown Payload',
  mission: { name: 'Unknown Payload' },
  rocket: { configuration: { name: 'Zhuque-2E Block 2', nameZh: '朱雀二号改' } }
}
const upcomingLive = { id: upcomingWeak.id, name: 'Zhuque-2E Block 2 | Tianyi 33' }
applyLaunchIdentityUpgrade(upcomingWeak, upcomingLive, { trustIncoming: true })
check(
  '即将发射朱雀占位可按标题升载荷且保留同族火箭',
  upcomingWeak.mission.name.indexOf('Tianyi') === 0 &&
    /Zhuque-2E/.test(upcomingWeak.rocket.configuration.name),
  `mission=${upcomingWeak.mission.name} rocket=${upcomingWeak.rocket.configuration.name}`
)

const hourly = read('cloudfunctions/syncSpaceDevsData/launch-net-hourly.js')
check(
  '小时探针 previous 身份回写 limit 对齐扫描窗',
  /refreshRecentPreviousIdentityFromLl2/.test(hourly) &&
    /limit=20/.test(hourly) &&
    /Math\.min\(rows\.length, 20\)/.test(hourly)
)
check(
  'previous 就地补丁升级身份',
  /applyLaunchIdentityUpgrade/.test(hourly) && /patchPreviousStatusInPlace/.test(hourly)
)
check('hourly 各出口都跑身份回写', (hourly.match(/maybeRefreshPreviousIdentity\(/g) || []).length >= 5)
check(
  '即将发射小时补丁也升级身份',
  /applyLaunchIdentityUpgrade\(row, live/.test(hourly) && /function patchResultsInPlace/.test(hourly)
)
const upcomingPatch = read('cloudfunctions/ll2Query/upcoming-cache-patch.js')
check(
  'resolve 回写 upcoming 也升级身份',
  /shouldUpgradeLaunchIdentity/.test(upcomingPatch) && /applyLaunchIdentityUpgrade/.test(upcomingPatch)
)

const netState = read('cloudfunctions/syncSpaceDevsData/launch-net-state.js')
check('attach stub 合并 live 更好身份接线', /mergeLaunchSourcesForStub/.test(netState))

const ll2Index = read('cloudfunctions/ll2Query/index.js')
check(
  '详情缓存命中可绕过占位',
  /shouldRefreshCachedLaunchIdentity/.test(ll2Index) && /bypassStaleIdentity/.test(ll2Index)
)
check('详情写入用动态 TTL', /detailCacheTtlMs\(apiData/.test(ll2Index))
check('previous fillThin 走身份升级', /applyLaunchIdentityUpgrade/.test(ll2Index) && /fillThinPreviousRow/.test(ll2Index))

const settled = read('pages/index/utils/index-settled-merge.js')
check('详情回写可覆盖错误身份', /_identityDisplayDiffers/.test(settled))
check('详情回写拒绝更弱身份', /stripWeakerIdentityPatch/.test(settled))

const detailJs = read('pages/mission-detail/mission-detail.js')
check('打开详情可刷新列表缓存', /identityHeal/.test(detailJs) && /forceLaunchListCloudBgCheck/.test(detailJs))
check(
  '打开即将发射详情可回写列表身份',
  /applyUpcomingIdentityFromDetail/.test(read('pages/index/index.js')) &&
    /applyUpcomingIdentityFromDetail/.test(settled) &&
    /!isTerminal && !scheduleHeal && !identityHeal/.test(detailJs)
)
check(
  'identityHeal 在终态与即将发射占位上都生效',
  /const identityHeal =/.test(detailJs) &&
    /if \(!isTerminal && !scheduleHeal && !identityHeal\) return/.test(detailJs) &&
    /if \(scheduleHeal \|\| identityHeal\)/.test(detailJs)
)

const titleI18n = read('utils/mission-title-i18n.js')
const titleCopies = [
  'utils/mission-title-i18n.js',
  'cloudfunctions/syncSpaceDevsData/mission-title-i18n.js',
  'cloudfunctions/ll2Query/mission-title-i18n.js',
  'cloudfunctions/sendLaunchReminder/mission-title-i18n.js'
]
check(
  'Yaogan 译为遥感（标题词典各副本）',
  titleCopies.every((rel) => {
    const t = read(rel)
    return /\\bYaogan\\b/.test(t) && /遥感/.test(t)
  })
)
check(
  'space-terms 云端副本有 Yaogan',
  /\\bYaogan\\b/.test(read('cloudfunctions/syncSpaceDevsData/space-terms-i18n.js')) &&
    /\\bYaogan\\b/.test(read('cloudfunctions/ll2Query/space-terms-i18n.js'))
)

const launchDataHourly = hourly
check(
  '小时探针对 launch_data 只补 NET/状态（身份靠 6h sync）',
  /function buildLaunchDataNetPatch/.test(launchDataHourly) &&
    !/rocketConfigName/.test(launchDataHourly.slice(launchDataHourly.indexOf('function buildLaunchDataNetPatch')))
)

const tests = spawnSync(
  process.execPath,
  [
    '--test',
    'cloudfunctions/syncSpaceDevsData/launch-identity-upgrade.test.js',
    'cloudfunctions/syncSpaceDevsData/launch-net-hourly-stub.test.js',
    'cloudfunctions/syncSpaceDevsData/launch-data-net-patch.test.js',
    'cloudfunctions/ll2Query/upcoming-cache-patch.test.js',
    'test/mission-list-card.test.js',
    'test/zh-usable-i18n.test.js'
  ],
  { cwd: ROOT, encoding: 'utf8' }
)
const testOk = tests.status === 0
check('身份升级相关单测 + 双副本', testOk, testOk ? '' : (tests.stderr || tests.stdout || '').slice(0, 600))

const failed = results.filter((r) => !r.ok)
console.log(failed.length ? `\nFAILED ${failed.length}/${results.length}` : `\nOK ${results.length}`)
if (failed.length) {
  failed.forEach((f) => console.error(' -', f.name, f.detail || ''))
  process.exit(1)
}
