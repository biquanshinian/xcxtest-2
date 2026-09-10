/**
 * Tab 页分包浮层（nasa-float / popup-ad 等）首帧不挂树。
 * onShow 里拉 shared 的工作必须等 mark 之后，否则冷启动仍会抢资源加载。
 */
function markTabOverlayReady(page, after) {
  if (!page || typeof page.setData !== 'function') return
  page.setData({ tabSubpkgUiReady: true }, () => {
    page._tabSubpkgUiReady = true
    const q = page._tabOverlayReadyPending
    page._tabOverlayReadyPending = null
    if (Array.isArray(q)) {
      for (let i = 0; i < q.length; i++) {
        try { q[i]() } catch (e) {}
      }
    }
    if (typeof after === 'function') {
      try { after() } catch (e) {}
    }
  })
}

function scheduleAfterTabOverlayReady(page, fn) {
  if (!page || typeof fn !== 'function') return
  const kick = () => {
    if (!page._tabSubpkgUiReady) {
      if (!page._tabOverlayReadyPending) page._tabOverlayReadyPending = []
      page._tabOverlayReadyPending.push(fn)
      return
    }
    fn()
  }
  setTimeout(kick, 0)
}

module.exports = { markTabOverlayReady, scheduleAfterTabOverlayReady }
