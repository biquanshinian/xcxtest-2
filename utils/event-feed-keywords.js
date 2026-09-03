/**
 * DEFAULT_EVENT_ALERT_KEYWORDS / EVENT_WATCH_ACCOUNT_OPTIONS / getEventAlertKeywords
 * 主包「我的」页只需要这三项；完整 intel 逻辑在分包副本里。
 */
const DEFAULT_EVENT_ALERT_KEYWORDS = [
  '封路',
  'static fire',
  '静态点火',
  '回收',
  '推迟',
  'scrub',
  'Flight',
  '星舰'
]

const EVENT_WATCH_ACCOUNT_OPTIONS = [
  { screenName: 'SpaceX', label: 'SpaceX' },
  { screenName: 'Starlink', label: 'Starlink' },
  { screenName: 'NASASpaceflight', label: 'NSF' },
  { screenName: 'StarshipGazer', label: 'StarshipGazer' },
  { screenName: 'NASA', label: 'NASA' },
  { screenName: 'elonmusk', label: 'Elon Musk' },
  { screenName: 'JerryPikePhoto', label: 'Jerry Pike' },
  { screenName: 'CNSpaceflight', label: 'CNSpaceflight' },
  { screenName: 'InfographicTony', label: 'Tony Bela' },
  { screenName: 'LandSpace_Tech', label: '蓝箭航天' }
]

function getEventAlertKeywords(prefs) {
  const p = prefs && typeof prefs === 'object' ? prefs : {}
  if (!p.eventAlertKeywordsV1) return DEFAULT_EVENT_ALERT_KEYWORDS.slice()
  if (!Array.isArray(p.eventAlertKeywords)) return DEFAULT_EVENT_ALERT_KEYWORDS.slice()
  return p.eventAlertKeywords.map((s) => String(s || '').trim()).filter(Boolean)
}

module.exports = {
  DEFAULT_EVENT_ALERT_KEYWORDS,
  EVENT_WATCH_ACCOUNT_OPTIONS,
  getEventAlertKeywords
}
