/**
 * 分包预下载：页面切换「处理路由」里很大一块是首次下载/编译分包。
 * 只在首屏之后或用户露出明确意图时调用，避免和首页抢带宽。
 */
function preloadSubpackages(names) {
  if (typeof wx === 'undefined' || typeof wx.preloadSubpackage !== 'function') return
  if (!names || !names.length) return
  for (let i = 0; i < names.length; i++) {
    const name = names[i]
    if (!name) continue
    try {
      wx.preloadSubpackage({ name: name, fail() {} })
    } catch (e) {}
  }
}

module.exports = { preloadSubpackages }
