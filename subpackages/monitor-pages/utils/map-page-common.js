const { getUiShellLayout } = require('../../../utils/layout.js')
const { getSystemInfo } = require('../../../utils/system.js')

function formatMapUpdateTime(date, fallback = '待更新') {
  const d = date instanceof Date ? date : new Date(date)
  if (Number.isNaN(d.getTime())) return fallback
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} 更新`
}

function buildMapSharePayload(shareTitle, detailText, path) {
  return {
    title: `${shareTitle || '地图页'} · ${detailText || '查看详情'}`,
    path: path || '/pages/index/index'
  }
}

function buildMapStatePatch(options = {}) {
  const loading = options.loading === true
  const errorText = options.errorText || ''
  const emptyText = options.emptyText || ''
  return {
    loading,
    errorText,
    emptyText
  }
}

function createMapBaseState(extra = {}) {
  return {
    loading: false,
    errorText: '',
    emptyText: '',
    analyticsScene: '',
    shareTitle: '地图页',
    dataSourceText: '',
    dataUpdatedText: '待更新',
    refreshing: false,
    ...extra
  }
}

function findItemById(list, id, key = 'id') {
  return (Array.isArray(list) ? list : []).find((item) => Number(item && item[key]) === Number(id)) || null
}

function buildMapLayoutData(app, options = {}) {
  const uiShellLayout = (app && app.getUiShellLayout && app.getUiShellLayout()) || getUiShellLayout(getSystemInfo())
  const statusBarHeight = Number(uiShellLayout.statusBarHeight) || 44
  const rpxToPx = (Number(uiShellLayout.windowWidth) || 375) / 750
  let menuTop = statusBarHeight
  let menuHeight = Math.round(32 * rpxToPx) || 32
  let menuButtonWidth = 88
  try {
    const menuBtn = wx.getMenuButtonBoundingClientRect()
    if (menuBtn && menuBtn.height) {
      menuTop = Number(menuBtn.top) || menuTop
      menuHeight = Number(menuBtn.height) || menuHeight
      if (menuBtn.width) menuButtonWidth = Math.max(88, Math.ceil(menuBtn.width + 24))
    }
  } catch (e) {}
  // 与 top-nav--page-grid 一致：padding-top 24rpx + min-height 96rpx；再与胶囊下沿取大，紧贴导航栏下口
  const navRowBottom = statusBarHeight + Math.round((24 + 96) * rpxToPx)
  const capsuleBottom = menuTop + menuHeight
  const navBottom = Math.max(capsuleBottom, navRowBottom)
  // 下限兜底：避免胶囊 API 异常时 mapActionTop=0 叠进状态栏
  const mapActionTop = Math.max(Math.round(navBottom + 8), statusBarHeight + Math.round(56 * rpxToPx))
  const patch = {
    statusBarHeight,
    capsuleTop: menuTop,
    capsuleHeight: menuHeight,
    menuButtonWidth,
    mapActionTop
  }
  if (options.includeNavPlaceholder) patch.navPlaceholderHeight = uiShellLayout.navPlaceholderHeight
  if (options.includeTabBarReserved) patch.tabBarReservedHeight = uiShellLayout.tabBarReservedHeight
  return patch
}

function buildSelectionPatch(options = {}) {
  const item = findItemById(options.list, options.id, options.idKey || 'id')
  if (!item) return null
  const patch = {
    [options.selectedKey || 'selectedItem']: item
  }
  const latitudeKey = options.latitudeKey || 'latitude'
  const longitudeKey = options.longitudeKey || 'longitude'
  if (item[latitudeKey] !== undefined) patch.latitude = item[latitudeKey]
  if (item[longitudeKey] !== undefined) patch.longitude = item[longitudeKey]
  if (options.scale !== undefined) patch.scale = options.scale
  if (options.extra && typeof options.extra === 'object') {
    Object.assign(patch, options.extra)
  }
  return patch
}

function buildMapOverlayTopStyle(mapActionTop, options = {}) {
  const app = typeof getApp === 'function' ? getApp() : null
  const uiShellLayout = (app && app.getUiShellLayout && app.getUiShellLayout()) || getUiShellLayout(getSystemInfo())
  const rpxToPx = (Number(uiShellLayout.windowWidth) || 375) / 750
  const collapsedHeightRpx = options.collapsedHeightRpx !== undefined ? Number(options.collapsedHeightRpx) : 72
  const expandedHeightRpx = options.expandedHeightRpx !== undefined ? Number(options.expandedHeightRpx) : 364
  const gapPx = options.gapPx !== undefined ? Number(options.gapPx) : 16
  const isCollapsed = options.collapsed !== false
  const overlayHeightPx = (isCollapsed ? collapsedHeightRpx : expandedHeightRpx) * rpxToPx
  const topPx = Math.round((Number(mapActionTop) || 0) + overlayHeightPx + gapPx)
  return `top: ${topPx}px;`
}

/**
 * 底部信息面板展开时的 max-height / scroll-view 高度。
 * 上沿不得超过地图工具下口（否则工具钮会挡住状态/折叠）。
 */
function buildMapPanelScrollLayout(app, options = {}) {
  const uiShell = (app && app.getUiShellLayout && app.getUiShellLayout()) || getUiShellLayout(getSystemInfo())
  const rpxToPx = (Number(uiShell.windowWidth) || 375) / 750
  const windowHeight = Number(uiShell.windowHeight) || 667
  const bottomPx = options.bottomPx !== undefined ? Number(options.bottomPx) : Math.round(24 * rpxToPx) + 16
  const topGapPx = options.topGapPx !== undefined ? Number(options.topGapPx) : 10
  const chromeRpx = options.chromeRpx !== undefined ? Number(options.chromeRpx) : 120
  const minPanelPx = options.minPanelPx !== undefined ? Number(options.minPanelPx) : 220
  const minScrollPx = options.minScrollPx !== undefined ? Number(options.minScrollPx) : 120
  const mapActionTop = Number(options.mapActionTop) || 0
  const actionCollapsed = options.actionMenuCollapsed !== false
  const actionHeightRpx = actionCollapsed
    ? (options.actionCollapsedHeightRpx !== undefined ? Number(options.actionCollapsedHeightRpx) : 72)
    : (options.actionExpandedHeightRpx !== undefined ? Number(options.actionExpandedHeightRpx) : 292)
  const actionBottom = mapActionTop > 0
    ? mapActionTop + Math.round(actionHeightRpx * rpxToPx)
    : (Number(uiShell.navPlaceholderHeight) || 0)
  const topPx = actionBottom + topGapPx
  const panelMaxHeight = Math.max(minPanelPx, Math.floor(windowHeight - topPx - bottomPx))
  const chromePx = Math.round(chromeRpx * rpxToPx)
  const panelScrollHeight = Math.max(minScrollPx, panelMaxHeight - chromePx)
  return {
    panelMaxHeight,
    panelScrollHeight,
    panelExpandedStyle: `max-height:${panelMaxHeight}px; overflow:hidden;`
  }
}

function buildMapShareOptions(options = {}) {
  return buildMapSharePayload(options.shareTitle, options.detailText || options.fallbackDetailText, options.path)
}

function copyMapText(text, successText = '已复制') {
  const value = String(text || '').trim()
  if (!value) {
    wx.showToast({ title: '暂无可复制内容', icon: 'none' })
    return
  }
  wx.setClipboardData({
    data: value,
    success() {
      wx.showToast({ title: successText, icon: 'none' })
    }
  })
}

async function runMapRefresh(page, runner) {
  if (!page || !runner || typeof runner !== 'function') return
  if (page.data && page.data.refreshing) return
  page.setData({ refreshing: true })
  try {
    await runner()
    wx.showToast({ title: '已更新', icon: 'none' })
  } catch (e) {
    wx.showToast({ title: '刷新失败', icon: 'none' })
  } finally {
    page.setData({ refreshing: false })
  }
}

module.exports = {
  formatMapUpdateTime,
  buildMapSharePayload,
  buildMapStatePatch,
  createMapBaseState,
  findItemById,
  buildMapLayoutData,
  buildSelectionPatch,
  buildMapOverlayTopStyle,
  buildMapPanelScrollLayout,
  buildMapShareOptions,
  copyMapText,
  runMapRefresh
}
