/**
 * 分包本地副本（主包 utils/ 已不放此文件，避免「主包未使用 JS」质量检查失败）。
 * 若修改逻辑，请同步更新：
 *   subpackages/progress-extra/utils/ll2-timeline-i18n.js
 *   subpackages/mission-sim/utils/ll2-timeline-i18n.js
 *   pages/mission-detail/utils/ll2-timeline-i18n.js
 * LL2 飞行时间线 abbrev / description → 中文
 * 供各分包 ll2-launch-timeline 副本在展示时回退汉化。
 */

const EXACT_ZH = {
  liftoff: '升空',
  ignition: '点火',
  startup: '启动',
  'max-q': '最大动压',
  'max q': '最大动压',
  maxq: '最大动压',
  meco: '一级发动机关机',
  'main engine cutoff': '一级发动机关机',
  'main engine cut-off': '一级发动机关机',
  'main engine cut off': '一级发动机关机',
  seco: '二级发动机关机',
  'second engine cutoff': '二级发动机关机',
  'second engine cut-off': '二级发动机关机',
  'stage separation': '级间分离',
  'hot staging': '热分离',
  'hot-staging': '热分离',
  'boostback burn': '返场点火',
  'entry burn': '再入点火',
  'landing burn': '着陆点火',
  landing: '着陆',
  splashdown: '溅落',
  'fairing deploy': '整流罩展开',
  'fairing deployment': '整流罩展开',
  'payload deploy': '载荷部署',
  'payload deployment': '载荷部署',
  'grid fin deploy': '栅格舵展开',
  'grid fins deploy': '栅格舵展开',
  'throttle down': '节流下降',
  'throttle up': '节流上升',
  'go for launch': '发射就绪',
  'go for commit': '进入不可中止段',
  'propellant load': '推进剂加注',
  'lox load': '液氧加注',
  'lng load': '液甲烷加注',
  'engine chill': '发动机预冷'
}

const PHRASE_RULES = [
  [/Main Engine Cut-?off/gi, '一级发动机关机'],
  [/Second Engine Cut-?off/gi, '二级发动机关机'],
  [/Stage Separation/gi, '级间分离'],
  [/Hot Staging/gi, '热分离'],
  [/Boostback Burn/gi, '返场点火'],
  [/Entry Burn/gi, '再入点火'],
  [/Landing Burn/gi, '着陆点火'],
  [/Fairing Deployment/gi, '整流罩展开'],
  [/Payload Deployment/gi, '载荷部署'],
  [/Grid Fins? Deploy(?:ment)?/gi, '栅格舵展开'],
  [/Max[-\s]?Q/gi, '最大动压'],
  [/\bLiftoff\b/gi, '升空'],
  [/\bSplashdown\b/gi, '溅落'],
  [/\bLanding\b/gi, '着陆'],
  [/\bIgnition\b/gi, '点火']
]

function hasUsableZh(text) {
  const raw = String(text || '').trim()
  if (!raw || !/[\u4e00-\u9fff]/.test(raw)) return false
  const leftover = raw.match(/[A-Za-z]{4,}/g) || []
  return leftover.filter((w) => !/^(SpaceX|NASA|MECO|SECO)$/i.test(w)).length === 0
}

function translateTimelineText(text) {
  const raw = String(text || '').trim()
  if (!raw) return ''
  if (hasUsableZh(raw)) return raw
  const exact = EXACT_ZH[raw.toLowerCase()]
  if (exact) return exact
  let s = raw
  for (let i = 0; i < PHRASE_RULES.length; i++) {
    s = s.replace(PHRASE_RULES[i][0], PHRASE_RULES[i][1])
  }
  s = s.replace(/\s{2,}/g, ' ').trim()
  return hasUsableZh(s) ? s : (s !== raw ? s : raw)
}

module.exports = {
  translateTimelineText,
  hasUsableZh
}
