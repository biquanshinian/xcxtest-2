/**
 * 路由常量 + 导航工具
 * 集中管理所有页面路径，消除 45+ 处硬编码的 wx.navigateTo
 */

const ROUTES = {
  // ── 主包 Tab 页 ──
  INDEX: '/pages/index/index',
  MONITOR: '/pages/monitor/monitor',
  PROGRESS: '/pages/progress/progress',
  NEWS: '/pages/news/news',
  PROFILE: '/pages/profile/profile',

  // ── 主包详情页 ──
  INDEX_MISSION_DETAIL: '/subpackages/index-extra/mission-detail',
  GLOBAL_LAUNCH_STATS: '/subpackages/index-extra/global-launch-stats',
  PREFERENCES: '/subpackages/profile-extra/preferences/preferences',
  TIMELINE: '/subpackages/profile-extra/timeline/timeline',
  YEAR_REVIEW: '/subpackages/profile-extra/year-review/year-review',
  EVENT_DETAIL: '/subpackages/progress-extra/event-detail',
  STARBASE_MAP: '/subpackages/progress-extra/starbase-map',
  ROAD_CLOSURE_MAP: '/subpackages/progress-extra/road-closure-map',
  ROAD_CLOSURE_DETAIL: '/subpackages/progress-extra/road-closure-detail',
  NEWS_DETAIL: '/subpackages/news-extra/detail',
  PHOTO_DETAIL: '/subpackages/news-extra/photo-detail',
  PHOTO_UPLOAD: '/subpackages/news-extra/photo-upload',

  // ── 分包页 ──
  BRIEFING: '/subpackages/shared/briefing',
  MISSION_DETAIL: '/pages/mission-detail/mission-detail',
  LAUNCH_UPDATES: '/pages/mission-detail/launch-updates',
  SEARCH: '/pages/search/search',
  NASA_DATA: '/pages/nasa-data/nasa-data',
  EONET_MAP: '/pages/nasa-data/eonet-map',
  ABOUT: '/pages/about/about',
  COLLECT: '/pages/collect/collect',
  LUNAR_WISHES: '/pages/collect/collect',
  ASTRO_CALENDAR: '/pages/space-explore/astro-calendar',
  EXOPLANET: '/pages/space-explore/exoplanet',
  WEBVIEW: '/pages/webview/webview',
  VIDEO_PLAYER: '/pages/video-player/video-player',

  // ── monitor-pages 分包 ──
  MP_LANDING: '/subpackages/monitor-pages/mp-landing',
  STARLINK_FULLSCREEN: '/subpackages/monitor-pages/starlink-fullscreen',
  STARLINK_AR: '/subpackages/monitor-pages/starlink-ar/starlink-ar',
  PASS_MAP: '/subpackages/monitor-pages/pass-map',
  STARLINK_PASS_DETAIL: '/subpackages/monitor-pages/starlink-pass-detail',
  LAUNCH_SITE_MAP: '/subpackages/monitor-pages/launch-site-map',
  AGENCY_DETAIL: '/subpackages/monitor-pages/agency-detail',
  AGENCY_LAUNCHES: '/subpackages/monitor-pages/agency-launches',
  SPACECRAFT_DETAIL: '/subpackages/monitor-pages/spacecraft-detail',
  SPACECRAFT_GALLERY: '/subpackages/monitor-pages/spacecraft-gallery',
  LAUNCH_SITE_GALLERY: '/subpackages/monitor-pages/launch-site-gallery',
  LAUNCH_SITE_DETAIL: '/subpackages/monitor-pages/launch-site-detail',
  STATION_DETAIL: '/subpackages/monitor-pages/station-detail',
  ORBIT_MAP: '/subpackages/monitor-pages/orbit-map',
  BOOSTER_DETAIL: '/subpackages/monitor-pages/booster-detail',
  BOOSTER_GENEALOGY: '/subpackages/monitor-pages/booster-genealogy',
  ROCKET_MODEL_DETAIL: '/subpackages/monitor-pages/rocket-model-detail',
  ARTEMIS_DETAIL: '/subpackages/monitor-pages/artemis-detail',
  ORBITAL_DATA_CENTER: '/subpackages/monitor-pages/orbital-data-center/orbital-data-center',
  VEHICLE_TRACKER: '/subpackages/monitor-pages/vehicle-tracker/vehicle-tracker'
}

/**
 * 付费功能路由 → 产品 ID 映射
 * 只有在此映射中的路由才会触发门控检查
 * 注意：星链AR和Artemis已在 monitor.js 中直接用 gateCheck 拦截
 */
const PAID_ROUTE_MAP = {}

/**
 * 跳转到指定路由（带付费门控）
 * @param {string} route  ROUTES 中的路径
 * @param {Object} [params]  URL 查询参数
 */
async function navigateTo(route, params) {
  // 防止把 https:// 外链误传给 wx.navigateTo（会触发 unknown protocol 框架错误）
  if (typeof route === 'string' && /^https?:\/\//i.test(route.trim())) {
    wx.navigateTo({
      url: `${ROUTES.WEBVIEW}?url=${encodeURIComponent(route.trim())}`
    })
    return
  }

  // 付费门控检查
  const paidInfo = PAID_ROUTE_MAP[route]
  if (paidInfo) {
    try {
      const { gateCheck } = require('./membership.js')
      const allowed = await gateCheck(paidInfo.productId, paidInfo.name)
      if (!allowed) return
    } catch (e) {}
  }

  const url = params ? buildUrl(route, params) : route
  wx.navigateTo({ url })
}

/**
 * 跳转并关闭当前页
 */
function redirectTo(route, params) {
  if (typeof route === 'string' && /^https?:\/\//i.test(route.trim())) {
    wx.redirectTo({
      url: `${ROUTES.WEBVIEW}?url=${encodeURIComponent(route.trim())}`
    })
    return
  }
  const url = params ? buildUrl(route, params) : route
  wx.redirectTo({ url })
}

/**
 * 切换 Tab
 */
function switchTab(route) {
  wx.switchTab({ url: route })
}

/**
 * 构建带查询参数的 URL
 */
function buildUrl(route, params) {
  if (!params || typeof params !== 'object') return route
  const query = Object.keys(params)
    .filter(k => params[k] !== undefined && params[k] !== null)
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
    .join('&')
  return query ? `${route}?${query}` : route
}

module.exports = {
  ROUTES,
  navigateTo,
  redirectTo,
  switchTab,
  buildUrl
}
