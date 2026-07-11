/**
 * 原子接口：getStarshipUpdates — 星舰最新动态（已翻译中文的事件流）
 */
const { callProxy, text, failResult } = require('./call-proxy.js')

module.exports = async function getStarshipUpdates(args) {
  const limit = args && args.limit != null ? Number(args.limit) : 5

  const res = await callProxy('agentStarshipUpdates', { limit })

  if (!res.success) {
    return failResult(
      res.message || '星舰动态数据暂未就绪。',
      '请告知用户数据暂时不可用，建议进入小程序「星舰进度」页面查看动态时间线，或稍后重试。',
      '不要再以相同参数重复调用本接口，也不要编造星舰动态。'
    )
  }

  return {
    isError: false,
    content: [text(
      `已查询到最近 ${res.total} 条星舰动态（按时间倒序，时间为北京时间，内容为中文）。` +
      `请挑选其中最重要的 2-3 条向用户概括（附时间与来源），不要逐条罗列全部；` +
      `如用户想看完整动态、图片与视频，可引导其进入小程序星舰进度页。`
    )],
    structuredContent: {
      total: res.total,
      items: res.items
    }
  }
}
