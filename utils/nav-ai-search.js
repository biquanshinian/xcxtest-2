/**
 * 顶栏放大镜：直达星问（与首页导航同一套门控）
 */
const { isAIAvailable } = require('./aiService.js')
const { isFeatureEnabled } = require('./feature-flags.js')
const { ROUTES } = require('./routes.js')

async function resolveNavAiSearchVisible() {
  try {
    return !!(isAIAvailable() && await isFeatureEnabled('enableAIChat', { failClosed: true }))
  } catch (e) {
    return false
  }
}

function openNavAiSearch() {
  if (!isAIAvailable()) {
    wx.showToast({ title: '星问AI暂未开放', icon: 'none' })
    return
  }
  isFeatureEnabled('enableAIChat', { failClosed: true }).then((on) => {
    if (!on) {
      wx.showToast({ title: '星问AI暂未开放', icon: 'none' })
      return
    }
    wx.navigateTo({
      url: ROUTES.AI_CHAT,
      fail: () => {
        wx.showToast({ title: '打开星问失败', icon: 'none' })
      }
    })
  }).catch(() => {
    wx.showToast({ title: '星问AI暂未开放', icon: 'none' })
  })
}

module.exports = {
  resolveNavAiSearchVisible,
  openNavAiSearch
}
