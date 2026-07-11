/**
 * 原子接口：getAgencyInfo — 发射商查询 + 接力到发射商详情页
 */
const { callProxy, text, failResult } = require('./call-proxy.js')

module.exports = async function getAgencyInfo(args) {
  const keyword = String((args && args.keyword) || '').trim()
  if (!keyword) {
    return failResult(
      '缺少 keyword 参数。',
      '请向用户确认想查询哪个发射商（如 SpaceX、CASC、蓝箭航天），再调用本接口。',
      ''
    )
  }

  const res = await callProxy('agentAgencyInfo', { keyword })

  if (!res.success || !res.item) {
    return failResult(
      res.message || `未找到与「${keyword}」匹配的发射商。`,
      '请如实告知用户，并建议改用英文名称或缩写（如 SpaceX、CASC、Rocket Lab）重新表述。',
      '不要再以相同 keyword 重复调用本接口，也不要编造发射商信息。'
    )
  }

  const a = res.item
  const info = {
    agencyId: a.agencyId,
    name: a.name,
    abbrev: a.abbrev,
    type: a.type,
    country: a.country,
    foundingYear: a.foundingYear,
    totalLaunchCount: a.totalLaunchCount,
    successfulLaunches: a.successfulLaunches,
    failedLaunches: a.failedLaunches,
    description: a.description
  }
  if (res.alternates && res.alternates.length) info.alternates = res.alternates

  return {
    isError: false,
    content: [text(
      `已查询到发射商「${a.name}」${a.abbrev ? `（${a.abbrev}）` : ''}：` +
      `${a.country || '未知国家'}${a.foundingYear ? `，${a.foundingYear} 年成立` : ''}` +
      (a.totalLaunchCount != null ? `，历史总发射 ${a.totalLaunchCount} 次` : '') +
      `。请用中文向用户介绍该机构（结合 description），并告知可点击进入小程序查看完整档案、火箭型号与回收统计。` +
      (info.alternates ? '如用户实际想查的是其他同名机构，可参考 alternates 列表向用户确认。' : '')
    )],
    structuredContent: info,
    handoff: () => ({
      query: `id=${encodeURIComponent(a.agencyId)}`,
      payload: {
        source: 'agent',
        agencyId: a.agencyId,
        name: a.name,
        abbrev: a.abbrev
      }
    })
  }
}
