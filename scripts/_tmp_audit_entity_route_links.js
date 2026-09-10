/**
 * 实体跳转补齐：档案指数 / 3D / 航警 / 搜索型号 / 嵌套标签
 * 运行：node scripts/_tmp_audit_entity_route_links.js
 */
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const ROOT = path.join(__dirname, '..')
const issues = []
const ok = (m) => console.log('  ok  ' + m)
const fail = (m) => { issues.push(m); console.log('  FAIL ' + m) }

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8')
}

function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel))
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
  return src.slice(open, open + 1800)
}

function wxmlHandlers(wxml) {
  const set = new Set()
  const re = /\b(?:bind|catch)[:]?[A-Za-z]+="([A-Za-z_$][\w$]*)"/g
  let m
  while ((m = re.exec(wxml))) set.add(m[1])
  return [...set]
}

function hasHandler(js, base, name) {
  return new RegExp(name + '\\s*[:\\(]').test(js) || new RegExp(name + '\\s*[:\\(]').test(base)
}

function syntaxOk(rel) {
  const r = spawnSync(process.execPath, ['--check', path.join(ROOT, rel)], { encoding: 'utf8' })
  return r.status === 0
}

function gateBeforeAfterGate(body, label) {
  const gateIdx = body.search(/gateCheck\s*\(\s*['"]booster_genealogy['"]/)
  const metaIdx = body.indexOf('getRocketConfigMeta({ afterGate: true })')
  if (gateIdx < 0) return fail(label + '：缺少 booster_genealogy 门控')
  if (metaIdx >= 0 && metaIdx < gateIdx) return fail(label + '：afterGate 出现在门控前')
  ok(label + '：先门控再 afterGate')
}

console.log('==== 实体跳转逻辑审计 ====')

const matchUtil = read('utils/rocket-config-match.js')
const statsUtil = read('subpackages/index-extra/utils/global-launch-stats.js')
const routes = read('utils/routes.js')
const pageBase = read('utils/page-base.js')
const monitor = read('pages/monitor/monitor.js')
const galleries = read('subpackages/monitor-pages/utils/monitor-galleries.js')
const galCompJs = read('subpackages/monitor-pages/components/monitor-galleries/index.js')
const galWxml = read('subpackages/monitor-pages/components/monitor-galleries/index.wxml')
const scoreJs = read('subpackages/monitor-pages/rocket-score.js')
const scoreWxml = read('subpackages/monitor-pages/rocket-score.wxml')
const viewerJs = read('subpackages/rocket-3d/viewer.js')
const viewerWxml = read('subpackages/rocket-3d/viewer.wxml')
const noticeJs = read('subpackages/monitor-pages/space-notices/entry-list.js')
const noticeWxml = read('subpackages/monitor-pages/space-notices/entry-list.wxml')
const searchJs = read('pages/search/search.js')
const searchWxml = read('pages/search/search.wxml')
const engine = read('pages/search/index-search-engine.js')
const geneJs = read('subpackages/monitor-pages/booster-genealogy.js')
const geneWxml = read('subpackages/monitor-pages/booster-genealogy.wxml')
const stationJs = read('subpackages/monitor-pages/station-detail.js')
const stationWxml = read('subpackages/monitor-pages/station-detail.wxml')
const compareJs = read('subpackages/monitor-pages/rocket-compare.js')
const compareWxml = read('subpackages/monitor-pages/rocket-compare.wxml')
const chatJs = read('subpackages/shared/components/ai-chat/index.js')
const chatWxml = read('subpackages/shared/components/ai-chat/index.wxml')
const rich = read('subpackages/shared/utils/ai-chat-rich.js')
const indexWxml = read('pages/index/index.wxml')
const indexJs = read('pages/index/index.js')
const apiMonitor = read('utils/api-monitor-data.js')

// ── 1) 共用匹配 ──
console.log('\n[1] 型号匹配抽到主包')
if (/function pickConfigById/.test(matchUtil) && /function cleanConfigId/.test(matchUtil) && /function pickLatestRocketConfigByName/.test(matchUtil) && !/function matchRocketConfigByName/.test(matchUtil) && !/rocket-score|buildScoreView/.test(matchUtil)) {
  ok('rocket-config-match：id 精确取档 + 统计导航用最新款，不含旧按名反查')
} else fail('rocket-config-match 仍留旧按名反查或掺了评分')
if (!/matchRocketConfigByName/.test(statsUtil)) {
  ok('统计页不再按名匹配构型')
} else fail('index-extra 仍引用 matchRocketConfigByName')
if (/ROCKET_MODEL_DETAIL:/.test(routes) && /AGENCY_DETAIL:/.test(routes) && !/ROCKET_SCORE|rocket-score/.test(routes)) {
  ok('路由表有型号/发射商详情，不含评分')
} else fail('routes.js 评分/详情路由不对')

// ── 2) 档案指数 ──
console.log('\n[2] 档案指数机构名')
if (/onTapManufacturer/.test(scoreJs) && /openEncyclopediaAgency/.test(fnBody(scoreJs, 'onTapManufacturer'))) {
  ok('评分页机构名走图鉴发射商跳转')
} else fail('评分页 onTapManufacturer 未走 openEncyclopediaAgency')
if (/catchtap="onTapManufacturer"/.test(scoreWxml)) ok('评分页机构名 catchtap')
else fail('评分页机构名未做成可点标签')

// ── 3) 3D ──
console.log('\n[3] 3D 展陈档案名')
const exhibitFn = fnBody(viewerJs, 'onTapExhibitTitle')
if (/_resolveExhibitConfigId/.test(exhibitFn) && /gateCheck\s*\(\s*'booster_genealogy'/.test(exhibitFn) && /ROUTES\.ROCKET_MODEL_DETAIL/.test(exhibitFn) && !/getRocketConfigMeta/.test(exhibitFn) && !/matchRocketConfig/.test(exhibitFn)) {
  ok('有合法 configId 才门控进型号详情，不再按名反查')
} else fail('3D 档案名跳转缺清洗/门控/路由，或仍按名反查')
if (/configId: seriesModel \? '' : \(matchedId \|\| that\.data\.configId/.test(viewerJs)) {
  ok('展陈元数据回写 configId，全系列不写')
} else fail('3D 未把匹配到的 configId 写回 data')
if (/catchtap="onTapExhibitTitle"/.test(viewerWxml) && /configId && !exhibit\.series \? 'r3d-exhibit-title--link'/.test(viewerWxml)) {
  ok('无 configId 时标题不显示可点态')
} else fail('3D 标题可点态未绑 configId')
if (!/monitor-pages/.test(viewerJs) && !/rocket-score|buildScoreView/.test(viewerJs)) {
  ok('3D 不 sync require monitor-pages / 评分')
} else fail('3D 误拉了 monitor-pages 或评分')

// ── 4) 航警 ──
console.log('\n[4] 空间航警火箭名芯片')
if (/bindtap="openMap"/.test(noticeWxml) && /catchtap="onTapRocketName"/.test(noticeWxml) && /item\.rocketClickable/.test(noticeWxml)) {
  ok('整卡仍进地图，火箭名 catchtap')
} else fail('航警整卡/芯片绑定不对')
const noticeCards = read('subpackages/monitor-pages/space-notices/utils/entry-cards.js')
if (/rocketClickable:\s*!!rocketConfigId/.test(noticeCards) && !/matchRocketConfigByName/.test(noticeCards)) {
  ok('航警火箭名有构型 id 才可点，配图不按名反查')
} else fail('航警未按构型 id 标记可点')
const noticeTap = fnBody(noticeJs, 'onTapRocketName')
if (/gateCheck\s*\(\s*'booster_genealogy'/.test(noticeTap) && !/matchRocketConfigByName/.test(noticeTap) && !/getRocketConfigMeta/.test(noticeTap)) {
  ok('航警点火箭名只走已有 configId')
} else fail('航警点火箭名仍按名反查')
if (/skipGate:\s*true/.test(fnBody(noticeJs, 'onTapRocketName'))) ok('航警过门控后不再弹第二次')
else fail('航警 openRocketModelDetail 会重复门控')
if (!/rocket-score|buildScoreView/.test(noticeJs)) ok('航警不引入评分')
else fail('航警误引入评分')

// ── 5) 搜索 ──
console.log('\n[5] 搜索火箭型号')
const loadFn = fnBody(searchJs, '_loadRocketModelsForSearch')
const searchTap = fnBody(searchJs, 'onSearchRocketModelTap')
if (/getRocketConfigMeta\(\)/.test(loadFn) && !/getRocketConfigMeta\(\{\s*afterGate/.test(loadFn)) {
  ok('搜索拉目录不带 afterGate')
} else fail('搜索预拉目录用了 afterGate 或没拉')
if (/gateCheck\s*\(\s*'booster_genealogy'/.test(searchTap) && !/matchRocketConfigByName/.test(searchTap)) {
  ok('搜索点型号先门控，有 id 才跳')
} else fail('搜索点型号缺门控或仍按名反查')
if (/type === 'rocket_model'/.test(searchJs) && /ROUTES\.ROCKET_MODEL_DETAIL/.test(searchTap) && /cleanConfigId/.test(searchTap)) {
  ok('搜索点击走型号详情并清洗 id')
} else fail('搜索点击未接到型号详情')
if (/rocket_model/.test(engine) && /getRocketModelSearchDocument/.test(engine) && /未知\|unknown/.test(engine)) {
  ok('引擎有型号文档且丢掉未知名')
} else fail('搜索引擎缺型号文档或未过滤未知')
if (!/index-extra/.test(searchJs) && !/rocket-score|openRocketScore|buildScoreView/.test(searchJs) && !/rocket-score/.test(engine)) {
  ok('搜索主包不拉 index-extra / 评分')
} else fail('搜索误引入分包或评分')
if (/data-config-id="\{\{result\.configId\}\}"/.test(searchWxml) && /data-type="\{\{result\._type\}\}"/.test(searchWxml)) {
  ok('搜索结果带 type / configId')
} else fail('搜索 wxml 缺 dataset')

// ── 6) 嵌套标签 ──
console.log('\n[6] 嵌套标签 catchtap，整卡主跳转仍在')
const nested = [
  [geneWxml, 'onModelCardTap', 'onTapModelManufacturer', '族谱型号卡'],
  [galWxml, 'emitOnBoosterCardTap', 'emitOnBoosterFamilyTap', '监控助推器预览族'],
  [galWxml, 'emitOnBoosterCardTap', 'emitOnBoosterManufacturerTap', '监控助推器预览厂'],
  [stationWxml, 'onShipTap', 'onShipAgencyTap', '空间站停靠飞船'],
  [chatWxml, 'onMissionCardTap', 'onLaunchRowAgencyTap', '星问发射行'],
  [compareWxml, 'onTogglePick', 'onTapPickerManufacturer', '对比选型']
]
nested.forEach(([wxml, card, tag, label]) => {
  const hasTag = wxml.includes('catchtap="' + tag + '"') || wxml.includes("'" + tag + "'")
  if (wxml.includes('bindtap="' + card + '"') && hasTag) ok(label + '：整卡/标签分离')
  else fail(label + '：整卡或标签绑定丢了')
})
if (/onTapModelManufacturer/.test(geneJs) && /openEncyclopediaAgency/.test(fnBody(geneJs, 'onTapModelManufacturer'))) {
  ok('族谱厂商走图鉴发射商')
} else fail('族谱厂商未走图鉴发射商')
if (/onBoosterFamilyTap/.test(galleries) && /openRocketModelDetail/.test(fnBody(galleries, 'onBoosterFamilyTap')) && /cleanConfigId/.test(fnBody(galleries, 'onBoosterFamilyTap'))) {
  ok('监控预览型号族走型号详情且清洗 id')
} else fail('监控预览型号族跳转不完整')
if (/onBoosterManufacturerTap/.test(galleries) && /openEncyclopediaAgency/.test(fnBody(galleries, 'onBoosterManufacturerTap'))) {
  ok('监控预览厂商走图鉴发射商')
} else fail('监控预览厂商未走图鉴发射商')
if (/'onBoosterFamilyTap'/.test(monitor) && /'onBoosterManufacturerTap'/.test(monitor) && /emitOnBoosterFamilyTap/.test(galCompJs) && /emitOnBoosterManufacturerTap/.test(galCompJs)) {
  ok('图鉴事件名在 GALLERIES_METHODS 与组件 emit 对齐')
} else fail('监控 Tab 委托/组件 emit 对不齐')
if (!/getRocketConfigMeta/.test(monitor) && !/getRocketConfigMeta/.test(galleries)) {
  ok('监控 Tab / 图鉴预览不拉 _config_meta')
} else fail('监控 Tab 或预览误拉了 _config_meta')
if (/agencyId/.test(apiMonitor) && /agencyNameEn/.test(apiMonitor) && /onShipAgencyTap/.test(stationJs)) {
  ok('停靠飞船带机构 id/英文名')
} else fail('停靠飞船机构字段不齐')
if (/launchAgencyId/.test(rich) && /launchAgencyAbbrev/.test(rich) && /onLaunchRowAgencyTap/.test(chatJs)) {
  ok('星问列表行带机构 id/缩写')
} else fail('星问列表行机构字段不齐')
if (
  chatWxml.includes('wx:if="{{row.launchAgency && row.launchAgencyId}}"') &&
  chatWxml.includes('onLaunchRowAgencyTap')
) {
  ok('星问任务行发射商有 id 才可点')
} else fail('星问任务行无 id 仍可点发射商')
if (/manufacturerAbbrev/.test(read('subpackages/monitor-pages/utils/rocket-compare.js')) && /onTapPickerManufacturer/.test(compareJs)) {
  ok('对比选型带厂商缩写')
} else fail('对比选型厂商字段不齐')

// ── 7) 不要误改的入口 ──
console.log('\n[7] 有意不改的入口仍在')
if (/onUpcomingAgencyChipTap/.test(indexWxml) && /upcoming-agency-filter/.test(indexWxml) && !/AGENCY_DETAIL/.test(indexJs.slice(0, 200)) && /onUpcomingAgencyChipTap/.test(indexJs)) {
  ok('首页即将发射机构胶囊仍是筛选')
} else fail('首页机构胶囊被改成图鉴跳转')
if (!/ROCKET_MODEL_DETAIL/.test(indexJs) && !/openRocketModelDetail/.test(indexJs)) {
  ok('首页不直接开型号详情')
} else fail('首页误接了型号详情')

// ── 8) wxml 处理器 ──
console.log('\n[8] wxml 绑定都有处理器')
const pages = [
  ['subpackages/monitor-pages/rocket-score.wxml', scoreJs],
  ['subpackages/rocket-3d/viewer.wxml', viewerJs],
  ['subpackages/monitor-pages/space-notices/entry-list.wxml', noticeJs],
  ['pages/search/search.wxml', searchJs],
  ['subpackages/monitor-pages/booster-genealogy.wxml', geneJs],
  ['subpackages/monitor-pages/station-detail.wxml', stationJs],
  ['subpackages/monitor-pages/rocket-compare.wxml', compareJs],
  ['subpackages/shared/components/ai-chat/index.wxml', chatJs + '\n' + read('subpackages/shared/utils/composer-input-behavior.js')]
]
pages.forEach(([wxmlRel, js]) => {
  const missing = wxmlHandlers(read(wxmlRel)).filter((name) => !hasHandler(js, pageBase, name))
  if (!missing.length) ok(wxmlRel + ' 绑定齐全')
  else fail(wxmlRel + ' 缺处理器: ' + missing.join(','))
})
wxmlHandlers(galWxml).forEach((name) => {
  if (!hasHandler(galCompJs, '', name)) fail('图鉴组件缺 ' + name)
})
if (wxmlHandlers(galWxml).every((name) => hasHandler(galCompJs, '', name))) ok('图鉴组件 emit 齐全')

// ── 9) 语法 ──
console.log('\n[9] JS 语法')
;[
  'utils/rocket-config-match.js',
  'pages/search/search.js',
  'pages/search/index-search-engine.js',
  'pages/monitor/monitor.js',
  'subpackages/monitor-pages/rocket-score.js',
  'subpackages/rocket-3d/viewer.js',
  'subpackages/monitor-pages/space-notices/entry-list.js',
  'subpackages/monitor-pages/booster-genealogy.js',
  'subpackages/monitor-pages/utils/monitor-galleries.js',
  'subpackages/monitor-pages/station-detail.js',
  'subpackages/monitor-pages/rocket-compare.js',
  'subpackages/shared/components/ai-chat/index.js',
  'subpackages/shared/utils/ai-chat-rich.js',
  'subpackages/index-extra/utils/global-launch-stats.js',
  'subpackages/index-extra/global-launch-stats.js'
].forEach((rel) => {
  if (!exists(rel)) return fail(rel + ' 不存在')
  if (syntaxOk(rel)) ok(rel)
  else fail(rel + ' 语法错误')
})

// ── 10) 相关单测 + 评分审计 ──
console.log('\n[10] 相关单测 / 评分审计')
const tests = [
  'test/rocket-config-match.test.js',
  'test/search-rocket-model.test.js',
  'test/entity-route-links.test.js',
  'test/rocket-score.test.js',
  'test/rocket-3d-audit.test.js',
  'test/rocket-compare.test.js',
  'test/global-launch-stats-display.test.js',
  'test/ll2-id-align.test.js'
]
const t = spawnSync(process.execPath, ['--test', ...tests], { cwd: ROOT, encoding: 'utf8' })
const failLine = (t.stdout || '').split('\n').find((l) => l.indexOf('fail ') === 0 || l.indexOf('✖') === 0)
if (t.status === 0) ok('相关单测全绿')
else fail('相关单测失败' + (failLine ? '：' + failLine : ''))

const scoreAudit = spawnSync(process.execPath, [path.join(ROOT, 'scripts/_audit_rocket_score.js')], { cwd: ROOT, encoding: 'utf8' })
if (scoreAudit.status === 0) ok('档案指数审计全绿')
else fail('档案指数审计失败')

const statsAudit = spawnSync(process.execPath, [path.join(ROOT, 'scripts/_tmp_audit_global_launch_stats_harden.js')], { cwd: ROOT, encoding: 'utf8' })
if (statsAudit.status === 0) ok('全球统计加固审计全绿')
else fail('全球统计加固审计失败')

console.log('\n==== 汇总 ====')
console.log('失败', issues.length)
issues.forEach((i) => console.log(' - ' + i))
process.exit(issues.length ? 1 : 0)
