/**

 * 发射提醒订阅模块（微信订阅消息）

 */



const storageCache = require('./storage-sync-cache.js')



/** 发射前提醒（一次性） */
const TEMPLATE_ID = 'T5J5sRh2UdEwFE7q_VTbdowA0PeXrz_3bUweWEL6uBs'
/** 任务完成提醒 / 发射结果（一次性） */
const RESULT_TEMPLATE_ID = 'ulf34VqAS9Tj32BMqj4M1qudtKKy04iiBM7Qb9_VDb4'

const SUBSCRIBE_COLLECTION = 'launch_subscriptions'

const SUBSCRIBED_MISSIONS_KEY = '_subscribed_missions'

let _subscribedMem = null
let _subscribedMemLoaded = false



function _emptySubscribedStore() {

  return {}

}



function _loadSubscribedStore() {
  if (_subscribedMemLoaded) return _subscribedMem || _emptySubscribedStore()
  _subscribedMem = storageCache.readSync(SUBSCRIBED_MISSIONS_KEY, _emptySubscribedStore()) || _emptySubscribedStore()
  _subscribedMemLoaded = true
  return _subscribedMem
}



function warmSubscribedStoreSync() {

  return _loadSubscribedStore()

}



function warmSubscribedStoreAsync() {

  if (storageCache.isLoaded(SUBSCRIBED_MISSIONS_KEY)) return Promise.resolve(_loadSubscribedStore())

  return storageCache.warmAsync(SUBSCRIBED_MISSIONS_KEY, _emptySubscribedStore())

}



function invalidateSubscribedStore() {
  _subscribedMem = null
  _subscribedMemLoaded = false
  storageCache.invalidate(SUBSCRIBED_MISSIONS_KEY)
}



function _persistSubscribedStore(stored, options) {
  var next = stored || _emptySubscribedStore()
  _subscribedMem = next
  _subscribedMemLoaded = true
  storageCache.writeMem(SUBSCRIBED_MISSIONS_KEY, next)

  try {

    if (options && options.syncWrite) {

      wx.setStorageSync(SUBSCRIBED_MISSIONS_KEY, next)

    } else {

      wx.setStorage({ key: SUBSCRIBED_MISSIONS_KEY, data: next, fail: function () {} })

    }

  } catch (e) {}

}



var _recordMilestone = null

function getRecordMilestone() {

  if (!_recordMilestone) _recordMilestone = require('./user-growth.js').recordMilestone

  return _recordMilestone

}



function formatLaunchTime(isoTime) {

  if (!isoTime) return '时间未知'

  try {

    var d = new Date(isoTime)

    var y = d.getFullYear()

    var m = String(d.getMonth() + 1).padStart(2, '0')

    var day = String(d.getDate()).padStart(2, '0')

    var h = String(d.getHours()).padStart(2, '0')

    var min = String(d.getMinutes()).padStart(2, '0')

    return y + '年' + m + '月' + day + '日 ' + h + ':' + min

  } catch (e) {

    return '时间未知'

  }

}



function isTemplateSubscribed(res, tmplId) {

  var s = res && res[tmplId]

  return (

    s === 'accept' ||

    s === 'acceptWithAudio' ||

    s === 'acceptWithAlert'

  )

}



/**
 * 一次弹窗订阅「发射提醒 + 结果通知」两个模板。
 * 只要发射提醒 accept 即视为可设提醒；结果模板 accept 则额外记 resultQuota。
 * @returns {Promise<{ reminder: boolean, result: boolean }>}
 */
function requestSubscribePermission() {

  return new Promise(function (resolve) {

    wx.requestSubscribeMessage({

      tmplIds: [TEMPLATE_ID, RESULT_TEMPLATE_ID],

      success: function (res) {

        var reminderStatus = res && res[TEMPLATE_ID]
        var resultStatus = res && res[RESULT_TEMPLATE_ID]

        if (reminderStatus === 'ban' && resultStatus === 'ban') {

          wx.showToast({ title: '该模板暂不可用', icon: 'none' })

          resolve({ reminder: false, result: false })

          return

        }

        if (reminderStatus === 'filter' || resultStatus === 'filter') {

          wx.showToast({ title: '模板配置冲突', icon: 'none' })

          resolve({ reminder: false, result: false })

          return

        }

        resolve({
          reminder: isTemplateSubscribed(res, TEMPLATE_ID),
          result: isTemplateSubscribed(res, RESULT_TEMPLATE_ID)
        })

      },

      fail: function () {

        resolve({ reminder: false, result: false })

      }

    })

  })

}



async function subscribeLaunch(mission) {

  if (!mission || !mission.id) {

    wx.showToast({ title: '任务数据无效', icon: 'none' })

    return false

  }



  var perm = await requestSubscribePermission()

  if (!perm || !perm.reminder) {

    wx.showToast({ title: '需要授权才能接收发射与结果通知', icon: 'none' })

    return false

  }



  if (!wx.cloud || !wx.cloud.callFunction) {

    wx.showToast({ title: '云能力不可用', icon: 'none' })

    return false

  }



  try {

    var launchTime = mission.launchTime || mission.windowStart || ''

    var notifyMinutesBefore = 30

    var notifyAt = 0

    if (launchTime) {

      notifyAt = new Date(launchTime).getTime() - notifyMinutesBefore * 60 * 1000

    }



    var recoveryText = '一次性'

    if (mission.isRecoverableThisMission) {

      var bi = mission.boosterInfo

      if (bi && bi.landingType === 'RTLS') recoveryText = '陆地回收 (RTLS)'

      else if (bi && bi.landingType === 'ASDS') recoveryText = '海上回收 (ASDS)'

      else recoveryText = '可回收'

    }



    var res = await wx.cloud.callFunction({

      name: 'adminGateway',

      data: {

        path: '/subscribe',

        method: 'POST',

        body: {

          missionId: String(mission.id),

          missionName: (mission.missionName || mission.name || '未知任务').substring(0, 20),

          rocketName: (mission.rocketName || '未知火箭').substring(0, 20),

          launchTime: launchTime,

          launchTimeFormatted: formatLaunchTime(launchTime),

          recoveryMethod: recoveryText.substring(0, 20),

          notifyAt: notifyAt,

          notifyLeadMinutes: notifyMinutesBefore,

          templateId: TEMPLATE_ID,

          resultTemplateId: RESULT_TEMPLATE_ID,

          resultQuota: !!(perm && perm.result)

        }

      }

    })



    if (res.result && res.result.code === 0) {

      saveLocalSubscription(mission.id, mission)

      getRecordMilestone()('FIRST_SUBSCRIBE', { missionName: mission.missionName || mission.name })

      if (res.result.data && res.result.data.duplicate) {

        wx.showToast({

          title: res.result.data.updated ? '提醒信息已同步' : '已设置过提醒（含结果通知）',

          icon: 'none'

        })

      } else {

        wx.showToast({ title: '提醒已开启（含结果通知）', icon: 'success' })

      }

      return true

    }



    wx.showToast({ title: '设置提醒失败', icon: 'none' })

    return false

  } catch (error) {

    wx.showToast({ title: '设置提醒失败', icon: 'none' })

    return false

  }

}



function saveLocalSubscription(missionId, missionInfo) {

  try {

    var stored = { ..._loadSubscribedStore() }

    stored[String(missionId)] = {

      ts: Date.now(),

      name: (missionInfo && (missionInfo.missionName || missionInfo.name)) || '未知任务',

      rocket: (missionInfo && missionInfo.rocketName) || '',

      rocketImage: (missionInfo && missionInfo.rocketImage) || '',

      launchTime: (missionInfo && (missionInfo.launchTime || missionInfo.windowStart)) || '',

      pad: (missionInfo && missionInfo.padName) || ''

    }

    _persistSubscribedStore(stored)

  } catch (e) {}

}



function isSubscribed(missionId) {

  try {

    var stored = _loadSubscribedStore()

    return !!stored[String(missionId)]

  } catch (e) {

    return false

  }

}



function getSubscribedMissionIdSet() {

  var stored = _loadSubscribedStore()

  return new Set(Object.keys(stored))

}



function getSubscribedStore() {

  return _loadSubscribedStore()

}



function getSubscribedMissions() {

  try {

    var stored = _loadSubscribedStore()

    var list = []

    Object.keys(stored).forEach(function (id) {

      var entry = stored[id]

      if (typeof entry === 'number') {

        list.push({ id: id, ts: entry, name: '发射任务 #' + id, rocket: '', rocketImage: '', launchTime: '', pad: '' })

      } else if (entry && typeof entry === 'object') {

        list.push({ id: id, ts: entry.ts || 0, name: entry.name || '', rocket: entry.rocket || '', rocketImage: entry.rocketImage || '', launchTime: entry.launchTime || '', pad: entry.pad || '' })

      }

    })

    return list

  } catch (e) {

    return []

  }

}



async function syncSubscribedMissions() {

  if (!wx.cloud || !wx.cloud.callFunction) return false

  try {

    var res = await wx.cloud.callFunction({

      name: 'adminGateway',

      data: { path: '/subscribe', method: 'GET' }

    })

    var result = res && res.result

    if (!result || result.code !== 0 || !result.data || !result.data.list) return false



    var cloudList = result.data.list

    var stored = { ..._loadSubscribedStore() }

    var changed = false



    cloudList.forEach(function (item) {

      var id = String(item.missionId)

      var local = stored[id]

      var needUpdate = !local || typeof local === 'number' || !local.name || local.name === '发射任务 #' + id



      if (needUpdate) {

        stored[id] = {

          ts: (local && typeof local === 'object' && local.ts) || (typeof local === 'number' ? local : Date.now()),

          name: item.missionName || (local && local.name) || '',

          rocket: item.rocketName || (local && local.rocket) || '',

          rocketImage: (local && local.rocketImage) || '',

          launchTime: item.launchTime || (local && local.launchTime) || '',

          pad: (local && local.pad) || ''

        }

        changed = true

      }

    })



    if (changed) {

      _persistSubscribedStore(stored)

    }

    return changed

  } catch (e) {

    return false

  }

}



async function unsubscribeLaunch(missionId) {

  if (!missionId) return false

  var key = String(missionId)



  try {

    var stored = { ..._loadSubscribedStore() }

    delete stored[key]

    _persistSubscribedStore(stored)

  } catch (e) {}



  if (!wx.cloud || !wx.cloud.callFunction) return true

  try {

    await wx.cloud.callFunction({

      name: 'adminGateway',

      data: { path: '/subscribe/' + key, method: 'DELETE' }

    })

  } catch (e) {}



  return true

}



async function syncSubscriptionState(missionId) {

  if (!missionId || !wx.cloud || !wx.cloud.callFunction) return false

  try {

    var res = await wx.cloud.callFunction({

      name: 'adminGateway',

      data: {

        path: '/subscribe/' + String(missionId),

        method: 'GET'

      }

    })

    var subscribed = !!(res.result && res.result.code === 0 && res.result.data && res.result.data.subscribed)

    try {

      var stored = { ..._loadSubscribedStore() }

      if (subscribed) {

        if (!stored[String(missionId)]) {

          stored[String(missionId)] = { ts: Date.now(), name: '', rocket: '', launchTime: '', pad: '' }

        }

      } else {

        delete stored[String(missionId)]

      }

      _persistSubscribedStore(stored)

    } catch (e) {}

    return subscribed

  } catch (e) {

    return isSubscribed(missionId)

  }

}



module.exports = {

  TEMPLATE_ID: TEMPLATE_ID,

  RESULT_TEMPLATE_ID: RESULT_TEMPLATE_ID,

  subscribeLaunch: subscribeLaunch,

  unsubscribeLaunch: unsubscribeLaunch,

  isSubscribed: isSubscribed,

  getSubscribedMissionIdSet: getSubscribedMissionIdSet,

  getSubscribedStore: getSubscribedStore,

  getSubscribedMissions: getSubscribedMissions,

  saveLocalSubscription: saveLocalSubscription,

  syncSubscribedMissions: syncSubscribedMissions,

  syncSubscriptionState: syncSubscriptionState,

  requestSubscribePermission: requestSubscribePermission,

  warmSubscribedStoreSync: warmSubscribedStoreSync,

  warmSubscribedStoreAsync: warmSubscribedStoreAsync,

  invalidateSubscribedStore: invalidateSubscribedStore

}


