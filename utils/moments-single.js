/**
 * 朋友圈单页模式（scene 1154）布局适配
 * - 微信提供原生顶/底栏，自定义顶栏需隐藏
 * - 配合 app.json singlePage.navigationBarFit = squeezed，顶占位归零
 */

function isMomentsSinglePage() {
  try {
    const launchInfo = wx.getLaunchOptionsSync()
    if (launchInfo && launchInfo.scene === 1154) return true
  } catch (_) {}
  try {
    const enterInfo = typeof wx.getEnterOptionsSync === 'function' ? wx.getEnterOptionsSync() : null
    if (enterInfo && enterInfo.scene === 1154) return true
  } catch (_) {}
  return false
}

/**
 * @param {object} layout getUiShellLayout 返回值
 * @param {string} [themeClass]
 * @returns {object|null} 需 merge 进 setData 的字段；非单页返回 null
 */
function buildMomentsSinglePagePatch(layout = {}, themeClass = '') {
  if (!isMomentsSinglePage()) return null
  const safeBottom = Number(layout.safeBottomInset) || 0
  const base = String(themeClass || '').replace(/\bis-moments-single\b/g, '').trim()
  return {
    isMomentsPreview: true,
    navPlaceholderHeight: 0,
    tabBarReservedHeight: 52 + safeBottom,
    themeClass: base ? `${base} is-moments-single` : 'is-moments-single'
  }
}

module.exports = {
  isMomentsSinglePage,
  buildMomentsSinglePagePatch
}
