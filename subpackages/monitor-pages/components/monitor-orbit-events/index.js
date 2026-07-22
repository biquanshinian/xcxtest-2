/**
 * 即将进行的在轨任务（从监控页拆出的纯展示组件）
 * 懒加载按钮 / 事件卡点击经事件交回页面（逻辑在 monitor-orbital.js 委托加载）
 */
Component({
  options: { styleIsolation: 'apply-shared' },
  properties: {
    /* 组件 wxss 的 .theme-light 后代选择器无法匹配组件外的页面根节点，
       须把主题类挂到组件自身根节点上才能生效 */
    themeClass: { type: String, value: '' },
    orbitalReady: { type: Boolean, value: false },
    orbitalLoading: { type: Boolean, value: false },
    upcomingOrbitalEvents: { type: Array, value: [] },
    orbitalCountdown: { type: Object, value: {} }
  },
  methods: {
    emitLoadTap() { this.triggerEvent('loadtap') },
    emitEventTap(e) { this.triggerEvent('eventtap', { id: (e.currentTarget.dataset || {}).id }) },
    emitImageError(e) {
      const ds = e.currentTarget.dataset || {}
      this.triggerEvent('imageerror', { index: ds.index, id: ds.id })
    }
  }
})
