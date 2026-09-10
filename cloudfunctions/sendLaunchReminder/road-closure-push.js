/**
 * 星舰基地封路状态变化 → 服务号模板推送（B）。
 * 对比 road_closure_notice/starbase_gov_live 与 _push_state 指纹。
 */
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const ROAD_COLLECTION = 'road_closure_notice'
const LIVE_DOC_ID = 'starbase_gov_live'
const STATE_DOC_ID = '_push_state'
const OA_PUSH_LEDGER = 'oa_push_ledger'
const CHANNEL = 'road_closure'
/** 边沿去抖：同一类事件最短间隔 */
const EDGE_COOLDOWN_MS = 30 * 60 * 1000

function buildFingerprint(doc) {
  if (!doc) return 'none'
  var active = !!doc.isActive
  var startAt = Number(doc.startAt) || 0
  var endAt = Number(doc.endAt) || 0
  var range = String(doc.timeRange || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
  var delays = ''
  try {
    delays = JSON.stringify(doc.roadDelays || [])
      .replace(/\s+/g, '')
      .slice(0, 120)
  } catch (e) {
    delays = ''
  }
  return [active ? '1' : '0', startAt, endAt, range, delays].join('|')
}

function classifyEdge(prevActive, nextActive, prevFp, nextFp) {
  if (!prevFp && nextActive) return 'started'
  if (prevActive && !nextActive) return 'cleared'
  if (nextActive && prevFp && nextFp && prevFp !== nextFp) return 'updated'
  if (!prevActive && nextActive) return 'started'
  return ''
}

function eventCopy(kind, live) {
  if (kind === 'cleared') {
    return {
      missionName: '星舰封路已解除',
      remark: '道路现已开放',
      resultHint: '已解除'
    }
  }
  if (kind === 'updated') {
    return {
      missionName: '星舰封路时段更新',
      remark: String(live.timeRange || '时段有变').substring(0, 20),
      resultHint: '已更新'
    }
  }
  return {
    missionName: '星舰基地道路封闭',
    remark: String(live.timeRange || '道路封闭中').substring(0, 20),
    resultHint: '封闭中'
  }
}

async function readLiveDoc() {
  try {
    var res = await db.collection(ROAD_COLLECTION).doc(LIVE_DOC_ID).get()
    return (res && res.data) || null
  } catch (e) {
    return null
  }
}

async function readPushState() {
  try {
    var res = await db.collection(ROAD_COLLECTION).doc(STATE_DOC_ID).get()
    return (res && res.data) || null
  } catch (e) {
    return null
  }
}

async function writePushState(state) {
  try {
    await db.collection(ROAD_COLLECTION).doc(STATE_DOC_ID).set({
      data: Object.assign({}, state, { updatedAt: Date.now() })
    })
  } catch (e) {
    console.warn('[RoadClosure] write state fail', e.message || e)
  }
}

async function loadRoadClosureDenyMpSet() {
  var deny = new Set()
  try {
    var res = await db
      .collection('user_profile')
      .where({ 'preferences.roadClosureAlert': false })
      .field({ openid: true, _openid: true })
      .limit(100)
      .get()
    var rows = (res && res.data) || []
    for (var i = 0; i < rows.length; i++) {
      var o = rows[i].openid || rows[i]._openid || rows[i]._id
      if (o) deny.add(String(o))
    }
  } catch (e) {}
  return deny
}

async function loadLedgerDoneForKey(netKey, oaOpenids) {
  var done = new Set()
  if (!netKey || !oaOpenids.length) return done
  for (var c = 0; c < oaOpenids.length; c += 20) {
    var chunk = oaOpenids.slice(c, c + 20)
    var res = await db
      .collection(OA_PUSH_LEDGER)
      .where({
        missionId: 'road_closure',
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
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i]
      if (r && (r.status === 'ok' || r.status === 'final')) done.add(String(r.oaOpenid))
    }
  }
  return done
}

/**
 * @param {object} ctx sendLaunchReminder 注入
 */
async function sendRoadClosureAlerts(ctx) {
  var stats = { event: '', sentOk: 0, failed: 0, skipped: 0 }
  if (!ctx || !ctx.isOaPreLaunchDeliverable || !ctx.isOaPreLaunchDeliverable()) {
    return { success: true, skipped: true, reason: 'oa_not_configured', ...stats }
  }
  var templateId = ctx.getOaTemplateId && ctx.getOaTemplateId()
  if (!templateId) {
    return { success: true, skipped: true, reason: 'no_template', ...stats }
  }

  var live = await readLiveDoc()
  if (!live) {
    return { success: true, message: 'no road closure doc', ...stats }
  }

  var nextFp = buildFingerprint(live)
  var nextActive = !!live.isActive
  var prev = await readPushState()
  var prevFp = (prev && prev.fingerprint) || ''
  var prevActive = !!(prev && prev.isActive)
  var lastAt = Number(prev && prev.lastPushedAt) || 0
  var nowMs = Date.now()

  var forceKind = ctx.forceRoadClosureEvent
    ? String(ctx.forceRoadClosureEvent)
    : ''
  if (forceKind && forceKind !== 'started' && forceKind !== 'cleared' && forceKind !== 'updated') {
    forceKind = nextActive ? 'started' : 'cleared'
  }

  // 首次见到文档：只记指纹，不推（避免历史状态刷屏）
  if (!prevFp && !forceKind) {
    await writePushState({
      fingerprint: nextFp,
      isActive: nextActive,
      lastEvent: 'baseline',
      lastPushedAt: 0
    })
    return { success: true, message: 'baseline recorded', ...stats }
  }

  if (!forceKind && prevFp === nextFp) {
    return { success: true, message: 'no road closure change', ...stats }
  }

  var kind = forceKind || classifyEdge(prevActive, nextActive, prevFp, nextFp)
  if (!kind) {
    await writePushState({
      fingerprint: nextFp,
      isActive: nextActive,
      lastEvent: 'ignored',
      lastPushedAt: lastAt
    })
    return { success: true, message: 'change ignored', ...stats }
  }

  if (!forceKind && lastAt && nowMs - lastAt < EDGE_COOLDOWN_MS && kind === 'updated') {
    // 时段微调冷却：仍更新指纹，避免反复推
    await writePushState({
      fingerprint: nextFp,
      isActive: nextActive,
      lastEvent: 'cooldown_skip',
      lastPushedAt: lastAt
    })
    return { success: true, message: 'edge cooldown', ...stats }
  }

  stats.event = kind
  var copy = eventCopy(kind, live)
  var timeSrc =
    kind === 'cleared'
      ? nowMs
      : Number(live.startAt) > 0
        ? Number(live.startAt)
        : nowMs
  var launchTimeOa = ctx.toOaTimeValue(new Date(timeSrc).toISOString())
  if (!launchTimeOa) {
    await writePushState({
      fingerprint: nextFp,
      isActive: nextActive,
      lastEvent: 'bad_time',
      lastPushedAt: lastAt
    })
    return { success: false, reason: 'invalid time', ...stats }
  }

  var netKey = kind + '_' + nextFp.slice(0, 48)
  var users = await ctx.loadOaEnabledUsers()
  users = (users || []).filter(function (u) {
    return u && u.oaOpenid && !ctx.isOaUserMsgRefused(u)
  })
  users = typeof ctx.dedupeOaUsersByOpenid === 'function' ? ctx.dedupeOaUsersByOpenid(users) : users

  // 测推指定人：oaOpenid 或小程序 openid（mpOpenid）
  var onlyId = ctx.onlyOaOpenid ? String(ctx.onlyOaOpenid).trim() : ''
  if (onlyId) {
    users = users.filter(function (u) {
      return String(u.oaOpenid) === onlyId || String(u.mpOpenid || '') === onlyId
    })
    if (!users.length) {
      users = [{ oaOpenid: onlyId, mpOpenid: '', _direct: true }]
    }
  }

  var denyMp = await loadRoadClosureDenyMpSet()
  if (denyMp.size && !onlyId) {
    users = users.filter(function (u) {
      if (!u.mpOpenid) return true
      return !denyMp.has(String(u.mpOpenid))
    })
  }

  var fieldKeys = await ctx.resolveOaTemplateFieldKeys(templateId)
  var pagepath = 'pages/progress/progress'
  var templateData = ctx.buildOaTemplateData({
    missionName: copy.missionName,
    rocketName: '星舰',
    agencyName: 'SpaceX',
    launchTimeFormatted: ctx.formatLaunchTimeStr(new Date(timeSrc).toISOString()),
    launchTimeOa: launchTimeOa,
    recoveryMethod: copy.resultHint,
    remark: copy.remark,
    codeId: 'Starship',
    fieldKeys: fieldKeys
  })

  var openids = users.map(function (u) {
    return u.oaOpenid
  })
  var ledgerDone = await loadLedgerDoneForKey(netKey, openids)
  var seen = {}

  for (var i = 0; i < users.length; i++) {
    var user = users[i]
    var oaOpenid = user.oaOpenid
    if (!oaOpenid || seen[oaOpenid]) {
      stats.skipped++
      continue
    }
    seen[oaOpenid] = true
    if (ledgerDone.has(String(oaOpenid))) {
      stats.skipped++
      continue
    }
    try {
      await ctx.sendOaTemplateMessage(oaOpenid, templateId, pagepath, templateData)
      stats.sentOk++
      await ctx.writeOaPushLedger({
        channel: CHANNEL,
        missionId: 'road_closure',
        oaOpenid: oaOpenid,
        mpOpenid: user.mpOpenid || '',
        missionName: copy.missionName,
        netKey: netKey,
        status: 'ok',
        error: 'road_closure:' + kind
      })
    } catch (sendErr) {
      var ec = sendErr && sendErr.errcode
      var errMsg = (sendErr && sendErr.message) || String(sendErr)
      if (ec === 40258) {
        stats.sentOk++
        await ctx.writeOaPushLedger({
          channel: CHANNEL,
          missionId: 'road_closure',
          oaOpenid: oaOpenid,
          mpOpenid: user.mpOpenid || '',
          missionName: copy.missionName,
          netKey: netKey,
          status: 'ok',
          error: '40258 road_closure'
        })
      } else {
        stats.failed++
        await ctx.writeOaPushLedger({
          channel: CHANNEL,
          missionId: 'road_closure',
          oaOpenid: oaOpenid,
          mpOpenid: user.mpOpenid || '',
          missionName: copy.missionName,
          netKey: netKey,
          status: ctx.isPermanentOaErrcode && ctx.isPermanentOaErrcode(ec) ? 'final' : 'failed',
          error: errMsg
        })
      }
    }
  }

  await writePushState({
    fingerprint: nextFp,
    isActive: nextActive,
    lastEvent: kind,
    lastPushedAt: nowMs
  })

  return { success: true, message: 'road closure push done', ...stats }
}

module.exports = { sendRoadClosureAlerts, buildFingerprint, CHANNEL }
