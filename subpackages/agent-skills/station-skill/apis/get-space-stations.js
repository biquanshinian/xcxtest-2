/**
 * 原子接口：getSpaceStations — 在轨空间站概览
 */
const { callProxy, text, failResult } = require('./call-proxy.js')

module.exports = async function getSpaceStations() {
  const res = await callProxy('agentStationStatus')

  if (!res.success) {
    return failResult(
      res.message || '空间站数据暂未就绪。',
      '请告知用户数据暂时不可用，建议进入小程序「监控中心」页面查看空间站动态，或稍后重试。',
      '不要再重复调用本接口，也不要编造空间站信息。'
    )
  }

  const stations = res.stations.map((s) => ({
    stationId: s.stationId,
    name: s.name,
    nameEn: s.nameEn,
    statusZh: s.statusZh,
    founded: s.founded,
    orbit: s.orbit,
    owners: s.owners,
    crewCount: s.crewCount,
    dockedVehicles: s.dockedVehicles
  }))

  const summary = stations
    .map((s) => `${s.name}在轨 ${s.crewCount} 人、停靠 ${s.dockedVehicles.length} 艘飞行器`)
    .join('；')

  return {
    isError: false,
    content: [text(
      `已查询到当前 ${stations.length} 个在轨运营的空间站：${summary}（对接时间为北京时间）。` +
      `请向用户概括各站现状（可结合 dockedVehicles 说明载人/货运飞行器）；` +
      `如用户想知道具体乘组名单，调用 getStationCrew；如想看轨道与更多细节，可引导进入小程序监控中心。`
    )],
    structuredContent: { total: stations.length, stations }
  }
}
