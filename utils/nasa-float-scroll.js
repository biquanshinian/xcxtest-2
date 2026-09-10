/**
 * 通知页面上的 nasa-float：滑动收起 / 停滑展现
 * 各 Tab 页 scroll-view bindscroll 中调用即可。
 */
function pulseNasaFloatOnScroll(page) {
  if (!page || typeof page.selectComponent !== 'function') return
  try {
    const c = page.selectComponent('#nasaFloat') || page.selectComponent('nasa-float')
    if (c && typeof c.pulseScrollHide === 'function') c.pulseScrollHide()
  } catch (e) {}
}

module.exports = {
  pulseNasaFloatOnScroll
}
