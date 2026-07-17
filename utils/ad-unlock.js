/**
 * 激励视频广告临时解锁门控
 * 看完广告 → 按 productId 解锁 10 分钟；过期后再次走会员门控
 *
 * 稳定性要点（胶囊消失 / 自定义导航栏）：
 * 1. 激励视频实例按「当前页 route」绑定，换页则 destroy 再建（官方：仅对当前页有效）
 * 2. onClose 内禁止同步 Toast / 同步 resolve 跳转，延后让系统层恢复胶囊
 * 3. 关闭后轻量 nudge（读胶囊矩形），再放行业务 navigateTo
 */
const { rewardedVideoAdUnitId } = require('./config.js')
const storageCache = require('./storage-sync-cache.js')

const DEFAULT_UNLOCK_TTL_MS = 10 * 60 * 1000
const STORAGE_KEY = '_ad_temp_unlock'

function _unlockTtlMs() {
  try {
    const { getMemberPolicySync } = require('./member-policy.js')
    const mins = getMemberPolicySync().adUnlockMinutes
    if (mins > 0) return mins * 60 * 1000
  } catch (e) {}
  return DEFAULT_UNLOCK_TTL_MS
}
const AD_UNIT_ID = rewardedVideoAdUnitId || ''

/** 广告全屏层收起后，给客户端恢复胶囊的时间 */
const POST_CLOSE_SETTLE_MS = 480
/** settle 后再稍等一帧再 Toast，避免与 navigateTo 抢同一帧 */
const TOAST_AFTER_RESOLVE_MS = 120
/** ActionSheet 收起后再 show，减少叠层冲突 */
const PRE_SHOW_DELAY_MS = 280
/** 解锁成功提示先停留再放行跳转，避免提示还没看清页面就跳走 */
const UNLOCK_TOAST_HOLD_MS = 2000

let _videoAd = null
let _adRoute = ''
let _pendingClose = null
let _busy = false

function _readMap() {
  const raw = storageCache.readMemOrSync(STORAGE_KEY, null)
  if (!raw || typeof raw !== 'object') return {}
  return raw
}

function _writeMap(map) {
  try {
    storageCache.persistAsync(STORAGE_KEY, map || {})
  } catch (e) {}
}

function _pruneExpired(map, now) {
  const next = {}
  const t = now || Date.now()
  Object.keys(map || {}).forEach((id) => {
    const exp = Number(map[id]) || 0
    if (exp > t) next[id] = exp
  })
  return next
}

function getCurrentRoute() {
  try {
    const pages = getCurrentPages()
    if (!pages || !pages.length) return ''
    const top = pages[pages.length - 1]
    return (top && (top.route || top.__route__)) || ''
  } catch (e) {
    return ''
  }
}

/** 某功能是否仍在广告临时解锁窗口内 */
function isUnlocked(productId) {
  if (!productId) return false
  const map = _pruneExpired(_readMap())
  const exp = Number(map[productId]) || 0
  return exp > Date.now()
}

function getUnlockExpireAt(productId) {
  if (!productId) return 0
  const map = _readMap()
  const exp = Number(map[productId]) || 0
  return exp > Date.now() ? exp : 0
}

function grantUnlock(productId) {
  if (!productId) return 0
  const now = Date.now()
  const map = _pruneExpired(_readMap(), now)
  const expireAt = now + _unlockTtlMs()
  map[productId] = expireAt
  _writeMap(map)
  return expireAt
}

function _safeToast(title, icon) {
  try {
    wx.showToast({ title: title, icon: icon || 'none', duration: 2000 })
  } catch (e) {}
}

function _nudgeCapsuleRestore() {
  try {
    wx.getMenuButtonBoundingClientRect()
  } catch (e) {}
  try {
    if (typeof wx.getWindowInfo === 'function') wx.getWindowInfo()
  } catch (e) {}
}

function destroyRewardedAd() {
  const ad = _videoAd
  _videoAd = null
  _adRoute = ''
  _pendingClose = null
  if (!ad) return
  try {
    if (typeof ad.offClose === 'function') ad.offClose()
  } catch (e) {}
  try {
    if (typeof ad.offError === 'function') ad.offError()
  } catch (e) {}
  try {
    if (typeof ad.offLoad === 'function') ad.offLoad()
  } catch (e) {}
  try {
    if (typeof ad.destroy === 'function') ad.destroy()
  } catch (e) {}
}

function ensureRewardedAd() {
  if (!AD_UNIT_ID) return null
  if (typeof wx === 'undefined' || !wx.createRewardedVideoAd) return null

  const route = getCurrentRoute()
  if (_videoAd && _adRoute && route && _adRoute !== route) {
    destroyRewardedAd()
  }
  if (_videoAd) return _videoAd

  try {
    _videoAd = wx.createRewardedVideoAd({ adUnitId: AD_UNIT_ID })
    _adRoute = route
    _videoAd.onError(function (err) {
      console.error('[ad-unlock] load/show error', err)
    })
    _videoAd.onClose(function (res) {
      const cb = _pendingClose
      _pendingClose = null
      if (typeof cb === 'function') cb(res)
    })
  } catch (e) {
    console.error('[ad-unlock] createRewardedVideoAd failed', e)
    _videoAd = null
    _adRoute = ''
  }
  return _videoAd
}

function _delay(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms)
  })
}

/**
 * 拉起激励视频；看完则写入该 productId 的 10 分钟解锁
 * @returns {Promise<boolean>} true=已解锁，false=未看完/失败/取消
 */
function showRewardedAdForUnlock(productId) {
  return new Promise(function (resolve) {
    if (!productId) {
      resolve(false)
      return
    }

    if (_busy || _pendingClose) {
      _safeToast('广告加载中，请稍候')
      resolve(false)
      return
    }

    const ad = ensureRewardedAd()
    if (!ad) {
      _safeToast('当前环境暂不支持广告')
      resolve(false)
      return
    }

    _busy = true
    var settled = false

    function finish(ok, toastTitle, toastIcon, holdMs) {
      if (settled) return
      settled = true
      _busy = false
      _pendingClose = null
      _nudgeCapsuleRestore()
      if (ok && toastTitle && holdMs > 0) {
        // 解锁成功：先弹提示停留够时长，再放行业务跳转（否则提示还没看清就跳到视频了）
        // 此时距广告层收起已过 settle 期，同步 Toast 安全；且 2 秒内无 navigateTo，不存在抢帧
        _safeToast(toastTitle, toastIcon)
        setTimeout(function () {
          resolve(true)
        }, holdMs)
        return
      }
      // 失败/取消不跳转：先 resolve，再 Toast，避免与全屏层收起抢同一帧
      resolve(!!ok)
      if (toastTitle) {
        setTimeout(function () {
          _safeToast(toastTitle, toastIcon)
        }, TOAST_AFTER_RESOLVE_MS)
      }
    }

    function finishAfterSettle(ok, toastTitle, toastIcon, holdMs) {
      _nudgeCapsuleRestore()
      setTimeout(function () {
        _nudgeCapsuleRestore()
        finish(ok, toastTitle, toastIcon, holdMs)
        // 关闭后销毁，下次在「当时所在页」重建，避免跨 Tab/子页复用单例
        try {
          destroyRewardedAd()
        } catch (e) {}
      }, POST_CLOSE_SETTLE_MS)
    }

    _pendingClose = function (res) {
      // 基础库 < 2.1.0 时 res 可能为 undefined，视为看完
      var ended = !res || res.isEnded === true
      if (ended) {
        grantUnlock(productId)
        var mins = Math.max(1, Math.round(_unlockTtlMs() / 60000))
        // 单条视频解锁键（evtvid:）：明确提示只解锁本条，避免误以为解锁整个版块
        var isSingleVideo = String(productId).indexOf('evtvid:') === 0
        var title = isSingleVideo ? '本条视频已解锁 ' + mins + ' 分钟' : '已解锁 ' + mins + ' 分钟'
        finishAfterSettle(true, title, 'success', UNLOCK_TOAST_HOLD_MS)
      } else {
        finishAfterSettle(false, '需看完广告才能解锁', 'none')
      }
    }

    function failShow(err) {
      console.error('[ad-unlock] show failed', err)
      _pendingClose = null
      finish(false, '暂无广告，请稍后再试', 'none')
    }

    // ActionSheet 收起后再拉全屏广告，降低叠层导致的系统栏异常
    _delay(PRE_SHOW_DELAY_MS)
      .then(function () {
        if (settled) return null
        return ad.show()
      })
      .catch(function () {
        if (settled) return null
        return ad.load().then(function () {
          return ad.show()
        })
      })
      .catch(failShow)
  })
}

module.exports = {
  UNLOCK_TTL_MS: DEFAULT_UNLOCK_TTL_MS,
  getUnlockTtlMs: _unlockTtlMs,
  isUnlocked: isUnlocked,
  getUnlockExpireAt: getUnlockExpireAt,
  grantUnlock: grantUnlock,
  showRewardedAdForUnlock: showRewardedAdForUnlock,
  ensureRewardedAd: ensureRewardedAd,
  destroyRewardedAd: destroyRewardedAd
}
