/**
 * 服务号 B 通道：自动发射提醒 opt-in
 * 用户需关注服务号 + 在小程序开启开关；与 A 通道（订阅消息）并存。
 */

const OA_ALERT_COLLECTION_HINT = 'oa_auto_alert_users'

function callGateway(path, method, body) {
  return wx.cloud.callFunction({
    name: 'adminGateway',
    data: { path: path, method: method, body: body || {} }
  })
}

async function getOaAlertStatus() {
  if (!wx.cloud || !wx.cloud.callFunction) {
    return { enabled: false, followed: false, ready: false, message: '云能力不可用' }
  }
  try {
    var res = await callGateway('/oa-alert/status', 'GET')
    var result = res && res.result
    if (result && result.code === 0 && result.data) return result.data
    return {
      enabled: false,
      followed: false,
      ready: false,
      message: (result && result.message) || '查询失败'
    }
  } catch (e) {
    return { enabled: false, followed: false, ready: false, message: '网络异常' }
  }
}

async function enableOaAlert() {
  if (!wx.cloud || !wx.cloud.callFunction) {
    wx.showToast({ title: '云能力不可用', icon: 'none' })
    return false
  }
  try {
    var res = await callGateway('/oa-alert/enable', 'POST', {})
    var result = res && res.result
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
  OA_ALERT_COLLECTION_HINT: OA_ALERT_COLLECTION_HINT,
  getOaAlertStatus: getOaAlertStatus,
  enableOaAlert: enableOaAlert,
  disableOaAlert: disableOaAlert
}
