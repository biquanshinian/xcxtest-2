Component({
  options: {
    virtualHost: true,
    styleIsolation: 'apply-shared'
  },
  properties: {
    carouselPending: { type: Boolean, value: false },
    carouselItems: { type: Array, value: [] },
    missionType: { type: String, value: 'upcoming' },
    carouselCurrent: { type: Number, value: 0 },
    gestureLocked: { type: Boolean, value: false }
  },
  data: {
    frozenSrc: ''
  },
  observers: {
    'gestureLocked, carouselItems, carouselCurrent': function (locked, items, current) {
      if (!locked) {
        if (this.data.frozenSrc) this.setData({ frozenSrc: '' })
        return
      }
      const list = Array.isArray(items) ? items : []
      const i = Math.min(Math.max(Number(current) || 0, 0), Math.max(list.length - 1, 0))
      const it = list[i] || list[0]
      if (!it) {
        if (this.data.frozenSrc) this.setData({ frozenSrc: '' })
        return
      }
      const src = it.type === 'video' ? (it.poster || '') : (it.src || it.url || '')
      if (src !== this.data.frozenSrc) this.setData({ frozenSrc: src })
    }
  },
  methods: {
    _ds(e) { return (e && e.currentTarget && e.currentTarget.dataset) || {} },
    _blocked() { return !!this.properties.gestureLocked },
    emitNoop() {},
    emitImageError(e) { this.triggerEvent('imageerror', { ...this._ds(e), detail: e.detail }) },
    emitImageLoad(e) { this.triggerEvent('imageload', { ...this._ds(e), detail: e.detail }) },
    emitPreview(e) {
      if (this._blocked()) return
      this.triggerEvent('preview', this._ds(e))
    },
    emitSave(e) { this.triggerEvent('save', this._ds(e)) },
    emitCaption(e) { this.triggerEvent('caption', this._ds(e)) },
    emitVideoTap(e) {
      if (this._blocked()) return
      const ds = { ...this._ds(e) }
      if (ds.index == null || ds.index === '') ds.index = this.properties.carouselCurrent
      this.triggerEvent('videotap', ds)
    },
    emitChange(e) { this.triggerEvent('change', e.detail || {}) },
    emitTimeUpdate(e) {
      const d = (e && e.detail) || {}
      this.triggerEvent('timeupdate', { ...this._ds(e), currentTime: d.currentTime, duration: d.duration, detail: e.detail })
    },
    emitVideoError(e) { this.triggerEvent('videoerror', { ...this._ds(e), detail: e.detail }) },
    emitAvatarError(e) { this.triggerEvent('avatarerror', this._ds(e)) }
  }
})
