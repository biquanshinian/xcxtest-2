Component({
  options: { styleIsolation: 'apply-shared' },
  properties: {
    themeClass: { type: String, value: '' },
    visible: { type: Boolean, value: false },
    mission: { type: Object, value: null }
  },
  methods: {
    noop() {},
    onClose() { this.triggerEvent('close') },
    onItemTap() { this.triggerEvent('itemtap') }
  }
})
