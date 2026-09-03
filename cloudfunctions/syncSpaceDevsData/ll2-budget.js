/**
 * LL2 小时配额账本（软预算，跨云函数共享）。
 *
 * 文档：launch_timeline_cache/_ll2_budget_hourly = { hourUtc, count, lastSource, updatedAtMs }
 * - recordLl2Request(db, source)：每次真实 LL2 API 请求 +1（fire-and-forget，不阻塞主链路）
 * - getLl2BudgetRemaining(db)：当前小时剩余额度 = cap - count（跨小时自动视为满额）
 *
 * cap 取环境变量 LL2_HOURLY_BUDGET；未配置时按匿名档 15/小时。配置了 LL2_API_TOKEN
 * 且档位更高时，请同步把 LL2_HOURLY_BUDGET 调到实际配额（例如 300）。
 *
 * 定位：这是「软门控」——计数为尽力而为（多实例并发重置存在极小概率少记 1~2 次），
 * 只用于全量轮里可延期附加任务（机构详情自愈 / 统计预热 / 飞行历史回填）的让路决策；
 * 关键路径（NET 探针、全量主体、缓存自愈、客户端实况查询）不受此门控拦截。
 *
 * ⚠ 本文件在 syncSpaceDevsData / ll2Query 各有一份副本（云函数目录间无法共享代码），
 * 修改时须两处同步。
 */
const BUDGET_COL = 'launch_timeline_cache'
const BUDGET_DOC = '_ll2_budget_hourly'
const DEFAULT_ANON_CAP = 15

let _knownBucket = ''

function ll2BudgetHourBucket(nowMs) {
  const d = new Date(nowMs || Date.now())
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  const h = String(d.getUTCHours()).padStart(2, '0')
  return `${y}${m}${day}T${h}`
}

function getLl2HourlyCap() {
  const raw = Number(process.env.LL2_HOURLY_BUDGET)
  if (Number.isFinite(raw) && raw >= 1) return Math.floor(raw)
  return DEFAULT_ANON_CAP
}

/**
 * 记一次 LL2 API 请求。失败静默（预算是软的，绝不反噬请求主链路）。
 * @param {object} db wx-server-sdk database 实例
 * @param {string} [source] 调用来源标识（诊断用）
 */
async function recordLl2Request(db, source) {
  if (!db) return
  const _ = db.command
  const col = db.collection(BUDGET_COL)
  const bucket = ll2BudgetHourBucket()
  try {
    if (_knownBucket !== bucket) {
      // 新小时（或冷启动）：读现状决定重置还是续加
      let cur = null
      try {
        const doc = await col.doc(BUDGET_DOC).get()
        cur = doc && doc.data
      } catch (eGet) { /* 文档不存在走重置 */ }
      if (!cur || String(cur.hourUtc) !== bucket) {
        await col.doc(BUDGET_DOC).set({
          data: { hourUtc: bucket, count: 1, lastSource: String(source || ''), updatedAtMs: Date.now() }
        })
        _knownBucket = bucket
        return
      }
      _knownBucket = bucket
    }
    const upRes = await col.doc(BUDGET_DOC).update({
      data: { count: _.inc(1), lastSource: String(source || ''), updatedAtMs: Date.now() }
    })
    // 文档被手动清理时 update 静默 no-op（updated:0）：回退 set 重建，避免计数丢失
    const updatedN = upRes && upRes.stats && typeof upRes.stats.updated === 'number' ? upRes.stats.updated : 1
    if (updatedN === 0) {
      _knownBucket = ''
      await col.doc(BUDGET_DOC).set({
        data: { hourUtc: bucket, count: 1, lastSource: String(source || ''), updatedAtMs: Date.now() }
      })
      _knownBucket = bucket
    }
  } catch (e) { /* 软预算：记账失败不影响主链路 */ }
}

/**
 * 当前小时剩余额度。读失败按满额返回（保持与无账本时相同的行为，宁可多跑不误杀）。
 * @param {object} db
 * @returns {Promise<number>}
 */
async function getLl2BudgetRemaining(db) {
  const cap = getLl2HourlyCap()
  if (!db) return cap
  try {
    const doc = await db.collection(BUDGET_COL).doc(BUDGET_DOC).get()
    const d = doc && doc.data
    if (!d || String(d.hourUtc) !== ll2BudgetHourBucket()) return cap
    return cap - (Number(d.count) || 0)
  } catch (e) {
    return cap
  }
}

module.exports = {
  BUDGET_COL,
  BUDGET_DOC,
  ll2BudgetHourBucket,
  getLl2HourlyCap,
  recordLl2Request,
  getLl2BudgetRemaining
}
