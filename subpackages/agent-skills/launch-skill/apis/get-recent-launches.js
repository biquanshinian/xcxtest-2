/**
 * 原子接口：getRecentLaunches — 近期已完成发射列表
 */
const { callProxy, text, failResult } = require('./call-proxy.js')

module.exports = async function getRecentLaunches(args) {
  const agencyKeyword = (args && args.agencyKeyword) || ''
  const limit = args && args.limit != null ? Number(args.limit) : 8

  const res = await callProxy('agentRecentLaunches', { agencyKeyword, limit })

  if (!res.success) {
    return failResult(
      res.message || '发射数据暂未就绪。',
      '请告知用户数据暂时不可用，建议稍后重试或进入小程序首页查看历史发射。',
      '不要再以相同参数重复调用本接口。'
    )
  }

  if (!res.items || !res.items.length) {
    return {
      isError: false,
      content: [text(
        `未查询到${agencyKeyword ? `发射商「${agencyKeyword}」的` : ''}近期发射记录。` +
        `请如实告知用户，可建议去掉发射商限定重新查询；不要虚构发射记录。`
      )],
      structuredContent: { total: 0, items: [] }
    }
  }

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
      `已查询到近期 ${items.length} 次已完成的发射任务（按时间倒序，statusZh 为发射结果，时间为北京时间）。` +
      `请为用户展示发射列表卡片，并概括说明成功/失败情况；如用户想了解某次任务详情，用对应 launchId 调用 getLaunchDetail。`
    )],
    structuredContent: {
      total: items.length,
      agencyKeyword: agencyKeyword || '',
      recent: true,
      items
    },
    _meta: {
      images: res.items.map((it) => ({ launchId: it.launchId, image: it.image || '' })),
      updatedAt: res.updatedAt || 0
    }
  }
}
