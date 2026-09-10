/**
 * 3D 页 IP 特写自我介绍：文案、点选热区、打字节奏、气泡落位。
 * 触发盒跟每个模型自己的投影包围盒走，只按该盒比例外扩，不套固定宽高。
 * 只给 rocket-3d 用，不放主包（代码质量会报「主包未使用 JS」）。
 */

const INTROS = {
  astro: {
    slug: 'astro',
    name: '星问',
    title: '向导',
    lines: [
      '嘿，我是星问。',
      '火星探索日志的向导。发射、星舰、观礼，有疑问就来问我。今天站在火箭旁边，按真人比例给你当标尺。'
    ]
  },
  musk: {
    slug: 'musk',
    name: '马斯克',
    title: '身高参照',
    lines: [
      '马斯克。',
      '真实身高一米八八。不是本人到场，是比例参照——火箭有多高，一眼就有数。'
    ]
  },
  'cyber-pickup': {
    slug: 'cyber-pickup',
    name: '赛博皮卡',
    title: '车辆参照',
    lines: [
      '赛博皮卡。',
      '按量产皮卡真实尺寸：长 5.683 米，宽 2.032 米，高 1.794 米。不是展车到场，是比例参照。'
    ]
  }
}

function getIpIntro(slug) {
  const key = String(slug || '').toLowerCase()
  return INTROS[key] || null
}

function joinIntroLines(intro) {
  const lines = intro && intro.lines
  if (!lines || !lines.length) return ''
  return lines.join('\n')
}

function typeIntroAt(full, index) {
  const text = String(full || '')
  const i = Math.max(0, Math.min(text.length, Number(index) || 0))
  return {
    typed: text.slice(0, i),
    done: i >= text.length
  }
}

function nextTypeDelay(ch) {
  if (ch === '\n') return 240
  if (/[。！？]/.test(ch)) return 200
  if (/[，、；]/.test(ch)) return 90
  return 32
}

/** 按该模型投影盒自身比例外扩，另加一点指尖误差。 */
const HIT_PAD_RATIO = 0.1
const HIT_SLACK_PX = 8

function expandHitRect(rect, minW, minH, pad) {
  const src = rect && typeof rect === 'object' ? rect : {}
  const left = Number(src.left)
  const top = Number(src.top)
  const right = Number(src.right)
  const bottom = Number(src.bottom)
  if (![left, top, right, bottom].every((n) => isFinite(n))) return null
  const extra = isFinite(Number(pad)) ? Number(pad) : 18
  let l = left - extra
  let r = right + extra
  let t = top - extra
  let b = bottom + extra
  const minWidth = isFinite(Number(minW)) ? Number(minW) : 56
  const minHeight = isFinite(Number(minH)) ? Number(minH) : 88
  const cx = (l + r) / 2
  const cy = (t + b) / 2
  if (r - l < minWidth) {
    l = cx - minWidth / 2
    r = cx + minWidth / 2
  }
  if (b - t < minHeight) {
    t = cy - minHeight / 2
    b = cy + minHeight / 2
  }
  return { left: l, top: t, right: r, bottom: b }
}

function padModelHitRect(rect) {
  const src = rect && typeof rect === 'object' ? rect : {}
  const left = Number(src.left)
  const top = Number(src.top)
  const right = Number(src.right)
  const bottom = Number(src.bottom)
  if (![left, top, right, bottom].every((n) => isFinite(n))) return null
  const w = Math.max(0, right - left)
  const h = Math.max(0, bottom - top)
  const padX = Math.max(HIT_SLACK_PX, w * HIT_PAD_RATIO)
  const padY = Math.max(HIT_SLACK_PX, h * HIT_PAD_RATIO)
  return {
    left: left - padX,
    top: top - padY,
    right: right + padX,
    bottom: bottom + padY
  }
}

function hitTestPoint(x, y, rect) {
  if (!rect) return false
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
}

function hitRectArea(rect) {
  if (!rect) return Infinity
  return Math.max(1, (rect.right - rect.left) * (rect.bottom - rect.top))
}

function pickBestHitSlug(hits, x, y, usePad) {
  const list = Array.isArray(hits) ? hits : []
  let best = ''
  let bestArea = Infinity
  for (let i = 0; i < list.length; i++) {
    const item = list[i]
    if (!item) continue
    const rect = usePad ? padModelHitRect(item) : item
    if (!hitTestPoint(x, y, rect)) continue
    const area = hitRectArea(rect)
    if (area < bestArea) {
      bestArea = area
      best = String(item.slug || '')
    }
  }
  return best
}

function pickHitSlug(hits, x, y) {
  return pickBestHitSlug(hits, x, y, false) || pickBestHitSlug(hits, x, y, true)
}

function clampBubblePos(x, y, cssW, cssH, bw, bh) {
  const w = Number(cssW) || 1
  const h = Number(cssH) || 1
  const boxW = Number(bw) || 240
  const boxH = Number(bh) || 128
  const margin = 12
  const nx = Math.max(margin, Math.min(w - boxW - margin, Number(x) || 0))
  const ny = Math.max(margin, Math.min(h - boxH - margin, Number(y) || 0))
  return { x: Math.round(nx), y: Math.round(ny) }
}

function placeBubbleBesideHead(anchor, cssW, cssH, bw, bh) {
  if (!anchor || !anchor.visible) return null
  const ax = Number(anchor.x)
  const ay = Number(anchor.y)
  if (!isFinite(ax) || !isFinite(ay)) return null
  const boxH = Number(bh) || 140
  return {
    x: Math.round(ax - 28),
    y: Math.round(ay - boxH - 6),
    below: false
  }
}

function touchCssPoint(e) {
  const list = (e && (e.changedTouches || e.touches)) || []
  const t = list[0]
  if (!t) return null
  const x = t.x != null ? t.x : t.clientX
  const y = t.y != null ? t.y : t.clientY
  if (!isFinite(Number(x)) || !isFinite(Number(y))) return null
  return { x: Number(x), y: Number(y) }
}

module.exports = {
  INTROS,
  HIT_PAD_RATIO,
  HIT_SLACK_PX,
  getIpIntro,
  joinIntroLines,
  typeIntroAt,
  nextTypeDelay,
  expandHitRect,
  padModelHitRect,
  hitTestPoint,
  pickHitSlug,
  clampBubblePos,
  placeBubbleBesideHead,
  touchCssPoint
}
