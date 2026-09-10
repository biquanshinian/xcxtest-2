Component({
  options: { styleIsolation: 'apply-shared' },
  properties: {
    visible: { type: Boolean, value: false },
    badge: { type: Object, value: null }
  },
  methods: {
    onClose() { this.triggerEvent('close') }
  }
})
