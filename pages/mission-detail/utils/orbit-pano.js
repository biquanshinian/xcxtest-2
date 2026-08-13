/**
 * orbit-pano.js（mission-detail 分包内副本）— 任务头图 Earth Studio 环绕全景
 * 点击后才挂 src，不预加载。会员 / 广告门控与设施图「环绕全景」共用。
 *
 * 视频按后台「环绕全景」的火箭型号匹配（global_config.main.orbitPanoItems），无内置片源。
 * 同型号后续任务都显示，不绑单次发射、不过期。
 * 过审总闸 enableOrbitPano（failClosed）：读不到配置 / 显式 false 则不展示、不播放、不进播放页。
 *
 * 注意：progress-extra 另有一份播放器副本（设施图同样只读后台配置）。
 * 不能放 shared 等其他分包（分包间同步 require 在直达入口时目标分包未下载会黑屏），
 * 也不放主包（代码质量扫描会报「主包未使用文件」）。
 */
const { toCdnUrl, videoSnapshotUrl } = require('../../../utils/cos-url.js')
const { isPlaybackAllowed, isOrbitPanoEnabled, getCachedMainConfig } = require('../../../utils/feature-flags.js')
const { gateCheck } = require('../../../utils/membership.js')
const { ROUTES } = require('../../../utils/routes.js')
const { matchOrbitPanoRocket } = require('../../../utils/rocket-name-i18n.js')

const ORBIT_PANO_GATE_ID = 'starbase_orbit_pano'
const ORBIT_PANO_GATE_NAME = '环绕全景'

let _busy = false

function matchOrbitPanoItem(item, mission) {
  if (!item || item.enabled === false) return false
  const videoUrl = String(item.videoUrl || item.mediaUrl || '').trim()
  if (!videoUrl) return false
  // 只按火箭型号匹配（中英同源，如 Long March 10B ↔ 长征十号乙）
  if (matchOrbitPanoRocket(item.rocketName, mission)) return true
  if (item.rocketName) return false
  const mid = String(mission.id || mission.launchId || '').trim()
  return !!(item.launchId && mid && String(item.launchId).trim() === mid)
}

function pickOrbitPanoItem(items, mission) {
  if (!mission || !Array.isArray(items)) return null
  for (let i = 0; i < items.length; i++) {
    if (matchOrbitPanoItem(items[i], mission)) return items[i]
  }
  return null
}

/**
 * @param {object} mission
 * @param {boolean} [forceRefresh]
 * @returns {Promise<object|null>}
 */
function resolveOrbitPanoForMission(mission, forceRefresh) {
  if (!mission) return Promise.resolve(null)
  return isOrbitPanoEnabled(!!forceRefresh)
    .then((on) => {
      if (!on) return null
      const cfg = getCachedMainConfig() || {}
      const items = Array.isArray(cfg.orbitPanoItems) ? cfg.orbitPanoItems : []
      return pickOrbitPanoItem(items, mission)
    })
    .catch(() => null)
}

/**
 * @param {{ path?: string, title?: string, imageUrl?: string }} [share]
 * @param {{ videoUrl?: string, posterUrl?: string, title?: string }} [item]
 * @returns {Promise<boolean>}
 */
async function playOrbitPanoVideo(share, item) {
  if (_busy) return false
  _busy = true
  try {
    const panoOk = await isOrbitPanoEnabled(true).catch(() => false)
    if (!panoOk) {
      wx.showToast({ title: '功能暂未开放', icon: 'none' })
      return false
    }
    const playbackOk = await isPlaybackAllowed().catch(() => false)
    if (!playbackOk) {
      wx.showToast({ title: '功能暂未开放', icon: 'none' })
      return false
    }
    const videoUrl = String((item && (item.videoUrl || item.mediaUrl)) || '').trim()
    if (!videoUrl) {
      wx.showToast({ title: '暂无环绕视频', icon: 'none' })
      return false
    }
    const gateName = String((item && item.title) || ORBIT_PANO_GATE_NAME).trim() || ORBIT_PANO_GATE_NAME
    const allowed = await gateCheck(ORBIT_PANO_GATE_ID, gateName)
    if (!allowed) return false

    const url = toCdnUrl(videoUrl)
    const poster = String((item && item.posterUrl) || '').trim() || videoSnapshotUrl(url, 1)
    try {
      const app = getApp()
      if (app && app.globalData) {
        app.globalData.pendingEventVideo = {
          url,
          poster,
          showmenu: false,
          remoteUrl: url,
          originalUrl: url,
          sourceUrl: '',
          share: (share && share.path) ? share : null
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
          wx.previewMedia({
            sources: [{ url, type: 'video', poster: poster || '' }],
            current: 0,
            showmenu: false,
            complete: resolve
          })
        }
      })
    })
    return true
  } finally {
    _busy = false
  }
}

module.exports = {
  ORBIT_PANO_GATE_ID,
  ORBIT_PANO_GATE_NAME,
  resolveOrbitPanoForMission,
  playOrbitPanoVideo
}
