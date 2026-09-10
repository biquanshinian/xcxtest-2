/**
 * B 站自动发文运维收尾：停用配置、清空队列/词库、尝试删除云函数与触发器。
 * 幂等：global_config/bilibili_auto_publish.decommissionedAt 已存在则跳过（force 可再跑）。
 */
const https = require('https')
const crypto = require('crypto')

const FN_NAME = 'publishBilibiliFromEvents'
const CONFIG_DOC = 'bilibili_auto_publish'
const QUEUE_COL = 'bilibili_publish_queue'
const TOPIC_COL = 'bilibili_topic_keywords'
const BLACK_COL = 'bilibili_topic_blacklist'
const GLOBAL_COL = 'global_config'

function sha256Hex(s) {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex')
}

function hmacSha256(key, msg) {
  return crypto.createHmac('sha256', key).update(msg, 'utf8').digest()
}

/** 腾讯云 API 3.0 简易调用（SCF） */
function tc3Request({ action, payload, region = 'ap-shanghai' }) {
  const secretId = process.env.TENCENTCLOUD_SECRETID || process.env.SCF_SECRETID || ''
  const secretKey = process.env.TENCENTCLOUD_SECRETKEY || process.env.SCF_SECRETKEY || ''
  const token = process.env.TENCENTCLOUD_SESSIONTOKEN || process.env.SCF_SESSIONTOKEN || ''
  if (!secretId || !secretKey) {
    return Promise.resolve({ ok: false, error: 'missing TENCENTCLOUD credentials' })
  }

  const service = 'scf'
  const host = 'scf.tencentcloudapi.com'
  const version = '2018-04-16'
  const timestamp = Math.floor(Date.now() / 1000)
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10)
  const body = JSON.stringify(payload || {})
  const hashedPayload = sha256Hex(body)
  const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${host}\n`
  const signedHeaders = 'content-type;host'
  const canonicalRequest = [
    'POST',
    '/',
    '',
    canonicalHeaders,
    signedHeaders,
    hashedPayload
  ].join('\n')
  const credentialScope = `${date}/${service}/tc3_request`
  const stringToSign = [
    'TC3-HMAC-SHA256',
    String(timestamp),
    credentialScope,
    sha256Hex(canonicalRequest)
  ].join('\n')
  const secretDate = hmacSha256(`TC3${secretKey}`, date)
  const secretService = hmacSha256(secretDate, service)
  const secretSigning = hmacSha256(secretService, 'tc3_request')
  const signature = crypto.createHmac('sha256', secretSigning).update(stringToSign, 'utf8').digest('hex')
  const authorization =
    `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`

  const headers = {
    Authorization: authorization,
    'Content-Type': 'application/json; charset=utf-8',
    Host: host,
    'X-TC-Action': action,
    'X-TC-Timestamp': String(timestamp),
    'X-TC-Version': version,
    'X-TC-Region': region
  }
  if (token) headers['X-TC-Token'] = token

  return new Promise((resolve) => {
    const req = https.request(
      { hostname: host, method: 'POST', path: '/', headers },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          let json = null
          try {
            json = JSON.parse(text)
          } catch (e) {
            return resolve({ ok: false, error: 'invalid json', text: text.slice(0, 300) })
          }
          const err = json.Response && json.Response.Error
          if (err) {
            return resolve({
              ok: false,
              error: `${err.Code || ''}: ${err.Message || ''}`.trim(),
              requestId: json.Response.RequestId
            })
          }
          resolve({ ok: true, data: json.Response || json })
        })
      }
    )
    req.on('error', (e) => resolve({ ok: false, error: e.message || String(e) }))
    req.write(body)
    req.end()
  })
}

async function clearCollection(db, name, { maxBatches = 40 } = {}) {
  let removed = 0
  for (let i = 0; i < maxBatches; i++) {
    let res
    try {
      res = await db.collection(name).limit(100).get()
    } catch (e) {
      return { removed, error: e.message || String(e), missing: /not exist|RESOURCE_NOT_FOUND|不存在/i.test(String(e.message || e)) }
    }
    const list = (res && res.data) || []
    if (!list.length) break
    for (const doc of list) {
      if (!doc || !doc._id) continue
      try {
        await db.collection(name).doc(doc._id).remove()
        removed += 1
      } catch (e) {
        /* ignore single delete */
      }
    }
    if (list.length < 100) break
  }
  return { removed }
}

async function tryDeleteCloudFunction() {
  const namespaces = [
    process.env.TCB_ENV,
    process.env.SCF_NAMESPACE,
    // 本项目固定环境（HTTP 域名可对照）
    'cloud1-9gdqgdt5bfaa20fb',
    ''
  ].filter((v, i, arr) => arr.indexOf(v) === i)
  const regions = ['ap-shanghai', 'ap-guangzhou']
  const steps = []

  for (const region of regions) {
    for (const namespace of namespaces) {
      const listPayload = { FunctionName: FN_NAME, Limit: 20, Offset: 0 }
      if (namespace) listPayload.Namespace = namespace
      const listed = await tc3Request({ action: 'ListTriggers', payload: listPayload, region })
      steps.push({ region, namespace: namespace || '(default)', action: 'ListTriggers', ok: listed.ok, error: listed.error })

      const triggers = (listed.ok && listed.data && listed.data.Triggers) || []
      for (const t of triggers) {
        const del = await tc3Request({
          action: 'DeleteTrigger',
          region,
          payload: {
            FunctionName: FN_NAME,
            TriggerName: t.TriggerName,
            Type: t.Type,
            ...(namespace ? { Namespace: namespace } : {}),
            ...(t.Qualifier ? { Qualifier: t.Qualifier } : {})
          }
        })
        steps.push({
          region,
          namespace: namespace || '(default)',
          action: 'DeleteTrigger',
          trigger: t.TriggerName,
          ok: del.ok,
          error: del.error
        })
      }

      const delFn = await tc3Request({
        action: 'DeleteFunction',
        region,
        payload: {
          FunctionName: FN_NAME,
          ...(namespace ? { Namespace: namespace } : {})
        }
      })
      steps.push({
        region,
        namespace: namespace || '(default)',
        action: 'DeleteFunction',
        ok: delFn.ok,
        error: delFn.error
      })
      if (delFn.ok) return { deleted: true, region, namespace, steps }
      if (delFn.error && /ResourceNotFound|不存在|FunctionNameNotFound/i.test(delFn.error)) {
        return { deleted: true, alreadyGone: true, region, namespace, steps }
      }
    }
  }
  return { deleted: false, steps }
}

async function decommissionBilibiliPublish(db, { force = false, cloud = null } = {}) {
  const report = {
    startedAt: Date.now(),
    config: null,
    queue: null,
    topics: null,
    blacklist: null,
    functionDelete: null,
    probe: null
  }

  let cfg = null
  try {
    const cur = await db.collection(GLOBAL_COL).doc(CONFIG_DOC).get()
    cfg = cur && cur.data
  } catch (e) {
    cfg = null
  }

  if (cfg && cfg.decommissionedAt && !force) {
    return {
      skipped: true,
      reason: 'already_decommissioned',
      decommissionedAt: cfg.decommissionedAt,
      report
    }
  }

  // 先探测云函数是否仍存在（callFunction）
  if (cloud && typeof cloud.callFunction === 'function') {
    try {
      await cloud.callFunction({ name: FN_NAME, data: { __ping: true } })
      report.probe = { exists: true }
    } catch (e) {
      const msg = String((e && e.message) || e || '')
      report.probe = {
        exists: !/FUNCTION_NOT_FOUND|FunctionName|不存在|404/i.test(msg),
        error: msg.slice(0, 200)
      }
    }
  }

  report.queue = await clearCollection(db, QUEUE_COL)
  report.topics = await clearCollection(db, TOPIC_COL)
  report.blacklist = await clearCollection(db, BLACK_COL)

  const stamp = Date.now()
  try {
    await db
      .collection(GLOBAL_COL)
      .doc(CONFIG_DOC)
      .set({
        data: {
          enabled: false,
          decommissioned: true,
          decommissionedAt: stamp,
          note: 'B站自动发文已下线；代码与 Agent 已移除',
          updatedAt: stamp
        }
      })
    report.config = { wrote: true, decommissionedAt: stamp }
  } catch (e) {
    try {
      await db.collection(GLOBAL_COL).doc(CONFIG_DOC).update({
        data: {
          enabled: false,
          decommissioned: true,
          decommissionedAt: stamp,
          note: 'B站自动发文已下线；代码与 Agent 已移除',
          updatedAt: stamp
        }
      })
      report.config = { updated: true, decommissionedAt: stamp }
    } catch (e2) {
      report.config = { error: e2.message || String(e2) }
    }
  }

  report.functionDelete = await tryDeleteCloudFunction()
  report.finishedAt = Date.now()
  return { ok: true, report }
}

let _autoStarted = false
function scheduleAutoDecommission(db, cloud) {
  if (_autoStarted) return
  _autoStarted = true
  setTimeout(() => {
    decommissionBilibiliPublish(db, { cloud }).catch((e) => {
      console.warn('[bilibiliDecommission] auto failed:', e.message || e)
    })
  }, 800)
}

module.exports = {
  FN_NAME,
  decommissionBilibiliPublish,
  scheduleAutoDecommission
}
