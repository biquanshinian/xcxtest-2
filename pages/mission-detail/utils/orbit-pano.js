/**
 * orbit-pano.js（mission-detail 分包内副本）— 任务头图 Earth Studio 环绕全景
 * 点击后才挂 src，不预加载。会员 / 广告门控与设施图「环绕全景」共用
 * （starbase_orbit_pano：看满 15 秒广告即可解锁，其它门控仍须看完）。
 *
 * 视频按后台 orbitPanoItems 匹配：默认同型号常驻；猎鹰 9 / 重型再对齐发射场。
 * 这两款若本次不回收，不展示 360（片源是发射→回收轨迹）。
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
const { pickOrbitPanoItem } = require('../../../utils/rocket-name-i18n.js')

const ORBIT_PANO_GATE_ID = 'starbase_orbit_pano'
const ORBIT_PANO_GATE_NAME = '环绕全景'

let _busy = false

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
