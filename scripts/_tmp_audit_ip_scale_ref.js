/**
 * 本轮审计：3D 页 IP 身高参照（马斯克 1.88m 标尺 / 长征不放 / 后台独立 GLB 入口）
 * 运行：node scripts/_tmp_audit_ip_scale_ref.js
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
  return src.slice(open, open + 4000)
}

console.log('── 等比标尺 ──')
const scale = require('../utils/ip-scale-ref.js')
if (scale.MUSK_REAL_HEIGHT_M !== 1.88) fail('马斯克标尺不是 1.88m')
else ok('马斯克真实身高标尺 1.88m')
if (scale.parseLengthMeters('70 m') !== 70 || scale.parseLengthMeters(124.4) !== 124.4) {
  fail('exhibit 全长字符串解析不对')
} else ok('能吃 exhibit 的「70 m」/ 数字全长')
if (scale.computeIpSceneScale({
  rocketLengthM: 70,
  rocketModelHeight: 70,
  ipModelHeight: 1.88,
  highestPointM: 1.88
}) !== 1) {
  fail('1:1 模型空间缩放不是 1')
} else ok('箭盒 70 / 全长 70m / 人盒 1.88 → 缩放 1')

const shared = scale.resolveFigureSceneScale(
  { ipModelHeight: 2.4, highestPointM: 1.88 },
  { rocketLengthM: 70, rocketModelHeight: 70, rulerModelHeight: 2, rulerHighestPointM: 1.88 }
)
const muskScale = scale.resolveFigureSceneScale(
  { ipModelHeight: 2, highestPointM: 1.88 },
  { rocketLengthM: 70, rocketModelHeight: 70, rulerModelHeight: 2, rulerHighestPointM: 1.88 }
)
if (!(Math.abs(shared - muskScale) < 1e-9)) fail('并排未共用马斯克标尺')
else ok('两人最高点都是 1.88 时共用马斯克缩放')

const custom = scale.resolveFigureSceneScale(
  { ipModelHeight: 2.4, highestPointM: 2.1 },
  { rocketLengthM: 70, rocketModelHeight: 70, rulerModelHeight: 2, rulerHighestPointM: 1.88 }
)
const independent = scale.computeIpSceneScale({
  rocketLengthM: 70,
  rocketModelHeight: 70,
  ipModelHeight: 2.4,
  highestPointM: 2.1
})
if (!(Math.abs(custom - independent) < 1e-9) || !(Math.abs(custom - shared) > 1e-9)) {
  fail('自定义最高点没有独立缩放')
} else ok('自定义最高点按自己的米数对齐')

if (scale.computeIpSceneScale({
  rocketLengthM: 0,
  rocketModelHeight: 10,
  ipModelHeight: 2,
  highestPointM: 1.88
}) !== 0) {
  fail('缺全长仍算出缩放')
} else ok('缺火箭全长不放人')

if (scale.ipRefCosKey('musk') !== 'models/reference/musk.glb') fail('马斯克 COS key 不对')
else if (scale.ipRefCosKey('astro') !== 'models/reference/astro.glb') fail('宇航员 COS key 不对')
else if (scale.ipRefCosKey('falcon-9')) fail('火箭 slug 不该生成 reference key')
else ok('COS key 只认 musk / astro')

console.log('\n── 长征排除 ──')
const hide = [
  { series: true, slug: 'falcon-9' },
  { slug: 'long-march-series' },
  { slug: 'long-march-5' },
  { slug: 'long-march-2f' },
  { name: '长征五号' },
  { rocketName: '长征二号F' },
  { slug: 'long-march' }
]
const show = [
  { slug: 'falcon-9' },
  { slug: 'starship' },
  { slug: 'new-glenn' },
  { slug: 'zhuque-3' },
  { name: '猎鹰 9' }
]
hide.forEach((c) => {
  if (scale.shouldShowIpScaleRef(c)) fail('不该放参照: ' + JSON.stringify(c))
})
show.forEach((c) => {
  if (!scale.shouldShowIpScaleRef(c)) fail('该放参照却排除: ' + JSON.stringify(c))
})
if (!issues.some((m) => /不该放参照|该放参照/.test(m))) {
  ok('长征全系列/家族不放，其它火箭放')
}

console.log('\n── 3D 挂载与取景隔离 ──')
const runtimeSrc = read('subpackages/rocket-3d/runtime.js')
const viewerSrc = read('subpackages/rocket-3d/components/rocket-3d-viewer/index.js')
const viewerWxml = read('subpackages/rocket-3d/viewer.wxml')
const placeBody = fnBody(runtimeSrc, 'placeIpScaleRefs')
const attachBody = fnBody(runtimeSrc, 'attachIpScaleRefs')
const setModelBody = fnBody(runtimeSrc, 'setModel')
const disposeBody = fnBody(runtimeSrc, 'disposeSession')
const boxBody = fnBody(runtimeSrc, 'getRenderableBox')
const standBody = fnBody(runtimeSrc, 'relayoutAfterStandChange')
const wrapBody = fnBody(runtimeSrc, 'wrapStandingModel')

if (!/isIpRefObject\(child\)/.test(boxBody)) fail('取景盒未跳过 IP')
else ok('getRenderableBox 不把人算进取景')
if (/findYawGroup/.test(placeBody) || /yaw\.add\(root\)/.test(placeBody)) fail('人还挂在 r3d-yaw，会跟着火箭转')
else if (!/session\.scene\.add\(root\)/.test(placeBody)) fail('人没有挂到 scene')
else ok('人挂在 scene，不跟火箭转')
if (/findStandGroup/.test(placeBody) && /stand\.add/.test(placeBody)) fail('人被加进 r3d-stand，上下翻会倒过来')
else ok('人不进 r3d-stand')
if (!/r3d-ip-refs/.test(placeBody)) fail('缺 r3d-ip-refs 根节点')
else ok('有独立 r3d-ip-refs 根')
if (!/resolveFigureSceneScale/.test(placeBody)) fail('摆放未走共用标尺')
else ok('摆放用 resolveFigureSceneScale')
if (!/slug === 'musk'/.test(placeBody)) fail('标尺角色不是马斯克优先')
else ok('并排以马斯克为标尺')
if (typeof scale.ipStandingStride !== 'function') fail('缺 ipStandingStride')
else {
  const stride = scale.ipStandingStride({ x: 1.8, y: 1.88, z: 0.4 })
  if (!(stride.step > 1.8) || stride.gap < 1.88 * 0.45) fail('举手姿态还会叠身或缝太窄')
  else if (stride.step >= 1.8 + 1.88 * 0.7) fail('步长被整臂展拉开')
  else ok('并排步长按举手跨度留出身位缝')
}
if (typeof scale.sortIpFiguresForStand !== 'function') fail('缺落地左右排序')
else if (scale.sortIpFiguresForStand([{ slug: 'musk' }, { slug: 'astro' }]).map((item) => item.slug).join(',') !== 'astro,musk') {
  fail('落地顺序不是星问左、马斯克右')
} else ok('落地显式排成星问左、马斯克右')
if (!/ipStandingStride/.test(placeBody) || /cursor \+= size\.x/.test(placeBody) || /rocketH \* 0\./.test(placeBody)) {
  fail('落位还在用臂展或火箭高度当间距')
} else ok('落位按肩宽挨着站')
if (!/rememberIpFigureCore/.test(placeBody) || !/ipCoreCenterFromPoints/.test(runtimeSrc)) {
  fail('落位还在用整模包围盒心，举手和装饰件会把人拽偏')
} else ok('落位按身体主体中心，不认举手和装饰件')
if (!/pickIpStandBesideRocket/.test(placeBody) || !/getIpCollisionBox/.test(placeBody)) {
  fail('缺少火箭/参照碰撞预测')
} else ok('大箭按船体碰撞预测站位')
if (!/ipRefToken/.test(setModelBody) || !/clearIpScaleRefs/.test(setModelBody)) {
  fail('换箭未作废进行中的 IP 加载')
} else ok('setModel 作废旧 IP 再换箭')
if (!/ipRefToken/.test(disposeBody) || !/clearIpScaleRefs/.test(disposeBody)) {
  fail('销毁会话未作废 IP 加载')
} else ok('disposeSession 作废并卸掉 IP')
if (!/session.ipRefToken !== token/.test(attachBody) || !/!session.modelRoot/.test(attachBody)) {
  fail('异步装人未校验会话仍活着')
} else ok('装人完成时校验 token / modelRoot')
if (!/\.catch\(function \(\) \{\s*return null/.test(attachBody)) fail('单人加载失败会拖垮并排')
else ok('单人 GLB 失败不影响另一个')
if (/placeIpScaleRefs\(session, session.rocketLengthM\)/.test(standBody)) {
  fail('翻转后还会挪人，应和尺寸线一样固定')
} else ok('翻转后人不跟着挪')
const stageBody = fnBody(runtimeSrc, 'layoutExhibitStage')
if (/size\.y \* 0\.02/.test(stageBody) || /box\.min\.y - gap/.test(stageBody)) {
  fail('圆形地板还在火箭底下留约 1 米缝')
} else if (!/exhibitStageClearance/.test(stageBody)) {
  fail('展台净空不是 0 米')
} else ok('圆形地板按 0 米净空贴模型')
if (!/gltfAnimations/.test(runtimeSrc) || !/playIpFigureClips/.test(placeBody) || !/updateIpFigureMixers/.test(fnBody(runtimeSrc, 'startLoop'))) {
  fail('IP 有动画片段也不会播')
} else ok('GLB 里有待机片段时会循环播放')
const setDimBody = fnBody(runtimeSrc, 'setDimensionGuides')
const emitBody = fnBody(runtimeSrc, 'emitDimLabels')
const growBody = fnBody(runtimeSrc, 'updateDimensionGrow')
if (!/appendIpHeightGuides/.test(setDimBody)) fail('点尺寸时没有给 IP 加高度线')
else ok('尺寸模式会给 IP 加一条高度线')
if (!/key: 'iph'/.test(emitBody) || !/captions\.ipHeight/.test(emitBody)) fail('尺寸标签没有 IP 高度')
else ok('IP 高度走 dim chip，key=iph')
if (!/meta.ipHeight/.test(growBody)) fail('IP 高度线没有跟尺寸生长动画')
else ok('IP 高度线和火箭尺寸一起生长')
if (!/formatHeightCaption/.test(runtimeSrc)) fail('IP 高度文案没走 formatHeightCaption')
else ok('IP 高度文案与火箭「70 m」同格式')
if (!/_exhibitMode === 'size'/.test(viewerSrc) || !/attachIpScaleRefs[\s\S]*_applyDimGuides/.test(viewerSrc)) {
  fail('人装完后尺寸模式不会补 IP 高度')
} else ok('人晚到时尺寸模式会补高度线')
if (/wrapStandingModel/.test(attachBody)) fail('IP 被套了立起包装')
else ok('IP 不走火箭立起包装')
if (!/r3d-yaw/.test(wrapBody) || !/r3d-stand/.test(wrapBody)) fail('火箭场景图被改坏')
else ok('火箭仍是 exhibit-root → yaw → stand')
if (!/dim-length="\{\{exhibit.length\}\}"/.test(viewerWxml)) fail('3D 页没把全长传给组件')
else ok('viewer 绑定 exhibit.length')
if (!/_syncIpScaleRefs/.test(viewerSrc) || !/dimLength, dimDiameter/.test(viewerSrc)) {
  fail('全长到达后不会重放参照')
} else ok('全长 observer 会重放/加载参照')
if (!/shouldShowIpScaleRef/.test(viewerSrc) || !/clearIpScaleRefs/.test(viewerSrc)) {
  fail('长征任务未清掉已装的人')
} else ok('长征判定后会清参照')
if (!/revalidateCloudMediaMap/.test(viewerSrc)) fail('映射里还没有人时不会拉一次新目录')
else ok('目录为空会 revalidate 媒体映射')
if (!/listEnabled\(\)/.test(viewerSrc) || !/sortIpFiguresForStand/.test(viewerSrc)) fail('组件未读已启用 IP 目录或没按左右排序')
else ok('组件只装已启用的 IP，落地再排成星问左马斯克右')

const runtime = require('../subpackages/rocket-3d/runtime.js')
if (typeof runtime.attachIpScaleRefs !== 'function' || typeof runtime.placeIpScaleRefs !== 'function') {
  fail('runtime 未导出 IP API')
} else ok('runtime 导出 attach / place / clear')
if (typeof runtime.exhibitStageClearance !== 'function' || runtime.exhibitStageClearance() !== 0) {
  fail('展台净空不是 0 米')
} else ok('火箭和参照贴圆形地板，净空 0 米')
if (runtime.placeIpScaleRefs(null, 70) !== false) fail('空会话 place 未早退')
else ok('空会话 place / clear 早退')
const dead = { ipRefToken: 4, scene: { remove() {}, traverse() {} } }
runtime.disposeSession(dead)
if (!(dead.ipRefToken > 4)) fail('disposeSession 未增加 ipRefToken')
else ok('销毁会话会作废进行中的装人')

console.log('\n── 目录与映射 ──')
const ready = require('../utils/ip-reference-ready.js')
ready.ingest({
  ipScaleRefs: {
    astro: { url: 'https://x/astro.glb', highestPoint: 1.88, enabled: true },
    musk: { url: 'https://x/musk.glb', highestPoint: 1.88, enabled: true },
    other: { url: 'https://x/no.glb', highestPoint: 1.88, enabled: true }
  }
})
const listed = ready.listEnabled().map((item) => item.slug)
if (listed.join(',') !== 'musk,astro') fail('启用顺序不是 musk → astro，或收进了杂 slug')
else ok('listEnabled 顺序 musk → astro')

const extracted = ready.extractFromMediaMap(
  {
    'models/reference/musk.glb': 'https://x/musk.glb',
    'models/rockets/falcon-9.glb': 'https://x/f9.glb'
  },
  { musk: { highestPoint: 2.05 } }
)
if (!extracted.musk || extracted.musk.highestPoint !== 2.05 || extracted.astro) {
  fail('extractFromMediaMap 串了火箭或没带最高点')
} else ok('媒体映射只认 models/reference，并带最高点')

const r3dReady = require('../utils/rocket-3d-ready.js')
const rocketMap = r3dReady.extractFromMediaMap({
  'models/reference/musk.glb': 'https://x/musk.glb',
  'models/rockets/falcon-9.glb': 'https://x/f9.glb'
})
if (rocketMap.musk || !rocketMap['falcon-9']) fail('火箭目录吃进了 IP GLB')
else ok('rocket-3d-ready 不认 reference 前缀')

const imageCfg = read('utils/image-config.js')
if (!/ipScaleRefs/.test(imageCfg) || !/parseIpRefGlbKey/.test(imageCfg)) {
  fail('image-config 未接入 IP 映射')
} else ok('image-config 下发/缓存 ipScaleRefs')
if (!/highestPoint: true/.test(imageCfg)) fail('DB fallback 没读 highestPoint')
else ok('DB fallback 带 highestPoint')

console.log('\n── 后台独立入口 ──')
const adminPage = 'admin-web/src/views/media/IpReferenceGlbPage.vue'
const router = read('admin-web/src/router/index.js')
const layout = read('admin-web/src/views/shell/LayoutPage.vue')
if (!exists(adminPage)) fail('缺 IpReferenceGlbPage.vue')
else ok('有独立后台页')
const pageSrc = exists(adminPage) ? read(adminPage) : ''
if (!/models\/reference\//.test(pageSrc) || /models\/rockets\//.test(pageSrc)) {
  fail('后台页 COS 前缀不是 models/reference/')
} else ok('后台页只写 models/reference/')
if (!/slug: 'musk'/.test(pageSrc) || !/slug: 'astro'/.test(pageSrc)) fail('后台不是固定两张卡')
else ok('固定马斯克 / 宇航员两张卡')
if (!/highestPoint/.test(pageSrc) || !/:min="0.3"/.test(pageSrc) || !/:max="5"/.test(pageSrc)) {
  fail('最高点控件范围不对')
} else ok('最高点 0.3–5 米可保存')
if (!/GlbPreview/.test(pageSrc)) fail('后台没有 GLB 预览')
else ok('后台用 GlbPreview 预览')
if (!/ip-reference-glb/.test(router) || !/IpReferenceGlbPage/.test(router) || !/perm: 'cos_storage'/.test(router.split('ip-reference-glb')[1] || '')) {
  fail('路由未挂 cos_storage')
} else ok('路由 /ip-reference-glb，权限同火箭 3D')
if (!/index="\/ip-reference-glb"/.test(layout) || !/IP 身高参照/.test(layout)) {
  fail('侧栏或标题没入口')
} else ok('资源与 3D 菜单有「IP 身高参照」')

const preview = read('admin-web/src/components/media/GlbPreview.vue')
if (/autoStandRotation|wrapStandingModel/.test(preview)) fail('后台预览不该套立起包装')
else ok('后台预览仍按 GLB 原朝向')

console.log('\n── 网关 ──')
const udg = read('cloudfunctions/userDataGateway/index.js')
const agw = read('cloudfunctions/adminGateway/index.js')
if (!/ipScaleRefs/.test(udg) || !/highestPoint: true/.test(udg) || !/\^models\/reference\//.test(udg)) {
  fail('userDataGateway 未下发 ipScaleRefs / 截断补拉')
} else ok('getMediaAssetsMap 带 ipScaleRefs，截断时补拉 reference')
if (!/parseIpRefGlbKey/.test(udg) || !/ip-musk/.test(udg)) fail('网关未兼容 ip-musk 别名')
else ok('网关兼容 ip-musk / ip-astro 别名')
if (!/highestPoint/.test(fnBody(agw, 'updateMediaAsset')) || !/highestPoint/.test(fnBody(agw, 'createMediaAsset'))) {
  fail('adminGateway 未放行 highestPoint')
} else ok('create / update 白名单含 highestPoint')
if (!/models\\\/reference/.test(fnBody(agw, 'createMediaAsset'))) {
  fail('新建 reference 资源未默认 1.88')
} else ok('新建 IP 记录默认最高点 1.88')

const udgParse = fnBody(udg, 'parseIpRefGlbKey')
const utilParse = fnBody(read('utils/ip-scale-ref.js'), 'parseIpRefGlbKey')
if (!udgParse || !utilParse) fail('解析函数缺失')
else if (!/ip-musk/.test(udgParse) || !/models\\\/reference/.test(utilParse)) fail('解析规则不一致')
else ok('网关与小程序解析规则对齐')

console.log('\n── 语法与单测 ──')
const files = [
  'utils/ip-scale-ref.js',
  'utils/ip-reference-ready.js',
  'utils/image-config.js',
  'subpackages/rocket-3d/runtime.js',
  'subpackages/rocket-3d/components/rocket-3d-viewer/index.js',
  'cloudfunctions/userDataGateway/index.js',
  'cloudfunctions/adminGateway/index.js',
  'subpackages/rocket-3d/ip-intro.js',
  'subpackages/rocket-3d/ip-anim.js',
  'test/ip-anim.test.js',
  'test/ip-scale-ref.test.js',
  'test/ip-intro.test.js',
  'test/ip-reference-ready.test.js'
]
files.forEach((rel) => {
  if (!exists(rel)) fail('缺文件 ' + rel)
  else if (!syntaxOk(rel)) fail(rel + ' 语法错误')
  else ok(rel + ' 语法通过')
})

const tests = spawnSync(
  process.execPath,
  [
    '--test',
    'test/ip-scale-ref.test.js',
    'test/ip-anim.test.js',
    'test/ip-intro.test.js',
    'test/ip-reference-ready.test.js',
    'test/xingwen-exhibit-cards.test.js',
    'test/rocket-3d-audit.test.js',
    'test/rocket-3d-models.test.js',
    'test/rocket-3d-exhibit.test.js',
    'test/rocket-3d-bind.test.js',
    'test/xingwen-exhibit-cards.test.js'
  ],
  { cwd: ROOT, encoding: 'utf8' }
)
if (tests.status !== 0) {
  fail('单测失败')
  console.log(tests.stdout || tests.stderr)
} else {
  const m = String(tests.stdout || '').match(/# (?:tests|pass|fail)[^\n]*/g)
  ok('单测通过' + (m && m.length ? ' (' + m.join(', ') + ')' : ''))
}

console.log('\n── 结果 ──')
if (issues.length) {
  console.log('未通过 ' + issues.length + ' 项：')
  issues.forEach((m) => console.log('  - ' + m))
  process.exit(1)
}
console.log('全绿灯')
