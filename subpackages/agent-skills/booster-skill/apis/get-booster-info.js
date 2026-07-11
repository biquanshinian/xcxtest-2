/**
 * 原子接口：getBoosterInfo — 单枚助推器战绩 + 接力到助推器详情页
 */
const { callProxy, text, failResult } = require('./call-proxy.js')

module.exports = async function getBoosterInfo(args) {
  const serial = String((args && args.serial) || '').trim()
  if (!serial) {
    return failResult(
      '缺少 serial 参数。',
      '请向用户确认想查询哪枚助推器的编号（如 B1067、B1080），再调用本接口。',
      ''
    )
  }

  const res = await callProxy('agentBoosterInfo', { serial })

  if (!res.success || !res.item) {
    return failResult(
      res.message || `未找到编号为「${serial}」的助推器。`,
      '请如实告知用户，并确认编号格式（SpaceX 猎鹰助推器为 B+4 位数字，如 B1067）；也可调用 getRecoveryStats 查看复用次数最多的助推器列表。',
      '不要再以相同 serial 重复调用本接口，也不要编造助推器战绩。'
    )
  }

  const it = res.item

  return {
    isError: false,
    content: [text(
      `已查询到助推器 ${it.serial}（${it.rocketFamily || '未知型号'}，${it.statusZh}）：` +
      `累计飞行 ${it.flights} 次，着陆成功 ${it.successfulLandings}/${it.attemptedLandings} 次` +
      `${it.firstFlight ? `，首飞 ${it.firstFlight}` : ''}${it.lastFlight ? `，最近飞行 ${it.lastFlight}` : ''}。` +
      `请向用户介绍该助推器战绩（可结合 recentFlights 说明最近执行的任务），并告知可点击进入小程序查看完整飞行史。`
    )],
    structuredContent: it,
    handoff: () => ({
      query: `serial=${encodeURIComponent(it.serial)}`,
      payload: { source: 'agent', serial: it.serial, flights: it.flights }
    })
  }
}
