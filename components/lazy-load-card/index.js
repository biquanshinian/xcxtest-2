Component({
  // 页面的 glass-card / .lazy-load-card 共享样式（背景、圆角、:active 反馈）需作用到组件内部节点
  options: { styleIsolation: 'apply-shared' },
  properties: {
    icon: { type: String, value: '' },
    text: { type: String, value: '点击加载' },
    hint: { type: String, value: '' }
  },
  methods: {
    onTap() {
      this.triggerEvent('tap')
    }
  }
})
