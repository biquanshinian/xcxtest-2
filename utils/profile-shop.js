/**
 * 「我的」页微信小店店铺卡：读 global_config.main.enableProfileShop，
 * 用官方 store-home 嵌入小店首页。只需小店 appid，不必选商品。
 * failClosed + defaultOff：缺配置 / 读失败 / 未显式开启都不展示。
 * 文档：https://developers.weixin.qq.com/miniprogram/dev/component/store-home.html
 */
const { fetchMainConfig } = require('./feature-flags.js')
const { storeAppid: DEFAULT_STORE_APPID } = require('./config.js')

function warn(reason, extra) {
  try {
    console.warn('[profile-shop]', reason, extra || '')
  } catch (e) {}
}

function isProfileShopEnabledFromCfg(cfg) {
  return !!(cfg && cfg._id && cfg.enableProfileShop === true)
}

function resolveStoreAppid(cfg) {
  const fromCfg = String((cfg && cfg.profileShopAppid) || '').trim()
  if (fromCfg) return fromCfg
  return String(DEFAULT_STORE_APPID || '').trim()
}

function buildProfileShopView(appid) {
  const id = String(appid || '').trim()
  if (!id) {
    return { showProfileShop: false, profileShopAppid: '' }
  }
  return { showProfileShop: true, profileShopAppid: id }
}

/**
 * @param {boolean} [forceRefresh]
 * @returns {Promise<{ appid: string }|null>}
 */
async function loadProfileShopHome(forceRefresh) {
  let cfg
  try {
    cfg = await fetchMainConfig(!!forceRefresh)
  } catch (e) {
    warn('main-config-failed', e && e.message)
    return null
  }
  if (!isProfileShopEnabledFromCfg(cfg)) {
    warn('disabled', { enableProfileShop: cfg && cfg.enableProfileShop })
    return null
  }
  const appid = resolveStoreAppid(cfg)
  if (!appid) {
    warn('missing-appid')
    return null
  }
  return { appid }
}

module.exports = {
  loadProfileShopHome,
  isProfileShopEnabledFromCfg,
  resolveStoreAppid,
  buildProfileShopView
}
