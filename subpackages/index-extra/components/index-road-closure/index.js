Component({
  options: { styleIsolation: 'apply-shared' },
  properties: {
    notice: { type: Object, value: null },
    missionType: { type: String, value: 'upcoming' }
  },
  methods: {
    emitOpen() { this.triggerEvent('open') }
  }
})
