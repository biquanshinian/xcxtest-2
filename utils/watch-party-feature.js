/**
 * 火箭观礼过审开关（global_config.main.enableWatchParty）
 *
 * - failClosed：读不到 main 视为关闭
 * - 字段缺省视为开启（!== false），与 enableAIChat 一致；一键过审会写入 false
 * - 运营关停另见 watch_party_config.enabled（云端 serviceGate 双闸）
 */
const { isFeatureEnabled, fetchMainConfig } = require('./feature-flags.js')

const FEATURE_FIELD = 'enableWatchParty'

/**
 * @param {boolean} [forceRefresh] 强制刷新缓存（入口显隐；避免过审刚关仍读到旧 true）
 * @returns {Promise<boolean>}
 */
function isWatchPartyEnabled(forceRefresh) {
  if (forceRefresh) {
    return fetchMainConfig(true)
      .then((cfg) => {
        if (!cfg || !cfg._id) return false
        return cfg[FEATURE_FIELD] !== false
      })
      .catch(() => false)
  }
  return isFeatureEnabled(FEATURE_FIELD, { failClosed: true }).catch(() => false)
}

/**
 * 分包页直达/分享门控：关闭则 toast 并退出，避免审核员扫码/分享进页。
 * @param {WechatMiniprogram.Page.Instance} page
 * @returns {Promise<boolean>} true=放行
 */
function guardWatchPartyPage(page) {
  return isWatchPartyEnabled(true).then((on) => {
    if (on) return true
    _rejectWatchPartyPage(page)
    return false
  }).catch(() => {
    _rejectWatchPartyPage(page)
    return false
  })
}

function _rejectWatchPartyPage(page) {
  try {
    wx.showToast({ title: '观礼服务暂未开放', icon: 'none' })
  } catch (e) {}
  setTimeout(() => {
    try {
      if (page && typeof page.goBack === 'function') {
        page.goBack()
        return
      }
    } catch (e) {}
    try {
      const stack = typeof getCurrentPages === 'function' ? getCurrentPages() : []
      if (stack && stack.length > 1) {
        wx.navigateBack({
          fail: () => {
            try { wx.switchTab({ url: '/pages/index/index' }) } catch (e2) {}
          }
        })
      } else {
        wx.switchTab({ url: '/pages/index/index' })
      }
    } catch (e) {
      try { wx.switchTab({ url: '/pages/index/index' }) } catch (e2) {}
    }
  }, 400)
}

module.exports = {
  FEATURE_FIELD,
  isWatchPartyEnabled,
  guardWatchPartyPage
}
