/**
 * 本轮审计：历史卡返回跳动 + 3D 左下角型号跳转 + 型号详情档案指数
 * 运行：node scripts/_tmp_audit_card_3d_score_round.js
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

function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel))
}

function syntaxOk(rel) {
  const r = spawnSync(process.execPath, ['--check', path.join(ROOT, rel)], { encoding: 'utf8' })
  return r.status === 0
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
    if (ch === '/' && src[i + 1] === '*') {
      i = src.indexOf('*/', i)
      if (i < 0) break
      i += 1
      continue
    }
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return src.slice(open, i + 1)
    }
  }
  return src.slice(open, open + 2400)
}

function wxmlHandlers(wxml) {
  const set = new Set()
  const re = /\b(?:bind|catch)[:]?[A-Za-z]+="([A-Za-z_$][\w$]*)"/g
  let m
  while ((m = re.exec(wxml))) set.add(m[1])
  return [...set]
}

function hasHandler(js, base, name) {
  return new RegExp(name + '\\s*[:\\(]').test(js) || new RegExp(name + '\\s*[:\\(]').test(base || '')
}

const indexJs = read('pages/index/index.js')
const settled = read('pages/index/utils/index-settled-merge.js')
const services = read('utils/index-mission-services.js')
const interaction = read('subpackages/index-extra/utils/index-interaction.js')
const calendar = read('subpackages/index-extra/utils/index-calendar-page.js')
const viewerJs = read('subpackages/rocket-3d/viewer.js')
const viewerWxml = read('subpackages/rocket-3d/viewer.wxml')
const modelJs = read('subpackages/monitor-pages/rocket-model-detail.js')
const modelWxml = read('subpackages/monitor-pages/rocket-model-detail.wxml')
const modelWxss = read('subpackages/monitor-pages/rocket-model-detail.wxss')
const missionJs = read('pages/mission-detail/mission-detail.js')
const missionWxml = read('pages/mission-detail/mission-detail.wxml')
const geneJs = read('subpackages/monitor-pages/booster-genealogy.js')
const geneWxml = read('subpackages/monitor-pages/booster-genealogy.wxml')
const pageBase = read('utils/page-base.js')
const boosterNav = read('subpackages/monitor-pages/utils/booster-nav.js')

console.log('==== 本轮：历史卡 / 3D 型号 / 档案指数 ====')

console.log('\n[1] 历史卡返回不再整表拆掉')
if (/function stableMissionListWxkey/.test(services)) {
  const keyFn = fnBody(services, 'stableMissionListWxkey')
  if (/\$\{prefix\}-\$\{id\}/.test(keyFn) && !/baseIndex \+ index/.test(keyFn) && !/index/.test(keyFn)) {
    ok('wx:key 跟 id 走，不含下标')
  } else fail('stableMissionListWxkey 仍可能带下标')
} else fail('缺 stableMissionListWxkey')
if (!/m-1-\$\{isCompleted[\s\S]{0,40}baseIndex \+ index/.test(services) && !/baseIndex \+ index/.test(fnBody(services, 'normalizeMissionItem'))) {
  ok('normalizeMissionItem 不再把 index 写进 key')
} else fail('normalizeMissionItem 仍用 index 拼 key')
if (/shouldPatchSingleCompletedCardFromDetail/.test(services) && /shouldPatchSingleCompletedCardFromDetail/.test(indexJs)) {
  ok('详情回写有单张补丁判定')
} else fail('缺 shouldPatchSingleCompletedCardFromDetail')
const applyObs = fnBody(indexJs, 'applyLaunchObservationFromDetail')
if (/shouldPatchSingleCompletedCardFromDetail/.test(applyObs) && /applyCompletedMissionStatusFromDetail/.test(applyObs) && /_recentSettledCache/.test(applyObs) && !/_launchRecordsById\.values\(\)/.test(applyObs)) {
  ok('历史卡回写只补单张；整表 merge 不再吞全部观测')
} else fail('applyLaunchObservationFromDetail 仍会整表投影/用全部观测 merge')
if (/upIdx >= 0 && cpIdx < 0 && !settled && !isPanel/.test(applyObs)) {
  ok('即将发射未落库不重写历史列表')
} else fail('即将发射详情回写仍可能重写历史')
if (/_indexLeftToSubpage = true/.test(interaction) && /mission-detail/.test(fnBody(indexJs, 'onHide')) && /_indexReturningFromSubpage/.test(fnBody(indexJs, 'onShow'))) {
  ok('进详情打标，回首页识别子页返回')
} else fail('详情往返标记不齐')
const deferred = fnBody(indexJs, '_runIndexShowDeferred')
if (/_indexSkipSettledRewriteUntil/.test(deferred) && /if \(fromSubpage\) return|if \(skipCompletedRewrite\) return/.test(deferred) && /_scrubKnownSettleableCountdown/.test(deferred)) {
  ok('子页返回跳过历史整表 merge，倒计时仍 scrub；二次 deferred 有短窗')
} else fail('onShow deferred 仍会在回首页后整表 merge')
if (/pickRicherMissionCard/.test(settled) && /kept === item/.test(fnBody(settled, '_mergeRecentSettledIntoCompletedList'))) {
  ok('结算合并不用瘦卡盖完整卡')
} else fail('merge 仍可能用瘦卡盖完整卡')
if (/stableMissionListWxkey\('completed'/.test(settled) && /keep\._wxkey/.test(fnBody(settled, '_scheduleHydrateIncompleteCompletedCards'))) {
  ok('补水 / 结算卡保留 _wxkey')
} else fail('补水或结算卡可能丢掉 _wxkey')
const detailBack = fnBody(settled, 'applyCompletedMissionStatusFromDetail')
if (/statusSame && !needDisplay/.test(detailBack) && /this\._rememberSessionCompleted\(item\)[\s\S]{0,40}return/.test(detailBack)) {
  ok('详情回写无变化时不 setData 整表')
} else fail('applyCompletedMissionStatusFromDetail 无变化仍整表 setData')
if (/cal-\$\{isUpcoming \? 'up' : 'comp'\}-\$\{m\.id/.test(calendar) || /cal-\$\{isUpcoming \? 'up' : 'comp'\}-\$\{m\.id/.test(calendar.replace(/\s+/g, ''))) {
  ok('日历卡 key 跟 id')
} else if (/m\._wxkey \|\|[\s\S]{0,80}cal-\$\{isUpcoming/.test(calendar)) {
  ok('日历卡优先复用 _wxkey，缺省跟 id')
} else fail('日历卡 key 仍绑死下标')

console.log('\n[2] 3D 左下角型号跳转')
const tapTitle = fnBody(viewerJs, 'onTapExhibitTitle')
const loadMeta = fnBody(viewerJs, '_loadExhibitMeta')
const viewerWxss = exists('subpackages/rocket-3d/viewer.wxss') ? read('subpackages/rocket-3d/viewer.wxss') : ''
if (/catchtap="onTapExhibitTitle"/.test(viewerWxml) && /r3d-exhibit-title/.test(viewerWxml)) {
  ok('左下角型号名绑 onTapExhibitTitle')
} else fail('3D 标题未绑点击')
if (/<view[\s\S]{0,280}catchtap="onTapExhibitTitle"/.test(viewerWxml) && !/<text[^>]*catchtap="onTapExhibitTitle"/.test(viewerWxml)) {
  ok('型号名热区是 view，不是窄 text')
} else fail('型号名仍绑在 text 上，热区容易点空')
if (/\.r3d-exhibit-dock\s*\{[^}]*pointer-events:\s*none/.test(viewerWxss) && /\.r3d-exhibit-tab\s*\{[^}]*pointer-events:\s*auto/.test(viewerWxss)) {
  ok('底栏仍把拖转交给画布，Tab 单独开点击')
} else fail('底栏 pointer-events 约定坏了')
if (/\.r3d-exhibit-title\s*\{[^}]*pointer-events:\s*auto/.test(viewerWxss)) {
  ok('型号名在底栏 pointer-events:none 上单独开点击')
} else fail('型号名仍被底栏 pointer-events:none 吃掉')
if (/configId: seriesModel \? '' : \(matchedId \|\| that\.data\.configId/.test(loadMeta)) {
  ok('展陈元数据回写 configId，全系列不写')
} else fail('3D 匹配到构型后没写回 configId')
if (/_resolveExhibitConfigId/.test(viewerJs) && /pickCatalogItem/.test(fnBody(viewerJs, '_resolveExhibitConfigId'))) {
  ok('点标题先从 data / 目录解析 id')
} else fail('缺 _resolveExhibitConfigId')
if (
  /gateCheck\s*\(\s*'booster_genealogy'/.test(tapTitle) &&
  !/getRocketConfigMeta/.test(tapTitle) &&
  !/matchRocketConfig/.test(tapTitle) &&
  /ROUTES\.ROCKET_MODEL_DETAIL/.test(tapTitle)
) {
  ok('点标题有 configId 才进型号详情，不再按名反查')
} else fail('3D 点标题门控/匹配/路由不对')
if (/全系列没有单独档案/.test(tapTitle) && /暂无型号档案/.test(tapTitle)) {
  ok('全系列不跳有提示；匹配失败有提示')
} else fail('3D 全系列/失败路径不齐')
if (!/monitor-pages/.test(viewerJs) && !/openRocketScore|buildScoreView|ic-score/.test(viewerJs) && !/onTapRocketScore|mission-score-fab/.test(viewerWxml)) {
  ok('3D 不拉评分、不加档案指数钮')
} else fail('3D 误接了评分或档案指数钮')

console.log('\n[3] 档案指数入口落位')
if (/mission-fab-dock/.test(missionWxml) && /onTapRocketScore/.test(missionWxml) && /onTapRocketCompare/.test(missionWxml)) {
  ok('任务详情已有 PK + 档案指数，不重复造')
} else fail('任务详情坞口坏了')
if (
  /mission-fab-dock/.test(modelWxml) &&
  /onTapRocketCompare/.test(modelWxml) &&
  /onTapRocketScore/.test(modelWxml) &&
  modelWxml.indexOf('onTapRocketCompare') < modelWxml.indexOf('onTapRocketScore') &&
  /ic-score\.svg/.test(modelWxml) &&
  /openRocketScore\(model\.configId/.test(modelJs)
) {
  ok('型号详情 PK 右侧新增档案指数')
} else fail('型号详情档案指数入口不齐')
if (/\.mission-fab-dock\s*\{/.test(modelWxss) && /\.mission-score-fab\s*\{/.test(modelWxss) && /backdrop-filter/.test(fnBody ? modelWxss : '')) {
  ok('型号详情坞口样式与任务详情同款磨砂')
} else fail('型号详情坞口样式缺')
if (!/onTapRocketScore|mission-score-fab|ic-score/.test(geneWxml) && !/openRocketScore|onTapRocketScore/.test(geneJs)) {
  ok('族谱列表不加档案指数')
} else fail('族谱列表误加了档案指数')
const extraPages = [
  'subpackages/monitor-pages/booster-detail.wxml',
  'subpackages/monitor-pages/agency-detail.wxml',
  'subpackages/monitor-pages/station-detail.wxml',
  'subpackages/monitor-pages/rocket-compare.wxml',
  'subpackages/monitor-pages/rocket-score.wxml'
]
extraPages.forEach((rel) => {
  const w = read(rel)
  if (/onTapRocketScore|mission-score-fab/.test(w)) fail(rel + ' 不是对应详情页，却加了档案指数')
  else ok(path.basename(rel) + ' 不加档案指数')
})
if (/function openRocketScore/.test(boosterNav) && /gateCheck\('rocket_compare',\s*'火箭型号对比'\)/.test(fnBody(boosterNav, 'openRocketScore'))) {
  ok('型号详情入口复用 openRocketScore 门控')
} else fail('openRocketScore 门控丢了')
if (exists('pages/mission-detail/images/ic-score.svg')) ok('指数图标仍在任务详情分包')
else fail('缺 ic-score.svg')

console.log('\n[4] wxml 处理器')
;[
  ['subpackages/rocket-3d/viewer.wxml', viewerJs],
  ['subpackages/monitor-pages/rocket-model-detail.wxml', modelJs],
  ['pages/mission-detail/mission-detail.wxml', missionJs]
].forEach(([wxmlRel, js]) => {
  const missing = wxmlHandlers(read(wxmlRel)).filter((name) => !hasHandler(js, pageBase, name))
  if (!missing.length) ok(wxmlRel + ' 绑定齐全')
  else fail(wxmlRel + ' 缺处理器: ' + missing.join(','))
})

console.log('\n[5] JS 语法')
;[
  'pages/index/index.js',
  'pages/index/utils/index-settled-merge.js',
  'utils/index-mission-services.js',
  'subpackages/index-extra/utils/index-interaction.js',
  'subpackages/index-extra/utils/index-calendar-page.js',
  'subpackages/rocket-3d/viewer.js',
  'subpackages/monitor-pages/rocket-model-detail.js',
  'subpackages/monitor-pages/utils/booster-nav.js'
].forEach((rel) => {
  if (syntaxOk(rel)) ok(rel)
  else fail(rel + ' 语法错误')
})

console.log('\n[6] 相关单测 / 既有审计')
const tests = [
  'test/index-mission-services.test.js',
  'test/mission-list-card.test.js',
  'test/entity-route-links.test.js',
  'test/rocket-score.test.js',
  'test/rocket-compare.test.js',
  'test/rocket-3d-audit.test.js',
  'test/rocket-3d-exhibit.test.js',
  'test/foreground-resume.test.js'
]
const t = spawnSync(process.execPath, ['--test', ...tests], { encoding: 'utf8', cwd: ROOT })
if (t.status === 0) ok('相关单测全绿')
else fail('相关单测失败\n' + (t.stderr || t.stdout || '').slice(-1200))

const audits = [
  'scripts/_audit_rocket_score.js',
  'scripts/_audit_foreground_resume.js',
  'scripts/_audit_free_list_db_cost.js'
]
audits.forEach((rel) => {
  const r = spawnSync(process.execPath, [path.join(ROOT, rel)], { encoding: 'utf8', cwd: ROOT })
  if (r.status === 0) ok(path.basename(rel) + ' 全绿')
  else fail(path.basename(rel) + ' 失败\n' + (r.stdout || r.stderr || '').slice(-800))
})

console.log('\n==== 汇总 ====')
if (!issues.length) {
  console.log('ALL GREEN')
  process.exit(0)
}
console.log('失败 ' + issues.length)
issues.forEach((m) => console.log(' - ' + m.split('\n')[0]))
process.exit(1)
