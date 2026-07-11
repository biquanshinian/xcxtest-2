const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

const RATE_LIMIT_COLLECTION = 'security_rate_limits'
const BLACKLIST_COLLECTION = 'security_blacklist'
const CACHE_COLLECTION = 'security_gateway_cache'
const USAGE_COLLECTION = 'security_daily_usage'
const VOTE_RECORDS_COLLECTION = 'launch_vote_records'
const VOTES_COLLECTION = 'launch_votes'

const RATE_LIMIT_TTL_MS = 10 * 60 * 1000
const USAGE_KEEP_DAYS = 14
// 竞猜记录生命周期：投票 60 天后（发射早已结算）连同主记录一起清理
const VOTE_KEEP_DAYS = 60

async function safeWhereRemove(collection, whereExpr) {
  try {
    const res = await db.collection(collection).where(whereExpr).remove()
    return (res && res.stats && res.stats.removed) || 0
  } catch (e) {
    return { error: e && e.message ? e.message : String(e) }
  }
}

exports.main = async () => {
  const ts = Date.now()
  const usageCutoff = ts - USAGE_KEEP_DAYS * 24 * 60 * 60 * 1000
  const rateCutoff = ts - RATE_LIMIT_TTL_MS
  const voteCutoff = ts - VOTE_KEEP_DAYS * 24 * 60 * 60 * 1000

  const [rateLimits, blacklist, cache, usage, voteRecords, votes] = await Promise.all([
    safeWhereRemove(RATE_LIMIT_COLLECTION, { updatedAt: _.lt(rateCutoff) }),
    safeWhereRemove(BLACKLIST_COLLECTION, { expireAt: _.lt(ts) }),
    safeWhereRemove(CACHE_COLLECTION, { expireAt: _.lt(ts) }),
    safeWhereRemove(USAGE_COLLECTION, { updatedAt: _.lt(usageCutoff) }),
    // 时间字段为毫秒时间戳（adminGateway now()）。个人投票记录按 createdAt 满 60 天删；
    // 主统计记录按 updatedAt 判断（每次投票/换轮/结算都会刷新），避免误删反复改期仍在进行的竞猜
    safeWhereRemove(VOTE_RECORDS_COLLECTION, { createdAt: _.lt(voteCutoff) }),
    safeWhereRemove(VOTES_COLLECTION, { updatedAt: _.lt(voteCutoff) })
  ])

  return {
    success: true,
    ts,
    removed: { rateLimits, blacklist, cache, usage, voteRecords, votes }
  }
}
