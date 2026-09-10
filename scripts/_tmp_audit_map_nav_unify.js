/**
 * 地图页导航统一改动审计（避免 JS/WXML 踩坑）
 * 运行：node scripts/_tmp_audit_map_nav_unify.js
 */
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const PAGES = [
  'subpackages/monitor-pages/launch-site-map',
  'subpackages/monitor-pages/launch-site-detail',
  'subpackages/monitor-pages/orbit-map',
  'subpackages/monitor-pages/pass-map',
  'subpackages/monitor-pages/space-notices/notice-map',
  'subpackages/progress-extra/starbase-map',
  'subpackages/progress-extra/road-closure-map',
  'pages/nasa-data/eonet-map'
]
const BEHAVIOR_FIELDS = new Set([
  'statusBarHeight', 'navPlaceholderHeight', 'tabBarReservedHeight',
  'menuButtonWidth', 'isDirectEntry', 'themeClass', 'themeLight', 'pageBgColor'
])
const BEHAVIOR_METHODS = new Set(['goBack', 'retryLoad', 'initUiShell', 'syncTheme', 'selectTab', 'syncTab'])

let issues = 0
function issue(msg) { issues++; console.log('  ✗', msg) }
function pass(msg) { console.log('  ✓', msg) }

console.log('── JS 语法 ──')
const jsFiles = [
  'utils/util.js',
  'pages/index/index.js',
  'pages/mission-detail/mission-detail.js',
  'subpackages/index-extra/utils/index-live-settle.js',
  'subpackages/monitor-pages/utils/map-page-common.js',
  'subpackages/progress-extra/utils/map-page-common.js',
  'pages/nasa-data/utils/map-page-common.js',
  ...PAGES.map((p) => p + '.js')
]
for (const f of jsFiles) {
  const abs = path.join(ROOT, f)
  if (!fs.existsSync(abs)) { issue('缺失: ' + f); continue }
  try {
    execSync(`node --check "${abs}"`, { stdio: 'pipe' })
    pass('syntax ok: ' + f)
  } catch (e) {
    issue('语法错误: ' + f + ' ' + String(e.stderr || e.message).split('\n')[0])
  }
}

console.log('── WXML ↔ data / 事件 ──')
for (const page of PAGES) {
  const jsPath = path.join(ROOT, page + '.js')
  const wxmlPath = path.join(ROOT, page + '.wxml')
  const js = fs.readFileSync(jsPath, 'utf8')
  const wxml = fs.readFileSync(wxmlPath, 'utf8')
  const hasPageBase = /pageBase|page-base/.test(js)

  const dataFields = new Set(BEHAVIOR_FIELDS)
  const dataBlock = js.match(/data:\s*\{([\s\S]*?)\n\s{2}\}/)
  if (dataBlock) {
    for (const m of dataBlock[1].matchAll(/^\s+([A-Za-z_$][\w$]*)\s*:/gm)) dataFields.add(m[1])
  }
  // createMapBaseState / buildMapLayoutData 注入
  if (/createMapBaseState/.test(js)) {
    ;['loading', 'errorText', 'emptyText', 'analyticsScene', 'shareTitle', 'dataSourceText', 'dataUpdatedText', 'refreshing', 'enableSatellite', 'mapSetting'].forEach((k) => dataFields.add(k))
  }
  if (/buildMapLayoutData/.test(js)) {
    ;['statusBarHeight', 'capsuleTop', 'capsuleHeight', 'menuButtonWidth', 'mapActionTop'].forEach((k) => dataFields.add(k))
  }
  if (hasPageBase) BEHAVIOR_FIELDS.forEach((k) => dataFields.add(k))

  // 首屏 data 必须显式声明 menuButtonWidth（WXML style 绑定，避免首帧 undefined）
  const dataHasMBW = /menuButtonWidth\s*:/.test(js)
  if (wxml.includes('menuButtonWidth') && !dataHasMBW) {
    issue(page + ': WXML 用 menuButtonWidth 但 data 未显式声明默认值')
  }
  const dataHasIDE = /isDirectEntry\s*:/.test(js)
  if (wxml.includes('isDirectEntry') && !dataHasIDE && !hasPageBase) {
    issue(page + ': WXML 用 isDirectEntry 但 data 未声明且无 pageBase')
  }

  const methods = new Set(BEHAVIOR_METHODS)
  for (const m of js.matchAll(/^\s{2}(?:async\s+)?([A-Za-z_$][\w$]*)\s*[(:]/gm)) methods.add(m[1])

  for (const m of wxml.matchAll(/(?:bind|catch)[:]?[a-zA-Z]+\s*=\s*"([A-Za-z_$][\w$]*)"/g)) {
    if (!methods.has(m[1])) issue(page + '.wxml 处理器缺失: ' + m[1])
  }

  // 旧 nav-back 残留
  if (/nav-back(?!--viewer)/.test(wxml)) issue(page + ': 仍残留 nav-back 旧返回按钮')
  if (!/top-nav-slot--back/.test(wxml)) issue(page + ': 未使用统一 top-nav-slot--back')

  // WXML 标签配平（粗检）
  const src = wxml.replace(/<!--[\s\S]*?-->/g, '')
  // map/image 等可为成对标签，勿当 void，否则 </map> 误报
  const VOID = new Set(['input', 'import', 'include', 'wxs'])
  const stack = []
  const re = /<\/?([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g
  let mm
  let bad = ''
  while ((mm = re.exec(src))) {
    const tag = mm[1]
    const whole = mm[0]
    if (whole.startsWith('</')) {
      if (!stack.length || stack[stack.length - 1] !== tag) {
        bad = `闭合 </${tag}> 与栈顶 ${stack[stack.length - 1] || '空'} 不匹配`
        break
      }
      stack.pop()
    } else if (!whole.endsWith('/>') && !VOID.has(tag)) {
      stack.push(tag)
    }
  }
  if (!bad && stack.length) bad = '未闭合: ' + stack.slice(-3).join(',')
  if (bad) issue(page + ' WXML: ' + bad)
  else pass(page + ' WXML/事件检查通过')
}

console.log('── map-page-common 三副本一致性 ──')
const commons = [
  'subpackages/monitor-pages/utils/map-page-common.js',
  'subpackages/progress-extra/utils/map-page-common.js',
  'pages/nasa-data/utils/map-page-common.js'
].map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8'))
const markers = commons.map((s) => ({
  hasMBW: /menuButtonWidth/.test(s),
  hasNavRow: /24 \+ 96/.test(s) || /\(24 \+ 96\)/.test(s),
  hasGap8: /navBottom \+ 8/.test(s)
}))
markers.forEach((m, i) => {
  if (!m.hasMBW || !m.hasNavRow || !m.hasGap8) issue('map-page-common 副本未同步: ' + commons.length + ' #' + i)
  else pass('map-page-common #' + i + ' 已含 menuButtonWidth + 导航下口计算')
})

console.log('\n结果:', issues ? issues + ' 个问题' : '全部通过')
process.exit(issues > 0 ? 1 : 0)
