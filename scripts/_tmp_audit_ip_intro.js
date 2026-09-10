/**
 * 本轮审计：3D 页点 IP 特写锁定 + 气泡自我介绍
 * 运行：node scripts/_tmp_audit_ip_intro.js
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

console.log('── 文案与点选 ──')
const intro = require('../subpackages/rocket-3d/ip-intro.js')
const astro = intro.getIpIntro('astro')
const musk = intro.getIpIntro('musk')
if (!astro || astro.name !== '星问' || astro.title !== '向导') fail('宇航员介绍不是星问向导')
else ok('宇航员 IP 叫星问，身份是向导')
if (!/星问/.test(astro.lines[0]) || !/向导/.test(astro.lines.join(''))) fail('星问自我介绍缺名字或身份')
else ok('星问气泡先报名再自我介绍')
if (!musk || musk.name !== '马斯克') fail('马斯克介绍名不对')
else if (!/一米八八/.test(musk.lines.join(''))) fail('马斯克没说身高')
else ok('马斯克介绍含一米八八标尺')
if (intro.getIpIntro('falcon-9')) fail('杂 slug 也能出介绍')
else ok('只有 musk / astro 有介绍')
if (intro.pickHitSlug(
  [
    { slug: 'musk', left: 0, top: 0, right: 200, bottom: 200 },
    { slug: 'astro', left: 80, top: 80, right: 110, bottom: 130 }
  ],
  90,
  100
) !== 'astro') {
  fail('重叠点选没点到更小的人')
} else ok('重叠时点更小的人')
if (intro.pickHitSlug([], 10, 10) !== '') fail('空热区还能点中')
else ok('点空处不会误中')
if (intro.nextTypeDelay('。') <= intro.nextTypeDelay('问')) fail('句号没有更长停顿')
else ok('打字：句号 / 换行停顿更长')

console.log('\n── 特写不锁轨道 ──')
const runtimeSrc = read('subpackages/rocket-3d/runtime.js')
const compJs = read('subpackages/rocket-3d/components/rocket-3d-viewer/index.js')
const compWxml = read('subpackages/rocket-3d/components/rocket-3d-viewer/index.wxml')
const compWxss = read('subpackages/rocket-3d/components/rocket-3d-viewer/index.wxss')
const viewerJs = read('subpackages/rocket-3d/viewer.js')
const viewerWxml = read('subpackages/rocket-3d/viewer.wxml')
const placeBody = fnBody(runtimeSrc, 'placeIpScaleRefs')
const pickBody = fnBody(runtimeSrc, 'projectBoxToCssRect')
const playBody = fnBody(runtimeSrc, 'playIpIntroView')
const loopBody = fnBody(runtimeSrc, 'startLoop')

if (!/playIpIntroView/.test(runtimeSrc) || !/pickIpRefAt/.test(runtimeSrc)) fail('runtime 缺特写 / 点选')
else ok('runtime 导出点选与特写')
if (!/!p.visible/.test(pickBody)) fail('点选热区用了镜头背后的投影，会点到整屏')
else ok('点选只认屏幕上看得见的角点')
if (/lockIpIntroControls\(session\)/.test(playBody) || /enableRotate = false/.test(playBody)) fail('特写又锁死轨道了')
else ok('特写只推镜头，不锁拖转')
if (!/autoRotate = false/.test(playBody)) fail('特写没停自转')
else ok('特写时停自转，手还能拖')
if (!/camTween/.test(playBody) || !/ipIntroCameraPose/.test(playBody)) fail('特写没有镜头推进')
else ok('点人后镜头推到脸前')
if (!/ipFigureFocusBox/.test(playBody)) fail('特写还在盯整模包围盒，举手会把人看偏')
else ok('特写盯身体主体，不认举手和装饰件')
if (!/getExhibitFrameBox/.test(playBody) || !/ipIntroClipBox/.test(playBody) || /applyBoxClip\(session\.camera, box,/.test(playBody)) {
  fail('特写还在按人身裁近远，火箭会被剪出画')
} else ok('特写裁切带上火箭，箭留在画面里')
if (/rocketSpan \* 1\.05/.test(fnBody(runtimeSrc, 'ipIntroCameraPose')) || /reach \* 0\.92/.test(fnBody(runtimeSrc, 'ipIntroCameraPose'))) {
  fail('点 IP 还按火箭全长拉远，人会小得看不清')
} else ok('点 IP 镜头跟人走，能看清形象')
if (/!this.data.ipIntro.open\) h.touchstart/.test(compJs)) fail('对话时还在挡轨道触摸')
else ok('介绍/对话时触摸仍交给轨道')
if (!/layoutHeadLockOverlay|measureHeadLockLayout/.test(runtimeSrc) || !/!anchor.visible/.test(compJs) || !/'ipIntro.visible': false/.test(compJs)) {
  fail('头出画时马斯克框还会悬空')
} else ok('头出画时气泡收起，不钉在空处')
if (!/ipIntro.slug === 'musk' && ipIntro.visible/.test(compWxml)) fail('出画还不藏马斯克框')
else ok('打开立刻出框，头出画才藏')
if (/layoutVirtualScreen/.test(fnBody(runtimeSrc, 'emitIpIntroAnchor'))) fail('马斯克气泡被虚拟屏朝向门控藏掉')
else ok('马斯克气泡按头顶投影走，不走 3D 板门控')
if (/attachMuskIntroPanel\(this\._session\)/.test(compJs)) fail('马斯克又挂了 3D 板，远景会弹不出框')
else ok('马斯克不再挂 3D 板')
if (/faceIpFiguresToCamera/.test(placeBody) || /\+ Math\.PI/.test(fnBody(runtimeSrc, 'faceIpFiguresToCamera'))) {
  fail('还在用背向 +π 拧人，新正向 GLB 会再背对镜头')
} else ok('沿用 GLB 正向，不再做背向补偿')
if (!/rotation\.y = 0/.test(placeBody) && !/rotation\.set\(0, 0, 0\)/.test(placeBody)) {
  fail('重摆人时没先回正，脚底对不齐')
} else ok('落地先回正再量脚底')
if (!/ipStandingStride/.test(placeBody) || /cursor \+= size\.x/.test(placeBody) || /size\.x \* 0\./.test(placeBody) || /rocketH \* 0\./.test(placeBody)) {
  fail('间距还在用臂展或火箭高度，两人会被拉开')
} else ok('两人按身高肩宽留缝站，不认臂展当火箭缝')
if (!/rememberIpFigureCore/.test(placeBody)) {
  fail('落位还在用整模包围盒心')
} else ok('落位按身体主体，不认举手和装饰件')
if (!/pickIpStandBesideRocket/.test(placeBody) || !/getIpCollisionBox/.test(placeBody)) {
  fail('人和火箭没有碰撞预测，大箭会把人挡住')
} else ok('人和火箭按船体做碰撞预测，不钉死右侧')
if (!/pickIpRefAt/.test(compJs) || !/_onCanvasTap[\s\S]*_dismissAllIpUi\(false\)/.test(compJs)) fail('点空处不会退出特写')
else ok('点人打开，点空处退出')
if (!/onIpIntroBubble/.test(compJs) || !/slug === intro.slug/.test(compJs)) fail('再点同一人没有跳过/关闭')
else ok('再点同一人：打字中跳过，马斯克说完关闭，星问热激活')

console.log('\n── 气泡与动效 ──')
if (!/r3d-ip-bubble/.test(compWxml) || !/轻点空白处返回/.test(compWxml) || !/ipIntro.slug === 'musk'/.test(compWxml)) {
  fail('马斯克平面气泡缺失')
} else ok('马斯克仍用介绍气泡，星问改走 3D 窗')
if (!/r3d-ip-expand/.test(compWxss) || !/r3d-ip-blink/.test(compWxss)) fail('缺弹出或光标动效')
else ok('展开窗口有动效，光标会闪')
if (!/ipFx\.playOpen/.test(compJs) || !/vibrateShort\(\{ type: 'medium' \}\)/.test(read('subpackages/rocket-3d/ip-fx.js'))) {
  fail('展开 IP 窗没有中度震动')
} else ok('展开 IP 窗有中度震动')
if (!/createInnerAudioContext/.test(read('subpackages/rocket-3d/ip-fx.js')) || !exists('subpackages/rocket-3d/assets/ip-open.wav')) {
  fail('展开 IP 窗没有科技音效')
} else ok('展开 IP 窗有科技音效')
if (!/_startIpTypewriter/.test(compJs) || !/nextTypeDelay/.test(compJs)) fail('没有打字机')
else ok('文案按打字机出')
if (!/r3d-ip-tag/.test(compWxml) || !/emitIpNameTags/.test(loopBody)) fail('人头上没有名牌')
else ok('未特写时人头上有星问 / 马斯克名牌')
if (!/bind:ipintro="onIpIntro"/.test(viewerWxml) || !/ipIntroOpen/.test(viewerJs)) {
  fail('页面没接特写事件')
} else ok('页面接特写事件并压暗底栏')
if (!/_dismissIpWindows/.test(viewerJs) || !/onTogglePicker: function[\s\S]*_dismissIpWindows/.test(viewerJs) || !/onTapExhibitTitle[\s\S]*_dismissIpWindows/.test(viewerJs)) {
  fail('上方选型号 / 标题功能键不会关 IP 窗')
} else ok('上方功能键也会关掉 IP 窗')
if (!/r3d-exhibit-dock--dim/.test(read('subpackages/rocket-3d/viewer.wxss'))) fail('特写时底栏没有压暗')
else ok('特写时底栏压暗')

console.log('\n── 退出与换箭 ──')
if (!/playExhibitView: function[\s\S]*_dismissAllIpUi/.test(compJs)) fail('点尺寸/展陈不会退特写和 IP 窗')
else ok('点尺寸 / 展陈 / 特征会退特写并关掉 IP 窗')
if (!/flipStand: function[\s\S]*_dismissAllIpUi/.test(compJs) || !/flipYaw: function[\s\S]*_dismissAllIpUi/.test(compJs) || !/_loadModel: function[\s\S]*closeIpIntro\(true\)/.test(compJs)) {
  fail('翻转或换箭没有退特写')
} else ok('上下 / 左右翻转会退特写并关掉 IP 窗')
if (!/_loadModel: function[\s\S]*closeIpIntro\(true\)[\s\S]*setModel/.test(compJs)) fail('换箭没先收掉特写气泡')
else ok('换箭先收特写再装新模型')
if (!/shouldShowIpScaleRef[\s\S]*ipIntro\.open[\s\S]*closeIpIntro\(\)/.test(compJs)) fail('长征清人后特写气泡可能还挂着')
else ok('清掉人时会关掉特写')
if (!/ipIntroSlug = ''/.test(fnBody(runtimeSrc, 'setModel')) || !/ipIntroSlug = ''/.test(fnBody(runtimeSrc, 'disposeSession'))) {
  fail('换箭 / 销毁会话没清特写状态')
} else ok('换箭和销毁会清 ipIntroSlug')
if (!/session.scene.add\(root\)/.test(placeBody) || /yaw\.add/.test(placeBody)) fail('人又挂回 yaw 了')
else ok('人仍挂 scene，不跟火箭转')

console.log('\n── 行为：runtime 空输入 ──')
const runtime = require('../subpackages/rocket-3d/runtime.js')
if (runtime.pickIpRefAt(null, 1, 1) !== '') fail('空会话 pick 未早退')
else ok('空会话 pick / play 早退')
if (runtime.playIpIntroView(null, 'astro') !== false) fail('空会话 play 未早退')
else ok('空会话 playIpIntroView 返回 false')
if (typeof runtime.clearIpIntroView !== 'function' || typeof runtime.unlockIpIntroControls !== 'function') {
  fail('未导出退出特写 API')
} else ok('导出 clear / unlock 特写')

console.log('\n── 语法 ──')
;[
  'subpackages/rocket-3d/ip-intro.js',
  'subpackages/rocket-3d/ip-fx.js',
  'subpackages/rocket-3d/ip-chat-3d.js',
  'subpackages/rocket-3d/ip-anim.js',
  'subpackages/rocket-3d/xingwen-exhibit-client.js',
  'subpackages/rocket-3d/xingwen-exhibit-cards.js',
  'utils/ip-scale-ref.js',
  'subpackages/rocket-3d/runtime.js',
  'subpackages/rocket-3d/components/rocket-3d-viewer/index.js',
  'subpackages/rocket-3d/viewer.js',
  'test/ip-intro.test.js',
  'test/ip-fx.test.js',
  'test/ip-chat-3d.test.js',
  'test/ip-anim.test.js',
  'test/xingwen-exhibit-client.test.js',
  'test/rocket-3d-audit.test.js'
].forEach((rel) => {
  if (!exists(rel)) fail('缺文件 ' + rel)
  else if (!syntaxOk(rel)) fail(rel + ' 语法错误')
  else ok(rel + ' 语法通过')
})

console.log('\n── 回归 ──')
const tests = runNode([
  '--test',
  'test/ip-intro.test.js',
  'test/ip-fx.test.js',
  'test/ip-chat-3d.test.js',
  'test/ip-anim.test.js',
  'test/xingwen-exhibit-client.test.js',
  'test/xingwen-exhibit-cards.test.js',
  'test/ip-scale-ref.test.js',
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
  ['scripts/_tmp_audit_ip_dialog_runtime.js', '弹框/黑块真机回归'],
  ['scripts/_tmp_audit_ip_chat_3d.js', '星问 3D 对话审计'],
  ['scripts/_tmp_audit_ip_round_now.js', '本轮星问窗/输入条/推卡'],
  ['scripts/_tmp_audit_ip_dim_fixed.js', '尺寸+固定审计'],
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
