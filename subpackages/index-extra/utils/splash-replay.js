/**
 * 开屏热启动重播：纯判断，不碰 wx。
 * 冷启动仍每次播；仅「本进程已播过 + 从后台回前台 + 云端 updatedAt 更新」才重播。
 */
function splashConfigUpdatedAt(cfg) {
  const n = Number(cfg && cfg.updatedAt)
  return Number.isFinite(n) && n > 0 ? n : 0
}

function shouldReplaySplashOnResume(opts) {
  const o = opts && typeof opts === 'object' ? opts : {}
  if (o.splashVisible || o.splashUiActive || o.splashFading) return false
  if (!o.needResumeCheck) return false
  if (!o.shownThisSession) return false
  const cloud = Number(o.cloudUpdatedAt) || 0
  const shown = Number(o.lastShownUpdatedAt) || 0
  // 从未记过「播过的版本」时不能比：否则冷启动只用本地池、updatedAt=0，回前台会误当成有更新
  if (!cloud || !shown) return false
  return cloud > shown
}

/** 云端文档带了 mediaItems（含空数组）即视为权威池，禁止再用本地旧片 */
function cloudSplashPoolIsAuthoritative(cfg) {
  return !!(cfg && Array.isArray(cfg.mediaItems))
}

/** 后台已关开屏，或权威池没有任何可播条目 */
function isSplashCloudPoolUnusable(cfg, cloudItems) {
  if (!cfg) return false
  if (cfg.enabled === false) return true
  if (!cloudSplashPoolIsAuthoritative(cfg)) return false
  return !(Array.isArray(cloudItems) && cloudItems.length)
}

/** 后台已清空媒体池：enabled 关闭，或显式空数组 */
function isSplashCloudPoolCleared(cfg) {
  if (!cfg) return false
  if (cfg.enabled === false) return true
  return cloudSplashPoolIsAuthoritative(cfg) && cfg.mediaItems.length === 0
}

/** 热启动重播必须只用云端池，禁止回落本地旧片（后台已清空/替换时会播错） */
function selectSplashMediaPool(opts) {
  const o = opts && typeof opts === 'object' ? opts : {}
  const cloudItems = Array.isArray(o.cloudItems) ? o.cloudItems : []
  const cachedItems = Array.isArray(o.cachedItems) ? o.cachedItems : []
  const cfg = o.cfg
  if (o.replay) return cloudItems
  // 含 mediaItems: []：池已清空，不能回落缓存继续播
  if (cloudSplashPoolIsAuthoritative(cfg)) return cloudItems
  if (cloudItems.length > 1) return cloudItems
  if (o.cacheHasPool) return cachedItems
  return cloudItems.length ? cloudItems : cachedItems
}

module.exports = {
  splashConfigUpdatedAt,
  shouldReplaySplashOnResume,
  cloudSplashPoolIsAuthoritative,
  isSplashCloudPoolCleared,
  isSplashCloudPoolUnusable,
  selectSplashMediaPool
}
