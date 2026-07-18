/**
 * 导航顶占位：初始高度由 height 属性设定；
 * 下拉过程由 utils/nav-scroll-pad.wxs 用 setStyle 改高度（不经 setData）。
 */
Component({
  options: {
    virtualHost: true
  },
  properties: {
    height: {
      type: Number,
      value: 0
    }
  }
})
