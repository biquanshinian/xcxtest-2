// 冒烟：needs_review 改写判定（剥引导语 + 素材片段比对）
const h = require('../cloudfunctions/adminGateway/oaStudioHelpers.js')

const src =
  'SpaceX is targeting Friday, Aug 7 for the launch of 28 Starlink satellites from SLC-40. ' +
  'The Falcon 9 booster supporting this mission previously launched 12 times, and recovery is planned ' +
  'on the droneship Just Read The Instructions stationed in the Atlantic Ocean. Weather officials ' +
  'forecast 80 percent favorable conditions. [[IMG:1]] Meanwhile in China, a Long March 6A lifted off ' +
  'from Taiyuan carrying a new group of internet satellites into polar orbit, marking the 40th orbital ' +
  'launch attempt of the year for the country. [[IMG:2]] Officials confirmed all satellites reached orbit.'

const notice = '> 自动生成暂不可用（混元超时）。以下为素材整理稿，请人工改写后保存再推送。'

// 1) 兜底稿原样（含引导语 + 素材照搬）→ 应判定为未改写
const fallbackMd = `# 标题\n\n${notice}\n\n${src}\n\n---\n\n关注我们`
console.log('照搬+引导语 → 拦截应为 true:', h.looksLikeUnrewrittenSource(fallbackMd, src))

// 2) 删了引导语但正文仍照搬 → 仍应拦截
const stripped = h.stripLlmFallbackNotice(fallbackMd)
console.log('引导语已剥离:', !/自动生成暂不可用/.test(stripped))
console.log('照搬无引导语 → 拦截应为 true:', h.looksLikeUnrewrittenSource(stripped, src))

// 3) 实质改写（中文重写）但忘删引导语 → 应放行
const rewritten =
  `${notice}\n\n# 星链再出发\n\n本周五，SpaceX 计划在卡角 SLC-40 工位再送 28 颗星链上天，` +
  '这枚猎鹰九号已经飞过 12 次，回收船在大西洋等着接它。[[IMG:1]]\n\n' +
  '同一天太原那边长征六号甲也点了火，一批互联网卫星进了极地轨道，这是今年国内第 40 次轨道发射。[[IMG:2]]\n\n' +
  '官方确认卫星全部入轨，成功率依旧在线。'
console.log('实质改写(留引导语) → 拦截应为 false:', h.looksLikeUnrewrittenSource(rewritten, src))
console.log(
  '改写稿剥引导语后不再含关键词:',
  !/自动生成暂不可用|以下为素材整理稿/.test(h.stripLlmFallbackNotice(rewritten))
)

// 4) 素材太短（<60 归一化字符）→ 不拦（避免误伤）
console.log('短素材 → 拦截应为 false:', h.looksLikeUnrewrittenSource('随便写点', '短素材'))

// 5) 旧稿无 sourceSlottedBody → 不拦
console.log('无素材 → 拦截应为 false:', h.looksLikeUnrewrittenSource(fallbackMd, ''))
