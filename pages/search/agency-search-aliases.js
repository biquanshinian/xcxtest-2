/**
 * Space Devs 发射商条目多为英文。按 agencies id 增补中文/火箭常用称呼，参与拼音与汉字索引。
 * 中国商业发射商 id 来自 ll.thespacedevs.com（country=CN & type=Commercial）。
 */
const AGENCY_SEARCH_EXTRA_BY_ID = {
  194: '航天科工火箭 航天科工 快舟 快舟一号 快舟十一号 行云 ExPace 科工火箭 Kuaizhou',
  177: '长城工业 中国长城工业集团 长城公司 CGWIC',
  259: '蓝箭 蓝箭航天 朱雀 朱雀二号 朱雀三号 ZhuQue Zhuque ZQ-2 YQ',
  263: '零壹空间 OS-X OS-M OS-X1 OneSpace',
  272: '中国火箭 航天科工火箭技术 科工火箭 CHNR',
  274: '星际荣耀 双曲线 双曲线一号 双曲线二号 Hyperbola 中国星际荣耀',
  1021: '星河动力 谷神星 智神星 Ceres Pallas',
  1040: '中科宇航 力箭 力箭一号 力箭二号 ZhongKe Lijian ZK-1A ZK-2A CAS 中科',
  1049: '天兵科技 天龙 天龙二号 天龙三号 Tianlong Space Pioneer',
  1080: '东方空间 引力 引力一号 Gravity Orienspace',
  1102: '深蓝航天 星云 星云一号 雷鸟 DeepBlue 深蓝'
}

function getAgencySearchExtraRaw(agency) {
  if (!agency || agency.id == null) return ''
  const extra = AGENCY_SEARCH_EXTRA_BY_ID[agency.id]
  return typeof extra === 'string' ? extra : ''
}

module.exports = {
  AGENCY_SEARCH_EXTRA_BY_ID,
  getAgencySearchExtraRaw
}
