/**
 * 本轮需求核验：星问窗大小 / 不缩放 / 窗下输入条 / 推卡 / 特写距离 / 马斯克钉头
 * 运行：node scripts/_tmp_audit_ip_round_now.js
 */
const fs = require('fs')
const path = require('path')
const chat = require('../subpackages/rocket-3d/ip-chat-3d.js')

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

console.log('── 本轮 6 条需求 ──')
const astro = chat.fixedOverlaySize('astro', 375, 700)
const musk = chat.fixedOverlaySize('musk', 375, 700)
const astroCard = chat.fixedOverlaySize('astro', 375, 240)
if (!(astro.w >= 300) || !(astro.h >= 160) || astro.h > 230 || astro.w <= astro.h || astro.fs !== 13) {
  fail('星问窗尺寸不对: ' + JSON.stringify(astro))
} else ok('星问窗 ' + astro.w + 'x' + astro.h + ' fs=' + astro.fs + '（375x700，给输入条留了高度）')
const muskBox = chat.muskOverlayBox(375, 700, '马斯克。真实身高一米八八。不是本人到场，是比例参照——火箭有多高，一眼就有数。')
const muskShort = chat.muskOverlayBox(375, 700, '马斯克。')
if (!(muskBox.h > muskShort.h) || muskBox.fs !== 13) fail('马斯克框没有按文案自适应: ' + JSON.stringify(muskBox))
else ok('马斯克框自适应 ' + muskBox.w + 'x' + muskBox.h + ' fs=' + muskBox.fs)
if (astroCard.h > 240) fail('卡片高度里星问窗会溢出: ' + JSON.stringify(astroCard))
else ok('卡片视口里星问窗会收进 ' + astroCard.w + 'x' + astroCard.h)

const a1 = chat.layoutHeadLockOverlay({ headX: 188, headY: 260, visible: true }, 375, 700, 'astro')
const a2 = chat.layoutHeadLockOverlay({ headX: 188, headY: 260, visible: true }, 375, 700, 'astro')
if (a1.w !== a2.w || a1.h !== a2.h || a1.fs !== a2.fs || a1.scale !== 1) fail('星问窗仍可能按投影缩放')
else ok('同一头顶锚点尺寸恒定，不跟镜头缩放')

const wxml = read('subpackages/rocket-3d/components/rocket-3d-viewer/index.wxml')
const js = read('subpackages/rocket-3d/components/rocket-3d-viewer/index.js')
const wxss = read('subpackages/rocket-3d/components/rocket-3d-viewer/index.wxss')
const runtime = read('subpackages/rocket-3d/runtime.js')

if (!/r3d-xw-bar/.test(wxml) || !/r3d-xw-field/.test(wxml) || !/r3d-xw-go/.test(wxml)) {
  fail('窗口下面没有输入框和发送键')
} else ok('窗口下面有输入框和发送键')
if (!/问问星问/.test(wxml) || !/onXingwenComposerTap/.test(wxml) || !/onXingwenSend/.test(wxml)) {
  fail('输入框或发送键没接上')
} else ok('输入框能看见字，点发送会发出')
if (!/_toggleXingwenIme/.test(js) || !/_closeXingwenIme/.test(js)) {
  fail('点窗 / 点空白开关输入法不完整')
} else ok('点窗口或输入条唤起输入法，点空白收起')
if (!/fillExhibitCards/.test(js) && !/onCards/.test(js)) fail('发送链路没接上推卡')
else ok('发送后会推卡并滚到卡片')
const tapCount = (wxml.match(/catchtap="onXwScreenTap"/g) || []).length
if (tapCount < 2) fail('窗口内点击面不够，标题/消息区可能点不出输入法')
else ok('窗体/标题/消息区都能点出输入法（' + tapCount + ' 处）')
if (!/border-radius:\s*16px/.test(wxss)) fail('窗口还不是圆角')
else ok('窗口四角圆角')
if (!/tickStreamHaptic/.test(js) || !/pulseCardHaptic/.test(js)) fail('回复震动没接上')
else ok('回复震动已接上流式轻震和出卡中震')
if (!/r3d-ip-expand/.test(wxss)) fail('展开窗口没有动效')
else ok('展开窗口有动效')
if (!/ipFx\.playOpen/.test(js)) fail('展开窗口没有震动/音效')
else ok('展开窗口有中度震动和科技音效')

const poseBody = fnBody(runtime, 'ipIntroCameraPose')
if (/rocketSpan \* 1\.05/.test(poseBody) || /reach \* 0\.92/.test(poseBody) || !/size\.y \* 1\.72/.test(poseBody)) {
  fail('特写距离仍可能按火箭全长拉远')
} else ok('特写距离按人身 1.72H，火箭全长只进 far 裁切')

const muskHead = chat.layoutHeadLockOverlay({ headX: 220, headY: 340, visible: true }, 375, 700, 'musk')
if (!muskHead.visible || Math.abs(muskHead.x + muskHead.w / 2 - 220) > 1 || muskHead.y + muskHead.h > 340) {
  fail('马斯克框没钉在头顶: ' + JSON.stringify(muskHead))
} else ok('马斯克框底边中心钉头上 x=' + muskHead.x + ' y=' + muskHead.y)
const fly = chat.layoutHeadLockOverlay({ headX: 40, headY: 20, visible: true }, 375, 700, 'musk')
if (fly.visible) fail('头太靠上马斯克框仍会飞顶')
else ok('头太靠上时藏马斯克框')
if (!/visible: false/.test(js) || !/'ipIntro.visible': true/.test(js)) {
  fail('打开介绍可能先用默认左上坐标亮框')
} else ok('打开介绍先 hidden，头顶锚点到了再亮')

if (/--xw-fs/.test(wxss) || /font-size:\s*var\(--xw-fs/.test(wxss)) fail('wxss 还在用随距离变的字号变量')
else ok('wxss 字号固定，无 --xw-fs')

const notes = []

console.log('\n── 结果 ──')
if (issues.length) {
  console.log('未通过 ' + issues.length + ' 项：')
  issues.forEach((m) => console.log('  - ' + m))
  process.exit(1)
}
console.log('本轮 6 条全绿灯')
console.log('astro', JSON.stringify(astro))
console.log('musk', JSON.stringify(musk))
console.log('astroCard', JSON.stringify(astroCard))
if (notes.length) {
  console.log('\n── 备注 ──')
  notes.forEach((m) => console.log('  note  ' + m))
}
