/**
 * NET 改期推送：launch_data.netChangePending → 服务号改期模板（B）+ 未发提醒的小程序订阅（A）。
 * 模板默认：工单处理通知 AUknDNSmaLhK2lN2Kzq0lHbBkaeYSmcAINelxcxc6yA
 *   项目名称 / 原日期 / 新日期 / 处理原因 / 单位名称
 */
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const LAUNCH_DATA_COLLECTION = 'launch_data'
const SUBSCRIBE_COLLECTION = 'launch_subscriptions'
const OA_PUSH_LEDGER = 'oa_push_ledger'
const CHANNEL = 'net_change'

function toOaThingValue(ctx, value, fallback) {
  if (typeof ctx.toOaThingValue === 'function') return ctx.toOaThingValue(value, fallback)
  var s = String(value == null ? '' : value).trim() || String(fallback || '')
  return s.substring(0, 20)
}

async function loadChannelLedgerDoneSet(missionId, netKey, oaOpenids) {
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
  for (var c = 0; c < list.length; c += 20) {
    var chunk = list.slice(c, c + 20)
    var res = await db
      .collection(OA_PUSH_LEDGER)
      .where({
        missionId: String(missionId),
        netKey: String(netKey),
        channel: CHANNEL,
        oaOpenid: _.in(chunk)
      })
      .limit(200)
      .get()
      .catch(function () {
        return { data: [] }
      })
    var rows = res.data || []
    for (var ri = 0; ri < rows.length; ri++) {
      var r = rows[ri]
      if (r && (r.status === 'ok' || r.status === 'final')) done.add(String(r.oaOpenid))
    }
  }
  return done
}

async function clearNetChangePending(docId, netKey) {
  try {
    await db
      .collection(LAUNCH_DATA_COLLECTION)
      .doc(docId)
      .update({
        data: {
          netChangePending: false,
          lastNetChangePushedKey: String(netKey || ''),
          updatedAt: Date.now()
        }
      })
  } catch (e) {}
}

/**
 * @param {object} ctx 由 sendLaunchReminder 注入的发送工具
 */
async function sendNetChangeAlerts(ctx) {
  var stats = {
    missions: 0,
    oaSent: 0,
    oaFailed: 0,
    oaSkipped: 0,
    mpSent: 0,
    mpFailed: 0,
    mpSkipped: 0,
    templateId: '',
    fieldKeys: null,
    sampleData: null,
    failures: [],
    mode: 'production'
  }
  var pushOn =
    !ctx ||
    typeof ctx.isNetChangePushEnabled !== 'function' ||
    ctx.isNetChangePushEnabled()
  if (!pushOn) {
    return {
      success: true,
      skipped: true,
      reason: 'net_change_push_disabled',
      tip: 'NET_CHANGE_PUSH_ENABLED=0；生产全量请设为 1',
      ...stats
    }
  }
  var oaOk = !!(ctx && ctx.isOaNetChangeDeliverable && ctx.isOaNetChangeDeliverable())
  var templateId =
    oaOk && ctx.getOaNetChangeTemplateId ? String(ctx.getOaNetChangeTemplateId() || '').trim() : ''
  stats.templateId = templateId

  var nowMs = Date.now()
  var pendingRes
  try {
    pendingRes = await db
      .collection(LAUNCH_DATA_COLLECTION)
      .where({
        netChangePending: true,
        windowStart: _.gt(new Date(nowMs))
      })
      .limit(10)
      .get()
  } catch (e) {
    return { success: false, error: e.message || String(e), ...stats }
  }
  var launches = (pendingRes && pendingRes.data) || []
  var forced = false
  var forceSimOk =
    ctx &&
    typeof ctx.isNetChangeForceSimAllowed === 'function' &&
    ctx.isNetChangeForceSimAllowed()
  // 仅 NET_CHANGE_FORCE_SIM=1 时允许伪造改期（生产默认关）
  if (!launches.length && ctx && ctx.forceNetChange && forceSimOk) {
    stats.mode = 'force_sim'
    try {
      var upRes = await db
        .collection(LAUNCH_DATA_COLLECTION)
        .where({ windowStart: _.gt(new Date(nowMs)) })
        .limit(5)
        .get()
      var rows = upRes.data || []
      rows.sort(function (a, b) {
        var am = a && a.windowStart ? new Date(a.windowStart).getTime() : 0
        var bm = b && b.windowStart ? new Date(b.windowStart).getTime() : 0
        return am - bm
      })
      var sample = rows[0]
      if (sample && sample.launchTime) {
        var newMs = new Date(sample.launchTime).getTime()
        var oldIso = new Date(newMs - 2 * 60 * 60 * 1000).toISOString()
        launches = [
          Object.assign({}, sample, {
            previousNet: oldIso,
            netChangePending: true,
            lastNetChangePushedKey: ''
          })
        ]
        forced = true
        stats.forced = true
        stats.forceMissionId = String(sample._id || sample.id || '')
      }
    } catch (forceErr) {
      return {
        success: false,
        message: 'force sample query fail',
        error: forceErr.message || String(forceErr),
        tip: 'launch_data 需有 windowStart 升序索引；或先跑一次 sendPending 同步',
        ...stats
      }
    }
  }
  if (!launches.length) {
    return {
      success: true,
      message: 'no pending net changes',
      tip:
        '生产全量已开：真实推迟≥30min 会打 netChangePending，由 5 分钟定时器推全体服务号就绪用户。假改期模拟已关闭。',
      forceSim: false,
      ...stats
    }
  }

  var users = []
  var fieldKeys = null
  if (oaOk && templateId) {
    users = await ctx.loadOaEnabledUsers()
    users = (users || []).filter(function (u) {
      return u && u.oaOpenid && !ctx.isOaUserMsgRefused(u)
    })
    users = typeof ctx.dedupeOaUsersByOpenid === 'function' ? ctx.dedupeOaUsersByOpenid(users) : users
    var onlyId = ctx.onlyOaOpenid ? String(ctx.onlyOaOpenid).trim() : ''
    if (onlyId) {
      users = users.filter(function (u) {
        return String(u.oaOpenid) === onlyId || String(u.mpOpenid || '') === onlyId
      })
      if (!users.length) users = [{ oaOpenid: onlyId, mpOpenid: '', _direct: true }]
    }
    fieldKeys = await ctx.resolveOaNetChangeTemplateFieldKeys(templateId)
    stats.fieldKeys = fieldKeys
    if (!fieldKeys || !fieldKeys.mission || !fieldKeys.newDate) {
      return {
        success: false,
        reason: 'net_change_fields_unresolved',
        tip: '请确认模板已添加，或配置 WECHAT_OA_NET_CHANGE_FIELD_* 环境变量',
        ...stats
      }
    }
  }

  var oaReadyMp = new Set()
  try {
    var ready = ctx.gateOaReadySets(await ctx.loadOaReadyUserSets(), oaOk)
    oaReadyMp = ready.mpSet || new Set()
  } catch (e) {}

  var reasonText =
    (ctx.getOaNetChangeReasonText && ctx.getOaNetChangeReasonText()) || '发射时间推迟'

  for (var li = 0; li < launches.length; li++) {
    var launch = launches[li]
    var missionId = String(launch._id || launch.id || '')
    if (!missionId) continue
    var newIso = launch.launchTime || ''
    var oldIso = launch.previousNet || ''
    var newTimeOa = ctx.toOaTimeValue(newIso)
    var oldTimeOa = ctx.toOaTimeValue(oldIso) || newTimeOa
    if (!newTimeOa) {
      await clearNetChangePending(missionId, '')
      stats.oaSkipped++
      continue
    }
    var netKey = ctx.netKeyFromIso(newIso) || 'netchg'
    if (forced) netKey = 'test_' + netKey + '_' + Date.now()
    if (
      !forced &&
      launch.lastNetChangePushedKey &&
      String(launch.lastNetChangePushedKey) === String(netKey)
    ) {
      await clearNetChangePending(missionId, netKey)
      continue
    }

    stats.missions++
    var disp = ctx.resolveOaLaunchDisplay(launch)
    var projectTitle = disp.projectTitle || disp.missionName
    var missionLabel = toOaThingValue(ctx, projectTitle, '未知任务')
    var pagepath = 'pages/mission-detail/mission-detail?id=' + missionId + '&type=upcoming'

    if (oaOk && templateId && fieldKeys && users.length) {
      var templateData = ctx.buildOaNetChangeTemplateData({
        missionName: missionLabel,
        oldTimeOa: oldTimeOa,
        newTimeOa: newTimeOa,
        reasonText: reasonText,
        agencyName: disp.agencyName || '待确认',
        fieldKeys: fieldKeys
      })
      if (!stats.sampleData) {
        stats.sampleData = templateData
        stats.reasonText = reasonText
      }

      var openidList = users.map(function (u) {
        return u.oaOpenid
      })
      var ledgerDone = await loadChannelLedgerDoneSet(missionId, netKey, openidList)
      var seen = {}

      for (var ui = 0; ui < users.length; ui++) {
        var user = users[ui]
        var oaOpenid = user.oaOpenid
        if (!oaOpenid || seen[oaOpenid]) {
          stats.oaSkipped++
          continue
        }
        seen[oaOpenid] = true
        if (ledgerDone.has(String(oaOpenid))) {
          stats.oaSkipped++
          continue
        }
        try {
          await ctx.sendOaTemplateMessage(oaOpenid, templateId, pagepath, templateData)
          stats.oaSent++
          ledgerDone.add(String(oaOpenid))
          await ctx.writeOaPushLedger({
            channel: CHANNEL,
            missionId: missionId,
            oaOpenid: oaOpenid,
            mpOpenid: user.mpOpenid || '',
            missionName: projectTitle,
            netKey: netKey,
            status: 'ok',
            error: 'net_change'
          })
        } catch (sendErr) {
          var ec = sendErr && sendErr.errcode
          var errMsg = (sendErr && sendErr.message) || String(sendErr)
          if (ec === 40258) {
            stats.oaSent++
            await ctx.writeOaPushLedger({
              channel: CHANNEL,
              missionId: missionId,
              oaOpenid: oaOpenid,
              mpOpenid: user.mpOpenid || '',
              missionName: projectTitle,
              netKey: netKey,
              status: 'ok',
              error: '40258 net_change'
            })
          } else {
            stats.oaFailed++
            if (stats.failures.length < 5) {
              stats.failures.push({
                errcode: ec || null,
                error: String(errMsg).slice(0, 400),
                tip:
                  ec === 47003
                    ? '多为日期格式或「处理原因」枚举不匹配：枚举须含「发射时间推迟」；日期槽用 yyyy-MM-dd'
                    : ''
              })
            }
            await ctx.writeOaPushLedger({
              channel: CHANNEL,
              missionId: missionId,
              oaOpenid: oaOpenid,
              mpOpenid: user.mpOpenid || '',
              missionName: projectTitle,
              netKey: netKey,
              status: ctx.isPermanentOaErrcode(ec) ? 'final' : 'failed',
              error: errMsg
            })
          }
        }
      }
    }

    // A：仅非 OA 就绪、尚未发出射前提醒的订阅
    try {
      var subRes = await db
        .collection(SUBSCRIBE_COLLECTION)
        .where({ missionId: missionId, sent: false })
        .limit(50)
        .get()
      var subs = subRes.data || []
      for (var si = 0; si < subs.length; si++) {
        var rec = subs[si]
        if (!rec || !rec._openid) {
          stats.mpSkipped++
          continue
        }
        if (oaReadyMp.has(String(rec._openid))) {
          stats.mpSkipped++
          continue
        }
        try {
          await ctx.sendSubscribeMessageByHttp(rec._openid, ctx.TEMPLATE_ID, '/pages/index/index', {
            thing1: { value: toOaThingValue(ctx, missionLabel, '发射改期') },
            time2: { value: newTimeOa },
            thing3: { value: toOaThingValue(ctx, disp.rocketNameZh, '未知火箭') },
            thing4: { value: '时间已改期' }
          })
          stats.mpSent++
          await ctx.markReminderDone(rec._id, { keepForResult: Number(rec.resultQuota) > 0 })
        } catch (mpErr) {
          stats.mpFailed++
        }
      }
    } catch (subErr) {
      console.warn('[NetChange] A channel fail', subErr.message || subErr)
    }

    if (!forced) await clearNetChangePending(missionId, netKey)
  }

  return { success: true, message: 'net change push done', ...stats }
}

module.exports = { sendNetChangeAlerts, CHANNEL }
