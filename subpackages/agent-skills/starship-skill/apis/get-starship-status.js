/**
 * 原子接口：getStarshipStatus — 星舰当前状态（下一飞组合体 + 飞行准备清单）
 */
const { callProxy, text, failResult } = require('./call-proxy.js')

module.exports = async function getStarshipStatus() {
  const res = await callProxy('agentStarshipStatus')

  if (!res.success) {
    return failResult(
      res.message || '星舰状态数据暂未就绪。',
      '请告知用户数据暂时不可用，建议进入小程序「星舰进度」页面查看，或稍后重试。',
      '不要再重复调用本接口，也不要编造星舰状态。'
    )
  }

  const status = {
    booster: res.booster,
    ship: res.ship,
    checklist: res.checklist
  }

  const boosterText = res.booster.id
    ? `助推器 ${res.booster.id}（${res.booster.statusZh}${res.booster.progress != null ? `，进度 ${res.booster.progress}%` : ''}）`
    : '助推器信息待公布'
  const shipText = res.ship.id
    ? `飞船 ${res.ship.id}（${res.ship.statusZh}${res.ship.progress != null ? `，进度 ${res.ship.progress}%` : ''}）`
    : '飞船信息待公布'
  const checklistText = res.checklist.total > 0
    ? `飞行准备清单完成 ${res.checklist.done}/${res.checklist.total} 项`
    : ''

  return {
    isError: false,
    content: [text(
      `已查询到星舰下一飞组合体的当前状态：${boosterText}，${shipText}${checklistText ? `；${checklistText}` : ''}。` +
      `请为用户展示星舰状态卡片并用一两句话概括；如用户想看建设进度图、硬件清单和动态时间线，可引导其点击卡片进入小程序星舰进度页。` +
      `如用户接着问下次试飞时间，调用 getStarshipNextFlight。`
    )],
    structuredContent: status
  }
}
