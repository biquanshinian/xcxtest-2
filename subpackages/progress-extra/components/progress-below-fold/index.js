Component({
  options: { styleIsolation: 'apply-shared' },
  properties: {
    belowFoldSectionsReady: { type: null, value: null },
    enableMissionSim: { type: Boolean, value: false },
    ll2LaunchUpdates: { type: null, value: null },
    ll2LaunchUpdatesError: { type: null, value: null },
    ll2LaunchUpdatesLoading: { type: Boolean, value: false },
    ll2TimelineError: { type: null, value: null },
    ll2TimelineLoading: { type: Boolean, value: false },
    ll2TimelineRows: { type: null, value: null },
    nsfChecklistError: { type: null, value: null },
    nsfChecklistItems: { type: null, value: null },
    nsfChecklistProgressDone: { type: Number, value: 0 },
    nsfChecklistProgressTotal: { type: Number, value: 0 },
    nsfChecklistSyncing: { type: null, value: null },
    roadClosure: { type: null, value: null },
    roadClosureStatus: { type: null, value: null },
    roadClosureSyncing: { type: Boolean, value: false },
    showLaunchLibraryUpdates: { type: Boolean, value: true },
    tabBarReservedHeight: { type: Number, value: 0 },
    themeClass: { type: String, value: '' }
  },
  methods: {
    _emit(name, e) {
      this.triggerEvent('sectionevent', {
        name,
        dataset: (e && e.currentTarget && e.currentTarget.dataset) || {},
        edetail: (e && e.detail) || {}
      })
    },
    emitOpenRoadClosureDetail(e) { this._emit('openRoadClosureDetail', e) },
    emitOpenRoadClosureMap(e) { this._emit('openRoadClosureMap', e) },
    emitOpenVehicleTracker(e) { this._emit('openVehicleTracker', e) },
    emitOpenMissionSim(e) { this._emit('openMissionSim', e) },
    emitOnNsfChecklistExpandTap(e) { this._emit('onNsfChecklistExpandTap', e) },
    emitOnLl2TimelineExpandTap(e) { this._emit('onLl2TimelineExpandTap', e) },
    emitOnFlightChecklistDetailTap(e) { this._emit('onFlightChecklistDetailTap', e) },
    emitOnLl2LaunchUpdatesExpandTap(e) { this._emit('onLl2LaunchUpdatesExpandTap', e) }
  }
})
