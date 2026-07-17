/**
 * 事件更新视频：播放用压缩预览，下载用原片
 */
const { toCdnUrl, isVideoUrl, videoSnapshotUrl } = require('./cos-url.js')
const { ROUTES } = require('./routes.js')
const { isPlaybackAllowed } = require('./feature-flags.js')
const { getCachedVideo } = require('./video-cache.js')

/**
 * 单条视频的广告解锁键：一次广告只解锁当前这条视频（而非整个事件更新版块）
 * 有 eventId 时键跨页面稳定（轮播 → 详情自动播放共用）；否则回退用归一化 URL
 * @param {string} eventId 事件 _id
 * @param {number} mediaIndex 视频在 mediaList 中的下标
 * @param {string} [url] 兜底用的视频地址（无 eventId 时）
 * @returns {string} 形如 'evtvid:<eventId>:<idx>' 或 'evtvid:<pathname>'
 */
function eventVideoAdUnlockId(eventId, mediaIndex, url) {
  if (eventId) {
    var idx = Number(mediaIndex)
    if (!Number.isFinite(idx) || idx < 0) idx = 0
    return 'evtvid:' + eventId + ':' + idx
  }
  var raw = String(url || '').trim()
  if (!raw) return 'evtvid:unknown'
  // 去 query / 去域名取 pathname，同一文件不同 CDN 域名或签名参数也命中同一键
  var noQuery = raw.split('?')[0].split('#')[0]
  var path = noQuery.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/]+/, '')
  return 'evtvid:' + (path || noQuery)
}

function enrichVideoMediaItem(media, opts) {
  if (!media || media.type !== 'video') return media
  const getCached = opts && opts.getCachedMediaImage
  const playable = !media.isLongVideo && isVideoUrl(media.url)
  let thumb = media.thumbnailUrl || ''
  if (!thumb && playable) {
    thumb = videoSnapshotUrl(media.url, 1)
  }
  if (thumb && typeof getCached === 'function') {
    thumb = getCached(thumb, opts.thumbPreset || 'none')
  } else if (thumb) {
    thumb = toCdnUrl(thumb)
  }

  const originalUrl = media.url ? toCdnUrl(media.url) : ''
  const previewRaw = media.previewUrl && String(media.previewUrl).trim()
  const playUrl = previewRaw ? toCdnUrl(previewRaw) : originalUrl

  return {
    ...media,
    isPlayable: playable,
    thumbnailUrl: thumb,
    originalUrl,
    playUrl: playUrl || originalUrl
  }
}

/**
 * 全屏播放：优先压缩预览；原片仅用于会员下载
 * @returns {Promise<'played'|'copied'|'noop'>}
 */
async function playEventVideo(opts) {
  const allowed = await isPlaybackAllowed().catch(() => false)
  if (!allowed) return 'noop'

  const {
    url,
    playUrl,
    originalUrl,
    thumb,
    videoUrl,
    sourceUrl,
    isLong,
    canSave,
    onSaveHint
  } = opts || {}

  if (isLong || videoUrl) {
    const link = videoUrl || sourceUrl || url
    if (!link) return 'noop'
    await new Promise((resolve) => {
      wx.setClipboardData({
        data: link,
        success() {
          wx.showToast({ title: '视频链接已复制，请在浏览器中打开', icon: 'none', duration: 2500 })
        },
        complete: resolve
      })
    })
    return 'copied'
  }

  let play = playUrl || url
  const original = originalUrl || url
  // 进缓存前的远端播放地址：getCachedVideo 可能返回本地路径，复制链接需用远端地址
  const remotePlay = play
  // 压缩预览片走本地视频缓存：命中零流量，未命中后台落盘供下次复用（原片不缓存）
  if (play && original && play !== original && isVideoUrl(play)) {
    play = getCachedVideo(play)
  }
  if (!play || !isVideoUrl(play)) {
    if (!url) return 'noop'
    await new Promise((resolve) => {
      wx.setClipboardData({
        data: url,
        success() {
          wx.showToast({ title: '链接已复制，请在浏览器中打开', icon: 'none', duration: 2500 })
        },
        complete: resolve
      })
    })
    return 'copied'
  }

  const sameAsOriginal = !original || play === original
  // 播预览版时关闭系统长按菜单（否则会存压缩版）；原片下载走长按封面
  const showmenu = !!canSave && sameAsOriginal

  if (canSave && !sameAsOriginal && typeof onSaveHint === 'function') {
    onSaveHint('长按封面可保存原视频')
  } else if (!canSave && typeof onSaveHint === 'function') {
    onSaveHint('开通会员可长按保存原视频')
  }

  // 自研播放页：固定顶部关闭钮，避免 wx.previewMedia / 横屏全屏把关闭钮旋到左下角
  try {
    const app = getApp()
    if (app && app.globalData) {
      app.globalData.pendingEventVideo = {
        url: play,
        poster: thumb || '',
        showmenu,
        remoteUrl: remotePlay || '',
        originalUrl: original || '',
        sourceUrl: sourceUrl || ''
      }
    }
  } catch (e) {}

  await new Promise((resolve) => {
    wx.navigateTo({
      url: ROUTES.VIDEO_PLAYER,
      success: resolve,
      fail() {
        try {
          const app = getApp()
          if (app && app.globalData) app.globalData.pendingEventVideo = null
        } catch (e) {}
        // 分包未就绪等异常时回退原生预览
        wx.previewMedia({
          sources: [{ url: play, type: 'video', poster: thumb || '' }],
          current: 0,
          showmenu,
          complete: resolve
        })
      }
    })
  })
  return 'played'
}

/**
 * 下载（远端地址）或直接（本地路径）保存视频到相册（会员权益）
 * @param {string} filePathOrUrl 远端 http(s) 地址或本地临时/缓存路径
 * @param {object} [opts] { loadingTitle, successTitle, emptyTitle }
 */
function saveEventVideoToAlbum(filePathOrUrl, opts) {
  const o = opts || {}
  const loadingTitle = o.loadingTitle || '保存视频…'
  const successTitle = o.successTitle || '已保存到相册'
  const emptyTitle = o.emptyTitle || '无可保存的视频'

  return new Promise((resolve) => {
    const src = String(filePathOrUrl || '').trim()
    if (!src) {
      wx.showToast({ title: emptyTitle, icon: 'none' })
      resolve(false)
      return
    }

    function doSave(filePath) {
      wx.saveVideoToPhotosAlbum({
        filePath,
        success() {
          wx.hideLoading()
          wx.showToast({ title: successTitle, icon: 'success' })
          resolve(true)
        },
        fail(err) {
          wx.hideLoading()
          const msg = (err && err.errMsg) || ''
          if (/auth deny|authorize|privacy/i.test(msg)) {
            wx.showModal({
              title: '需要相册权限',
              content: '请在设置中允许保存到相册',
              confirmText: '去设置',
              success(r) {
                if (r.confirm) wx.openSetting({})
              }
            })
          } else {
            wx.showToast({ title: '保存失败', icon: 'none' })
          }
          resolve(false)
        }
      })
    }

    const isRemote = /^https?:\/\//i.test(src)
    if (isRemote && !isVideoUrl(src)) {
      wx.showToast({ title: emptyTitle, icon: 'none' })
      resolve(false)
      return
    }

    wx.showLoading({ title: loadingTitle, mask: true })
    if (!isRemote) {
      // 本地临时/缓存路径直接保存，无需下载
      doSave(src)
      return
    }
    wx.downloadFile({
      url: src,
      success(res) {
        if (!res || res.statusCode !== 200 || !res.tempFilePath) {
          wx.hideLoading()
          wx.showToast({ title: '下载失败', icon: 'none' })
          resolve(false)
          return
        }
        doSave(res.tempFilePath)
      },
      fail() {
        wx.hideLoading()
        wx.showToast({ title: '下载失败', icon: 'none' })
        resolve(false)
      }
    })
  })
}

/**
 * 下载并保存原视频到相册（会员权益）
 */
function saveEventOriginalVideo(originalUrl) {
  return saveEventVideoToAlbum(originalUrl, {
    loadingTitle: '保存原视频…',
    successTitle: '已保存原视频',
    emptyTitle: '无可保存的原视频'
  })
}

module.exports = {
  enrichVideoMediaItem,
  eventVideoAdUnlockId,
  playEventVideo,
  saveEventVideoToAlbum,
  saveEventOriginalVideo
}
