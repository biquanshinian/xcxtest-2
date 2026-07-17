const cloud = require('wx-server-sdk')
const axios = require('axios')
// 微信 HTTPS 调用统一 10s 超时，避免网络抖动时挂满整个函数超时时间
axios.defaults.timeout = 10000
const { syncLaunchDataFromCache } = require('./launch-data-sync.js')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
const SUBSCRIBE_COLLECTION = 'launch_subscriptions'
/** 发射前提醒 */
const TEMPLATE_ID = 'T5J5sRh2UdEwFE7q_VTbdowA0PeXrz_3bUweWEL6uBs'
/** 任务完成提醒 / 发射结果（与前端 utils/subscribe.js 一致） */
const RESULT_TEMPLATE_ID = String(
  process.env.RESULT_TEMPLATE_ID || 'ulf34VqAS9Tj32BMqj4M1qudtKKy04iiBM7Qb9_VDb4'
).trim()
/**
 * 「任务完成提醒」字段 key（与公众平台已添加模板一致；可用环境变量覆盖）
 * 关键词顺序：任务名称 / 任务开始时间 / 任务结果 / 备注
 */
const RESULT_TEMPLATE_FIELDS = {
  mission: String(process.env.RESULT_TMPL_FIELD_MISSION || 'thing1').trim() || 'thing1',
  time: String(process.env.RESULT_TMPL_FIELD_TIME || 'time2').trim() || 'time2',
  // 预览为自由文案「成功获取到记录」→ 默认按 thing；若后台是 phrase 请设 RESULT_TMPL_FIELD_RESULT=phrase3
  result: String(process.env.RESULT_TMPL_FIELD_RESULT || 'thing3').trim() || 'thing3',
  remark: String(process.env.RESULT_TMPL_FIELD_REMARK || 'thing4').trim() || 'thing4'
}
const PUSH_HISTORY_COLLECTION = 'push_history'
const OA_AUTO_ALERT_USERS = 'oa_auto_alert_users'
const OA_PUSH_LEDGER = 'oa_push_ledger'
const LAUNCH_DATA_COLLECTION = 'launch_data'
const OA_LEAD_MINUTES = 30

// ── C 通道：服务号「订阅通知」(bizsend) ──
// 一次性订阅模板「火箭发射任务提醒」，额度由 oaWebhook 在用户点「同意」时入账到 oa_subscribe_quota。
const OA_SUBSCRIBE_QUOTA_COLLECTION = 'oa_subscribe_quota'
const OA_SUBSCRIBE_TEMPLATE_ID = String(
  process.env.WECHAT_OA_SUBSCRIBE_TEMPLATE_ID || '2-gxvjtGT-SziFYlnMy-JJ8P9Zp7bAxBE1Xp0RXy_Vs'
).trim()
// 订阅通知模板字段 key（务必与公众平台模板一致）
const OA_SUBSCRIBE_FIELDS = {
  mission: 'thing1', // 任务名称（thing，≤20）
  time: 'time2', // 发射时间
  rocket: 'thing3', // 运载火箭（thing，≤20）
  recovery: 'thing4', // 回收方式（thing，≤20）
  remark: 'thing5' // 备注/发射场（thing，≤20）
}

const SPACE_DEVS_CACHE = 'space_devs_cache'

const ROCKET_NAME_ALIASES = {
  '长征5号': ['Long March 5', 'CZ-5', 'Changzheng 5'],
  '长征2号': ['Long March 2', 'CZ-2', 'Changzheng 2'],
  '长征7号': ['Long March 7', 'CZ-7', 'Changzheng 7'],
  '长征11号': ['Long March 11', 'CZ-11', 'Changzheng 11']
}

const LAUNCH_SITE_ALIASES = {
  '文昌': ['Wenchang'],
  '酒泉': ['Jiuquan'],
  '太原': ['Taiyuan'],
  '西昌': ['Xichang'],
  'KSC LC-39A': ['Kennedy', 'LC-39A', '39A'],
  'CCSFS SLC-40': ['Cape Canaveral', 'SLC-40'],
  'Vandenberg SLC-4E': ['Vandenberg', 'SLC-4E'],
  'Boca Chica': ['Starbase'],
  'Mahia LC-1': ['Mahia', 'Rocket Lab'],
  'Sriharikota': ['Satish Dhawan']
}

// 推送历史"明细行"开关：默认 true。云开发控制台把环境变量
// PUSH_HISTORY_DETAIL_ENABLED 设为 "0" / "false" / "off" 可关闭，
// 关闭后只写每批的汇总，不再为每条失败订阅追加明细记录。
function isPushHistoryDetailEnabled() {
  const raw = String(process.env.PUSH_HISTORY_DETAIL_ENABLED || '').trim().toLowerCase()
  if (!raw) return true
  return !['0', 'false', 'off', 'no', 'disabled'].includes(raw)
}

/**
 * 官方流程：小程序订阅消息
 * https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/subscribe-message.html
 *
 * 定时触发须 client_credential 换 token 后调「发送订阅消息」：
 * https://developers.weixin.qq.com/miniprogram/dev/OpenApiDoc/mp-message-management/subscribe-message/subscribe-message/subscribe-message/api_sendmessage
 *
 * 凭证任选其一：
 * - APPID + SECRET（或 WX_APPID/WX_SECRET、WECHAT_* 等）
 * - MP_CREDENTIALS = {"appid":"wx...","secret":"..."}
 * - 腾讯云「JSON 环境变量」合并后常见的 {"wx...18位":"AppSecret"}：键名即 AppID、值即 Secret（代码会识别）
 * 勿在 config.json 写空 environment 覆盖控制台。
 * 可选：MINIPROGRAM_STATE、SUBSCRIBE_MSG_LANG
 *
 * 调试：event.action 传 envCheck，可查看当前环境是否读到变量（不返回 Secret）。
 */
function pickMiniProgramCredentials() {
  const jsonKeys = ['MP_CREDENTIALS', 'WX_MINI_CREDENTIALS']
  for (const k of jsonKeys) {
    const raw = String(process.env[k] || '').trim()
    if (!raw) continue
    let o
    try {
      o = JSON.parse(raw)
    } catch (e) {
      throw new Error(k + ' 须为合法 JSON，例如 {"appid":"wx...","secret":"..."}')
    }
    let appid = String(o.appid || o.APPID || o.appId || '').trim()
    let secret = String(
      o.secret || o.SECRET || o.appSecret || o.app_secret || ''
    ).trim()
    if (appid && secret) return { appid, secret, source: k }
    const wxEntries = Object.entries(o).filter(function (ent) {
      return /^wx[0-9a-f]{16}$/i.test(ent[0])
    })
    if (wxEntries.length === 1) {
      const jk = wxEntries[0][0]
      const sv = String(wxEntries[0][1] != null ? wxEntries[0][1] : '').trim()
      if (sv.length >= 16) return { appid: jk, secret: sv, source: k + '(wxKeyMap)' }
    }
  }

  const appid = String(
    process.env.APPID ||
      process.env.WX_APPID ||
      process.env.MINIPROGRAM_APPID ||
      process.env.WECHAT_APPID ||
      ''
  ).trim()
  const secret = String(
    process.env.SECRET ||
      process.env.WX_SECRET ||
      process.env.MINIPROGRAM_SECRET ||
      process.env.APP_SECRET ||
      process.env.WECHAT_SECRET ||
      ''
  ).trim()
  if (appid && secret) return { appid, secret, source: 'APPID+SECRET' }

  const fromWxKeys = pickFromProcessEnvWxAppIdKeys()
  if (fromWxKeys) return fromWxKeys
  return null
}

/** 控制台 JSON 合并环境变量时，可能出现「变量名 = wx 开头 AppID、值 = Secret」 */
function pickFromProcessEnvWxAppIdKeys() {
  const matches = []
  for (const key of Object.keys(process.env)) {
    if (!/^wx[0-9a-f]{16}$/i.test(key)) continue
    const secret = String(process.env[key] || '').trim()
    if (secret.length >= 16) matches.push({ appid: key, secret: secret, source: 'ENV_WXKEY_AS_NAME' })
  }
  if (matches.length === 1) return matches[0]
  if (matches.length > 1) {
    throw new Error(
      '环境变量中有多组「键名为 18 位 AppID、值为 Secret」；请只保留一组，或改用变量名 APPID + SECRET。'
    )
  }
  return null
}

function getMiniProgramCredentials() {
  const picked = pickMiniProgramCredentials()
  if (!picked) {
    throw new Error(
      '缺少小程序凭证。请在 sendLaunchReminder 环境变量中配置：\n' +
        '方式 A：变量名填 APPID、变量名填 SECRET（两行的「键」必须存在，不能只填值）；\n' +
        '方式 B：MP_CREDENTIALS = {"appid":"wx...","secret":"..."}；\n' +
        '方式 C：腾讯云 JSON 环境变量 {"wx你的AppID":"AppSecret"}（键=AppID、值=Secret）也会自动识别。\n' +
        '勿在本地 config.json 添加空 environment 后上传覆盖控制台。可先传 {"action":"envCheck"} 自检。'
    )
  }
  const { appid, secret } = picked
  if (!/^wx[0-9a-f]{16}$/i.test(appid)) {
    throw new Error(
      'APPID 格式异常（应为 wx + 16 位十六进制，共18位）。请核对是否多填字符，当前前缀: ' +
        appid.slice(0, 6)
    )
  }
  if (secret.length < 16) {
    throw new Error('SECRET 长度过短，请确认复制的是 AppSecret 全文')
  }
  return { appid, secret, source: picked.source }
}

// 小程序 access_token 实例内缓存。此前每发一条消息就打一次 cgi-bin/token，
// 定时器每 5 分钟一轮 × 逐条获取，一天即打光该接口每日配额（45009），
// 且新 token 会顶掉其它云函数（如 membership）缓存的旧 token。
let _mpTokenCache = { token: '', expireAt: 0 }

async function getAccessToken(forceRefresh) {
  const now = Date.now()
  if (!forceRefresh && _mpTokenCache.token && now < _mpTokenCache.expireAt) {
    return _mpTokenCache.token
  }
  const { appid, secret } = getMiniProgramCredentials()

  // 官方推荐 stable_token：额度独立于 cgi-bin/token 每日上限，
  // 且非 force_refresh 时返回同一个稳定 token，不影响其它调用方
  try {
    const res = await axios.post('https://api.weixin.qq.com/cgi-bin/stable_token', {
      grant_type: 'client_credential',
      appid: appid,
      secret: secret,
      force_refresh: !!forceRefresh
    })
    if (res.data && res.data.access_token) {
      const ttlSec = Math.max(60, (Number(res.data.expires_in) || 7200) - 300)
      _mpTokenCache = { token: res.data.access_token, expireAt: now + ttlSec * 1000 }
      return res.data.access_token
    }
    console.warn('stable_token 响应异常，回落 cgi-bin/token:', JSON.stringify(res.data))
  } catch (e) {
    console.warn('stable_token 请求失败，回落 cgi-bin/token:', e.message || e)
  }

  const url =
    'https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=' +
    encodeURIComponent(appid) +
    '&secret=' +
    encodeURIComponent(secret)
  const res = await axios.get(url)
  if (res.data && res.data.access_token) {
    const ttlSec = Math.max(60, (Number(res.data.expires_in) || 7200) - 300)
    _mpTokenCache = { token: res.data.access_token, expireAt: now + ttlSec * 1000 }
    return res.data.access_token
  }
  throw new Error('获取access_token失败: ' + JSON.stringify(res.data))
}

function getSubscribeSendOptions() {
  const rawState = String(process.env.MINIPROGRAM_STATE || 'formal').trim().toLowerCase()
  const miniprogramState = ['developer', 'trial', 'formal'].includes(rawState) ? rawState : 'formal'
  const rawLang = String(process.env.SUBSCRIBE_MSG_LANG || 'zh_CN').trim()
  const allowedLang = new Set(['zh_CN', 'en_US', 'zh_HK', 'zh_TW'])
  const lang = allowedLang.has(rawLang) ? rawLang : 'zh_CN'
  return { miniprogramState, lang }
}

async function sendSubscribeMessageByHttp(openid, templateId, page, data) {
  const { miniprogramState, lang } = getSubscribeSendOptions()
  const payload = {
    touser: openid,
    template_id: templateId,
    page: page,
    miniprogram_state: miniprogramState,
    lang: lang,
    data: data
  }

  async function postOnce(token) {
    const url =
      'https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=' +
      encodeURIComponent(token)
    const res = await axios.post(url, payload)
    return res.data || {}
  }

  let result = await postOnce(await getAccessToken())
  // 缓存 token 失效/被顶掉（40001 invalid credential / 42001 expired）→ 强刷后重试一次
  if (result.errcode === 40001 || result.errcode === 42001) {
    result = await postOnce(await getAccessToken(true))
  }
  if (result.errcode !== 0) {
    throw new Error('发送订阅消息失败: errcode=' + result.errcode + ', errmsg=' + result.errmsg)
  }
  return result
}

/** 与 ll2Query fetchLaunchDetail 写入的缓存 docId 一致（注意版本号需与 ll2Query 同步升级） */
function launchDetailDocId(launchId) {
  return (
    'api_cache_/launches/' +
    String(launchId) +
    '/_' +
    JSON.stringify({ format: 'json', mode: 'detailed' }) +
    '_full_v7'
  )
}

function pickLaunchIsoFromDetail(detail) {
  if (!detail || typeof detail !== 'object') return ''
  return detail.net || detail.window_start || detail.window_end || ''
}

function missionNameFromDetail(detail) {
  if (!detail || typeof detail !== 'object') return ''
  var mn = detail.mission && detail.mission.name
  return String(mn || detail.name || '').substring(0, 20)
}

function rocketNameFromDetail(detail) {
  if (!detail || typeof detail !== 'object') return ''
  var cfg = detail.rocket && detail.rocket.configuration
  var name = cfg && (cfg.full_name || cfg.name)
  return String(name || '').substring(0, 20)
}

/**
 * 未写入 notifyLeadMinutes 的旧记录：手动订阅默认 30；偏好自动匹配应为 60
 */
function getLeadMinutesForRecord(record) {
  var raw = record && record.notifyLeadMinutes
  var n = Number(raw)
  if (n >= 1 && n <= 24 * 60) return Math.floor(n)
  if (record && record.source === 'preference_match') return 60
  return 30
}

async function fetchLaunchDetailForReconcile(launchId) {
  if (!launchId) return null
  var sid = String(launchId)
  var docId = launchDetailDocId(sid)
  try {
    // ll2Query 写入结构：{ cacheKey, data: { data: <launch>, expireAt }, updatedAt, updatedAtMs }
    var doc = await db.collection(SPACE_DEVS_CACHE).doc(docId).get()
    var wrap = doc && doc.data && doc.data.data
    var nowMs = Date.now()
    if (wrap && wrap.data && wrap.data.id && wrap.expireAt && wrap.expireAt > nowMs) {
      return wrap.data
    }
  } catch (e) { /* 未命中或未过期字段缺失则走云函数拉取 */ }

  try {
    var r = await cloud.callFunction({
      name: 'll2Query',
      data: { action: 'fetchLaunchDetail', launchId: sid }
    })
    var res = r && r.result
    if (res && res.success && res.data && res.data.id) return res.data
  } catch (e2) {
    console.error('[Reconcile] fetchLaunchDetail fail', sid, e2.message || e2)
  }
  return null
}

/**
 * 发送前刷新未发送订阅的 notifyAt（改期后与 LL2 / 缓存一致）
 */
async function reconcilePendingSubscriptionsNotifyTimes() {
  var stats = { scanned: 0, updated: 0, skipped: 0, errors: 0 }
  try {
    var q = await db
      .collection(SUBSCRIBE_COLLECTION)
      .where({ sent: false })
      .limit(100)
      .get()
    var records = q.data || []
    stats.scanned = records.length
    if (records.length === 0) return stats

    var detailByMission = {}

    async function getDetail(mid) {
      var k = String(mid)
      if (Object.prototype.hasOwnProperty.call(detailByMission, k)) {
        return detailByMission[k]
      }
      var d = await fetchLaunchDetailForReconcile(k)
      detailByMission[k] = d
      return d
    }

    for (var i = 0; i < records.length; i++) {
      var record = records[i]
      try {
        var mid = record.missionId
        if (!mid) {
          stats.skipped++
          continue
        }

        var detail = await getDetail(mid)
        if (!detail) {
          stats.skipped++
          continue
        }

        var iso = pickLaunchIsoFromDetail(detail)
        if (!iso) {
          stats.skipped++
          continue
        }

        var launchMs = new Date(iso).getTime()
        if (!(launchMs > 0)) {
          stats.skipped++
          continue
        }

        var lead = getLeadMinutesForRecord(record)
        var notifyAt = launchMs - lead * 60 * 1000
        var formatted = formatLaunchTimeStr(iso)
        var mName =
          missionNameFromDetail(detail) || record.missionName || '未知任务'
        var rName =
          rocketNameFromDetail(detail) || record.rocketName || '未知火箭'

        if (record.notifyAt === notifyAt && record.launchTime === iso) {
          stats.skipped++
          continue
        }

        await db.collection(SUBSCRIBE_COLLECTION).doc(record._id).update({
          data: {
            launchTime: iso,
            launchTimeFormatted: formatted,
            notifyAt: notifyAt,
            missionName: mName.substring(0, 20),
            rocketName: rName.substring(0, 20),
            updatedAt: Date.now()
          }
        })
        stats.updated++
      } catch (inner) {
        stats.errors++
        console.error('[Reconcile] record', record && record._id, inner.message || inner)
      }
    }
  } catch (e) {
    stats.errors++
    console.error('[Reconcile] query fail', e.message || e)
  }
  return stats
}

// ── 偏好匹配：扫描用户偏好，为匹配的即将发射任务自动创建订阅 ──
const PROFILE_COLLECTION = 'user_profile'
const PREFS_MATCH_WINDOW_MS = 24 * 60 * 60 * 1000

function prefMatchesHaystack(selected, haystack, aliasTable) {
  var hay = String(haystack || '').toLowerCase()
  if (!hay) return false
  for (var i = 0; i < selected.length; i++) {
    var name = String(selected[i] || '')
    if (!name) continue
    var candidates = [name]
    var aliases = aliasTable[name]
    if (aliases && aliases.length) candidates = candidates.concat(aliases)
    for (var j = 0; j < candidates.length; j++) {
      var c = String(candidates[j] || '').toLowerCase()
      if (c && hay.indexOf(c) >= 0) return true
    }
  }
  return false
}

async function matchPreferencesAndCreateSubscriptions() {
  try {
    const now = Date.now()
    const windowEnd = now + PREFS_MATCH_WINDOW_MS

    // 先查未来24小时内的发射任务：多数 tick 没有临近任务，此时直接返回，
    // 不再扫描用户偏好（省掉每 5 分钟一次的 user_profile 读）
    var launchesRes
    try {
      launchesRes = await db.collection(LAUNCH_DATA_COLLECTION)
        .where({
          windowStart: _.gte(new Date(now)).and(_.lte(new Date(windowEnd)))
        })
        .limit(20)
        .get()
    } catch (e) {
      return
    }

    const launches = launchesRes.data || []
    if (launches.length === 0) return

    // 查询有偏好设置的用户（最多50个）
    const usersRes = await db.collection(PROFILE_COLLECTION)
      .where({ 'preferences.rocketTypes': _.exists(true) })
      .field({ _id: true, openid: true, preferences: true })
      .limit(50)
      .get()

    const users = (usersRes.data || []).filter(function (u) {
      var p = u.preferences
      return p && ((p.rocketTypes && p.rocketTypes.length > 0) || (p.launchSites && p.launchSites.length > 0))
    })

    if (users.length === 0) return

    // 一次批量查询代替「用户×任务」逐对查询（旧实现最坏 50×20=1000 次读/tick）：
    // 拉出这些任务的已有订阅，内存里按 openid_missionId 去重
    const missionIds = launches.map(function (l) { return String(l._id || l.id) })
    const existingPairs = new Set()
    try {
      const existingRes = await db.collection(SUBSCRIBE_COLLECTION)
        .where({ missionId: _.in(missionIds) })
        .field({ _openid: true, missionId: true })
        .limit(1000)
        .get()
      for (const row of existingRes.data || []) {
        existingPairs.add(String(row._openid) + '_' + String(row.missionId))
      }
    } catch (e) {
      // 批量查询失败则不做预去重，依赖确定性 _id 的写入护栏兜底
    }

    // 为每个匹配的用户+任务创建订阅记录
    for (const user of users) {
      var prefs = user.preferences
      var notifyMinutes = prefs.notifyMinutes || 60

      for (const launch of launches) {
        var rocketMatch = !prefs.rocketTypes || prefs.rocketTypes.length === 0 ||
          prefMatchesHaystack(prefs.rocketTypes, launch.rocketName || '', ROCKET_NAME_ALIASES)
        var siteMatch = !prefs.launchSites || prefs.launchSites.length === 0 ||
          prefMatchesHaystack(prefs.launchSites, (launch.padName || launch.pad || '') + ' ' + (launch.site || ''), LAUNCH_SITE_ALIASES)

        if (!rocketMatch && !siteMatch) continue

        var launchTime = launch.windowStart || launch.launchTime || ''
        var notifyAt = new Date(launchTime).getTime() - notifyMinutes * 60 * 1000
        if (notifyAt <= now) continue

        var userOpenid = user.openid || user._id
        var missionId = String(launch._id || launch.id)
        if (existingPairs.has(String(userOpenid) + '_' + missionId)) continue

        var dedupKey = (userOpenid + '_' + missionId).replace(/[^a-zA-Z0-9_-]/g, '_')

        // 创建订阅记录（确定性 _id 作为并发护栏，避免重复创建）
        try {
          await db.collection(SUBSCRIBE_COLLECTION).add({
            data: {
              _id: dedupKey,
              _openid: userOpenid,
              missionId: missionId,
              missionName: (launch.missionName || launch.name || '').substring(0, 20),
              rocketName: (launch.rocketName || '').substring(0, 20),
              launchTime: launchTime,
              launchTimeFormatted: formatLaunchTimeStr(launchTime),
              recoveryMethod: launch.recoveryMethod || launch.recovery || '待确认',
              notifyAt: notifyAt,
              notifyLeadMinutes: notifyMinutes,
              templateId: TEMPLATE_ID,
              sent: false,
              source: 'preference_match',
              createdAt: now
            }
          })
          existingPairs.add(String(userOpenid) + '_' + missionId)
        } catch (e) {}
      }
    }
  } catch (e) {
    console.error('[PrefsMatch] error:', e.message || e)
  }
}

/** ISO 时间格式化为北京时间（UTC+8），输出 yyyy年MM月dd日 HH:mm */
function formatLaunchTimeStr(isoTime) {
  if (!isoTime) return '时间未知'
  try {
    var d = new Date(isoTime)
    if (!(d.getTime() > 0)) return '时间未知'
    var utcMs = d.getTime() + d.getTimezoneOffset() * 60 * 1000
    var bj = new Date(utcMs + 8 * 60 * 60 * 1000)
    var y = bj.getUTCFullYear()
    var m = String(bj.getUTCMonth() + 1).padStart(2, '0')
    var day = String(bj.getUTCDate()).padStart(2, '0')
    var h = String(bj.getUTCHours()).padStart(2, '0')
    var min = String(bj.getUTCMinutes()).padStart(2, '0')
    return y + '年' + m + '月' + day + '日 ' + h + ':' + min
  } catch (e) {
    return '时间未知'
  }
}

let _sendLaunchReminderCollectionsEnsured = false
async function ensureSendLaunchReminderCollectionsOnce() {
  if (_sendLaunchReminderCollectionsEnsured) return
  _sendLaunchReminderCollectionsEnsured = true
  const names = ['user_profile', 'launch_data', 'launch_subscriptions', 'push_history', 'oa_auto_alert_users', 'oa_push_ledger', 'oa_subscribe_quota']
  for (const n of names) {
    try {
      await db.createCollection(n)
    } catch (e) {}
  }
}

exports.main = async (event) => {
  await ensureSendLaunchReminderCollectionsOnce()
  const action = event.action || 'sendPending'

  // 生产自动链路（定时器 launchReminderTrigger 每 5 分钟，config: 0 */5 * * * * *）：
  // 1) syncLaunchDataFromCache ← space_devs_cache upcoming
  // 2) reconcilePendingSubscriptionsNotifyTimes ← A 通道改期对齐
  // 3) sendPendingReminders ← launch_subscriptions 小程序发射前提醒
  // 3b) sendPendingResultNotifications ← 终态后「任务完成提醒」
  // 4) sendOATemplateAlerts ← launch_data 扫 T-30min 窗 + oa_auto_alert_users
  // 5) sendOASubscribeAlerts ← 服务号订阅通知
  // 6) matchPreferencesAndCreateSubscriptions ← 偏好自动建订阅
  if (action === 'sendPending') {
    let launchDataSync
    try {
      launchDataSync = await syncLaunchDataFromCache()
      if (!launchDataSync.total) {
        try {
          await cloud.callFunction({
            name: 'syncSpaceDevsData',
            data: { action: 'syncLaunches' }
          })
          launchDataSync = await syncLaunchDataFromCache()
        } catch (bootstrapErr) {
          launchDataSync.bootstrapError = bootstrapErr.message || String(bootstrapErr)
        }
      }
    } catch (syncErr) {
      launchDataSync = { success: false, error: syncErr.message || String(syncErr) }
    }
    let reconcileStats
    try {
      reconcileStats = await reconcilePendingSubscriptionsNotifyTimes()
    } catch (reErr) {
      reconcileStats = { error: reErr.message || String(reErr) }
    }
    const result = await sendPendingReminders()
    let resultNotify = { skipped: true }
    try {
      resultNotify = await sendPendingResultNotifications()
    } catch (rnErr) {
      resultNotify = { success: false, error: rnErr.message || String(rnErr) }
    }
    let oaResult = { skipped: true }
    try {
      oaResult = await sendOATemplateAlerts()
    } catch (oaErr) {
      oaResult = { success: false, error: oaErr.message || String(oaErr) }
    }
    let oaSubscribeResult = { skipped: true }
    try {
      oaSubscribeResult = await sendOASubscribeAlerts()
    } catch (subErr) {
      oaSubscribeResult = { success: false, error: subErr.message || String(subErr) }
    }
    await matchPreferencesAndCreateSubscriptions()
    return { ...result, resultNotify, oaResult, oaSubscribeResult, reconcileStats, launchDataSync }
  }

  if (action === 'envCheck') {
    let wxAppIdKeyCount = 0
    for (const key of Object.keys(process.env)) {
      if (/^wx[0-9a-f]{16}$/i.test(key)) wxAppIdKeyCount++
    }
    const flags = {
      APPID: !!String(process.env.APPID || '').trim(),
      SECRET: !!String(process.env.SECRET || '').trim(),
      WX_APPID: !!String(process.env.WX_APPID || '').trim(),
      WX_SECRET: !!String(process.env.WX_SECRET || '').trim(),
      MP_CREDENTIALS: !!String(process.env.MP_CREDENTIALS || '').trim(),
      WX_MINI_CREDENTIALS: !!String(process.env.WX_MINI_CREDENTIALS || '').trim(),
      wxAppIdKeyCount: wxAppIdKeyCount,
      pushHistoryDetailEnabled: isPushHistoryDetailEnabled(),
      WECHAT_OA_APPID: !!String(process.env.WECHAT_OA_APPID || '').trim(),
      WECHAT_OA_SECRET: !!String(process.env.WECHAT_OA_SECRET || '').trim(),
      WECHAT_OA_TEMPLATE_ID: !!String(process.env.WECHAT_OA_TEMPLATE_ID || '').trim(),
      RESULT_TEMPLATE_ID: !!RESULT_TEMPLATE_ID,
      RESULT_TMPL_FIELDS: RESULT_TEMPLATE_FIELDS,
      WECHAT_OA_TMPL_FIELD_MISSION: !!String(process.env.WECHAT_OA_TMPL_FIELD_MISSION || '').trim(),
      WECHAT_OA_TMPL_FIELD_TIME: !!String(process.env.WECHAT_OA_TMPL_FIELD_TIME || '').trim(),
      WECHAT_OA_TMPL_FIELD_ROCKET: !!String(process.env.WECHAT_OA_TMPL_FIELD_ROCKET || '').trim(),
      WECHAT_OA_TMPL_FIELD_RECOVERY: !!String(process.env.WECHAT_OA_TMPL_FIELD_RECOVERY || '').trim(),
      WECHAT_OA_TMPL_FIELD_REMARK: !!String(process.env.WECHAT_OA_TMPL_FIELD_REMARK || '').trim(),
      WECHAT_OA_TMPL_FIELD_CODE: !!String(process.env.WECHAT_OA_TMPL_FIELD_CODE || '').trim(),
      WECHAT_OA_SUBSCRIBE_TEMPLATE_ID: !!String(process.env.WECHAT_OA_SUBSCRIBE_TEMPLATE_ID || '').trim()
    }

    // C 通道（订阅通知 bizsend）自检：模板字段映射 + 当前可发额度用户数
    let oaSubscribe = {
      templateId: OA_SUBSCRIBE_TEMPLATE_ID,
      templateIdSource: String(process.env.WECHAT_OA_SUBSCRIBE_TEMPLATE_ID || '').trim() ? 'env' : 'default',
      fields: OA_SUBSCRIBE_FIELDS,
      oaCredentialsOk: !!getOaCredentials(),
      usersWithQuota: null,
      totalRemaining: null
    }
    try {
      const quotaRes = await db
        .collection(OA_SUBSCRIBE_QUOTA_COLLECTION)
        .where({ remaining: _.gt(0) })
        .limit(200)
        .get()
      const rows = quotaRes.data || []
      oaSubscribe.usersWithQuota = rows.length
      oaSubscribe.totalRemaining = rows.reduce(function (s, r) {
        return s + (Number(r.remaining) || 0)
      }, 0)
    } catch (e) {
      oaSubscribe.quotaQueryError = e.message || String(e)
    }

    // 「服务号自动提醒只通知一次」排查：launch_data 未来窗口命中情况 + oa_push_ledger 失败记录
    const now = Date.now()
    const diagnostics = {
      now: new Date(now).toISOString(),
      oaLeadMinutes: OA_LEAD_MINUTES,
      launchData: {},
      oaPushLedger: {}
    }

    try {
      const launchMin = new Date(now)
      const launchMax = new Date(now + OA_LEAD_MINUTES * 60 * 1000)
      const futureRes = await db
        .collection(LAUNCH_DATA_COLLECTION)
        .where({ windowStart: _.gte(launchMin) })
        .orderBy('windowStart', 'asc')
        .limit(50)
        .get()
      const futureRows = futureRes.data || []
      diagnostics.launchData.futureCount = futureRows.length

      const inWindowRes = await db
        .collection(LAUNCH_DATA_COLLECTION)
        .where({ windowStart: _.gte(launchMin).and(_.lte(launchMax)) })
        .limit(50)
        .get()
      diagnostics.launchData.inWindowCount = (inWindowRes.data || []).length

      var sampleRow = null
      for (var si = 0; si < futureRows.length; si++) {
        if (futureRows[si] && futureRows[si].windowStart != null) {
          sampleRow = futureRows[si]
          break
        }
      }
      if (sampleRow) {
        var ws = sampleRow.windowStart
        diagnostics.launchData.sampleWindowStartType = {
          typeofValue: typeof ws,
          objectToString: Object.prototype.toString.call(ws),
          rawValue: ws
        }
        diagnostics.launchData.sample = {
          _id: sampleRow._id,
          missionName: sampleRow.missionName || sampleRow.name || '',
          windowStart: ws,
          rocketName: sampleRow.rocketName || ''
        }
      } else {
        diagnostics.launchData.sampleWindowStartType = null
        diagnostics.launchData.sample = null
      }
    } catch (e) {
      diagnostics.launchData.launchDataError = e.message || String(e)
    }

    // 不带 windowStart 过滤再查一次：即便 gte 查询为空，也能区分「集合无数据」与
    // 「windowStart 类型/时区错误导致 gte 全失配」。anyCount 取总量，anySample 取任意一条样本。
    try {
      const anyCountRes = await db
        .collection(LAUNCH_DATA_COLLECTION)
        .count()
        .catch(function () { return { total: null } })
      diagnostics.launchData.anyCount = anyCountRes && typeof anyCountRes.total === 'number'
        ? anyCountRes.total
        : null

      const anyRes = await db.collection(LAUNCH_DATA_COLLECTION).limit(1).get()
      const anyRows = anyRes.data || []
      diagnostics.launchData.isEmpty = anyRows.length === 0
      if (anyRows.length > 0) {
        var anyRow = anyRows[0]
        var aws = anyRow.windowStart
        diagnostics.launchData.anySample = {
          _id: anyRow._id,
          missionName: anyRow.missionName || anyRow.name || '',
          rocketName: anyRow.rocketName || '',
          launchTime: anyRow.launchTime || '',
          windowStartTypeof: typeof aws,
          windowStartObjectToString: Object.prototype.toString.call(aws),
          windowStartRaw: aws,
          windowStartIso: (aws instanceof Date && aws.getTime() > 0) ? aws.toISOString() : null
        }
      } else {
        diagnostics.launchData.anySample = null
      }
    } catch (e) {
      diagnostics.launchData.anyQueryError = e.message || String(e)
    }

    try {
      const failRes = await db
        .collection(OA_PUSH_LEDGER)
        .where({ status: 'failed' })
        .orderBy('sentAt', 'desc')
        .limit(5)
        .get()
      const failRows = failRes.data || []
      diagnostics.oaPushLedger.recentFailures = failRows.map(function (r) {
        return {
          missionId: r.missionId || '',
          missionName: r.missionName || '',
          channel: r.channel,
          error: String(r.error || '').slice(0, 200),
          sentAt: r.sentAt
        }
      })
      diagnostics.oaPushLedger.failedCount = failRows.length

      const okRes = await db
        .collection(OA_PUSH_LEDGER)
        .where({ status: 'ok' })
        .limit(50)
        .get()
      diagnostics.oaPushLedger.okCount = (okRes.data || []).length
    } catch (e) {
      diagnostics.oaPushLedger.ledgerError = e.message || String(e)
    }

    try {
      const { appid, source } = getMiniProgramCredentials()
      return {
        success: true,
        credentialsOk: true,
        source,
        appidPrefix: appid.slice(0, 5),
        appidLength: appid.length,
        flags,
        oaSubscribe,
        diagnostics
      }
    } catch (e) {
      return {
        success: true,
        credentialsOk: false,
        message: e.message || String(e),
        flags,
        oaSubscribe,
        diagnostics
      }
    }
  }

  if (action === 'getOpenid') {
    const wxContext = cloud.getWXContext()
    return { openid: wxContext.OPENID || '' }
  }

  if (action === 'sendResultOnly') {
    try {
      const resultNotify = await sendPendingResultNotifications()
      return { success: true, resultNotify }
    } catch (e) {
      return { success: false, error: e.message || String(e) }
    }
  }

  // 「任务完成提醒」断点定位：一次调用查全 模板配置 / 订阅文档状态 / 终态缓存
  if (action === 'resultDiag') {
    return runResultDiag()
  }

  return { success: false, message: 'unknown action' }
}

/**
 * 排查「任务完成提醒」未推送：
 * - template: RESULT_TEMPLATE_ID 与字段 key（需与公众平台模板关键词逐一对上，否则 47003）
 * - subscriptions: 各状态文档数与样本（resultQuota=0 → 用户弹窗没勾结果模板；
 *   reminderSent=false → 卡在发射前提醒环节；failReason → 上一次发送失败原因）
 * - recentSettled: _recent_settled 终态缓存是否有数据、是否新鲜
 */
async function runResultDiag() {
  const out = {
    success: true,
    now: new Date().toISOString(),
    template: {
      resultTemplateId: RESULT_TEMPLATE_ID,
      resultTemplateFields: RESULT_TEMPLATE_FIELDS,
      miniprogramState: getSubscribeSendOptions().miniprogramState
    },
    subscriptions: {},
    recentSettled: {}
  }

  function slim(row) {
    return {
      _id: row._id,
      missionId: row.missionId || '',
      missionName: row.missionName || '',
      launchTime: row.launchTime || '',
      notifyAt: row.notifyAt || 0,
      sent: !!row.sent,
      reminderSent: !!row.reminderSent,
      resultQuota: Number(row.resultQuota) || 0,
      resultSent: !!row.resultSent,
      failReason: row.failReason ? String(row.failReason).slice(0, 200) : ''
    }
  }

  try {
    const pendingRes = await db
      .collection(SUBSCRIBE_COLLECTION)
      .where({ resultSent: false, resultQuota: _.gt(0), reminderSent: true })
      .limit(20)
      .get()
    out.subscriptions.pendingResult = (pendingRes.data || []).map(slim)
  } catch (e) {
    out.subscriptions.pendingResultError = e.message || String(e)
  }

  try {
    const stuckRes = await db
      .collection(SUBSCRIBE_COLLECTION)
      .where({ resultSent: false, resultQuota: _.gt(0), reminderSent: false })
      .limit(20)
      .get()
    out.subscriptions.quotaButReminderNotSent = (stuckRes.data || []).map(slim)
  } catch (e) {
    out.subscriptions.quotaButReminderNotSentError = e.message || String(e)
  }

  try {
    const noQuotaRes = await db
      .collection(SUBSCRIBE_COLLECTION)
      .where({ resultQuota: 0 })
      .limit(20)
      .get()
    out.subscriptions.noResultQuota = (noQuotaRes.data || []).map(slim)
  } catch (e) {
    out.subscriptions.noResultQuotaError = e.message || String(e)
  }

  try {
    const totalRes = await db.collection(SUBSCRIBE_COLLECTION).count()
    out.subscriptions.totalDocs = totalRes && typeof totalRes.total === 'number' ? totalRes.total : null
  } catch (e) {}

  try {
    const settledDoc = await db.collection('launch_timeline_cache').doc('_recent_settled').get()
    const wrapper = settledDoc && settledDoc.data
    const list = wrapper && Array.isArray(wrapper.data) ? wrapper.data : []
    out.recentSettled = {
      exists: true,
      updatedAt: wrapper && wrapper.updatedAtMs ? new Date(wrapper.updatedAtMs).toISOString() : null,
      count: list.length,
      entries: list.slice(0, 15).map(function (r) {
        return {
          id: r.id,
          name: r.name || '',
          statusId: r.status && r.status.id,
          statusName: (r.status && r.status.name) || '',
          net: r.net || '',
          source: r.source || ''
        }
      })
    }
  } catch (e) {
    out.recentSettled = { exists: false, error: e.message || String(e) }
  }

  try {
    getMiniProgramCredentials()
    out.credentialsOk = true
  } catch (e) {
    out.credentialsOk = false
    out.credentialsError = e.message || String(e)
  }

  // 线上模板真实字段与自动解析出的角色映射（47003 排查关键）
  try {
    const entries = await fetchResultTemplateMapping()
    out.template.remoteTitle = entries._templateTitle || ''
    out.template.resolvedMapping = entries.map(function (e) {
      return { key: e.key, role: e.role, label: e.label || '' }
    })
    out.template.mappingSource = hasExplicitResultFieldEnv() ? 'env（发送时以环境变量为准）' : 'auto'
  } catch (e) {
    out.template.resolvedMappingError = e.message || String(e)
  }

  return out
}

async function sendPendingReminders() {
  const now = Date.now()
  const sentCount = { sentOk: 0, failed: 0, skipped: 0 }
  const startedAt = now
  const failureSamples = []

  try {
    const res = await db
      .collection(SUBSCRIBE_COLLECTION)
      .where({
        sent: false,
        notifyAt: _.lte(now)
      })
      .orderBy('notifyAt', 'asc')
      .limit(100)
      .get()

    const records = res.data || []
    if (records.length === 0) {
      return { success: true, message: 'no pending reminders', ...sentCount }
    }

    // 按 openid+missionId 去重，同一用户同一任务只发第一条
    const sentKeys = new Set()

    for (const record of records) {
      try {
        if (!record._openid) {
          sentCount.skipped++
          await markReminderDone(record._id, { keepForResult: false })
          continue
        }

        const dedupKey = record._openid + '_' + (record.missionId || '')
        if (sentKeys.has(dedupKey)) {
          // 重复记录，直接处理掉不发
          sentCount.skipped++
          await markReminderDone(record._id, { keepForResult: false })
          continue
        }
        sentKeys.add(dedupKey)

        // 旧记录可能误把订阅来源「自动匹配」写进了回收方式字段，发送前纠正
        var recoveryValue = record.recoveryMethod || '一次性'
        if (recoveryValue === '自动匹配') recoveryValue = '待确认'

        await sendSubscribeMessageByHttp(
          record._openid,
          TEMPLATE_ID,
          '/pages/index/index',
          {
            thing1: { value: (record.missionName || '未知任务').substring(0, 20) },
            time2: { value: record.launchTimeFormatted || '时间未知' },
            thing3: { value: (record.rocketName || '未知火箭').substring(0, 20) },
            thing4: { value: recoveryValue.substring(0, 20) }
          }
        )

        sentCount.sentOk++
        // 有结果额度则保留文档，供终态「任务完成提醒」发送
        await markReminderDone(record._id, { keepForResult: Number(record.resultQuota) > 0 })
      } catch (sendError) {
        const errDetail = sendError.message || sendError.stack || String(sendError)
        console.error('send fail:', record._id, record._openid, errDetail)
        sentCount.failed++
        if (failureSamples.length < 20) {
          failureSamples.push({
            openid: record._openid || '',
            missionId: record.missionId || '',
            missionName: record.missionName || '',
            error: String(errDetail).slice(0, 300)
          })
        }
        if (isPushHistoryDetailEnabled()) {
          try {
            await writePushHistoryDetail({
              openid: record._openid || '',
              launchId: record.missionId || '',
              missionName: record.missionName || '',
              error: errDetail
            })
          } catch (_) {}
        }
        const errStr = String(errDetail)
        if (/43101|user refuse|user deny|43107/i.test(errStr)) {
          await markReminderDone(record._id, { keepForResult: Number(record.resultQuota) > 0 })
        } else {
          try {
            await db.collection(SUBSCRIBE_COLLECTION).doc(record._id).update({
              data: { failReason: errDetail, failedAt: Date.now() }
            })
          } catch (updateErr) {
            await markReminderDone(record._id, { keepForResult: Number(record.resultQuota) > 0 })
          }
        }
      }
    }

    await writePushHistoryBatch({
      total: records.length,
      sentCount,
      startedAt,
      failureSamples,
      message: 'done'
    })

    return { success: true, message: 'done', total: records.length, ...sentCount }
  } catch (error) {
    console.error('query fail:', error.message || error.stack || String(error))
    await writePushHistoryBatch({
      total: 0,
      sentCount,
      startedAt,
      failureSamples,
      message: error.message || 'query failed',
      success: false
    })
    return { success: false, message: error.message || 'query failed', ...sentCount }
  }
}

/** 发射前提醒已处理：有结果额度则保留文档，否则删除 */
async function markReminderDone(docId, options) {
  const keepForResult = !!(options && options.keepForResult)
  try {
    if (keepForResult) {
      await db.collection(SUBSCRIBE_COLLECTION).doc(docId).update({
        data: {
          sent: true,
          reminderSent: true,
          reminderSentAt: Date.now(),
          updatedAt: Date.now()
        }
      })
    } else {
      await removeRecord(docId)
    }
  } catch (e) {
    try { await removeRecord(docId) } catch (e2) {}
  }
}

/** LL2 status.id → 结果文案（与前端角标一致） */
const TERMINAL_RESULT_TEXT = {
  3: '已成功',
  4: '失败',
  7: '部分失败',
  9: '载荷已部署'
}

function isTerminalStatusId(id) {
  const n = id != null ? Number(id) : 0
  return !!TERMINAL_RESULT_TEXT[n]
}

function resultTextFromStatus(status) {
  if (!status) return ''
  const id = status.id != null ? Number(status.id) : 0
  if (TERMINAL_RESULT_TEXT[id]) return TERMINAL_RESULT_TEXT[id]
  const n = String(status.name || '').toLowerCase()
  if (/success|成功/.test(n)) return '已成功'
  if (/partial/.test(n)) return '部分失败'
  if (/fail|失败/.test(n)) return '失败'
  if (/deploy/.test(n)) return '载荷已部署'
  return ''
}

// ── 结果模板字段自动对齐 ──
// 线上模板的关键词 key（如 time1/thing2）与代码默认值不匹配会报 47003。
// 通过 wxaapi/newtmpl/gettemplate 拉取模板真实 content（{{key.DATA}}），
// 按行首关键词中文名映射到 mission/time/result/remark 四个角色，实例内缓存 1 小时。
// 显式设置了 RESULT_TMPL_FIELD_* 环境变量时跳过自动探测。

let _resultTmplMappingCache = { entries: null, fetchedAt: 0 }
const RESULT_TMPL_MAPPING_TTL = 60 * 60 * 1000

function hasExplicitResultFieldEnv() {
  return !!(
    String(process.env.RESULT_TMPL_FIELD_MISSION || '').trim() ||
    String(process.env.RESULT_TMPL_FIELD_TIME || '').trim() ||
    String(process.env.RESULT_TMPL_FIELD_RESULT || '').trim() ||
    String(process.env.RESULT_TMPL_FIELD_REMARK || '').trim()
  )
}

function defaultResultFieldEntries() {
  return [
    { key: RESULT_TEMPLATE_FIELDS.mission, role: 'mission' },
    { key: RESULT_TEMPLATE_FIELDS.time, role: 'time' },
    { key: RESULT_TEMPLATE_FIELDS.result, role: 'result' },
    { key: RESULT_TEMPLATE_FIELDS.remark, role: 'remark' }
  ]
}

/** 解析模板 content：每行形如「任务名称:{{thing2.DATA}}」，按中文标签分配角色 */
function parseResultTemplateContent(content) {
  const lines = String(content || '').split('\n')
  const parsed = []
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(.*?)[:：]?\s*\{\{(\w+)\.DATA\}\}/)
    if (m) parsed.push({ label: m[1].trim(), key: m[2] })
  }
  if (!parsed.length) return null

  const entries = []
  const usedRoles = new Set()
  // 「任务开始时间」含「任务」二字，须先匹配时间/结果/备注，最后才轮到名称
  for (const p of parsed) {
    let role = ''
    if (/时间|日期/.test(p.label) || /^time/.test(p.key)) role = 'time'
    else if (/结果|状态/.test(p.label)) role = 'result'
    else if (/备注|说明|提示|温馨/.test(p.label)) role = 'remark'
    else if (/名称|任务|主题|标题/.test(p.label)) role = 'mission'
    if (role && !usedRoles.has(role)) {
      usedRoles.add(role)
      entries.push({ key: p.key, role: role, label: p.label })
    } else {
      entries.push({ key: p.key, role: '', label: p.label })
    }
  }
  // 未识别的行按顺序补齐剩余角色，保证模板每个 key 都有值（缺 key 也是 47003）
  const leftoverRoles = ['mission', 'time', 'result', 'remark'].filter(function (r) {
    return !usedRoles.has(r)
  })
  for (const e of entries) {
    if (!e.role) e.role = leftoverRoles.shift() || 'remark'
  }
  return entries
}

async function fetchResultTemplateMapping() {
  const now = Date.now()
  if (_resultTmplMappingCache.entries && now - _resultTmplMappingCache.fetchedAt < RESULT_TMPL_MAPPING_TTL) {
    return _resultTmplMappingCache.entries
  }
  const token = await getAccessToken()
  const res = await axios.get(
    'https://api.weixin.qq.com/wxaapi/newtmpl/gettemplate?access_token=' + encodeURIComponent(token)
  )
  const list = (res.data && res.data.data) || []
  let tmpl = null
  for (const t of list) {
    if (t && t.priTmplId === RESULT_TEMPLATE_ID) {
      tmpl = t
      break
    }
  }
  if (!tmpl) throw new Error('gettemplate 未找到结果模板 ' + RESULT_TEMPLATE_ID)
  const entries = parseResultTemplateContent(tmpl.content)
  if (!entries) throw new Error('结果模板 content 解析失败: ' + String(tmpl.content).slice(0, 100))
  entries._templateTitle = tmpl.title || ''
  _resultTmplMappingCache = { entries: entries, fetchedAt: now }
  return entries
}

/** 获取最终字段映射：显式环境变量 > 线上模板自动探测 > 代码默认值 */
async function resolveResultFieldEntries() {
  if (hasExplicitResultFieldEnv()) return defaultResultFieldEntries()
  try {
    return await fetchResultTemplateMapping()
  } catch (e) {
    console.warn('[ResultNotify] 模板字段自动探测失败，用默认映射:', e.message || e)
    return defaultResultFieldEntries()
  }
}

/** 按 key 类型裁剪值：thing≤20 / phrase≤5 / character_string≤32(ASCII) / time 原样 */
function clampValueForKey(key, value) {
  const v = String(value == null ? '' : value)
  if (/^time/.test(key)) return v
  if (/^phrase/.test(key)) return v.substring(0, 5)
  if (/^character_string/.test(key)) return v.replace(/[^\x20-\x7e]/g, '').substring(0, 32) || '-'
  if (/^number/.test(key)) return v.replace(/[^\d.-]/g, '').substring(0, 32) || '0'
  return v.substring(0, 20)
}

function buildResultSubscribeData(record, statusInfo, fieldEntries) {
  const rocket = String(record.rocketName || '').substring(0, 12)
  const roleValues = {
    mission: String(record.missionName || '未知任务'),
    time: String(record.launchTimeFormatted || '时间未知'),
    result: String(statusInfo.resultText || '已完成'),
    remark: rocket ? rocket + ' · 点击查看' : '点击查看详情'
  }
  const entries = Array.isArray(fieldEntries) && fieldEntries.length ? fieldEntries : defaultResultFieldEntries()
  const data = {}
  for (const e of entries) {
    if (!e || !e.key) continue
    data[e.key] = { value: clampValueForKey(e.key, roleValues[e.role] || roleValues.remark) }
  }
  return data
}

/**
 * 扫描已发提醒、仍有结果额度的订阅；对照 recent_settled / launch_data 终态后发送「任务完成提醒」。
 */
async function sendPendingResultNotifications() {
  const now = Date.now()
  const stats = { sentOk: 0, failed: 0, skipped: 0, checked: 0 }
  if (!RESULT_TEMPLATE_ID) {
    return { success: true, skipped: true, reason: 'no_result_template', ...stats }
  }

  let records = []
  try {
    const res = await db
      .collection(SUBSCRIBE_COLLECTION)
      .where({
        resultSent: false,
        resultQuota: _.gt(0),
        reminderSent: true
      })
      .limit(80)
      .get()
    records = res.data || []
  } catch (e) {
    try {
      const res2 = await db
        .collection(SUBSCRIBE_COLLECTION)
        .where({
          resultSent: false,
          resultQuota: _.gt(0),
          sent: true
        })
        .limit(80)
        .get()
      records = res2.data || []
    } catch (e2) {
      return { success: false, error: e2.message || String(e2), ...stats }
    }
  }

  if (!records.length) {
    return { success: true, message: 'no pending results', ...stats }
  }

  let settledById = new Map()
  try {
    const settledDoc = await db.collection('launch_timeline_cache').doc('_recent_settled').get()
    const list = settledDoc && settledDoc.data && settledDoc.data.data
    if (Array.isArray(list)) {
      for (let i = 0; i < list.length; i++) {
        const row = list[i]
        if (row && row.id && row.status) settledById.set(String(row.id), row)
      }
    }
  } catch (e) {}

  // 终态兜底：存在「发射时间已过但终态缓存未命中」的记录时，触发一次 ll2Query 实况刷新
  // 再重读 _recent_settled，避免探针空窗导致 48h 后静默删除、一条不发。
  // fetchLaunchStatuses 自带 120s 共享缓存与 30s 失败记忆，不会放大 LL2 调用。
  const needsSettledRefresh = records.some(function (r) {
    const netMs = r.launchTime ? new Date(r.launchTime).getTime() : 0
    return netMs && netMs <= now && !settledById.has(String(r.missionId || ''))
  })
  if (needsSettledRefresh) {
    try {
      await cloud.callFunction({ name: 'll2Query', data: { action: 'fetchLaunchStatuses' } })
      const settledDoc2 = await db.collection('launch_timeline_cache').doc('_recent_settled').get()
      const list2 = settledDoc2 && settledDoc2.data && settledDoc2.data.data
      if (Array.isArray(list2)) {
        for (let i = 0; i < list2.length; i++) {
          const row = list2[i]
          if (row && row.id && row.status) settledById.set(String(row.id), row)
        }
      }
    } catch (e) {
      console.warn('[ResultNotify] settled refresh fail:', e.message || e)
    }
  }

  // 每轮只解析一次线上模板字段映射（带 1h 缓存），供本批全部发送使用
  const resultFieldEntries = await resolveResultFieldEntries()

  const statusCache = new Map()

  async function resolveTerminal(missionId) {
    const id = String(missionId || '')
    if (!id) return null
    if (statusCache.has(id)) return statusCache.get(id)
    const hit = settledById.get(id)
    if (hit && hit.status && isTerminalStatusId(hit.status.id)) {
      const info = {
        resultText: resultTextFromStatus(hit.status),
        status: hit.status,
        net: hit.net || ''
      }
      statusCache.set(id, info)
      return info
    }
    try {
      const ld = await db.collection(LAUNCH_DATA_COLLECTION).doc(id).get()
      const row = ld && ld.data
      if (row && isTerminalStatusId(row.statusId)) {
        const info = {
          resultText: TERMINAL_RESULT_TEXT[Number(row.statusId)] || resultTextFromStatus({ name: row.status }),
          status: { id: row.statusId, name: row.status || '' },
          net: row.launchTime || ''
        }
        statusCache.set(id, info)
        return info
      }
    } catch (e) {}
    statusCache.set(id, null)
    return null
  }

  for (const record of records) {
    stats.checked++
    const mid = record.missionId
    if (!record._openid || !mid) {
      stats.skipped++
      continue
    }
    const terminal = await resolveTerminal(mid)
    if (!terminal || !terminal.resultText) {
      const netMs = record.launchTime ? new Date(record.launchTime).getTime() : 0
      if (netMs && now - netMs > 48 * 60 * 60 * 1000) {
        try { await removeRecord(record._id) } catch (e) {}
        stats.skipped++
      }
      continue
    }

    try {
      const page =
        '/pages/mission-detail/mission-detail?id=' +
        encodeURIComponent(String(mid)) +
        '&type=completed'
      await sendSubscribeMessageByHttp(
        record._openid,
        RESULT_TEMPLATE_ID,
        page,
        buildResultSubscribeData(record, terminal, resultFieldEntries)
      )
      stats.sentOk++
      try {
        await db.collection(SUBSCRIBE_COLLECTION).doc(record._id).update({
          data: {
            resultSent: true,
            resultSentAt: now,
            resultText: terminal.resultText,
            resultQuota: Math.max(0, (Number(record.resultQuota) || 1) - 1),
            updatedAt: now
          }
        })
      } catch (e) {}
      try { await removeRecord(record._id) } catch (e) {}
    } catch (sendErr) {
      stats.failed++
      console.error('[ResultNotify] send fail', record._id, sendErr.message || sendErr)
      const errStr = String(sendErr.message || sendErr)
      // 失败落 push_history，管理后台可见（此前只有 console.error，纯无声失败）
      try {
        await writePushHistoryDetail({
          openid: record._openid || '',
          launchId: record.missionId || '',
          missionName: '[结果通知] ' + (record.missionName || ''),
          error: errStr
        })
      } catch (_) {}
      if (/43101|user refuse|user deny|43107/i.test(errStr)) {
        try { await removeRecord(record._id) } catch (e) {}
      }
    }
  }

  return { success: true, message: 'result notify done', ...stats }
}

async function writePushHistoryBatch({ total, sentCount, startedAt, failureSamples, message, success }) {
  const okFlag = success !== false
  if (okFlag && (total || 0) === 0) return
  try {
    await db.collection(PUSH_HISTORY_COLLECTION).add({
      data: {
        type: 'auto',
        triggeredBy: 'system',
        payload: { source: 'sendLaunchReminder.sendPending' },
        result: {
          success: okFlag,
          message: message || '',
          total: total || 0,
          sentOk: sentCount.sentOk || 0,
          failed: sentCount.failed || 0,
          skipped: sentCount.skipped || 0,
          durationMs: Date.now() - startedAt,
          failureSamples: failureSamples || []
        },
        createdAt: Date.now()
      }
    })
  } catch (e) {
    console.warn('write push_history (batch) failed:', e.message || e)
  }
}

async function writePushHistoryDetail({ openid, launchId, missionName, error }) {
  try {
    await db.collection(PUSH_HISTORY_COLLECTION).add({
      data: {
        type: 'auto_detail',
        triggeredBy: 'system',
        payload: { openid: openid || '', launchId: launchId || '', missionName: missionName || '' },
        result: { success: false, error: String(error || '').slice(0, 500) },
        createdAt: Date.now()
      }
    })
  } catch (e) {
    console.warn('write push_history (detail) failed:', e.message || e)
  }
}

async function removeRecord(docId) {
  try {
    await db.collection(SUBSCRIBE_COLLECTION).doc(docId).remove()
  } catch (e) {}
}

// ── 服务号 B 通道：发射前 30 分钟模板消息 ──
//
// 环境变量（云开发控制台 → sendLaunchReminder）：
// - WECHAT_OA_APPID / WECHAT_OA_SECRET     服务号凭证（必填）
// - WECHAT_OA_TEMPLATE_ID                  公众平台「模板消息」中的模板 ID（必填）
// - WECHAT_OA_MINIPROGRAM_APPID            点击消息跳转的小程序 AppID（可选，默认同小程序 APPID）
// - WECHAT_OA_TMPL_FIELD_MISSION           任务名字段 key（可选；未设置则不写入）
// - WECHAT_OA_TMPL_FIELD_TIME              发射时间字段 key（可选；未设置则不写入）
// - WECHAT_OA_TMPL_FIELD_ROCKET            火箭名字段 key（可选；未设置则不写入）
// - WECHAT_OA_TMPL_FIELD_RECOVERY          回收方式字段 key（可选；未设置则不写入）
// - WECHAT_OA_TMPL_FIELD_REMARK            备注/发射场字段 key（可选；未设置则不写入）
// - WECHAT_OA_TMPL_FIELD_CODE              任务编号字段 key（可选；未设置则不写入）
//
// 旧模板库「巡检任务工单派发通知」仅 3 字段（FBII5P7WK3Eqf7-nmcOxBHWz-pHzfyVEdxY2nB79KdU）：
//   WECHAT_OA_TMPL_FIELD_MISSION = thing9             → 任务名称 missionName（thing，可含中文，≤20）
//   WECHAT_OA_TMPL_FIELD_TIME    = time14             → 发射时间 launchTimeFormatted（time）
//   WECHAT_OA_TMPL_FIELD_CODE    = character_string1  → 任务编号 codeId（character_string，仅 ASCII）
// 任务名/火箭名/发射场等中文字段须用 thing 类型；character_string 仅允许 ASCII，写中文会报 47003。
// rocket/recovery/remark 留空即不写入；代码内 OA_TMPL_FIELD_DEFAULTS 已含 mission/time/code 默认值。

function getOaCredentials() {
  const appid = String(process.env.WECHAT_OA_APPID || '').trim()
  const secret = String(process.env.WECHAT_OA_SECRET || '').trim()
  if (!appid || !secret) return null
  return { appid, secret }
}

function getOaTemplateId() {
  return String(process.env.WECHAT_OA_TEMPLATE_ID || '').trim()
}

function getOaMiniProgramAppid() {
  return String(
    process.env.WECHAT_OA_MINIPROGRAM_APPID ||
      process.env.APPID ||
      process.env.WX_APPID ||
      process.env.MINIPROGRAM_APPID ||
      'wxf98b58309019771b'
  ).trim()
}

let _oaTokenCache = { token: '', expireAt: 0 }
async function getOaAccessToken() {
  const cred = getOaCredentials()
  if (!cred) throw new Error('缺少 WECHAT_OA_APPID / WECHAT_OA_SECRET')
  const nowMs = Date.now()
  if (_oaTokenCache.token && _oaTokenCache.expireAt > nowMs + 60 * 1000) {
    return _oaTokenCache.token
  }
  const url =
    'https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=' +
    encodeURIComponent(cred.appid) +
    '&secret=' +
    encodeURIComponent(cred.secret)
  const res = await axios.get(url)
  if (!res.data || !res.data.access_token) {
    throw new Error('获取服务号 access_token 失败: ' + JSON.stringify(res.data))
  }
  _oaTokenCache = {
    token: res.data.access_token,
    expireAt: nowMs + (res.data.expires_in || 7200) * 1000
  }
  return _oaTokenCache.token
}

var OA_TMPL_FIELD_DEFAULTS = {
  // 「巡检任务工单派发通知」FBII5P7WK3Eqf7-nmcOxBHWz-pHzfyVEdxY2nB79KdU 仅 3 字段：
  //   thing9          → 任务名称 missionName（thing，可含中文，≤20 字符）
  //   time14          → 发射时间 launchTimeFormatted（time）
  //   character_string1 → 任务编号 codeId（character_string，仅 ASCII）
  // 火箭名默认无 thing 槽位可放，留空；如模板另有 thing 字段可用 WECHAT_OA_TMPL_FIELD_ROCKET 指定。
  mission: 'thing9',
  time: 'time14',
  rocket: '',
  recovery: '',
  remark: '',
  code: 'character_string1'
}

function getOaTemplateFieldKeys() {
  return {
    mission: String(process.env.WECHAT_OA_TMPL_FIELD_MISSION || OA_TMPL_FIELD_DEFAULTS.mission).trim(),
    time: String(process.env.WECHAT_OA_TMPL_FIELD_TIME || OA_TMPL_FIELD_DEFAULTS.time).trim(),
    rocket: String(process.env.WECHAT_OA_TMPL_FIELD_ROCKET || OA_TMPL_FIELD_DEFAULTS.rocket).trim(),
    recovery: String(process.env.WECHAT_OA_TMPL_FIELD_RECOVERY || OA_TMPL_FIELD_DEFAULTS.recovery).trim(),
    remark: String(process.env.WECHAT_OA_TMPL_FIELD_REMARK || OA_TMPL_FIELD_DEFAULTS.remark).trim(),
    code: String(process.env.WECHAT_OA_TMPL_FIELD_CODE || OA_TMPL_FIELD_DEFAULTS.code).trim()
  }
}

/** character_string 仅允许 ASCII；优先 launch.id，无则 _id */
function toOaCharacterStringValue(raw, fallback) {
  var ascii = String(raw || '')
    .replace(/[^\x20-\x7E]/g, '')
    .trim()
  if (ascii) return ascii.substring(0, 32)
  return String(fallback || 'N/A').substring(0, 32)
}

/** thing 类型可含中文，但最长 20 个字符；按字符数（含 emoji 代理对）安全截断 */
function toOaThingValue(raw, fallback) {
  var chars = Array.from(String(raw || ''))
  if (chars.length === 0) chars = Array.from(String(fallback || ''))
  return chars.slice(0, 20).join('')
}

function pickLaunchCodeId(launch) {
  if (!launch) return ''
  return String(launch.id || launch._id || '')
}

function pickLaunchRemark(launch) {
  if (!launch) return ''
  var pad = String(launch.padName || launch.pad || '').trim()
  var site = String(launch.site || '').trim()
  if (pad && site && pad !== site) {
    return (pad + ' ' + site).substring(0, 20)
  }
  return (pad || site || '').substring(0, 20)
}

function buildOaTemplateData(opts) {
  var missionName = opts && opts.missionName
  var rocketName = opts && opts.rocketName
  var launchTimeFormatted = opts && opts.launchTimeFormatted
  var recoveryMethod = opts && opts.recoveryMethod
  var remark = opts && opts.remark
  var codeId = opts && opts.codeId
  var keys = getOaTemplateFieldKeys()
  var data = {}
  if (keys.mission) {
    data[keys.mission] = { value: toOaThingValue(missionName, '未知任务') }
  }
  if (keys.time) {
    data[keys.time] = { value: String(launchTimeFormatted || '时间未知').substring(0, 20) }
  }
  if (keys.rocket) {
    data[keys.rocket] = { value: toOaThingValue(rocketName, '未知火箭') }
  }
  if (keys.recovery) {
    data[keys.recovery] = { value: toOaThingValue(recoveryMethod, '待确认') }
  }
  if (keys.remark) {
    data[keys.remark] = { value: toOaThingValue(remark, '') }
  }
  if (keys.code) {
    data[keys.code] = { value: toOaCharacterStringValue(rocketName, 'Launch') }
  }
  return data
}

async function sendOaTemplateMessage(oaOpenid, templateId, pagepath, data) {
  const accessToken = await getOaAccessToken()
  const url =
    'https://api.weixin.qq.com/cgi-bin/message/template/send?access_token=' +
    encodeURIComponent(accessToken)
  const res = await axios.post(url, {
    touser: oaOpenid,
    template_id: templateId,
    miniprogram: {
      appid: getOaMiniProgramAppid(),
      pagepath: pagepath
    },
    data: data
  })
  const errcode = res.data ? res.data.errcode : -1
  if (errcode !== 0) {
    const err = new Error('服务号模板消息失败: errcode=' + errcode + ', errmsg=' + (res.data && res.data.errmsg))
    err.errcode = errcode
    throw err
  }
  return res.data
}

async function hasOaPushLedger(missionId, oaOpenid) {
  const res = await db
    .collection(OA_PUSH_LEDGER)
    .where({ missionId: String(missionId), oaOpenid: oaOpenid, status: 'ok' })
    .limit(1)
    .get()
    .catch(() => ({ data: [] }))
  return !!(res.data && res.data.length)
}

async function writeOaPushLedger(entry) {
  try {
    await db.collection(OA_PUSH_LEDGER).add({
      data: {
        missionId: String(entry.missionId || ''),
        oaOpenid: entry.oaOpenid || '',
        mpOpenid: entry.mpOpenid || '',
        missionName: entry.missionName || '',
        status: entry.status || 'ok',
        error: entry.error ? String(entry.error).slice(0, 500) : '',
        sentAt: Date.now()
      }
    })
  } catch (e) {
    console.warn('[OA] write ledger fail', e.message || e)
  }
}

async function findLaunchesInOaNotifyWindow(nowMs) {
  const leadMs = OA_LEAD_MINUTES * 60 * 1000
  // 捕获「未来 leadMs 分钟内尚未发射」的全部任务：下界放宽到 now，上界 now+lead。
  //
  // 旧实现窗口仅 6min（[now+24min, now+30min]）。表面上 6min 窗 > 5min 定时器间隔可覆盖，
  // 但本通道在 sendPending 链路里排在最后：syncLaunchDataFromCache（逐条 upsert 至多 100 条 +
  // 清理）→（total 为 0 时）兜底再调 syncSpaceDevsData 全量同步 →
  // reconcilePendingSubscriptionsNotifyTimes（最多 200 条、每条可能再 callFunction 拉详情）→
  // A 通道发送，之后才执行到这里。这些前置步骤耗时数十秒~分钟级且很不稳定，导致每次 tick 真正
  // 采样到的 nowMs 抖动远超 1min，相邻两次窗口之间会出现缝隙，使「自然任务」的 windowStart 落入
  // 缝隙而被永久漏过（甚至前置步骤超时导致本通道整轮没跑到）。
  //
  // 放宽下界到 now 后，任务只要进入未来 30min 内，就一定会在最近一次 tick 命中；不会因抖动/延迟漏发。
  // 重复发送由 oa_push_ledger（B 通道，missionId+oaOpenid+status:'ok'）与
  // oa_push_ledger channel='subscribe'（C 通道）去重，故放宽窗口不会造成重复推送。
  // 上界仍为 now+lead，windowStart<now 的已发射任务被自然排除。
  const launchMin = new Date(nowMs)
  const launchMax = new Date(nowMs + leadMs)

  try {
    const res = await db
      .collection(LAUNCH_DATA_COLLECTION)
      .where({
        windowStart: _.gte(launchMin).and(_.lte(launchMax))
      })
      .limit(20)
      .get()
    return res.data || []
  } catch (e) {
    console.warn('[OA] query launch_data fail', e.message || e)
    return []
  }
}

async function sendOATemplateAlerts() {
  const templateId = getOaTemplateId()
  if (!templateId || !getOaCredentials()) {
    return { success: true, skipped: true, reason: 'oa_not_configured' }
  }

  const nowMs = Date.now()
  const stats = { sentOk: 0, failed: 0, skipped: 0, missions: 0 }

  const usersRes = await db
    .collection(OA_AUTO_ALERT_USERS)
    .where({ enabled: true, followed: true })
    .limit(200)
    .get()
    .catch(() => ({ data: [] }))

  const users = (usersRes.data || []).filter(function (u) {
    return u && u.oaOpenid
  })
  if (users.length === 0) {
    return { success: true, message: 'no oa subscribers', ...stats }
  }

  const launches = await findLaunchesInOaNotifyWindow(nowMs)
  if (launches.length === 0) {
    return { success: true, message: 'no launches in notify window', ...stats }
  }

  stats.missions = launches.length

  for (var li = 0; li < launches.length; li++) {
    var launch = launches[li]
    var missionId = String(launch._id || launch.id || '')
    if (!missionId) continue

    var launchTime = launch.windowStart || launch.launchTime || ''
    var launchTimeFormatted = formatLaunchTimeStr(launchTime)
    var missionName = (launch.missionName || launch.name || '未知任务').substring(0, 20)
    var rocketName = (launch.rocketName || '未知火箭').substring(0, 20)
    var recoveryMethod = launch.recoveryMethod || launch.recovery || '待确认'
    var remark = pickLaunchRemark(launch)
    var codeId = pickLaunchCodeId(launch)
    var pagepath = 'pages/mission-detail/mission-detail?id=' + missionId + '&type=upcoming'
    var templateData = buildOaTemplateData({
      missionName: missionName,
      rocketName: rocketName,
      launchTimeFormatted: launchTimeFormatted,
      recoveryMethod: recoveryMethod,
      remark: remark,
      codeId: codeId
    })

    // 本次执行内对同一任务的 oaOpenid 去重：oa_auto_alert_users 可能因 oaWebhook（按 unionid/
    // oaOpenid 建档）与 adminGateway（按 unionid/mpOpenid 建档）两条路径产生同一 oaOpenid 的重复
    // 文档；台账写入存在读后写延迟，hasOaPushLedger 也只看 status:'ok'，循环内会对同一用户连发，
    // 触发 40258（秒级重复内容限频）。Set 在进程内拦截，确保一个任务每个 oaOpenid 最多发一次。
    var seenOaOpenids = {}

    for (var ui = 0; ui < users.length; ui++) {
      var user = users[ui]
      var oaOpenid = user.oaOpenid
      if (!oaOpenid) {
        stats.skipped++
        continue
      }

      var dedupKey = missionId + '_' + oaOpenid
      if (seenOaOpenids[oaOpenid]) {
        stats.skipped++
        continue
      }
      seenOaOpenids[oaOpenid] = true

      if (await hasOaPushLedger(missionId, oaOpenid)) {
        stats.skipped++
        continue
      }

      try {
        await sendOaTemplateMessage(oaOpenid, templateId, pagepath, templateData)
        stats.sentOk++
        await writeOaPushLedger({
          missionId: missionId,
          oaOpenid: oaOpenid,
          mpOpenid: user.mpOpenid || '',
          missionName: missionName,
          status: 'ok'
        })
      } catch (sendErr) {
        var ec = sendErr && sendErr.errcode
        console.error('[OA] send fail', dedupKey, sendErr.message || sendErr)
        // 40258：相同内容已在秒级内发给同一用户，视为「已触达」记 ok，避免下一次 tick 反复重试再触发限频
        if (ec === 40258) {
          stats.sentOk++
          await writeOaPushLedger({
            missionId: missionId,
            oaOpenid: oaOpenid,
            mpOpenid: user.mpOpenid || '',
            missionName: missionName,
            status: 'ok',
            error: '40258 dedup-as-delivered'
          })
        } else {
          stats.failed++
          await writeOaPushLedger({
            missionId: missionId,
            oaOpenid: oaOpenid,
            mpOpenid: user.mpOpenid || '',
            missionName: missionName,
            status: 'failed',
            error: sendErr.message || String(sendErr)
          })
        }
      }
    }
  }

  return { success: true, message: 'oa done', ...stats }
}

// ── C 通道：服务号「订阅通知」(bizsend) 发射前 30 分钟推送 ──
//
// 与旧 B 通道（message/template/send + oa_auto_alert_users）并存、互不干扰。
// 机制区别：订阅通知是「一次性订阅」，用户每点一次「同意」只授予【一次】下发额度，
// 额度由 oaWebhook 在 subscribe_msg_popup_event(accept) 时写入 oa_subscribe_quota。
// 本通道按 remaining>0 的用户发送 bizsend，成功后原子扣减 1 次，并按 missionId+oaOpenid
// 在 oa_push_ledger（channel='subscribe'）去重，避免同任务重复推送。
//
// 接口（务必以官方为准）：
//   POST https://api.weixin.qq.com/cgi-bin/message/subscribe/bizsend?access_token=TOKEN
//   body: { template_id, touser, data, page?, miniprogram_state, lang }
//   返回: { errcode, errmsg }
//   https://developers.weixin.qq.com/doc/service/api/notify/notify/api_sendnewsubscribemsg.html

/** 订阅通知发送：bizsend；errcode!=0 抛出带 errcode 的错误 */
async function sendOaSubscribeMessage(oaOpenid, templateId, page, data) {
  const accessToken = await getOaAccessToken()
  const url =
    'https://api.weixin.qq.com/cgi-bin/message/subscribe/bizsend?access_token=' +
    encodeURIComponent(accessToken)
  const { miniprogramState, lang } = getSubscribeSendOptions()
  const payload = {
    touser: oaOpenid,
    template_id: templateId,
    data: data,
    miniprogram_state: miniprogramState,
    lang: lang
  }
  if (page) payload.page = page
  const res = await axios.post(url, payload)
  const errcode = res.data ? res.data.errcode : -1
  if (errcode !== 0) {
    const err = new Error('订阅通知发送失败: errcode=' + errcode + ', errmsg=' + (res.data && res.data.errmsg))
    err.errcode = errcode
    throw err
  }
  return res.data
}

/** 发送成功后原子扣减 1 次额度 */
async function decrementOaSubscribeQuota(docId) {
  try {
    await db.collection(OA_SUBSCRIBE_QUOTA_COLLECTION).doc(docId).update({
      data: { remaining: _.inc(-1), totalSent: _.inc(1), updatedAt: Date.now() }
    })
  } catch (e) {
    console.warn('[OASub] decrement quota fail', docId, e.message || e)
  }
}

/** 43101（用户未订阅/额度用尽）等：把该用户额度归零，避免反复发 */
async function zeroOaSubscribeQuota(docId, reason) {
  try {
    await db.collection(OA_SUBSCRIBE_QUOTA_COLLECTION).doc(docId).update({
      data: { remaining: 0, lastError: String(reason || '').slice(0, 200), updatedAt: Date.now() }
    })
  } catch (e) {
    console.warn('[OASub] zero quota fail', docId, e.message || e)
  }
}

async function hasOaSubscribeLedger(missionId, oaOpenid) {
  const res = await db
    .collection(OA_PUSH_LEDGER)
    .where({ missionId: String(missionId), oaOpenid: oaOpenid, channel: 'subscribe', status: 'ok' })
    .limit(1)
    .get()
    .catch(() => ({ data: [] }))
  return !!(res.data && res.data.length)
}

async function writeOaSubscribeLedger(entry) {
  try {
    await db.collection(OA_PUSH_LEDGER).add({
      data: {
        channel: 'subscribe',
        missionId: String(entry.missionId || ''),
        oaOpenid: entry.oaOpenid || '',
        templateId: entry.templateId || OA_SUBSCRIBE_TEMPLATE_ID,
        missionName: entry.missionName || '',
        status: entry.status || 'ok',
        error: entry.error ? String(entry.error).slice(0, 500) : '',
        sentAt: Date.now()
      }
    })
  } catch (e) {
    console.warn('[OASub] write ledger fail', e.message || e)
  }
}

/** 构造订阅通知 data：thing 字段≤20 安全截断 */
function buildOaSubscribeData(opts) {
  var data = {}
  data[OA_SUBSCRIBE_FIELDS.mission] = { value: toOaThingValue(opts.missionName, '未知任务') }
  data[OA_SUBSCRIBE_FIELDS.time] = { value: String(opts.launchTimeFormatted || '时间未知').substring(0, 20) }
  data[OA_SUBSCRIBE_FIELDS.rocket] = { value: toOaThingValue(opts.rocketName, '未知火箭') }
  data[OA_SUBSCRIBE_FIELDS.recovery] = { value: toOaThingValue(opts.recoveryMethod, '待确认') }
  data[OA_SUBSCRIBE_FIELDS.remark] = { value: toOaThingValue(opts.remark, '发射场待定') }
  return data
}

async function sendOASubscribeAlerts() {
  if (!getOaCredentials()) {
    return { success: true, skipped: true, reason: 'oa_not_configured' }
  }
  if (!OA_SUBSCRIBE_TEMPLATE_ID) {
    return { success: true, skipped: true, reason: 'no_subscribe_template' }
  }

  const nowMs = Date.now()
  const stats = { sentOk: 0, failed: 0, skipped: 0, quotaExhausted: 0, missions: 0, users: 0 }

  // 有可发额度的用户（一次性订阅，remaining>0）
  const quotaRes = await db
    .collection(OA_SUBSCRIBE_QUOTA_COLLECTION)
    .where({ remaining: _.gt(0), templateId: OA_SUBSCRIBE_TEMPLATE_ID })
    .limit(200)
    .get()
    .catch(() => ({ data: [] }))

  const quotaUsers = (quotaRes.data || []).filter(function (q) {
    return q && q.oaOpenid && Number(q.remaining) > 0
  })
  stats.users = quotaUsers.length
  if (quotaUsers.length === 0) {
    return { success: true, message: 'no subscribers with quota', ...stats }
  }

  const launches = await findLaunchesInOaNotifyWindow(nowMs)
  if (launches.length === 0) {
    return { success: true, message: 'no launches in notify window', ...stats }
  }
  stats.missions = launches.length

  for (var li = 0; li < launches.length; li++) {
    var launch = launches[li]
    var missionId = String(launch._id || launch.id || '')
    if (!missionId) continue

    var launchTime = launch.windowStart || launch.launchTime || ''
    var launchTimeFormatted = formatLaunchTimeStr(launchTime)
    var missionName = (launch.missionName || launch.name || '未知任务').substring(0, 20)
    var rocketName = (launch.rocketName || '未知火箭').substring(0, 20)
    var recoveryMethod = launch.recoveryMethod || launch.recovery || '待确认'
    var remark = pickLaunchRemark(launch)
    var page = 'pages/mission-detail/mission-detail?id=' + missionId + '&type=upcoming'
    var subData = buildOaSubscribeData({
      missionName: missionName,
      rocketName: rocketName,
      launchTimeFormatted: launchTimeFormatted,
      recoveryMethod: recoveryMethod,
      remark: remark
    })

    for (var qi = 0; qi < quotaUsers.length; qi++) {
      var quota = quotaUsers[qi]
      var oaOpenid = quota.oaOpenid

      // 进程内已扣到 0 的用户跳过，避免本批多任务超发
      if (Number(quota.remaining) <= 0) {
        stats.quotaExhausted++
        continue
      }

      if (await hasOaSubscribeLedger(missionId, oaOpenid)) {
        stats.skipped++
        continue
      }

      try {
        await sendOaSubscribeMessage(oaOpenid, OA_SUBSCRIBE_TEMPLATE_ID, page, subData)
        stats.sentOk++
        quota.remaining = Number(quota.remaining) - 1
        await decrementOaSubscribeQuota(quota._id)
        await writeOaSubscribeLedger({
          missionId: missionId,
          oaOpenid: oaOpenid,
          templateId: OA_SUBSCRIBE_TEMPLATE_ID,
          missionName: missionName,
          status: 'ok'
        })
      } catch (sendErr) {
        stats.failed++
        var ec = sendErr && sendErr.errcode
        console.error('[OASub] send fail', missionId + '_' + oaOpenid, sendErr.message || sendErr)
        // 43101: 用户拒收/未订阅/额度用尽 → 归零，避免反复尝试
        if (ec === 43101) {
          quota.remaining = 0
          await zeroOaSubscribeQuota(quota._id, sendErr.message || '43101')
        }
        await writeOaSubscribeLedger({
          missionId: missionId,
          oaOpenid: oaOpenid,
          templateId: OA_SUBSCRIBE_TEMPLATE_ID,
          missionName: missionName,
          status: 'failed',
          error: sendErr.message || String(sendErr)
        })
      }
    }
  }

  return { success: true, message: 'oa subscribe done', ...stats }
}
