/**
 * 全局统一的下拉刷新逻辑
 *
 * 布局规范（nav-aware-scroll）：
 *   - 全屏 100vh scroll-view（磨砂：内容滚入导航下）
 *   - 首子 <nav-scroll-pad id="navScrollPad" class="nav-scroll-pad" height="{{navPlaceholderHeight}}" />
 *   - 固定导航后放置 #pullRefreshDots，原生 refresher-default-style 设为 none
 *   - data-nav-h / data-refresh-threshold + pulling/restore/abort/touchend → navPad wxs
 *   - enablePullDownRefresh:false，只保留 scroll-view refresher
 *
 * 用法：
 *   onScrollRefresh() { runPullRefresh(this, () => this.loadData(), 'scrollRefreshing') }
 */

function vibrateMedium() {
  try {
    wx.vibrateShort({ type: 'medium' })
  } catch (e) {
    try {
      wx.vibrateShort()
    } catch (e2) {}
  }
}

/**
 * @param {Object} page 页面实例
 * @param {Function} task 刷新任务，返回 Promise
 * @param {String} [key] scroll-view refresher-triggered 字段名；不传则页面级下拉
 */
async function runPullRefresh(page, task, key) {
  if (!page || typeof task !== 'function') return

  if (key) {
    if (page.data && page.data[key]) return
    page.setData({ [key]: true })
    vibrateMedium()
    try {
      await task()
    } catch (e) {}
    page.setData({ [key]: false })
    return
  }

  if (page._pullRefreshRunning) return
  page._pullRefreshRunning = true
  vibrateMedium()
  try {
    await task()
  } catch (e) {}
  page._pullRefreshRunning = false
  try {
    wx.stopPullDownRefresh()
  } catch (e) {}
}

module.exports = {
  runPullRefresh,
  vibrateMedium
}
