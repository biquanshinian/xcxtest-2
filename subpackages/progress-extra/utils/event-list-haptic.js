/**
 * 事件更新列表滑动轻震：以「当前对准的推文卡片」为准，换一张才震一次。
 * 不用滑动距离分桶——推文高度差很大，按像素震没有内容语义。
 */

function parseHapticIndex(rect, fallback) {
  if (rect && rect.dataset) {
    const raw = rect.dataset.hapticIndex
    if (raw !== undefined && raw !== null && raw !== '') {
      const n = Number(raw)
      if (Number.isFinite(n)) return n
    }
  }
  const n = Number(fallback)
  return Number.isFinite(n) ? n : -1
}

/** 视口内容区约 32% 处那条线压在哪张推文上 */
function resolveTweetCardFocusIndex(options) {
  const opts = options && typeof options === 'object' ? options : {}
  const scrollViewRect = opts.scrollViewRect
  const cardRects = Array.isArray(opts.cardRects) ? opts.cardRects : []
  const navPlaceholderHeight = Math.max(0, Number(opts.navPlaceholderHeight) || 0)
  if (!scrollViewRect || !cardRects.length) return -1

  const contentTop = scrollViewRect.top + navPlaceholderHeight
  const visible = Math.max(1, (scrollViewRect.height || 0) - navPlaceholderHeight)
  const anchorY = contentTop + visible * 0.32

  let covering = -1
  let coveringHeight = -1
  let nearest = -1
  let nearestDist = Infinity

  for (let i = 0; i < cardRects.length; i++) {
    const r = cardRects[i]
    if (!r || typeof r.top !== 'number') continue
    const height = r.height || 0
    const top = r.top
    const bottom = top + height
    const idx = parseHapticIndex(r, i)
    if (idx < 0) continue
    if (top <= anchorY && bottom >= anchorY) {
      if (height > coveringHeight) {
        coveringHeight = height
        covering = idx
      }
    }
    const center = top + height / 2
    const dist = Math.abs(center - anchorY)
    if (dist < nearestDist) {
      nearestDist = dist
      nearest = idx
    }
  }
  if (covering >= 0) return covering
  return nearest
}

function buildTweetCardHapticState(options) {
  const opts = options && typeof options === 'object' ? options : {}
  const focusIndex = Number(opts.focusIndex)
  const activeIndex = Number(opts.activeIndex)
  const now = typeof opts.now === 'number' ? opts.now : Date.now()
  const lastVibrateAt = Number(opts.lastVibrateAt) || 0
  const vibrateIntervalMs = typeof opts.vibrateIntervalMs === 'number' ? opts.vibrateIntervalMs : 140

  if (!Number.isFinite(focusIndex) || focusIndex < 0) {
    return {
      nextActiveIndex: Number.isFinite(activeIndex) ? activeIndex : -1,
      shouldVibrate: false,
      shouldSyncActiveIndex: false,
      nextLastVibrateAt: lastVibrateAt
    }
  }

  if (!Number.isFinite(activeIndex) || activeIndex < 0) {
    return {
      nextActiveIndex: focusIndex,
      shouldVibrate: false,
      shouldSyncActiveIndex: true,
      nextLastVibrateAt: lastVibrateAt
    }
  }

  if (focusIndex === activeIndex) {
    return {
      nextActiveIndex: activeIndex,
      shouldVibrate: false,
      shouldSyncActiveIndex: false,
      nextLastVibrateAt: lastVibrateAt
    }
  }

  const shouldVibrate = !lastVibrateAt || now - lastVibrateAt > vibrateIntervalMs
  return {
    nextActiveIndex: focusIndex,
    shouldVibrate,
    shouldSyncActiveIndex: true,
    nextLastVibrateAt: shouldVibrate ? now : lastVibrateAt
  }
}

module.exports = {
  parseHapticIndex,
  resolveTweetCardFocusIndex,
  buildTweetCardHapticState
}
