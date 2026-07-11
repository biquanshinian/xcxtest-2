/**
 * 原子接口：getLaunchDetail — 单次发射详情 + 接力到任务详情页
 */
const { callProxy, text, failResult } = require('./call-proxy.js')

module.exports = async function getLaunchDetail(args) {
  const launchId = String((args && args.launchId) || '').trim()
  if (!launchId) {
    return failResult(
      '缺少 launchId 参数。',
      'launchId 必须取自 getUpcomingLaunches 或 getRecentLaunches 返回的 launchId 原值，请先调用其中一个接口获取。',
      '不要编造 launchId。'
    )
  }

  const res = await callProxy('agentLaunchDetail', { launchId })

  if (!res.success || !res.item) {
    return failResult(
      res.message || `未找到 ID 为 ${launchId} 的发射任务。`,
      '请确认 launchId 是否取自上游接口的返回值；可先调用 getUpcomingLaunches 或 getRecentLaunches 重新获取。',
      '不要再以相同 launchId 重复调用本接口。'
    )
  }

  const it = res.item
  const detail = {
    launchId: it.launchId,
    name: it.name,
    statusZh: it.statusZh,
    netBeijing: it.netBeijing,
    agency: it.agency,
    rocket: it.rocket,
    pad: it.pad,
    location: it.location,
    orbit: it.orbit || '',
    missionName: it.missionName || '',
    description: it.description || ''
  }

  // 判断任务是已完成还是即将发射，用于接力页 query 的 type 参数
  const netTime = Date.parse(it.netUtc || '')
  const isCompleted = !isNaN(netTime) && netTime < Date.now() - 2 * 3600 * 1000

  return {
    isError: false,
    content: [text(
      `已查询到发射任务「${it.name}」的详情（状态：${it.statusZh || '未知'}，北京时间：${it.netBeijing || '待定'}）。` +
      `请用中文向用户简要介绍该任务（发射商、火箭、地点、任务说明），并告知可点击进入小程序查看完整详情、倒计时与直播信息。`
    )],
    structuredContent: detail,
    handoff: () => ({
      query: `id=${encodeURIComponent(it.launchId)}&type=${isCompleted ? 'completed' : 'upcoming'}`,
      payload: {
        source: 'agent',
        launchId: it.launchId,
        name: it.name,
        netUtc: it.netUtc || '',
        statusZh: it.statusZh || ''
      }
    })
  }
}
