/** 冷启动可直接展示公众号关注组件的场景值（基础库 2.18.1+） */
const COLD_START_SCENES = new Set([1011, 1017, 1025, 1047, 1124])

/** 热启动场景值：冷启动场景命中 COLD_START_SCENES 时可展示 */
const HOT_START_SCENES = new Set([1001, 1038, 1041, 1089, 1090, 1104, 1131, 1187])

function readEnterScene() {
  try {
    if (typeof wx.getEnterOptionsSync === 'function') {
      const info = wx.getEnterOptionsSync()
      if (info && typeof info.scene === 'number') return info.scene
    }
  } catch (_) {}
  return null
}

function readLaunchScene() {
  try {
    if (typeof wx.getLaunchOptionsSync === 'function') {
      const info = wx.getLaunchOptionsSync()
      if (info && typeof info.scene === 'number') return info.scene
    }
  } catch (_) {}
  return null
}

/**
 * 当前会话是否允许展示 <official-account> 组件。
 * 详见：https://developers.weixin.qq.com/miniprogram/dev/component/official-account.html
 */
function canShowOfficialAccount() {
  const enterScene = readEnterScene()
  const launchScene = readLaunchScene()

  if (enterScene != null && COLD_START_SCENES.has(enterScene)) {
    return true
  }

  if (
    enterScene != null
    && HOT_START_SCENES.has(enterScene)
    && launchScene != null
    && COLD_START_SCENES.has(launchScene)
  ) {
    return true
  }

  return false
}

module.exports = {
  COLD_START_SCENES,
  HOT_START_SCENES,
  canShowOfficialAccount
}
