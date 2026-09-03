function breakdownAggDocId(year, countryKey) {
  return `global_breakdown_agg_${year}_${countryKey || '_all'}`
}

function isBreakdownAggUsable(payload) {
  if (!payload) return false
  const hasRows = (payload.byCountry && payload.byCountry.length)
    || (payload.byAgency && payload.byAgency.length)
    || (payload.byRocket && payload.byRocket.length)
  const hasSummary = payload.summary && Number.isFinite(Number(payload.summary.total))
  return !!(hasRows || hasSummary)
}

function packBreakdownAggPayload(resp) {
  return {
    summary: resp.summary,
    byCountry: resp.byCountry,
    byAgency: resp.byAgency,
    byRocket: resp.byRocket,
    countryOptions: resp.countryOptions,
    apiCount: resp.apiCount,
    source: resp.source,
    partial: !!resp.partial,
    launchCountListed: resp.launchCountListed,
    filters: resp.filters
  }
}

function normalizeSummaryCounts(summary) {
  if (!summary || typeof summary !== 'object') return null
  const total = Number(summary.total)
  if (!Number.isFinite(total) || total < 0) return null
  const success = Number(summary.success)
  const failure = Number(summary.failure)
  return {
    total,
    success: Number.isFinite(success) && success > 0 ? success : 0,
    failure: Number.isFinite(failure) && failure > 0 ? failure : 0
  }
}

/**
 * 同年不同口径的计数对齐（count 端点 vs 明细聚合）。
 * 年内发射数只增不减，落后的一份只会少算，因此逐项取大值，
 * 再压回 success + failure <= total（差额即「结果待定」的发射）。
 * @returns {{summary: object|null, raised: boolean}} raised 表示 base 的总数被另一口径抬高
 */
function reconcileSummaryCounts(base, other) {
  const a = normalizeSummaryCounts(base)
  const b = normalizeSummaryCounts(other)
  if (!a) return { summary: b, raised: false }
  if (!b) return { summary: a, raised: false }
  const total = Math.max(a.total, b.total)
  const success = Math.min(Math.max(a.success, b.success), total)
  const failure = Math.min(Math.max(a.failure, b.failure), total - success)
  return { summary: { total, success, failure }, raised: total > a.total }
}

module.exports = {
  breakdownAggDocId,
  isBreakdownAggUsable,
  packBreakdownAggPayload,
  normalizeSummaryCounts,
  reconcileSummaryCounts
}
