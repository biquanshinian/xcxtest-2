Component({
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
