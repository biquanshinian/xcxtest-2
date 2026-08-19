/**
 * 开屏冷启动预拉（主包，onLaunch 即跑）：
 * - 探测弱网（none/2g/3g/weakNet）→ 无本地片则标记 skip，首页即刻不展示
 * - 读本地缓存池 + 拉 starship_splash_config
 * - 预拉本次预览片 / 封面，首页展示时尽量零等待
 */
const { toCdnUrl, optimizeImageUrl, carouselVideoPosterUrl } = require('./cos-url.js')
const { getCachedMainConfig, fetchMainConfig } = require('./feature-flags.js')

const SPLASH_CACHE_KEY = '_splash_screen_cache'
const WEAK_NET_TYPES = { none: true, '2g': true, '3g': true }

function getAppSafe(app) {
  if (app) return app
  try {
    return typeof getApp === 'function' ? getApp() : null
  } catch (e) {
    return null
  }
}

function getPrefetchState(app) {
  const a = getAppSafe(app)
  if (!a) return null
  if (!a._splashPrefetch) {
    a._splashPrefetch = {
      started: false,
      weakNet: false,
      skip: false,
      cfg: null,
      cached: null,
      picked: null,
      resolved: null,
      playUrl: '',
      localPath: '',
      consumed: false,
      cfgPromise: null,
      netPromise: null,
      downloadPromise: null,
      downloadTask: null,
      downloadUrl: '',
      netResolved: false,
      pendingPlayUrl: '',
      weakNetHandler: null
    }
  }
  return a._splashPrefetch
}

function isWeakNetworkInfo(res) {
  const t = String((res && res.networkType) || '').toLowerCase()
  if (WEAK_NET_TYPES[t]) return true
  if (res && res.weakNet === true) return true
  return false
}

function probeNetwork() {
  return new Promise((resolve) => {
    try {
      wx.getNetworkType({
        success: (res) => resolve(res || {}),
        fail: () => resolve({})
      })
    } catch (e) {
      resolve({})
    }
  })
}

function fileExists(src) {
  if (!src) return false
  try {
    wx.getFileSystemManager().accessSync(src)
    return true
  } catch (e) {
    return false
  }
}

function localPathForPlayUrl(cached, playUrl) {
  if (!cached || !playUrl) return ''
  const map = cached.localPaths && typeof cached.localPaths === 'object' ? cached.localPaths : {}
  const src = map[playUrl] || ''
  return fileExists(src) ? src : ''
}

function currentPlayUrl(state) {
  if (!state) return ''
  if (state.resolved && state.resolved.playUrl) return state.resolved.playUrl
  return state.playUrl || ''
}

/** 只认「当前选中条目」的本地片，池里其它文件不能挡住弱网跳过 */
function hasUsableLocalMedia(state, cached) {
  const playUrl = currentPlayUrl(state)
  if (state && state.localPath && fileExists(state.localPath)) {
    if (!playUrl || state.playUrl === playUrl) return true
  }
  if (playUrl) {
    const mapped = localPathForPlayUrl(cached || (state && state.cached), playUrl)
    if (mapped) return true
  }
  return false
}

function shouldSkipSplashForWeakNet(state, cached) {
  if (!state || !state.weakNet) return false
  return !hasUsableLocalMedia(state, cached || (state && state.cached))
}

/** 旧 COS 截帧同时写死宽高会被拉伸；即时改写为等比截帧 */
function fixSplashPosterUrl(url) {
  if (!url || typeof url !== 'string') return ''
  let u = url.trim()
  if (!/ci-process=snapshot/i.test(u)) return u
  u = u.replace(/([?&])scaletype=[^&]*/gi, '$1')
  if (/[?&]width=\d+/i.test(u) && /[?&]height=[1-9]\d*/i.test(u)) {
    u = u.replace(/([?&])height=[1-9]\d*/i, '$1height=0')
  }
  return u.replace(/\?&/g, '?').replace(/&&/g, '&').replace(/[?&]$/g, '')
}

function pickPreviewUrl(it, isVideoItem) {
  if (!isVideoItem || !it || !it.previewUrl) return ''
  const st = String(it.previewStatus || '').trim().toLowerCase()
  if (st && st !== 'ready') return ''
  return toCdnUrl(String(it.previewUrl).trim())
}

function normalizeItems(cfg) {
  if (!cfg) return []
  if (Array.isArray(cfg.mediaItems) && cfg.mediaItems.length) {
    return cfg.mediaItems
      .filter((it) => it && it.mediaUrl)
      .map((it) => {
        const itemType = it.mediaType || (/\.(mp4|mov|m4v|webm)(\?|#|$)/i.test(it.mediaUrl) ? 'video' : 'image')
        const isVideoItem = itemType === 'video'
        return {
          id: String(it.id || it.mediaUrl || ''),
          mediaType: itemType,
          mediaUrl: isVideoItem ? toCdnUrl(it.mediaUrl) : optimizeImageUrl(it.mediaUrl, 'medium'),
          previewUrl: pickPreviewUrl(it, isVideoItem),
          posterUrl: it.posterUrl
            ? optimizeImageUrl(fixSplashPosterUrl(String(it.posterUrl).trim()), 'medium')
            : isVideoItem
              ? carouselVideoPosterUrl(it.mediaUrl, '')
              : '',
          missionName: String(it.missionName || '').trim(),
          launchId: String(it.launchId || '').trim()
        }
      })
  }
  if (cfg.mediaUrl) {
    const isVideoCfg = cfg.mediaType === 'video'
    return [
      {
        id: String(cfg.mediaUrl),
        mediaType: cfg.mediaType || 'image',
        mediaUrl: isVideoCfg ? toCdnUrl(cfg.mediaUrl) : optimizeImageUrl(cfg.mediaUrl, 'medium'),
        previewUrl: pickPreviewUrl(cfg, isVideoCfg),
        posterUrl: cfg.posterUrl
          ? optimizeImageUrl(fixSplashPosterUrl(String(cfg.posterUrl).trim()), 'medium')
          : isVideoCfg
            ? carouselVideoPosterUrl(cfg.mediaUrl, '')
            : '',
        missionName: String(cfg.missionName || '').trim(),
        launchId: String(cfg.launchId || '').trim()
      }
    ]
  }
  return []
}

function resolvePlay(item) {
  if (!item) return null
  const playUrl = item.previewUrl || item.mediaUrl
  return {
    id: item.id || '',
    mediaType: item.mediaType || 'image',
    mediaUrl: playUrl,
    posterUrl: item.posterUrl || '',
    originalUrl: item.mediaUrl,
    playUrl,
    missionName: item.missionName || '',
    launchId: item.launchId || ''
  }
}

function pickSplashItem(list, lastId) {
  const arr = Array.isArray(list) ? list.filter((it) => it && it.mediaUrl) : []
  if (!arr.length) return null
  if (arr.length === 1) return arr[0]
  let pool = arr
  if (lastId) {
    const others = arr.filter((it) => String(it.id) !== String(lastId))
    if (others.length) pool = others
  }
  return pool[Math.floor(Math.random() * pool.length)]
}

function isPreviewPlayUrl(resolved) {
  if (!resolved || resolved.mediaType !== 'video') return false
  const playUrl = resolved.playUrl || ''
  if (!/^https?:\/\//i.test(playUrl)) return false
  if (resolved.originalUrl && playUrl === resolved.originalUrl) return false
  return true
}

function playbackLikelyAllowed() {
  const cfg = getCachedMainConfig()
  if (cfg && cfg._id && cfg.enableEventVideo === false) return false
  return true
}

function preloadImage(url) {
  if (!url || !/^https?:\/\//i.test(url)) return
  try {
    wx.getImageInfo({ src: url, fail() {} })
  } catch (e) {}
}

function abortDownload(state) {
  if (!state) return
  const task = state.downloadTask
  state.downloadTask = null
  state.downloadPromise = null
  state.downloadUrl = ''
  state.pendingPlayUrl = ''
  if (task && typeof task.abort === 'function') {
    try {
      task.abort()
    } catch (e) {}
  }
}

function savePrefetchedFile(playUrl, tempFilePath) {
  if (!playUrl || !tempFilePath) return
  try {
    wx.getFileSystemManager().saveFile({
      tempFilePath,
      success: (saveRes) => {
        if (!saveRes || !saveRes.savedFilePath) return
        try {
          const cur = wx.getStorageSync(SPLASH_CACHE_KEY) || {}
          const map = cur.localPaths && typeof cur.localPaths === 'object' ? { ...cur.localPaths } : {}
          map[playUrl] = saveRes.savedFilePath
          wx.setStorageSync(SPLASH_CACHE_KEY, {
            ...cur,
            localPaths: map,
            localPath: saveRes.savedFilePath
          })
        } catch (e) {}
      },
      fail() {}
    })
  } catch (e) {}
}

function startDownload(state, playUrl) {
  if (!state || !playUrl || !/^https?:\/\//i.test(playUrl)) return null
  if (state.downloadUrl === playUrl && state.downloadPromise) return state.downloadPromise
  if (state.localPath && (state.playUrl === playUrl || state.downloadUrl === playUrl) && fileExists(state.localPath)) {
    return Promise.resolve(state.localPath)
  }
  abortDownload(state)
  state.playUrl = playUrl
  state.downloadUrl = playUrl
  const downloadPromise = new Promise((resolve) => {
    try {
      const task = wx.downloadFile({
        url: playUrl,
        success: (res) => {
          const path = res && res.statusCode === 200 && res.tempFilePath ? res.tempFilePath : ''
          if (path && state.playUrl === playUrl) {
            state.localPath = path
            // saveFile 会挪走临时文件。开播路径交给页面落盘；
            // 本轮没展示时延迟落盘，避免和即将到来的 <video src=temp> 抢文件
            if (!state.consumed) {
              setTimeout(() => {
                if (!state.consumed && state.localPath === path && state.playUrl === playUrl) {
                  savePrefetchedFile(playUrl, path)
                }
              }, 2500)
            }
          }
          resolve(path)
        },
        fail: () => resolve('')
      })
      state.downloadTask = task
    } catch (e) {
      resolve('')
    }
  })
  state.downloadPromise = downloadPromise
  return downloadPromise
}

function maybeStartDownload(state, resolved) {
  if (!state || !resolved) return
  if (state.localPath) return
  if (!isPreviewPlayUrl(resolved) || !playbackLikelyAllowed()) return
  if (state.weakNet) {
    state.skip = true
    return
  }
  if (!state.netResolved) {
    state.pendingPlayUrl = resolved.playUrl
    return
  }
  startDownload(state, resolved.playUrl)
}

function applyPicked(state, picked) {
  if (!state || !picked) return
  const resolved = resolvePlay(picked)
  if (!resolved) return
  const prevPlayUrl = state.playUrl
  state.picked = picked
  state.resolved = resolved
  state.playUrl = resolved.playUrl
  const local = localPathForPlayUrl(state.cached, resolved.playUrl)
  state.localPath = local || (prevPlayUrl === resolved.playUrl && fileExists(state.localPath) ? state.localPath : '')
  if (prevPlayUrl && prevPlayUrl !== resolved.playUrl) abortDownload(state)
  if (resolved.posterUrl) preloadImage(resolved.posterUrl)
  else if (resolved.mediaType === 'image' && resolved.playUrl) preloadImage(resolved.playUrl)
  if (state.weakNet && !state.localPath) {
    state.skip = true
    abortDownload(state)
    return
  }
  maybeStartDownload(state, resolved)
}

function fetchSplashConfig() {
  if (!wx.cloud || !wx.cloud.database) return Promise.resolve(null)
  try {
    return wx.cloud
      .database()
      .collection('starship_splash_config')
      .doc('current')
      .get()
      .then((res) => (res && res.data ? res.data : null))
      .catch(() => null)
  } catch (e) {
    return Promise.resolve(null)
  }
}

function pickMissionBind(state) {
  const resolved = state && state.resolved
  if (resolved && (resolved.launchId || resolved.missionName)) {
    return { launchId: resolved.launchId || '', missionName: resolved.missionName || '' }
  }
  const items = state && state.cached && Array.isArray(state.cached.mediaItems) ? state.cached.mediaItems : []
  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    if (it && (it.launchId || it.missionName)) {
      return { launchId: String(it.launchId || ''), missionName: String(it.missionName || '') }
    }
  }
  return null
}

function persistWarmedSplashMissionLogo(bind, mission) {
  if (!bind || !mission || !mission.id) return
  const logo = String(mission.launchAgencyImage || '').trim()
  if (!logo || !/^https?:\/\//i.test(logo)) return
  try {
    const prev = wx.getStorageSync('_splash_mission_hit') || null
    const sameId = prev && String(prev.id) === String(mission.id)
    wx.setStorage({
      key: '_splash_mission_hit',
      data: {
        configName: bind.missionName || (prev && prev.configName) || '',
        id: mission.id,
        name: mission.missionName || mission.name || (prev && prev.name) || '',
        launchTime: mission.launchTime || (prev && prev.launchTime) || '',
        agencyName: mission.launchAgency || (prev && prev.agencyName) || '',
        agencyLogo: logo || (sameId && prev ? prev.agencyLogo : ''),
        rocketName: mission.rocketName || (prev && prev.rocketName) || '',
        savedAt: Date.now()
      },
      fail() {}
    })
  } catch (e) {}
}

function warmSplashMissionSideData(state) {
  try {
    const hit = wx.getStorageSync('_splash_mission_hit')
    const logo = hit && hit.agencyLogo ? String(hit.agencyLogo).trim() : ''
    if (logo && /^https?:\/\//i.test(logo)) {
      preloadImage(logo)
      try {
        require('./agency-logo-cache.js').persistAgencyLogoAfterRemoteLoad(logo)
      } catch (e) {}
    }
  } catch (e) {}
  const bind = pickMissionBind(state)
  try {
    const listApi = require('./api-launch-list.js')
    if (bind && bind.launchId && typeof listApi.findMissionInListSnapshots === 'function') {
      const snap = listApi.findMissionInListSnapshots(bind.launchId, 'upcoming')
      if (snap && snap.launchAgencyImage) preloadImage(String(snap.launchAgencyImage))
    }
  } catch (e) {}
}

function bootFromCache(state) {
  const cached = state.cached
  if (!cached || cached.enabled === false) return
  const items = normalizeItems(cached)
  if (!items.length) return
  const picked = pickSplashItem(items, cached.lastSplashId)
  applyPicked(state, picked)
  warmSplashMissionSideData(state)
}

function persistSplashCfg(cfg, state) {
  if (!cfg) return
  try {
    let stored = null
    try {
      stored = wx.getStorageSync(SPLASH_CACHE_KEY) || null
    } catch (e) {}
    const prev = stored || (state && state.cached) || {}
    const next = {
      ...prev,
      enabled: cfg.enabled !== false,
      mediaItems: Array.isArray(cfg.mediaItems) && cfg.mediaItems.length ? cfg.mediaItems : prev.mediaItems || [],
      lastSplashId: prev.lastSplashId || '',
      noticeText: cfg.noticeText != null ? String(cfg.noticeText) : prev.noticeText || '',
      noticeFont: cfg.noticeFont || prev.noticeFont || 'default',
      noticeLineHeight: cfg.noticeLineHeight != null ? cfg.noticeLineHeight : prev.noticeLineHeight,
      noticeLetterSpacing: cfg.noticeLetterSpacing != null ? cfg.noticeLetterSpacing : prev.noticeLetterSpacing,
      noticeLineGap: cfg.noticeLineGap != null ? cfg.noticeLineGap : prev.noticeLineGap,
      localPaths: prev.localPaths && typeof prev.localPaths === 'object' ? prev.localPaths : {},
      localPath: prev.localPath || '',
      cachedAt: Date.now()
    }
    wx.setStorageSync(SPLASH_CACHE_KEY, next)
    if (state) state.cached = next
  } catch (e) {}
}

function applyCloudCfg(state, cfg) {
  if (!state) return
  state.cfg = cfg
  if (!cfg) return
  persistSplashCfg(cfg, state)
  if (cfg.enabled === false) {
    try {
      wx.setStorageSync(SPLASH_CACHE_KEY, { enabled: false })
    } catch (e) {}
    if (!state.consumed) {
      state.skip = true
      abortDownload(state)
    }
    return
  }
  if (state.consumed) return
  const items = normalizeItems(cfg)
  if (!items.length) return
  const lastId = state.cached && state.cached.lastSplashId ? String(state.cached.lastSplashId) : ''
  const picked = pickSplashItem(items, lastId)
  applyPicked(state, picked)
  warmSplashMissionSideData(state)
}

function markWeakNet(state, cached) {
  if (!state) return
  state.weakNet = true
  if (hasUsableLocalMedia(state, cached || state.cached)) return
  state.skip = true
  // 已交给页面展示后由页面关开屏；这里再 abort 会把页面正在等的预拉 promise 打成空
  if (!state.consumed) abortDownload(state)
}

function startSplashPrefetch(app) {
  const state = getPrefetchState(app)
  if (!state || state.started) return state
  state.started = true

  try {
    state.cached = wx.getStorageSync(SPLASH_CACHE_KEY) || null
  } catch (e) {
    state.cached = null
  }

  state.netPromise = probeNetwork().then((res) => {
    state.netResolved = true
    if (isWeakNetworkInfo(res)) {
      markWeakNet(state, state.cached)
    } else if (state.pendingPlayUrl && !state.localPath && !state.consumed && !state.weakNet) {
      startDownload(state, state.pendingPlayUrl)
      state.pendingPlayUrl = ''
    }
    return state.weakNet
  })

  if (typeof wx.onNetworkWeakChange === 'function' && !state.weakNetHandler) {
    try {
      const handler = (res) => {
        if (res && res.weakNet) markWeakNet(state, state.cached)
      }
      state.weakNetHandler = handler
      wx.onNetworkWeakChange(handler)
    } catch (e) {}
  }

  bootFromCache(state)
  try {
    require('../pages/index/utils/index-countdown-boot.js').hydrateCountdownBootToApp(app)
  } catch (eBoot) {}
  // 无开屏片时也预热即将发射 logo，避免首页胶囊只剩 SpaceX
  if (!state.picked) warmSplashMissionSideData(state)

  try {
    fetchMainConfig()
  } catch (e) {}

  state.cfgPromise = fetchSplashConfig().then((cfg) => {
    applyCloudCfg(state, cfg)
    return cfg
  })

  return state
}

function reuseSplashDownload(playUrl, app) {
  const state = getPrefetchState(app)
  if (!state || !playUrl) return null
  if (state.localPath && (state.playUrl === playUrl || state.downloadUrl === playUrl) && fileExists(state.localPath)) {
    return Promise.resolve(state.localPath)
  }
  if (state.downloadUrl === playUrl && state.downloadPromise) return state.downloadPromise
  return startDownload(state, playUrl)
}

function abortSplashPrefetchDownload(app) {
  const state = getPrefetchState(app)
  abortDownload(state)
}

module.exports = {
  SPLASH_CACHE_KEY,
  startSplashPrefetch,
  getPrefetchState,
  isWeakNetworkInfo,
  shouldSkipSplashForWeakNet,
  hasUsableLocalMedia,
  fileExists,
  fixSplashPosterUrl,
  normalizeItems,
  resolvePlay,
  pickSplashItem,
  reuseSplashDownload,
  abortSplashPrefetchDownload
}
