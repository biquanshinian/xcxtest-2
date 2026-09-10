/**
 * 即将发射 + 历史发射：展示必须跟 LL2 `name` 对齐，不能用过期 configuration 画错火箭/载荷。
 * node scripts/_tmp_audit_ll2_list_identity.js
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
const {
  pickLl2AlignedRocketName,
  pickRicherMissionCard,
  parseRocketMissionFromLaunchName
} = require(path.join(ROOT, 'utils/mission-list-card.js'))
const { buildTitlePair, applyContentLangToMission } = require(path.join(ROOT, 'utils/launch-card-i18n.js'))
try {
  require(path.join(ROOT, 'utils/locale.js')).setContentLangMem('zh')
} catch (e) {}

const YAO = '95eb9265-bdbe-43ad-b08c-6be7eb4e58f4'

function displayRocket(launch) {
  const cfg =
    (launch && launch.rocket && launch.rocket.configuration) ||
    (launch && launch.rocket && launch.rocket.rocket && launch.rocket.rocket.configuration)
  const fromCfg = cfg && (cfg.name || cfg.full_name)
  return pickLl2AlignedRocketName(fromCfg, launch && launch.name) || fromCfg || ''
}

function displayMission(launch) {
  return buildTitlePair(launch, displayRocket(launch), '').missionNameEn
}

console.log('=== LL2 list identity audit ===\n')

check(
  '身份双副本一致',
  read('cloudfunctions/syncSpaceDevsData/launch-identity-upgrade.js').replace(/\r\n/g, '\n') ===
    read('cloudfunctions/ll2Query/launch-identity-upgrade.js').replace(/\r\n/g, '\n')
)

const staleCfg = {
  id: YAO,
  name: 'Long March 4B | Yaogan 53-01 to 03/56-01 to 03',
  mission: { name: 'Unknown Payload' },
  rocket: { configuration: { name: 'Long March 2D', full_name: 'Long March 2D/Yuanzheng-3' } }
}
check(
  '历史：cfg 仍是二号丁时列表必须画四号乙',
  displayRocket(staleCfg) === 'Long March 4B',
  displayRocket(staleCfg)
)
check(
  '历史：mission 仍 Unknown 时列表必须画 Yaogan',
  /Yaogan/i.test(displayMission(staleCfg)) && !/Unknown Payload/i.test(displayMission(staleCfg)),
  displayMission(staleCfg)
)

const zhCard = applyContentLangToMission({
  rocketName: displayRocket(staleCfg),
  missionName: displayMission(staleCfg),
  name: staleCfg.name,
  rocketConfiguration: staleCfg.rocket.configuration,
  _langPack: {
    rocketNameEn: displayRocket(staleCfg),
    rocketNameZh: '长征二号丁',
    missionNameEn: displayMission(staleCfg),
    missionNameZh: '未知有效载荷',
    nameEn: staleCfg.name,
    nameZh: '长征二号丁/远征三号 | 未知有效载荷'
  }
})
check(
  '历史中文卡不得再画二号丁/未知有效载荷',
  /四号乙/.test(zhCard.rocketName) &&
    !/二号丁/.test(zhCard.rocketName) &&
    /遥感/.test(zhCard.missionName) &&
    !/未知有效载荷/.test(zhCard.missionName),
  `rocket=${zhCard.rocketName} mission=${zhCard.missionName}`
)

const notam = {
  id: 'de446468-057f-4c9d-a6a1-af99c93b541e',
  name: 'Zhuque-2E Block 2 | Unknown Payload',
  mission: { name: 'Unknown Payload' },
  rocket: { configuration: { name: 'Zhuque-2E Block 2' } }
}
check(
  '即将发射：LL2 仍是 Unknown Payload 时不得臆造载荷',
  /Unknown Payload/i.test(displayMission(notam)),
  displayMission(notam)
)
check(
  '即将发射：同族 cfg 比标题更具体时保留 Block',
  pickLl2AlignedRocketName('Falcon 9 Block 5', 'Falcon 9 | Starlink Group 17-50') === 'Falcon 9 Block 5'
)

const wrongComplete = {
  rocketName: '长征二号丁/远征三号',
  missionName: '未知有效载荷',
  padLocation: '酒泉卫星发射中心',
  rocketConfiguration: { name: 'Long March 2D' }
}
const liveThin = {
  rocketName: 'Long March 4B',
  missionName: 'Yaogan 53-01 to 03/56-01 to 03',
  padLocation: '未知地点'
}
const kept = pickRicherMissionCard(wrongComplete, liveThin)
check(
  '合并：LL2 真名瘦卡压过完整错身份卡',
  kept.rocketName === 'Long March 4B' && /Yaogan/.test(kept.missionName)
)

const aligned = {
  name: 'Long March 4B | Yaogan 53-01 to 03/56-01 to 03',
  mission: { name: 'Unknown Payload' },
  rocket: { configuration: { name: 'Long March 2D' } }
}
const titleFix = ident.alignLaunchIdentityFromTitle(aligned)
check(
  '云端：标题已对时 0 额度纠偏 cfg/mission',
  titleFix.changed &&
    aligned.rocket.configuration.name === 'Long March 4B' &&
    /Yaogan/.test(aligned.mission.name)
)

const hourly = read('cloudfunctions/syncSpaceDevsData/launch-net-hourly.js')
check(
  '小时探针 previous 先本地标题对齐再决定是否打 LL2',
  /alignLaunchIdentityFromTitle/.test(hourly) &&
    /rowNeedsIdentityProbe/.test(hourly) &&
    /local_title_only/.test(hourly)
)
check(
  '即将发射小时补丁也会标题对齐',
  /alignLaunchIdentityFromTitle\(row\)/.test(hourly) && /function patchResultsInPlace/.test(hourly)
)
check(
  'resolve upcoming 补丁会标题对齐',
  /alignLaunchIdentityFromTitle/.test(read('cloudfunctions/ll2Query/upcoming-cache-patch.js'))
)
check(
  '详情回写本地 upcoming 缓存带英文身份',
  /pack\.nameEn/.test(read('pages/mission-detail/mission-detail.js')) &&
    /liveFields\.mission/.test(read('utils/api-request.js'))
)
check(
  '列表/详情 getRocketDisplayNameFromLaunch 都走 LL2 name 对齐',
  /pickLl2AlignedRocketName/.test(read('utils/api-launch-list.js')) &&
    /pickLl2AlignedRocketName/.test(read('pages/mission-detail/utils/api-launch-detail.js'))
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
check('相关单测', testOk, testOk ? '' : (tests.stderr || tests.stdout || '').slice(0, 800))

async function fetchLl2(kind) {
  const url =
    kind === 'upcoming'
      ? 'https://ll.thespacedevs.com/2.3.0/launches/upcoming/?format=json&mode=list&limit=12&ordering=net&hide_recent_previous=true'
      : 'https://ll.thespacedevs.com/2.3.0/launches/previous/?format=json&mode=list&limit=12&ordering=-net'
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error('HTTP ' + res.status)
  return res.json()
}

function auditLiveList(kind, payload) {
  const rows = payload && Array.isArray(payload.results) ? payload.results : []
  check(`现网 LL2 ${kind} 有数据`, rows.length > 0, `count=${rows.length}`)
  let mismatch = 0
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    if (!row || !row.name) continue
    const parsed = parseRocketMissionFromLaunchName(row.name)
    const rocket = displayRocket(row)
    const mission = displayMission(row)
    if (parsed.rocketName && !ident.isGenericRocketName(parsed.rocketName)) {
      const alignedRocket = pickLl2AlignedRocketName(
        row.rocket && row.rocket.configuration && (row.rocket.configuration.name || row.rocket.configuration.full_name),
        row.name
      )
      if (alignedRocket !== rocket) {
        mismatch++
        check(`${kind}#${i} 火箭展示偏移`, false, `${row.name} → ${rocket}`)
      }
    }
    if (!ident.isGenericMissionTitle(parsed.missionName) && ident.isGenericMissionTitle(mission)) {
      mismatch++
      check(`${kind}#${i} 载荷被占位盖住`, false, `${row.name} → ${mission}`)
    }
    if (
      ident.isGenericMissionTitle(parsed.missionName) &&
      mission &&
      !ident.isGenericMissionTitle(mission) &&
      !ident.isGenericMissionTitle(row.name)
    ) {
      mismatch++
      check(`${kind}#${i} 把 LL2 占位臆造成已公布`, false, `${row.name} → ${mission}`)
    }
  }
  if (!mismatch) {
    check(`现网 LL2 ${kind} 映射无身份错显`, true, `scanned=${rows.length}`)
  }
  if (kind === 'previous') {
    const yao = rows.find((r) => r && String(r.id) === YAO)
    if (yao) {
      check(
        '现网遥感那条 name 含 Long March 4B / Yaogan',
        /Long March 4B/i.test(yao.name) && /Yaogan/i.test(yao.name),
        yao.name
      )
      check(
        '现网遥感那条展示不得出现 2D / Unknown Payload',
        !/2D/.test(displayRocket(yao)) && !/Unknown Payload/i.test(displayMission(yao)),
        `rocket=${displayRocket(yao)} mission=${displayMission(yao)}`
      )
    } else {
      check('现网 previous 前 12 未扫到遥感 UUID（不判失败）', true, 'not in first 12')
    }
  }
}

return Promise.resolve()
  .then(async () => {
    try {
      const upcoming = await fetchLl2('upcoming')
      auditLiveList('upcoming', upcoming)
    } catch (e) {
      check('现网即将发射 LL2 可拉取', false, e.message || String(e))
    }
    try {
      const previous = await fetchLl2('previous')
      auditLiveList('previous', previous)
    } catch (e) {
      check('现网历史发射 LL2 可拉取', false, e.message || String(e))
    }
  })
  .then(() => {
    const failed = results.filter((r) => !r.ok)
    console.log(failed.length ? `\nFAILED ${failed.length}/${results.length}` : `\nOK ${results.length}`)
    if (failed.length) {
      failed.forEach((f) => console.error(' -', f.name, f.detail || ''))
      process.exit(1)
    }
  })
