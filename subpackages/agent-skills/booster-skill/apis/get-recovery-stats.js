/**
 * 原子接口：getRecoveryStats — 全球可回收火箭回收统计总览
 */
const { callProxy, text, failResult } = require('./call-proxy.js')

module.exports = async function getRecoveryStats(args) {
  const limit = args && args.limit != null ? Number(args.limit) : 5

  const res = await callProxy('agentRecoveryStats', { limit })

  if (!res.success) {
    return failResult(
      res.message || '助推器族谱数据暂未就绪。',
      '请告知用户数据暂时不可用，建议进入小程序「全球可回收火箭族谱」页面查看，或稍后重试。',
      '不要再重复调用本接口，也不要编造回收统计数字。'
    )
  }

  const stats = {
    totalBoosters: res.totalBoosters,
    activeBoosters: res.activeBoosters,
    totalFlights: res.totalFlights,
    totalLandings: res.totalLandings,
    totalAttempts: res.totalAttempts,
    landingSuccessRate: res.landingSuccessRate,
    topReused: res.topReused
  }

  const top = stats.topReused && stats.topReused[0]

  return {
    isError: false,
    content: [text(
      `已查询到全球可回收火箭助推器统计：族谱共收录 ${stats.totalBoosters} 枚助推器（现役 ${stats.activeBoosters} 枚），` +
      `累计飞行 ${stats.totalFlights} 次，着陆成功 ${stats.totalLandings}/${stats.totalAttempts} 次` +
      `${stats.landingSuccessRate ? `（成功率 ${stats.landingSuccessRate}）` : ''}` +
      `${top ? `；复用次数最多的是 ${top.serial}（${top.flights} 次飞行）` : ''}。` +
      `请向用户概括统计并列出 topReused 排行；如用户想了解某一枚助推器，用其编号调用 getBoosterInfo；` +
      `完整族谱可引导用户进入小程序「全球可回收火箭族谱」页面。`
    )],
    structuredContent: stats
  }
}
