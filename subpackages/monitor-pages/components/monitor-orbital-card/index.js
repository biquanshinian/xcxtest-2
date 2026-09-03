/**
 * 太空轨道数据中心入口卡（从监控页拆出的纯展示组件）
 * 状态由页面下发，点击/图错经事件交回页面（逻辑在 monitor-orbital.js 委托加载）
 */
Component({
  options: { styleIsolation: 'apply-shared' },
  properties: {
    orbitalCardBg: { type: String, value: '' },
    orbitalCardBgIsVideo: { type: Boolean, value: false },
    orbitalLiveStats: { type: Object, value: {} },
    orbitalCardCta: { type: String, value: '' },
    isProUser: { type: Boolean, value: false }
  },
  methods: {
    emitCardTap() { this.triggerEvent('cardtap') },
    emitBgError() { this.triggerEvent('bgerror') }
  }
})
