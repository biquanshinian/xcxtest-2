/**
 * 薄壳：正本在 subpackages/shared/utils/event-video.js（placeholder 同步锚点）。
 * play/save 走 require.async；同步 API 在模块未就绪时按缓存未命中语义回退。
 */
const { toCdnUrl, isVideoUrl, videoSnapshotUrl } = require('../../../utils/cos-url.js')

function loadEventVideo() {
  if (!loadEventVideo._p) {
    loadEventVideo._p = require.async('../../shared/utils/event-video.js').then((m) => {
      loadEventVideo._m = m
      return m
    })
  }
  return loadEventVideo._p
}
loadEventVideo()

function eventVideoAdUnlockId(eventId, mediaIndex, url) {
  if (loadEventVideo._m) return loadEventVideo._m.eventVideoAdUnlockId(eventId, mediaIndex, url)
  if (eventId) {
    var idx = Number(mediaIndex)
    if (!Number.isFinite(idx) || idx < 0) idx = 0
    return 'evtvid:' + eventId + ':' + idx
  }
  var raw = String(url || '').trim()
  if (!raw) return 'evtvid:unknown'
  var noQuery = raw.split('?')[0].split('#')[0]
  var path = noQuery.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/]+/, '')
  return 'evtvid:' + (path || noQuery)
}

function enrichVideoMediaItem(media, opts) {
  if (loadEventVideo._m) return loadEventVideo._m.enrichVideoMediaItem(media, opts)
  if (!media || media.type !== 'video') return media
  const getCached = opts && opts.getCachedMediaImage
  const playable = !media.isLongVideo && isVideoUrl(media.url)
  let thumb = media.thumbnailUrl || ''
  if (!thumb && playable) thumb = videoSnapshotUrl(media.url, 1)
  const thumbnailRemoteUrl = thumb ? (toCdnUrl(thumb) || thumb) : ''
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
    thumbnailRemoteUrl,
    originalUrl,
    playUrl: playUrl || originalUrl
  }
}

async function playEventVideo(opts) {
  const m = await loadEventVideo()
  return m.playEventVideo(opts)
}

function saveEventVideoToAlbum(filePathOrUrl, opts) {
  return loadEventVideo().then((m) => m.saveEventVideoToAlbum(filePathOrUrl, opts))
}

function saveEventOriginalVideo(originalUrl) {
  return loadEventVideo().then((m) => m.saveEventOriginalVideo(originalUrl))
}

module.exports = {
  loadEventVideo,
  enrichVideoMediaItem,
  eventVideoAdUnlockId,
  playEventVideo,
  saveEventVideoToAlbum,
  saveEventOriginalVideo
}
