/**
 * 公众号草稿：配图预转存 + 推送微信草稿箱
 * - action=prepare：只转存配图
 * - action=push / 默认：执行推送（内部会先确保配图就绪）
 * - 定时器：扫 pushing，并扫 imagePrepStatus=preparing 续跑转存
 *
 * 环境变量：OA_CONTENT_INTERNAL_TOKEN（与 adminGateway 相同）
 */
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const DRAFTS_COL = 'oa_drafts'
const STALE_MS = 5 * 60 * 1000

async function callGateway(id, action) {
  const token = String(process.env.OA_CONTENT_INTERNAL_TOKEN || '').trim()
  if (!token) {
    return { code: 5000, message: '未配置 OA_CONTENT_INTERNAL_TOKEN' }
  }
  const res = await cloud.callFunction({
    name: 'adminGateway',
    data: {
      path: '/oa-content/internal/push-draft',
      method: 'POST',
      body: { id, action: action || 'push', from: 'oaPushDraft' },
      headers: { 'x-oa-internal-token': token }
    },
    config: { timeout: 90000 }
  })
  return res.result || { code: 0, data: res }
}

async function markFailed(id, prevStatus, message) {
  // 推送失败进入显式 push_failed 态（可筛选、可重推），不再借用 ready/rejected
  await db
    .collection(DRAFTS_COL)
    .doc(id)
    .update({
      data: {
        status: prevStatus === 'pushed_to_wechat' ? 'pushed_to_wechat' : 'push_failed',
        pushLeaseAt: 0,
        error: String(message || '推送未完成，请重试').slice(0, 500),
        updatedAt: Date.now()
      }
    })
    .catch(() => null)
}

async function recoverStale() {
  const t = Date.now()
  const res = await db
    .collection(DRAFTS_COL)
    .where({ status: 'pushing' })
    .limit(20)
    .get()
    .catch(() => ({ data: [] }))
  let recovered = 0
  for (const row of res.data || []) {
    const lease = Number(row.pushLeaseAt || 0)
    const updated = Number(row.updatedAt || 0)
    if (lease && t - lease < STALE_MS) continue
    if (!lease && updated && t - updated < 8 * 60 * 1000) continue
    await markFailed(row._id, row.pushPrevStatus || 'ready', row.error || '推送超时未完成，请重试')
    recovered += 1
  }
  return recovered
}

async function pickQueued(limit = 3) {
  const res = await db
    .collection(DRAFTS_COL)
    .where({ status: 'pushing' })
    .limit(20)
    .get()
    .catch(() => ({ data: [] }))
  const t = Date.now()
  return (res.data || [])
    .filter((r) => {
      const lease = Number(r.pushLeaseAt || 0)
      return !lease || t - lease > 50 * 1000
    })
    .slice(0, limit)
}

async function pickPreparing(limit = 3) {
  const res = await db
    .collection(DRAFTS_COL)
    .where({ imagePrepStatus: 'preparing' })
    .limit(20)
    .get()
    .catch(() => ({ data: [] }))
  return (res.data || [])
    .filter(
      (r) =>
        r.imagesReady !== true &&
        !['published', 'rejected', 'generate_failed'].includes(String(r.status || ''))
    )
    .slice(0, limit)
}

exports.main = async (event = {}) => {
  const token = String(process.env.OA_CONTENT_INTERNAL_TOKEN || '').trim()
  if (!token) {
    return { code: 5000, message: '未配置 OA_CONTENT_INTERNAL_TOKEN，无法推送' }
  }

  try {
    const id = String(event.id || (event.body && event.body.id) || '').trim()
    const action = String(event.action || (event.body && event.body.action) || 'push').trim()
    if (id) {
      return await callGateway(id, action === 'prepare' ? 'prepare' : 'push')
    }

    const prepRows = await pickPreparing(2)
    const prepResults = []
    for (const row of prepRows) {
      try {
        const r = await callGateway(row._id, 'prepare')
        prepResults.push({ id: row._id, action: 'prepare', ...(r || {}) })
      } catch (e) {
        prepResults.push({ id: row._id, action: 'prepare', code: 5000, message: e.message || String(e) })
      }
    }

    const queued = await pickQueued(2)
    const results = []
    for (const row of queued) {
      try {
        const r = await callGateway(row._id, 'push')
        results.push({ id: row._id, action: 'push', ...(r || {}) })
        if (r && r.code && r.code !== 0) {
          if (
            r.code !== 5030 &&
            r.code !== 5031 &&
            !/配图上传未完成|续传|配图尚未就绪/i.test(String(r.message || ''))
          ) {
            await markFailed(row._id, row.pushPrevStatus || 'ready', r.message || '推送失败')
          }
        }
      } catch (e) {
        const msg = e.message || String(e)
        results.push({ id: row._id, action: 'push', code: 5000, message: msg })
        await markFailed(row._id, row.pushPrevStatus || 'ready', msg)
      }
    }
    const recovered = await recoverStale()
    return {
      code: 0,
      data: {
        prepared: prepResults.length,
        processed: results.length,
        recovered,
        prepResults,
        results
      }
    }
  } catch (e) {
    console.error('[oaPushDraft]', e)
    return { code: 5000, message: e.message || String(e) }
  }
}
