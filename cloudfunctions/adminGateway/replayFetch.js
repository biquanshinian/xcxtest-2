/**
 * replayFetch.js — 发射回放抓取 Agent 服务端 API（挂在 adminGateway）
 *
 * 与 bilibiliPublish 的 Agent 模式同构：本机/VPS 常驻 Agent 轮询领任务，
 * 用 yt-dlp 下载 ≤480p 回放后经预签 URL 直传 COS，再回写结果。
 * 队列由 syncSpaceDevsData 的 mission-replay.js 小时级扫描产生。
 *
 * 路由（Bearer REPLAY_AGENT_TOKEN，缺省回退 BILI_AGENT_TOKEN，免管理员 JWT）：
 *   POST /replay-agent/claim     → 领取 1 条 pending 任务 + COS 预签 PUT URL
 *   POST /replay-agent/complete  → 上传成功回写 mission_replays（_id=launchId）
 *   POST /replay-agent/fail      → 失败重试计数（3 次后终态 failed）
 */

const QUEUE_COL = 'replay_fetch_queue'
const RESULT_COL = 'mission_replays'
const COS_FOLDER = '发射回放'
const MAX_ATTEMPTS = 3
// 下载+上传可能很久（完整回放走慢代理可能超 1 小时）。Agent 端下载有 90 分钟硬超时，
// 这里放到 3 小时才回收，避免任务还在跑就被重置 pending 导致双份下载/上传
const CLAIM_STALE_MS = 3 * 60 * 60 * 1000
const LIFECYCLE_RULE_ID = 'mission-replay-30d'
const LIFECYCLE_DAYS = 30

function createReplayFetchApi({ db, ok, fail, now, crypto, createCOSClient, COS_BUCKET, COS_REGION, COS_BASE_URL }) {
  function verifyAgentToken(headers = {}) {
    const expected = String(process.env.REPLAY_AGENT_TOKEN || process.env.BILI_AGENT_TOKEN || '').trim()
    if (!expected || expected.length < 16) return false
    const authHeader = headers.Authorization || headers.authorization || ''
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    return !!token && token === expected
  }

  function presignPut(key, expires) {
    const cos = createCOSClient()
    return new Promise((resolve, reject) => {
      cos.getObjectUrl({
        Bucket: COS_BUCKET,
        Region: COS_REGION,
        Key: key,
        Method: 'PUT',
        Sign: true,
        Expires: expires || 3600,
        Protocol: 'https:'
      }, (err, data) => (err ? reject(err) : resolve(data.Url)))
    })
  }

  async function claimJob() {
    const ts = now()

    // 回收超时僵尸任务
    try {
      const stuck = await db.collection(QUEUE_COL).where({ status: 'claimed' }).limit(10).get()
      for (const row of stuck.data || []) {
        if (ts - Number(row.claimedAt || 0) > CLAIM_STALE_MS) {
          await db.collection(QUEUE_COL).doc(row._id).update({
            data: { status: 'pending', claimToken: '', claimedAt: 0, updatedAt: ts, lastError: 'reclaimed_stale_claim' }
          })
        }
      }
    } catch (e) {}

    // 取 pending 且到达重试时间的任务（集锦源可能还没发布，失败后延后重试）。
    // 拉 50 条再挑：只拉最新几条时，若它们都在退避期会把已到期的老任务饿死
    let rows = []
    try {
      const res = await db.collection(QUEUE_COL)
        .where({ status: 'pending' })
        .orderBy('createdAt', 'desc')
        .limit(50)
        .get()
      rows = res.data || []
    } catch (e) {
      const res = await db.collection(QUEUE_COL).where({ status: 'pending' }).limit(50).get()
      rows = res.data || []
    }
    const job = rows.find((r) => !r.nextRetryAt || Number(r.nextRetryAt) <= ts) || null
    if (!job) return ok({ job: null, reason: 'empty' })

    const claimToken = crypto.randomBytes(16).toString('hex')
    await db.collection(QUEUE_COL).doc(job._id).update({
      data: { status: 'claimed', claimToken, claimedAt: ts, updatedAt: ts }
    })

    // kind=clip（指定博主集锦）与 kind=full（完整回放）分开存放
    const kind = job.kind === 'clip' ? 'clip' : 'full'
    const cosKey = kind === 'clip'
      ? `${COS_FOLDER}/集锦/${job.launchId}.mp4`
      : `${COS_FOLDER}/${job.launchId}.mp4`
    let uploadUrl = ''
    try {
      uploadUrl = await presignPut(cosKey, 3600)
    } catch (e) {
      // 预签失败释放任务，下轮重试
      await db.collection(QUEUE_COL).doc(job._id).update({
        data: { status: 'pending', claimToken: '', claimedAt: 0, updatedAt: now(), lastError: 'presign_failed: ' + (e.message || e) }
      })
      return fail(5000, 'COS 预签失败: ' + (e.message || e))
    }

    return ok({
      job: {
        id: job._id,
        claimToken,
        kind,
        launchId: job.launchId,
        missionName: job.missionName || '',
        net: job.net || '',
        sources: Array.isArray(job.sources) ? job.sources : [],
        clipSearch: (job.clipSearch && typeof job.clipSearch === 'object') ? job.clipSearch : null,
        attempts: Number(job.attempts || 0)
      },
      upload: {
        uploadUrl,
        cosKey,
        cosUrl: `${COS_BASE_URL}${encodeURI(cosKey)}`
      }
    })
  }

  async function verifyClaim(body) {
    const id = String((body && body.id) || '').trim()
    const claimToken = String((body && body.claimToken) || '').trim()
    if (!id || !claimToken) return { err: fail(4001, 'id/claimToken 不能为空') }
    const res = await db.collection(QUEUE_COL).doc(id).get().catch(() => null)
    const job = res && res.data
    if (!job) return { err: fail(4040, '任务不存在') }
    if (job.status !== 'claimed' || job.claimToken !== claimToken) {
      return { err: fail(4030, 'claim 已失效') }
    }
    return { job }
  }

  async function completeJob(body = {}) {
    const { job, err } = await verifyClaim(body)
    if (err) return err
    const ts = now()
    const cosUrl = String(body.cosUrl || '').trim()
    if (!cosUrl || !cosUrl.startsWith(COS_BASE_URL)) return fail(4001, 'cosUrl 非法')

    // kind=clip：写 agentClips 数组（指定博主集锦）；kind=full：写 videoUrl（完整回放）
    const doc = job.kind === 'clip'
      ? {
          launchId: job.launchId,
          missionName: job.missionName || '',
          net: job.net || '',
          status: 'ready',
          agentClips: [{
            videoUrl: cosUrl,
            thumbnailUrl: '',
            sourceUrl: String(body.sourcePageUrl || (body.sourceUsed && body.sourceUsed.url) || ''),
            title: String(body.sourceTitle || ''),
            publisher: String((body.sourceUsed && body.sourceUsed.publisher) || 'SciNews'),
            durationSec: Number(body.durationSec || 0) || 0
          }],
          updatedAt: ts
        }
      : {
          launchId: job.launchId,
          missionName: job.missionName || '',
          net: job.net || '',
          status: 'ready',
          videoUrl: cosUrl,
          durationSec: Number(body.durationSec || 0) || 0,
          sizeBytes: Number(body.sizeBytes || 0) || 0,
          width: Number(body.width || 0) || 0,
          height: Number(body.height || 0) || 0,
          sourceUsed: body.sourceUsed && typeof body.sourceUsed === 'object'
            ? {
                url: String(body.sourceUsed.url || ''),
                type: String(body.sourceUsed.type || ''),
                publisher: String(body.sourceUsed.publisher || '')
              }
            : null,
          updatedAt: ts
        }
    try {
      // update 合并写入：保留云端扫描已写入的 clips/links（集锦 + 外链）
      const upd = await db.collection(RESULT_COL).doc(job.launchId).update({ data: doc })
      if (!upd || !upd.stats || upd.stats.updated === 0) {
        await db.collection(RESULT_COL).doc(job.launchId).set({ data: { ...doc, createdAt: ts } })
      }
    } catch (e) {
      try {
        await db.collection(RESULT_COL).doc(job.launchId).set({ data: { ...doc, createdAt: ts } })
      } catch (e2) {
        return fail(5000, '结果写入失败: ' + (e2.message || e2))
      }
    }

    await db.collection(QUEUE_COL).doc(job._id).update({
      data: { status: 'done', updatedAt: ts, lastError: '' }
    })
    return ok({ launchId: job.launchId, kind: job.kind === 'clip' ? 'clip' : 'full', videoUrl: cosUrl })
  }

  async function failJob(body = {}) {
    const { job, err } = await verifyClaim(body)
    if (err) return err
    const ts = now()
    const attempts = Number(job.attempts || 0) + 1
    const message = String(body.error || 'unknown').slice(0, 500)
    // 集锦任务允许更多次重试（视频可能几小时后才发布），且失败后按次数退避 2h/4h/6h…
    const maxAttempts = job.kind === 'clip' ? 6 : MAX_ATTEMPTS
    const terminal = attempts >= maxAttempts || body.permanent === true
    await db.collection(QUEUE_COL).doc(job._id).update({
      data: {
        status: terminal ? 'failed' : 'pending',
        attempts,
        claimToken: '',
        claimedAt: 0,
        nextRetryAt: terminal ? 0 : ts + attempts * 2 * 60 * 60 * 1000,
        lastError: message,
        updatedAt: ts
      }
    })
    return ok({ action: terminal ? 'terminal_failed' : 'retry_later', attempts })
  }

  /** 管理后台：队列与成品概览 */
  async function listReplays(query = {}) {
    const limit = Math.min(50, Math.max(1, Number(query.limit || 20)))
    const [queueRes, doneRes] = await Promise.all([
      db.collection(QUEUE_COL).orderBy('createdAt', 'desc').limit(limit).get().catch(() => ({ data: [] })),
      db.collection(RESULT_COL).orderBy('updatedAt', 'desc').limit(limit).get().catch(() => ({ data: [] }))
    ])
    return ok({ queue: queueRes.data || [], replays: doneRes.data || [] })
  }

  /** 管理后台：删除某个回放（含 COS 文件与队列记录，可让下轮扫描重抓） */
  async function deleteReplay(launchId) {
    const id = String(launchId || '').trim()
    if (!id) return fail(4001, 'launchId 不能为空')
    try {
      const res = await db.collection(RESULT_COL).doc(id).get().catch(() => null)
      const data = (res && res.data) || {}
      // 完整回放 + Agent 集锦都属于本管线上传的 COS 文件，一并删除
      const urls = [data.videoUrl]
        .concat((Array.isArray(data.agentClips) ? data.agentClips : []).map((c) => c && c.videoUrl))
        .filter((u) => u && u.startsWith(COS_BASE_URL))
      if (urls.length) {
        const cos = createCOSClient()
        for (const url of urls) {
          const key = decodeURI(url.slice(COS_BASE_URL.length).split('?')[0])
          await new Promise((resolve) => {
            cos.deleteObject({ Bucket: COS_BUCKET, Region: COS_REGION, Key: key }, () => resolve())
          })
        }
      }
    } catch (e) {}
    await db.collection(RESULT_COL).doc(id).remove().catch(() => {})
    try {
      const q = await db.collection(QUEUE_COL).where({ launchId: id }).get()
      for (const row of q.data || []) {
        await db.collection(QUEUE_COL).doc(row._id).remove().catch(() => {})
      }
    } catch (e) {}
    return ok(true)
  }

  /**
   * 确保「发射回放/」前缀的 30 天生命周期规则存在（幂等，合并保留桶上已有规则）。
   * COS 到期自动删文件；apiProxy 侧按 net+29 天停发 COS 链接，两边配合无 404。
   */
  async function ensureLifecycleRule() {
    const cos = createCOSClient()
    let rules = []
    try {
      const data = await new Promise((resolve, reject) => {
        cos.getBucketLifecycle({ Bucket: COS_BUCKET, Region: COS_REGION }, (err, d) => {
          if (err) {
            // 桶从未配置过生命周期时返回 404 NoSuchLifecycleConfiguration，按空规则处理
            if (err.statusCode === 404) return resolve({ Rules: [] })
            return reject(err)
          }
          resolve(d)
        })
      })
      rules = Array.isArray(data.Rules) ? data.Rules : []
    } catch (e) {
      return fail(5000, '读取生命周期失败: ' + (e.message || e))
    }

    const already = rules.some((r) => r && r.ID === LIFECYCLE_RULE_ID)
    if (already) return ok({ action: 'exists', ruleId: LIFECYCLE_RULE_ID, totalRules: rules.length })

    rules.push({
      ID: LIFECYCLE_RULE_ID,
      Status: 'Enabled',
      Filter: { Prefix: `${COS_FOLDER}/` },
      Expiration: { Days: LIFECYCLE_DAYS }
    })
    try {
      await new Promise((resolve, reject) => {
        cos.putBucketLifecycle({ Bucket: COS_BUCKET, Region: COS_REGION, Rules: rules }, (err, d) =>
          err ? reject(err) : resolve(d))
      })
    } catch (e) {
      return fail(5000, '写入生命周期失败: ' + (e.message || e))
    }
    return ok({ action: 'created', ruleId: LIFECYCLE_RULE_ID, days: LIFECYCLE_DAYS, prefix: `${COS_FOLDER}/`, totalRules: rules.length })
  }

  return { verifyAgentToken, claimJob, completeJob, failJob, listReplays, deleteReplay, ensureLifecycleRule }
}

module.exports = { createReplayFetchApi }
