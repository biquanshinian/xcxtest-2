/**
 * 本轮审计：3D 页点「尺寸」给 IP 一条高度 + IP 不跟火箭转
 * 运行：node scripts/_tmp_audit_ip_dim_fixed.js
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
  return fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n')
}

function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel))
}

function syntaxOk(rel) {
  const r = spawnSync(process.execPath, ['--check', path.join(ROOT, rel)], { encoding: 'utf8' })
  return r.status === 0
}

function fnBody(src, name) {
  const re = new RegExp('function\\s+' + name + '\\s*\\(')
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
  return src.slice(open)
}

function runNode(args) {
  return spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8' })
}

console.log('── 尺寸按钮链路 ──')
const viewerWxml = read('subpackages/rocket-3d/viewer.wxml')
const viewerJs = read('subpackages/rocket-3d/viewer.js')
const compJs = read('subpackages/rocket-3d/components/rocket-3d-viewer/index.js')
const compWxml = read('subpackages/rocket-3d/components/rocket-3d-viewer/index.wxml')
const runtimeSrc = read('subpackages/rocket-3d/runtime.js')

if (!/data-tab="size"/.test(viewerWxml) || !/>尺寸</.test(viewerWxml)) fail('3D 页没有尺寸按钮')
else ok('3D 页有尺寸 tab')
if (!/onExhibitTab/.test(viewerJs) || !/_playExhibitView\('size'\)/.test(viewerJs) && !/_playExhibitView\(tab\)/.test(viewerJs)) {
  fail('点尺寸没有走到 playExhibitView')
} else ok('点尺寸走 onExhibitTab → playExhibitView')
if (!/dim-length="\{\{exhibit.length\}\}"/.test(viewerWxml) || !/dim-diameter="\{\{exhibit.diameter\}\}"/.test(viewerWxml)) {
  fail('尺寸数字没传给 3D 组件')
} else ok('全长 / 直径绑到组件')
if (!/playExhibitView: function/.test(compJs) || !/_applyDimGuides/.test(compJs)) fail('组件没开尺寸线')
else ok('组件 playExhibitView 会开尺寸线')
if (!/r3d-dim-layer/.test(compWxml) || !/dimLabels/.test(compWxml)) fail('尺寸数字层缺失')
else ok('尺寸 chip 层还在')

console.log('\n── IP 只要一条高度 ──')
const setDimBody = fnBody(runtimeSrc, 'setDimensionGuides')
const appendBody = fnBody(runtimeSrc, 'appendIpHeightGuides')
const pickBody = fnBody(runtimeSrc, 'pickIpDimFigure')
const emitBody = fnBody(runtimeSrc, 'emitDimLabels')
const growBody = fnBody(runtimeSrc, 'updateDimensionGrow')

if (!/appendIpHeightGuides/.test(setDimBody)) fail('setDimensionGuides 没给人加高度')
else ok('点尺寸会 appendIpHeightGuides')
if (!appendBody) fail('缺 appendIpHeightGuides')
else if (/ipWidth|ipDiameter|captions\.diameter/.test(appendBody)) fail('IP 尺寸线加了直径')
else if (!/captions\.ipHeight/.test(appendBody) || !/formatHeightCaption/.test(appendBody)) {
  fail('IP 高度文案没走 formatHeightCaption')
} else ok('IP 只加高度，文案走 formatHeightCaption')
if (!/slug === 'musk'/.test(pickBody)) fail('高度标尺不是马斯克优先')
else ok('高度标尺马斯克优先，否则第一人')
if ((emitBody.match(/key: 'iph'/g) || []).length !== 1) fail('尺寸标签不是恰好一条 IP 高度')
else if (/iph-musk|iph-astro/.test(emitBody)) fail('IP 高度拆成了多人多条')
else ok('尺寸标签只有一条 IP 高度（key=iph）')
if (!/meta.ipHeight/.test(growBody) || !/meta.ipHFrom/.test(growBody)) fail('IP 高度线没跟生长动画')
else ok('IP 高度线和火箭尺寸一起生长')
if (/ipWidth/.test(growBody)) fail('生长动画里给 IP 加了宽度')
else ok('生长动画没有 IP 直径')
if (!/formatHeightCaption/.test(read('utils/ip-scale-ref.js'))) fail('缺 formatHeightCaption')
else ok('标尺工具能格式化「1.88 m」')
if (!/_exhibitMode === 'size'/.test(compJs) || !/attachIpScaleRefs[\s\S]*_applyDimGuides/.test(compJs)) {
  fail('人晚到时尺寸模式不会补高度')
} else ok('人晚到会补 IP 高度线')
if (!/clearIpScaleRefs[\s\S]*_applyDimGuides/.test(compJs)) fail('长征清人后尺寸线不会去掉 IP 高度')
else ok('清掉人之后尺寸模式会重画（去掉 IP 高度）')

console.log('\n── IP 固定不跟火箭转 ──')
const placeBody = fnBody(runtimeSrc, 'placeIpScaleRefs')
const standBody = fnBody(runtimeSrc, 'relayoutAfterStandChange')
const loopBody = fnBody(runtimeSrc, 'startLoop')
const dimBody = fnBody(runtimeSrc, 'setDimensionGuides')

if (/findYawGroup/.test(placeBody) || /yaw\.add/.test(placeBody) || /modelRoot\.add/.test(placeBody)) {
  fail('人还挂在 yaw / modelRoot，会跟着转')
} else if (!/session\.scene\.add\(root\)/.test(placeBody)) fail('人没有挂到 scene')
else ok('人挂在 scene，不进 yaw / modelRoot')
if (/findStandGroup/.test(placeBody) && /stand\.add/.test(placeBody)) fail('人被加进 r3d-stand')
else ok('人不进 r3d-stand')
if (/placeIpScaleRefs\(session, session.rocketLengthM\)/.test(standBody)) fail('翻转后还会挪人')
else ok('翻转后人不跟着挪，和尺寸线一样固定')
if (!/modelRoot\.rotation\.y \+= 0\.004/.test(loopBody)) fail('自转不再只转 modelRoot')
else if (/ipRefRoot\.rotation|scene\.rotation/.test(loopBody)) fail('自转带动了 scene / IP')
else ok('自转只转 modelRoot，带不走 IP 和尺寸线')
if (!/session\.scene\.add\(group\)/.test(dimBody)) fail('尺寸线没挂 scene')
else ok('火箭尺寸线仍挂 scene')
if (!/isIpRefObject\(child\)/.test(fnBody(runtimeSrc, 'getRenderableBox'))) fail('取景盒未跳过 IP')
else ok('取景仍不把人算进去')

console.log('\n── 行为模拟 ──')
const runtime = require('../subpackages/rocket-3d/runtime.js')
const ipScale = require('../utils/ip-scale-ref.js')
if (ipScale.formatHeightCaption(1.88) !== '1.88 m') fail('1.88 格式不是「1.88 m」')
else ok('formatHeightCaption(1.88) = 1.88 m')
if (ipScale.formatHeightCaption(null) !== '1.88 m') fail('缺省高度文案不是 1.88 m')
else ok('缺省高度也是 1.88 m')
if (runtime.placeIpScaleRefs(null, 70) !== false) fail('空会话 place 未早退')
else ok('空会话 place 早退')
if (typeof runtime.setDimensionGuides !== 'function') fail('未导出 setDimensionGuides')
else ok('runtime 导出 setDimensionGuides / placeIpScaleRefs')

console.log('\n── 长征 / 系列排除 ──')
if (ipScale.shouldShowIpScaleRef({ slug: 'long-march-5' }) !== false) fail('长征五号不该放人')
else ok('长征成员不放人')
if (ipScale.shouldShowIpScaleRef({ series: true, slug: 'falcon-9' }) !== false) fail('全系列不该放人')
else ok('全系列不放人')
if (ipScale.shouldShowIpScaleRef({ slug: 'falcon-9' }) !== true) fail('猎鹰 9 该放人')
else ok('猎鹰 9 等非长征放人')
if (!/全系列模型不标注尺寸/.test(viewerJs) || !/exhibit\.series/.test(viewerJs)) fail('全系列点尺寸未拦截')
else ok('全系列点尺寸会拦截')

console.log('\n── IP 特写自我介绍 ──')
const introSrc = read('subpackages/rocket-3d/ip-intro.js')
const introUtil = require('../subpackages/rocket-3d/ip-intro.js')
if (introUtil.getIpIntro('astro').name !== '星问') fail('宇航员介绍名不是星问')
else ok('宇航员 IP 介绍名：星问')
if (!/一米八八/.test(introUtil.joinIntroLines(introUtil.getIpIntro('musk')))) fail('马斯克介绍没写身高')
else ok('马斯克介绍含一米八八')
if (!/playIpIntroView/.test(runtimeSrc) || !/pickIpRefAt/.test(runtimeSrc)) fail('runtime 没有特写 / 点选')
else ok('runtime 有点选与特写')
if (/lockIpIntroControls\(session\)/.test(fnBody(runtimeSrc, 'playIpIntroView')) || /enableRotate = false/.test(fnBody(runtimeSrc, 'playIpIntroView'))) {
  fail('特写又锁死轨道了')
} else ok('特写不锁轨道，还能拖转')
if (!/openIpIntro/.test(compJs) || !/onIpIntroBubble/.test(compJs)) fail('组件没有打开/跳过打字')
else ok('点 IP 打开气泡，点气泡跳过打字')
if (!/轻点空白处返回/.test(compWxml) || !/r3d-ip-bubble/.test(compWxml)) fail('气泡 UI 缺失')
else ok('气泡对话框和返回提示在')
if (!/bind:ipintro="onIpIntro"/.test(viewerWxml)) fail('页面没接介绍事件')
else ok('页面会接特写事件并压暗底栏')
if (!/r3d-ip-expand/.test(read('subpackages/rocket-3d/components/rocket-3d-viewer/index.wxss'))) fail('气泡没有弹出动效')
else ok('气泡有弹出 / 光标闪动效')

console.log('\n── 语法 ──')
;[
  'utils/ip-scale-ref.js',
  'utils/ip-reference-ready.js',
  'subpackages/rocket-3d/ip-intro.js',
  'subpackages/rocket-3d/runtime.js',
  'subpackages/rocket-3d/components/rocket-3d-viewer/index.js',
  'subpackages/rocket-3d/viewer.js',
  'test/ip-scale-ref.test.js',
  'test/ip-intro.test.js',
  'test/rocket-3d-audit.test.js',
  'scripts/_tmp_audit_ip_scale_ref.js'
].forEach((rel) => {
  if (!exists(rel)) fail('缺文件 ' + rel)
  else if (!syntaxOk(rel)) fail(rel + ' 语法错误')
  else ok(rel + ' 语法通过')
})

console.log('\n── 回归单测与旧审计 ──')
const tests = runNode([
  '--test',
  'test/ip-scale-ref.test.js',
  'test/ip-intro.test.js',
  'test/ip-reference-ready.test.js',
  'test/rocket-3d-audit.test.js',
  'test/rocket-3d-models.test.js',
  'test/rocket-3d-exhibit.test.js',
  'test/rocket-3d-bind.test.js'
])
if (tests.status !== 0) {
  fail('3D / IP 单测失败')
  console.log(tests.stdout || tests.stderr)
} else {
  const m = String(tests.stdout || '').match(/# (?:tests|pass|fail)[^\n]*/g)
  ok('3D / IP 单测通过' + (m && m.length ? ' (' + m.join(', ') + ')' : ''))
}

const nested = [
  ['scripts/_tmp_audit_ip_scale_ref.js', 'IP 标尺旧审计'],
  ['scripts/_tmp_audit_ios_3d_shade.js', 'iOS 着色审计'],
  ['scripts/_tmp_audit_series_3d_orient.js', '全系列朝向审计']
]
nested.forEach(([rel, label]) => {
  const r = runNode([rel])
  const out = String(r.stdout || '') + String(r.stderr || '')
  if (r.status !== 0 || !/(全绿灯|结论：通过)/.test(out)) {
    fail(label + '未全绿')
    const last = out.trim().split('\n').slice(-8).join('\n')
    if (last) console.log(last)
  } else ok(label + '全绿灯')
})

console.log('\n── 结果 ──')
if (issues.length) {
  console.log('未通过 ' + issues.length + ' 项：')
  issues.forEach((m) => console.log('  - ' + m))
  process.exit(1)
}
console.log('全绿灯')
