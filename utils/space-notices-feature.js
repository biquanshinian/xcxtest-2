/**
 * ============================================================================
 * SPACE_NOTICES_FEATURE — 可整块移除的「发射通告地图」功能开关
 * ============================================================================
 * 关闭方式（任选其一，推荐顺序）：
 * 1) 将下方 CODE_ENABLED 改为 false → 入口立即消失
 * 2) 云库 global_config.main.enableSpaceNotices = false
 * 3) 按文末清单删除文件并去掉接线注释行
 *
 * 移除清单（搜标记 SPACE_NOTICES_FEATURE）：
 * - utils/space-notices-feature.js          （本文件）
 * - cloudfunctions/spaceNotices/**
 * - subpackages/monitor-pages/space-notices/**
 * - utils/routes.js 中 SPACE_NOTICE_* 路由
 * - app.json monitor-pages 中 space-notices/* 页
 * - pages/monitor/monitor.{js,wxml} 入口卡相关
 * - pages/mission-detail/mission-detail.{js,wxml} 通告地图快捷入口
 * - pages/mission-detail/utils/space-notice-shortcut.js
 * - pages/progress/progress.{js,wxml} 与 progress-below-fold 星舰通告入口卡
 * 云库集合（可选清理）：space_notice_entry、space_notice
 * ============================================================================
 */

/** 代码级总开关：false 即整功能失效（无需改云配置） */
const CODE_ENABLED = true

const FEATURE_FIELD = 'enableSpaceNotices'

/**
 * @returns {Promise<boolean>}
 */
function isSpaceNoticesEnabled() {
  if (!CODE_ENABLED) return Promise.resolve(false)
  try {
    const { isFeatureEnabled } = require('./feature-flags.js')
    // 缺省开启；后台显式 false 可关
    return isFeatureEnabled(FEATURE_FIELD, { failClosed: false, defaultOff: false })
  } catch (e) {
    return Promise.resolve(!!CODE_ENABLED)
  }
}

function isSpaceNoticesCodeEnabled() {
  return !!CODE_ENABLED
}

/** 进度页直达兜底：库空或 lookup 未部署时仍能进星舰通告地图 */
const STARSHIP_NOTICE_FALLBACK_KEY = 'launch-starship-flight-13'

function lookupStarshipSpaceNotice() {
  if (!CODE_ENABLED) return Promise.resolve(null)
  if (typeof wx === 'undefined' || !wx.cloud || !wx.cloud.callFunction) {
    return Promise.resolve(null)
  }
  return isSpaceNoticesEnabled()
    .catch(() => false)
    .then((on) => {
      if (!on) return null
      return wx.cloud.callFunction({
        name: 'spaceNotices',
        data: { action: 'lookupStarshipEntry' }
      })
    })
    .then((res) => {
      if (!res) return null
      const r = (res && res.result) || res
      if (!r || r.success === false) return null
      const entryKey = String(r.entryKey || '').trim()
      if (!entryKey) return null
      return {
        entryKey,
        ll2Id: String(r.ll2Id || '').trim(),
        missionName: r.missionName || '',
        noticeCount: Number(r.noticeCount) || 0
      }
    })
    .catch(() => null)
}

module.exports = {
  CODE_ENABLED,
  FEATURE_FIELD,
  STARSHIP_NOTICE_FALLBACK_KEY,
  isSpaceNoticesEnabled,
  isSpaceNoticesCodeEnabled,
  lookupStarshipSpaceNotice
}
