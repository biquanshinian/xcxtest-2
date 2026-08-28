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

/** 热启动重播必须只用云端池，禁止回落本地旧片（后台已清空/替换时会播错） */
function selectSplashMediaPool(opts) {
  const o = opts && typeof opts === 'object' ? opts : {}
  const cloudItems = Array.isArray(o.cloudItems) ? o.cloudItems : []
  const cachedItems = Array.isArray(o.cachedItems) ? o.cachedItems : []
  const cfg = o.cfg
  if (o.replay) return cloudItems
  if (cloudItems.length > 1 || (cfg && Array.isArray(cfg.mediaItems) && cfg.mediaItems.length)) {
    return cloudItems
  }
  if (o.cacheHasPool) return cachedItems
  return cloudItems.length ? cloudItems : cachedItems
}

module.exports = {
  splashConfigUpdatedAt,
  shouldReplaySplashOnResume,
  selectSplashMediaPool
}
