/**
 * 原子接口：getStarshipNextFlight — 下一次星舰试飞 + 接力到任务详情页
 */
const { callProxy, text, failResult } = require('./call-proxy.js')

module.exports = async function getStarshipNextFlight() {
  const res = await callProxy('agentStarshipNextFlight')

  if (!res.success || !res.item) {
    if (res.error === 'not_found') {
      return {
        isError: false,
        content: [text(
          '当前发射日程中暂无已排期的星舰试飞任务，官方可能尚未公布下次试飞日期。' +
          '请如实告知用户，并建议进入小程序星舰进度页关注最新动态；不要编造试飞日期。'
        )],
        structuredContent: { scheduled: false }
      }
    }
    return failResult(
      res.message || '发射数据暂未就绪。',
      '请告知用户数据暂时不可用，稍后重试。',
      '不要再重复调用本接口。'
    )
  }

  const it = res.item
  const netTime = Date.parse(it.netUtc || '')
  const isCompleted = !isNaN(netTime) && netTime < Date.now() - 2 * 3600 * 1000

  return {
    isError: false,
    content: [text(
      `已查询到下一次星舰试飞「${it.name}」：状态 ${it.statusZh || '未知'}，预计北京时间 ${it.netBeijing || '待定'}，发射地点 ${it.location || '星舰基地'}。` +
      `请向用户介绍该任务（结合 description），提醒发射时间可能调整以实际为准，并告知可点击进入小程序查看倒计时与直播。`
    )],
    structuredContent: {
      scheduled: true,
      launchId: it.launchId,
      name: it.name,
      statusZh: it.statusZh,
      netBeijing: it.netBeijing,
      rocket: it.rocket,
      location: it.location,
      missionName: it.missionName || '',
      description: it.description || ''
    },
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
