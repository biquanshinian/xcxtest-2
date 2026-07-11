/**
 * 事件更新视频：播放用压缩预览，下载用原片
 */
const { toCdnUrl, isVideoUrl, videoSnapshotUrl } = require('./cos-url.js')
const { ROUTES } = require('./routes.js')
const { isPlaybackAllowed } = require('./feature-flags.js')

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

  const play = playUrl || url
  const original = originalUrl || url
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
        showmenu
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
 * 下载并保存原视频到相册（会员权益）
 */
function saveEventOriginalVideo(originalUrl) {
  return new Promise((resolve) => {
    if (!originalUrl || !isVideoUrl(originalUrl)) {
      wx.showToast({ title: '无可保存的原视频', icon: 'none' })
      resolve(false)
      return
    }
    wx.showLoading({ title: '保存原视频…', mask: true })
    wx.downloadFile({
      url: originalUrl,
      success(res) {
        if (!res || res.statusCode !== 200 || !res.tempFilePath) {
          wx.hideLoading()
          wx.showToast({ title: '下载失败', icon: 'none' })
          resolve(false)
          return
        }
        wx.saveVideoToPhotosAlbum({
          filePath: res.tempFilePath,
          success() {
            wx.hideLoading()
            wx.showToast({ title: '已保存原视频', icon: 'success' })
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
      },
      fail() {
        wx.hideLoading()
        wx.showToast({ title: '下载失败', icon: 'none' })
        resolve(false)
      }
    })
  })
}

module.exports = {
  enrichVideoMediaItem,
  playEventVideo,
  saveEventOriginalVideo
}
