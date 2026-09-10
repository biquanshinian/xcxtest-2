/**
 * 3D 页星问对话：文案折行、头顶打靶落位、谁能开对话。
 * 只给 rocket-3d 用，不放主包（代码质量会报「主包未使用 JS」）。
 */

const { viewExhibitCards } = require('./xingwen-exhibit-cards.js')

const CHAT_FOOTER = '轻点窗口继续问 · 转开再转回还在'
const TALK_HINT = '问问星问'
const OVERLAY_DOCK_H = 52
const OVERLAY_HINT_H = OVERLAY_DOCK_H

function canChatSlug(slug) {
  return String(slug || '').toLowerCase() === 'astro'
}

/** 巡航灯：约 1.2s 一轮，短亮两闪，中间很暗。 */
function haloPulse(now) {
  const t = ((Number(now) || 0) % 1200 + 1200) % 1200
  if (t < 90) return 1
  if (t < 160) return 0.1
  if (t < 250) return 0.86
  return 0.06
}

function finiteBox(src) {
  if (!src || typeof src !== 'object') return null
  const minX = Number(src.minX)
  const maxX = Number(src.maxX)
  const minY = Number(src.minY)
  const maxY = Number(src.maxY)
  const minZ = Number(src.minZ)
  const maxZ = Number(src.maxZ)
  if (![minX, maxX, minY, maxY, minZ, maxZ].every(isFinite)) return null
  if (maxX < minX || maxY < minY || maxZ < minZ) return null
  return { minX, maxX, minY, maxY, minZ, maxZ }
}

/** 盔顶一小圈顶点：用包围盒心，不被一侧密顶点拽偏。 */
function pickApexFromPoints(points, band) {
  const list = Array.isArray(points) ? points : []
  let maxY = -Infinity
  for (let i = 0; i < list.length; i++) {
    const p = list[i]
    if (!p || !isFinite(p.y)) continue
    if (p.y > maxY) maxY = p.y
  }
  if (!isFinite(maxY)) return { x: 0, y: 0, z: 0, from: '' }
  const cut = maxY - Math.max(Number(band) || 0, 0.003)
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  let n = 0
  for (let j = 0; j < list.length; j++) {
    const p = list[j]
    if (!p || !isFinite(p.x) || !isFinite(p.z) || p.y < cut) continue
    n += 1
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.z < minZ) minZ = p.z
    if (p.z > maxZ) maxZ = p.z
  }
  if (!n) return { x: 0, y: maxY, z: 0, from: 'apex' }
  return {
    x: (minX + maxX) * 0.5,
    y: maxY,
    z: (minZ + maxZ) * 0.5,
    from: 'apex'
  }
}

/** 把点吸到「身体中心 + 黄条朝前」那条竖向中线，去掉左右偏差。 */
function snapToMeridian(point, center, front) {
  const px = Number(point && point.x)
  const py = Number(point && point.y)
  const pz = Number(point && point.z)
  const cx = Number(center && center.x)
  const cz = Number(center && center.z)
  const fx = Number(front && front.x)
  const fz = Number(front && front.z)
  const out = {
    x: isFinite(px) ? px : 0,
    y: isFinite(py) ? py : 0,
    z: isFinite(pz) ? pz : 0
  }
  const len = Math.hypot(fx, fz)
  if (!(len > 1e-6) || !isFinite(cx) || !isFinite(cz)) return out
  const nx = fx / len
  const nz = fz / len
  const lx = -nz
  const lz = nx
  const vx = out.x - cx
  const vz = out.z - cz
  const d = vx * lx + vz * lz
  out.x -= lx * d
  out.z -= lz * d
  return out
}

function medianNumber(values) {
  const list = Array.isArray(values) ? values.filter((n) => isFinite(n)) : []
  if (!list.length) return NaN
  list.sort((a, b) => a - b)
  const mid = Math.floor(list.length / 2)
  return list.length % 2 ? list[mid] : (list[mid - 1] + list[mid]) * 0.5
}

/** 左右锁在黄条中线，高度保持原值。 */
function snapLocalToStripeMid(local, center) {
  const x = Number(local && local.x)
  const y = Number(local && local.y)
  const z = Number(local && local.z)
  const cx = Number(center && center.x)
  const cz = Number(center && center.z)
  return {
    x: isFinite(cx) ? cx : isFinite(x) ? x : 0,
    y: isFinite(y) ? y : 0,
    z: isFinite(cz) ? cz : isFinite(z) ? z : 0
  }
}

/** 把局部点吸到黄条最薄那根轴的中线。 */
function snapLocalToThinCenter(local, size, center) {
  const p = local && typeof local === 'object' ? local : {}
  const s = size && typeof size === 'object' ? size : {}
  const c = center && typeof center === 'object' ? center : {}
  const x = Number(p.x)
  const y = Number(p.y)
  const z = Number(p.z)
  const sx = Math.abs(Number(s.x))
  const sy = Math.abs(Number(s.y))
  const sz = Math.abs(Number(s.z))
  const out = {
    x: isFinite(x) ? x : 0,
    y: isFinite(y) ? y : 0,
    z: isFinite(z) ? z : 0
  }
  if (![sx, sy, sz].every((n) => isFinite(n) && n >= 0)) return out
  let thin = 'x'
  if (sy <= sx && sy <= sz) thin = 'y'
  if (sz <= sx && sz <= sy) thin = 'z'
  if (sx <= sy && sx <= sz) thin = 'x'
  const mid = Number(c[thin])
  if (isFinite(mid)) out[thin] = mid
  return out
}

/** 巡航灯只钉盔顶几何中心。黄条世界盒一转就会把灯拽偏，不能用来定位。 */
function pickCrownAnchor(body, hits, helmet) {
  const hasHelmet = !!finiteBox(helmet)
  const helm = finiteBox(helmet) || finiteBox(body)
  if (!helm) {
    const apex = pickApexFromPoints(hits, 0.02)
    if (apex.from) return apex
    return { x: 0, y: 0, z: 0, from: '' }
  }
  return {
    x: (helm.minX + helm.maxX) * 0.5,
    y: helm.maxY,
    z: (helm.minZ + helm.maxZ) * 0.5,
    from: hasHelmet ? 'helmet' : 'crown'
  }
}

function wrapChatLines(text, maxChars) {
  const src = String(text || '')
  const max = Math.max(4, Number(maxChars) || 16)
  const out = []
  const paras = src.split('\n')
  for (let p = 0; p < paras.length; p++) {
    const para = paras[p]
    if (!para) {
      out.push('')
      continue
    }
    let buf = ''
    for (let i = 0; i < para.length; i++) {
      buf += para.charAt(i)
      if (buf.length >= max) {
        out.push(buf)
        buf = ''
      }
    }
    if (buf) out.push(buf)
  }
  return out
}

function visibleChatMessages(messages, limit) {
  const list = Array.isArray(messages) ? messages : []
  const n = Math.max(1, Number(limit) || 6)
  return list.slice(-n)
}

function seedIntroMessages(text) {
  const content = String(text || '').trim()
  if (!content) return []
  return [{ role: 'assistant', content: content }]
}

function viewChatMessages(messages, streaming) {
  const list = Array.isArray(messages) ? messages : []
  return list.map(function (m, i) {
    const last = i === list.length - 1
    const role = m && m.role === 'user' ? 'user' : 'bot'
    return {
      id: 'xw-' + i,
      role: role,
      content: String((m && m.content) || ''),
      error: !!(m && m.error),
      streaming: !!(streaming && last && role !== 'user'),
      cards: viewExhibitCards(m && m.cards)
    }
  })
}

function layoutVirtualScreen(rect, cssW, cssH, facing) {
  if (!facing || !rect) {
    return { visible: false, x: 0, y: 0, w: 0, h: 0 }
  }
  const x = Number(rect.left)
  const y = Number(rect.top)
  const w = Number(rect.right) - x
  const h = Number(rect.bottom) - y
  if (!isFinite(x) || !isFinite(y) || !(w > 48) || !(h > 64)) {
    return { visible: false, x: 0, y: 0, w: 0, h: 0 }
  }
  return {
    visible: true,
    x: Math.round(x),
    y: Math.round(y),
    w: Math.round(w),
    h: Math.round(h)
  }
}

function clampNum(n, a, b) {
  return Math.max(a, Math.min(b, n))
}

function emptyHeadLock() {
  return { visible: false, x: 0, y: 0, w: 0, h: 0, scale: 1, fs: 13 }
}

/** 3D 锚点用的世界板，只负责钉头，不再拿来缩放字号。 */
function headLockWorldSize(kind, figureH) {
  const h = Number(figureH)
  if (!(h > 0) || !isFinite(h)) return { w: 0, h: 0, lift: 0 }
  if (kind === 'astro') {
    return { w: h * 1.15, h: h * 0.08, lift: h * 0.08 }
  }
  return { w: h * 0.7, h: h * 0.06, lift: h * 0.06 }
}

function fixedOverlaySize(kind, cssW, cssH) {
  const vw = Number(cssW) || 375
  const vh = Number(cssH) || 700
  const maxW = Math.max(160, vw - 16)
  const maxH = Math.max(120, vh - 24)
  if (kind === 'astro') {
    const w = Math.round(clampNum(vw * 0.9, Math.min(280, maxW), maxW))
    const h = Math.round(clampNum(vh * 0.32, Math.min(168, maxH), Math.min(w * 0.64, maxH)))
    return { w: w, h: h, hintH: OVERLAY_DOCK_H, fs: 13 }
  }
  const w = Math.round(clampNum(vw * 0.72, Math.min(236, maxW), Math.min(300, maxW)))
  return { w: w, h: 0, hintH: 0, fs: 13 }
}

function muskOverlayBox(cssW, cssH, text, opts) {
  const base = fixedOverlaySize('musk', cssW, cssH)
  const w = base.w
  const fs = base.fs
  const chars = Math.max(8, Math.floor((w - 28) / Math.max(fs * 0.92, 8)))
  const lines = wrapChatLines(String(text || '').trim(), chars)
  const lineCount = Math.max(1, lines.length)
  const showHint = !(opts && opts.hint === false)
  const body = lineCount * Math.round(fs * 1.5)
  const raw = 22 + 8 + body + (showHint ? 18 : 0) + 20
  const maxH = Math.round(clampNum((Number(cssH) || 700) * 0.36, 96, 220))
  return {
    w: w,
    h: Math.round(clampNum(raw, 72, maxH)),
    hintH: 0,
    fs: fs
  }
}

/**
 * 钉在头顶投影上：屏幕尺寸固定可读，不跟镜头远近缩放字。
 * 头出画或框会飞到屏顶就藏，不夹边。
 */
function layoutHeadLockOverlay(proj, cssW, cssH, kind, extraIn) {
  if (!proj || !proj.visible) return emptyHeadLock()
  const vw = Number(cssW) || 375
  const vh = Number(cssH) || 700
  const headX = Number(proj.headX)
  const headY = Number(proj.headY)
  if (!isFinite(headX) || !isFinite(headY)) return emptyHeadLock()
  const extra = extraIn && typeof extraIn === 'object' ? extraIn : {}
  const spec =
    kind === 'astro'
      ? fixedOverlaySize('astro', vw, vh)
      : muskOverlayBox(vw, vh, extra.text, extra)
  const w = spec.w
  const h = spec.h + (kind === 'astro' ? spec.hintH || OVERLAY_DOCK_H : 0)
  const x = Math.round(headX - w / 2)
  const y = Math.round(headY - h - 8)
  const headOn = headX > 8 && headX < vw - 8 && headY > 16 && headY < vh - 8
  if (!headOn) return emptyHeadLock()
  if (y + h * 0.22 < 0) return emptyHeadLock()
  return {
    visible: true,
    x: x,
    y: y,
    w: w,
    h: h,
    scale: 1,
    fs: spec.fs
  }
}

function paintChatCanvas(ctx, width, height, state) {
  if (!ctx || typeof ctx.fillRect !== 'function') return false
  const w = Number(width) || 0
  const h = Number(height) || 0
  if (!(w > 0) || !(h > 0)) return false
  const src = state && typeof state === 'object' ? state : {}
  ctx.fillStyle = '#12151c'
  ctx.fillRect(0, 0, w, h)
  if (typeof ctx.fillText !== 'function') return true
  ctx.fillStyle = '#f8fafc'
  ctx.font = 'bold 28px sans-serif'
  ctx.fillText('星问', 28, 50)
  ctx.font = '20px sans-serif'
  ctx.fillStyle = 'rgba(243,230,196,0.55)'
  ctx.fillText('向导', 108, 50)
  const msgs = visibleChatMessages(src.messages, 6)
  let y = 88
  const maxY = h - 52
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i]
    const mine = m && m.role === 'user'
    ctx.fillStyle = m && m.error ? '#fca5a5' : mine ? '#93c5fd' : '#f8fafc'
    ctx.font = '24px sans-serif'
    const raw = String((m && m.content) || '')
    const lines = wrapChatLines((mine ? '你  ' : '') + raw, 16)
    for (let j = 0; j < lines.length; j++) {
      if (y > maxY) break
      ctx.fillText(lines[j], 28, y)
      y += 34
    }
    y += 8
    if (y > maxY) break
  }
  if (src.streaming) {
    ctx.fillStyle = '#93c5fd'
    ctx.font = '24px sans-serif'
    ctx.fillText('▍', 28, Math.min(y, h - 28))
  } else if (src.footer) {
    ctx.font = '18px sans-serif'
    ctx.fillStyle = 'rgba(226,232,240,0.42)'
    ctx.fillText(String(src.footer), 28, h - 24)
  }
  return true
}

module.exports = {
  CHAT_FOOTER,
  TALK_HINT,
  OVERLAY_DOCK_H,
  OVERLAY_HINT_H,
  canChatSlug,
  haloPulse,
  pickApexFromPoints,
  pickCrownAnchor,
  medianNumber,
  snapLocalToStripeMid,
  snapLocalToThinCenter,
  snapToMeridian,
  wrapChatLines,
  visibleChatMessages,
  seedIntroMessages,
  viewChatMessages,
  layoutVirtualScreen,
  headLockWorldSize,
  fixedOverlaySize,
  muskOverlayBox,
  layoutHeadLockOverlay,
  paintChatCanvas
}
