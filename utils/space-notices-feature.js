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

module.exports = {
  CODE_ENABLED,
  FEATURE_FIELD,
  isSpaceNoticesEnabled,
  isSpaceNoticesCodeEnabled
}
