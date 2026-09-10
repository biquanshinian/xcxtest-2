/**
 * 审计：实体跳转按 LL2 id 对齐，不对名称/缩写对号入座。
 * 运行：node scripts/_tmp_audit_agency_encyc_nav.js
 */
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const ROOT = path.join(__dirname, '..')
const issues = []
const ok = (m) => console.log('  ok  ' + m)
const fail = (m) => {
  issues.push(m)
  console.log('  FAIL ' + m)
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8')
}

function fnBody(src, name) {
  const re = new RegExp(
    '(?:async\\s+)?' + name + '\\s*\\([^)]*\\)\\s*\\{|' +
    name + '\\s*:\\s*(?:async\\s+)?function\\s*\\([^)]*\\)\\s*\\{'
  )
  const m = src.match(re)
  if (!m) return ''
  const open = src.indexOf('{', m.index)
  if (open < 0) return ''
  let depth = 0
  for (let i = open; i < src.length; i++) {
    const ch = src[i]
    if (ch === '"' || ch === "'" || ch === '`') {
      const q = ch
      i++
      while (i < src.length && src[i] !== q) {
        if (src[i] === '\\') i++
        i++
      }
      continue
    }
    if (ch === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++
      continue
    }
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return src.slice(open, i + 1)
    }
  }
  return src.slice(open, open + 1800)
}

console.log('==== 实体跳转按 ID 对齐 ====')

const matchSrc = read('utils/rocket-config-match.js')
if (!/matchRocketConfigByName/.test(matchSrc) && /pickConfigById/.test(matchSrc) && /pickLatestRocketConfigByName/.test(matchSrc)) {
  ok('构型目录按 id 取档；统计导航可按名取最新款')
} else fail('rocket-config-match 仍留旧按名反查或缺最新款选取')

if (!fs.existsSync(path.join(ROOT, 'utils/agency-encyclopedia-nav.js'))) {
  ok('主包不再放未使用的 agency-encyclopedia-nav')
} else fail('主包仍有未使用的 agency-encyclopedia-nav.js，质量检查会红')

const nav = read('subpackages/monitor-pages/utils/booster-nav.js')
if (!/CALT|KEY_ALIASES|inferAgencyFromRocket/.test(nav) && /pickAgencyId/.test(nav) && /return \{ id: fromAgencyId \}/.test(nav)) {
  ok('图鉴参数只收 id，没有名称别名表')
} else fail('图鉴跳转仍在按名称对号入座')

const slim = read('cloudfunctions/syncSpaceDevsData/_legacy.js')
if (/manufacturerId: m\.id != null \? m\.id : null/.test(slim)) {
  ok('构型同步保留 manufacturer.id')
} else fail('slimLauncherConfigMeta 丢掉了 manufacturer.id')

const proxy = read('cloudfunctions/apiProxy/index.js')
if ((proxy.match(/manufacturerId: m\.id != null \? m\.id : null/g) || []).length >= 2) {
  ok('apiProxy 构型详情/列表都带 manufacturerId')
} else fail('apiProxy 未落 manufacturer.id')

const display = read('subpackages/monitor-pages/utils/booster-display.js')
if (/pickAgencyId\(\(cfg && cfg\.manufacturerId\)/.test(display) && /pickAgencyId\(c\.manufacturerId\)/.test(display) && !/buildEncyclopediaAgencyParams/.test(display)) {
  ok('族谱/对比卡片厂商 id 来自构型，不再名称改写')
} else fail('booster-display 仍按名称收厂商')

const modelJs = read('subpackages/monitor-pages/rocket-model-detail.js')
const modelTap = fnBody(modelJs, 'onTapManufacturer')
if (/openEncyclopediaAgency\(\{ agencyId: agencyId \}\)/.test(modelTap) && /_fromAgencyId/.test(modelTap) && !/abbrev:/.test(modelTap)) {
  ok('型号详情点发射商只带 id')
} else fail('型号详情仍可能带名称跳转')

const agencyJs = read('subpackages/monitor-pages/agency-detail.js')
if (!/name: ds\.name/.test(agencyJs) && !/name: ds\.name/.test(read('subpackages/monitor-pages/station-detail.js'))) {
  ok('飞船详情跳转只带构型 id')
} else fail('飞船详情跳转仍夹带 name')
if (/params\.agencyId = this\._agencyId/.test(fnBody(agencyJs, 'onTapLauncher'))) {
  ok('图鉴进型号带着当前发射商 id')
} else fail('图鉴进型号没带 agencyId')

const idOnlyTaps = [
  ['subpackages/monitor-pages/rocket-score.js', 'onTapManufacturer'],
  ['subpackages/monitor-pages/booster-detail.js', 'onTapManufacturer'],
  ['subpackages/monitor-pages/booster-genealogy.js', 'onTapModelManufacturer'],
  ['subpackages/monitor-pages/rocket-compare.js', 'onTapPickerManufacturer'],
  ['subpackages/monitor-pages/utils/monitor-galleries.js', 'onBoosterManufacturerTap'],
  ['subpackages/monitor-pages/spacecraft-detail.js', 'onTapAgency'],
  ['subpackages/monitor-pages/station-detail.js', 'onShipAgencyTap'],
  ['subpackages/monitor-pages/station-detail.js', 'onOwnerAgencyTap']
]
const nameJump = idOnlyTaps.filter(([rel, name]) => {
  const body = fnBody(read(rel), name)
  return /abbrev:|name:|params\.abbrev|params\.name/.test(body)
})
if (!nameJump.length) ok('型号/族谱/飞船/空间站发射商入口只带 id')
else fail('仍带名称跳转: ' + nameJump.map((x) => x[0] + '#' + x[1]).join(', '))

const missionTap = fnBody(read('pages/mission-detail/mission-detail.js'), 'openAgencyDetail')
if (/agency-detail\?id=/.test(missionTap) && !/abbrev/.test(missionTap)) {
  ok('任务详情发射商只带 launchAgencyId')
} else fail('任务详情仍拼 name/abbrev')

const statsTap = fnBody(read('subpackages/index-extra/global-launch-stats.js'), 'onTapAgencyRank')
if (/params\.id = agencyId/.test(statsTap) && /params\.name = name/.test(statsTap) && /agencyAbbrev/.test(statsTap)) {
  ok('全球统计机构行有 id 带 id，无 id 才带名称')
} else fail('全球统计机构行导航未按 id 优先 / 名称兜底')

const wpTap = fnBody(read('subpackages/watch-party/screen.js'), 'onExplainTap')
if (/AGENCY_DETAIL, \{ id: info\.agencyId \}/.test(wpTap) || /\{ id: info\.agencyId \}/.test(wpTap)) {
  ok('观礼讲解发射商只带 agencyId')
} else fail('观礼讲解仍带名称')

const chatTap = fnBody(read('subpackages/shared/components/ai-chat/index.js'), 'onLaunchRowAgencyTap')
if (/\?id=/.test(chatTap) && !/abbrev/.test(chatTap)) {
  ok('星问任务行发射商只带 id')
} else fail('星问任务行仍按缩写跳')

const noticeTap = fnBody(read('subpackages/monitor-pages/space-notices/entry-list.js'), 'onTapRocketName')
if (/cleanConfigId\(ds\.configId\)/.test(noticeTap) && !/matchRocketConfigByName/.test(noticeTap) && !/getRocketConfigMeta/.test(noticeTap)) {
  ok('航警火箭名只走构型 id，不按名称反查')
} else fail('航警火箭名仍按名称反查')

const statsRocket = fnBody(read('subpackages/index-extra/global-launch-stats.js'), 'onTapRocketRank')
if (
  /pickLatestRocketConfig/.test(statsRocket) &&
  /afterGate:\s*true/.test(statsRocket) &&
  /skipGate:\s*true/.test(statsRocket) &&
  !/matchRocketConfigByName/.test(statsRocket)
) {
  ok('全球统计火箭行有 id 仍取最新款，无 id 按名称识别')
} else fail('全球统计火箭行未升到最新款或仍用旧按名反查')

const boosterNav = read('subpackages/monitor-pages/utils/booster-nav.js')
if (/launcherIdMatch/.test(boosterNav) && /params\.ll2Id = resolvedId/.test(boosterNav)) {
  ok('助推器跳转带 ll2Id')
} else fail('助推器跳转没带 ll2Id')

const boosterLoad = read('subpackages/monitor-pages/booster-detail.js')
if (/options\.ll2Id/.test(boosterLoad) && /where\(attempts\[i\]\)/.test(boosterLoad)) {
  ok('助推器详情先按 ll2Id 查档')
} else fail('助推器详情仍只按 serial 查')

const searchTapSrc = fnBody(read('pages/search/search.js'), 'onSearchRocketModelTap')
if (/cleanConfigId\(ds\.configId\)/.test(searchTapSrc) && !/matchRocketConfigByName/.test(searchTapSrc)) {
  ok('搜索型号有 id 才跳，不按名反查')
} else fail('搜索型号仍按名反查')

const exhibitTap = fnBody(read('subpackages/rocket-3d/viewer.js'), 'onTapExhibitTitle')
if (/_resolveExhibitConfigId/.test(read('subpackages/rocket-3d/viewer.js')) && !/matchRocketConfig/.test(exhibitTap)) {
  ok('3D 标题有 configId 才跳，不按名反查')
} else fail('3D 标题仍按名反查')

const exhibitMatch = read('subpackages/rocket-3d/exhibit.js')
if (/function lookupConfigById/.test(exhibitMatch) && /if \(configId\)/.test(exhibitMatch) && /return matchRocketConfigByNameOnly/.test(exhibitMatch)) {
  ok('3D 展陈有 configId 不按名覆盖')
} else fail('3D 展陈仍可能用名称盖掉 configId')

const agencyFmt = read('subpackages/monitor-pages/agency-detail.js')
if (!/byName\[nameEn\]/.test(agencyFmt) && /seenLauncherIds/.test(agencyFmt) && !/seen\[entry\.name\]/.test(agencyFmt)) {
  ok('图鉴火箭/飞船按构型 id 列出，不按名合并')
} else fail('图鉴仍按名称合并 launcher/spacecraft')

const geneBackfill = read('cloudfunctions/syncSpaceDevsData/_legacy.js')
if (!/nameToConfigId/.test(geneBackfill)) {
  ok('族谱不再用 rocketFamily 名回填 configId')
} else fail('族谱仍按家族名回填 configId')

const statsDecorate = fnBody(read('subpackages/index-extra/utils/global-launch-stats.js'), 'decorateAgencyRows')
if (/row\.agencyId/.test(statsDecorate) && !/rec && rec\.id/.test(statsDecorate)) {
  ok('统计机构行不按 logo 名表补 agencyId')
} else fail('统计机构行仍按名称补 id')

const cfgImage = fnBody(read('subpackages/monitor-pages/utils/booster-display.js'), 'configImageOf')
if (/hasId/.test(cfgImage) && /return cfg \?/.test(cfgImage)) {
  ok('助推器构型图有 configId 不按家族名改绑')
} else fail('助推器构型图仍按家族名匹配')

const picker = read('subpackages/monitor-pages/utils/rocket-compare.js')
if (/manufacturerId: card\.manufacturerId/.test(picker)) {
  ok('对比选型卡保留 manufacturerId')
} else fail('对比选型卡丢掉了厂商 id')

const launchMatch = read('cloudfunctions/getLaunchStats/launch-match.js')
if (/Number\.isFinite\(targetId\)/.test(launchMatch) && /Number\(lsp\.id\) === targetId/.test(launchMatch) && launchMatch.indexOf('targetId') < launchMatch.indexOf('targetName')) {
  ok('年内机构计数有 id 只认 id')
} else fail('launchMatchesAgencyFilter 仍可能先按名称命中')

const statsIndex = read('cloudfunctions/getLaunchStats/index.js')
if (/require\('\.\/launch-match\.js'\)/.test(statsIndex) && !/function launchMatchesAgencyFilter/.test(statsIndex)) {
  ok('getLaunchStats 复用 launch-match，不再内写名称优先过滤')
} else fail('getLaunchStats 仍内写 launchMatchesAgencyFilter')

const agencyCards = read('subpackages/monitor-pages/utils/agency-launch-cards.js')
if (/agency\.id != null && String\(agency\.id\)\.trim\(\) !== ''/.test(agencyCards) && /m\.launchAgencyId != null && String\(m\.launchAgencyId\) === String\(agency\.id\)/.test(agencyCards)) {
  ok('图鉴任务列表有机构 id 不回落缩写')
} else fail('matchLaunchAgency 有 id 仍可能用缩写兜底')

const fav = read('utils/favorites.js')
if (/extra\.ll2Id \|\| item\.extra\.launcherId/.test(fav) && /ll2Id=' \+ encodeURIComponent/.test(fav)) {
  ok('收藏助推器打开带 ll2Id')
} else fail('收藏助推器仍只拼 serial')

const boosterFav = fnBody(read('subpackages/monitor-pages/booster-detail.js'), 'onToggleFavorite')
if (/extra: \{/.test(boosterFav) && /ll2Id: item\.ll2Id/.test(boosterFav)) {
  ok('收藏助推器写入 extra.ll2Id')
} else fail('收藏助推器没把 ll2Id 存进 extra')

const searchCollect = fnBody(read('pages/search/index-search-engine.js'), 'collectRocketModelsFromMissions')
const searchMerge = fnBody(read('pages/search/index-search-engine.js'), 'mergeRocketModels')
if (/if \(!configId\) continue/.test(searchCollect) && /if \(!m \|\| !m\.configId\) return/.test(searchMerge)) {
  ok('搜索型号没有构型 id 不进结果')
} else fail('搜索仍会收进无 id 的型号')

const boot = read('pages/index/utils/index-countdown-boot.js')
if (
  /launchAgencyId: mission.launchAgencyId != null \? mission.launchAgencyId : ''/.test(boot) &&
  /rocketConfigId: mission.rocketConfigId/.test(boot) &&
  /padLocationId: mission.padLocationId/.test(boot)
) {
  ok('倒计时引导快照保留发射商/构型/发射场 id，且不把 0 当成空')
} else fail('倒计时引导快照丢掉了 id 或仍用 || 吞掉 id')

const settledMerge = read('pages/index/utils/index-settled-merge.js')
if (
  /const assignId = \(key\) =>/.test(settledMerge) &&
  /assignId\('launchAgencyId'\)/.test(settledMerge) &&
  /assignId\('rocketConfigId'\)/.test(settledMerge) &&
  /assignId\('padLocationId'\)/.test(settledMerge) &&
  !/assign\('launchAgencyId'\)/.test(settledMerge)
) {
  ok('详情合并 id 不走占位文案判断')
} else fail('_pickDetailDisplayFields 仍把 id 当占位文案')

const launchState = read('utils/index-launch-state.js')
if (/padLocationId: source.padLocationId/.test(launchState)) {
  ok('首页 launchData 带 padLocationId')
} else fail('首页 launchData 没带 padLocationId')

const indexWxml = read('pages/index/index.wxml')
if (
  indexWxml.includes('wx:if="{{launchData.launchAgencyId}}"') &&
  !indexWxml.includes('launchAgencyId || launchData.launchAgencyAbbrev') &&
  indexWxml.includes('onGoLaunchSiteDetail')
) {
  ok('首页机构/发射场有 id 才出详情钮')
} else fail('首页仍可能无 id 出详情钮或发射场未打通')

const interaction = read('subpackages/index-extra/utils/index-interaction.js')
if (/onGoLaunchSiteDetail/.test(interaction) && /LAUNCH_SITE_DETAIL, \{ id: id \}/.test(interaction)) {
  ok('首页发射场跳转只带 location id')
} else fail('首页发射场跳转未按 id 打通')

const mdJs = read('pages/mission-detail/mission-detail.js')
if (/locationId: firstNonEmptyId/.test(mdJs) && /openLaunchSiteDetail/.test(mdJs) && /openSpacecraftDetail/.test(mdJs)) {
  ok('任务详情预览保留 locationId 并提供发射场/飞船跳转')
} else fail('任务详情发射场/飞船档案未打通')

const mdWxml = read('pages/mission-detail/mission-detail.wxml')
if (
  mdWxml.includes('wx:if="{{mission.launchAgencyId}}"') &&
  mdWxml.includes('openLaunchSiteDetail') &&
  mdWxml.includes('openSpacecraftDetail')
) {
  ok('任务详情有 id 才显示可点芯片')
} else fail('任务详情仍可能无 id 显示可点芯片')

const apiDetail = read('pages/mission-detail/utils/api-launch-detail.js')
if (
  /spacecraftConfigId: \(scCfg && scCfg.id != null\) \? scCfg.id : null/.test(apiDetail) &&
  /padLocationId: \(loc && loc.id != null\)/.test(apiDetail)
) {
  ok('详情映射落飞船构型 id 和发射场 location id')
} else fail('详情映射丢掉了飞船构型 id 或发射场 id')

const slimBooster = read('cloudfunctions/apiProxy/agent-actions.js')
if (/ll2Id: b.ll2Id != null \? b.ll2Id : \(b.launcherId != null \? b.launcherId : null\)/.test(slimBooster)) {
  ok('星问助推器行带 ll2Id')
} else fail('星问 slimBoosterRow 没带 ll2Id')

const richCard = read('subpackages/shared/utils/ai-chat-rich.js')
if (/targetLl2Id: s.targetLl2Id/.test(richCard) && /targetLl2Id: item.ll2Id/.test(richCard)) {
  ok('星问助推器卡带 targetLl2Id')
} else fail('星问助推器卡没带 targetLl2Id')

const specTap = fnBody(read('subpackages/shared/components/ai-chat/index.js'), 'onSpecCardTap')
if (/ll2Id=/.test(specTap)) {
  ok('星问助推器卡点击拼 ll2Id')
} else fail('星问助推器卡点击没拼 ll2Id')

const chatWxml = read('subpackages/shared/components/ai-chat/index.wxml')
if (chatWxml.includes('data-ll2id="{{card.targetLl2Id}}"')) {
  ok('星问参数卡带 data-ll2id')
} else fail('星问参数卡没带 data-ll2id')

if (
  chatWxml.includes('wx:if="{{row.launchAgency && row.launchAgencyId}}"') &&
  chatWxml.includes('onLaunchRowAgencyTap')
) {
  ok('星问任务行发射商有 id 才可点')
} else fail('星问任务行无 id 仍可点发射商')

const utilSrc = read('utils/util.js')
if (
  /function getRocketImage/.test(utilSrc) &&
  /push\(rocketName\)/.test(utilSrc) &&
  !/function resolveRocketImageByConfig/.test(utilSrc) &&
  !/function configAssetUrlFromCfg/.test(utilSrc) &&
  !/hasConfigId/.test(utilSrc)
) {
  ok('火箭配置图仍走自定义名称字典，不按构型 id 改绑')
} else fail('火箭配置图匹配被改成按构型 id')

const statsDecorateRocket = fnBody(read('subpackages/index-extra/utils/global-launch-stats.js'), 'decorateRocketRows')
if (/getRocketImage\(row\.name\)/.test(statsDecorateRocket) && !/resolveRocketImageByConfig/.test(statsDecorateRocket)) {
  ok('全球统计火箭行仍按名称配自定义配置图')
} else fail('全球统计火箭行按构型 id 改配图')

const briefingImg = read('subpackages/shared/components/morning-briefing/index.js')
if (/var cfg = m\.rocketConfiguration \|\| null/.test(briefingImg) && !/id: m\.rocketConfigId/.test(briefingImg)) {
  ok('晨间简报不按构型 id 改配图')
} else fail('晨间简报用构型 id 改绑了配置图')

const noticeFmt = read('subpackages/monitor-pages/space-notices/utils/notice-format.js')
if (!/id: row\.rocketConfigId/.test(noticeFmt)) {
  ok('航警装饰不按构型 id 改配图')
} else fail('航警装饰用构型 id 改绑了配置图')

const chatImg = read('subpackages/shared/utils/ai-chat-rich.js')
if (!/id: safe\.rocketConfigId/.test(chatImg) && /safe\.rocketConfiguration/.test(chatImg)) {
  ok('星问任务卡不按构型 id 改配图')
} else fail('星问任务卡用构型 id 改绑了配置图')

const navMonitor = read('subpackages/monitor-pages/utils/booster-nav.js')
const navMission = read('pages/mission-detail/utils/booster-nav.js')
const navIndex = read('subpackages/index-extra/utils/booster-nav.js')
const navWatch = read('subpackages/watch-party/utils/booster-nav.js')
if (navMonitor === navMission) ok('完整 booster-nav 两份副本一致')
else fail('monitor-pages / mission-detail booster-nav 漂移')
if (navIndex === navWatch && /ll2Id/.test(navIndex) && !/openEncyclopediaAgency/.test(navIndex)) {
  ok('瘦 booster-nav 两份副本一致且带 ll2Id')
} else fail('index-extra / watch-party booster-nav 漂移或丢 ll2Id')

const indexJs = read('pages/index/index.js')
if (/["']onGoLaunchSiteDetail["']/.test(indexJs) && /INTERACTION_METHODS/.test(indexJs)) {
  ok('首页 INTERACTION_METHODS 登记了 onGoLaunchSiteDetail')
} else fail('首页没把 onGoLaunchSiteDetail 挂到 INTERACTION_METHODS')

const wpScreen = read('subpackages/watch-party/screen.js')
if (/getRocketImage\(rocketName\)/.test(wpScreen) && !/resolveRocketImageByConfig/.test(wpScreen)) {
  ok('观礼大屏仍按锁定火箭名配自定义配置图')
} else fail('观礼大屏按构型 id 改配图')

const linkIfId = [
  ['subpackages/monitor-pages/rocket-model-detail.wxml', 'model.manufacturerId', 'onTapManufacturer'],
  ['subpackages/monitor-pages/booster-detail.wxml', 'item.manufacturerId', 'onTapManufacturer'],
  ['subpackages/monitor-pages/rocket-score.wxml', 'model.manufacturerId', 'onTapManufacturer'],
  ['subpackages/monitor-pages/booster-genealogy.wxml', 'm.manufacturerId', 'onTapModelManufacturer'],
  ['subpackages/monitor-pages/spacecraft-detail.wxml', 'item.agencyId', 'onTapAgency']
]
const clickableWithoutId = linkIfId.filter(([rel, idExpr, handler]) => {
  const src = read(rel)
  return !(src.includes('wx:if="{{' + idExpr + '}}"') && src.includes(handler))
})
if (!clickableWithoutId.length) ok('发射商标签有 id 才显示可点')
else fail('无 id 仍可点: ' + clickableWithoutId.map((x) => x[0]).join(', '))

function syntaxOk(rel) {
  const r = spawnSync(process.execPath, ['--check', path.join(ROOT, rel)], { encoding: 'utf8' })
  return r.status === 0
}

;[
  'pages/index/utils/index-countdown-boot.js',
  'pages/index/utils/index-settled-merge.js',
  'pages/index/index.js',
  'pages/mission-detail/mission-detail.js',
  'pages/mission-detail/utils/api-launch-detail.js',
  'subpackages/index-extra/utils/index-interaction.js',
  'subpackages/index-extra/utils/global-launch-stats.js',
  'subpackages/index-extra/global-launch-stats.js',
  'subpackages/shared/utils/ai-chat-rich.js',
  'subpackages/shared/components/morning-briefing/index.js',
  'subpackages/monitor-pages/space-notices/utils/notice-format.js',
  'utils/util.js',
  'utils/rocket-config-match.js',
  'subpackages/monitor-pages/utils/booster-nav.js'
].forEach((rel) => {
  if (syntaxOk(rel)) ok('syntax ' + rel)
  else fail(rel + ' 语法错误')
})

const t = spawnSync(process.execPath, ['--test', 'test/agency-encyclopedia-nav.test.js', 'test/entity-route-links.test.js', 'test/global-launch-stats-display.test.js', 'test/rocket-config-match.test.js', 'test/search-rocket-model.test.js', 'test/space-notice-entry-cards.test.js', 'test/rocket-3d-exhibit.test.js', 'test/index-card-rocket-image.test.js', 'test/index-countdown-boot.test.js', 'test/ll2-id-align.test.js'], {
  encoding: 'utf8',
  cwd: ROOT
})
if (t.status === 0) ok('相关单测全绿')
else fail('相关单测失败\n' + (t.stderr || t.stdout || '').slice(-800))

console.log('\n==== 汇总 ====')
if (!issues.length) {
  console.log('ALL GREEN')
  process.exit(0)
}
console.log('失败 ' + issues.length)
issues.forEach((m) => console.log(' - ' + m.split('\n')[0]))
process.exit(1)
