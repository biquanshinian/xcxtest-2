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
    emitVideoTap(e) {
      const ds = { ...this._ds(e) }
      // cover-view 在部分基础库会丢 dataset；可见项就是当前轮播下标
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
