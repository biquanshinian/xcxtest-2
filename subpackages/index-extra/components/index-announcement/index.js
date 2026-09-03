Component({
  options: { styleIsolation: 'apply-shared' },
  properties: {
    themeClass: { type: String, value: '' },
    banner: { type: Object, value: null },
    dialogVisible: { type: Boolean, value: false },
    vote: { type: Object, value: null },
    scrollMaxPx: { type: Number, value: 320 }
  },
  methods: {
    noop() {},
    onOpen() { this.triggerEvent('open') },
    onCloseBanner() { this.triggerEvent('closebanner') },
    onCloseDialog() { this.triggerEvent('closedialog') },
    onVoteTap(e) {
      const ds = (e && e.currentTarget && e.currentTarget.dataset) || {}
      this.triggerEvent('votetap', ds)
    },
    onContact(e) { this.triggerEvent('contact', (e && e.detail) || {}) }
  }
})
