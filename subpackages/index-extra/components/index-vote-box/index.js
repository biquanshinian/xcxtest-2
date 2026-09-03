Component({
  options: { styleIsolation: 'apply-shared' },
  properties: {
    launchId: { type: String, value: '' },
    themeClass: { type: String, value: '' },
    slotVisible: { type: Boolean, value: false },
    cdExpired: { type: Boolean, value: false },
    cdUnknown: { type: Boolean, value: false },
    ontimeEnabled: { type: Boolean, value: false },
    outcomeEnabled: { type: Boolean, value: false },
    activeType: { type: String, value: 'ontime' },
    total: { type: Number, value: 0 },
    myVote: { type: String, value: '' },
    typeVoted: { type: Boolean, value: false },
    vote: { type: Object, value: {} },
    countryDisplay: { type: String, value: '' },
    gePct: { type: Number, value: 0 },
    bugePct: { type: Number, value: 0 }
  },
  data: {
    votePop: false,
    voteBarEnter: false,
    resultFlash: false
  },
  observers: {
    'launchId, myVote, vote': function (launchId, myVote, vote) {
      const lid = launchId || ''
      const nextVote = myVote || ''
      const nextResult = (vote && vote.result) || ''
      if (this._voteLaunchId !== lid) {
        this._voteLaunchId = lid
        this._prevMyVote = nextVote
        this._prevResult = nextResult
        if (this.data.votePop || this.data.voteBarEnter || this.data.resultFlash) {
          this.setData({ votePop: false, voteBarEnter: false, resultFlash: false })
        }
        return
      }
      if (!this._prevMyVote && nextVote) {
        this.setData({ votePop: true, voteBarEnter: true })
        if (this._votePopTimer) clearTimeout(this._votePopTimer)
        this._votePopTimer = setTimeout(() => {
          this.setData({ votePop: false })
          this._votePopTimer = null
        }, 480)
      } else if (!nextVote && this.data.voteBarEnter) {
        this.setData({ voteBarEnter: false })
      }
      this._prevMyVote = nextVote
      if (!this._prevResult && nextResult && nextVote) {
        this.setData({ resultFlash: true })
        try { wx.vibrateShort({ type: 'medium' }) } catch (e) {}
        if (this._resultTimer) clearTimeout(this._resultTimer)
        this._resultTimer = setTimeout(() => {
          this.setData({ resultFlash: false })
          this._resultTimer = null
        }, 560)
      }
      this._prevResult = nextResult
    }
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
