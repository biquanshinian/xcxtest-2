/**
 * 真机回归：马斯克必须能弹出介绍框，星问背后不能再有深色 3D 遮罩。
 * 运行：node scripts/_tmp_audit_ip_dialog_runtime.js
 */
const fs = require('fs')
const path = require('path')

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

const chat = require('../subpackages/rocket-3d/ip-chat-3d.js')
const intro = require('../subpackages/rocket-3d/ip-intro.js')
const scale = require('../utils/ip-scale-ref.js')
const runtimeSrc = read('subpackages/rocket-3d/runtime.js')
const compJs = read('subpackages/rocket-3d/components/rocket-3d-viewer/index.js')
const compWxml = read('subpackages/rocket-3d/components/rocket-3d-viewer/index.wxml')
const attachBody = fnBody(runtimeSrc, 'attachIpChatPanel')
const emitIntro = fnBody(runtimeSrc, 'emitIpIntroAnchor')
const emitXw = fnBody(runtimeSrc, 'emitXwScreenRect')
const placeBody = fnBody(runtimeSrc, 'placeIpScaleRefs')

console.log('── 马斯克必须弹框 ──')
const muskIf = (compWxml.match(/wx:if="\{\{live && ipIntro\.open && ipIntro\.slug === 'musk'[^"]*\}\}"/) || [''])[0]
if (!/ipIntro\.visible/.test(muskIf)) fail('头出画时马斯克框还会悬空')
else ok('马斯克框跟人走，出画就收')
if (!/slug: intro.slug/.test(compJs) || !/visible: false/.test(compJs) || !/'ipIntro.visible': true/.test(compJs)) {
  fail('打开介绍没有等头顶锚点再亮框')
} else ok('打开马斯克介绍等头顶锚点到了再亮框，避免先钉在左上角')
if (!/!anchor\.visible/.test(compJs) || !/'ipIntro\.visible': false/.test(compJs)) fail('头出画时没把马斯克框藏掉')
else ok('头出画会藏马斯克框，不再钉在空处')
if (!/_resetXingwenChat\(true\)/.test(compJs)) fail('点马斯克时星问窗还开着')
else ok('马斯克和星问互斥，不会两框叠开')
if (/layoutVirtualScreen/.test(emitIntro) || /panelFacingCamera/.test(emitIntro) || /muskPanel/.test(emitIntro)) {
  fail('马斯克锚点还走虚拟屏门控，小投影/侧对镜头会灭框')
} else ok('马斯克锚点只认头顶投影')
const tiny = chat.layoutVirtualScreen({ left: 10, top: 10, right: 40, bottom: 50 }, 375, 700, true)
if (tiny.visible) fail('虚拟屏小投影还会当可见，误用就会藏框')
else ok('虚拟屏小投影不可见——因此绝不能拿去管马斯克')
const head = chat.layoutHeadLockOverlay({ headX: 200, headY: 320, visible: true }, 375, 700, 'musk')
if (!head.visible || Math.abs(head.x + head.w / 2 - 200) > 1 || head.y + head.h > 320) fail('头顶投影落不出气泡')
else ok('头顶打靶能落下介绍框')
const flyTop = chat.layoutHeadLockOverlay({ headX: 40, headY: 18, visible: true }, 375, 700, 'musk')
if (flyTop.visible) fail('马斯克框还会飞到屏幕顶')
else ok('头太靠上时藏马斯克框，不钉屏顶')
const muskShort = chat.muskOverlayBox(375, 700, '马斯克。')
const muskFull = chat.muskOverlayBox(375, 700, intro.joinIntroLines(intro.getIpIntro('musk')))
if (!(muskFull.h > muskShort.h)) fail('马斯克窗高度没有按文案自适应')
else ok('马斯克窗高度按文案行数自适应')

console.log('\n── 星问背后不能有黑块 ──')
if (/0x0b0c0e|0x12141a|0x12151c|0x14161c/.test(attachBody)) fail('星问 3D 窗还在画深色盒子')
else ok('星问 3D 窗没有深色填充')
if (!/visible = false/.test(attachBody) || !/opacity: 0/.test(attachBody)) fail('星问 3D 网格还可能被画出来')
else ok('星问 3D 网格强制不渲染')
if (!/measureHeadLockLayout/.test(emitXw) || /layoutVirtualScreen/.test(emitXw) || /layoutXingwenPage/.test(emitXw)) {
  fail('星问页还在跟 3D 板或身边 HUD 走')
} else ok('星问页钉在星问头顶，不跟黑盒、不贴身边')
const page = chat.layoutHeadLockOverlay({ headX: 188, headY: 260, visible: true }, 375, 700, 'astro')
if (!page.visible || page.w <= page.h || page.w < 260) fail('星问详情页还不是固定可读宽屏')
else ok('星问详情页是钉在头顶的固定宽屏')
const closeup = chat.layoutHeadLockOverlay({ headX: 188, headY: 260, visible: true }, 375, 700, 'astro')
if (!closeup.visible || closeup.w !== page.w || closeup.fs !== page.fs) {
  fail('星问页还在按镜头远近缩放内容')
} else ok('星问页尺寸固定，不跟镜头缩放字')
const off = chat.layoutHeadLockOverlay({ headX: -40, headY: 20, visible: true }, 375, 700, 'astro')
if (off.visible) fail('头出画时星问页还会夹到屏幕边')
else ok('头出画就藏星问页，不夹边')

console.log('\n── 朝向沿用 GLB 正向 ──')
if (/faceIpFiguresToCamera/.test(placeBody) || /\+ Math\.PI/.test(fnBody(runtimeSrc, 'faceIpFiguresToCamera'))) {
  fail('还在对 IP 做背向 +π，新正向模型会再背对镜头')
} else ok('落地不再拧 180°，沿用新模型正向')

console.log('\n── 两人必须挨着 ──')
if (typeof scale.ipStandingStride !== 'function') fail('缺身高步长，间距会跟 AABB 走')
else {
  const wave = scale.ipStandingStride({ x: 1.8, y: 1.88, z: 0.4 })
  if (!(wave.step > 1.8) || wave.gap < 1.88 * 0.45) fail('举手姿态步长太近，还会叠半个身子')
  else if (wave.step >= 1.8 + 1.88 * 0.7) fail('步长又加了整臂展火箭缝')
  else ok('步长按举手跨度留出身位缝，不穿模也不拉开一臂')
}
if (typeof scale.sortIpFiguresForStand !== 'function') fail('缺左右排序')
else if (scale.sortIpFiguresForStand([{ slug: 'musk' }, { slug: 'astro' }])[0].slug !== 'astro') {
  fail('落地还是马斯克在左')
} else ok('落地星问在左、马斯克在右')
if (!/ipStandingStride/.test(placeBody) || /cursor \+= size\.x/.test(placeBody) || /rocketH \* 0\./.test(placeBody)) {
  fail('落位还在用包围盒宽度或火箭高度当间距')
} else ok('落位按身高肩宽挪，不跟火箭高度走')
if (!/pickIpStandBesideRocket/.test(placeBody) || !/getIpCollisionBox/.test(placeBody) || /cursor = rocketBox\.max\.x/.test(placeBody)) {
  fail('人还钉死在箭右侧，大体积火箭会把人挡住')
} else ok('人按船体碰撞预测站位，不钉死在一个点')
if (typeof scale.pickIpStandBesideRocket !== 'function') fail('缺碰撞预测')
else {
  const fat = scale.pickIpStandBesideRocket({
    rocket: { minX: -10, maxX: 10, minZ: -10, maxZ: 10 },
    pairW: 1.05,
    pairD: 0.35,
    bodyW: 0.49,
    camera: { x: 0, z: 40 }
  })
  if (fat.overlap || fat.occluded) fail('胖箭预测仍重叠或被挡')
  else ok('胖箭会换到能看见、不重叠的位置')
}

console.log('\n── 结果 ──')
if (issues.length) {
  console.log('未通过 ' + issues.length + ' 项：')
  issues.forEach((m) => console.log('  - ' + m))
  process.exit(1)
}
console.log('全绿灯')
