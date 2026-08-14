/**
 * 监控页核心板块：空间站 / 星链分布 / 发射航警地图 / 过境预报
 * 展示在 monitor-pages 分包；交互经 coreevent 回传页面。
 */
Component({
  options: { styleIsolation: 'apply-shared' },
  properties: {
    themeClass: { type: String, value: '' },
    isProUser: { type: Boolean, value: false },
    stationReady: { type: Boolean, value: false },
    stationLoading: { type: Boolean, value: false },
    stationList: { type: null, value: null },
    stationImageLoadedMap: { type: null, value: null },
    starlinkReady: { type: Boolean, value: false },
    starlinkLoading: { type: Boolean, value: false },
    starlinkError: { type: String, value: '' },
    starlinkCount: { type: Number, value: 0 },
    starlinkPaused: { type: Boolean, value: false },
    starlinkUpdateTime: { type: String, value: '' },
    enableSpaceNotices: { type: Boolean, value: true },
    chinaBulletinHint: { type: String, value: '覆盖全国情报区 · 点开查看' },
    passReady: { type: Boolean, value: false },
    passLoading: { type: Boolean, value: false },
    passNoLocation: { type: Boolean, value: false },
    passError: { type: String, value: '' },
    passLocation: { type: String, value: '' },
    passList: { type: null, value: null }
  },
  methods: {
    _emit(name, e) {
      this.triggerEvent('coreevent', {
        name,
        dataset: (e && e.currentTarget && e.currentTarget.dataset) || {},
        edetail: (e && e.detail) || {},
        touches: (e && e.touches) || null,
        changedTouches: (e && e.changedTouches) || null
      })
    },
    emitOnLoadStationStatus(e) { this._emit('onLoadStationStatus', e) },
    emitOnStationCardTap(e) { this._emit('onStationCardTap', e) },
    emitOnStationImageLoad(e) { this._emit('onStationImageLoad', e) },
    emitOnStationImageError(e) { this._emit('onStationImageError', e) },
    emitMarkPendingShareType(e) { this._emit('markPendingShareType', e) },
    emitOnLoadStarlink(e) { this._emit('onLoadStarlink', e) },
    emitRetryLoadStarlink(e) { this._emit('retryLoadStarlink', e) },
    emitToggleStarlinkPause(e) { this._emit('toggleStarlinkPause', e) },
    emitOnStarlinkTouchStart(e) { this._emit('onStarlinkTouchStart', e) },
    emitOnStarlinkTouchMove(e) { this._emit('onStarlinkTouchMove', e) },
    emitOnStarlinkTouchEnd(e) { this._emit('onStarlinkTouchEnd', e) },
    emitOpenStarlinkFullscreen(e) { this._emit('openStarlinkFullscreen', e) },
    emitOpenSpaceNotices(e) { this._emit('openSpaceNotices', e) },
    emitRefreshPasses(e) { this._emit('refreshPasses', e) },
    emitOnLoadStarlinkPasses(e) { this._emit('onLoadStarlinkPasses', e) },
    emitOpenPassDetail(e) { this._emit('openPassDetail', e) },
    emitOpenPassMap(e) { this._emit('openPassMap', e) },
    emitOpenStarlinkAR(e) { this._emit('openStarlinkAR', e) },
    emitRequestPassLocation(e) { this._emit('requestPassLocation', e) }
  }
})
