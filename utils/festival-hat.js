/**
 * 节日专属帽 · 日期解析（星问欢迎头像 / 首页倒计时圆图共用）
 *
 * 生命周期：节日窗口内展示对应帽（国办法定假 + 圣诞固定公历窗）。
 * 每年放假安排由国务院办公厅另行通知，区间会变 —— 必须按年维护到至少 2030。
 *
 * 数据分层：
 * 1) OFFICIAL_HOLIDAY_WINDOWS —— 已发布国办通知的准确放假闭区间（优先）
 * 2) LUNAR_FESTIVAL_ANCHORS + 放假办法推算 —— 未发通知年份（2027–2030）的预估窗口
 * 3) christmas —— 每年 12/24–12/26（非国办假，固定公历）
 *    国办通知发布后：把该年写入 OFFICIAL，预估自动被覆盖
 *
 * UI 组件：components/festival-hat（按圆直径 size rpx 缩放贴合）
 * 开发：FESTIVAL_HAT_DEV_MODE=true 时循环预览；看完改 false
 */

/** ★ 看完效果后改回 false 再上线 */
const FESTIVAL_HAT_DEV_MODE = false

/** 开发预览轮播间隔（ms） */
const DEV_CYCLE_MS = 2800

/** 表覆盖上界（含）；超年无数据则不戴帽 */
const HOLIDAY_TABLE_THROUGH_YEAR = 2030

const FESTIVAL_HATS = [
  { id: 'spring', name: '春节', tip: '贴头红绒帽' },
  { id: 'duanwu', name: '端午节', tip: '艾叶发环' },
  { id: 'zhongqiu', name: '中秋节', tip: '月兔耳饰' },
  { id: 'guoqing', name: '国庆', tip: '红星发带' },
  { id: 'laodong', name: '劳动节', tip: '贴头矮盔' },
  { id: 'christmas', name: '圣诞节', tip: '圣诞软帽' }
]

/**
 * 已发布：国务院办公厅「部分节假日安排」通知（放假调休区间，闭区间）
 * 中秋与国庆合并时：中秋取正日起至合并假末日，国庆取整段；匹配序让中秋盖重叠日
 */
const OFFICIAL_HOLIDAY_WINDOWS = {
  2024: {
    // 国办发明电〔2023〕7号
    spring: [[2024, 2, 10], [2024, 2, 17]],
    laodong: [[2024, 5, 1], [2024, 5, 5]],
    duanwu: [[2024, 6, 8], [2024, 6, 10]], // 6/10 放假与周末连休
    zhongqiu: [[2024, 9, 15], [2024, 9, 17]],
    guoqing: [[2024, 10, 1], [2024, 10, 7]],
    // 圣诞非国办假，固定公历窗口（平安夜–节礼日）
    christmas: [[2024, 12, 24], [2024, 12, 26]]
  },
  2025: {
    // 国办发明电〔2024〕12号
    spring: [[2025, 1, 28], [2025, 2, 4]],
    laodong: [[2025, 5, 1], [2025, 5, 5]],
    duanwu: [[2025, 5, 31], [2025, 6, 2]],
    zhongqiu: [[2025, 10, 6], [2025, 10, 8]],
    guoqing: [[2025, 10, 1], [2025, 10, 8]],
    christmas: [[2025, 12, 24], [2025, 12, 26]]
  },
  2026: {
    // 国办发明电〔2025〕7号
    spring: [[2026, 2, 15], [2026, 2, 23]],
    laodong: [[2026, 5, 1], [2026, 5, 5]],
    duanwu: [[2026, 6, 19], [2026, 6, 21]],
    zhongqiu: [[2026, 9, 25], [2026, 9, 27]],
    guoqing: [[2026, 10, 1], [2026, 10, 7]],
    christmas: [[2026, 12, 24], [2026, 12, 26]]
  }
}

/**
 * 农历节日公历正日（正月初一 / 五月初五 / 八月十五）
 * 用于未发国办通知年份的办法推算；正日本身不随调休改变
 */
const LUNAR_FESTIVAL_ANCHORS = {
  2027: { cny: [2, 6], duanwu: [6, 9], zhongqiu: [9, 15] },
  2028: { cny: [1, 26], duanwu: [5, 28], zhongqiu: [10, 3] },
  2029: { cny: [2, 13], duanwu: [6, 16], zhongqiu: [9, 22] },
  2030: { cny: [2, 3], duanwu: [6, 5], zhongqiu: [9, 12] }
}

/** 重叠日优先级 */
const MATCH_ORDER = ['spring', 'duanwu', 'zhongqiu', 'laodong', 'guoqing', 'christmas']

function _ymdParts(d) {
  return [d.getFullYear(), d.getMonth() + 1, d.getDate()]
}

function _dateFromParts(y, m, day) {
  return new Date(y, m - 1, day)
}

function _addDays(date, n) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  d.setDate(d.getDate() + n)
  return d
}

function _dayStart(y, m, day) {
  return _dateFromParts(y, m, day).getTime()
}

function _inWindow(curTs, startArr, endArr) {
  if (!startArr || !endArr) return false
  const a = _dayStart(startArr[0], startArr[1], startArr[2])
  const b = _dayStart(endArr[0], endArr[1], endArr[2])
  return curTs >= a && curTs <= b
}

/**
 * 按《全国年节及纪念日放假办法》（2025 起）近似推算 3 天小长假：
 * 逢周三仅当日；其余连休成 3 天（调休细节以当年国办通知为准）
 */
function _estimateThreeDay(y, m, day) {
  const date = _dateFromParts(y, m, day)
  const dow = date.getDay() // 0=日 … 3=三 … 6=六
  if (dow === 3) {
    const one = _ymdParts(date)
    return [one, one]
  }
  let startOff = 0
  if (dow === 0) startOff = -1 // 日：六–一
  else if (dow === 1) startOff = -2 // 一：六–一
  else if (dow === 2) startOff = -2 // 二：日–二
  // 四/五/六：当日连休 3 天
  const start = _addDays(date, startOff)
  const end = _addDays(start, 2)
  return [_ymdParts(start), _ymdParts(end)]
}

/**
 * 未发通知年份：按办法原则预估
 * - 春节：农历除夕起 8 天
 * - 劳动节：5/1–5/5
 * - 端午/中秋：正日 ± 连休 3 天（周三仅 1 天）
 * - 国庆：10/1–10/7；中秋落入国庆周则合并至 10/8，中秋帽自正日起
 */
function _estimateYearWindows(y, anchors) {
  if (!anchors) return null
  const cny = _dateFromParts(y, anchors.cny[0], anchors.cny[1])
  const eve = _addDays(cny, -1)
  const springEnd = _addDays(eve, 7)

  const duanwu = _estimateThreeDay(y, anchors.duanwu[0], anchors.duanwu[1])
  const zqM = anchors.zhongqiu[0]
  const zqD = anchors.zhongqiu[1]
  const zqTs = _dayStart(y, zqM, zqD)
  const gqStartTs = _dayStart(y, 10, 1)
  const gqEndTs = _dayStart(y, 10, 7)

  let guoqing = [[y, 10, 1], [y, 10, 7]]
  let zhongqiu = _estimateThreeDay(y, zqM, zqD)
  if (zqTs >= gqStartTs && zqTs <= gqEndTs) {
    guoqing = [[y, 10, 1], [y, 10, 8]]
    zhongqiu = [[y, zqM, zqD], [y, 10, 8]]
  }

  return {
    spring: [_ymdParts(eve), _ymdParts(springEnd)],
    laodong: [[y, 5, 1], [y, 5, 5]],
    duanwu,
    zhongqiu,
    guoqing,
    christmas: [[y, 12, 24], [y, 12, 26]],
    _estimated: true
  }
}

/** @returns {object|null} 该年节日窗口表 */
function getHolidayWindowsForYear(y) {
  if (OFFICIAL_HOLIDAY_WINDOWS[y]) return OFFICIAL_HOLIDAY_WINDOWS[y]
  if (y >= 2027 && y <= HOLIDAY_TABLE_THROUGH_YEAR && LUNAR_FESTIVAL_ANCHORS[y]) {
    return _estimateYearWindows(y, LUNAR_FESTIVAL_ANCHORS[y])
  }
  return null
}

function _tablesAroundYear(y) {
  const out = []
  const a = getHolidayWindowsForYear(y)
  const b = getHolidayWindowsForYear(y - 1)
  const c = getHolidayWindowsForYear(y + 1)
  if (a) out.push(a)
  if (b) out.push(b)
  if (c) out.push(c)
  return out
}

function _matchFestival(id, y, m, day) {
  const curTs = _dayStart(y, m, day)
  const tables = _tablesAroundYear(y)
  for (let i = 0; i < tables.length; i++) {
    const win = tables[i][id]
    if (win && _inWindow(curTs, win[0], win[1])) return true
  }
  return false
}

function getFestivalHatMeta(id) {
  if (!id) return null
  for (let i = 0; i < FESTIVAL_HATS.length; i++) {
    if (FESTIVAL_HATS[i].id === id) return FESTIVAL_HATS[i]
  }
  return null
}

/**
 * 生产模式：仅在法定放假期间（官方表或 2027–2030 预估）返回帽 id
 * @param {Date} [date]
 */
function resolveFestivalHatId(date) {
  const d = date instanceof Date ? date : new Date()
  const y = d.getFullYear()
  const m = d.getMonth() + 1
  const day = d.getDate()
  for (let i = 0; i < MATCH_ORDER.length; i++) {
    const id = MATCH_ORDER[i]
    if (_matchFestival(id, y, m, day)) return id
  }
  return ''
}

function isFestivalHatDevMode() {
  return !!FESTIVAL_HAT_DEV_MODE
}

function listFestivalHats() {
  return FESTIVAL_HATS.slice()
}

/** 是否该年窗口来自预估（未写官方表） */
function isHolidayYearEstimated(y) {
  return !OFFICIAL_HOLIDAY_WINDOWS[y] && !!getHolidayWindowsForYear(y)
}

module.exports = {
  FESTIVAL_HAT_DEV_MODE,
  DEV_CYCLE_MS,
  HOLIDAY_TABLE_THROUGH_YEAR,
  FESTIVAL_HATS,
  OFFICIAL_HOLIDAY_WINDOWS,
  LUNAR_FESTIVAL_ANCHORS,
  resolveFestivalHatId,
  getFestivalHatMeta,
  getHolidayWindowsForYear,
  isFestivalHatDevMode,
  isHolidayYearEstimated,
  listFestivalHats
}
