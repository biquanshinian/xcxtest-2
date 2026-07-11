/**
 * 原子接口：getGlobalLaunchStats — 年度全球发射统计
 */
const { callProxy, text, failResult } = require('./call-proxy.js')

module.exports = async function getGlobalLaunchStats(args) {
  const year = args && args.year != null ? Number(args.year) : new Date().getUTCFullYear()

  const res = await callProxy('agentLaunchStats', { year })

  if (!res.success) {
    return failResult(
      res.message || `${year} 年的统计数据暂未就绪。`,
      '请告知用户统计数据暂时不可用，可建议进入小程序「全球发射统计」页面查看，或稍后重试。',
      '不要再以相同年份重复调用本接口，也不要编造统计数字。'
    )
  }

  const stats = {
    year: res.year,
    total: res.total,
    successCount: res.successCount,
    failureCount: res.failureCount,
    topAgencies: res.topAgencies || [],
    topCountries: res.topCountries || [],
    topRockets: res.topRockets || []
  }

  return {
    isError: false,
    content: [text(
      `已查询到 ${res.year} 年全球发射统计：总计 ${res.total} 次，成功 ${res.successCount} 次，失败 ${res.failureCount} 次` +
      (stats.topAgencies.length ? `，发射次数最多的机构是 ${stats.topAgencies[0].name}（${stats.topAgencies[0].total} 次）` : '') +
      `。请为用户展示统计卡片，并用一两句话概括；如用户想看完整排行与图表，可引导其点击卡片进入小程序统计页。`
    )],
    structuredContent: stats,
    handoff: () => ({
      query: `year=${stats.year}`,
      payload: { source: 'agent', year: stats.year }
    })
  }
}
