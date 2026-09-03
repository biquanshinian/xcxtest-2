/**
 * 天象日历：每年重复的流星雨 / 二分二至按月日套到目标年；
 * 日食、冲日、大距、特定满月等一次性事件按年表维护，不跨年复用。
 *
 * 小程序副本在 pages/space-explore/astro-events.js（勿放主包，质量扫描会报未使用）。
 * 云函数 morningBriefing 有一份逐字副本（无法引用小程序源码）。
 */

function beijingDateStr(now) {
  const ms = now == null
    ? Date.now()
    : (now instanceof Date ? now.getTime() : new Date(now).getTime())
  const t = Number.isFinite(ms) ? ms : Date.now()
  return new Date(t + 8 * 3600 * 1000).toISOString().slice(0, 10)
}

function beijingYear(now) {
  return Number(beijingDateStr(now).slice(0, 4))
}

/** 每年大致固定（±1 天） */
const RECURRING_EVENTS = [
  { md: '01-03', title: '象限仪座流星雨极大', icon: '☄️', briefingIcon: 'meteor', desc: 'ZHR~120，月光干扰较小', category: 'meteor' },
  { md: '04-22', title: '天琴座流星雨极大', icon: '☄️', briefingIcon: 'meteor', desc: 'ZHR~18，辐射点在织女星附近', category: 'meteor' },
  { md: '05-06', title: '宝瓶座η流星雨极大', icon: '☄️', briefingIcon: 'meteor', desc: 'ZHR~50，哈雷彗星碎片', category: 'meteor' },
  { md: '06-21', title: '夏至', icon: '☀️', briefingIcon: 'solstice', desc: '北半球白昼最长', category: 'solstice' },
  { md: '07-28', title: '宝瓶座δ南流星雨极大', icon: '☄️', briefingIcon: 'meteor', desc: 'ZHR~25', category: 'meteor' },
  { md: '08-12', title: '英仙座流星雨极大', icon: '☄️', briefingIcon: 'meteor', desc: 'ZHR~100，年度最佳流星雨之一', category: 'meteor' },
  { md: '09-22', title: '秋分', icon: '🍂', briefingIcon: 'solstice', desc: '昼夜等长', category: 'solstice' },
  { md: '10-21', title: '猎户座流星雨极大', icon: '☄️', briefingIcon: 'meteor', desc: 'ZHR~20，哈雷彗星碎片', category: 'meteor' },
  { md: '11-04', title: '金牛座南流星雨极大', icon: '☄️', briefingIcon: 'meteor', desc: 'ZHR~5，偶有明亮火流星', category: 'meteor' },
  { md: '11-17', title: '狮子座流星雨极大', icon: '☄️', briefingIcon: 'meteor', desc: 'ZHR~15', category: 'meteor' },
  { md: '12-14', title: '双子座流星雨极大', icon: '☄️', briefingIcon: 'meteor', desc: 'ZHR~150，年度最佳', category: 'meteor' },
  { md: '12-21', title: '冬至', icon: '❄️', briefingIcon: 'solstice', desc: '北半球白昼最短', category: 'solstice' }
]

/** 一次性天象，不按月日复用到其他年份 */
const YEAR_SPECIFIC_EVENTS = {
  2026: [
    { md: '01-21', title: '满月', icon: '🌕', briefingIcon: 'moon', desc: '狼月 Wolf Moon', category: 'solstice' },
    { md: '02-01', title: '金星东大距', icon: '✨', briefingIcon: 'planet', desc: '日落后西方低空可见', category: 'planet' },
    { md: '02-17', title: '水星西大距', icon: '🌟', briefingIcon: 'planet', desc: '日出前东方低空可见', category: 'planet' },
    { md: '03-29', title: '日偏食', icon: '🌑', briefingIcon: 'eclipse', desc: '亚洲部分地区可见', category: 'eclipse' },
    { md: '05-31', title: '火星冲日', icon: '🔴', briefingIcon: 'planet', desc: '火星距地球最近，整夜可见', category: 'planet' },
    { md: '08-12', title: '日全食', icon: '🌑', briefingIcon: 'eclipse', desc: '西伯利亚、格陵兰和大西洋可见全食', category: 'eclipse' }
  ]
}

function hydrate(year, row) {
  const date = year + '-' + row.md
  return {
    id: date + '_' + row.title,
    date,
    title: row.title,
    icon: row.icon,
    briefingIcon: row.briefingIcon,
    desc: row.desc,
    category: row.category
  }
}

function buildAstroEvents(year) {
  const y = Number(year)
  const yy = Number.isFinite(y) && y >= 1957 ? y : beijingYear()
  const list = RECURRING_EVENTS.map((row) => hydrate(yy, row))
  const extra = YEAR_SPECIFIC_EVENTS[yy] || []
  for (let i = 0; i < extra.length; i++) list.push(hydrate(yy, extra[i]))
  list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  return list
}

function toBriefingShape(ev) {
  if (!ev) return null
  return {
    date: ev.date,
    title: ev.title,
    icon: ev.briefingIcon || ev.icon,
    desc: ev.desc,
    category: ev.category
  }
}

function getTodayAstroEvent(today) {
  const dateStr = String(today || beijingDateStr())
  const year = Number(dateStr.slice(0, 4))
  if (!Number.isFinite(year) || dateStr.length < 10) return null
  const events = buildAstroEvents(year)
  for (let i = 0; i < events.length; i++) {
    if (events[i].date === dateStr) return toBriefingShape(events[i])
  }
  return null
}

/** 覆盖一组日期所在年份（跨年「明天」提醒用） */
function buildAstroEventsCovering(dateStrs) {
  const years = []
  const seen = Object.create(null)
  const list = Array.isArray(dateStrs) ? dateStrs : [dateStrs]
  for (let i = 0; i < list.length; i++) {
    const y = Number(String(list[i] || '').slice(0, 4))
    if (!Number.isFinite(y) || y < 1957 || seen[y]) continue
    seen[y] = true
    years.push(y)
  }
  const out = []
  for (let i = 0; i < years.length; i++) {
    const evs = buildAstroEvents(years[i])
    for (let j = 0; j < evs.length; j++) out.push(evs[j])
  }
  return out
}

module.exports = {
  beijingDateStr,
  beijingYear,
  RECURRING_EVENTS,
  YEAR_SPECIFIC_EVENTS,
  buildAstroEvents,
  buildAstroEventsCovering,
  getTodayAstroEvent
}
