/**
 * wx.getSystemInfoSync 的替代方案
 * 聚合 wx.getWindowInfo / wx.getDeviceInfo / wx.getAppBaseInfo，
 * 返回与旧 API 字段兼容的对象，消除 deprecated 警告。
 *
 * 基础库 < 2.20.1 没有拆分 API；部分机型/后台态调用会抛错。
 * 任一新 API 缺失或抛错时回退 getSystemInfoSync，避免首页/Tab 整页白屏。
 *
 * deviceInfo / appBaseInfo 在会话内不变（品牌/型号/系统/SDK 版本等），
 * 首次读取后缓存复用；windowInfo 含 windowWidth/Height/safeArea，
 * 可能随横竖屏或分屏变化，每次重新读取以保证布局正确。
 */
let _deviceInfoCache = null
let _appBaseInfoCache = null

function safeWxInfo(getter) {
  try {
    if (typeof getter === 'function') return getter() || {}
  } catch (e) {}
  return {}
}

function readLegacySystemInfo() {
  try {
    if (typeof wx.getSystemInfoSync === 'function') return wx.getSystemInfoSync() || {}
  } catch (e) {}
  return {}
}

function getSystemInfo() {
  const windowInfo = safeWxInfo(wx.getWindowInfo)
  if (!_deviceInfoCache) {
    const device = safeWxInfo(wx.getDeviceInfo)
    _deviceInfoCache = device && Object.keys(device).length ? device : null
  }
  if (!_appBaseInfoCache) {
    const appBase = safeWxInfo(wx.getAppBaseInfo)
    _appBaseInfoCache = appBase && Object.keys(appBase).length ? appBase : null
  }

  const merged = Object.assign({}, windowInfo, _deviceInfoCache || {}, _appBaseInfoCache || {})
  if (merged.windowWidth && merged.statusBarHeight != null) return merged

  const legacy = readLegacySystemInfo()
  if (!_deviceInfoCache && legacy.platform) {
    _deviceInfoCache = {
      brand: legacy.brand,
      model: legacy.model,
      platform: legacy.platform,
      system: legacy.system
    }
  }
  if (!_appBaseInfoCache && (legacy.SDKVersion || legacy.theme || legacy.language)) {
    _appBaseInfoCache = {
      SDKVersion: legacy.SDKVersion,
      theme: legacy.theme,
      language: legacy.language,
      version: legacy.version
    }
  }
  return Object.assign({}, legacy, merged)
}

module.exports = { getSystemInfo }
