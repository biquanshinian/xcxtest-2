Component({
  options: { styleIsolation: 'apply-shared' },
  properties: {
    carouselPending: { type: Boolean, value: false },
    carouselItems: { type: Array, value: [] },
    missionType: { type: String, value: 'upcoming' },
    carouselCurrent: { type: Number, value: 0 }
  },
  methods: {
    _ds(e) { return (e && e.currentTarget && e.currentTarget.dataset) || {} },
    emitImageError(e) { this.triggerEvent('imageerror', { ...this._ds(e), detail: e.detail }) },
    emitImageLoad(e) { this.triggerEvent('imageload', { ...this._ds(e), detail: e.detail }) },
    emitPreview(e) { this.triggerEvent('preview', this._ds(e)) },
    emitSave(e) { this.triggerEvent('save', this._ds(e)) },
    emitCaption(e) { this.triggerEvent('caption', this._ds(e)) },
    emitVideoTap(e) { this.triggerEvent('videotap', this._ds(e)) },
    emitChange(e) { this.triggerEvent('change', e.detail || {}) },
    emitTimeUpdate(e) { this.triggerEvent('timeupdate', { ...this._ds(e), detail: e.detail }) },
    emitVideoError(e) { this.triggerEvent('videoerror', { ...this._ds(e), detail: e.detail }) },
    emitAvatarError(e) { this.triggerEvent('avatarerror', this._ds(e)) }
  }
})
