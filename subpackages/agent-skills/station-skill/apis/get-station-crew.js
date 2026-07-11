/**
 * 原子接口：getStationCrew — 空间站在轨乘组名单 + 接力到空间站详情页
 */
const { callProxy, text, failResult } = require('./call-proxy.js')

const STATION_ALIASES = [
  { keys: ['tiangong', '天宫', '中国空间站', 'css'], match: '天宫' },
  { keys: ['iss', '国际空间站', 'international'], match: 'ISS' }
]

function matchStation(station, keyword) {
  if (!keyword) return true
  const kw = keyword.trim().toLowerCase()
  if (!kw) return true
  const name = (station.name || '').toLowerCase()
  const nameEn = (station.nameEn || '').toLowerCase()
  if (name.includes(kw) || nameEn.includes(kw)) return true
  for (const alias of STATION_ALIASES) {
    if (alias.keys.some((k) => kw.includes(k) || k.includes(kw))) {
      if (name.includes(alias.match.toLowerCase()) || (station.name || '').includes(alias.match)) return true
    }
  }
  return false
}

module.exports = async function getStationCrew(args) {
  const stationKeyword = String((args && args.stationKeyword) || '').trim()

  const res = await callProxy('agentStationStatus')

  if (!res.success) {
    return failResult(
      res.message || '空间站数据暂未就绪。',
      '请告知用户数据暂时不可用，稍后重试。',
      '不要再重复调用本接口，也不要编造乘组名单。'
    )
  }

  const matched = res.stations.filter((s) => matchStation(s, stationKeyword))
  if (!matched.length) {
    return failResult(
      `未找到与「${stationKeyword}」匹配的在轨空间站。`,
      `当前在轨的空间站有：${res.stations.map((s) => s.name).join('、')}。请改用这些名称重新查询，或不传 stationKeyword 查看全部。`,
      '不要编造空间站或乘组信息。'
    )
  }

  const stations = matched.map((s) => ({
    stationId: s.stationId,
    name: s.name,
    crewCount: s.crewCount,
    crew: s.crew
  }))

  const single = stations.length === 1 ? stations[0] : null

  return {
    isError: false,
    content: [text(
      (single
        ? `已查询到${single.name}当前在轨乘组共 ${single.crewCount} 人。`
        : `已查询到 ${stations.length} 个空间站的在轨乘组名单。`) +
      `请向用户列出乘组（姓名、国籍、所属机构、所在任务）；宇航员姓名为英文/拼音原文，中国航天员可按拼音还原中文名（不确定时保留原文）。` +
      `如用户想看乘组头像与任务详情，可点击进入小程序空间站详情页。`
    )],
    structuredContent: { total: stations.length, stations },
    handoff: single ? () => ({
      query: `id=${encodeURIComponent(single.stationId)}`,
      payload: { source: 'agent', stationId: single.stationId, name: single.name }
    }) : undefined
  }
}
