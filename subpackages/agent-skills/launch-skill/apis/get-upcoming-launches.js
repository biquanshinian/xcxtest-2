/**
 * 原子接口：getUpcomingLaunches — 即将发射列表
 */
const { callProxy, text, failResult } = require('./call-proxy.js')

module.exports = async function getUpcomingLaunches(args) {
  const days = args && args.days != null ? Number(args.days) : 7
  const agencyKeyword = (args && args.agencyKeyword) || ''
  const limit = args && args.limit != null ? Number(args.limit) : 8

  const res = await callProxy('agentUpcomingLaunches', { days, agencyKeyword, limit })

  if (!res.success) {
    return failResult(
      res.message || '发射数据暂未就绪。',
      '请告知用户数据暂时不可用，建议稍后重试或进入小程序首页查看。',
      '不要再以相同参数重复调用本接口。'
    )
  }

  if (!res.items || !res.items.length) {
    const scope = agencyKeyword ? `发射商「${agencyKeyword}」在` : ''
    return {
      isError: false,
      content: [text(
        `${scope}未来 ${res.days} 天内没有已排期的发射任务。` +
        `请如实告知用户，并建议扩大时间范围（如未来 30 天）或去掉发射商限定后再查询；不要虚构发射任务。`
      )],
      structuredContent: { total: 0, days: res.days, items: [] }
    }
  }

  // 卡片渲染用精简条目（图片走 _meta，对 LLM 不可见）
  const items = res.items.map((it) => ({
    launchId: it.launchId,
    name: it.name,
    statusZh: it.statusZh,
    netBeijing: it.netBeijing,
    agency: it.agency,
    rocket: it.rocket,
    location: it.location
  }))

  return {
    isError: false,
    content: [text(
      `已查询到未来 ${res.days} 天内的 ${items.length} 次发射任务（时间均为北京时间）。` +
      `请为用户展示发射列表卡片，并用一句话概括最近的一次发射；如用户想了解某次任务详情，用对应 launchId 调用 getLaunchDetail。`
    )],
    structuredContent: {
      total: items.length,
      days: res.days,
      agencyKeyword: agencyKeyword || '',
      items
    },
    _meta: {
      images: res.items.map((it) => ({ launchId: it.launchId, image: it.image || '' })),
      updatedAt: res.updatedAt || 0
    }
  }
}
