/*
  全局布局唯一数据源（导航栏/TabBar/占位高度）
  防回归约束：
  1) 页面内仅消费 getUiShellLayout 返回值，不再各页自行计算
  2) 修改导航/TabBar位置只改这里一处（含自定义 TabBar 上方提示条及 TABBAR_TOP_STRIP_TRIM_PX 与 wxss 同步）
  3) 不要在全局样式追加 main-content-scroll 固定 padding
*/
const UI_SHELL_LAYOUT_RPX = {
  NAVBAR_HEIGHT: 156,
  NAVBAR_CONTENT_GAP: 8,
  TABBAR_TOTAL_HEIGHT: 182,
  /** iOS 26/27 悬浮 Tab 连续圆角（约 22pt ≈ 44rpx，非全胶囊 999rpx） */
  TABBAR_CORNER_RADIUS: 44,
  /** Tab 左右悬浮内边距（约 16pt ≈ 32rpx） */
  TABBAR_SIDE_INSET: 32,
  /** TabBar 主胶囊上方的「添加到桌面」横条内容区高度（与 custom-tab-bar 样式一致） */
  TABBAR_TOP_STRIP_HEIGHT: 96,
  /** 横条与下方 Tab 胶囊的间距 */
  TABBAR_TOP_STRIP_GAP: 14,
  /** 横条纵向再收紧的物理像素（与 custom-tab-bar padding 微调同步） */
  TABBAR_TOP_STRIP_TRIM_PX: 2,
  TABBAR_CONTENT_GAP: 16,
  /** Tab 胶囊距 home 指示条上方的额外间距（与 custom-tab-bar padding-bottom 超出 safe-area 部分同步） */
  TABBAR_FLOAT_BOTTOM: 10,
  PAGE_SIDE_SAFE: 20
}

function getUiShellLayout(systemInfo = {}) {
  const statusBarHeight = Number(systemInfo.statusBarHeight) || 44
  const windowWidth = Number(systemInfo.windowWidth) || 375
  const windowHeight = Number(systemInfo.windowHeight) || 667
  const screenHeight = Number(systemInfo.screenHeight) || windowHeight

  const safeAreaBottom = systemInfo.safeArea && Number(systemInfo.safeArea.bottom)
    ? Number(systemInfo.safeArea.bottom)
    : screenHeight

  const safeBottomInset = Math.max(0, screenHeight - safeAreaBottom)
  const rpxToPx = windowWidth / 750

  const navBarHeightPx = Math.round(UI_SHELL_LAYOUT_RPX.NAVBAR_HEIGHT * rpxToPx)
  const navGapPx = Math.round(UI_SHELL_LAYOUT_RPX.NAVBAR_CONTENT_GAP * rpxToPx)
  const tabBarHeightPx = Math.round(UI_SHELL_LAYOUT_RPX.TABBAR_TOTAL_HEIGHT * rpxToPx)
  const tabBarTopStripPx = Math.max(
    0,
    Math.round(
      (UI_SHELL_LAYOUT_RPX.TABBAR_TOP_STRIP_HEIGHT + UI_SHELL_LAYOUT_RPX.TABBAR_TOP_STRIP_GAP) * rpxToPx
    ) - (Number(UI_SHELL_LAYOUT_RPX.TABBAR_TOP_STRIP_TRIM_PX) || 0)
  )
  const tabBarGapPx = Math.round(UI_SHELL_LAYOUT_RPX.TABBAR_CONTENT_GAP * rpxToPx)
  const tabBarBottomOffsetPx = Math.round(UI_SHELL_LAYOUT_RPX.TABBAR_FLOAT_BOTTOM * rpxToPx)

  const navPlaceholderHeight = statusBarHeight + navBarHeightPx + navGapPx
  const tabBarReservedHeight =
    tabBarHeightPx + tabBarTopStripPx + tabBarGapPx + safeBottomInset + tabBarBottomOffsetPx

  return {
    statusBarHeight,
    windowWidth,
    windowHeight,
    safeBottomInset,
    navPlaceholderHeight,
    tabBarReservedHeight,
    pageSideSafePx: Math.round(UI_SHELL_LAYOUT_RPX.PAGE_SIDE_SAFE * rpxToPx)
  }
}

/**
 * 首页悬浮球可拖动区域（导航栏下沿 ↔ 「立即添加」横条上沿；横条隐藏时放宽到 Tab 胶囊上沿）
 * @param {Object} systemInfo
 * @param {{ btnSize?: number, showAddDesktopStrip?: boolean, bottomMargin?: number }} opts
 */
function getFloatingActionDragBounds(systemInfo = {}, opts = {}) {
  const layout = getUiShellLayout(systemInfo)
  const rpxToPx = layout.windowWidth / 750
  const btnSize = opts.btnSize != null ? opts.btnSize : Math.round(96 * rpxToPx)
  const edgeMargin = opts.edgeMargin != null ? opts.edgeMargin : 12
  const bottomMargin = opts.bottomMargin != null ? opts.bottomMargin : 8
  const tabBarHeightPx = Math.round(UI_SHELL_LAYOUT_RPX.TABBAR_TOTAL_HEIGHT * rpxToPx)
  const tabBarBottomOffsetPx = Math.round(UI_SHELL_LAYOUT_RPX.TABBAR_FLOAT_BOTTOM * rpxToPx)
  const stripGapPx = Math.round(UI_SHELL_LAYOUT_RPX.TABBAR_TOP_STRIP_GAP * rpxToPx)
  const stripHeightPx = Math.round(UI_SHELL_LAYOUT_RPX.TABBAR_TOP_STRIP_HEIGHT * rpxToPx)

  const minY = layout.navPlaceholderHeight
  const minX = edgeMargin
  const maxX = layout.windowWidth - btnSize - edgeMargin

  let maxY
  if (opts.showAddDesktopStrip) {
    maxY = layout.windowHeight - layout.safeBottomInset - tabBarBottomOffsetPx
      - tabBarHeightPx - stripGapPx - stripHeightPx - btnSize - bottomMargin
  } else {
    maxY = layout.windowHeight - layout.safeBottomInset - tabBarBottomOffsetPx
      - tabBarHeightPx - btnSize - bottomMargin
  }
  maxY = Math.max(minY, maxY)

  return Object.assign({}, layout, { btnSize, minX, maxX, minY, maxY, edgeMargin })
}

module.exports = {
  UI_SHELL_LAYOUT_RPX,
  getUiShellLayout,
  getFloatingActionDragBounds
}
