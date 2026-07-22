/**
 * 进展页「事件更新」区组件（从 pages/progress/progress.wxml 拆出，wxml/wxss 不占主包）：
 * 今日账号统计胶囊条 + 折叠/展开事件流（媒体、直播卡、分享按钮、滚动加载）。
 *
 * 纯展示组件：状态由页面持有并通过 properties 下发；
 * 所有交互经单一 sectionevent 通道回传（detail: { name, dataset, edetail }），
 * 页面 onProgressSectionEvent 还原成原事件形态分发（与 profile-sections 模式一致）。
 *
 * 分享按钮 open-type=share 由基础库直接触发页面 onShareAppMessage(e)，
 * e.target.dataset（shareType/id）跨组件边界仍可读，同步链路不受组件化影响。
 *
 * styleIsolation: apply-shared —— 页面的 section-title / glass-card /
 * booster-view-all / pro-gold-frame-flat / theme-light 等共享样式继续作用到组件内部。
 */
Component({
  options: { styleIsolation: 'apply-shared' },

  properties: {
    /* 组件 wxss 的 .theme-light 后代选择器无法匹配组件外的页面根节点，
       须把主题类挂到组件自身根节点上才能生效 */
    themeClass: { type: String, value: '' },
    eventUpdates: { type: Array, value: [] },
    eventUpdatesExpanded: { type: Boolean, value: false },
    eventUpdatesLoading: { type: Boolean, value: false },
    eventUpdatesError: { type: String, value: '' },
    eventUpdatesNoMore: { type: Boolean, value: false },
    eventScrollRefreshing: { type: Boolean, value: false },
    tweetAccountStats: { type: Array, value: [] },
    tweetStatsChipsHasOverflow: { type: Boolean, value: false },
    tweetEventTotal: { type: Number, value: 0 },
    isProUser: { type: Boolean, value: false },
    pressedEventId: { type: String, value: '' },
    enableEventVideo: { type: Boolean, value: false },
    enableLiveEntry: { type: Boolean, value: false }
  },

  methods: {
    /** 统一转发：携带触发节点 dataset 与原事件 detail，页面侧还原为原事件形态 */
    _emit(name, e) {
      this.triggerEvent('sectionevent', {
        name,
        dataset: (e && e.currentTarget && e.currentTarget.dataset) || {},
        edetail: (e && e.detail) || {}
      })
    },

    /** 分享按钮外层 catchtap 阻断冒泡用 */
    stopPropagation() {},

    emitOpenEventUpdatesList(e) { this._emit('openEventUpdatesList', e) },
    emitOnTweetStatsChipsScroll(e) { this._emit('onTweetStatsChipsScroll', e) },
    emitOnTweetAccountTap(e) { this._emit('onTweetAccountTap', e) },
    emitOpenEventDetail(e) { this._emit('openEventDetail', e) },
    emitOnEventItemTouchStart(e) { this._emit('onEventItemTouchStart', e) },
    emitOnEventItemTouchEnd(e) { this._emit('onEventItemTouchEnd', e) },
    emitOpenEventShareSheet(e) { this._emit('openEventShareSheet', e) },
    emitOnEventImagePreview(e) { this._emit('onEventImagePreview', e) },
    emitOnEventImageLongPress(e) { this._emit('onEventImageLongPress', e) },
    emitOnVideoThumbnailTap(e) { this._emit('onVideoThumbnailTap', e) },
    emitOnVideoSaveOriginal(e) { this._emit('onVideoSaveOriginal', e) },
    emitOnLiveCardTap(e) { this._emit('onLiveCardTap', e) },
    emitOnEventShareButtonTap(e) { this._emit('onEventShareButtonTap', e) },
    emitOnEventScrollRefresh(e) { this._emit('onEventScrollRefresh', e) },
    emitOnEventScrollToLower(e) { this._emit('onEventScrollToLower', e) },
    emitToggleEventUpdatesExpanded(e) { this._emit('toggleEventUpdatesExpanded', e) },
    emitOnAvatarError(e) { this._emit('onAvatarError', e) }
  }
})
