/**
 * 分包本地副本（源：utils/oa-alert.js）。
 * 若修改逻辑，请同步更新主包 utils/oa-alert.js。
 *
 * 服务号 B 通道：自动发射提醒 opt-in。
 * 就绪后应由服务号全自动到期推送，不再要求用户逐条点「发射提醒」。
 */

const OA_ALERT_STATUS_TTL_MS = 10 * 60 * 1000

var _cacheAt = 0
var _cacheStatus = null
var _inflight = null

function callGateway(path, method, body) {
  return wx.cloud.callFunction({
    name: 'adminGateway',
    data: { path: path, method: method, body: body || {} }
  })
}

function invalidateOaAlertCache() {
  _cacheAt = 0
  _cacheStatus = null
  _inflight = null
}

function peekOaAlertReady() {
  return !!(_cacheStatus && _cacheStatus.ready)
}

async function getOaAlertStatus(force) {
  var now = Date.now()
  if (!force && _cacheStatus && now - _cacheAt < OA_ALERT_STATUS_TTL_MS) {
    return _cacheStatus
  }
  if (!force && _inflight) return _inflight

  _inflight = (async function () {
    var fallback = { enabled: false, followed: false, ready: false, message: '云能力不可用' }
    if (!wx.cloud || !wx.cloud.callFunction) {
      _cacheStatus = fallback
      _cacheAt = Date.now()
      return fallback
    }
    try {
      var res = await callGateway('/oa-alert/status', 'GET')
      var result = res && res.result
      var data =
        result && result.code === 0 && result.data
          ? result.data
          : {
              enabled: false,
              followed: false,
              ready: false,
              message: (result && result.message) || '查询失败'
            }
      _cacheStatus = data
      _cacheAt = Date.now()
      return data
    } catch (e) {
      var errStatus = { enabled: false, followed: false, ready: false, message: '网络异常' }
      _cacheStatus = errStatus
      _cacheAt = Date.now() - Math.floor(OA_ALERT_STATUS_TTL_MS * 0.8)
      return errStatus
    } finally {
      _inflight = null
    }
  })()

  return _inflight
}

async function isOaAlertReady(force) {
  var status = await getOaAlertStatus(!!force)
  return !!(status && status.ready)
}

async function enableOaAlert() {
  if (!wx.cloud || !wx.cloud.callFunction) {
    wx.showToast({ title: '云能力不可用', icon: 'none' })
    return false
  }
  try {
    var res = await callGateway('/oa-alert/enable', 'POST', {})
    var result = res && res.result
    invalidateOaAlertCache()
    if (result && result.code === 0) {
      wx.showToast({ title: '已开启服务号提醒', icon: 'success' })
      return true
    }
    wx.showToast({ title: (result && result.message) || '开启失败', icon: 'none' })
    return false
  } catch (e) {
    wx.showToast({ title: '开启失败', icon: 'none' })
    return false
  }
}

async function disableOaAlert() {
  if (!wx.cloud || !wx.cloud.callFunction) return false
  try {
    var res = await callGateway('/oa-alert/disable', 'POST', {})
    var result = res && res.result
    invalidateOaAlertCache()
    if (result && result.code === 0) {
      wx.showToast({ title: '已关闭服务号提醒', icon: 'none' })
      return true
    }
    wx.showToast({ title: (result && result.message) || '关闭失败', icon: 'none' })
    return false
  } catch (e) {
    wx.showToast({ title: '关闭失败', icon: 'none' })
    return false
  }
}

module.exports = {
  OA_ALERT_STATUS_TTL_MS: OA_ALERT_STATUS_TTL_MS,
  getOaAlertStatus: getOaAlertStatus,
  isOaAlertReady: isOaAlertReady,
  peekOaAlertReady: peekOaAlertReady,
  invalidateOaAlertCache: invalidateOaAlertCache,
  enableOaAlert: enableOaAlert,
  disableOaAlert: disableOaAlert
}
