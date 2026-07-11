/**
 * wx.getSystemInfoSync 的替代方案
 * 聚合 wx.getWindowInfo / wx.getDeviceInfo / wx.getAppBaseInfo，
 * 返回与旧 API 字段兼容的对象，消除 deprecated 警告。
 *
 * deviceInfo / appBaseInfo 在会话内不变（品牌/型号/系统/SDK 版本等），
 * 首次读取后缓存复用；windowInfo 含 windowWidth/Height/safeArea，
 * 可能随横竖屏或分屏变化，每次重新读取以保证布局正确。
 */
let _deviceInfoCache = null
let _appBaseInfoCache = null

function getSystemInfo() {
  const windowInfo = wx.getWindowInfo()
  if (!_deviceInfoCache) _deviceInfoCache = wx.getDeviceInfo()
  if (!_appBaseInfoCache) _appBaseInfoCache = wx.getAppBaseInfo()
  return Object.assign({}, windowInfo, _deviceInfoCache, _appBaseInfoCache)
}

module.exports = { getSystemInfo }
