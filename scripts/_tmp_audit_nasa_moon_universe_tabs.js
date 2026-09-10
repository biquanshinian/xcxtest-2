/**
 * NASA 数据中心：月球探索 / 宇宙探索 Tab 自我审计
 * 运行：node scripts/_tmp_audit_nasa_moon_universe_tabs.js
 */
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
let fail = 0
let okN = 0

function ok(m) { okN++; console.log('  [ok]', m) }
function bad(m) { fail++; console.log('  [FAIL]', m) }

function exists(relPath) {
  return fs.existsSync(path.join(ROOT, relPath))
}

function read(relPath) {
  try {
    return fs.readFileSync(path.join(ROOT, relPath), 'utf8').replace(/\r\n/g, '\n')
  } catch (e) {
    return null
  }
}

function strip(src, kind) {
  if (!src) return ''
  if (kind === 'js' || kind === 'wxss') {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  }
  if (kind === 'wxml') return src.replace(/<!--[\s\S]*?-->/g, '')
  return src
}

function checkSyntax(relPath) {
  if (!exists(relPath)) { bad('缺文件 ' + relPath); return }
  try {
    execFileSync(process.execPath, ['--check', path.join(ROOT, relPath)], { stdio: 'pipe' })
    ok('语法 ' + relPath)
  } catch (e) {
    const msg = e && e.stderr ? String(e.stderr).split('\n')[0] : (e && e.message) || 'check failed'
    bad('语法 ' + relPath + ': ' + msg)
  }
}

function main() {
  const files = {
    pageJs: 'pages/nasa-data/nasa-data.js',
    pageWxml: 'pages/nasa-data/nasa-data.wxml',
    pageWxss: 'pages/nasa-data/nasa-data.wxss',
    pageJson: 'pages/nasa-data/nasa-data.json',
    agencyJs: 'subpackages/monitor-pages/agency-detail.js',
    agencyWxml: 'subpackages/monitor-pages/agency-detail.wxml',
    agencyJson: 'subpackages/monitor-pages/agency-detail.json',
    agencyWxss: 'subpackages/monitor-pages/agency-detail.wxss',
    artemisJs: 'subpackages/monitor-pages/components/monitor-artemis-card/index.js',
    artemisWxml: 'subpackages/monitor-pages/components/monitor-artemis-card/index.wxml',
    artemisWxss: 'subpackages/monitor-pages/components/monitor-artemis-card/index.wxss',
    romanJs: 'subpackages/monitor-pages/components/monitor-roman-card/index.js',
    appJson: 'app.json'
  }

  Object.values(files).forEach((rel) => {
    if (exists(rel)) ok('存在 ' + rel)
    else bad('缺文件 ' + rel)
  })

  ;[
    files.pageJs, files.agencyJs, files.artemisJs, files.romanJs
  ].forEach(checkSyntax)

  const js = read(files.pageJs) || ''
  const wxml = strip(read(files.pageWxml), 'wxml')
  const wxss = read(files.pageWxss) || ''
  let pageJson = {}
  try { pageJson = JSON.parse(read(files.pageJson) || '{}') } catch (e) { bad('nasa-data.json 无法解析') }

  const tabOrder = /key: 'mars'[\s\S]*key: 'moon'[\s\S]*key: 'universe'[\s\S]*key: 'eonet'[\s\S]*key: 'cad'/
  tabOrder.test(js) ? ok('Tab 顺序 火星→月球→宇宙→地球→近地天体') : bad('Tab 顺序错误');
  (/月球探索/.test(js) && /宇宙探索/.test(js)) ? ok('Tab 文案含月球探索/宇宙探索') : bad('缺月球/宇宙 Tab 文案');

  /hidden="\{\{activeTab !== 1\}\}"[\s\S]{0,280}monitor-artemis-card/.test(wxml)
    ? ok('月球 Tab 嵌入 Artemis 卡（hidden，切 Tab 不销毁）')
    : bad('月球 Tab 未嵌入 monitor-artemis-card');
  /hidden="\{\{activeTab !== 2\}\}"[\s\S]{0,280}monitor-roman-card/.test(wxml)
    ? ok('宇宙 Tab 嵌入罗曼卡（hidden，切 Tab 不销毁）')
    : bad('宇宙 Tab 未嵌入 monitor-roman-card');
  const moonBlock = wxml.split('nasaArtemisCard')[0] || '';
  const universeBlock = (wxml.split('nasaArtemisCard')[1] || '').split('nasaRomanCard')[0] || '';
  (/activeTab === 3/.test(wxml) && /eonet-card/.test(wxml))
    ? ok('地球事件下标已后移到 3')
    : bad('地球事件 Tab 下标未更新');
  (/activeTab === 4/.test(wxml) && /cad-card/.test(wxml))
    ? ok('近地天体下标已后移到 4')
    : bad('近地天体 Tab 下标未更新');
  /eonet-card/.test(moonBlock)
    ? bad('地球事件仍占 Tab 1')
    : ok('地球事件不再占用 Tab 1');

  const comps = pageJson.usingComponents || {}
  const ph = pageJson.componentPlaceholder || {}
  comps['monitor-artemis-card'] && ph['monitor-artemis-card']
    ? ok('nasa-data.json 注册 Artemis 卡 + placeholder')
    : bad('nasa-data.json 缺 Artemis 卡或 placeholder');
  comps['monitor-roman-card'] && ph['monitor-roman-card']
    ? ok('nasa-data.json 注册罗曼卡 + placeholder')
    : bad('nasa-data.json 缺罗曼卡或 placeholder');

  const pageJsBare = strip(js, 'js');
  /require\(\s*['"][^'"]*monitor-pages/.test(pageJsBare)
    ? bad('nasa-data.js 同步 require 了 monitor-pages（冷启动会黑屏）')
    : ok('nasa-data.js 未同步 require 监控分包');

  (/selectComponent\('#nasaArtemisCard'\)/.test(js) && /selectComponent\('#nasaRomanCard'\)/.test(js))
    ? ok('下拉刷新会转发给两张任务卡')
    : bad('下拉刷新未转发 Artemis/罗曼卡');
  /tab=/.test(js) ? ok('分享路径带 tab 查询') : bad('分享未带 tab 查询');

  /nasa-embed/.test(wxss) ? ok('嵌入容器样式存在') : bad('缺 .nasa-embed 样式');
  /<view class="nasa-tab-bar"/.test(wxml)
    ? ok('Tab 栏用 view，避免嵌套 enhanced scroll-view')
    : bad('Tab 栏缺失或误用嵌套 scroll-view');
  /\.nasa-tab-item[\s\S]*flex:\s*1/.test(wxss)
    ? ok('五 Tab 均分宽度')
    : bad('Tab 项未均分宽度');

  const agencyJs = strip(read(files.agencyJs), 'js');
  const agencyWxml = strip(read(files.agencyWxml), 'wxml');
  const agencyWxss = read(files.agencyWxss) || '';
  let agencyJson = {}
  try { agencyJson = JSON.parse(read(files.agencyJson) || '{}') } catch (e) { bad('agency-detail.json 无法解析') }

  /monitor-artemis-card/.test(agencyWxml)
    ? ok('发射商详情复用 Artemis 卡')
    : bad('发射商详情未改用 monitor-artemis-card');
  const romanPos = agencyWxml.indexOf('monitor-roman-card');
  const artemisPos = agencyWxml.indexOf('monitor-artemis-card');
  romanPos >= 0 && artemisPos > romanPos
    ? ok('发射商详情罗曼卡仍在 Artemis 上方')
    : bad('发射商详情罗曼/Artemis 顺序被打乱');
  /fetchArtemisIiBriefing/.test(agencyJs)
    ? bad('发射商详情仍内联 Artemis 拉取（应下放到组件）')
    : ok('发射商详情不再内联 Artemis 拉取');
  /\.artemis-brief-card/.test(agencyWxss)
    ? bad('发射商详情仍残留 Artemis 样式（应随组件搬走）')
    : ok('发射商详情已移除 Artemis 样式');
  agencyJson.usingComponents && agencyJson.usingComponents['monitor-artemis-card']
    ? ok('agency-detail.json 注册 Artemis 卡')
    : bad('agency-detail.json 未注册 Artemis 卡');

  const artemisJs = read(files.artemisJs) || '';
  const romanJs = read(files.romanJs) || '';
  /gateCheck\('artemis_telemetry'/.test(artemisJs)
    ? ok('进入 Artemis 完整仪表盘仍走会员门控')
    : bad('Artemis 卡丢失会员门控');
  /gateCheck\(GATE_PRODUCT_ID/.test(romanJs) && /GATE_PRODUCT_ID = 'roman_tracker'/.test(romanJs) && !/allowAd:\s*false/.test(romanJs)
    ? ok('罗曼卡进详情走会员+广告解锁门控')
    : bad('罗曼卡缺少会员/广告门控');
  /scene === 'nasa'/.test(romanJs)
    ? ok('罗曼卡 scene=nasa 任务结束后仍显示')
    : bad('罗曼卡未识别 scene=nasa');
  (/_detached/.test(artemisJs) && /_safeSet/.test(artemisJs) && /_detached/.test(romanJs) && /_safeSet/.test(romanJs))
    ? ok('两卡卸载后不再 setData')
    : bad('两卡缺少 _detached/_safeSet 防护');

  const app = JSON.parse(read(files.appJson) || '{}')
  const preload = app.preloadRule && app.preloadRule['pages/nasa-data/nasa-data']
  preload && Array.isArray(preload.packages) && preload.packages.includes('monitor-pages')
    ? ok('进入 NASA 数据中心会预下载 monitor-pages')
    : bad('缺 nasa-data → monitor-pages 预下载')

  try {
    execFileSync(process.execPath, [path.join(ROOT, 'scripts/_audit_cross_subpackage.js')], {
      cwd: ROOT,
      stdio: 'pipe'
    })
    ok('跨分包审计通过')
  } catch (e) {
    bad('跨分包审计未通过')
  }

  try {
    execFileSync(process.execPath, ['--test', path.join(ROOT, 'test/nasa-data-tabs.test.js')], {
      cwd: ROOT,
      stdio: 'pipe'
    })
    ok('nasa-data-tabs 单测通过')
  } catch (e) {
    bad('nasa-data-tabs 单测失败')
  }

  try {
    execFileSync(process.execPath, ['--test', path.join(ROOT, 'test/roman-tracker.test.js')], {
      cwd: ROOT,
      stdio: 'pipe'
    })
    ok('roman-tracker 单测通过')
  } catch (e) {
    bad('roman-tracker 单测失败')
  }

  console.log('\n结果：' + okN + ' ok / ' + fail + ' fail')
  if (fail) process.exit(1)
}

main()
