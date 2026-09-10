/**
 * 审计：火箭档案指数
 * 目标：全绿灯（分包、先门控再拉档、免费不预热、分享可回放、动效不泄漏）
 */
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

let failed = 0
function assert(name, cond) {
  if (cond) console.log('PASS', name)
  else {
    failed++
    console.log('FAIL', name)
  }
}

function sliceFn(src, startRe, len) {
  const m = src.match(startRe)
  if (!m) return ''
  return src.slice(m.index, m.index + len)
}

const pageJs = read('subpackages/monitor-pages/rocket-score.js')
const pageWxml = read('subpackages/monitor-pages/rocket-score.wxml')
const pageWxss = read('subpackages/monitor-pages/rocket-score.wxss')
const pageJson = read('subpackages/monitor-pages/rocket-score.json')
const utilJs = read('subpackages/monitor-pages/utils/rocket-score.js')
const missionJs = read('pages/mission-detail/mission-detail.js')
const missionWxml = read('pages/mission-detail/mission-detail.wxml')
const missionWxss = read('pages/mission-detail/mission-detail.wxss')
const missionNav = read('pages/mission-detail/utils/booster-nav.js')
const monitorNav = read('subpackages/monitor-pages/utils/booster-nav.js')
const routes = read('utils/routes.js')
const appJson = read('app.json')
const indexPage = read('pages/index/index.js')
const monitorPage = read('pages/monitor/monitor.js')
const galleries = read('subpackages/monitor-pages/utils/monitor-galleries.js')

const onLoad = sliceFn(pageJs, /async onLoad\s*\(\s*options\s*\)\s*\{/, 1600)
const access = sliceFn(pageJs, /async ensureScoreAccess\s*\(/, 1400)
const load = sliceFn(pageJs, /async loadScore\s*\(\s*\)\s*\{/, 900)
const shareQ = sliceFn(pageJs, /_shareQuery\s*\(\s*\)\s*\{/, 400)
const retry = sliceFn(pageJs, /async onRetryLoad\s*\(\s*\)\s*\{/, 350)
const unload = sliceFn(pageJs, /onUnload\s*\(\s*\)\s*\{/, 250)
const anim = sliceFn(pageJs, /_playEnterAnim\s*\(\s*\)\s*\{/, 1600)

assert('评分页登记在 monitor-pages 分包', /"rocket-score"/.test(appJson) && !/"pages\/rocket-score"/.test(appJson))
assert('主包路由表不含评分', !/ROCKET_SCORE|rocket-score/.test(routes))
assert('首页不探评分', !/rocket-score|openRocketScore|buildScoreView/.test(indexPage))
assert('监控 Tab 不探评分', !/rocket-score|openRocketScore|buildScoreView/.test(monitorPage))
assert('监控预览不拉评分', !/rocket-score|buildScoreView|getRocketConfigMeta/.test(galleries))
assert('任务详情不计算指数', !/buildScoreView|getRocketConfigMeta/.test(missionJs))
assert('任务详情只留入口', /onTapRocketScore/.test(missionJs) && /openRocketScore/.test(missionJs))
assert('入口在 PK 右侧同坞', /mission-fab-dock/.test(missionWxml) && /onTapRocketScore/.test(missionWxml))
const modelJs = read('subpackages/monitor-pages/rocket-model-detail.js')
const modelWxml = read('subpackages/monitor-pages/rocket-model-detail.wxml')
const geneWxml = read('subpackages/monitor-pages/booster-genealogy.wxml')
const geneJs = read('subpackages/monitor-pages/booster-genealogy.js')
assert('型号详情 PK 右侧有档案指数', /mission-fab-dock/.test(modelWxml) && /onTapRocketScore/.test(modelWxml) && /openRocketScore/.test(modelJs))
assert('族谱列表不加档案指数', !/onTapRocketScore|mission-score-fab|ic-score/.test(geneWxml) && !/openRocketScore|onTapRocketScore/.test(geneJs))
assert('入口图标在任务详情分包', /ic-score\.svg/.test(missionWxml) && fs.existsSync(path.join(root, 'pages/mission-detail/images/ic-score.svg')))
assert('入口样式不进主包 wxss', !/mission-score-fab/.test(read('app.wxss')) && /mission-score-fab/.test(missionWxss))
assert('入口隐藏朋友圈单页', /isMomentsPreview/.test(missionWxml))

assert('入口门控 rocket_compare', /gateCheck\('rocket_compare',\s*'火箭型号对比'\)/.test(missionNav))
assert('入口直跳分包路径', /\/subpackages\/monitor-pages\/rocket-score/.test(missionNav))
assert('监控分包入口一致', /function openRocketScore/.test(monitorNav) && /\/subpackages\/monitor-pages\/rocket-score/.test(monitorNav))

assert('onLoad 走 ensureScoreAccess', /ensureScoreAccess/.test(onLoad) && /if \(allowed\) this\.loadScore\(\)/.test(onLoad))
assert('分享入口校验', /checkShareEntryGate\(this,\s*options,\s*GATE_PRODUCT_ID/.test(access))
assert('无分享窗口才 gateCheck', /if\s*\(\s*!this\.data\.shareGateExpireAt\s*\)/.test(access) && /gateCheck\(GATE_PRODUCT_ID/.test(access))
assert('未过门控不拉档', /if\s*\(\s*!this\._scoreAllowed\s*\)\s*return/.test(load))
assert(
  'getRocketConfigMeta 在守卫之后',
  load.indexOf('_scoreAllowed') >= 0 && load.indexOf('getRocketConfigMeta') > load.indexOf('_scoreAllowed')
)
assert('档案 afterGate', /getRocketConfigMeta\(\{\s*afterGate:\s*true\s*\}\)/.test(load))
assert('缺档只打 ll2RocketConfigDetail', /ll2RocketConfigDetail/.test(pageJs) && !/ll2RocketConfigList/.test(pageJs))
assert('有 id 时先精确匹配再 LL2', /if\s*\(\s*!cfg && this\._configId\s*\)/.test(pageJs) && /有构型 id 时只认这一条/.test(pageJs))
assert('入口不先 toast 没有档案', !/暂无该型号档案/.test(missionNav) && !/暂无该型号档案/.test(monitorNav))
assert('列表快照保留构型 id', /id:\s*cfg\.id != null && cfg\.id !== '' \? cfg\.id : null/.test(read('utils/api-launch-list.js')))
assert('任务详情合并不丢构型 id', /merged\.rocketConfigId = firstNonEmptyId/.test(missionJs))
assert('有 id 不按名称兜底', /String\(id\)\.trim\(\) !== ''/.test(utilJs) && /return compare\.resolveConfig\(configs,\s*id\)/.test(utilJs))
assert('重试重跑门控', /ensureScoreAccess/.test(retry))
assert('分享带 id 和名称兜底', /configId=/.test(shareQ) && /name=/.test(shareQ) && /nameEn=/.test(shareQ))
assert('分享打 sst', /withShareStampPath/.test(pageJs) && /withShareStampQuery/.test(pageJs))
assert('分享落本页不落 Tab', /\/subpackages\/monitor-pages\/rocket-score/.test(pageJs) && !/path:[\s\S]{0,80}\/pages\/monitor\/monitor/.test(pageJs))
assert('分享标题用原始综合分', /rawView\.overallText/.test(pageJs))
assert('入页先写下分享标题', /shareTitle: this\._name \+ ' 档案指数/.test(pageJs))
assert('倒计时组件', /share-gate-countdown/.test(pageWxml) && /share-gate-countdown/.test(pageJson))

assert('同量级折算', /payloadClass/.test(utilJs) && /scoreAgainstPeers/.test(utilJs))
assert('一次性不评复用', /cfg\.reusable !== true\) return null/.test(utilJs))
assert('未首飞不看计划首飞日', /hasFlownConfig/.test(utilJs) && /maiden_flight/.test(utilJs))
assert('综合分至少 3 维', /scoredCount >= 3/.test(utilJs))
assert('免责声明', /不是投票也不是权威排名/.test(utilJs) && /view\.disclaimer/.test(pageWxml))
assert('无 echarts', !/echarts/.test(pageJs) && !/echarts/.test(pageJson))

assert('入场动效', /_playEnterAnim/.test(pageJs) && /score-body--on/.test(pageWxml) && /@keyframes score-rise/.test(pageWxss))
assert('分数跳数', /scoreShown/.test(anim) && /easeOutCubic/.test(pageJs) && /applyScoreProgress/.test(anim))
assert('雷达生长', /_drawRadar\(t\)/.test(anim))
const radarChunk = pageWxml.slice(pageWxml.indexOf('同级画像'), pageWxml.indexOf('维度明细'))
assert('画像只带分数', /item\.scoreShown/.test(radarChunk) && /radar-score/.test(radarChunk) && !/rawText/.test(radarChunk))
assert('头图无水印', !/score-watermark/.test(pageWxml) && !/score-watermark/.test(pageWxss) && !/>INDEX</.test(pageWxml))
assert('头图不提前点亮', !/heroReady:\s*true/.test(anim) && /onHeroLoad/.test(pageJs))
assert('定时器卸页清理', /clearInterval\(this\._animTimer\)/.test(unload))
assert('雷达动画用同一 timer', /that\._animTimer = setInterval/.test(anim))
assert('切主题重绘雷达', /theme\.onThemeChange/.test(pageJs) && /offThemeChange/.test(unload))
assert('浅色反色卡片', /\.theme-light \.glass-card/.test(pageWxss) && /\.container\.theme-light/.test(pageWxss))
assert('浅色头图叠字不反黑', /\.score-name[\s\S]{0,80}color:\s*#fff/.test(pageWxss) && /\.theme-light \.score-hero-mask/.test(pageWxss))
assert('浅色分数走品牌蓝', /\.theme-light \.radar-score/.test(pageWxss) && /\.theme-light \.dim-score/.test(pageWxss))

assert('去对比走对比页', /openRocketCompare/.test(pageJs))
assert('查看档案另过族谱门控', /gateCheck\('booster_genealogy'/.test(pageJs))
assert('加载中先拉档案', /正在拉取型号档案/.test(pageWxml))

console.log(failed ? `\nRESULT: ${failed} FAIL` : '\nRESULT: ALL GREEN')
process.exit(failed ? 1 : 0)
