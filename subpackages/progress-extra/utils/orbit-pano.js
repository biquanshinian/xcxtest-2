/**
 * orbit-pano.js（progress-extra 分包内副本）— 设施图 Earth Studio 环绕全景
 * 点击后才挂 src，不预加载。会员 / 广告门控与任务详情「环绕全景」共用。
 *
 * 只读后台 orbitPanoItems，无内置片源。按火箭型号匹配（设施图按 Starship / Starbase）。
 * 播放器 / 门控 / 匹配逻辑若改，须与 mission-detail 副本同步。
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

function resolveOrbitPanoForStarbase(forceRefresh) {
  return resolveOrbitPanoForMission({
    rocketName: 'Starship',
    rocketNameEn: 'Starship',
    name: 'Starbase',
    missionName: 'Starship'
  }, forceRefresh)
}

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
  resolveOrbitPanoForStarbase,
  playOrbitPanoVideo
}
