/**
 * 本地化取值工具
 * 内容语言由用户偏好 contentLang 控制（默认 zh）；词典 / 预翻译字段按语言选取。
 */

const CONTENT_LANG_ZH = 'zh'
const CONTENT_LANG_EN = 'en'

let _memLang = null

function normalizeContentLang(raw) {
  const s = String(raw || '').trim().toLowerCase()
  return s === CONTENT_LANG_EN ? CONTENT_LANG_EN : CONTENT_LANG_ZH
}

/** 读取当前内容语言（带内存缓存；偏好变更后调用 setContentLangMem / invalidateContentLangCache） */
function getContentLang() {
  if (_memLang) return _memLang
  try {
    const { loadPreferences } = require('./user-growth.js')
    _memLang = normalizeContentLang((loadPreferences() || {}).contentLang)
  } catch (e) {
    _memLang = CONTENT_LANG_ZH
  }
  return _memLang
}

function setContentLangMem(lang) {
  _memLang = normalizeContentLang(lang)
  return _memLang
}

function invalidateContentLangCache() {
  _memLang = null
}

function isContentLangEn() {
  return getContentLang() === CONTENT_LANG_EN
}

/**
 * 按当前内容语言取值：zh 优先中文（空则回退英文）；en 优先英文（空则回退中文）。
 */
function pickLocalized(zhVal, enVal) {
  const zh = zhVal != null ? String(zhVal).trim() : ''
  const en = enVal != null ? String(enVal).trim() : ''
  if (isContentLangEn()) return en || zh
  return zh || en
}

/**
 * 取对象上的原始中文字段（如 item.nameZh），无则返回空串。
 * 不做英文回退——回退交给 pickLocalized，中间留给调用方接词典兜底：
 *   pickLocalized(zhField(x, 'name') || dict(x.name), x.name)
 */
function zhField(item, enKey, zhKey) {
  if (!item || typeof item !== 'object') return ''
  const zhK = zhKey || (enKey + 'Zh')
  const v = item[zhK]
  return v != null ? String(v).trim() : ''
}

/** 发射列表卡片壳文案（角标旁「第 N 次」、未知占位等） */
function launchCardUiText(key, vars) {
  const en = isContentLangEn()
  const n = vars && vars.n != null ? vars.n : ''
  const map = {
    unknownMission: en ? 'Unknown mission' : '未知任务',
    unknownTime: en ? 'Time TBD' : '时间未知',
    unknownPlace: en ? 'Unknown location' : '未知地点',
    unknownCountry: en ? 'Unknown' : '未知',
    unknownRocket: en ? 'Unknown rocket' : '未知火箭',
    flightCount: en ? `Flight ${n}` : `第${n}次飞行`,
    upcoming: en ? 'Upcoming' : '即将发射',
    previous: en ? 'Previous' : '历史发射',
    recentLaunches: en ? 'Recent launches' : '近期发射',
    remind: en ? 'Remind' : '提醒',
    pin: en ? 'Pin' : '置顶',
    cdDay: en ? 'd' : '天',
    cdHour: en ? 'h' : '时',
    cdMin: en ? 'm' : '分',
    cdSec: en ? 's' : '秒',
    allTasks: en ? 'All launches' : '所有任务',
    expand: en ? 'More' : '展开',
    collapse: en ? 'Less' : '收起',
    timeTbdLong: en ? 'Launch time TBD' : '发射时间待定',
    agencyFilterEmpty: en
      ? 'No launches for this filter. Tap “All launches” to see everything.'
      : '当前筛选下暂无任务，可点击「所有任务」查看全部',
    planned: en ? 'Planned' : '计划中',
    launchMission: en ? 'Launch' : '发射任务'
  }
  return map[key] != null ? map[key] : ''
}

module.exports = {
  CONTENT_LANG_ZH,
  CONTENT_LANG_EN,
  normalizeContentLang,
  getContentLang,
  setContentLangMem,
  invalidateContentLangCache,
  isContentLangEn,
  pickLocalized,
  zhField,
  launchCardUiText
}
