/**
 * 全球发射统计：summary / breakdown 合并与兜底（纯函数，供页面与单测共用）
 *
 * 原则：任一端成功、或本地仍有快照，就出数；只有两边都空才抛错。
 */

function isUsableSummary(summary) {
  if (!summary || typeof summary !== 'object') return false
  const total = Number(summary.total)
  return Number.isFinite(total) && total >= 0
}

function normalizeSummaryCounts(summary) {
  if (!isUsableSummary(summary)) return null
  const success = Number(summary.success)
  const failure = Number(summary.failure)
  return {
    total: Number(summary.total),
    success: Number.isFinite(success) && success > 0 ? success : 0,
    failure: Number.isFinite(failure) && failure > 0 ? failure : 0
  }
}

/**
 * 多来源（count 端点 / 明细聚合 / 本地快照）计数对齐。
 * 同一年同一范围内发射数只增不减，落后的一份只会少算，因此逐项取大值，
 * 再压回 success + failure <= total，差额即结果待定的发射。
 * 这样首页卡片与统计详情页不会出现「203 / 200」这类对不上的数字。
 */
function pickAlignedSummary(candidates) {
  const list = (candidates || []).map(normalizeSummaryCounts).filter(Boolean)
  if (!list.length) return null
  const total = list.reduce((m, s) => Math.max(m, s.total), 0)
  const success = Math.min(list.reduce((m, s) => Math.max(m, s.success), 0), total)
  const failure = Math.min(list.reduce((m, s) => Math.max(m, s.failure), 0), total - success)
  return { total, success, failure }
}

function hasBreakdownRows(data) {
  if (!data) return false
  return !!(
    (data.byCountry && data.byCountry.length > 0)
    || (data.byAgency && data.byAgency.length > 0)
    || (data.byRocket && data.byRocket.length > 0)
  )
}

/** 汇总半包回来时不要冲掉页面上已有的排行（persist / 上一拍明细） */
function shouldKeepExistingBreakdown(partial, incoming, existing) {
  if (!partial) return false
  if (hasBreakdownRows(incoming)) return false
  return hasBreakdownRows(existing)
}

function countryRowSummary(persist, countryKey) {
  if (!persist || !countryKey) return null
  const rows = persist.byCountry || []
  const row = rows.find((c) => c && c.key === countryKey)
  if (!row) return null
  return {
    total: Number(row.total) || 0,
    success: Number(row.success) || 0,
    failure: Number(row.failure) || 0
  }
}

function reasonMessage(settled, fallback) {
  if (!settled || settled.status !== 'rejected') return fallback
  const reason = settled.reason
  if (!reason) return fallback
  return reason.message || String(reason) || fallback
}

/**
 * 合并 getGlobalSummary / getGlobalBreakdown 的 Promise.allSettled 结果。
 * persist / allPersist 可为本地过期快照。
 * @throws {Error} 两端都失败且没有任何可用快照
 */
function mergeGlobalLaunchStatsParts(input) {
  const year = Number(input && input.year) || 0
  const countryKey = (input && input.countryKey) || '_all'
  const summarySettled = input && input.summarySettled
  const breakdownSettled = input && input.breakdownSettled
  const persist = input && input.persist
  const allPersist = input && input.allPersist
  // 首页卡片那份年度总数，仅用于全部国家的头部对齐
  const homeTotal = countryKey === '_all' && Number(input && input.homeTotal) > 0
    ? Number(input.homeTotal)
    : null

  const emptySummary = { total: 0, success: 0, failure: 0 }
  let gotSummary = false
  let summaryResult = {
    year,
    summary: emptySummary,
    staleCache: false,
    clientStaleFallback: false,
    summaryPartial: true,
    breakdownReady: false
  }
  let breakdownResult = {
    byCountry: [],
    byAgency: [],
    byRocket: [],
    countryOptions: [],
    breakdownReady: false
  }

  if (summarySettled && summarySettled.status === 'fulfilled' && summarySettled.value) {
    summaryResult = summarySettled.value
    gotSummary = true
  } else if (persist && isUsableSummary(persist.summary)) {
    summaryResult = {
      year,
      summary: persist.summary,
      countryOptions: persist.countryOptions || [],
      staleCache: true,
      clientStaleFallback: true,
      summaryPartial: !!persist.summaryPartial,
      breakdownReady: false
    }
    gotSummary = true
  } else if (
    breakdownSettled
    && breakdownSettled.status === 'fulfilled'
    && breakdownSettled.value
    && isUsableSummary(breakdownSettled.value.summary)
  ) {
    summaryResult = {
      ...breakdownSettled.value,
      breakdownReady: false
    }
    gotSummary = true
  } else if (countryKey !== '_all' && allPersist) {
    const fromRow = countryRowSummary(allPersist, countryKey)
    if (fromRow && fromRow.total > 0) {
      summaryResult = {
        year,
        summary: fromRow,
        countryOptions: allPersist.countryOptions || [],
        staleCache: true,
        clientStaleFallback: true,
        summaryPartial: false,
        breakdownReady: false
      }
      gotSummary = true
    }
  }

  if (breakdownSettled && breakdownSettled.status === 'fulfilled' && breakdownSettled.value) {
    breakdownResult = breakdownSettled.value
  } else if (persist && hasBreakdownRows(persist)) {
    breakdownResult = {
      summary: persist.summary,
      byCountry: persist.byCountry || [],
      byAgency: persist.byAgency || [],
      byRocket: persist.byRocket || [],
      countryOptions: persist.countryOptions || [],
      staleCache: true,
      clientStaleFallback: true,
      breakdownReady: true
    }
  } else if (countryKey !== '_all' && allPersist && hasBreakdownRows(allPersist)) {
    const row = (allPersist.byCountry || []).find((c) => c && c.key === countryKey)
    breakdownResult = {
      byCountry: row ? [row] : [],
      byAgency: [],
      byRocket: [],
      countryOptions: allPersist.countryOptions || [],
      breakdownReady: !!(row && row.total),
      staleCache: true,
      clientStaleFallback: true,
      loadError: '该国家明细暂未就绪，已显示汇总'
    }
  } else if (isUsableSummary(summaryResult.summary) && Number(summaryResult.summary.total) > 0) {
    breakdownResult.loadError = reasonMessage(breakdownSettled, '明细加载失败')
  }

  const breakdownOk = breakdownSettled && breakdownSettled.status === 'fulfilled'
  const hasAnything = gotSummary
    || breakdownOk
    || hasBreakdownRows(breakdownResult)

  if (!hasAnything) {
    const reason = (summarySettled && summarySettled.reason)
      || (breakdownSettled && breakdownSettled.reason)
      || new Error('统计数据暂不可用')
    throw (reason instanceof Error ? reason : new Error(String(reason)))
  }

  const aligned = pickAlignedSummary([
    summaryResult.summary,
    breakdownResult.summary,
    persist && persist.summary,
    homeTotal != null ? { total: homeTotal } : null
  ]) || breakdownResult.summary || summaryResult.summary || emptySummary
  // 只知道总数、成败未知时按「部分汇总」处理（隐藏成功率与成败标签）
  const summaryPartial = Number(aligned.total) > 0
    && !Number(aligned.success)
    && !Number(aligned.failure)

  return {
    ...summaryResult,
    ...breakdownResult,
    summary: aligned,
    breakdownReady: !!breakdownResult.breakdownReady || hasBreakdownRows(breakdownResult),
    loadError: breakdownResult.loadError || '',
    staleCache: !!(summaryResult.staleCache || breakdownResult.staleCache),
    clientStaleFallback: !!(summaryResult.clientStaleFallback || breakdownResult.clientStaleFallback),
    summaryPartial
  }
}

function homeSummaryToGlobalPayload(home, year) {
  const total = home && home.globalThisYear != null ? Number(home.globalThisYear) : NaN
  if (!Number.isFinite(total) || total < 0) return null
  return {
    year: (home && home.year) || year,
    summary: { total, success: 0, failure: 0 },
    byCountry: [],
    byAgency: [],
    byRocket: [],
    countryOptions: [],
    summaryPartial: true,
    breakdownReady: false,
    staleCache: !!(home && home.staleCache),
    clientStaleFallback: !!(home && home.clientStaleFallback),
    loadError: '明细暂未就绪，已显示年度总数'
  }
}

module.exports = {
  isUsableSummary,
  pickAlignedSummary,
  hasBreakdownRows,
  shouldKeepExistingBreakdown,
  countryRowSummary,
  mergeGlobalLaunchStatsParts,
  homeSummaryToGlobalPayload
}
