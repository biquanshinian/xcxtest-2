/**
 * 首页开屏动画展示组件（index-extra）
 * 状态由页面持有，交互 triggerEvent 回页面（逻辑在 utils/index-splash.js）。
 */
Component({
  options: { styleIsolation: 'apply-shared' },
  properties: {
    visible: { type: Boolean, value: false },
    fading: { type: Boolean, value: false },
    config: { type: Object, value: {} },
    videoReady: { type: Boolean, value: false },
    countdown: { type: Number, value: 0 },
    notice: { type: Object, value: null },
    mission: { type: Object, value: null },
    missionCd: { type: Object, value: null },
    compactCdTop: { type: Number, value: 0 },
    compactCdHeight: { type: Number, value: 0 }
  },
  methods: {
    preventMove() {},
    onSplashVideoPlay(e) { this.triggerEvent('videoplay', e.detail) },
    onSplashVideoTimeUpdate(e) { this.triggerEvent('videotimeupdate', e.detail) },
    onSplashVideoLoadedMeta(e) { this.triggerEvent('videoloadedmeta', e.detail) },
    onSplashVideoEnded(e) { this.triggerEvent('videoended', e.detail) },
    onSplashVideoError(e) { this.triggerEvent('videoerror', e.detail) },
    onSplashSkipTap() { this.triggerEvent('skip') },
    onSplashMissionTap() { this.triggerEvent('missiontap') },
    onSplashAgencyLogoLoad(e) {
      const ds = (e && e.currentTarget && e.currentTarget.dataset) || {}
      this.triggerEvent('agencylogoload', { ...ds, detail: e && e.detail })
    }
  }
})
