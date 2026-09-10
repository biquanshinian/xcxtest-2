/**
 * node --test test/ip-chat-3d.test.js
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const {
  CHAT_FOOTER,
  canChatSlug,
  wrapChatLines,
  visibleChatMessages,
  seedIntroMessages,
  haloPulse,
  pickApexFromPoints,
  pickCrownAnchor,
  snapLocalToThinCenter,
  snapLocalToStripeMid,
  medianNumber,
  snapToMeridian,
  viewChatMessages,
  layoutVirtualScreen,
  layoutHeadLockOverlay,
  fixedOverlaySize,
  muskOverlayBox,
  paintChatCanvas
} = require('../subpackages/rocket-3d/ip-chat-3d.js')
const ipIntro = require('../subpackages/rocket-3d/ip-intro.js')

test('热激活页脚文案固定，不依赖 setData 回写', () => {
  assert.match(CHAT_FOOTER, /轻点窗口继续问/)
})

test('巡航灯短亮两闪，亮暗采样不一样', () => {
  const a = haloPulse(0)
  const b = haloPulse(900)
  assert.ok(a > 0.8)
  assert.ok(b < 0.2)
  assert.notEqual(a, b)
})

test('巡航灯只认盔顶几何中心，黄条世界盒不能拽偏', () => {
  const body = { minX: 0, maxX: 2, minY: 0, maxY: 10, minZ: 0, maxZ: 2 }
  const helmet = { minX: 0.7, maxX: 1.3, minY: 8.4, maxY: 10, minZ: 0.7, maxZ: 1.3 }
  const stripe = { minX: 0.96, maxX: 1.04, minY: 8.5, maxY: 9.7, minZ: 1.18, maxZ: 1.36 }
  const a = pickCrownAnchor(body, [{ x: 1.42, y: 9.95, z: 1.32 }], helmet, stripe)
  assert.equal(a.from, 'helmet')
  assert.ok(Math.abs(a.x - 1) < 0.01)
  assert.ok(Math.abs(a.z - 1) < 0.01)
  assert.equal(a.y, 10)
  const crown = pickCrownAnchor(body, [])
  assert.equal(crown.from, 'crown')
  assert.equal(crown.x, 1)
  assert.ok(crown.y > 8.5)
})

test('局部点吸到黄条最薄轴中线', () => {
  const a = snapLocalToThinCenter({ x: 0.2, y: 1.1, z: 0.4 }, { x: 0.08, y: 1.6, z: 0.5 }, { x: 0, y: 0.8, z: 0.4 })
  assert.ok(Math.abs(a.x) < 1e-9)
  assert.equal(a.y, 1.1)
  assert.equal(a.z, 0.4)
})

test('世界点吸到黄条朝前的竖向中线，右偏会被拉回', () => {
  const locked = snapToMeridian({ x: 0.2, y: 2, z: 1 }, { x: 0, y: 1, z: 0 }, { x: 0, z: 1 })
  assert.ok(Math.abs(locked.x) < 1e-9)
  assert.equal(locked.y, 2)
  assert.ok(Math.abs(locked.z - 1) < 1e-9)
})

test('黄条左右用中位数，不被右侧多出来的点拽偏', () => {
  const xs = [-0.02, -0.01, 0, 0.01, 0.02, 0.4]
  assert.ok(Math.abs(medianNumber(xs)) < 0.02)
  const mid = snapLocalToStripeMid({ x: 0.19, y: 1.4, z: 0.33 }, { x: 0, y: 1, z: 0.3 })
  assert.ok(Math.abs(mid.x) < 1e-9)
  assert.equal(mid.y, 1.4)
  assert.ok(Math.abs(mid.z - 0.3) < 1e-9)
})

test('盔顶一圈用包围盒心，一侧密顶点拽不偏', () => {
  const pts = []
  for (let i = 0; i < 30; i++) pts.push({ x: 1.35, y: 10, z: 1.0 })
  pts.push({ x: 0.65, y: 10, z: 1.0 })
  pts.push({ x: 1.0, y: 10.01, z: 1.0 })
  const a = pickApexFromPoints(pts, 0.05)
  assert.equal(a.from, 'apex')
  assert.ok(Math.abs(a.x - 1) < 0.02, '左右是顶圈包围盒心')
  assert.ok(Math.abs(a.z - 1) < 0.02)
  assert.ok(a.y >= 10)
})

test('只有星问能开 3D 对话，马斯克不能', () => {
  assert.equal(canChatSlug('astro'), true)
  assert.equal(canChatSlug('Astro'), true)
  assert.equal(canChatSlug('musk'), false)
  assert.equal(canChatSlug(''), false)
})

test('对话折行与可见消息只留最近几条', () => {
  assert.deepEqual(wrapChatLines('abcdefghijklmnopqr', 8), ['abcdefgh', 'ijklmnop', 'qr'])
  assert.deepEqual(wrapChatLines('上\n下', 8), ['上', '下'])
  const many = []
  for (let i = 0; i < 10; i++) many.push({ role: 'user', content: String(i) })
  const vis = visibleChatMessages(many, 6)
  assert.equal(vis.length, 6)
  assert.equal(vis[0].content, '4')
  assert.deepEqual(visibleChatMessages(null, 6), [])
})

test('介绍文案会种成星问消息，退卡会带到视图', () => {
  const msgs = seedIntroMessages('嘿，我是星问。')
  assert.equal(msgs.length, 1)
  assert.equal(msgs[0].role, 'assistant')
  assert.equal(msgs[0].content, '嘿，我是星问。')
  assert.deepEqual(seedIntroMessages('  '), [])
  const views = viewChatMessages(
    [
      { role: 'assistant', content: '嘿', cards: [{ cardType: 'mission', id: '1', name: '猎鹰 9' }] },
      { role: 'user', content: '高吗' }
    ],
    true
  )
  assert.equal(views[0].id, 'xw-0')
  assert.equal(views[0].role, 'bot')
  assert.equal(views[0].cards[0].cardType, 'mission')
  assert.equal(views[0].cards[0].title, '猎鹰 9')
  assert.equal(views[1].role, 'user')
  assert.equal(views[1].streaming, false)
})

test('星问头顶框固定可读宽屏，不跟镜头远近缩放字', () => {
  const hid = layoutVirtualScreen(null, 375, 700, true)
  assert.equal(hid.visible, false)
  const astroSize = fixedOverlaySize('astro', 375, 700)
  const muskSize = fixedOverlaySize('musk', 375, 700)
  assert.ok(astroSize.w > astroSize.h, '星问必须宽屏')
  assert.ok(astroSize.w >= 260, '星问窗口不能过小')
  assert.ok(astroSize.h <= 230, '星问窗高度仍收在可读宽屏内')
  assert.ok(muskSize.w > muskSize.h)
  const far = layoutHeadLockOverlay({ headX: 190, headY: 260, visible: true }, 375, 700, 'astro')
  const near = layoutHeadLockOverlay({ headX: 190, headY: 260, visible: true }, 375, 700, 'astro')
  assert.equal(far.visible, true)
  assert.equal(far.w, near.w)
  assert.equal(far.h, near.h)
  assert.equal(far.fs, near.fs)
  assert.equal(far.fs, 13)
  assert.ok(Math.abs(far.x + far.w / 2 - 190) <= 1, '底边中心钉在头上')
  assert.ok(far.y + far.h <= 260)
  const off = layoutHeadLockOverlay({ headX: -80, headY: 40, visible: true }, 375, 700, 'astro')
  assert.equal(off.visible, false)
  const top = layoutHeadLockOverlay({ headX: 40, headY: 20, visible: true }, 375, 700, 'musk')
  assert.equal(top.visible, false, '头太靠上时不能把马斯克框钉到屏顶')
  const musk = layoutHeadLockOverlay({ headX: 200, headY: 320, visible: true }, 375, 700, 'musk')
  assert.equal(musk.visible, true)
  assert.ok(Math.abs(musk.x + musk.w / 2 - 200) <= 1)
  assert.ok(musk.y + musk.h <= 320)
  const tiny = layoutVirtualScreen({ left: 10, top: 10, right: 30, bottom: 40 }, 375, 700, true)
  assert.equal(tiny.visible, false)
})

test('马斯克窗口按文案行数长高', () => {
  const short = muskOverlayBox(375, 700, '马斯克。')
  const full = muskOverlayBox(375, 700, ipIntro.joinIntroLines(ipIntro.getIpIntro('musk')))
  assert.ok(full.h > short.h)
  assert.ok(full.w === short.w)
  const a = layoutHeadLockOverlay({ headX: 200, headY: 360, visible: true }, 375, 700, 'musk', { text: '马斯克。' })
  const b = layoutHeadLockOverlay(
    { headX: 200, headY: 360, visible: true },
    375,
    700,
    'musk',
    { text: ipIntro.joinIntroLines(ipIntro.getIpIntro('musk')), hint: true }
  )
  assert.equal(a.visible, true)
  assert.equal(b.visible, true)
  assert.ok(b.h > a.h)
  assert.ok(Math.abs(b.x + b.w / 2 - 200) <= 1)
  assert.ok(b.y + b.h <= 360)
})

test('3D 面板纹理会画标题和对话', () => {
  const ops = []
  const ctx = {
    fillRect: function (x, y, w, h) {
      ops.push(['rect', x, y, w, h])
    },
    fillText: function (text) {
      ops.push(['text', text])
    },
    fillStyle: '',
    font: ''
  }
  assert.equal(paintChatCanvas(null, 512, 384, {}), false)
  assert.equal(paintChatCanvas(ctx, 512, 384, {
    messages: [
      { role: 'assistant', content: '嘿，我是星问。' },
      { role: 'user', content: '多高' }
    ],
    footer: '轻点窗口继续问'
  }), true)
  const texts = ops.filter((x) => x[0] === 'text').map((x) => x[1]).join('|')
  assert.match(texts, /星问/)
  assert.match(texts, /向导/)
  assert.match(texts, /嘿/)
  assert.match(texts, /你/)
  assert.match(texts, /轻点窗口继续问/)
})
