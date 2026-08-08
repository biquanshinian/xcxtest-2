/**
 * utils/rocket-config-art.js — 火箭配置图艺术风格（原图 / 机娘）
 *
 * 机制：
 * 1. 偏好持久化在本地 storage（_rocket_config_art）：'original' | 'mecha'，默认原图；
 * 2. setRocketConfigArtStyle() 遍历 getCurrentPages()，调用页面 refreshRocketConfigArt（若有）；
 * 3. 版本号递增，Tab 页等不在栈内的页面在 onShow 用 applyRocketConfigArtIfNeeded 补刷；
 * 4. 解析层 getRocketImage / resolveMissionRocketImage 读取本模块偏好选 COS 前缀；
 * 5. _rocketArtAppliedVersion 仅在刷新成功（含 Promise resolve）后写入，失败可在下次 onShow 重试。
 */
const ART_STORAGE_KEY = '_rocket_config_art'
const ART_ORIGINAL = 'original'
const ART_MECHA = 'mecha'

const PREFIX_ORIGINAL = '火箭配置图/'
const PREFIX_MECHA = '火箭配置图-机娘/'

let _style = ''
let _version = 1

function getRocketConfigArtStyle() {
  if (_style === ART_ORIGINAL || _style === ART_MECHA) return _style
  try {
    const saved = wx.getStorageSync(ART_STORAGE_KEY)
    _style = saved === ART_MECHA ? ART_MECHA : ART_ORIGINAL
  } catch (e) {
    _style = ART_ORIGINAL
  }
  return _style
}

function getRocketConfigArtVersion() {
  return _version
}

function getRocketConfigArtPrefix(style) {
  const s = style === ART_MECHA || style === ART_ORIGINAL ? style : getRocketConfigArtStyle()
  return s === ART_MECHA ? PREFIX_MECHA : PREFIX_ORIGINAL
}

/** URL / key 是否属于机娘目录（含 encodeURI 形态） */
function isMechaRocketSrc(u) {
  const s = u == null ? '' : String(u)
  if (!s) return false
  if (s.indexOf(PREFIX_MECHA) >= 0) return true
  if (/%E7%81%AB%E7%AE%AD%E9%85%8D%E7%BD%AE%E5%9B%BE-%E6%9C%BA%E5%A8%98/i.test(s)) return true
  try {
    const decoded = decodeURIComponent(s)
    if (decoded.indexOf(PREFIX_MECHA) >= 0) return true
  } catch (e) {}
  return false
}

/** 调用页面 refreshRocketConfigArt；成功后再盖版本戳（支持 Promise） */
function invokePageRocketArtRefresh(page) {
  if (!page || typeof page.refreshRocketConfigArt !== 'function') return false
  const targetVersion = _version
  try {
    const ret = page.refreshRocketConfigArt()
    if (ret && typeof ret.then === 'function') {
      ret
        .then(() => {
          if (_version === targetVersion) page._rocketArtAppliedVersion = targetVersion
        })
        .catch(() => {})
      return true
    }
    page._rocketArtAppliedVersion = targetVersion
    return true
  } catch (e) {
    return false
  }
}

function refreshRocketArtOnPages() {
  const pages = (typeof getCurrentPages === 'function' && getCurrentPages()) || []
  pages.forEach((p) => {
    invokePageRocketArtRefresh(p)
  })
}

/**
 * 页面 onShow 调用：若艺术风格版本已变且页面实现了 refreshRocketConfigArt，则补刷。
 */
function applyRocketConfigArtIfNeeded(page) {
  if (!page || typeof page.refreshRocketConfigArt !== 'function') return false
  if (page._rocketArtAppliedVersion === _version) return false
  return invokePageRocketArtRefresh(page)
}

/**
 * 切换艺术风格：持久化 + 通知在栈页刷新火箭图。
 * @param {string} style 'original' | 'mecha'
 */
function setRocketConfigArtStyle(style) {
  const next = style === ART_MECHA ? ART_MECHA : ART_ORIGINAL
  const prev = getRocketConfigArtStyle()
  // 同款重复点选直接返回：避免无意义的全栈页面重刷（重复解析/重复 setData）
  if (next === prev) return next
  _style = next
  _version += 1
  try {
    wx.setStorageSync(ART_STORAGE_KEY, next)
  } catch (e) {}
  refreshRocketArtOnPages()
  return next
}

module.exports = {
  ART_ORIGINAL,
  ART_MECHA,
  PREFIX_ORIGINAL,
  PREFIX_MECHA,
  ART_STORAGE_KEY,
  getRocketConfigArtStyle,
  getRocketConfigArtVersion,
  getRocketConfigArtPrefix,
  isMechaRocketSrc,
  setRocketConfigArtStyle,
  refreshRocketArtOnPages,
  applyRocketConfigArtIfNeeded
}
