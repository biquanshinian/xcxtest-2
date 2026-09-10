/**
 * 火箭观礼过审开关（global_config.main.enableWatchParty）
 *
 * - failClosed：读不到 main 视为关闭
 * - 字段缺省视为开启（!== false），与 enableAIChat 一致；一键过审会写入 false
 * - 运营关停另见 watch_party_config.enabled（云端 serviceGate 双闸）
 */
const { isFeatureEnabled, fetchMainConfig } = require('./feature-flags.js')

const FEATURE_FIELD = 'enableWatchParty'

/** 观礼入口统一图标（我的页 / 任务详情页 / 星问AI快捷键等所有观礼入口复用） */
const WATCH_PARTY_ICON = 'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/%E5%9B%BE%E6%A0%87/1786167601470_rrgkrl.jpg'

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

/** 对外观礼场次总数（入口卡红角标）：60s 内存缓存；开关关闭/失败返回 0 */
let _sessionCountCache = { at: 0, n: 0 }

function fetchWatchPartySessionCount(forceRefresh) {
  if (!forceRefresh && Date.now() - _sessionCountCache.at < 60 * 1000) {
    return Promise.resolve(_sessionCountCache.n)
  }
  return isWatchPartyEnabled().then((on) => {
    if (!on) {
      _sessionCountCache = { at: Date.now(), n: 0 }
      return 0
    }
    if (!wx.cloud || typeof wx.cloud.callFunction !== 'function') return 0
    return wx.cloud.callFunction({
      name: 'adminGateway',
      data: { path: '/watch-party/sessions/public', method: 'GET', query: { summary: 1, limit: 50 } }
    }).then((res) => {
      const r = (res && res.result) || {}
      const list = (r.code === 0 && r.data && Array.isArray(r.data.list)) ? r.data.list : []
      const n = Math.min(list.length, 99)
      _sessionCountCache = { at: Date.now(), n }
      return n
    }).catch(() => _sessionCountCache.n || 0)
  }).catch(() => 0)
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
  WATCH_PARTY_ICON,
  isWatchPartyEnabled,
  fetchWatchPartySessionCount,
  guardWatchPartyPage
}
