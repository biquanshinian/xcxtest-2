/**
 * 轮播从页面拆到自定义组件后，inner dataset 经 triggerEvent 落在 e.detail。
 * 兼容：组件事件读 detail；若仍走页面节点则回退 currentTarget.dataset。
 */
function resolveCarouselEventDs(e) {
  const fromTarget = (e && e.currentTarget && e.currentTarget.dataset) || {}
  const fromDetail = e && e.detail && typeof e.detail === 'object' && !Array.isArray(e.detail) ? e.detail : {}
  return Object.assign({}, fromTarget, fromDetail)
}

module.exports = { resolveCarouselEventDs }
