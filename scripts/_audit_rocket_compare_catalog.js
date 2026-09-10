/**
 * 审计：火箭对比 / 型号档案加载与门控
 * 目标：全绿灯（进了再拉、免费不预热、搜索不打云、族谱先门控再拉档）
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

const comparePage = read('subpackages/monitor-pages/rocket-compare.js')
const compareUtil = read('subpackages/monitor-pages/utils/rocket-compare.js')
const compareWxml = read('subpackages/monitor-pages/rocket-compare.wxml')
const compareWxss = read('subpackages/monitor-pages/rocket-compare.wxss')
const geneJs = read('subpackages/monitor-pages/booster-genealogy.js')
const geneWxml = read('subpackages/monitor-pages/booster-genealogy.wxml')
const geneJson = read('subpackages/monitor-pages/booster-genealogy.json')
const galleries = read('subpackages/monitor-pages/utils/monitor-galleries.js')
const agencyJs = read('subpackages/monitor-pages/agency-detail.js')
const modelJs = read('subpackages/monitor-pages/rocket-model-detail.js')
const boosterJs = read('subpackages/monitor-pages/booster-detail.js')
const services = read('utils/api-app-services.js')
const viewerJs = read('subpackages/rocket-3d/viewer.js')
const aiRich = read('subpackages/shared/utils/ai-chat-rich.js')
const syncLegacy = read('cloudfunctions/syncSpaceDevsData/_legacy.js')
const catalog = read('cloudfunctions/syncSpaceDevsData/config-meta-catalog.js')
const apiProxy = read('cloudfunctions/apiProxy/index.js')
const indexPage = read('pages/index/index.js')
const monitorPage = read('pages/monitor/monitor.js')
const missionPage = read('pages/mission-detail/mission-detail.js')

const compareOnLoad = sliceFn(comparePage, /async onLoad\s*\(\s*options\s*\)\s*\{/, 1800)
const compareAccess = sliceFn(comparePage, /async ensureCompareAccess\s*\(/, 1400)
const compareLoad = sliceFn(comparePage, /async loadCatalog\s*\(\s*\)\s*\{/, 900)
const compareShareQ = sliceFn(comparePage, /_shareQuery\s*\(\s*\)\s*\{/, 400)
const compareShareApp = sliceFn(comparePage, /onShareAppMessage\s*\(\s*\)\s*\{/, 500)
const compareRetry = sliceFn(comparePage, /async onRetryLoad\s*\(\s*\)\s*\{/, 350)
const compareFill = sliceFn(comparePage, /async fillMissingConfigs\s*\(/, 700)
const compareSearch = sliceFn(comparePage, /onSearchInput\s*\(\s*e\s*\)\s*\{/, 400)
const modelOnLoad = sliceFn(modelJs, /async onLoad\s*\(\s*options\s*\)\s*\{/, 2800)
const modelLoad = sliceFn(modelJs, /async loadDetail\s*\(/, 800)
const boosterOnLoad = sliceFn(boosterJs, /async onLoad\s*\(\s*options\s*\)\s*\{/, 2800)
const geneAccess = sliceFn(geneJs, /async ensureCatalogAccess\s*\(/, 1600)
const geneLoad = sliceFn(geneJs, /async loadData\s*\(/, 900)
const metaFn = sliceFn(services, /async function getRocketConfigMeta\s*\(/, 900)
const viewerEnsure = sliceFn(viewerJs, /_ensureMemberAndLoad:\s*function\s*\(/, 1400)
const viewerRefresh = sliceFn(viewerJs, /_refreshCatalog:\s*function\s*\(/, 500)
const viewerToggle = sliceFn(viewerJs, /onTogglePicker:\s*function\s*\(/, 500)
const viewerExhibit = sliceFn(viewerJs, /_loadExhibitMeta:\s*function\s*\(/, 400)
const boosterPreview = sliceFn(galleries, /async loadBoosterGenealogy\s*\(\s*\)\s*\{/, 1200)

// ── 对比页：进了再拉、不翻 LL2 全表 ──
assert('对比 onLoad 走 ensureCompareAccess', /ensureCompareAccess/.test(compareOnLoad) && /if \(allowed\) this\.loadCatalog\(\)/.test(compareOnLoad))
assert('对比分享入口校验', /checkShareEntryGate\(this,\s*options,\s*GATE_PRODUCT_ID/.test(compareAccess))
assert(
  '对比无分享窗口才 gateCheck',
  /if\s*\(\s*!this\.data\.shareGateExpireAt\s*\)/.test(compareAccess) &&
    /gateCheck\(GATE_PRODUCT_ID,\s*GATE_PRODUCT_NAME\)/.test(compareAccess)
)
assert(
  '对比 loadCatalog 在门控之后',
  /ensureCompareAccess/.test(compareOnLoad) &&
    compareOnLoad.indexOf('this.loadCatalog()') > compareOnLoad.indexOf('ensureCompareAccess')
)
assert('对比分享带 ids 且加载中回落入页', /resolveShareIds\(this\.data\.selected,\s*this\._shareIds,\s*this\._catalogReady\)/.test(compareShareQ) || /buildShareQuery\(resolveShareIds/.test(compareShareQ))
assert('对比分享打 sst', /withShareStampPath/.test(compareShareApp) && /withShareStampQuery/.test(comparePage))
assert('对比分享落本页不落 Tab', /\/subpackages\/monitor-pages\/rocket-compare/.test(compareShareApp) && !/\/pages\/monitor\/monitor/.test(compareShareApp))
assert('对比重试重跑门控', /ensureCompareAccess/.test(compareRetry))
assert('对比档案 afterGate', /getRocketConfigMeta\(\{\s*afterGate:\s*true\s*\}\)/.test(compareLoad))
assert('客户端无 ll2RocketConfigList', !/ll2RocketConfigList/.test(comparePage))
assert('客户端无 enrichCatalogFromLl2', !/enrichCatalogFromLl2/.test(comparePage))
assert('缺档只打 ll2RocketConfigDetail', /ll2RocketConfigDetail/.test(comparePage) && /fetchConfigFromLl2/.test(compareFill))
assert('缺档用 idsMissingFromArchive', /idsMissingFromArchive/.test(compareFill))
assert('缺档最多补 MAX_COMPARE 条', /idsMissingFromArchive\([^)]+\)\.slice\(0,\s*MAX_COMPARE\)/.test(compareFill))
assert('对比搜索本地截断', /PICKER_IDLE_LIMIT\s*=\s*36/.test(compareUtil) && /PICKER_SEARCH_LIMIT\s*=\s*48/.test(compareUtil))
assert('选型防抖 280ms', /,\s*280\s*\)/.test(compareSearch))
assert('4 款 PK 走全部 selected', /buildPkView\(selected\)/.test(comparePage) && !/buildPkView\(selected\[0\]/.test(comparePage))
assert('综合返回先回选型', /shouldReturnToPickerOnBack/.test(comparePage) && /function shouldReturnToPickerOnBack/.test(compareUtil))
assert('左绿右蓝', /#07C160/.test(compareWxss) && /#3B82F6/.test(compareWxss))
assert('弱侧 bar-fill--weak', /bar-fill--weak/.test(compareWxml) && /bar-fill--weak/.test(compareWxss))
assert('选型截断提示', /搜索型号或发射商查看更多/.test(compareWxml))

// ── 免费不预热 ──
assert('监控 Tab 不预拉 _config_meta', !/getRocketConfigMeta/.test(galleries))
assert('监控预览传空构型表', /processBoosterList\(\s*list\s*,\s*\{\s*\}/.test(boosterPreview))
assert('监控预览 previewOnly', /previewOnly:\s*true/.test(boosterPreview))
assert('首页不探构型档案', !/getRocketConfigMeta/.test(indexPage) && !/ll2RocketConfigList/.test(indexPage))
assert('监控页不探构型档案', !/getRocketConfigMeta/.test(monitorPage) && !/ll2RocketConfigList/.test(monitorPage))
assert('任务详情不探构型档案', !/getRocketConfigMeta/.test(missionPage) && !/ll2RocketConfigList/.test(missionPage))
assert(
  '免费无 afterGate 不探云',
  /if\s*\(\s*!options\.afterGate\s*\)/.test(metaFn) &&
    /canUsePaidCloudSync[\s\S]{0,180}return \{\s*configs:\s*\{\s*\}/.test(metaFn)
)
assert('档案缓存 key v4', /_rocket_config_meta_v4/.test(services))

// ── 族谱：功能页必须先门控 ──
assert('族谱 onLoad 走 ensureCatalogAccess', /ensureCatalogAccess\(this\._entryOptions\)/.test(geneJs))
assert('族谱分享入口校验', /checkShareEntryGate\(this,\s*options,\s*'booster_genealogy'/.test(geneAccess))
assert('族谱无分享窗口 gateCheck', /gateCheck\('booster_genealogy',\s*'全球可回收火箭族谱'\)/.test(geneAccess))
assert('族谱未过门控不拉档', /if\s*\(\s*!this\._catalogAllowed\s*\)\s*return/.test(geneLoad))
assert(
  '族谱 getRocketConfigMeta 在守卫之后',
  geneLoad.indexOf('_catalogAllowed') >= 0 &&
    geneLoad.indexOf('getRocketConfigMeta') > geneLoad.indexOf('_catalogAllowed')
)
assert('族谱档案 afterGate', /getRocketConfigMeta\(\{\s*afterGate:\s*true\s*\}\)/.test(geneLoad))
assert('族谱型号只留可回收', /m\.reusable === true/.test(geneJs))
assert('族谱分享打 sst', /withShareStampPath/.test(geneJs) && /withShareStampQuery/.test(geneJs))
assert('族谱挂倒计时', /share-gate-countdown/.test(geneWxml) && /share-gate-countdown/.test(geneJson))
assert('族谱重试重跑门控', /onRetryLoad[\s\S]{0,180}ensureCatalogAccess/.test(geneJs))

// ── 详情 / 3D / AI：afterGate 且有门控 ──
assert(
  '型号详情 onLoad 先分享门控再 loadDetail',
  /checkShareEntryGate/.test(modelOnLoad) &&
    modelOnLoad.indexOf('this.loadDetail') > modelOnLoad.indexOf('checkShareEntryGate')
)
assert('型号详情拉档 afterGate', /getRocketConfigMeta\(\{\s*afterGate:\s*true\s*\}\)/.test(modelLoad))
assert('型号详情重试重跑分享门控', /onRetryLoad[\s\S]{0,220}checkShareEntryGate/.test(modelJs))
assert(
  '助推器详情 onLoad 先分享门控再 loadDetail',
  /checkShareEntryGate/.test(boosterOnLoad) &&
    boosterOnLoad.indexOf('this.loadDetail') > boosterOnLoad.indexOf('checkShareEntryGate')
)
assert('助推器详情拉档 afterGate', /getRocketConfigMeta\(\{\s*afterGate:\s*true\s*\}\)/.test(boosterJs))
assert('助推器详情重试重跑分享门控', /onRetryLoad[\s\S]{0,220}checkShareEntryGate/.test(boosterJs))
assert('3D 未过门控不允许拉档', /this\._catalogAllowed = false/.test(viewerEnsure) && /that\._catalogAllowed = true/.test(viewerEnsure))
assert('3D 刷新目录看 _catalogAllowed', /if\s*\(\s*!this\._catalogAllowed\s*\)\s*return/.test(viewerRefresh))
assert('3D 展陈 meta 看 _catalogAllowed', /if\s*\(\s*!this\._catalogAllowed\s*\)\s*return/.test(viewerExhibit))
assert('3D 打开选型看 _catalogAllowed', /memberLocked[\s\S]{0,40}!this\._catalogAllowed/.test(viewerToggle))
assert('3D 档案 afterGate', /getRocketConfigMeta\(\{\s*afterGate:\s*true\s*\}\)/.test(viewerJs))
assert('AI 富卡片 afterGate', (aiRich.match(/getRocketConfigMeta\(\{\s*afterGate:\s*true\s*\}\)/g) || []).length >= 2)

// ── 机构页不预拉全库 ──
assert('机构页不拉 _config_meta', !/getRocketConfigMeta/.test(agencyJs))
assert('机构箭可点靠 LL2 id', /hasDetail:\s*entry\.id != null/.test(agencyJs) && /archiveId:\s*entry\.id != null \? entry\.id : null/.test(agencyJs))

// ── 服务端档案全量、不筛 reusable ──
assert('同步走 config-meta-catalog', /config-meta-catalog/.test(syncLegacy))
assert('清单 URL 无 reusable', /is_placeholder=false/.test(catalog) && !/reusable=/.test(catalog))
assert('同步无 reusable=true&is_placeholder', !/reusable=true&is_placeholder/.test(syncLegacy))
assert('档案不足仍补页', /CONFIG_LIST_MIN_COUNT/.test(catalog) && /catalogNeedsFullRefresh/.test(syncLegacy))
assert('apiProxy 仍保留详情/列表备用', /ll2RocketConfigDetail/.test(apiProxy) && /ll2RocketConfigList/.test(apiProxy))

console.log(failed ? `\nRESULT: ${failed} FAIL` : '\nRESULT: ALL GREEN')
process.exit(failed ? 1 : 0)
