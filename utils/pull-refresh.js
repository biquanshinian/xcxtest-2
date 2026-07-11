/**
 * 全局统一的下拉刷新逻辑（微信原生样式）
 *
 * 统一规范：
 *   - 视觉：页面级原生下拉刷新（json 开 enablePullDownRefresh + backgroundTextStyle: "light"），
 *     微信自带三点指示器、标准触发行程；页面保持「全屏滚动 + fixed 磨砂导航栏」布局，
 *     内容从导航栏下方穿过，backdrop-filter 磨砂质感不受影响
 *   - 触感：触发即中度震动（wx.vibrateShort medium）
 *   - 逻辑：防重入；任务结束（含失败）后 wx.stopPullDownRefresh() 复位
 *   - 数据：刷新任务只允许重读云数据库/缓存，绝不触发 LL2 请求或网页抓取
 *     （实时拉取节奏由云函数缓存 TTL 与定时器自动分配）
 *
 * 用法（页面 js，方法名必须是 onPullDownRefresh）：
 *   const { runPullRefresh } = require('../../utils/pull-refresh.js')
 *   onPullDownRefresh() {
 *     runPullRefresh(this, () => this.loadData())
 *   }
 *
 * 页面内嵌 scroll-view 的局部刷新（如星舰进度页事件更新列表）传第三参 key，
 * 走 scroll-view refresher-triggered 模式（refresher-default-style="white"）。
 */

function vibrateMedium() {
  try {
    wx.vibrateShort({ type: 'medium' })
  } catch (e) {
    try { wx.vibrateShort() } catch (e2) {}
  }
}

/**
 * 统一执行下拉刷新任务
 * @param {Object} page 页面实例
 * @param {Function} task 刷新任务，返回 Promise；只允许重读云数据库/缓存
 * @param {String} [key] 可选：scroll-view refresher 模式的 refresher-triggered 字段名；
 *                       不传则为页面级原生下拉模式（结束时自动 stopPullDownRefresh）
 */
async function runPullRefresh(page, task, key) {
  if (!page || typeof task !== 'function') return

  // scroll-view refresher 模式（页面内嵌局部列表）
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

  // 页面级原生下拉模式
  if (page._pullRefreshRunning) return
  page._pullRefreshRunning = true
  vibrateMedium()
  try {
    await task()
  } catch (e) {}
  page._pullRefreshRunning = false
  try { wx.stopPullDownRefresh() } catch (e) {}
}

module.exports = {
  runPullRefresh,
  vibrateMedium
}
