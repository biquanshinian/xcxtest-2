/**
 * 本轮审计：3D 场景里星问立体对话框 + 热激活对话 + 头顶黄条闪
 * 运行：node scripts/_tmp_audit_ip_chat_3d.js
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

console.log('── 谁能聊 ──')
const chat = require('../subpackages/rocket-3d/ip-chat-3d.js')
if (!chat.canChatSlug('astro') || chat.canChatSlug('musk')) fail('只有星问能开对话')
else ok('只有星问能开 3D 对话，马斯克仍是介绍')
if (typeof chat.haloPulse !== 'function' || typeof chat.pickCrownAnchor !== 'function') fail('缺巡航灯节奏或头顶锚点')
else if (!(chat.haloPulse(0) > 0.8) || !(chat.haloPulse(900) < 0.2)) fail('巡航灯不是短亮两闪')
else ok('头顶黄灯按巡航灯节奏一直闪')
if (!chat.layoutHeadLockOverlay || !chat.viewChatMessages || !chat.headLockWorldSize) fail('缺头顶打靶落位 / 消息视图')
else ok('头顶打靶有落位和消息视图')
const astroBox = chat.fixedOverlaySize('astro', 375, 700)
if (!(astroBox.w > astroBox.h) || astroBox.w < 260) fail('星问窗口还是过小或竖屏')
else ok('星问窗口是固定可读宽屏')

console.log('\n── 3D 窗不是 HUD ──')
const runtimeSrc = read('subpackages/rocket-3d/runtime.js')
const compJs = read('subpackages/rocket-3d/components/rocket-3d-viewer/index.js')
const compWxml = read('subpackages/rocket-3d/components/rocket-3d-viewer/index.wxml')
const compWxss = read('subpackages/rocket-3d/components/rocket-3d-viewer/index.wxss')
const viewerWxml = read('subpackages/rocket-3d/viewer.wxml')
const clientSrc = read('subpackages/rocket-3d/xingwen-exhibit-client.js')
const attachBody = fnBody(runtimeSrc, 'attachIpChatPanel')
const faceBody = fnBody(runtimeSrc, 'faceIpChatPanel')
const loopBody = fnBody(runtimeSrc, 'startLoop')
const clearRefs = fnBody(runtimeSrc, 'clearIpScaleRefs')
const placeBody = fnBody(runtimeSrc, 'placeIpScaleRefs')

if (!/r3d-ip-xw-panel/.test(attachBody) || !/makeBoxGeo/.test(attachBody) || !/BoxGeometry|BoxBufferGeometry/.test(fnBody(runtimeSrc, 'makeBoxGeo'))) {
  fail('对话窗没有厚度')
} else ok('对话窗是带厚度的 3D 玻璃')
if (/r3d-ip-xw-stem/.test(attachBody) || /stemGeo/.test(attachBody) || /0xc9a227/.test(attachBody)) {
  fail('3D 窗还有茎或金边连接物')
} else ok('3D 窗没有茎 / 连接物')
if (/0x0b0c0e/.test(attachBody) || /0x12141a/.test(attachBody) || /0x12151c/.test(attachBody)) {
  fail('3D 窗还是一块黑遮罩')
} else ok('3D 窗没有深色实体网格')
if (!/visible = false/.test(attachBody)) fail('3D 窗网格还画得出来')
else ok('3D 窗只作锚点，网格不渲染')
if (/faceIpChatPanel/.test(loopBody)) {
  fail('每帧还在转窗，对话框会跟镜头跑')
} else ok('每帧不再转窗，对话框钉在头顶')
if (!/updateXingwenHalo/.test(loopBody) || /xwTalking/.test(loopBody)) fail('巡航灯没有每帧闪或还绑回答')
else ok('落地后巡航灯每帧闪')
if (!/measureHeadLockLayout/.test(fnBody(runtimeSrc, 'emitXwScreenRect')) || /layoutXingwenPage/.test(fnBody(runtimeSrc, 'emitXwScreenRect'))) {
  fail('星问详情页还在跟人物侧边 HUD 走')
} else ok('星问详情页钉在星问头顶，不贴身边')
if (!/0xfacc15/.test(runtimeSrc) || !/ensureXingwenHalo\(session\)/.test(placeBody) || !/haloPulse/.test(runtimeSrc)) {
  fail('星问头顶黄灯没接上')
} else ok('落地后人头上挂黄灯')
if (!/AdditiveBlending/.test(fnBody(runtimeSrc, 'makeHaloMat')) || !/PointLight/.test(fnBody(runtimeSrc, 'ensureXingwenHalo'))) {
  fail('黄灯没有光晕或点光')
} else ok('黄灯带光晕，并用点光照亮周围')
if (!/xingwenLightReach/.test(runtimeSrc) || !/measureXingwenLampAnchor/.test(runtimeSrc) || !/scale\.set\(1,\s*1,\s*1\)/.test(fnBody(runtimeSrc, 'layoutXingwenHalo'))) {
  fail('点光会被缩放吃掉或照不到箭身')
} else ok('点光按到火箭的距离给强度，不跟球体一起缩放')
if (!/xwHaloBind/.test(runtimeSrc) || !/pickApexFromPoints/.test(runtimeSrc) || /parts\.stripe/.test(fnBody(runtimeSrc, 'measureXingwenLampAnchor'))) {
  fail('巡航灯还在跟黄条世界盒走')
} else ok('巡航灯绑盔顶局部坐标，不跟黄条世界盒走')
if (!/pickXingwenStripeMesh/.test(runtimeSrc) || !/snapToMeridian/.test(runtimeSrc) || !/xingwenStripeFrontXZ/.test(runtimeSrc)) {
  fail('灯没有锁到黄条朝前中线')
} else ok('灯每帧锁在黄条朝前中线')
if (!/snapLocalToStripeMid/.test(runtimeSrc) || !/medianNumber/.test(runtimeSrc) || !/bindXingwenHalo\(session, fig\)/.test(fnBody(runtimeSrc, 'layoutXingwenHalo'))) {
  fail('灯还在用旧绑定或黄斑包围盒心')
} else ok('每帧重绑黄条，左右走中位数中线')
if (!/ipFigureCoreWorld/.test(fnBody(runtimeSrc, 'xingwenBodyCenterWorld')) || /boundingSphere/.test(fnBody(runtimeSrc, 'xingwenBodyCenterWorld'))) {
  fail('灯还在用整模包围球当身体中心')
} else ok('灯的身体中心不认举手和装饰件')
if (/applyXingwenViewLeft/.test(runtimeSrc) || /lampViewLeftOffset/.test(runtimeSrc)) {
  fail('还在用展陈镜头左右挪灯')
} else ok('不再用展陈镜头左右挪灯')
if (/_setXwTalking/.test(compJs) || /xwTalking \?/.test(fnBody(runtimeSrc, 'updateXingwenHalo'))) {
  fail('黄灯还绑在回答上')
} else ok('巡航灯一直闪，不跟回答绑')
if (!/clearIpChatPanel/.test(clearRefs) || !/clearXingwenHalo/.test(clearRefs)) {
  fail('清人时 3D 窗可能残留')
} else ok('换箭 / 长征清人会拆 3D 窗')
if (!/layoutIpChatPanel/.test(placeBody) || !/sortIpFiguresForStand/.test(placeBody)) {
  fail('人挪位后窗口不跟着或左右没排')
} else ok('人重新落地后按星问左马斯克右重摆，窗口钉头上')
if (!/markIpProp/.test(attachBody) || !/r3dIpRef/.test(fnBody(runtimeSrc, 'markIpProp'))) {
  fail('3D 窗可能被算进火箭取景盒')
} else ok('3D 窗标成 IP，不进火箭取景')

console.log('\n── 热激活对话 ──')
if (!/streamChat/.test(clientSrc) || !/buildLaunchContext/.test(clientSrc) || !/resolveRichChatPayload/.test(clientSrc)) {
  fail('没接通星问 AI 或不会退卡')
} else ok('3D 页走 headless streamChat，问到点会退卡')
if (!/qualifyExhibitQuery/.test(clientSrc) || !/fillExhibitCards/.test(clientSrc) || !/onCards/.test(clientSrc)) {
  fail('展陈问句不会补火箭名，也没有回退出卡')
} else ok('问当前火箭会补型号名，主站没卡时展陈自己出卡')
if (!/uiCardReady:\s*!!cards\.length/.test(clientSrc)) {
  fail('没卡时还在跟模型说界面已出卡')
} else ok('只有真正出卡才告诉模型去引导点卡')
if (!/_armXingwenChat/.test(compJs) || !/unlockIpIntroControls/.test(compJs)) {
  fail('介绍完没有解锁旋转并开聊')
} else ok('介绍完解锁旋转，同一窗口接着聊')
if (!/pickIpChatPanelAt/.test(compJs) || !/xwChat.inputFocus/.test(compJs) || !/_focusXingwenChat/.test(compJs)) {
  fail('点 3D 窗不能继续对话')
} else ok('转开再转回，点窗口或星问还能继续问')
if (!/canChatSlug\(intro.slug\) && \(this\._xwArmed/.test(compJs) || !/_focusXingwenChat/.test(compJs)) {
  fail('再点星问会重开介绍')
} else ok('已经激活后再点星问只对焦，不重念介绍')
if (!/_startIpTypewriter: function \(lines, slug\)/.test(compJs) || !/canChatSlug\(slug\)/.test(compJs)) {
  fail('打字机读了 setData 里的 slug，介绍完可能热激活不了')
} else ok('打字机用传入的 slug，不跟 setData 抢异步')
if (/_startIpTypewriter\(intro\.lines\)/.test(compJs) && !/_startIpTypewriter\(intro\.lines, intro\.slug\)/.test(compJs)) {
  fail('打开介绍没把 slug 传给打字机')
} else ok('点星问时把 slug 传给打字机')
if (!/toDateString\(\)/.test(clientSrc) || !/_ai_chat_ad_bonus/.test(clientSrc)) {
  fail('3D 对话日配额没跟主站对齐')
} else ok('日配额日期和广告加次跟主站星问同一把钥匙')
if (!/catch \(e\) \{\s*return \{ ok: false, reason: 'disabled' \}/.test(clientSrc)) {
  fail('读开关失败会 fail-open')
} else ok('AI 开关读失败按关闭，不偷偷开聊')
if (/r3d-xw-dock/.test(compWxml)) fail('又在页底加了输入条')
else ok('输入条挂在星问窗下面，不占 3D 页底')
if (!/r3d-ip-expand/.test(compWxss) || !/r3d-xw-wrap/.test(compWxss)) fail('星问窗展开没有动效')
else ok('星问窗展开有动效')
if (!/r3d-xw-screen/.test(compWxml) || !/AI太空助手/.test(compWxml) || !/scroll-view/.test(compWxml) || !/onXingwenCardTap/.test(compWxml)) {
  fail('虚拟屏没套星问详情页或不能退卡')
} else ok('虚拟屏套用星问详情页标题、消息区和退卡')
if (!/r3d-xw-bar/.test(compWxml) || !/r3d-xw-go/.test(compWxml) || !/r3d-xw-field/.test(compWxml)) {
  fail('星问窗口下面没有输入框和发送键')
} else ok('窗口下面有输入框和发送键，打的字看得见')
if (!/问问星问/.test(compWxml) || !/onXingwenComposerTap/.test(compWxml) || !/onXingwenSend/.test(compWxml)) {
  fail('输入框或发送键没接上')
} else ok('输入框占位「问问星问」，点发送会发出')
if (!/_toggleXingwenIme/.test(compJs) || !/_closeXingwenIme/.test(compJs)) {
  fail('点窗口 / 点空白不能开关输入法')
} else ok('点窗口或输入条会唤起输入法，点空白收起')
if (!/border-radius:\s*16px/.test(compWxss)) fail('星问窗口还不是圆角')
else ok('星问窗口四角圆角')
if (!/tickStreamHaptic/.test(compJs) || !/pulseCardHaptic/.test(compJs) || !/cards\.length/.test(compJs)) {
  fail('回复没有照搬星问流式轻震 / 出卡中震')
} else ok('回复震动跟主站星问同一套：吐字轻震、出卡中震')
if (!/viewExhibitCards/.test(compJs) && !/onXingwenCardTap/.test(compWxml)) fail('星问窗不能推卡')
else ok('星问窗能推卡并点开')
if (!/catchtouchstart="onXwScreenTouch"/.test(compWxml) || !/rgba\(11,\s*12,\s*14/.test(compWxss)) {
  fail('虚拟屏不能交互或又铺成实心黑底')
} else ok('虚拟屏按星问详情页显示，半透明不盖死火箭')
if (!/ipIntro.slug === 'musk'/.test(compWxml)) fail('星问还在用平面气泡')
else ok('星问介绍也画在 3D 窗，平面气泡只留给马斯克')
if (!/exhibit-intro/.test(viewerWxml) || !/exhibitIntro/.test(compJs)) fail('对话不知道当前火箭')
else ok('提问会带上当前火箭尺寸，避免瞎报数')
if (/navigateTo\([^\)]*ai-chat/.test(compJs) || /selectComponent\('#aiChat'\)/.test(compJs)) {
  fail('3D 页又跳去了整页星问')
} else ok('不跳转整页聊天')

console.log('\n── 会话保持 ──')
if (!/_xwMessages/.test(compJs)) fail('对话没记在窗口状态里')
else ok('会话记在 3D 窗上，转开再转回还在')
if (!/_dismissAllIpUi/.test(compJs) || !/dismissIpWindows/.test(compJs)) fail('功能键关不掉 IP 窗口')
else ok('点功能键会关掉星问/马斯克所有窗口')
if (!/_resetXingwenChat\(true\)/.test(compJs) || !/_loadModel: function[\s\S]*_resetXingwenChat/.test(compJs)) {
  fail('换箭可能留下上一发的对话')
} else ok('换箭会拆窗并清会话')
if (!/playExhibitView: function[\s\S]*_dismissAllIpUi/.test(compJs) || !/flipStand: function[\s\S]*_dismissAllIpUi/.test(compJs) || !/flipYaw: function[\s\S]*_dismissAllIpUi/.test(compJs)) {
  fail('点尺寸 / 展陈 / 翻转不会关掉 IP 窗')
} else ok('点展陈 / 尺寸 / 特征和上下左右翻转会关掉所有 IP 窗')
if (!/_onCanvasTap: function[\s\S]*_dismissAllIpUi\(false\)/.test(compJs)) fail('点空白不会收掉已打开的 IP 窗')
else ok('点空白也收掉 IP 窗，只有再点形象才显示')

console.log('\n── 空输入 ──')
const runtime = require('../subpackages/rocket-3d/runtime.js')
if (runtime.pickIpChatPanelAt(null, 1, 1) !== false) fail('空会话点窗未早退')
else ok('空会话点 3D 窗早退')
if (runtime.attachIpChatPanel(null) !== false) fail('空会话建窗未早退')
else ok('空会话建窗返回 false')
if (typeof runtime.measureHeadLockLayout !== 'function') fail('未导出头顶打靶')
else ok('导出 3D 窗 / 头顶打靶 API')

console.log('\n── 语法 ──')
;[
  'subpackages/rocket-3d/ip-chat-3d.js',
  'subpackages/rocket-3d/ip-fx.js',
  'subpackages/rocket-3d/xingwen-exhibit-client.js',
  'subpackages/rocket-3d/xingwen-exhibit-cards.js',
  'subpackages/rocket-3d/runtime.js',
  'subpackages/rocket-3d/components/rocket-3d-viewer/index.js',
  'test/ip-chat-3d.test.js',
  'test/xingwen-exhibit-cards.test.js',
  'test/xingwen-exhibit-client.test.js'
].forEach((rel) => {
  if (!exists(rel)) fail('缺文件 ' + rel)
  else if (!syntaxOk(rel)) fail(rel + ' 语法错误')
  else ok(rel + ' 语法通过')
})

console.log('\n── 单测 ──')
const tests = runNode([
  '--test',
  'test/ip-chat-3d.test.js',
  'test/ip-fx.test.js',
  'test/xingwen-exhibit-client.test.js',
  'test/xingwen-exhibit-cards.test.js',
  'test/ip-intro.test.js'
])
if (tests.status !== 0) {
  fail('星问 3D 对话单测失败')
  console.log(tests.stdout || tests.stderr)
} else {
  const m = String(tests.stdout || '').match(/# (?:tests|pass|fail)[^\n]*/g)
  ok('星问 3D 对话单测通过' + (m && m.length ? ' (' + m.join(', ') + ')' : ''))
}

console.log('\n── 结果 ──')
if (issues.length) {
  console.log('未通过 ' + issues.length + ' 项：')
  issues.forEach((m) => console.log('  - ' + m))
  process.exit(1)
}
console.log('全绿灯')
