Component({
  properties: {
    message: { type: String, value: '加载失败' }
  },
  methods: {
    onRetry() {
      this.triggerEvent('retry')
    }
  }
})
