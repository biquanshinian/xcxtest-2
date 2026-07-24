/**
 * 监控页「图鉴四板块」展示组件（发射商图鉴 / 火箭族谱 / 飞船图鉴 / 发射场分布）
 *
 * 纯展示组件：状态由页面持有并通过 properties 下发；
 * 所有交互经单一 galleryevent 通道回传（detail: { name, dataset, edetail }），
 * 页面 onGalleryEvent（monitor-galleries.js）还原成原事件形态分发。
 * 放在 monitor-pages 分包 + componentPlaceholder，wxml/wxss 不占主包体积。
 *
 * styleIsolation: apply-shared —— 页面的 section-title / glass-card / theme-light
 * 等共享样式继续作用到组件内部节点。
 */
Component({
  options: {
    styleIsolation: 'apply-shared'
  },

  properties: {
    /* 组件 wxss 的 .theme-light 后代选择器无法匹配组件外的页面根节点，
       须把主题类挂到组件自身根节点上才能生效 */
    themeClass: { type: String, value: '' },
    agencyVisible: { type: Array, value: [] },
    agencyLoading: { type: Boolean, value: false },
    agencyError: { type: String, value: '' },
    agencyTotal: { type: Number, value: 0 },
    boosterList: { type: Array, value: [] },
    boosterLoading: { type: Boolean, value: false },
    boosterLoadError: { type: Boolean, value: false },
    boosterImageLoadedMap: { type: Object, value: {} },
    spacecraftList: { type: Array, value: [] },
    spacecraftLoading: { type: Boolean, value: false },
    spacecraftLoadError: { type: Boolean, value: false },
    launchSiteList: { type: Array, value: [] },
    launchSiteLoading: { type: Boolean, value: false },
    launchSiteLoadError: { type: Boolean, value: false }
  },

  methods: {
    /** 统一转发：携带触发节点 dataset 与原事件 detail，页面侧还原为原事件形态 */
    _emit(name, e) {
      this.triggerEvent('galleryevent', {
        name,
        dataset: (e && e.currentTarget && e.currentTarget.dataset) || {},
        edetail: (e && e.detail) || {}
      })
    },

    emitOnViewAllAgencies(e) { this._emit('onViewAllAgencies', e) },
    emitOnAgencyTap(e) { this._emit('onAgencyTap', e) },
    emitOnAgencyImageError(e) { this._emit('onAgencyImageError', e) },
    emitRetryLoadAgencies(e) { this._emit('retryLoadAgencies', e) },
    emitOnViewAllBoosters(e) { this._emit('onViewAllBoosters', e) },
    emitOnBoosterCardTap(e) { this._emit('onBoosterCardTap', e) },
    emitOnBoosterImageLoad(e) { this._emit('onBoosterImageLoad', e) },
    emitOnBoosterImageError(e) { this._emit('onBoosterImageError', e) },
    emitOnRetryBoosterLoad(e) { this._emit('onRetryBoosterLoad', e) },
    emitOnViewAllSpacecraft(e) { this._emit('onViewAllSpacecraft', e) },
    emitOnSpacecraftCardTap(e) { this._emit('onSpacecraftCardTap', e) },
    emitOnSpacecraftImageError(e) { this._emit('onSpacecraftImageError', e) },
    emitOnRetrySpacecraftLoad(e) { this._emit('onRetrySpacecraftLoad', e) },
    emitOnViewAllLaunchSites(e) { this._emit('onViewAllLaunchSites', e) },
    emitOnLaunchSiteCardTap(e) { this._emit('onLaunchSiteCardTap', e) },
    emitOnLaunchSiteImageError(e) { this._emit('onLaunchSiteImageError', e) },
    emitOnRetryLaunchSiteLoad(e) { this._emit('onRetryLaunchSiteLoad', e) }
  }
})
