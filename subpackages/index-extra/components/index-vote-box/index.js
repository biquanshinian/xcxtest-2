Component({
  options: { styleIsolation: 'apply-shared' },
  properties: {
    themeClass: { type: String, value: '' },
    slotVisible: { type: Boolean, value: false },
    cdExpired: { type: Boolean, value: false },
    cdUnknown: { type: Boolean, value: false },
    ontimeEnabled: { type: Boolean, value: false },
    outcomeEnabled: { type: Boolean, value: false },
    activeType: { type: String, value: 'ontime' },
    total: { type: Number, value: 0 },
    myVote: { type: String, value: '' },
    vote: { type: Object, value: {} },
    countryDisplay: { type: String, value: '' },
    gePct: { type: Number, value: 0 },
    bugePct: { type: Number, value: 0 }
  },
  methods: {
    onTypeSwitch(e) {
      const type = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.type
      this.triggerEvent('typeswitch', { type })
    },
    onVote(e) {
      const pill = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.pill
      this.triggerEvent('vote', { pill })
    }
  }
})
