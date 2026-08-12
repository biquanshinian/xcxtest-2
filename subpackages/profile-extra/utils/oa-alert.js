/**
 * 分包本地副本（源：utils/oa-alert.js）。
 * 若修改逻辑，请同步更新主包 utils/oa-alert.js。
 *
 * 服务号 B 通道：自动发射提醒 opt-in。
 * 未关注服务号时不得显示「已开启」（假状态）；引导扫码关注后再开。
 */

const OA_ALERT_STATUS_TTL_MS = 10 * 60 * 1000

/** 服务号「火星探索日志」关注二维码（长按识别） */
const OA_FOLLOW_QR_URL =
  'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/%E4%BA%8C%E7%BB%B4%E7%A0%81/1786523995939_ilory0.png'

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

function seedDefaultReminderPrefsIfNeeded() {
  try {
    var ug = require('../../../utils/user-growth.js')
    var prefs = ug.loadPreferences() || {}
    if (!Array.isArray(prefs.rocketTypes)) {
      var seeded = Object.assign({}, ug.getDefaultPreferences(), prefs, {
        rocketTypes: [],
        launchSites: Array.isArray(prefs.launchSites) ? prefs.launchSites : [],
        notifyMinutes: [30, 60, 120].indexOf(Number(prefs.notifyMinutes)) >= 0
          ? Number(prefs.notifyMinutes)
          : 30,
        roadClosureAlert: prefs.roadClosureAlert !== false
      })
      ug.savePreferences(seeded)
    }
  } catch (seedErr) { /* 忽略 */ }
}

/**
 * @returns {Promise<{ ok: boolean, needFollow?: boolean, ready?: boolean }>}
 */
async function enableOaAlert() {
  if (!wx.cloud || !wx.cloud.callFunction) {
    wx.showToast({ title: '云能力不可用', icon: 'none' })
    return { ok: false }
  }
  try {
    invalidateOaAlertCache()
    var pre = await getOaAlertStatus(true)
    if (!pre.followed || !pre.oaOpenidBound) {
      return { ok: false, needFollow: true, followed: !!pre.followed, ready: false }
    }

    var res = await callGateway('/oa-alert/enable', 'POST', {})
    var result = res && res.result
    invalidateOaAlertCache()
    if (result && result.code === 0) {
      seedDefaultReminderPrefsIfNeeded()
      var data = (result && result.data) || {}
      if (!data.ready) {
        return { ok: false, needFollow: !data.followed, ready: false }
      }
      wx.showToast({ title: '已开启服务号提醒', icon: 'success' })
      return { ok: true, ready: true, followed: true }
    }
    if (result && (result.code === 4003 || (result.data && result.data.needFollow))) {
      return { ok: false, needFollow: true }
    }
    wx.showToast({ title: (result && result.message) || '开启失败', icon: 'none' })
    return { ok: false }
  } catch (e) {
    wx.showToast({ title: '开启失败', icon: 'none' })
    return { ok: false }
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
  OA_FOLLOW_QR_URL: OA_FOLLOW_QR_URL,
  getOaAlertStatus: getOaAlertStatus,
  isOaAlertReady: isOaAlertReady,
  peekOaAlertReady: peekOaAlertReady,
  invalidateOaAlertCache: invalidateOaAlertCache,
  enableOaAlert: enableOaAlert,
  disableOaAlert: disableOaAlert
}
