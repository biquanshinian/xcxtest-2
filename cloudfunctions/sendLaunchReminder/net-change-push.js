/**
 * NET 改期推送：launch_data.netChangePending → 服务号改期模板（B 通道）。
 * 模板默认：工单处理通知 AUknDNSmaLhK2lN2Kzq0lHbBkaeYSmcAINelxcxc6yA
 *   项目名称 / 原日期 / 新日期 / 处理原因 / 单位名称
 *
 * 打标口径（与首页改期弹窗对齐）：
 * - launch_data 在 NET 提前或延期满 1 分钟时打 netChangePending
 *
 * 范围控制（防刷屏，推送比弹窗更严）：
 * - 仅原时间或新时间落在未来 48h 近窗的任务才推（远期任务例行改期是噪音）
 * - 按用户提醒偏好（型号/场站）过滤接收人，与 T-30 发射前提醒同一套口径
 * - TBD / 粗精度占位新时间不推（新日期不可信，推了误导）
 *
 * A 通道（小程序订阅）不在此发送：一次性订阅额度必须留给新时间的正式 T-30 提醒，
 * 改期对齐由 reconcilePendingSubscriptionsNotifyTimes + 发送前 resolveFreshLaunchMeta 完成。
 */
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const { isNetChangeAnnouncable } = require('./pre-alert-gate.js')

const LAUNCH_DATA_COLLECTION = 'launch_data'
const OA_PUSH_LEDGER = 'oa_push_ledger'
const CHANNEL = 'net_change'
/* SUBSCRIBE_COLLECTION 已移除：A 通道改期不再直接发送（见文件头说明） */
/** 原/新 NET 距 now 在此窗内才向全体就绪用户播报改期 */
const NET_CHANGE_NEAR_WINDOW_MS = 48 * 60 * 60 * 1000

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
        var oldIsoSim = new Date(newMs - 2 * 60 * 60 * 1000).toISOString()
        launches = [
          Object.assign({}, sample, {
            previousNet: oldIsoSim,
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
        '生产全量已开：真实改期满 1 分钟（提前或延期）会打 netChangePending，由 5 分钟定时器推全体服务号就绪用户。假改期模拟已关闭。',
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

  // 偏好过滤：与 T-30 发射前提醒同口径（未配置偏好 = 默认全推）
  var prefsByMp = {}
  if (oaOk && templateId && users.length && typeof ctx.loadReminderPrefsByMpOpenids === 'function') {
    try {
      prefsByMp = await ctx.loadReminderPrefsByMpOpenids(
        users.map(function (u) {
          return u && u.mpOpenid
        })
      )
    } catch (ePrefs) {
      prefsByMp = {}
    }
  }

  var nowScopeMs = Date.now()

  for (var li = 0; li < launches.length; li++) {
    var launch = launches[li]
    var missionId = String(launch._id || launch.id || '')
    if (!missionId) continue
    var newIso = launch.launchTime || ''
    var oldIso = launch.previousNet || ''
    var newTimeOa = ctx.toOaTimeValue(newIso)
    var oldTimeOa = ctx.toOaTimeValue(oldIso) || newTimeOa
    var oldMsReason = oldIso ? new Date(oldIso).getTime() : 0
    var newMsReason = newIso ? new Date(newIso).getTime() : 0
    var changeKind = oldMsReason > 0 && newMsReason > 0 && newMsReason < oldMsReason ? 'advance' : 'delay'
    var reasonText =
      (ctx.getOaNetChangeReasonText && ctx.getOaNetChangeReasonText(changeKind)) ||
      (changeKind === 'advance' ? '发射时间提前' : '发射时间推迟')
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

    // 近窗范围：原时间或新时间在未来 48h 内（原时间已过也算「曾经临近」）；
    // 远期任务的例行改期不播报，只消费掉 pending 标记
    if (!forced) {
      var oldMsScope = oldIso ? new Date(oldIso).getTime() : 0
      var newMsScope = newIso ? new Date(newIso).getTime() : 0
      var nearOld = oldMsScope > 0 && oldMsScope - nowScopeMs <= NET_CHANGE_NEAR_WINDOW_MS
      var nearNew = newMsScope > 0 && newMsScope - nowScopeMs <= NET_CHANGE_NEAR_WINDOW_MS
      if (!nearOld && !nearNew) {
        await clearNetChangePending(missionId, netKey)
        stats.scopeSkipped = (stats.scopeSkipped || 0) + 1
        continue
      }
      // 新时间不可信（TBD/占位精度）：不播报假日期，直接消费 pending——
      // 留着会长期占用每轮 10 个扫描位；之后时间转可信必然伴随新一次 NET 变更，
      // 届时会重新打标并按新 netKey 播报
      if (!isNetChangeAnnouncable(launch)) {
        await clearNetChangePending(missionId, netKey)
        stats.unannouncableSkipped = (stats.unannouncableSkipped || 0) + 1
        continue
      }
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
        // 偏好过滤：只推给关注该型号/场站的用户（与 T-30 提醒同口径；无偏好=全推）
        if (!forced && typeof ctx.launchMatchesReminderPrefs === 'function') {
          var mpKeyNc = user.mpOpenid ? String(user.mpOpenid) : ''
          var userPrefsNc =
            mpKeyNc && Object.prototype.hasOwnProperty.call(prefsByMp, mpKeyNc)
              ? prefsByMp[mpKeyNc]
              : null
          if (!ctx.launchMatchesReminderPrefs(launch, userPrefsNc)) {
            stats.oaPrefSkipped = (stats.oaPrefSkipped || 0) + 1
            continue
          }
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

    // A 通道（小程序订阅）不在此发送改期消息：一次性额度必须留给新时间的正式 T-30 提醒。
    // 未发订阅的时点对齐由 reconcilePendingSubscriptionsNotifyTimes（每 tick，12h 视界）
    // 与 sendPendingReminders 发送前 resolveFreshLaunchMeta 双重保障，无需在此烧额度。
    stats.mpRealign = 'delegated_to_reconcile'

    if (!forced) await clearNetChangePending(missionId, netKey)
  }

  return { success: true, message: 'net change push done', ...stats }
}

module.exports = { sendNetChangeAlerts, CHANNEL }
