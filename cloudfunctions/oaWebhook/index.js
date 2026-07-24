/**
 * 微信服务号「火星探索日志」服务器配置回调
 * 处理：URL 验证、关注 subscribe、取消关注 unsubscribe
 *
 * 环境变量：
 * - WECHAT_OA_TOKEN                   服务器配置 Token（必填）
 * - WECHAT_OA_APPID                   服务号 AppID
 * - WECHAT_OA_SECRET                  服务号 AppSecret
 * - WECHAT_OA_AES_KEY                 消息加解密密钥（可选；未配置则明文模式）
 * - WECHAT_OA_SUBSCRIBE_TEMPLATE_ID   订阅通知模板 ID（可选；默认值见下方常量）
 *
 * 本回调除关注/取消/菜单外，还处理服务号「订阅通知」三类事件推送：
 * - subscribe_msg_popup_event   用户在 H5/图文点「同意/取消」订阅弹窗 → accept 给该 openid +1 次可发额度
 * - subscribe_msg_change_event  用户在服务通知管理页拒收 → 把剩余额度置 0
 * - subscribe_msg_sent_event    bizsend 异步推送回执 → 落 push_history
 * 额度记于 oa_subscribe_quota 集合，按 openid+templateId 计数；T-30min 发送在 sendLaunchReminder。
 *
 * 旧 B 通道模板消息（message/template/send）由 sendLaunchReminder 发送，模板 ID 与字段映射见该云函数
 * 环境变量 WECHAT_OA_TEMPLATE_ID、WECHAT_OA_TMPL_FIELD_*。
 */
const cloud = require('wx-server-sdk')
const crypto = require('crypto')
const axios = require('axios')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const OA_USERS_COLLECTION = 'oa_auto_alert_users'
const OA_SUBSCRIBE_QUOTA_COLLECTION = 'oa_subscribe_quota'
const PUSH_HISTORY_COLLECTION = 'push_history'

// 订阅通知模板 ID：一次性订阅「火箭发射任务提醒」
// 字段 thing1=任务名称 time2=发射时间 thing3=运载火箭 thing4=回收方式 thing5=备注
const OA_SUBSCRIBE_TEMPLATE_ID = String(
  process.env.WECHAT_OA_SUBSCRIBE_TEMPLATE_ID || '2-gxvjtGT-SziFYlnMy-JJ8P9Zp7bAxBE1Xp0RXy_Vs'
).trim()

let _collectionsEnsured = false
async function ensureCollectionsOnce() {
  if (_collectionsEnsured) return
  _collectionsEnsured = true
  for (const name of [OA_USERS_COLLECTION, OA_SUBSCRIBE_QUOTA_COLLECTION, PUSH_HISTORY_COLLECTION]) {
    try {
      await db.createCollection(name)
    } catch (e) {}
  }
}

function getOaToken() {
  return String(process.env.WECHAT_OA_TOKEN || '').trim()
}

function sha1(str) {
  return crypto.createHash('sha1').update(str).digest('hex')
}

function verifySignature(token, timestamp, nonce, signature) {
  if (!token || !signature) return false
  const arr = [token, String(timestamp || ''), String(nonce || '')].sort()
  return sha1(arr.join('')) === signature
}

function pickXmlTag(xml, tag) {
  if (!xml || !tag) return ''
  const cdata = new RegExp('<' + tag + '><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></' + tag + '>', 'i')
  const plain = new RegExp('<' + tag + '>([\\s\\S]*?)</' + tag + '>', 'i')
  const m = xml.match(cdata) || xml.match(plain)
  return m ? String(m[1]).trim() : ''
}

function buildTextReply(toUser, fromUser, content) {
  const ts = Math.floor(Date.now() / 1000)
  return (
    '<xml>' +
    '<ToUserName><![CDATA[' + toUser + ']]></ToUserName>' +
    '<FromUserName><![CDATA[' + fromUser + ']]></FromUserName>' +
    '<CreateTime>' + ts + '</CreateTime>' +
    '<MsgType><![CDATA[text]]></MsgType>' +
    '<Content><![CDATA[' + content + ']]></Content>' +
    '</xml>'
  )
}

function getOaCredentials() {
  const appid = String(process.env.WECHAT_OA_APPID || '').trim()
  const secret = String(process.env.WECHAT_OA_SECRET || '').trim()
  if (!appid || !secret) return null
  return { appid, secret }
}

function getOaAesKey() {
  return String(process.env.WECHAT_OA_AES_KEY || '').trim()
}

function verifyMsgSignature(token, timestamp, nonce, encrypt, msgSignature) {
  if (!token || !msgSignature || !encrypt) return false
  const arr = [token, String(timestamp || ''), String(nonce || ''), String(encrypt || '')].sort()
  return sha1(arr.join('')) === msgSignature
}

function pkcs7Unpad(buf) {
  if (!buf || !buf.length) throw new Error('empty decrypt buffer')
  const pad = buf[buf.length - 1]
  if (pad < 1 || pad > 32) throw new Error('invalid pkcs7 padding')
  return buf.slice(0, buf.length - pad)
}

function decryptOaEncrypt(encrypt, encodingAESKey, appId) {
  const aesKey = Buffer.from(String(encodingAESKey || '') + '=', 'base64')
  if (aesKey.length !== 32) throw new Error('invalid WECHAT_OA_AES_KEY')
  const iv = aesKey.slice(0, 16)
  const decipher = crypto.createDecipheriv('aes-256-cbc', aesKey, iv)
  decipher.setAutoPadding(false)
  const decoded = pkcs7Unpad(
    Buffer.concat([decipher.update(Buffer.from(String(encrypt || ''), 'base64')), decipher.final()])
  )
  const content = decoded.slice(16)
  const msgLen = content.readUInt32BE(0)
  const xml = content.slice(4, 4 + msgLen).toString('utf8')
  const receivedAppId = content.slice(4 + msgLen).toString('utf8')
  if (appId && receivedAppId !== appId) throw new Error('decrypted appid mismatch')
  return xml
}

function resolveIncomingXml(rawXml, query, token) {
  const xml = String(rawXml || '')
  const encrypt = pickXmlTag(xml, 'Encrypt')
  if (!encrypt) return xml

  const aesKey = getOaAesKey()
  if (!aesKey) {
    console.error('[oaWebhook] 收到加密消息但未配置 WECHAT_OA_AES_KEY')
    return xml
  }

  const msgSignature = query.msg_signature || ''
  const timestamp = query.timestamp || ''
  const nonce = query.nonce || ''
  if (!verifyMsgSignature(token, timestamp, nonce, encrypt, msgSignature)) {
    throw new Error('invalid msg_signature')
  }

  const cred = getOaCredentials()
  return decryptOaEncrypt(encrypt, aesKey, cred ? cred.appid : '')
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

async function fetchOaUserUnionid(oaOpenid) {
  if (!oaOpenid) return ''
  try {
    const token = await getOaAccessToken()
    const url =
      'https://api.weixin.qq.com/cgi-bin/user/info?access_token=' +
      encodeURIComponent(token) +
      '&openid=' +
      encodeURIComponent(oaOpenid) +
      '&lang=zh_CN'
    const res = await axios.get(url)
    if (res.data && res.data.unionid) return String(res.data.unionid)
  } catch (e) {
    console.warn('[oaWebhook] fetch unionid fail', oaOpenid, e.message || e)
  }
  return ''
}

async function upsertOaUserByOpenid(oaOpenid, patch) {
  if (!oaOpenid) return
  const now = Date.now()
  const existing = await db
    .collection(OA_USERS_COLLECTION)
    .where({ oaOpenid: oaOpenid })
    .limit(1)
    .get()
    .catch(() => ({ data: [] }))

  if (existing.data && existing.data.length > 0) {
    await db.collection(OA_USERS_COLLECTION).doc(existing.data[0]._id).update({
      data: Object.assign({}, patch, { updatedAt: now })
    })
    return existing.data[0]._id
  }

  const addRes = await db.collection(OA_USERS_COLLECTION).add({
    data: Object.assign(
      {
        oaOpenid: oaOpenid,
        mpOpenid: '',
        unionid: '',
        enabled: false,
        followed: false,
        createdAt: now
      },
      patch,
      { updatedAt: now }
    )
  })
  return addRes._id
}

async function upsertOaUserByUnionid(unionid, patch) {
  if (!unionid) return null
  const now = Date.now()
  const existing = await db
    .collection(OA_USERS_COLLECTION)
    .where({ unionid: unionid })
    .limit(1)
    .get()
    .catch(() => ({ data: [] }))

  if (existing.data && existing.data.length > 0) {
    await db.collection(OA_USERS_COLLECTION).doc(existing.data[0]._id).update({
      data: Object.assign({}, patch, { unionid: unionid, updatedAt: now })
    })
    return existing.data[0]._id
  }

  if (patch.oaOpenid) {
    const orphan = await db
      .collection(OA_USERS_COLLECTION)
      .where({ oaOpenid: patch.oaOpenid })
      .limit(1)
      .get()
      .catch(() => ({ data: [] }))
    if (orphan.data && orphan.data.length > 0) {
      await db.collection(OA_USERS_COLLECTION).doc(orphan.data[0]._id).update({
        data: Object.assign({}, patch, { unionid: unionid, updatedAt: now })
      })
      return orphan.data[0]._id
    }
  }

  const addRes = await db.collection(OA_USERS_COLLECTION).add({
    data: Object.assign(
      {
        oaOpenid: patch.oaOpenid || '',
        mpOpenid: patch.mpOpenid || '',
        unionid: unionid,
        enabled: false,
        followed: false,
        createdAt: now
      },
      patch,
      { updatedAt: now }
    )
  })
  return addRes._id
}

async function handleSubscribe(oaOpenid) {
  const unionid = await fetchOaUserUnionid(oaOpenid)
  const patch = {
    oaOpenid: oaOpenid,
    followed: true,
    subscribedAt: Date.now()
  }
  if (unionid) {
    await upsertOaUserByUnionid(unionid, patch)
  } else {
    await upsertOaUserByOpenid(oaOpenid, patch)
  }
}

async function handleUnsubscribe(oaOpenid) {
  const now = Date.now()
  const existing = await db
    .collection(OA_USERS_COLLECTION)
    .where({ oaOpenid: oaOpenid })
    .limit(1)
    .get()
    .catch(() => ({ data: [] }))
  if (!existing.data || !existing.data.length) return
  await db.collection(OA_USERS_COLLECTION).doc(existing.data[0]._id).update({
    data: {
      followed: false,
      enabled: false,
      unsubscribedAt: now,
      updatedAt: now
    }
  })
}

async function findOaAlertUserForEnable(oaOpenid, unionid) {
  if (unionid) {
    const byUnion = await db
      .collection(OA_USERS_COLLECTION)
      .where({ unionid: unionid })
      .limit(1)
      .get()
      .catch(() => ({ data: [] }))
    if (byUnion.data && byUnion.data.length) return byUnion.data[0]
  }
  if (oaOpenid) {
    const byOa = await db
      .collection(OA_USERS_COLLECTION)
      .where({ oaOpenid: oaOpenid })
      .limit(1)
      .get()
      .catch(() => ({ data: [] }))
    if (byOa.data && byOa.data.length) return byOa.data[0]
  }
  return null
}

/** 菜单「开启提醒」：与 adminGateway enableOaAlert 同条件，需 unionid + followed + oaOpenid */
async function handleEnableAlert(oaOpenid) {
  if (!oaOpenid) {
    return { ok: false, message: '无法识别您的身份，请稍后重试。' }
  }

  const unionid = await fetchOaUserUnionid(oaOpenid)
  if (!unionid) {
    return {
      ok: false,
      message:
        '开启失败：需先将小程序绑定微信开放平台，并至少打开过一次小程序后再试。\n\n' +
        '若已绑定仍失败，请取消关注后重新关注，或稍后再试。'
    }
  }

  const nowTs = Date.now()
  const existing = await findOaAlertUserForEnable(oaOpenid, unionid)
  const patch = {
    oaOpenid: oaOpenid,
    unionid: unionid,
    enabled: true,
    followed: true,
    enabledAt: nowTs,
    updatedAt: nowTs
  }

  if (existing) {
    if (existing.enabled && existing.followed && existing.oaOpenid) {
      return {
        ok: true,
        message:
          '您已开启发射提醒，无需重复操作。\n\n' +
          '任务发射前约30分钟及完成后结果，将收到服务号模板消息通知。'
      }
    }
    await db.collection(OA_USERS_COLLECTION).doc(existing._id).update({ data: patch })
  } else {
    await db.collection(OA_USERS_COLLECTION).add({
      data: Object.assign(
        {
          mpOpenid: '',
          createdAt: nowTs
        },
        patch
      )
    })
  }

  return {
    ok: true,
    message:
      '已成功开启发射提醒！\n\n' +
      '任务发射前约30分钟及完成后结果，您将收到服务号模板消息通知。\n\n' +
      '如需关闭，可在小程序「我的太空 → 服务号提醒」中关闭开关。'
  }
}

// ── 订阅通知事件入账 ──
// 文档：https://developers.weixin.qq.com/doc/service/guide/product/subscription_messages/push.html
// 一次 XML 里 <SubscribeMsgPopupEvent> 下可能有多个 <List>，需全部遍历。

/** 提取 XML 中所有 <List>...</List> 内层文本块 */
function extractListBlocks(xml) {
  const out = []
  if (!xml) return out
  const re = /<List>([\s\S]*?)<\/List>/gi
  let m
  while ((m = re.exec(xml)) !== null) {
    out.push(m[1])
  }
  return out
}

/** 额度文档确定性 _id：模板 + openid，避免并发重复建档 */
function quotaDocId(oaOpenid, templateId) {
  return ('q_' + String(templateId || '') + '_' + String(oaOpenid || '')).replace(/[^a-zA-Z0-9_-]/g, '_')
}

/** 原子自增剩余可发额度（accept 一次 +1） */
async function incrementQuota(oaOpenid, templateId) {
  if (!oaOpenid || !templateId) return
  const now = Date.now()
  const docId = quotaDocId(oaOpenid, templateId)
  try {
    const res = await db.collection(OA_SUBSCRIBE_QUOTA_COLLECTION).doc(docId).update({
      data: {
        remaining: _.inc(1),
        totalAccepted: _.inc(1),
        rejected: false,
        updatedAt: now
      }
    })
    if (res && res.stats && res.stats.updated > 0) return
  } catch (e) {}
  try {
    await db.collection(OA_SUBSCRIBE_QUOTA_COLLECTION).add({
      data: {
        _id: docId,
        oaOpenid: oaOpenid,
        templateId: templateId,
        remaining: 1,
        totalAccepted: 1,
        totalSent: 0,
        rejected: false,
        createdAt: now,
        updatedAt: now
      }
    })
  } catch (e2) {
    // 并发下 add 撞 _id：退化为再自增一次
    try {
      await db.collection(OA_SUBSCRIBE_QUOTA_COLLECTION).doc(docId).update({
        data: { remaining: _.inc(1), totalAccepted: _.inc(1), rejected: false, updatedAt: now }
      })
    } catch (e3) {
      console.warn('[oaWebhook] incrementQuota fail', e3.message || e3)
    }
  }
}

/** 用户拒收：剩余额度归零并标记 */
async function markQuotaRejected(oaOpenid, templateId) {
  if (!oaOpenid || !templateId) return
  const now = Date.now()
  const docId = quotaDocId(oaOpenid, templateId)
  try {
    await db.collection(OA_SUBSCRIBE_QUOTA_COLLECTION).doc(docId).update({
      data: { remaining: 0, rejected: true, rejectedAt: now, updatedAt: now }
    })
  } catch (e) {
    console.warn('[oaWebhook] markQuotaRejected fail', e.message || e)
  }
}

/** Event=subscribe_msg_popup_event：遍历每个 List，accept 且模板匹配则 +1 额度 */
async function handleSubscribePopupEvent(xml, oaOpenid) {
  const blocks = extractListBlocks(xml)
  let accepted = 0
  let rejected = 0
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]
    const templateId = pickXmlTag(block, 'TemplateId')
    const status = pickXmlTag(block, 'SubscribeStatusString')
    if (templateId !== OA_SUBSCRIBE_TEMPLATE_ID) continue
    if (status === 'accept') {
      await incrementQuota(oaOpenid, templateId)
      accepted++
    } else if (status === 'reject') {
      rejected++
    }
  }
  console.log('[oaWebhook] popup_event', {
    oaOpenid: (oaOpenid || '').slice(0, 6) + '...',
    lists: blocks.length,
    accepted: accepted,
    rejected: rejected
  })
}

/** Event=subscribe_msg_change_event：reject → 额度归零 */
async function handleSubscribeChangeEvent(xml, oaOpenid) {
  const blocks = extractListBlocks(xml)
  let rejected = 0
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]
    const templateId = pickXmlTag(block, 'TemplateId')
    const status = pickXmlTag(block, 'SubscribeStatusString')
    if (templateId !== OA_SUBSCRIBE_TEMPLATE_ID) continue
    if (status === 'reject') {
      await markQuotaRejected(oaOpenid, templateId)
      rejected++
    }
  }
  console.log('[oaWebhook] change_event', {
    oaOpenid: (oaOpenid || '').slice(0, 6) + '...',
    lists: blocks.length,
    rejected: rejected
  })
}

/** Event=subscribe_msg_sent_event：bizsend 异步回执，落 push_history */
async function handleSubscribeSentEvent(xml, oaOpenid) {
  const blocks = extractListBlocks(xml)
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]
    const templateId = pickXmlTag(block, 'TemplateId')
    if (templateId !== OA_SUBSCRIBE_TEMPLATE_ID) continue
    const msgId = pickXmlTag(block, 'MsgID')
    const errorCode = pickXmlTag(block, 'ErrorCode')
    const errorStatus = pickXmlTag(block, 'ErrorStatus')
    try {
      await db.collection(PUSH_HISTORY_COLLECTION).add({
        data: {
          type: 'oa_subscribe_receipt',
          triggeredBy: 'wechat_callback',
          payload: { oaOpenid: oaOpenid || '', templateId: templateId, msgId: msgId },
          result: {
            success: String(errorCode) === '0',
            errorCode: errorCode,
            errorStatus: errorStatus
          },
          createdAt: Date.now()
        }
      })
    } catch (e) {
      console.warn('[oaWebhook] write sent receipt fail', e.message || e)
    }
    console.log('[oaWebhook] sent_event', {
      oaOpenid: (oaOpenid || '').slice(0, 6) + '...',
      msgId: msgId,
      errorCode: errorCode,
      errorStatus: errorStatus
    })
  }
}

// ── JS-SDK 签名（供 H5 订阅入口的 wx-open-subscribe 开放标签使用）──
// 网页须在服务号「JS 接口安全域名」下，先 wx.config 注入签名 + openTagList:['wx-open-subscribe']
// 才能渲染订阅按钮。前端用当前页 url 调用本接口：GET ...oaWebhook?action=jssdk&url=ENCODED_URL
let _oaJsTicketCache = { ticket: '', expireAt: 0 }
async function getOaJsapiTicket() {
  const nowMs = Date.now()
  if (_oaJsTicketCache.ticket && _oaJsTicketCache.expireAt > nowMs + 60 * 1000) {
    return _oaJsTicketCache.ticket
  }
  const token = await getOaAccessToken()
  const url =
    'https://api.weixin.qq.com/cgi-bin/ticket/getticket?type=jsapi&access_token=' +
    encodeURIComponent(token)
  const res = await axios.get(url)
  if (!res.data || res.data.errcode !== 0 || !res.data.ticket) {
    throw new Error('获取 jsapi_ticket 失败: ' + JSON.stringify(res.data))
  }
  _oaJsTicketCache = {
    ticket: res.data.ticket,
    expireAt: nowMs + (res.data.expires_in || 7200) * 1000
  }
  return _oaJsTicketCache.ticket
}

function randomNonceStr() {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
}

async function handleJsSdkSignature(query) {
  const cred = getOaCredentials()
  const corsHeaders = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
  }
  if (!cred) {
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ errcode: -1, errmsg: '缺少 WECHAT_OA_APPID/SECRET' }) }
  }
  try {
    const pageUrl = String(query.url || '').trim()
    if (!pageUrl) {
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ errcode: -1, errmsg: '缺少 url 参数' }) }
    }
    const ticket = await getOaJsapiTicket()
    const noncestr = randomNonceStr()
    const timestamp = Math.floor(Date.now() / 1000)
    const raw =
      'jsapi_ticket=' + ticket + '&noncestr=' + noncestr + '&timestamp=' + timestamp + '&url=' + pageUrl
    const signature = sha1(raw)
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        errcode: 0,
        appId: cred.appid,
        timestamp: timestamp,
        nonceStr: noncestr,
        signature: signature,
        templateId: OA_SUBSCRIBE_TEMPLATE_ID
      })
    }
  } catch (e) {
    console.error('[oaWebhook] jssdk sign fail', e.message || e)
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ errcode: -1, errmsg: e.message || String(e) }) }
  }
}

function normalizeHttpEvent(event) {
  const headers = event.headers || {}
  const query = event.queryStringParameters || event.query || {}
  let body = event.body
  if (body && typeof body === 'object' && body.toString) {
    body = String(body)
  }
  if (typeof body !== 'string') body = body ? String(body) : ''
  if (event.isBase64Encoded && body) {
    body = Buffer.from(body, 'base64').toString('utf8')
  }
  return { headers, query, body, httpMethod: event.httpMethod || event.method || 'GET' }
}

exports.main = async (event) => {
  await ensureCollectionsOnce()
  const { headers, query, body, httpMethod } = normalizeHttpEvent(event)

  // H5 订阅入口的 JS-SDK 签名（不依赖服务器配置 Token，仅需 AppID/Secret）
  if ((query.action || '') === 'jssdk') {
    return await handleJsSdkSignature(query)
  }

  const token = getOaToken()
  if (!token) {
    console.error('[oaWebhook] WECHAT_OA_TOKEN 未配置')
    return { statusCode: 500, body: 'token not configured' }
  }

  const signature = query.signature || headers['x-wx-signature'] || ''
  const timestamp = query.timestamp || headers['x-wx-timestamp'] || ''
  const nonce = query.nonce || headers['x-wx-nonce'] || ''

  if (httpMethod === 'GET' || query.echostr) {
    if (!verifySignature(token, timestamp, nonce, signature)) {
      return { statusCode: 403, body: 'invalid signature' }
    }
    return { statusCode: 200, body: query.echostr || 'ok' }
  }

  if (!verifySignature(token, timestamp, nonce, signature)) {
    return { statusCode: 403, body: 'invalid signature' }
  }

  let xml = body || ''
  try {
    xml = resolveIncomingXml(xml, query, token)
  } catch (e) {
    console.error('[oaWebhook] decrypt/verify error', e.message || e)
    return { statusCode: 403, body: 'invalid encrypted message' }
  }

  const msgType = pickXmlTag(xml, 'MsgType')
  const evt = pickXmlTag(xml, 'Event')
  const fromUser = pickXmlTag(xml, 'FromUserName')
  const toUser = pickXmlTag(xml, 'ToUserName')
  const hasEncrypt = !!pickXmlTag(body || '', 'Encrypt')

  try {
    if (msgType === 'event') {
      if (evt === 'subscribe') {
        if (!fromUser) {
          console.error('[oaWebhook] subscribe missing FromUserName', { hasEncrypt, bodyLen: (body || '').length })
          return { statusCode: 500, body: 'missing openid' }
        }
        await handleSubscribe(fromUser)
        console.log('[oaWebhook] subscribe ok', { oaOpenid: fromUser.slice(0, 6) + '...' })
        const welcome =
          '欢迎关注「火星探索日志」！\n\n' +
          '在这里获取全球航天发射资讯与SpaceX星舰进度更新。\n\n' +
          '想接收发射提醒？点击菜单【开启提醒】即可订阅，' +
          '发射前约30分钟及完成后结果将收到服务号通知。\n\n' +
          '更多功能请点菜单【发现】，或回复「提醒」查看说明。'
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/xml' },
          body: buildTextReply(fromUser, toUser, welcome)
        }
      }
      if (evt === 'unsubscribe') {
        await handleUnsubscribe(fromUser)
        return { statusCode: 200, body: 'success' }
      }
      if (evt === 'subscribe_msg_popup_event') {
        await handleSubscribePopupEvent(xml, fromUser)
        return { statusCode: 200, body: 'success' }
      }
      if (evt === 'subscribe_msg_change_event') {
        await handleSubscribeChangeEvent(xml, fromUser)
        return { statusCode: 200, body: 'success' }
      }
      if (evt === 'subscribe_msg_sent_event') {
        await handleSubscribeSentEvent(xml, fromUser)
        return { statusCode: 200, body: 'success' }
      }
      if (evt === 'CLICK') {
        const eventKey = pickXmlTag(xml, 'EventKey')
        if (eventKey === 'MENU_ENABLE_ALERT') {
          const result = await handleEnableAlert(fromUser)
          return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/xml' },
            body: buildTextReply(fromUser, toUser, result.message)
          }
        }
        if (eventKey === 'MENU_REMIND_HELP') {
          const remindHelp =
            '发射提醒说明：\n' +
            '1. 点击菜单【开启提醒】一键订阅（推荐）\n' +
            '2. 或在小程序「我的太空 → 服务号提醒」中开启开关\n\n' +
            '需将小程序绑定微信开放平台；' +
            '成功开启后，任务发射前约30分钟及完成后结果将自动收到服务号推送，无需再逐条操作。'
          return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/xml' },
            body: buildTextReply(fromUser, toUser, remindHelp)
          }
        }
        if (eventKey === 'MENU_ABOUT') {
          const about =
            '「火星探索日志」\n\n' +
            '追踪全球航天发射与SpaceX星舰进度，' +
            '提供今日发射、星舰进度、太空新闻等内容。\n\n' +
            '点击菜单【开启提醒】可订阅发射通知，' +
            '发射前约30分钟及完成后结果推送服务号消息。\n\n' +
            '更多入口请点菜单【发现】。'
          return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/xml' },
            body: buildTextReply(fromUser, toUser, about)
          }
        }
      }
    }

    const content = pickXmlTag(xml, 'Content')
    if (msgType === 'text' && /提醒|发射|订阅/i.test(content)) {
      const reply =
        '发射提醒说明：\n' +
        '1. 点击菜单【开启提醒】一键订阅（推荐）\n' +
        '2. 或在小程序「我的太空 → 服务号提醒」中开启开关\n\n' +
        '需将小程序绑定微信开放平台；' +
        '成功开启后，任务发射前约30分钟及完成后结果将自动收到服务号推送，无需再逐条操作。\n\n' +
        '也可点菜单【发现】使用月愿计划、监控中心等入口。'
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/xml' },
        body: buildTextReply(fromUser, toUser, reply)
      }
    }
  } catch (e) {
    console.error('[oaWebhook] handle event error', { msgType, evt, fromUser, err: e.message || e })
    if (msgType === 'event' && (evt === 'subscribe' || evt === 'unsubscribe')) {
      return { statusCode: 500, body: 'handle event failed' }
    }
  }

  console.warn('[oaWebhook] unhandled message', {
    msgType: msgType || '(empty)',
    evt: evt || '(empty)',
    hasEncrypt,
    bodyLen: (body || '').length
  })
  return { statusCode: 200, body: 'success' }
}
