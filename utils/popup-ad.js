/**
 * 弹窗广告：读 global_config.popup_ad_config + shop_feed，频率与触发页由后台配置
 */
const { storeAppid: DEFAULT_STORE_APPID } = require('./config.js')
const storageCache = require('./storage-sync-cache.js')
const { optimizeImageUrl } = require('./cos-url.js')

/** 弹窗封面约全宽展示：https 直链走 medium 压缩；cloud:// fileID 原样（加 query 会失效） */
function _optimizedCoverUrl(raw) {
  const u = typeof raw === 'string' ? raw.trim() : ''
  if (!u) return ''
  if (!/^https?:\/\//i.test(u)) return u
  if (/imageMogr2|ci-process=/i.test(u)) return u
  return optimizeImageUrl(u, 'medium')
}

const CONFIG_CACHE_KEY = '_popup_ad_config_cache'
const CONFIG_FRESH_MS = 15 * 1000          // 15s 内视为新鲜，直接返回
const CONFIG_STALE_MS = 10 * 60 * 1000     // 15s~10min 之间：返回缓存 + 后台刷新（SWR）
const SHOWN_STORAGE_KEY = '_popup_ad_shown_by_day'
const SEQ_STORAGE_KEY = '_popup_ad_seq_index'
const PROTECT_ANCHOR_KEY = '_popup_ad_protect_anchor_ts'

let _memPopupAdConfig = null  // { data, ts }
let _bgRefreshing = false

/** 同会话内：每个触发页索引最多弹一次（冷启动重置） */
function getSessionShownMap() {
  try {
    const app = getApp()
    if (!app) return null
    if (!app.globalData) return null
    if (!app.globalData._popupAdShownInSession || typeof app.globalData._popupAdShownInSession !== 'object') {
      app.globalData._popupAdShownInSession = {}
    }
    return app.globalData._popupAdShownInSession
  } catch (e) {
    return null
  }
}

function hasShownInSession(pageIndex) {
  const m = getSessionShownMap()
  if (!m) return false
  return m[String(pageIndex)] === true
}

function markSessionShown(pageIndex) {
  const m = getSessionShownMap()
  if (m) m[String(pageIndex)] = true
}

function getTodayStr() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function getTodayShownCount() {
  try {
    const raw = storageCache.readMemOrSync(SHOWN_STORAGE_KEY, null)
    const today = getTodayStr()
    if (!raw || typeof raw !== 'object') return 0
    if (raw.date !== today) return 0
    return Math.max(0, Number(raw.count) || 0)
  } catch (e) {
    return 0
  }
}

function recordShown() {
  try {
    const today = getTodayStr()
    const prev = storageCache.readMemOrSync(SHOWN_STORAGE_KEY, null) || {}
    const count = prev.date === today ? Math.max(0, Number(prev.count) || 0) + 1 : 1
    storageCache.persistAsync(SHOWN_STORAGE_KEY, { date: today, count })
  } catch (e) {}
}

function calendarDayIndexSinceAnchor(anchorTs) {
  const a = new Date(Number(anchorTs) || 0)
  a.setHours(0, 0, 0, 0)
  const b = new Date()
  b.setHours(0, 0, 0, 0)
  return Math.round((b.getTime() - a.getTime()) / 86400000)
}

function passesNewUserProtect(protectDays) {
  const n = Math.max(0, Math.min(30, Number(protectDays) || 0))
  if (!n) return true

  let anchor = Number(storageCache.readMemOrSync(PROTECT_ANCHOR_KEY, 0) || 0)
  const now = Date.now()
  if (!anchor) {
    storageCache.persistAsync(PROTECT_ANCHOR_KEY, now)
    anchor = now
  }

  const dayIdx = calendarDayIndexSinceAnchor(anchor)
  if (dayIdx === 0) return true
  if (dayIdx < n) return false
  return true
}

async function fetchPopupAdConfig() {
  const now = Date.now()

  // 1) 内存缓存：很新就直接返回；只是 stale 就返回旧值并后台刷新
  if (_memPopupAdConfig && _memPopupAdConfig.ts && _memPopupAdConfig.data) {
    const age = now - _memPopupAdConfig.ts
    if (age < CONFIG_FRESH_MS) return _memPopupAdConfig.data
    if (age < CONFIG_STALE_MS && _memPopupAdConfig.data.enabled) {
      // 仅当 stale 缓存表明"开启"时才用它，避免上一次"关闭"状态把第一次访问拦掉
      kickBackgroundRefresh()
      return _memPopupAdConfig.data
    }
  }

  // 2) Storage 缓存
  const cached = await new Promise((resolve) => {
    wx.getStorage({
      key: CONFIG_CACHE_KEY,
      success: (res) => resolve(res.data),
      fail: () => resolve(null)
    })
  })
  if (cached && cached.ts && cached.data) {
    const age = now - cached.ts
    if (age < CONFIG_FRESH_MS) {
      _memPopupAdConfig = cached
      return cached.data
    }
    if (age < CONFIG_STALE_MS && cached.data.enabled) {
      _memPopupAdConfig = cached
      kickBackgroundRefresh()
      return cached.data
    }
  }

  // 3) 缓存全过期 / 不可信：直接拉云
  return await fetchPopupAdConfigFromCloud()
}

function kickBackgroundRefresh() {
  if (_bgRefreshing) return
  _bgRefreshing = true
  fetchPopupAdConfigFromCloud()
    .catch(() => {})
    .then(() => { _bgRefreshing = false })
}

async function fetchPopupAdConfigFromCloud() {
  if (!wx.cloud || !wx.cloud.database) {
    return null
  }

  try {
    const db = wx.cloud.database()
    const cfgRes = await db.collection('global_config').doc('popup_ad_config').get()
    const doc = (cfgRes && cfgRes.data) || {}

    const enabled = doc.enabled !== false
    const triggerPages = Array.isArray(doc.triggerPages)
      ? doc.triggerPages.map((x) => Number(x)).filter((x) => !Number.isNaN(x))
      : []
    const dailyLimit = Math.max(1, Math.min(10, Number(doc.dailyLimit) || 1))
    const shopItemIds = Array.isArray(doc.shopItemIds) ? doc.shopItemIds.filter(Boolean) : []
    const displayMode = doc.displayMode === 'sequential' ? 'sequential' : 'random'
    const delayMs = Math.max(0, Math.min(10000, Number(doc.delayMs) || 1500))
    const newUserProtectDays = Math.max(0, Math.min(30, Number(doc.newUserProtectDays) || 0))

    let shopItems = []
    if (shopItemIds.length) {
      const _ = db.command
      // 小程序端单次查询上限 20 条（.limit(50) 会被静默截断成 20）：按 20 个 id 一组分批查
      const CHUNK = 20
      const tasks = []
      for (let i = 0; i < shopItemIds.length; i += CHUNK) {
        tasks.push(
          db.collection('shop_feed')
            .where({ _id: _.in(shopItemIds.slice(i, i + CHUNK)) })
            .limit(CHUNK)
            .get()
        )
      }
      const chunkResults = await Promise.all(tasks)
      const byId = {}
      chunkResults.forEach((sfRes) => {
        ;(sfRes.data || []).forEach((row) => {
          // 后台已经主动勾选了，这里不再二次过滤 enabled，
          // 避免"后台开启 + shop_feed.enabled=false"两侧状态对打。
          if (row && row._id) byId[row._id] = row
        })
      })
      shopItems = shopItemIds.map((id) => byId[id]).filter(Boolean)
    }

    const data = {
      enabled,
      triggerPages,
      dailyLimit,
      shopItemIds,
      displayMode,
      delayMs,
      newUserProtectDays,
      shopItems
    }

    try {
      const cacheObj = { data, ts: Date.now() }
      _memPopupAdConfig = cacheObj
      wx.setStorage({ key: CONFIG_CACHE_KEY, data: cacheObj, fail: () => {} })
    } catch (e) {}

    return data
  } catch (e) {
    console.warn('[popup-ad] fetch config', e)
    return null
  }
}

function pickShopItem(config) {
  const items = config.shopItems || []
  if (!items.length) return null

  if (config.displayMode === 'sequential') {
    let idx = Number(storageCache.readMemOrSync(SEQ_STORAGE_KEY, 0) || 0) || 0
    const pick = items[idx % items.length]
    try {
      storageCache.persistAsync(SEQ_STORAGE_KEY, idx + 1)
    } catch (e) {}
    return pick
  }

  const i = Math.floor(Math.random() * items.length)
  return items[i]
}

function normalizeShopItem(raw, index) {
  if (!raw) return null
  const productId = String(raw.productId || raw.productID || raw.product_id || '').trim()
  return {
    id: raw._id || raw.id || `popup-shop-${index}`,
    title: raw.title || '微信小店',
    desc: raw.desc || '',
    coverFileID: _optimizedCoverUrl(raw.coverFileID || raw.cover || ''),
    appid: raw.appid || raw.storeAppid || DEFAULT_STORE_APPID || '',
    productId,
    productPromotionLink: String(raw.productPromotionLink || raw.product_promotion_link || '').trim(),
    mediaId: String(raw.mediaId || raw.media_id || '').trim()
  }
}

/**
 * @param {number} pageIndex 监控中心 1；星舰进度 2；新闻 3；我的 4
 * @param {WechatMiniprogram.Page.TrivialInstance} pageThis
 */
async function tryShowPopupAd(pageIndex, pageThis) {
  if (!pageThis || typeof pageThis.setData !== 'function') return

  const cfg = await fetchPopupAdConfig()
  const skip = (reason, extra) => {
    console.log('[popup-ad] skip:', reason, extra || '')
  }

  if (!cfg) return skip('no-config')
  if (!cfg.enabled) return skip('disabled', cfg)
  if (!cfg.triggerPages || !cfg.triggerPages.includes(Number(pageIndex))) {
    return skip('page-not-in-triggerPages', { pageIndex, triggerPages: cfg.triggerPages })
  }

  if (hasShownInSession(pageIndex)) return skip('shown-in-session', pageIndex)

  if (!passesNewUserProtect(cfg.newUserProtectDays)) {
    return skip('new-user-protect', cfg.newUserProtectDays)
  }

  const shown = getTodayShownCount()
  if (shown >= cfg.dailyLimit) {
    return skip('daily-limit-reached', { shown, limit: cfg.dailyLimit })
  }

  const rawItem = pickShopItem(cfg)
  if (!rawItem) {
    return skip('no-shop-item', {
      shopItemIds: cfg.shopItemIds,
      shopItemsResolved: (cfg.shopItems || []).length
    })
  }

  const shopItem = normalizeShopItem(rawItem, 0)
  if (!shopItem) return skip('shop-item-normalize-failed')

  const delay = cfg.delayMs || 0
  const show = () => {
    console.log('[popup-ad] showing', shopItem)
    pageThis.setData({
      popupAdVisible: true,
      popupAdItem: shopItem
    })
    markSessionShown(pageIndex)
    recordShown()
  }
  if (delay > 0) {
    setTimeout(show, delay)
  } else {
    show()
  }
}

/**
 * 调试用：清掉本地所有弹窗广告相关缓存（含会话内"已弹过"标记）。
 * 在微信开发者工具控制台粘贴：
 *   require('utils/popup-ad').resetPopupAdLocalState()
 * 然后重新进入触发页即可。
 */
function resetPopupAdLocalState() {
  try { wx.removeStorageSync(CONFIG_CACHE_KEY) } catch (e) {}
  try { wx.removeStorageSync(SHOWN_STORAGE_KEY) } catch (e) {}
  try { wx.removeStorageSync(SEQ_STORAGE_KEY) } catch (e) {}
  try { wx.removeStorageSync(PROTECT_ANCHOR_KEY) } catch (e) {}
  storageCache.invalidate(SHOWN_STORAGE_KEY)
  storageCache.invalidate(SEQ_STORAGE_KEY)
  storageCache.invalidate(PROTECT_ANCHOR_KEY)
  _memPopupAdConfig = null
  _bgRefreshing = false
  try {
    const a = getApp()
    if (a && a.globalData) a.globalData._popupAdShownInSession = {}
  } catch (e) {}
  console.log('[popup-ad] local state reset')
}

module.exports = {
  tryShowPopupAd,
  fetchPopupAdConfig,
  normalizeShopItem,
  getTodayShownCount,
  recordShown,
  resetPopupAdLocalState
}
