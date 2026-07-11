/**
 * 原子接口：getRoadClosures — 星舰基地道路封闭通知
 */
const { callProxy, text, failResult } = require('./call-proxy.js')

module.exports = async function getRoadClosures() {
  const res = await callProxy('agentStarshipRoadClosures')

  if (!res.success) {
    return failResult(
      res.message || '道路封闭数据暂未就绪。',
      '请告知用户数据暂时不可用，稍后重试。',
      '不要再重复调用本接口。'
    )
  }

  if (!res.hasClosure) {
    return {
      isError: false,
      content: [text(
        '星舰基地（Starbase）当前没有生效中的道路封闭通知。' +
        '请如实告知用户；道路封闭通常在试飞或静态点火测试前发布，可建议用户关注小程序星舰进度页的封路提醒。'
      )],
      structuredContent: { hasClosure: false, items: [] }
    }
  }

  return {
    isError: false,
    content: [text(
      `星舰基地当前有 ${res.items.length} 条生效中的道路封闭通知（时间为北京时间），通常预示即将进行测试或试飞。` +
      `请向用户逐条转述通知内容与时间段，并提示可进入小程序星舰进度页查看基地地图与实时动态。`
    )],
    structuredContent: {
      hasClosure: true,
      items: res.items
    }
  }
}
