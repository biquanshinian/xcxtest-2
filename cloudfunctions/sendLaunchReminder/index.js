const cloud = require('wx-server-sdk')
const axios = require('axios')
// 微信 HTTPS 调用统一 10s 超时，避免网络抖动时挂满整个函数超时时间
axios.defaults.timeout = 10000
const { syncLaunchDataFromCache } = require('./launch-data-sync.js')
const { resolveOaLaunchDisplay, isThingFieldKey } = require('./oa-launch-display.js')
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
 * 线上实测（gettemplate）：thing3 任务名称 / time1 时间 / thing12 结果 / thing11 备注
 */
const RESULT_TEMPLATE_FIELDS = {
  mission: String(process.env.RESULT_TMPL_FIELD_MISSION || 'thing3').trim() || 'thing3',
  time: String(process.env.RESULT_TMPL_FIELD_TIME || 'time1').trim() || 'time1',
  result: String(process.env.RESULT_TMPL_FIELD_RESULT || 'thing12').trim() || 'thing12',
  remark: String(process.env.RESULT_TMPL_FIELD_REMARK || 'thing11').trim() || 'thing11'
}
const PUSH_HISTORY_COLLECTION = 'push_history'
const OA_AUTO_ALERT_USERS = 'oa_auto_alert_users'
const OA_PUSH_LEDGER = 'oa_push_ledger'
const LAUNCH_DATA_COLLECTION = 'launch_data'
const LAUNCH_STATUS_COLLECTION = 'launch_status'

/** 结果通知见终态 → 开屏关联任务下架（失败不影响推送主路径） */
async function triggerSplashMissionPrune(reason) {
  try {
    const res = await cloud.callFunction({
      name: 'adminGateway',
      data: {
        scheduleAction: 'prune_mission_splash',
        pruneSource: 'sendLaunchReminder',
        pruneReason: String(reason || 'result_notify').slice(0, 80)
      }
    })
    return (res && res.result) || { ok: true }
  } catch (e) {
    console.warn('[splash-prune] trigger fail:', e.message || e)
    return { skipped: true, error: e.message || String(e) }
  }
}

async function loadLaunchStatuses(ids) {
  const unique = Array.from(new Set((Array.isArray(ids) ? ids : []).map(String).filter(Boolean)))
  if (!unique.length) return []
  // 文档 _id 即 launch id：用 _.in 批量查询，替代按 id 逐条 doc.get 的 N 次请求扇出
  const CHUNK = 50
  const rows = []
  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK)
    try {
      const res = await db
        .collection(LAUNCH_STATUS_COLLECTION)
        .where({ _id: _.in(chunk) })
        .limit(chunk.length)
        .get()
      if (res && Array.isArray(res.data)) rows.push(...res.data)
    } catch (e) {
      // 批量失败退回逐条读，保证提醒链路不因查询语法差异中断
      for (const id of chunk) {
        try {
          const one = await db.collection(LAUNCH_STATUS_COLLECTION).doc(id).get()
          if (one && one.data) rows.push(one.data)
        } catch (e2) {}
      }
    }
  }
  return rows
}
const OA_LEAD_MINUTES = 30
// OA 发射前提醒：目标 ≈T-30，用「主窗 + 改期兜底 + 最晚下限」三层，而不是 [now, now+30] 全开。
// - 主窗宽度对齐 5min 定时器，正常任务落在 T-30～T-22
// - 上界多给 2min，避免刚进 T-30 时因时钟/查询抖动漏掉
// - MIN_LEAD：NET 突然改近时仍可补推，但绝不贴着/过后才发（体感「发射后才到」）
const OA_NOTIFY_WINDOW_MINUTES = 8
const OA_LEAD_UPPER_SLACK_MINUTES = 2
const OA_MIN_LEAD_MINUTES = 12

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

// 推送历史"明细行"开关：默认关闭（省写配额）。需要排查时把
// PUSH_HISTORY_DETAIL_ENABLED 设为 "1" / "true" / "on"。
// 关闭后只写每批汇总，不为每条成败追加明细。
function isPushHistoryDetailEnabled() {
  const raw = String(process.env.PUSH_HISTORY_DETAIL_ENABLED || '').trim().toLowerCase()
  if (!raw) return false
  return ['1', 'true', 'on', 'yes', 'enabled'].includes(raw)
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

/** Date / ISO / 可解析字符串 → ISO；无效返回 '' */
function toLaunchIso(val) {
  if (val == null || val === '') return ''
  if (val instanceof Date) {
    var t = val.getTime()
    return t > 0 ? new Date(t).toISOString() : ''
  }
  var s = String(val).trim()
  if (!s) return ''
  var ms = new Date(s).getTime()
  return ms > 0 ? new Date(ms).toISOString() : ''
}

/** 台账去重键：按 NET 精确到分钟，改期后可再次推送 */
function netKeyFromIso(iso) {
  var ms = new Date(iso).getTime()
  if (!(ms > 0)) return ''
  return String(Math.floor(ms / 60000))
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
 * 解析「当前」发射 NET：优先 launch_data（hourly 改期写入）→ launch_status → 详情缓存/LL2。
 * 详情缓存 TTL 最长 3.5h，不能作为改期对齐的第一信源。
 */
async function resolveFreshLaunchMeta(launchId) {
  var sid = String(launchId || '')
  var out = { iso: '', missionName: '', rocketName: '', source: '' }
  if (!sid) return out

  try {
    var ldDoc = await db.collection(LAUNCH_DATA_COLLECTION).doc(sid).get()
    var ld = ldDoc && ldDoc.data
    if (ld) {
      var isoLd = toLaunchIso(ld.windowStart) || toLaunchIso(ld.launchTime)
      if (isoLd) {
        out.iso = isoLd
        out.missionName = String(ld.missionName || ld.name || '').substring(0, 20)
        // 小程序订阅 thing 可中文：优先 rocketNameZh，英文原名留在 rocketNameEn
        out.rocketName = String(ld.rocketNameZh || ld.rocketName || '').substring(0, 20)
        out.rocketNameEn = String(ld.rocketName || '').substring(0, 40)
        out.source = 'launch_data'
        return out
      }
    }
  } catch (e0) { /* 无文档则继续 */ }

  try {
    var stDoc = await db.collection(LAUNCH_STATUS_COLLECTION).doc(sid).get()
    var st = stDoc && stDoc.data
    if (st) {
      var isoSt = toLaunchIso(st.net) || toLaunchIso(st.windowStart)
      if (isoSt) {
        out.iso = isoSt
        out.missionName = String(st.name || '').substring(0, 20)
        out.source = 'launch_status'
        return out
      }
    }
  } catch (e1) { /* 无文档则继续 */ }

  var detail = await fetchLaunchDetailForReconcile(sid)
  if (detail) {
    var isoD = toLaunchIso(pickLaunchIsoFromDetail(detail))
    if (isoD) {
      out.iso = isoD
      out.missionName = missionNameFromDetail(detail)
      out.rocketName = rocketNameFromDetail(detail)
      out.source = 'detail'
      return out
    }
  }
  return out
}

/**
 * 发送前刷新未发送订阅的 notifyAt（改期后与 launch_data / 状态 / LL2 一致）
 *
 * 只处理 12 小时内将要提醒（或 notifyAt 缺失）的订阅：
 * 每条订阅的对齐要读 launch_data / 状态（必要时详情），
 * 对提醒时间还在几天后的订阅每 10 分钟对齐一次纯属浪费——
 * 它们进入 12h 视界后自然会被后续 tick 反复对齐，发送精度不受影响。
 */
const RECONCILE_HORIZON_MS = 12 * 60 * 60 * 1000

async function reconcilePendingSubscriptionsNotifyTimes() {
  var stats = { scanned: 0, updated: 0, skipped: 0, errors: 0 }
  try {
    var q = await db
      .collection(SUBSCRIBE_COLLECTION)
      .where({
        sent: false,
        notifyAt: _.or(_.lte(Date.now() + RECONCILE_HORIZON_MS), _.exists(false))
      })
      .limit(100)
      .get()
    var records = q.data || []
    stats.scanned = records.length
    if (records.length === 0) return stats

    var metaByMission = {}

    async function getMeta(mid) {
      var k = String(mid)
      if (Object.prototype.hasOwnProperty.call(metaByMission, k)) {
        return metaByMission[k]
      }
      var m = await resolveFreshLaunchMeta(k)
      metaByMission[k] = m
      return m
    }

    for (var i = 0; i < records.length; i++) {
      var record = records[i]
      try {
        var mid = record.missionId
        if (!mid) {
          stats.skipped++
          continue
        }

        var meta = await getMeta(mid)
        var iso = meta && meta.iso
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
        var dispMeta = resolveOaLaunchDisplay({
          missionName: meta.missionName || record.missionName,
          rocketName: meta.rocketNameEn || record.rocketName || meta.rocketName,
          rocketNameZh: meta.rocketNameZh || (meta.rocketNameEn ? '' : meta.rocketName)
        })
        var mName = dispMeta.missionName
        var rName = dispMeta.rocketNameZh

        if (record.notifyAt === notifyAt && record.launchTime === iso) {
          stats.skipped++
          continue
        }

        await db.collection(SUBSCRIBE_COLLECTION).doc(record._id).update({
          data: {
            launchTime: iso,
            launchTimeFormatted: formatted,
            notifyAt: notifyAt,
            missionName: mName,
            rocketName: rName,
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
    // 不再扫描用户偏好（省掉每个定时 tick 的 user_profile 读）
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

    // 服务号自动提醒已就绪的用户由 B 通道覆盖，不再自动创建 A 通道订阅
    var oaReadyPrefs = await loadOaReadyUserSets()
    var oaReadyMpPrefs = oaReadyPrefs.mpSet

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
      var userOpenid = user.openid || user._openid || user._id
      if (userOpenid && oaReadyMpPrefs.has(String(userOpenid))) continue
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

        var missionId = String(launch._id || launch.id)
        if (!userOpenid || existingPairs.has(String(userOpenid) + '_' + missionId)) continue

        var dedupKey = (userOpenid + '_' + missionId).replace(/[^a-zA-Z0-9_-]/g, '_')

        // 创建订阅记录（确定性 _id 作为并发护栏，避免重复创建）
        try {
          var dispPref = resolveOaLaunchDisplay(launch)
          await db.collection(SUBSCRIBE_COLLECTION).add({
            data: {
              _id: dedupKey,
              _openid: userOpenid,
              missionId: missionId,
              missionName: dispPref.missionName,
              rocketName: dispPref.rocketNameZh,
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

/**
 * 服务号模板 time.* 字段专用格式（微信 47003 极严）。
 * 仅输出文档认可的 24h 制：yyyy-MM-dd HH:mm:ss；无效返回空串（调用方必须跳过发送）。
 * 禁止回退「时间未知」等非时间文案。
 */
function toOaTimeValue(isoOrRaw) {
  var iso = toLaunchIso(isoOrRaw)
  if (!iso) return ''
  try {
    var d = new Date(iso)
    if (!(d.getTime() > 0)) return ''
    var utcMs = d.getTime() + d.getTimezoneOffset() * 60 * 1000
    var bj = new Date(utcMs + 8 * 60 * 60 * 1000)
    var y = bj.getUTCFullYear()
    var m = String(bj.getUTCMonth() + 1).padStart(2, '0')
    var day = String(bj.getUTCDate()).padStart(2, '0')
    var h = String(bj.getUTCHours()).padStart(2, '0')
    var min = String(bj.getUTCMinutes()).padStart(2, '0')
    var sec = String(bj.getUTCSeconds()).padStart(2, '0')
    return y + '-' + m + '-' + day + ' ' + h + ':' + min + ':' + sec
  } catch (e) {
    return ''
  }
}

/** 永久失败：再重试只会烧配额，应记 final 并永久跳过 */
function isPermanentOaErrcode(ec) {
  return (
    ec === 43101 || // user refuse / 拒收模板
    ec === 43004 || // 需要关注
    ec === 40003 || // invalid openid
    ec === 47003 || // 参数格式错误（整任务 payload 坏）
    ec === 40258 // 秒级重复内容限频（视为已触达）
  )
}

function isPermanentOaErrorText(err) {
  return /43101|43004|40003|47003|40258|user refuse|argument invalid|invalid openid|require subscribe/i.test(
    String(err || '')
  )
}

/** 瞬时失败冷却：1h 内不重试，避免网络抖动时每个 tick Insert failed */
const OA_FAILED_COOLDOWN_MS = 60 * 60 * 1000
/** 同一 key 瞬时失败超过此次数后记 final，停止慢泄漏 */
const OA_TRANSIENT_FAIL_MAX = 3

function isOaLedgerSettled(row) {
  if (!row) return false
  if (row.status === 'ok' || row.status === 'final') return true
  if (row.status !== 'failed') return false
  // 历史 failed 若已是永久错误，直接视为结案，避免每个 tick 再打微信 API
  if (isPermanentOaErrorText(row.error)) return true
  var retries = Number(row.retryCount) || 0
  if (retries >= OA_TRANSIENT_FAIL_MAX) return true
  var sentAt = Number(row.sentAt) || 0
  if (sentAt && Date.now() - sentAt < OA_FAILED_COOLDOWN_MS) return true
  return false
}

/**
 * 统计某用户×任务台账里 failed 条数，供瞬时失败写 retryCount / 超限转 final。
 * 仅在准备写入 failed 时调用（低频）。
 */
async function countOaLedgerFailed(whereBase) {
  try {
    const res = await db
      .collection(OA_PUSH_LEDGER)
      .where(Object.assign({ status: 'failed' }, whereBase))
      .limit(OA_TRANSIENT_FAIL_MAX + 1)
      .get()
    return ((res && res.data) || []).length
  } catch (e) {
    return 0
  }
}

async function writeOaTransientFailedLedger(entry) {
  var whereBase = {
    missionId: String(entry.missionId || ''),
    oaOpenid: entry.oaOpenid || '',
    channel: entry.channel || 'template'
  }
  if (entry.netKey) whereBase.netKey = String(entry.netKey)
  var prior = await countOaLedgerFailed(whereBase)
  var nextRetry = prior + 1
  if (nextRetry >= OA_TRANSIENT_FAIL_MAX) {
    await writeOaPushLedger(
      Object.assign({}, entry, {
        status: 'final',
        error: 'transient-retry-exhausted: ' + String(entry.error || '').slice(0, 200),
        retryCount: nextRetry
      })
    )
    return 'final'
  }
  await writeOaPushLedger(
    Object.assign({}, entry, {
      status: 'failed',
      retryCount: nextRetry
    })
  )
  return 'failed'
}

// ── 空跑早退 / bootstrap 限频 ──
// 仅在「确有待办」时跑全链路；不再因「库里随便有条旧订阅」或「±48h 全球任意发射」而永不 idle。
// 检查失败时保守返回 false（照常执行），宁可多跑不能漏发。
const IDLE_RESULT_BACK_MS = 24 * 60 * 60 * 1000

async function isIdleTick() {
  const now = Date.now()

  // 1) 小程序待发提醒：已到期或 12h 内将到期（与 reconcile 视界对齐）
  try {
    const aRes = await db
      .collection(SUBSCRIBE_COLLECTION)
      .where({
        sent: false,
        notifyAt: _.lte(now + RECONCILE_HORIZON_MS)
      })
      .limit(1)
      .get()
    if ((aRes.data || []).length > 0) return false
  } catch (e) {
    return false
  }

  // 2) 小程序待发结果通知（仍有额度且未发）
  try {
    const rRes = await db
      .collection(SUBSCRIBE_COLLECTION)
      .where({
        resultSent: false,
        resultQuota: _.gt(0)
      })
      .limit(1)
      .get()
    if ((rRes.data || []).length > 0) return false
  } catch (e) {
    return false
  }

  // 3) OA 相关发射窗：过去 24h（结果）或未来 T-30（发射前提醒）
  try {
    const windowRes = await db
      .collection(LAUNCH_DATA_COLLECTION)
      .where({
        windowStart: _.gte(new Date(now - IDLE_RESULT_BACK_MS)).and(
          _.lte(new Date(now + OA_LEAD_MINUTES * 60 * 1000))
        )
      })
      .limit(1)
      .get()
    if ((windowRes.data || []).length > 0) return false
  } catch (e) {
    return false
  }

  return true
}

// 空库 bootstrap（callFunction syncLaunches 全量外网同步）每日最多 1 次：
// 用 space_devs_cache 里一条标记文档记录上次触发时间。syncSpaceDevsData 自身有定时器，
// 空库最终会由其自愈，这里的兜底不需要每个 tick 都打一次外网同步。
const BOOTSTRAP_MARKER_DOC_ID = 'meta_sendLaunchReminder_bootstrap'
const BOOTSTRAP_MIN_INTERVAL_MS = 24 * 60 * 60 * 1000

async function maybeBootstrapSyncLaunches() {
  const now = Date.now()
  try {
    const marker = await db
      .collection(SPACE_DEVS_CACHE)
      .doc(BOOTSTRAP_MARKER_DOC_ID)
      .get()
      .catch(() => null)
    const lastAt = marker && marker.data ? Number(marker.data.lastBootstrapAt) : 0
    if (lastAt && now - lastAt < BOOTSTRAP_MIN_INTERVAL_MS) {
      return { ran: false, skipped: 'bootstrap_rate_limited' }
    }
  } catch (e) { /* 标记读取失败不阻断 bootstrap */ }
  // 先写标记再调用：并发 tick 下也只会触发一次
  try {
    await db.collection(SPACE_DEVS_CACHE).doc(BOOTSTRAP_MARKER_DOC_ID).set({
      data: { lastBootstrapAt: now, updatedAt: now }
    })
  } catch (e) {}
  try {
    await cloud.callFunction({
      name: 'syncSpaceDevsData',
      data: { action: 'syncLaunches' }
    })
    return { ran: true }
  } catch (e) {
    return { ran: false, error: e.message || String(e) }
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
  // 控制台测试有时把参数包在 data 里，或 event 为空；必须容错，否则会掉进默认 sendPending 拖垮超时
  var ev = event
  if (ev == null) ev = {}
  if (typeof ev === 'string') {
    try {
      ev = JSON.parse(ev)
    } catch (eParse) {
      ev = {}
    }
  }
  if (ev.data && typeof ev.data === 'object' && (ev.data.action || ev.data.maxRemove != null)) {
    ev = Object.assign({}, ev, ev.data)
  }
  const action = String((ev && ev.action) || 'sendPending')

  // 清理 / 探活：放在最前，不跑 ensureCollection / 发送链路，避免「改成 10 条也失败」
  if (action === 'purgePing') {
    return {
      success: true,
      purgeVersion: '2026-07-29-aged-v4',
      message: 'purgePing ok — 若看到 purgeVersion=2026-07-29-aged-v4，说明已部署到最新代码',
      ts: Date.now()
    }
  }
  // 先看库里真实字段长什么样（不删）
  if (action === 'purgeInspect') {
    try {
      return await purgeInspectLedger()
    } catch (eIns) {
      return {
        success: false,
        message: 'purgeInspect 异常: ' + (eIns && eIns.message ? eIns.message : String(eIns))
      }
    }
  }
  if (action === 'purgePushJunk') {
    try {
      return await purgePushJunk(ev || {})
    } catch (purgeErr) {
      return {
        success: false,
        message: 'purgePushJunk 异常: ' + (purgeErr && purgeErr.message ? purgeErr.message : String(purgeErr)),
        stack: purgeErr && purgeErr.stack ? String(purgeErr.stack).slice(0, 500) : ''
      }
    }
  }

  await ensureSendLaunchReminderCollectionsOnce()

  // 生产自动链路（定时器 launchReminderTrigger 每 5 分钟，config: 0 */5 * * * * *）：
  // 1) syncLaunchDataFromCache ← space_devs_cache upcoming
  // 1b) 空跑早退 ← 无待发 A/结果、且无 OA 窗（过去 24h / 未来 T-30）时到此为止
  // 2) sendOATemplateAlerts / sendOASubscribeAlerts ← 同步后立刻发 T-30（勿排在 A/结果之后）
  // 3) reconcilePendingSubscriptionsNotifyTimes ← A 通道改期对齐
  // 4) sendPendingReminders ← launch_subscriptions 小程序发射前提醒
  // 4b) sendPendingResultNotifications ← 终态后「任务完成提醒」（跳过 OA 就绪用户）
  // 4c) sendOAResultAlerts ← 终态后服务号结果模板 → oa_auto_alert_users
  // 5) matchPreferencesAndCreateSubscriptions ← 偏好自动建订阅
  if (action === 'sendPending') {
    let launchDataSync
    try {
      launchDataSync = await syncLaunchDataFromCache()
      if (!launchDataSync.total) {
        const bootstrap = await maybeBootstrapSyncLaunches()
        if (bootstrap.ran) {
          launchDataSync = await syncLaunchDataFromCache()
        } else if (bootstrap.skipped) {
          launchDataSync.bootstrapSkipped = bootstrap.skipped
        }
        if (bootstrap.error) {
          launchDataSync.bootstrapError = bootstrap.error
        }
      }
    } catch (syncErr) {
      launchDataSync = { success: false, error: syncErr.message || String(syncErr) }
    }
    try {
      if (await isIdleTick()) {
        // idle 时顺手清一小批推送垃圾，避免只靠手动/凌晨定时
        var idlePurge = null
        try {
          idlePurge = await purgePushJunk({ maxRemove: 400, keepDays: 2 })
        } catch (pe) {
          idlePurge = { success: false, error: pe.message || String(pe) }
        }
        return {
          success: true,
          message: 'idle tick: no pending A/result work and no OA launch window',
          idleSkip: true,
          launchDataSync,
          idlePurge
        }
      }
    } catch { /* 检查失败照常执行，宁可多跑不能漏发 */ }
    // T-30 必须尽早：原先排在 reconcile + A + 结果之后，前置耗时可把「窗内」拖到贴 T-0
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
    let oaResultNotify = { skipped: true }
    try {
      oaResultNotify = await sendOAResultAlerts()
    } catch (oaRnErr) {
      oaResultNotify = { success: false, error: oaRnErr.message || String(oaRnErr) }
    }
    // 偏好匹配降频：全球 24h 内几乎总有发射，若每个 5 分钟 tick 都跑，
    // user_profile(50) + 已有订阅去重查询会一直白读。改为每小时整点 tick 执行；
    // 订阅提前量默认 60 分钟，最迟晚 50 分钟建订阅仍在 notifyAt 之前，不影响送达
    if (new Date().getMinutes() < 5) {
      await matchPreferencesAndCreateSubscriptions()
    }
    // 小程序/服务号结果通道确认终态后：下架对应开屏关联项（与推送成功解耦）
    let splashMissionPrune = { skipped: true }
    const mpTerminals = Number(resultNotify && resultNotify.terminalsFound) || 0
    const oaTerminals = Number(oaResultNotify && oaResultNotify.missions) || 0
    const resultHit =
      mpTerminals > 0 ||
      oaTerminals > 0 ||
      Number(resultNotify && resultNotify.sentOk) > 0 ||
      Number(oaResultNotify && oaResultNotify.sentOk) > 0
    if (resultHit) {
      splashMissionPrune = await triggerSplashMissionPrune(
        oaTerminals > 0 || Number(oaResultNotify && oaResultNotify.sentOk) > 0
          ? 'oa_result_notify'
          : 'mp_result_notify'
      )
    }
    return {
      ...result,
      resultNotify,
      oaResultNotify,
      oaResult,
      oaSubscribeResult,
      splashMissionPrune,
      reconcileStats,
      launchDataSync
    }
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
      WECHAT_OA_RESULT_TEMPLATE_ID: !!String(process.env.WECHAT_OA_RESULT_TEMPLATE_ID || '').trim(),
      RESULT_TEMPLATE_ID: !!RESULT_TEMPLATE_ID,
      RESULT_TMPL_FIELDS: RESULT_TEMPLATE_FIELDS,
      WECHAT_OA_TMPL_FIELD_MISSION: !!String(process.env.WECHAT_OA_TMPL_FIELD_MISSION || '').trim(),
      WECHAT_OA_TMPL_FIELD_TIME: !!String(process.env.WECHAT_OA_TMPL_FIELD_TIME || '').trim(),
      WECHAT_OA_TMPL_FIELD_ROCKET: !!String(process.env.WECHAT_OA_TMPL_FIELD_ROCKET || '').trim(),
      WECHAT_OA_TMPL_FIELD_RECOVERY: !!String(process.env.WECHAT_OA_TMPL_FIELD_RECOVERY || '').trim(),
      WECHAT_OA_TMPL_FIELD_REMARK: !!String(process.env.WECHAT_OA_TMPL_FIELD_REMARK || '').trim(),
      WECHAT_OA_TMPL_FIELD_CODE: !!String(process.env.WECHAT_OA_TMPL_FIELD_CODE || '').trim(),
      WECHAT_OA_RESULT_TMPL_FIELD_MISSION: !!String(process.env.WECHAT_OA_RESULT_TMPL_FIELD_MISSION || '').trim(),
      WECHAT_OA_RESULT_TMPL_FIELD_TIME: !!String(process.env.WECHAT_OA_RESULT_TMPL_FIELD_TIME || '').trim(),
      WECHAT_OA_RESULT_TMPL_FIELD_RESULT: !!String(process.env.WECHAT_OA_RESULT_TMPL_FIELD_RESULT || '').trim(),
      WECHAT_OA_RESULT_TMPL_FIELD_ROCKET: !!String(process.env.WECHAT_OA_RESULT_TMPL_FIELD_ROCKET || '').trim(),
      WECHAT_OA_RESULT_TMPL_FIELD_REMARK: !!String(process.env.WECHAT_OA_RESULT_TMPL_FIELD_REMARK || '').trim(),
      WECHAT_OA_RESULT_TMPL_FIELD_CODE: !!String(process.env.WECHAT_OA_RESULT_TMPL_FIELD_CODE || '').trim(),
      WECHAT_OA_RESULT_EFFECTIVE_FIELDS: getOaResultTemplateFieldKeys(),
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
    const oaBounds = getOaNotifyWindowBounds(now)
    const diagnostics = {
      now: new Date(now).toISOString(),
      oaLeadMinutes: OA_LEAD_MINUTES,
      oaMinLeadMinutes: OA_MIN_LEAD_MINUTES,
      oaNotifyWindowMinutes: OA_NOTIFY_WINDOW_MINUTES,
      oaLeadUpperSlackMinutes: OA_LEAD_UPPER_SLACK_MINUTES,
      oaWindow: {
        launchMin: oaBounds.launchMin.toISOString(),
        launchMax: oaBounds.launchMax.toISOString(),
        targetLeadMinutes: oaBounds.targetLeadMinutes
      },
      launchData: {},
      oaPushLedger: {}
    }

    try {
      const launchMin = new Date(now)
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
        .where({
          windowStart: _.gte(oaBounds.launchMin).and(_.lte(oaBounds.launchMax))
        })
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
      let oaResultNotify = { skipped: true }
      try {
        oaResultNotify = await sendOAResultAlerts()
      } catch (oaRnErr) {
        oaResultNotify = { success: false, error: oaRnErr.message || String(oaRnErr) }
      }
      let splashMissionPrune = { skipped: true }
      const mpTerminals = Number(resultNotify && resultNotify.terminalsFound) || 0
      const oaTerminals = Number(oaResultNotify && oaResultNotify.missions) || 0
      const resultHit =
        mpTerminals > 0 ||
        oaTerminals > 0 ||
        Number(resultNotify && resultNotify.sentOk) > 0 ||
        Number(oaResultNotify && oaResultNotify.sentOk) > 0
      if (resultHit) {
        splashMissionPrune = await triggerSplashMissionPrune(
          oaTerminals > 0 || Number(oaResultNotify && oaResultNotify.sentOk) > 0
            ? 'oa_result_notify'
            : 'mp_result_notify'
        )
      }
      return { success: true, resultNotify, oaResultNotify, splashMissionPrune }
    } catch (e) {
      return { success: false, error: e.message || String(e) }
    }
  }

  // 「任务完成提醒」断点定位：一次调用查全 模板配置 / 订阅文档状态 / 终态缓存
  if (action === 'resultDiag') {
    return runResultDiag()
  }

  // 强制测推服务号模板（绕过 T-30 / 台账）。必须 force:true；默认只发 1 人。
  // 例：{ "action":"testOaPush", "force":true, "channel":"both" }
  //     { "action":"testOaPush", "force":true, "channel":"template", "missionId":"...", "oaOpenid":"..." }
  if (action === 'testOaPush') {
    try {
      return await runTestOaPush(ev || {})
    } catch (e) {
      return { success: false, error: e.message || String(e) }
    }
  }

  // 列出可测推的服务号 openid（从 oa_auto_alert_users）
  if (action === 'listOaTestUsers') {
    try {
      const rows = await loadOaAutoAlertCandidates(Math.min(20, Number(ev && ev.limit) || 10))
      return {
        success: true,
        count: rows.length,
        users: rows.map(function (u) {
          return {
            oaOpenid: String(u.oaOpenid || ''),
            mpOpenid: u.mpOpenid ? String(u.mpOpenid).slice(0, 8) + '…' : '',
            enabled: !!u.enabled,
            followed: !!u.followed,
            refused: !!isOaUserMsgRefused(u)
          }
        }),
        tip: '把 users[].oaOpenid 填进 testOaPush；不要填小程序 openid'
      }
    } catch (e) {
      return { success: false, error: e.message || String(e) }
    }
  }

  return { success: false, message: 'unknown action' }
}

/**
 * 排查「任务完成提醒」未推送：
 * - template: RESULT_TEMPLATE_ID 与字段 key（需与公众平台模板关键词逐一对上，否则 47003）
 * - subscriptions: 各状态文档数与样本（resultQuota=0 → 用户弹窗没勾结果模板；
 *   reminderSent=false → 卡在发射前提醒环节；failReason → 上一次发送失败原因）
 * - recentSettled: launch_status 权威状态是否有数据、是否新鲜
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
    const statusRes = await db.collection(LAUNCH_STATUS_COLLECTION).orderBy('observedAtMs', 'desc').limit(40).get()
    const list = statusRes && Array.isArray(statusRes.data) ? statusRes.data : []
    out.recentSettled = {
      exists: true,
      updatedAt: list[0] && list[0].observedAtMs ? new Date(list[0].observedAtMs).toISOString() : null,
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

    // 服务号自动提醒已就绪的用户由 B 通道全自动推送，A 通道不再发发射前提醒（避免双推 / 误耗额度）
    var oaReady = await loadOaReadyUserSets()
    var oaReadyMp = oaReady.mpSet

    // 按 openid+missionId 去重，同一用户同一任务只发第一条
    const sentKeys = new Set()

    for (const record of records) {
      try {
        if (!record._openid) {
          sentCount.skipped++
          await markReminderDone(record._id, { keepForResult: false })
          continue
        }

        if (oaReadyMp.has(String(record._openid))) {
          sentCount.skipped++
          await markReminderDone(record._id, { keepForResult: Number(record.resultQuota) > 0 })
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

        // 瞬时失败冷却 / 超限结案：放在改期查询之前，避免白读 launch_data
        var prevFailAt = Number(record.failedAt) || 0
        var prevFailCount = Number(record.failCount) || 0
        if (prevFailCount >= OA_TRANSIENT_FAIL_MAX) {
          sentCount.skipped++
          await markReminderDone(record._id, { keepForResult: Number(record.resultQuota) > 0 })
          continue
        }
        if (prevFailAt && now - prevFailAt < OA_FAILED_COOLDOWN_MS) {
          sentCount.skipped++
          continue
        }

        // 改期门控：以 launch_data / launch_status 为准。
        // 若新 NET 对应的提醒时刻仍在未来，只改写 notifyAt、本轮不发，避免烧掉一次性额度。
        if (record.missionId) {
          var freshMeta = await resolveFreshLaunchMeta(record.missionId)
          if (freshMeta && freshMeta.iso) {
            var freshLaunchMs = new Date(freshMeta.iso).getTime()
            var leadMin = getLeadMinutesForRecord(record)
            var correctNotifyAt = freshLaunchMs - leadMin * 60 * 1000
            if (correctNotifyAt > now + 90 * 1000) {
              try {
                await db.collection(SUBSCRIBE_COLLECTION).doc(record._id).update({
                  data: {
                    launchTime: freshMeta.iso,
                    launchTimeFormatted: formatLaunchTimeStr(freshMeta.iso),
                    notifyAt: correctNotifyAt,
                    missionName: (freshMeta.missionName || record.missionName || '未知任务').substring(0, 20),
                    rocketName: (freshMeta.rocketName || record.rocketName || '未知火箭').substring(0, 20),
                    updatedAt: Date.now()
                  }
                })
              } catch (deferErr) {
                console.warn('[Send] defer reschedule fail', record._id, deferErr.message || deferErr)
              }
              sentCount.skipped++
              continue
            }
            record.launchTime = freshMeta.iso
            record.launchTimeFormatted = formatLaunchTimeStr(freshMeta.iso)
            if (freshMeta.missionName) record.missionName = freshMeta.missionName
            if (freshMeta.rocketName) record.rocketName = freshMeta.rocketName
          }
        }

        // 旧记录可能误把订阅来源「自动匹配」写进了回收方式字段，发送前纠正
        var recoveryValue = record.recoveryMethod || '一次性'
        if (recoveryValue === '自动匹配') recoveryValue = '待确认'

        // time2 禁止「时间未知」——会 47003 且卡队列每 tick 重试
        var mpTimeVal =
          toOaTimeValue(record.launchTime) || toOaTimeValue(record.launchTimeFormatted)
        if (!mpTimeVal) {
          sentCount.failed++
          if (failureSamples.length < 20) {
            failureSamples.push({
              openid: record._openid || '',
              missionId: record.missionId || '',
              missionName: record.missionName || '',
              error: 'invalid time2: missing launchTime'
            })
          }
          await markReminderDone(record._id, { keepForResult: Number(record.resultQuota) > 0 })
          continue
        }

        var dispMp = resolveOaLaunchDisplay(record)
        await sendSubscribeMessageByHttp(
          record._openid,
          TEMPLATE_ID,
          '/pages/index/index',
          {
            thing1: { value: toOaThingValue(dispMp.missionName, '未知任务') },
            time2: { value: mpTimeVal },
            thing3: { value: toOaThingValue(dispMp.rocketNameZh, '未知火箭') },
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
        const keepResult = Number(record.resultQuota) > 0
        // 永久错误（43101/47003 等）结案，避免卡在 sent:false 每个 tick 烧配额
        if (isPermanentOaErrorText(errStr) || /43101|43107|user refuse|user deny/i.test(errStr)) {
          await markReminderDone(record._id, { keepForResult: keepResult })
        } else {
          const nextFail = (Number(record.failCount) || 0) + 1
          if (nextFail >= OA_TRANSIENT_FAIL_MAX) {
            await markReminderDone(record._id, { keepForResult: keepResult })
          } else {
            try {
              await db.collection(SUBSCRIBE_COLLECTION).doc(record._id).update({
                data: {
                  failReason: String(errDetail).slice(0, 500),
                  failedAt: Date.now(),
                  failCount: nextFail,
                  updatedAt: Date.now()
                }
              })
            } catch (updateErr) {
              await markReminderDone(record._id, { keepForResult: keepResult })
            }
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

/** 中国箭结果通知：失败→失利（与小程序角标策略一致） */
function softenResultTextForChineseRocket(text, hint) {
  const s = String(text || '')
  if (!s) return s
  const hay = String(hint || '')
  if (!/(wenchang|jiuquan|taiyuan|xichang|china|\bprc\b|long march|长征|kuaizhou|快舟|\bgravity-?\s?1\b|引力一号|\bceres-?\s?1\b|谷神星|hyperbola|双曲线|zhuque|朱雀|jielong|smart dragon|捷龙|tianlong|天龙|kinetica|lijian|力箭|landspace|galactic energy|expace|cas space|中科宇航|casc|calt|中国航天)/i.test(hay)) {
    return s
  }
  return s.replace(/部分失败/g, '部分失利').replace(/失败/g, '失利')
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
  const disp = resolveOaLaunchDisplay(record)
  const rocket = String(disp.rocketNameZh || '').substring(0, 12)
  const timeVal =
    toOaTimeValue(record && record.launchTime) ||
    toOaTimeValue(record && record.launchTimeFormatted)
  const rawResult = String((statusInfo && statusInfo.resultText) || '已完成')
  const resultHint = [disp.rocketNameZh, disp.missionName, record && record.name]
    .filter(Boolean)
    .join(' ')
  const roleValues = {
    mission: String(disp.missionName || '未知任务'),
    time: timeVal || '',
    result: softenResultTextForChineseRocket(rawResult, resultHint),
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
  const stats = {
    sentOk: 0,
    failed: 0,
    skipped: 0,
    skippedOaReady: 0,
    checked: 0,
    // 已确认终态的订阅条数（与是否成功发出推送解耦，供开屏下架触发）
    terminalsFound: 0
  }
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

  // 服务号就绪用户改由 sendOAResultAlerts 推结果，避免双推
  let oaReadyMpSet = new Set()
  try {
    const sets = await loadOaReadyUserSets()
    oaReadyMpSet = sets.mpSet || new Set()
  } catch (e) {}

  let settledById = new Map()
  try {
    const list = await loadLaunchStatuses(records.map(function (r) { return r.missionId }))
    for (let i = 0; i < list.length; i++) {
      const row = list[i]
      if (row && row.id && row.status) settledById.set(String(row.id), row)
    }
  } catch (e) {}

  // 终态兜底：存在「发射时间已过但终态缓存未命中」的记录时，触发一次 ll2Query 实况刷新
  // 再重读按 launchId 的权威状态，避免探针空窗导致过期清理后一条不发。
  // fetchLaunchStatuses 自带 120s 共享缓存与 30s 失败记忆，不会放大 LL2 调用。
  const needsSettledRefresh = records.some(function (r) {
    const netMs = r.launchTime ? new Date(r.launchTime).getTime() : 0
    return netMs && netMs <= now && !settledById.has(String(r.missionId || ''))
  })
  if (needsSettledRefresh) {
    try {
      await cloud.callFunction({ name: 'll2Query', data: { action: 'fetchLaunchStatuses' } })
      const list2 = await loadLaunchStatuses(records.map(function (r) { return r.missionId }))
      for (let i = 0; i < list2.length; i++) {
        const row = list2[i]
        if (row && row.id && row.status) settledById.set(String(row.id), row)
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
    if (oaReadyMpSet.has(String(record._openid))) {
      stats.skipped++
      stats.skippedOaReady++
      continue
    }
    var resultFailCount = Number(record.failCount) || 0
    if (resultFailCount >= OA_TRANSIENT_FAIL_MAX) {
      try { await removeRecord(record._id) } catch (e) {}
      stats.skipped++
      continue
    }
    var resultFailAt = Number(record.failedAt) || 0
    if (resultFailAt && now - resultFailAt < OA_FAILED_COOLDOWN_MS) {
      stats.skipped++
      continue
    }
    const terminal = await resolveTerminal(mid)
    if (!terminal || !terminal.resultText) {
      const netMs = record.launchTime ? new Date(record.launchTime).getTime() : 0
      // 小程序结果：超过回看窗仍无终态则清理，避免永久占队列（与 OA_RESULT_LOOKBACK 对齐）
      if (netMs && now - netMs > OA_RESULT_LOOKBACK_MS) {
        try { await removeRecord(record._id) } catch (e) {}
        stats.skipped++
      }
      continue
    }
    stats.terminalsFound++

    var resultTimeVal =
      toOaTimeValue(record.launchTime) || toOaTimeValue(record.launchTimeFormatted)
    if (!resultTimeVal) {
      stats.failed++
      try { await removeRecord(record._id) } catch (e) {}
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
      if (isPushHistoryDetailEnabled()) {
        try {
          await writePushHistoryDetail({
            openid: record._openid || '',
            launchId: record.missionId || '',
            missionName: '[结果通知] ' + (record.missionName || ''),
            success: true
          })
        } catch (_) {}
      }
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
      if (isPushHistoryDetailEnabled()) {
        try {
          await writePushHistoryDetail({
            openid: record._openid || '',
            launchId: record.missionId || '',
            missionName: '[结果通知] ' + (record.missionName || ''),
            error: errStr
          })
        } catch (_) {}
      }
      // 永久错误结案；瞬时失败记 failCount，超限删除，避免每 tick 重试
      if (isPermanentOaErrorText(errStr) || /43101|43107|user refuse|user deny/i.test(errStr)) {
        try { await removeRecord(record._id) } catch (e) {}
      } else {
        const nextFail = (Number(record.failCount) || 0) + 1
        if (nextFail >= OA_TRANSIENT_FAIL_MAX) {
          try { await removeRecord(record._id) } catch (e) {}
        } else {
          try {
            await db.collection(SUBSCRIBE_COLLECTION).doc(record._id).update({
              data: {
                failReason: errStr.slice(0, 500),
                failedAt: now,
                failCount: nextFail,
                updatedAt: now
              }
            })
          } catch (e) {}
        }
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

async function writePushHistoryDetail({ openid, launchId, missionName, error, success }) {
  try {
    const okFlag = success === true
    await db.collection(PUSH_HISTORY_COLLECTION).add({
      data: {
        type: 'auto_detail',
        triggeredBy: 'system',
        payload: { openid: openid || '', launchId: launchId || '', missionName: missionName || '' },
        result: okFlag
          ? { success: true, message: 'ok' }
          : { success: false, error: String(error || '').slice(0, 500) },
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
// 当前默认「巡检任务工单派发通知」FBII5P7WK3Eqf7-nmcOxBG4A7PbuuGFyr-Q1QSs53P8（全 thing/time，可中文）：
//   项目名称     → mission（火箭｜任务）
//   开始时间     → time
//   巡检地点     → remark（发射场）
//   运维巡检公司 → rocket 槽位改填发射商（标签语义匹配）
// 字段 key 优先读环境变量；未配置时按模板 content 中文标签自动识别。

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
  // key 由 resolveOaTemplateFieldKeys 按模板 content 自动识别；此处仅作极端兜底
  mission: '',
  time: '',
  rocket: '',
  recovery: '',
  remark: '',
  code: ''
}

var _oaTmplFieldCache = { templateId: '', keys: null, fetchedAt: 0 }
var OA_TMPL_FIELD_CACHE_TTL = 60 * 60 * 1000

/** 解析服务号模板 content，按中文标签映射到 mission/time/remark/agency(rocket) */
function parseOaDispatchTemplateContent(content) {
  var lines = String(content || '').split('\n')
  var parsed = []
  for (var i = 0; i < lines.length; i++) {
    var m = lines[i].match(/^(.*?)[:：]?\s*\{\{(\w+)\.DATA\}\}/)
    if (m) parsed.push({ label: m[1].trim(), key: m[2] })
  }
  if (!parsed.length) return null
  var keys = { mission: '', time: '', rocket: '', recovery: '', remark: '', code: '' }
  for (var pi = 0; pi < parsed.length; pi++) {
    var label = parsed[pi].label || ''
    var key = parsed[pi].key || ''
    if (!key) continue
    if (!keys.time && (/开始时间|作业时间|创建时间|时间|日期/.test(label) || /^time/.test(key))) {
      keys.time = key
    } else if (!keys.mission && /项目名称|任务名称|工单名称/.test(label)) {
      keys.mission = key
    } else if (!keys.remark && /巡检地点|作业地点|地点|位置/.test(label)) {
      keys.remark = key
    } else if (!keys.rocket && /运维巡检公司|公司|单位|发射商|机构/.test(label)) {
      // rocket 槽位在本模板用于「运维巡检公司」= 发射商
      keys.rocket = key
    } else if (!keys.code && /编号/.test(label) && /^character_string/.test(key)) {
      keys.code = key
    } else if (!keys.remark && /负责人|发起人|派单人/.test(label) && !keys.rocket) {
      // 无公司字段时，人名类 thing 可兜底放发射商
      keys.rocket = key
    }
  }
  return keys
}

async function fetchOaDispatchTemplateFieldKeys(templateId) {
  var tid = String(templateId || '').trim()
  if (!tid) return null
  var now = Date.now()
  if (
    _oaTmplFieldCache.keys &&
    _oaTmplFieldCache.templateId === tid &&
    now - _oaTmplFieldCache.fetchedAt < OA_TMPL_FIELD_CACHE_TTL
  ) {
    return _oaTmplFieldCache.keys
  }
  try {
    var token = await getOaAccessToken()
    var url =
      'https://api.weixin.qq.com/cgi-bin/template/get_all_private_template?access_token=' +
      encodeURIComponent(token)
    var res = await axios.get(url)
    var list = (res.data && res.data.template_list) || []
    var hit = null
    for (var i = 0; i < list.length; i++) {
      if (list[i] && String(list[i].template_id) === tid) {
        hit = list[i]
        break
      }
    }
    if (!hit || !hit.content) return null
    var keys = parseOaDispatchTemplateContent(hit.content)
    if (!keys) return null
    _oaTmplFieldCache = { templateId: tid, keys: keys, fetchedAt: now }
    console.log('[OA] auto field keys', tid, keys)
    return keys
  } catch (e) {
    console.warn('[OA] fetch template fields fail', e.message || e)
    return null
  }
}

function getOaTemplateFieldKeysFromEnv() {
  return {
    mission: String(process.env.WECHAT_OA_TMPL_FIELD_MISSION || OA_TMPL_FIELD_DEFAULTS.mission).trim(),
    time: String(process.env.WECHAT_OA_TMPL_FIELD_TIME || OA_TMPL_FIELD_DEFAULTS.time).trim(),
    rocket: String(process.env.WECHAT_OA_TMPL_FIELD_ROCKET || OA_TMPL_FIELD_DEFAULTS.rocket).trim(),
    recovery: String(process.env.WECHAT_OA_TMPL_FIELD_RECOVERY || OA_TMPL_FIELD_DEFAULTS.recovery).trim(),
    remark: String(process.env.WECHAT_OA_TMPL_FIELD_REMARK || OA_TMPL_FIELD_DEFAULTS.remark).trim(),
    code: String(process.env.WECHAT_OA_TMPL_FIELD_CODE || OA_TMPL_FIELD_DEFAULTS.code).trim()
  }
}

function getOaTemplateFieldKeys() {
  // 同步路径：仅环境变量；发送前会用 resolveOaTemplateFieldKeys 覆盖
  return getOaTemplateFieldKeysFromEnv()
}

async function resolveOaTemplateFieldKeys(templateId) {
  var envKeys = getOaTemplateFieldKeysFromEnv()
  var hasEnv = !!(envKeys.mission || envKeys.time || envKeys.remark || envKeys.rocket || envKeys.code)
  if (hasEnv && envKeys.mission && envKeys.time) return envKeys
  var autoKeys = await fetchOaDispatchTemplateFieldKeys(templateId)
  if (!autoKeys) return envKeys
  return {
    mission: envKeys.mission || autoKeys.mission || '',
    time: envKeys.time || autoKeys.time || '',
    rocket: envKeys.rocket || autoKeys.rocket || '',
    recovery: envKeys.recovery || autoKeys.recovery || '',
    remark: envKeys.remark || autoKeys.remark || '',
    code: envKeys.code || autoKeys.code || ''
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

/**
 * 车辆/工单编号槽位（character_string 仅 ASCII）：
 * 优先火箭名 ASCII → 任务名 ASCII → N/A。
 * 禁止回退 launch UUID（用户侧会看成乱码）。
 */
function pickLaunchCodeId(launch) {
  if (!launch) return ''
  function toAscii(raw) {
    return String(raw || '')
      .replace(/[^\x20-\x7E]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  }
  var rocket = toAscii(launch.rocketName)
  if (rocket) return rocket.substring(0, 32)
  var mission = toAscii(launch.missionName || launch.name)
  if (mission) return mission.substring(0, 32)
  return 'N/A'
}

function pickLaunchRemark(launch) {
  if (!launch) return ''
  var pad = String(launch.padNameZh || launch.padName || launch.pad || '').trim()
  var site = String(launch.siteZh || launch.site || '').trim()
  if (pad && site && pad !== site) {
    return (pad + ' ' + site).substring(0, 20)
  }
  return (pad || site || '').substring(0, 20)
}

function buildOaTemplateData(opts) {
  var missionName = opts && opts.missionName
  var rocketName = opts && opts.rocketName
  var agencyName = opts && opts.agencyName
  var launchTimeFormatted = opts && opts.launchTimeFormatted
  var recoveryMethod = opts && opts.recoveryMethod
  var remark = opts && opts.remark
  var codeId = opts && opts.codeId
  var keys = (opts && opts.fieldKeys) || getOaTemplateFieldKeys()
  var data = {}
  if (keys.mission) {
    data[keys.mission] = { value: toOaThingValue(missionName, '未知任务') }
  }
  if (keys.time) {
    // time 字段必须是合法时间；「时间未知」会触发 47003
    var timeVal = String(opts.launchTimeOa || '').trim() || toOaTimeValue(launchTimeFormatted)
    data[keys.time] = { value: timeVal }
  }
  if (keys.rocket) {
    // 新模板「运维巡检公司」槽：只填发射商，禁止回退火箭名
    data[keys.rocket] = { value: toOaThingValue(agencyName, '待确认') }
  }
  if (keys.recovery) {
    data[keys.recovery] = { value: toOaThingValue(recoveryMethod, '待确认') }
  }
  if (keys.remark) {
    data[keys.remark] = { value: toOaThingValue(remark, '') }
  }
  if (keys.code) {
    // character_string 仅 ASCII；若运营把编号槽改成 thing*，则可写中文火箭名
    if (isThingFieldKey(keys.code)) {
      data[keys.code] = { value: toOaThingValue(codeId || rocketName, '未知火箭') }
    } else {
      data[keys.code] = { value: toOaCharacterStringValue(codeId, 'Launch') }
    }
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

/** 批量加载某任务 template 通道已结案的 oaOpenid（每 tick 1~N 次 in 查询，替代每人 1~2 次） */
async function loadOaTemplateLedgerDoneSet(missionId, netKey, oaOpenids) {
  var done = new Set()
  if (!netKey || !oaOpenids || !oaOpenids.length) return done
  var list = []
  var seen = {}
  for (var i = 0; i < oaOpenids.length; i++) {
    var id = oaOpenids[i] && String(oaOpenids[i])
    if (!id || seen[id]) continue
    seen[id] = true
    list.push(id)
  }
  var CHUNK = 20
  for (var c = 0; c < list.length; c += CHUNK) {
    var chunk = list.slice(c, c + CHUNK)
    var res = await db
      .collection(OA_PUSH_LEDGER)
      .where({
        missionId: String(missionId),
        netKey: String(netKey),
        oaOpenid: _.in(chunk)
      })
      .limit(1000)
      .get()
      .catch(function () {
        return { data: [] }
      })
    var rows = res.data || []
    for (var ri = 0; ri < rows.length; ri++) {
      var r = rows[ri]
      if (r.channel && r.channel !== 'template') continue
      if (isOaLedgerSettled(r)) done.add(String(r.oaOpenid))
    }
  }
  return done
}

async function writeOaPushLedger(entry) {
  try {
    var data = {
      channel: entry.channel || 'template',
      missionId: String(entry.missionId || ''),
      oaOpenid: entry.oaOpenid || '',
      mpOpenid: entry.mpOpenid || '',
      missionName: entry.missionName || '',
      netKey: entry.netKey ? String(entry.netKey) : '',
      resultText: entry.resultText ? String(entry.resultText).slice(0, 40) : '',
      status: entry.status || 'ok',
      error: entry.error ? String(entry.error).slice(0, 500) : '',
      sentAt: Date.now()
    }
    if (entry.retryCount != null) data.retryCount = Number(entry.retryCount) || 0
    await db.collection(OA_PUSH_LEDGER).add({ data: data })
  } catch (e) {
    console.warn('[OA] write ledger fail', e.message || e)
  }
}

function isOaUserMsgRefused(u) {
  return !!(u && (u.oaMsgRefused === true || u.oaMsgRefused === 1))
}

/** 43101 拒收：打用户标记，便于清空台账后不再对同一人重试风暴 */
async function markOaUserRefused(oaOpenid, reason) {
  if (!oaOpenid) return
  try {
    const res = await db
      .collection(OA_AUTO_ALERT_USERS)
      .where({ oaOpenid: String(oaOpenid) })
      .limit(5)
      .get()
    const rows = (res && res.data) || []
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i]
      if (!row || !row._id || isOaUserMsgRefused(row)) continue
      await db
        .collection(OA_AUTO_ALERT_USERS)
        .doc(row._id)
        .update({
          data: {
            oaMsgRefused: true,
            oaMsgRefusedAt: Date.now(),
            oaMsgRefusedReason: String(reason || '').slice(0, 200),
            updatedAt: Date.now()
          }
        })
    }
  } catch (e) {
    console.warn('[OA] mark refused fail', e.message || e)
  }
}

/** 已就绪的服务号自动提醒用户：mpOpenid / oaOpenid 集合（B 通道覆盖，无需再走 A/C） */
async function loadOaReadyUserSets() {
  const mpSet = new Set()
  const oaSet = new Set()
  try {
    const res = await db
      .collection(OA_AUTO_ALERT_USERS)
      .where({ enabled: true, followed: true })
      .limit(200)
      .get()
    const rows = (res && res.data) || []
    for (var i = 0; i < rows.length; i++) {
      var u = rows[i]
      if (!u || !u.oaOpenid) continue
      // 已拒收服务号模板的用户不再算「OA 就绪」，避免 A 通道也被跳过导致两边都不通知
      if (isOaUserMsgRefused(u)) continue
      oaSet.add(String(u.oaOpenid))
      if (u.mpOpenid) mpSet.add(String(u.mpOpenid))
    }
  } catch (e) {
    console.warn('[OA] load ready users fail', e.message || e)
  }
  return { mpSet: mpSet, oaSet: oaSet }
}

/** 不删库，只抽样看 oa_push_ledger 真实字段（排查 status/error 对不上） */
async function purgeInspectLedger() {
  var out = {
    success: true,
    collection: OA_PUSH_LEDGER,
    total: null,
    sample: [],
    statusTally: {},
    errorHints: [],
    message: ''
  }
  try {
    var cnt = await db.collection(OA_PUSH_LEDGER).count()
    out.total = cnt && typeof cnt.total === 'number' ? cnt.total : null
  } catch (eCnt) {
    out.countError = eCnt.message || String(eCnt)
  }
  var rows = []
  try {
    var res = await db.collection(OA_PUSH_LEDGER).limit(20).get()
    rows = (res && res.data) || []
  } catch (eGet) {
    out.getError = eGet.message || String(eGet)
    out.message = '无法读取集合，看 getError'
    return out
  }
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i] || {}
    var st = r.status
    var stKey = st === undefined || st === null ? '(无status字段)' : String(st)
    out.statusTally[stKey] = (out.statusTally[stKey] || 0) + 1
    var err = String(r.error || '')
    if (err && out.errorHints.length < 8) {
      out.errorHints.push(err.slice(0, 120))
    }
    if (out.sample.length < 5) {
      out.sample.push({
        _id: r._id,
        status: r.status,
        error: err.slice(0, 160),
        channel: r.channel,
        missionId: r.missionId,
        oaOpenid: r.oaOpenid ? String(r.oaOpenid).slice(0, 12) + '…' : '',
        sentAt: r.sentAt,
        keys: Object.keys(r).slice(0, 25)
      })
    }
  }
  out.message =
    '已抽样 ' +
    rows.length +
    ' 条，集合约 ' +
    (out.total != null ? out.total : '?') +
    ' 条。把本返回里的 sample/statusTally 发我即可对症清理。'
  return out
}

function isOaLedgerJunkRow(row) {
  if (!row) return false
  var err = String(row.error || '')
  // 永久错误 / 去重结案痕迹：删掉不会让它再打微信 API
  if (/40258|43101|47003|purged-dedup|user refuse|argument invalid|dedup-as-delivered/i.test(err)) {
    return true
  }
  var st = row.status
  var stStr = st === undefined || st === null ? '' : String(st)
  if (stStr === 'final') return true
  if (stStr === 'failed') {
    // 冷却中的 failed 行本身就是限流凭据，删掉下个 tick 会立刻重打微信 API。
    // 只有重试超限、无时间戳、或已过冷却窗的才算结案可删。
    if ((Number(row.retryCount) || 0) >= OA_TRANSIENT_FAIL_MAX) return true
    var sentAt = Number(row.sentAt) || 0
    if (!sentAt) return true
    return Date.now() - sentAt >= OA_FAILED_COOLDOWN_MS
  }
  return false
}

/**
 * 清理 oa_push_ledger：
 * 探查显示库内主要是 status=ok、error 为空的「成功去重台账」，不是 failed 垃圾。
 * 超出 lookback 后不再需要，按 sentAt 过期删除即可（默认 keepDays=2 > 结果回看 24h）。
 * 顺带清 push_history 过期明细。翻页不用游标：每页读完即删，同一 where 自然返回下一批。
 */
async function purgePushJunk(event) {
  const opts = event || {}
  const dryRun = opts.dryRun === true || opts.dryRun === 1 || opts.dryRun === '1'
  var rawMax = Number(opts.maxRemove)
  if (!(rawMax > 0)) rawMax = 500
  const maxRemove = Math.min(5000, Math.max(1, Math.floor(rawMax)))
  // 默认清 2 天前的台账；可传 keepDays 调整（兼容旧参数名 keepLedgerDays）
  const keepDays = Math.min(
    30,
    Math.max(1, Number(opts.keepDays) || Number(opts.keepLedgerDays) || 2)
  )
  const cutoff = Date.now() - keepDays * 24 * 60 * 60 * 1000
  // push_history 明细日志：默认保留 7 天
  const keepHistoryDays = Math.min(90, Math.max(1, Number(opts.keepHistoryDays) || 7))
  const histCutoff = Date.now() - keepHistoryDays * 24 * 60 * 60 * 1000
  const startedAt = Date.now()
  const timeBudgetMs = Math.min(100000, Math.max(8000, Number(opts.timeBudgetMs) || 45000))

  const stats = {
    dryRun: dryRun,
    purgeVersion: '2026-07-29-aged-v4',
    mode: 'aged+settledJunk+history',
    keepDays: keepDays,
    keepHistoryDays: keepHistoryDays,
    cutoff: cutoff,
    removedAged: 0,
    removedJunk: 0,
    removedHistory: 0,
    remainingAged: null,
    scanned: 0,
    skippedFreshOk: 0,
    refusedMarked: 0,
    sample: [],
    statusTally: {},
    queryErrors: [],
    maxRemove: maxRemove,
    timedOut: false,
    elapsedMs: 0,
    bulkAged: false
  }

  function timeOk() {
    return Date.now() - startedAt < timeBudgetMs
  }

  async function removeDocs(rows, collectionName) {
    if (!rows.length) return 0
    if (dryRun) return rows.length
    var coll = collectionName || OA_PUSH_LEDGER
    var n = 0
    var CONCURRENCY = 20
    for (var off = 0; off < rows.length; off += CONCURRENCY) {
      if (!timeOk()) {
        stats.timedOut = true
        break
      }
      var chunk = rows.slice(off, off + CONCURRENCY)
      var results = await Promise.all(
        chunk.map(function (doc) {
          return db
            .collection(coll)
            .doc(doc._id)
            .remove()
            .then(function () {
              return 1
            })
            .catch(function () {
              return 0
            })
        })
      )
      for (var ri = 0; ri < results.length; ri++) n += results[ri]
    }
    return n
  }

  var budget = maxRemove
  var markedRefuse = {}

  // ——— A. 批量删过期台账（主路径：12 万条 ok 的正解）———
  if (!dryRun && budget > 0 && timeOk()) {
    try {
      var bulk = await db
        .collection(OA_PUSH_LEDGER)
        .where({ sentAt: _.lt(cutoff) })
        .remove()
      var bulkN =
        (bulk && bulk.stats && typeof bulk.stats.removed === 'number' ? bulk.stats.removed : 0) || 0
      if (bulkN > 0) {
        // 批量删一次最多 1000 条，实际删多少就报多少（budget 不能扣成负数）
        stats.removedAged += bulkN
        budget = Math.max(0, budget - bulkN)
        stats.bulkAged = true
      }
    } catch (eBulk) {
      stats.queryErrors.push('bulk_aged: ' + (eBulk.message || String(eBulk)).slice(0, 160))
    }
  }

  // dryRun：不能翻页（不删的话每页都是同一批，会重复计数），用 count 估算
  if (dryRun && budget > 0 && timeOk()) {
    try {
      var cRes = await db
        .collection(OA_PUSH_LEDGER)
        .where({ sentAt: _.lt(cutoff) })
        .count()
      var cN = (cRes && cRes.total) || 0
      stats.remainingAged = cN
      stats.removedAged += Math.min(cN, budget)
      budget = Math.max(0, budget - cN)
      var sRes = await db
        .collection(OA_PUSH_LEDGER)
        .where({ sentAt: _.lt(cutoff) })
        .limit(1)
        .get()
      var sRow = ((sRes && sRes.data) || [])[0]
      if (sRow) {
        stats.sample.push({
          _id: sRow._id,
          status: sRow.status,
          error: String(sRow.error || '').slice(0, 80),
          sentAt: sRow.sentAt,
          sentAtAgeDays:
            Number(sRow.sentAt) > 0
              ? Math.round((Date.now() - Number(sRow.sentAt)) / 86400000)
              : null
        })
      }
    } catch (eCnt) {
      stats.queryErrors.push('dryrun_count: ' + (eCnt.message || String(eCnt)).slice(0, 160))
    }
  }

  // bulk 不够或 bulk 失败：用 sentAt 条件翻页删。
  // 每页读完即删，所以不需要游标——下一次同样的 where 自然返回新的一页。
  var stuck = 0
  while (!dryRun && budget > 0 && timeOk() && stuck < 3) {
    var page = []
    try {
      var res = await db
        .collection(OA_PUSH_LEDGER)
        .where({ sentAt: _.lt(cutoff) })
        .orderBy('sentAt', 'asc')
        .limit(Math.min(100, budget))
        .get()
      page = (res && res.data) || []
    } catch (eAged) {
      stats.queryErrors.push('aged_page: ' + (eAged.message || String(eAged)).slice(0, 160))
      // 无复合索引时退回只按 sentAt
      try {
        var res2 = await db
          .collection(OA_PUSH_LEDGER)
          .where({ sentAt: _.lt(cutoff) })
          .limit(Math.min(100, budget))
          .get()
        page = (res2 && res2.data) || []
      } catch (e2) {
        stats.queryErrors.push('aged_page2: ' + (e2.message || String(e2)).slice(0, 160))
        break
      }
    }
    if (!page.length) break
    stats.scanned += page.length
    if (!stats.sample.length) {
      var s0 = page[0] || {}
      stats.sample.push({
        _id: s0._id,
        status: s0.status,
        error: String(s0.error || '').slice(0, 80),
        sentAt: s0.sentAt,
        sentAtAgeDays:
          s0.sentAt && Number(s0.sentAt) > 0
            ? Math.round((Date.now() - Number(s0.sentAt)) / 86400000)
            : null
      })
    }
    var n = await removeDocs(page)
    stats.removedAged += n
    budget -= n
    if (n === 0) stuck++
    else stuck = 0
    if (page.length < 100) break
  }

  // ——— B. 清结案垃圾：按 status 定向查（failed/final），不做全表顺扫 ———
  // 全表顺扫每次都从 _id 头部重读同一批新鲜台账，扫不到尾部垃圾还白烧读操作。
  if (budget > 0 && timeOk()) {
    var junkStatuses = ['failed', 'final']
    for (var si = 0; si < junkStatuses.length; si++) {
      var st = junkStatuses[si]
      var stuckJ = 0
      while (budget > 0 && timeOk() && stuckJ < 3) {
        var pageJ = []
        try {
          var resJ = await db
            .collection(OA_PUSH_LEDGER)
            .where({ status: st })
            .limit(Math.min(100, budget))
            .get()
          pageJ = (resJ && resJ.data) || []
        } catch (eJ) {
          stats.queryErrors.push(
            'junk_' + st + ': ' + (eJ.message || String(eJ)).slice(0, 160)
          )
          break
        }
        if (!pageJ.length) break
        stats.scanned += pageJ.length
        var toDel = []
        for (var i = 0; i < pageJ.length; i++) {
          var row = pageJ[i]
          if (!row || !row._id) continue
          stats.statusTally[st] = (stats.statusTally[st] || 0) + 1
          var sentAt = Number(row.sentAt) || 0
          var isAged = sentAt > 0 && sentAt < cutoff
          var rowErr = String(row.error || '')
          var isRefused = /43101|user refuse/i.test(rowErr)
          // 删「还在去重视界内」的结案行会让下个 tick 重发一次（多打一次微信 API）。
          // 只有 43101（已写用户拒收标记，不会复发）或已出 lookback 的行才安全。
          var isJunk =
            isOaLedgerJunkRow(row) &&
            (isRefused || !sentAt || Date.now() - sentAt > OA_RESULT_LOOKBACK_MS)
          if (!isAged && !isJunk) {
            stats.skippedFreshOk++
            continue
          }
          if (isRefused) {
            var oid = String(row.oaOpenid || '')
            if (oid && !markedRefuse[oid]) {
              markedRefuse[oid] = true
              if (!dryRun) {
                try {
                  await markOaUserRefused(oid, row.error)
                } catch (eM) {}
              }
              stats.refusedMarked++
            }
          }
          toDel.push(row)
        }
        // 本页全是「冷却中/视界内」的行：再查也是同一批，停手
        if (!toDel.length) break
        if (dryRun) {
          stats.removedJunk += Math.min(toDel.length, budget)
          budget = Math.max(0, budget - toDel.length)
          break
        }
        var nJ = await removeDocs(toDel)
        stats.removedJunk += nJ
        budget -= nJ
        if (nJ === 0) stuckJ++
        else stuckJ = 0
      }
    }
  }

  // ——— C. 清 push_history 明细日志（createdAt 过期即无用）———
  if (timeOk()) {
    try {
      if (dryRun) {
        var hCnt = await db
          .collection(PUSH_HISTORY_COLLECTION)
          .where({ createdAt: _.lt(histCutoff) })
          .count()
        stats.removedHistory = (hCnt && hCnt.total) || 0
      } else {
        var hBulk = await db
          .collection(PUSH_HISTORY_COLLECTION)
          .where({ createdAt: _.lt(histCutoff) })
          .remove()
        stats.removedHistory =
          (hBulk && hBulk.stats && typeof hBulk.stats.removed === 'number'
            ? hBulk.stats.removed
            : 0) || 0
        // 批量删有单次上限，剩下的翻页补删（读完即删，无需游标）
        var hStuck = 0
        var hBudget = maxRemove
        while (hBudget > 0 && timeOk() && hStuck < 3) {
          var hRes = await db
            .collection(PUSH_HISTORY_COLLECTION)
            .where({ createdAt: _.lt(histCutoff) })
            .limit(Math.min(100, hBudget))
            .get()
          var hPage = (hRes && hRes.data) || []
          if (!hPage.length) break
          var hN = await removeDocs(hPage, PUSH_HISTORY_COLLECTION)
          stats.removedHistory += hN
          hBudget -= hN
          if (hN === 0) hStuck++
          else hStuck = 0
        }
      }
    } catch (eHist) {
      stats.queryErrors.push('history: ' + (eHist.message || String(eHist)).slice(0, 160))
    }
  }

  if (!timeOk()) stats.timedOut = true
  stats.elapsedMs = Date.now() - startedAt
  stats.totalRemoved = stats.removedAged + stats.removedJunk

  // 剩余量必须实测：budget 没花完不等于清空了（大头可能还在 keepDays 窗口内）
  if (!dryRun) {
    try {
      var remain = await db
        .collection(OA_PUSH_LEDGER)
        .where({ sentAt: _.lt(cutoff) })
        .count()
      stats.remainingAged = (remain && remain.total) || 0
    } catch (eR) {
      stats.remainingAged = null
      stats.queryErrors.push('remain_count: ' + (eR.message || String(eR)).slice(0, 160))
    }
  }
  stats.done = stats.remainingAged === 0 && !stats.timedOut

  var histTail = stats.removedHistory > 0 ? '；push_history 清 ' + stats.removedHistory + ' 条' : ''
  var remainTail =
    stats.remainingAged == null
      ? ''
      : stats.remainingAged > 0
        ? '；仍有 ' + stats.remainingAged + ' 条待清，请继续点测试'
        : '；过期台账已清空'
  stats.message = dryRun
    ? 'dryRun：过期台账约 ' +
      (stats.remainingAged == null ? '?' : stats.remainingAged) +
      ' 条（>' +
      keepDays +
      ' 天）' +
      histTail
    : stats.totalRemoved > 0 || stats.removedHistory > 0
      ? '本批已删 ' +
        stats.totalRemoved +
        '（过期台账 ' +
        stats.removedAged +
        ' + 风暴痕迹 ' +
        stats.removedJunk +
        '）' +
        histTail +
        remainTail
      : stats.queryErrors.length
        ? '未删除：查询失败。请给 oa_push_ledger 的 sentAt 加索引后重试。queryErrors 已返回。'
        : '未找到 ' + keepDays + ' 天前的台账。可把 keepDays 改为 1，或确认 sentAt 字段有值。'
  return { success: true, ...stats }
}

/** 距发射剩余毫秒；无效 NET 返回 NaN */
function oaLaunchRemainingMs(launch, nowMs) {
  if (!launch) return NaN
  var raw = launch.windowStart || launch.launchTime || ''
  var iso = toLaunchIso(raw) || ''
  var ms = new Date(iso || raw).getTime()
  if (!(ms > 0)) return NaN
  return ms - Number(nowMs)
}

/**
 * 是否仍适合发发射前提醒（发送前二次校验，防止前置耗时把「窗内」拖成贴 T-0）。
 * 允许区间：[MIN_LEAD, LEAD+slack] ≈ [T-12, T-32]
 */
function shouldSendOaPreLaunchAlert(launch, nowMs) {
  var remain = oaLaunchRemainingMs(launch, nowMs)
  if (!(remain > 0)) return false
  var minMs = OA_MIN_LEAD_MINUTES * 60 * 1000
  var maxMs = (OA_LEAD_MINUTES + OA_LEAD_UPPER_SLACK_MINUTES) * 60 * 1000
  return remain >= minMs && remain <= maxMs
}

function getOaNotifyWindowBounds(nowMs) {
  // 查询窗 = 主窗 ∪ 改期兜底：
  //   [now+MIN_LEAD, now+LEAD+slack] ≈ [T-12, T-32]
  // 正常节奏（5min tick + 同步后立刻发）命中靠近上沿的主窗 T-30～T-22；
  // NET 临时改近时仍可在 ≥12 分钟时补一刀，避免「完全漏推」，也不会发射后才推。
  var minMs = OA_MIN_LEAD_MINUTES * 60 * 1000
  var maxMs = (OA_LEAD_MINUTES + OA_LEAD_UPPER_SLACK_MINUTES) * 60 * 1000
  return {
    launchMin: new Date(nowMs + minMs),
    launchMax: new Date(nowMs + maxMs),
    minLeadMinutes: OA_MIN_LEAD_MINUTES,
    maxLeadMinutes: OA_LEAD_MINUTES + OA_LEAD_UPPER_SLACK_MINUTES,
    targetLeadMinutes: OA_LEAD_MINUTES,
    primaryWindowMinutes: OA_NOTIFY_WINDOW_MINUTES
  }
}

async function findLaunchesInOaNotifyWindow(nowMs) {
  // 设计取舍（相对旧版 [now, now+30]）：
  // 1) 旧版下界=now 是为了防漏（链路排最后、10min tick、前置同步抖动会撕开窄窗），
  //    副作用是星链改期后会在 T-1～T+几分钟才推到，体感「发射后才提醒」。
  // 2) 现改为：定时器 5min + 同步后立刻跑 OA（不再等 A/结果），抖动可控；
  //    下界抬到 MIN_LEAD=12min，上界 T-32，目标落在约 T-30。
  // 3) 台账去重仍在，窗内多次 tick 不会双推。
  var bounds = getOaNotifyWindowBounds(nowMs)

  try {
    const res = await db
      .collection(LAUNCH_DATA_COLLECTION)
      .where({
        windowStart: _.gte(bounds.launchMin).and(_.lte(bounds.launchMax))
      })
      .limit(20)
      .get()
    var rows = res.data || []
    // 二次过滤：DB 边界含等于；发送时再按最新 now 校验一次
    return rows.filter(function (row) {
      return shouldSendOaPreLaunchAlert(row, nowMs)
    })
  } catch (e) {
    console.warn('[OA] query launch_data fail', e.message || e)
    return []
  }
}

async function loadLaunchDataDoc(missionId) {
  const id = String(missionId || '').trim()
  if (!id) return null
  try {
    const doc = await db.collection(LAUNCH_DATA_COLLECTION).doc(id).get()
    if (doc && doc.data) return Object.assign({ _id: id }, doc.data)
  } catch (e) {}
  try {
    const res = await db
      .collection(LAUNCH_DATA_COLLECTION)
      .where({ id: id })
      .limit(1)
      .get()
    const row = (res.data || [])[0]
    if (row) return row
  } catch (e2) {}
  return null
}

function pickTestOaOpenid(opts) {
  opts = opts || {}
  return String(
    opts.oaOpenid || opts.oaOpenId || opts.openid || opts.openId || ''
  ).trim()
}

function normalizeTestMissionId(raw) {
  var id = String(raw || '').trim()
  if (!id) return ''
  // 示例占位「任务ID」勿当真
  if (id === '任务ID' || id === 'missionId' || id === 'MISSION_ID') return ''
  return id
}

async function loadOaAutoAlertCandidates(limit) {
  const n = Math.max(1, Math.min(20, Number(limit) || 5))
  const usersRes = await db
    .collection(OA_AUTO_ALERT_USERS)
    .where({ enabled: true, followed: true })
    .limit(200)
    .get()
    .catch(function () {
      return { data: [] }
    })
  return (usersRes.data || [])
    .filter(function (u) {
      return u && u.oaOpenid && !isOaUserMsgRefused(u)
    })
    .slice(0, n)
}

async function resolveTestOaUserByAnyId(want) {
  const id = String(want || '').trim()
  if (!id) return { users: [], resolve: null }

  // 1) 已是服务号 openid，且在可用名单
  var ready = await loadOaAutoAlertCandidates(200)
  var byOa = ready.filter(function (u) {
    return String(u.oaOpenid) === id
  })
  if (byOa.length) {
    return { users: byOa, resolve: 'oaOpenid' }
  }

  // 2) 前端复制的通常是小程序 openid → 用 mpOpenid 反查
  try {
    var byMp = await db
      .collection(OA_AUTO_ALERT_USERS)
      .where({ mpOpenid: id })
      .limit(5)
      .get()
    var mpRows = byMp.data || []
    if (mpRows.length) {
      var usable = mpRows.filter(function (u) {
        return u && u.oaOpenid && u.enabled && u.followed && !isOaUserMsgRefused(u)
      })
      if (usable.length) {
        return { users: usable, resolve: 'mpOpenid→oaOpenid' }
      }
      var row = mpRows[0]
      return {
        users: [],
        resolve: 'mpOpenid',
        error:
          '已用小程序 openid 找到档案，但服务号侧未就绪：' +
          'enabled=' +
          !!row.enabled +
          ', followed=' +
          !!row.followed +
          ', oaOpenid=' +
          (row.oaOpenid ? '有' : '无') +
          (isOaUserMsgRefused(row) ? ', refused=true' : '') +
          '。请先关注服务号「火星探索日志」，并在菜单/小程序里开启自动提醒后再测。'
      }
    }
  } catch (e) {}

  // 3) 再按 oaOpenid 查未启用/未关注记录，给出明确原因
  try {
    var byOaAll = await db
      .collection(OA_AUTO_ALERT_USERS)
      .where({ oaOpenid: id })
      .limit(3)
      .get()
    var oaRows = byOaAll.data || []
    if (oaRows.length) {
      var r0 = oaRows[0]
      return {
        users: [],
        resolve: 'oaOpenid',
        error:
          '找到该 oaOpenid，但未满足推送条件：enabled=' +
          !!r0.enabled +
          ', followed=' +
          !!r0.followed +
          (isOaUserMsgRefused(r0) ? ', refused=true' : '')
      }
    }
  } catch (e2) {}

  return {
    users: [],
    resolve: null,
    error:
      '库中未找到该 ID（既不是可用 oaOpenid，也不是已绑定的 mpOpenid）。' +
      '前端会员页复制的是小程序 openid；请确认已关注服务号且开启自动提醒，或先跑 listOaTestUsers。'
  }
}

async function pickTestOaUsers(opts) {
  const want = pickTestOaOpenid(opts)
  const limit = Math.max(1, Math.min(5, Number((opts && opts.limitUsers) || 1) || 1))
  if (!want) {
    var users = await loadOaAutoAlertCandidates(200)
    return { users: users.slice(0, limit), resolve: 'default', error: '' }
  }
  var resolved = await resolveTestOaUserByAnyId(want)
  if (resolved.users && resolved.users.length) {
    return {
      users: resolved.users.slice(0, limit),
      resolve: resolved.resolve,
      error: ''
    }
  }
  // 仍允许 force 直推原值（仅当你确定它就是本服务号 openid）
  if (opts && (opts.direct === true || opts.direct === 1 || opts.direct === '1')) {
    return {
      users: [{ oaOpenid: want, mpOpenid: '', _direct: true }],
      resolve: 'direct',
      error: resolved.error || ''
    }
  }
  return { users: [], resolve: resolved.resolve, error: resolved.error || '无法解析收件人' }
}

/**
 * 调试专用：强制推送服务号发射前 / 结果模板。
 * - 不要求 T-30 窗口；跳过 oa_push_ledger 去重
 * - 默认不写台账（可反复测）；writeLedger:true 才写入
 * - 默认只发给 1 个自动提醒用户，避免误推全量
 */
async function runTestOaPush(opts) {
  opts = opts || {}
  const force = opts.force === true || opts.force === 1 || opts.force === '1' || opts.force === 'true'
  if (!force) {
    return {
      success: false,
      message: 'testOaPush 需 force:true。例：{"action":"testOaPush","force":true,"channel":"both"}'
    }
  }
  if (!getOaCredentials()) {
    return { success: false, message: '服务号凭证未配置' }
  }

  var channel = String(opts.channel || 'both').trim().toLowerCase()
  if (channel !== 'template' && channel !== 'result' && channel !== 'both') {
    channel = 'both'
  }
  const writeLedger = opts.writeLedger === true || opts.writeLedger === 1 || opts.writeLedger === '1'
  // 规范化 missionId，避免把示例文案「任务ID」传进查询
  opts = Object.assign({}, opts, {
    missionId: normalizeTestMissionId(opts.missionId),
    templateMissionId: normalizeTestMissionId(opts.templateMissionId),
    resultMissionId: normalizeTestMissionId(opts.resultMissionId),
    oaOpenid: pickTestOaOpenid(opts)
  })
  const picked = await pickTestOaUsers(opts)
  const users = (picked && picked.users) || []
  if (!users.length) {
    return {
      success: false,
      message: (picked && picked.error) || '无法解析收件人',
      resolve: picked && picked.resolve,
      tip:
        '前端复制的是小程序 openid，可直接传：代码会按 mpOpenid 换成服务号 oaOpenid。' +
        '若仍失败，先确认已关注服务号并开启自动提醒；确需原值直推则加 "direct":true。'
    }
  }

  const out = {
    success: true,
    force: true,
    writeLedger: writeLedger,
    resolve: picked.resolve || '',
    directOpenid: !!(users[0] && users[0]._direct),
    users: users.map(function (u) {
      return {
        oaOpenid: String(u.oaOpenid).slice(0, 8) + '…',
        mpOpenid: u.mpOpenid ? String(u.mpOpenid).slice(0, 8) + '…' : '',
        direct: !!u._direct
      }
    }),
    template: null,
    result: null
  }

  if (channel === 'template' || channel === 'both') {
    out.template = await testSendOaTemplateOnce(opts, users, writeLedger)
  }
  if (channel === 'result' || channel === 'both') {
    out.result = await testSendOaResultOnce(opts, users, writeLedger)
  }
  out.success = !!(
    (out.template && out.template.success) ||
    (out.result && out.result.success)
  )

  // 40003：openid 不属于当前 WECHAT_OA_APPID（常见：填了小程序 openid，或未关注本服务号）
  var hit40003 =
    (out.template &&
      out.template.sends &&
      out.template.sends.some(function (s) {
        return s && s.errcode === 40003
      })) ||
    (out.result &&
      out.result.sends &&
      out.result.sends.some(function (s) {
        return s && s.errcode === 40003
      }))
  if (hit40003) {
    out.hint =
      'errcode 40003=invalid openid：当前 openid 不是本服务号粉丝 openid。' +
      '请去掉 oaOpenid 改用名单内用户，或在库 oa_auto_alert_users 里复制 oaOpenid 字段。'
    try {
      var samples = await loadOaAutoAlertCandidates(5)
      out.sampleOaOpenids = samples.map(function (u) {
        return String(u.oaOpenid)
      })
    } catch (eHint) {
      out.sampleOaOpenids = []
    }
  }
  return out
}

async function testSendOaTemplateOnce(opts, users, writeLedger) {
  const templateId = getOaTemplateId()
  if (!templateId) return { success: false, reason: 'WECHAT_OA_TEMPLATE_ID empty' }

  var launch = null
  var missionId = String((opts && opts.missionId) || (opts && opts.templateMissionId) || '').trim()
  if (missionId) {
    launch = await loadLaunchDataDoc(missionId)
  } else {
    try {
      const res = await db
        .collection(LAUNCH_DATA_COLLECTION)
        .where({ windowStart: _.gte(new Date()) })
        .orderBy('windowStart', 'asc')
        .limit(1)
        .get()
      launch = (res.data || [])[0] || null
    } catch (e) {
      return { success: false, reason: 'query upcoming fail: ' + (e.message || e) }
    }
  }
  if (!launch) {
    return { success: false, reason: missionId ? 'mission not found in launch_data' : 'no upcoming launch_data' }
  }
  missionId = String(launch._id || launch.id || missionId)

  const launchTime = launch.windowStart || launch.launchTime || ''
  const launchTimeIso = toLaunchIso(launchTime)
  const launchTimeOa = toOaTimeValue(launchTimeIso || launchTime)
  if (!launchTimeOa) {
    return { success: false, reason: 'invalid time for template', missionId: missionId }
  }
  const launchNetKey = netKeyFromIso(launchTimeIso || launchTime) || 'test'
  const disp = resolveOaLaunchDisplay(launch)
  const fieldKeys = await resolveOaTemplateFieldKeys(templateId)
  const pagepath = 'pages/mission-detail/mission-detail?id=' + missionId + '&type=upcoming'
  const templateData = buildOaTemplateData({
    missionName: disp.projectTitle || disp.missionName,
    rocketName: disp.rocketNameZh,
    agencyName: disp.agencyName || '待确认',
    launchTimeFormatted: formatLaunchTimeStr(launchTimeIso || launchTime),
    launchTimeOa: launchTimeOa,
    recoveryMethod: launch.recoveryMethod || launch.recovery || '待确认',
    remark: disp.siteName || disp.remark || pickLaunchRemark(launch),
    codeId: disp.rocketNameEn,
    fieldKeys: fieldKeys
  })

  const sends = []
  for (var i = 0; i < users.length; i++) {
    var user = users[i]
    var oaOpenid = user.oaOpenid
    try {
      await sendOaTemplateMessage(oaOpenid, templateId, pagepath, templateData)
      if (writeLedger) {
        await writeOaPushLedger({
          missionId: missionId,
          oaOpenid: oaOpenid,
          mpOpenid: user.mpOpenid || '',
          missionName: disp.missionName,
          netKey: launchNetKey,
          status: 'ok',
          error: 'testOaPush'
        })
      }
      sends.push({ oaOpenid: String(oaOpenid).slice(0, 8) + '…', ok: true })
    } catch (sendErr) {
      sends.push({
        oaOpenid: String(oaOpenid).slice(0, 8) + '…',
        ok: false,
        errcode: sendErr && sendErr.errcode,
        error: (sendErr && sendErr.message) || String(sendErr)
      })
    }
  }
  return {
    success: sends.some(function (s) { return s.ok }),
    channel: 'template',
    templateId: templateId,
    missionId: missionId,
    missionName: disp.missionName,
    projectTitle: disp.projectTitle,
    fieldKeys: fieldKeys,
    data: templateData,
    sends: sends
  }
}

async function testSendOaResultOnce(opts, users, writeLedger) {
  const templateId = getOaResultTemplateId()
  if (!templateId) return { success: false, reason: 'WECHAT_OA_RESULT_TEMPLATE_ID empty' }
  const resultFieldKeys = getOaResultTemplateFieldKeys()
  if (!resultFieldKeys.mission || !resultFieldKeys.result) {
    return { success: false, reason: 'oa_result_fields_not_configured' }
  }

  var launch = null
  var missionId = String((opts && opts.resultMissionId) || (opts && opts.missionId) || '').trim()
  var resultText = String((opts && opts.resultText) || '').trim()

  if (missionId) {
    launch = await loadLaunchDataDoc(missionId)
  } else {
    const past = await findOaResultCandidateLaunches(Date.now())
    for (var pi = 0; pi < past.length; pi++) {
      var cand = past[pi]
      var cid = String((cand && (cand._id || cand.id)) || '')
      if (!cid) continue
      var st = null
      try {
        const list = await loadLaunchStatuses([cid])
        st = list && list[0]
      } catch (e) {}
      var text = ''
      if (st && st.status && isTerminalStatusId(st.status.id)) {
        text = resultTextFromStatus(st.status)
      } else if (cand && isTerminalStatusId(cand.statusId)) {
        text =
          TERMINAL_RESULT_TEXT[Number(cand.statusId)] ||
          resultTextFromStatus({ id: cand.statusId, name: cand.status })
      }
      if (!text) continue
      launch = cand
      missionId = cid
      if (!resultText) {
        const hint = [cand.rocketName, cand.missionName, cand.name].filter(Boolean).join(' ')
        resultText = softenResultTextForChineseRocket(text, hint)
      }
      break
    }
  }

  if (!launch) {
    return {
      success: false,
      reason: missionId
        ? 'mission not found / not usable'
        : 'no terminal launch in lookback; pass missionId + resultText'
    }
  }
  missionId = String(launch._id || launch.id || missionId)

  if (!resultText) {
    if (isTerminalStatusId(launch.statusId)) {
      resultText =
        TERMINAL_RESULT_TEXT[Number(launch.statusId)] ||
        resultTextFromStatus({ id: launch.statusId, name: launch.status }) ||
        '已成功'
    } else {
      try {
        const list = await loadLaunchStatuses([missionId])
        const st = list && list[0]
        if (st && st.status) resultText = resultTextFromStatus(st.status)
      } catch (e) {}
    }
    if (!resultText) resultText = String(opts.resultText || '已成功')
  }

  const launchTime = launch.windowStart || launch.launchTime || ''
  const launchTimeIso = toLaunchIso(launchTime)
  const launchTimeOa = toOaTimeValue(launchTimeIso || launchTime)
  if (!launchTimeOa) {
    return { success: false, reason: 'invalid time for result template', missionId: missionId }
  }
  const disp = resolveOaLaunchDisplay(launch)
  const rocketName = disp.rocketNameZh
  const agencyName = disp.agencyName || '待确认'
  const codeId = isThingFieldKey(resultFieldKeys.code)
    ? agencyName
    : pickLaunchCodeId({
        rocketName: disp.rocketNameEn,
        missionName: launch.missionNameEn || launch.nameEn || disp.rocketNameEn
      })
  const pagepath = 'pages/mission-detail/mission-detail?id=' + missionId + '&type=completed'
  const resultProjectTitle = disp.projectTitle || disp.missionName
  const templateData = buildOaResultTemplateData({
    missionName: resultProjectTitle,
    rocketName: rocketName,
    agencyName: agencyName,
    launchTimeFormatted: formatLaunchTimeStr(launchTimeIso || launchTime),
    launchTimeOa: launchTimeOa,
    resultText: resultText,
    remark: disp.remark || pickLaunchRemark(launch),
    codeId: codeId
  })

  const sends = []
  for (var i = 0; i < users.length; i++) {
    var user = users[i]
    var oaOpenid = user.oaOpenid
    try {
      await sendOaTemplateMessage(oaOpenid, templateId, pagepath, templateData)
      if (writeLedger) {
        await writeOaPushLedger({
          channel: 'result',
          missionId: missionId,
          oaOpenid: oaOpenid,
          mpOpenid: user.mpOpenid || '',
          missionName: resultProjectTitle,
          resultText: resultText,
          status: 'ok',
          error: 'testOaPush'
        })
      }
      sends.push({ oaOpenid: String(oaOpenid).slice(0, 8) + '…', ok: true })
    } catch (sendErr) {
      sends.push({
        oaOpenid: String(oaOpenid).slice(0, 8) + '…',
        ok: false,
        errcode: sendErr && sendErr.errcode,
        error: (sendErr && sendErr.message) || String(sendErr)
      })
    }
  }
  return {
    success: sends.some(function (s) { return s.ok }),
    channel: 'result',
    templateId: templateId,
    missionId: missionId,
    missionName: resultProjectTitle,
    resultText: resultText,
    fieldKeys: resultFieldKeys,
    data: templateData,
    sends: sends
  }
}

async function sendOATemplateAlerts() {
  const templateId = getOaTemplateId()
  if (!templateId || !getOaCredentials()) {
    return { success: true, skipped: true, reason: 'oa_not_configured' }
  }

  const nowMs = Date.now()
  const stats = { sentOk: 0, failed: 0, skipped: 0, missions: 0 }

  // 先查发射窗口（1 次轻量查询，多数 tick 为空直接返回），
  // 再扫用户表——避免每个 tick 都白读最多 200 条 oa_auto_alert_users
  const launches = await findLaunchesInOaNotifyWindow(nowMs)
  if (launches.length === 0) {
    return { success: true, message: 'no launches in notify window', ...stats }
  }

  const usersRes = await db
    .collection(OA_AUTO_ALERT_USERS)
    .where({ enabled: true, followed: true })
    .limit(200)
    .get()
    .catch(() => ({ data: [] }))

  const users = (usersRes.data || []).filter(function (u) {
    return u && u.oaOpenid && !isOaUserMsgRefused(u)
  })
  if (users.length === 0) {
    return { success: true, message: 'no oa subscribers', ...stats }
  }

  stats.missions = launches.length

  for (var li = 0; li < launches.length; li++) {
    var launch = launches[li]
    var missionId = String(launch._id || launch.id || '')
    if (!missionId) continue

    // 发送前再取 now：避免本批多任务循环中耗时把剩余时间压进 MIN_LEAD 以下
    if (!shouldSendOaPreLaunchAlert(launch, Date.now())) {
      stats.skipped++
      continue
    }

    var launchTime = launch.windowStart || launch.launchTime || ''
    var launchTimeIso = toLaunchIso(launchTime)
    var launchNetKey = netKeyFromIso(launchTimeIso || launchTime)
    // 无可靠 NET 时不发、不写无键台账，避免挡住改期后的自动推送
    if (!launchNetKey) {
      stats.skipped++
      continue
    }
    var launchTimeOa = toOaTimeValue(launchTimeIso || launchTime)
    // time 字段非法会全员 47003；无合法时间则本任务整批跳过
    if (!launchTimeOa) {
      console.warn('[OA] skip mission: invalid template time', missionId)
      stats.skipped += users.length
      continue
    }
    var launchTimeFormatted = formatLaunchTimeStr(launchTimeIso || launchTime)
    var disp = resolveOaLaunchDisplay(launch)
    var missionName = disp.missionName
    var rocketName = disp.rocketNameZh
    var projectTitle = disp.projectTitle || missionName
    var recoveryMethod = launch.recoveryMethod || launch.recovery || '待确认'
    // 巡检地点 = 发射场；运维巡检公司 = 发射商
    var remark = disp.siteName || disp.remark || pickLaunchRemark(launch)
    var agencyName = disp.agencyName || '待确认'
    var fieldKeys = await resolveOaTemplateFieldKeys(templateId)
    // 工单编号 character_string 仅 ASCII：继续用英文火箭名（本模板通常无此槽）
    var codeId = pickLaunchCodeId({
      rocketName: disp.rocketNameEn,
      missionName: launch.missionNameEn || launch.nameEn || disp.rocketNameEn
    })
    var pagepath = 'pages/mission-detail/mission-detail?id=' + missionId + '&type=upcoming'
    var templateData = buildOaTemplateData({
      missionName: projectTitle,
      rocketName: rocketName,
      agencyName: agencyName,
      launchTimeFormatted: launchTimeFormatted,
      launchTimeOa: launchTimeOa,
      recoveryMethod: recoveryMethod,
      remark: remark,
      codeId: isThingFieldKey(fieldKeys.code) ? rocketName : codeId,
      fieldKeys: fieldKeys
    })

    // 本次执行内对同一任务的 oaOpenid 去重：oa_auto_alert_users 可能因 oaWebhook（按 unionid/
    // oaOpenid 建档）与 adminGateway（按 unionid/mpOpenid 建档）两条路径产生同一 oaOpenid 的重复
    // 文档；台账写入存在读后写延迟，循环内会对同一用户连发，触发 40258。
    var seenOaOpenids = {}
    var openidList = users.map(function (u) { return u && u.oaOpenid }).filter(Boolean)
    var uniqueTplCount = new Set(openidList.map(String)).size
    var ledgerDone = await loadOaTemplateLedgerDoneSet(missionId, launchNetKey, openidList)
    if (uniqueTplCount > 0 && ledgerDone.size >= uniqueTplCount) {
      stats.skipped += uniqueTplCount
      continue
    }

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

      if (ledgerDone.has(String(oaOpenid))) {
        stats.skipped++
        continue
      }

      try {
        await sendOaTemplateMessage(oaOpenid, templateId, pagepath, templateData)
        stats.sentOk++
        ledgerDone.add(String(oaOpenid))
        await writeOaPushLedger({
          missionId: missionId,
          oaOpenid: oaOpenid,
          mpOpenid: user.mpOpenid || '',
          missionName: missionName,
          netKey: launchNetKey,
          status: 'ok'
        })
      } catch (sendErr) {
        var ec = sendErr && sendErr.errcode
        var errMsg = sendErr.message || String(sendErr)
        console.error('[OA] send fail', dedupKey, errMsg)
        if (ec === 40258) {
          stats.sentOk++
          ledgerDone.add(String(oaOpenid))
          await writeOaPushLedger({
            missionId: missionId,
            oaOpenid: oaOpenid,
            mpOpenid: user.mpOpenid || '',
            missionName: missionName,
            netKey: launchNetKey,
            status: 'ok',
            error: '40258 dedup-as-delivered'
          })
        } else if (isPermanentOaErrcode(ec) || isPermanentOaErrorText(errMsg)) {
          // 43101 拒收 / 47003 参数坏等：记 final，下个 tick 不再打微信、不再 Insert failed
          stats.failed++
          ledgerDone.add(String(oaOpenid))
          if (ec === 43101 || /43101|user refuse/i.test(errMsg)) {
            await markOaUserRefused(oaOpenid, errMsg)
          }
          await writeOaPushLedger({
            missionId: missionId,
            oaOpenid: oaOpenid,
            mpOpenid: user.mpOpenid || '',
            missionName: missionName,
            netKey: launchNetKey,
            status: 'final',
            error: errMsg
          })
          // 47003 是整任务 payload 问题：剩余用户直接 final，避免本 tick 继续打爆 API
          if (ec === 47003) {
            for (var uj = ui + 1; uj < users.length; uj++) {
              var u2 = users[uj]
              var oa2 = u2 && u2.oaOpenid
              if (!oa2 || seenOaOpenids[oa2] || ledgerDone.has(String(oa2))) continue
              seenOaOpenids[oa2] = true
              ledgerDone.add(String(oa2))
              stats.skipped++
              await writeOaPushLedger({
                missionId: missionId,
                oaOpenid: oa2,
                mpOpenid: (u2 && u2.mpOpenid) || '',
                missionName: missionName,
                netKey: launchNetKey,
                status: 'final',
                error: '47003 mission-payload-poison: ' + String(errMsg).slice(0, 200)
              })
            }
            break
          }
        } else {
          stats.failed++
          var tStatus = await writeOaTransientFailedLedger({
            missionId: missionId,
            oaOpenid: oaOpenid,
            mpOpenid: user.mpOpenid || '',
            missionName: missionName,
            netKey: launchNetKey,
            error: errMsg
          })
          if (tStatus === 'final') ledgerDone.add(String(oaOpenid))
        }
      }
    }
  }

  return { success: true, message: 'oa done', ...stats }
}

// ── 服务号 B 通道：终态结果模板消息 ──
//
// 环境变量（云开发控制台 → sendLaunchReminder）：
// - WECHAT_OA_RESULT_TEMPLATE_ID              结果模板 ID（必填才发送；字段有代码默认值）
// - WECHAT_OA_RESULT_TMPL_FIELD_*             可选覆盖；未设置则用下方「工单已生成通知」默认 key
//
// 当前默认对应「工单已生成通知」g8f6Aa4G2BW0QDiYX74nLlJ6PfVfOIIEOJGGj0ngiuQ：
//   thing33 → 项目名称 missionName（中文）
//   time20  → 发起时间
//   thing2  → 单位名称 = 发射商中文（thing；中国发射商对齐卡片词典）
//   thing4  → 工单状态 resultText（已成功/失败等）
// 已去掉 character_string 车辆编号，结果通知可全中文。
//
// 未配置模板 ID 时整段跳过，不影响 T-30。
// 去重：oa_push_ledger channel='result' + missionId + oaOpenid（终态每任务只推一次）。

// 终态结果回看：24h 足够覆盖绝大多数「发射后出结果」；过长会让每个 tick 白扫已结案任务
const OA_RESULT_LOOKBACK_MS = 24 * 60 * 60 * 1000

var OA_RESULT_TMPL_FIELD_DEFAULTS = {
  mission: 'thing33',
  time: 'time20',
  result: 'thing4',
  rocket: '',
  remark: '',
  code: 'thing2'
}

function getOaResultTemplateId() {
  return String(process.env.WECHAT_OA_RESULT_TEMPLATE_ID || '').trim()
}

function getOaResultTemplateFieldKeys() {
  return {
    mission: String(process.env.WECHAT_OA_RESULT_TMPL_FIELD_MISSION || OA_RESULT_TMPL_FIELD_DEFAULTS.mission).trim(),
    time: String(process.env.WECHAT_OA_RESULT_TMPL_FIELD_TIME || OA_RESULT_TMPL_FIELD_DEFAULTS.time).trim(),
    result: String(process.env.WECHAT_OA_RESULT_TMPL_FIELD_RESULT || OA_RESULT_TMPL_FIELD_DEFAULTS.result).trim(),
    rocket: String(process.env.WECHAT_OA_RESULT_TMPL_FIELD_ROCKET || OA_RESULT_TMPL_FIELD_DEFAULTS.rocket).trim(),
    remark: String(process.env.WECHAT_OA_RESULT_TMPL_FIELD_REMARK || OA_RESULT_TMPL_FIELD_DEFAULTS.remark).trim(),
    code: String(process.env.WECHAT_OA_RESULT_TMPL_FIELD_CODE || OA_RESULT_TMPL_FIELD_DEFAULTS.code).trim()
  }
}

function buildOaResultTemplateData(opts) {
  var missionName = opts && opts.missionName
  var rocketName = opts && opts.rocketName
  var agencyName = opts && opts.agencyName
  var launchTimeFormatted = opts && opts.launchTimeFormatted
  var resultText = opts && opts.resultText
  var remark = opts && opts.remark
  var codeId = opts && opts.codeId
  var keys = getOaResultTemplateFieldKeys()
  var data = {}
  if (keys.mission) {
    data[keys.mission] = { value: toOaThingValue(missionName, '未知任务') }
  }
  if (keys.time) {
    // time20 等：禁止「时间未知」；无效时由上层跳过整任务
    var timeVal = String(opts.launchTimeOa || '').trim() || toOaTimeValue(launchTimeFormatted)
    data[keys.time] = { value: timeVal }
  }
  if (keys.result) {
    data[keys.result] = { value: toOaThingValue(resultText, '已完成') }
  }
  if (keys.rocket) {
    data[keys.rocket] = { value: toOaThingValue(rocketName, '未知火箭') }
  }
  if (keys.remark) {
    data[keys.remark] = { value: toOaThingValue(remark, '') }
  }
  if (keys.code) {
    // thing2「单位名称」= 发射商中文；character_string 仍走 ASCII codeId
    if (isThingFieldKey(keys.code)) {
      data[keys.code] = { value: toOaThingValue(agencyName || codeId, '待确认') }
    } else {
      data[keys.code] = { value: toOaCharacterStringValue(codeId, 'Launch') }
    }
  }
  return data
}

/** 批量加载某任务 result 通道已结案的 oaOpenid */
async function loadOaResultLedgerDoneSet(missionId, oaOpenids) {
  var done = new Set()
  if (!oaOpenids || !oaOpenids.length) return done
  var list = []
  var seen = {}
  for (var i = 0; i < oaOpenids.length; i++) {
    var id = oaOpenids[i] && String(oaOpenids[i])
    if (!id || seen[id]) continue
    seen[id] = true
    list.push(id)
  }
  var CHUNK = 20
  for (var c = 0; c < list.length; c += CHUNK) {
    var chunk = list.slice(c, c + CHUNK)
    var res = await db
      .collection(OA_PUSH_LEDGER)
      .where({
        missionId: String(missionId),
        channel: 'result',
        oaOpenid: _.in(chunk)
      })
      .limit(1000)
      .get()
      .catch(function () {
        return { data: [] }
      })
    var rows = res.data || []
    for (var ri = 0; ri < rows.length; ri++) {
      var r = rows[ri]
      if (isOaLedgerSettled(r)) done.add(String(r.oaOpenid))
    }
  }
  return done
}

/** 过去 OA_RESULT_LOOKBACK_MS（24h）内已过 NET 的 launch_data（供终态结果扫描） */
async function findRecentlyPastLaunches(nowMs) {
  const res = await db
    .collection(LAUNCH_DATA_COLLECTION)
    .where({
      windowStart: _.gte(new Date(nowMs - OA_RESULT_LOOKBACK_MS)).and(_.lte(new Date(nowMs)))
    })
    .limit(50)
    .get()
    .catch(() => ({ data: [] }))
  return res.data || []
}

/**
 * 结果候选：launch_data 近 24h 已过 NET + launch_status 近期终态兜底
 * （防止任务已不在 upcoming、或 sync 间隙导致 launch_data 暂缺而漏推）
 */
async function findOaResultCandidateLaunches(nowMs) {
  const byId = new Map()
  const past = await findRecentlyPastLaunches(nowMs)
  for (let i = 0; i < past.length; i++) {
    const l = past[i]
    const id = String((l && (l._id || l.id)) || '')
    if (id) byId.set(id, l)
  }
  try {
    const stRes = await db
      .collection(LAUNCH_STATUS_COLLECTION)
      .orderBy('observedAtMs', 'desc')
      .limit(40)
      .get()
    const rows = (stRes && stRes.data) || []
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const id = String((row && (row._id || row.id)) || '')
      if (!id || byId.has(id)) continue
      const statusId = row.status && row.status.id != null ? Number(row.status.id) : 0
      if (!isTerminalStatusId(statusId)) continue
      const netRaw = row.net || row.windowStart || ''
      const netMs = netRaw ? new Date(netRaw).getTime() : Number(row.settledAtMs || row.observedAtMs) || 0
      if (netMs && (nowMs - netMs > OA_RESULT_LOOKBACK_MS || netMs > nowMs + 60 * 60 * 1000)) {
        continue
      }
      byId.set(id, {
        _id: id,
        id: id,
        missionName: row.name || '',
        name: row.name || '',
        rocketName: '',
        launchTime: netRaw || '',
        windowStart: row.windowStart || netRaw || '',
        statusId: statusId,
        status: (row.status && row.status.name) || ''
      })
    }
  } catch (e) {
    // 无 observedAtMs 索引时忽略，仍依赖 launch_data
  }
  return Array.from(byId.values())
}

/**
 * 对 oa_auto_alert_users 推送终态结果（服务号模板消息）。
 * 与小程序 sendPendingResultNotifications 互斥：就绪用户只走本通道。
 */
async function sendOAResultAlerts() {
  const templateId = getOaResultTemplateId()
  if (!templateId || !getOaCredentials()) {
    return { success: true, skipped: true, reason: 'oa_result_not_configured' }
  }
  const fieldKeys = getOaResultTemplateFieldKeys()
  if (!fieldKeys.mission || !fieldKeys.result) {
    return { success: true, skipped: true, reason: 'oa_result_fields_not_configured' }
  }

  const nowMs = Date.now()
  const stats = { sentOk: 0, failed: 0, skipped: 0, missions: 0, checked: 0 }

  const pastLaunches = await findOaResultCandidateLaunches(nowMs)
  if (!pastLaunches.length) {
    return { success: true, message: 'no recent past launches', ...stats }
  }

  const usersRes = await db
    .collection(OA_AUTO_ALERT_USERS)
    .where({ enabled: true, followed: true })
    .limit(200)
    .get()
    .catch(() => ({ data: [] }))
  const users = (usersRes.data || []).filter(function (u) {
    return u && u.oaOpenid && !isOaUserMsgRefused(u)
  })
  if (!users.length) {
    return { success: true, message: 'no oa subscribers', ...stats }
  }

  const missionIds = pastLaunches
    .map(function (l) {
      return String((l && (l._id || l.id)) || '')
    })
    .filter(Boolean)

  let settledById = new Map()
  try {
    const list = await loadLaunchStatuses(missionIds)
    for (let i = 0; i < list.length; i++) {
      const row = list[i]
      if (row && row.id && row.status) settledById.set(String(row.id), row)
    }
  } catch (e) {}

  // 有已过 NET 但终态缓存未命中时，触发一次实况刷新（与小程序结果通道一致）
  const needsRefresh = pastLaunches.some(function (l) {
    const id = String((l && (l._id || l.id)) || '')
    if (!id) return false
    if (settledById.has(id) && isTerminalStatusId(settledById.get(id).status && settledById.get(id).status.id)) {
      return false
    }
    if (l && isTerminalStatusId(l.statusId)) return false
    return true
  })
  if (needsRefresh) {
    try {
      await cloud.callFunction({ name: 'll2Query', data: { action: 'fetchLaunchStatuses' } })
      const list2 = await loadLaunchStatuses(missionIds)
      for (let i = 0; i < list2.length; i++) {
        const row = list2[i]
        if (row && row.id && row.status) settledById.set(String(row.id), row)
      }
    } catch (e) {
      console.warn('[OAResult] settled refresh fail:', e.message || e)
    }
  }

  const terminals = []
  for (let li = 0; li < pastLaunches.length; li++) {
    const launch = pastLaunches[li]
    const missionId = String((launch && (launch._id || launch.id)) || '')
    if (!missionId) continue
    stats.checked++

    let resultText = ''
    const hit = settledById.get(missionId)
    if (hit && hit.status && isTerminalStatusId(hit.status.id)) {
      resultText = resultTextFromStatus(hit.status)
    } else if (launch && isTerminalStatusId(launch.statusId)) {
      resultText =
        TERMINAL_RESULT_TEXT[Number(launch.statusId)] ||
        resultTextFromStatus({ id: launch.statusId, name: launch.status })
    }
    if (!resultText) continue

    const resultHint = [launch.rocketName, launch.missionName, launch.name].filter(Boolean).join(' ')
    terminals.push({
      launch: launch,
      missionId: missionId,
      resultText: softenResultTextForChineseRocket(resultText, resultHint)
    })
  }

  if (!terminals.length) {
    return { success: true, message: 'no terminal launches', ...stats }
  }
  stats.missions = terminals.length

  for (let ti = 0; ti < terminals.length; ti++) {
    const item = terminals[ti]
    const launch = item.launch
    const missionId = item.missionId
    const resultText = item.resultText

    const launchTime = launch.windowStart || launch.launchTime || ''
    const launchTimeIso = toLaunchIso(launchTime)
    const launchTimeOa = toOaTimeValue(launchTimeIso || launchTime)
    // time20 非法 → 全员 47003；无合法时间则跳过本任务（不再每人打一次微信）
    if (!launchTimeOa) {
      console.warn('[OAResult] skip mission: invalid time20', missionId)
      stats.skipped += users.length
      continue
    }
    const launchTimeFormatted = formatLaunchTimeStr(launchTimeIso || launchTime)
    const disp = resolveOaLaunchDisplay(launch)
    // 项目名称与发射卡对齐（火箭｜任务中文）；thing≤20 由 projectTitle 截断
    const missionName = disp.projectTitle || disp.missionName
    const rocketName = disp.rocketNameZh
    const agencyName = disp.agencyName || '待确认'
    const remark = disp.remark || pickLaunchRemark(launch)
    // thing2「单位名称」= 发射商；character_string 仍用 ASCII
    const resultFieldKeys = getOaResultTemplateFieldKeys()
    const codeId = isThingFieldKey(resultFieldKeys.code)
      ? agencyName
      : pickLaunchCodeId({
          rocketName: disp.rocketNameEn,
          missionName: launch.missionNameEn || launch.nameEn || disp.rocketNameEn
        })
    const pagepath = 'pages/mission-detail/mission-detail?id=' + missionId + '&type=completed'
    const templateData = buildOaResultTemplateData({
      missionName: missionName,
      rocketName: rocketName,
      agencyName: agencyName,
      launchTimeFormatted: launchTimeFormatted,
      launchTimeOa: launchTimeOa,
      resultText: resultText,
      remark: remark,
      codeId: codeId
    })

    const seenOaOpenids = {}
    const openidList = users.map(function (u) { return u && u.oaOpenid }).filter(Boolean)
    const uniqueOpenidCount = new Set(openidList.map(String)).size
    const ledgerDone = await loadOaResultLedgerDoneSet(missionId, openidList)
    // 任务级短路：全员已结案则不再进发送循环（仍付一次批量台账读，远小于 N 次微信 API）
    if (uniqueOpenidCount > 0 && ledgerDone.size >= uniqueOpenidCount) {
      stats.skipped += uniqueOpenidCount
      continue
    }

    for (let ui = 0; ui < users.length; ui++) {
      const user = users[ui]
      const oaOpenid = user.oaOpenid
      if (!oaOpenid) {
        stats.skipped++
        continue
      }
      if (seenOaOpenids[oaOpenid]) {
        stats.skipped++
        continue
      }
      seenOaOpenids[oaOpenid] = true

      if (ledgerDone.has(String(oaOpenid))) {
        stats.skipped++
        continue
      }

      try {
        await sendOaTemplateMessage(oaOpenid, templateId, pagepath, templateData)
        stats.sentOk++
        ledgerDone.add(String(oaOpenid))
        await writeOaPushLedger({
          channel: 'result',
          missionId: missionId,
          oaOpenid: oaOpenid,
          mpOpenid: user.mpOpenid || '',
          missionName: missionName,
          resultText: resultText,
          status: 'ok'
        })
      } catch (sendErr) {
        const ec = sendErr && sendErr.errcode
        const errMsg = sendErr.message || String(sendErr)
        console.error('[OAResult] send fail', missionId + '_' + oaOpenid, errMsg)
        if (ec === 40258) {
          stats.sentOk++
          ledgerDone.add(String(oaOpenid))
          await writeOaPushLedger({
            channel: 'result',
            missionId: missionId,
            oaOpenid: oaOpenid,
            mpOpenid: user.mpOpenid || '',
            missionName: missionName,
            resultText: resultText,
            status: 'ok',
            error: '40258 dedup-as-delivered'
          })
        } else if (isPermanentOaErrcode(ec) || isPermanentOaErrorText(errMsg)) {
          // 日志里大量 43101 user refuse / 47003 time20 invalid：必须结案，否则每个 tick 风暴
          stats.failed++
          ledgerDone.add(String(oaOpenid))
          if (ec === 43101 || /43101|user refuse/i.test(errMsg)) {
            await markOaUserRefused(oaOpenid, errMsg)
          }
          await writeOaPushLedger({
            channel: 'result',
            missionId: missionId,
            oaOpenid: oaOpenid,
            mpOpenid: user.mpOpenid || '',
            missionName: missionName,
            resultText: resultText,
            status: 'final',
            error: errMsg
          })
          if (ec === 47003) {
            for (let uj = ui + 1; uj < users.length; uj++) {
              const u2 = users[uj]
              const oa2 = u2 && u2.oaOpenid
              if (!oa2 || seenOaOpenids[oa2] || ledgerDone.has(String(oa2))) continue
              seenOaOpenids[oa2] = true
              ledgerDone.add(String(oa2))
              stats.skipped++
              await writeOaPushLedger({
                channel: 'result',
                missionId: missionId,
                oaOpenid: oa2,
                mpOpenid: (u2 && u2.mpOpenid) || '',
                missionName: missionName,
                resultText: resultText,
                status: 'final',
                error: '47003 mission-payload-poison: ' + String(errMsg).slice(0, 200)
              })
            }
            break
          }
        } else {
          stats.failed++
          var tStatus = await writeOaTransientFailedLedger({
            channel: 'result',
            missionId: missionId,
            oaOpenid: oaOpenid,
            mpOpenid: user.mpOpenid || '',
            missionName: missionName,
            resultText: resultText,
            error: errMsg
          })
          if (tStatus === 'final') ledgerDone.add(String(oaOpenid))
        }
      }
    }
  }

  return { success: true, message: 'oa result done', ...stats }
}

// ── C 通道：服务号「订阅通知」(bizsend) 约发射前 30 分钟推送 ──
//
// 与旧 B 通道（message/template/send + oa_auto_alert_users）并存、互不干扰。
// 机制区别：订阅通知是「一次性订阅」，用户每点一次「同意」只授予【一次】下发额度，
// 额度由 oaWebhook 在 subscribe_msg_popup_event(accept) 时写入 oa_subscribe_quota。
// 本通道按 remaining>0 的用户发送 bizsend，成功后原子扣减 1 次，并按 missionId+oaOpenid
// 在 oa_push_ledger（channel='subscribe'）去重，避免同任务重复推送。
// 时间窗与 B 共用 findLaunchesInOaNotifyWindow（目标 T-30，最晚不低于 T-12）。
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

/** 批量加载某任务 subscribe 通道已结案的 oaOpenid */
async function loadOaSubscribeLedgerDoneSet(missionId, netKey, oaOpenids) {
  var done = new Set()
  if (!netKey || !oaOpenids || !oaOpenids.length) return done
  var list = []
  var seen = {}
  for (var i = 0; i < oaOpenids.length; i++) {
    var id = oaOpenids[i] && String(oaOpenids[i])
    if (!id || seen[id]) continue
    seen[id] = true
    list.push(id)
  }
  var CHUNK = 20
  for (var c = 0; c < list.length; c += CHUNK) {
    var chunk = list.slice(c, c + CHUNK)
    var res = await db
      .collection(OA_PUSH_LEDGER)
      .where({
        missionId: String(missionId),
        channel: 'subscribe',
        netKey: String(netKey),
        oaOpenid: _.in(chunk)
      })
      .limit(1000)
      .get()
      .catch(function () {
        return { data: [] }
      })
    var rows = res.data || []
    for (var ri = 0; ri < rows.length; ri++) {
      var r = rows[ri]
      if (isOaLedgerSettled(r)) done.add(String(r.oaOpenid))
    }
  }
  return done
}

async function writeOaSubscribeLedger(entry) {
  try {
    var data = {
      channel: 'subscribe',
      missionId: String(entry.missionId || ''),
      oaOpenid: entry.oaOpenid || '',
      templateId: entry.templateId || OA_SUBSCRIBE_TEMPLATE_ID,
      missionName: entry.missionName || '',
      netKey: entry.netKey ? String(entry.netKey) : '',
      status: entry.status || 'ok',
      error: entry.error ? String(entry.error).slice(0, 500) : '',
      sentAt: Date.now()
    }
    if (entry.retryCount != null) data.retryCount = Number(entry.retryCount) || 0
    await db.collection(OA_PUSH_LEDGER).add({ data: data })
  } catch (e) {
    console.warn('[OASub] write ledger fail', e.message || e)
  }
}

/** 构造订阅通知 data：thing 字段≤20 安全截断；time 必须合法 */
function buildOaSubscribeData(opts) {
  var data = {}
  data[OA_SUBSCRIBE_FIELDS.mission] = { value: toOaThingValue(opts.missionName, '未知任务') }
  var timeVal = String(opts.launchTimeOa || '').trim() || toOaTimeValue(opts.launchTimeFormatted)
  data[OA_SUBSCRIBE_FIELDS.time] = { value: timeVal }
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

  // 先查发射窗口（1 次轻量查询，多数 tick 为空直接返回），
  // 再扫额度表——避免每个 tick 都白读最多 200 条 oa_subscribe_quota
  const launches = await findLaunchesInOaNotifyWindow(nowMs)
  if (launches.length === 0) {
    return { success: true, message: 'no launches in notify window', ...stats }
  }

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
  stats.missions = launches.length

  // 已开服务号自动提醒（B）的用户不再走一次性订阅通知（C），避免双推与额度消耗
  var oaReadyForC = await loadOaReadyUserSets()
  var oaReadyOa = oaReadyForC.oaSet

  for (var li = 0; li < launches.length; li++) {
    var launch = launches[li]
    var missionId = String(launch._id || launch.id || '')
    if (!missionId) continue

    if (!shouldSendOaPreLaunchAlert(launch, Date.now())) {
      stats.skipped++
      continue
    }

    var launchTime = launch.windowStart || launch.launchTime || ''
    var launchTimeIso = toLaunchIso(launchTime)
    var launchNetKey = netKeyFromIso(launchTimeIso || launchTime)
    if (!launchNetKey) {
      stats.skipped++
      continue
    }
    var launchTimeOa = toOaTimeValue(launchTimeIso || launchTime)
    if (!launchTimeOa) {
      console.warn('[OASub] skip mission: invalid time', missionId)
      stats.skipped += quotaUsers.length
      continue
    }
    var launchTimeFormatted = formatLaunchTimeStr(launchTimeIso || launchTime)
    var dispC = resolveOaLaunchDisplay(launch)
    var missionName = dispC.missionName
    var rocketName = dispC.rocketNameZh
    var recoveryMethod = launch.recoveryMethod || launch.recovery || '待确认'
    var remark = dispC.remark || pickLaunchRemark(launch)
    var page = 'pages/mission-detail/mission-detail?id=' + missionId + '&type=upcoming'
    var subData = buildOaSubscribeData({
      missionName: missionName,
      rocketName: rocketName,
      launchTimeFormatted: launchTimeFormatted,
      launchTimeOa: launchTimeOa,
      recoveryMethod: recoveryMethod,
      remark: remark
    })

    var openidListC = quotaUsers.map(function (q) { return q && q.oaOpenid }).filter(Boolean)
    // C 通道结案集合：已就绪走 B 的用户也算「无需本通道」，参与全员短路
    var needCOpenids = []
    var needCSeen = {}
    for (var ci = 0; ci < openidListC.length; ci++) {
      var cid = String(openidListC[ci])
      if (!cid || needCSeen[cid] || oaReadyOa.has(cid)) continue
      needCSeen[cid] = true
      needCOpenids.push(cid)
    }
    var ledgerDoneC = await loadOaSubscribeLedgerDoneSet(missionId, launchNetKey, needCOpenids)
    if (needCOpenids.length > 0 && ledgerDoneC.size >= needCOpenids.length) {
      stats.skipped += needCOpenids.length
      continue
    }

    for (var qi = 0; qi < quotaUsers.length; qi++) {
      var quota = quotaUsers[qi]
      var oaOpenid = quota.oaOpenid

      // 进程内已扣到 0 的用户跳过，避免本批多任务超发
      if (Number(quota.remaining) <= 0) {
        stats.quotaExhausted++
        continue
      }

      if (oaReadyOa.has(String(oaOpenid))) {
        stats.skipped++
        continue
      }

      if (ledgerDoneC.has(String(oaOpenid))) {
        stats.skipped++
        continue
      }

      try {
        await sendOaSubscribeMessage(oaOpenid, OA_SUBSCRIBE_TEMPLATE_ID, page, subData)
        stats.sentOk++
        quota.remaining = Number(quota.remaining) - 1
        ledgerDoneC.add(String(oaOpenid))
        await decrementOaSubscribeQuota(quota._id)
        await writeOaSubscribeLedger({
          missionId: missionId,
          oaOpenid: oaOpenid,
          templateId: OA_SUBSCRIBE_TEMPLATE_ID,
          missionName: missionName,
          netKey: launchNetKey,
          status: 'ok'
        })
      } catch (sendErr) {
        stats.failed++
        var ec = sendErr && sendErr.errcode
        var errMsg = sendErr.message || String(sendErr)
        console.error('[OASub] send fail', missionId + '_' + oaOpenid, errMsg)
        // 43101: 用户拒收/未订阅/额度用尽 → 归零，避免反复尝试
        if (ec === 43101) {
          quota.remaining = 0
          await zeroOaSubscribeQuota(quota._id, sendErr.message || '43101')
        }
        if (isPermanentOaErrcode(ec) || isPermanentOaErrorText(errMsg)) {
          ledgerDoneC.add(String(oaOpenid))
          await writeOaSubscribeLedger({
            missionId: missionId,
            oaOpenid: oaOpenid,
            templateId: OA_SUBSCRIBE_TEMPLATE_ID,
            missionName: missionName,
            netKey: launchNetKey,
            status: 'final',
            error: errMsg
          })
          if (ec === 47003) {
            for (var qj = qi + 1; qj < quotaUsers.length; qj++) {
              var q2 = quotaUsers[qj]
              var oa2 = q2 && q2.oaOpenid
              if (!oa2 || ledgerDoneC.has(String(oa2)) || oaReadyOa.has(String(oa2))) continue
              ledgerDoneC.add(String(oa2))
              stats.skipped++
              await writeOaSubscribeLedger({
                missionId: missionId,
                oaOpenid: oa2,
                templateId: OA_SUBSCRIBE_TEMPLATE_ID,
                missionName: missionName,
                netKey: launchNetKey,
                status: 'final',
                error: '47003 mission-payload-poison: ' + String(errMsg).slice(0, 200)
              })
            }
            break
          }
        } else {
          var tStatus = await writeOaTransientFailedLedger({
            channel: 'subscribe',
            missionId: missionId,
            oaOpenid: oaOpenid,
            missionName: missionName,
            netKey: launchNetKey,
            error: errMsg
          })
          if (tStatus === 'final') ledgerDoneC.add(String(oaOpenid))
        }
      }
    }
  }

  return { success: true, message: 'oa subscribe done', ...stats }
}
