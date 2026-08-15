/**
 * 我的页下半屏区块组件（从 pages/profile/profile.wxml 拆出，wxml/wxss 不占主包）：
 * - 设置（导航栏打开左半屏抽屉：语言 / 简报 / 主题 / 火箭配置图 / 提醒偏好）
 * - 我的提醒（服务号开关 + 发射时间线）
 * - 竞猜战绩
 * - 每日问答挑战
 * - 在线客服
 *
 * 纯展示组件：状态由页面持有并通过 properties 下发；
 * 所有交互经单一 sectionevent 通道回传（detail: { name, dataset, edetail }），
 * 页面 onProfileSectionEvent 还原成原事件形态分发（与监控页 monitor-galleries 模式一致）。
 *
 * styleIsolation: apply-shared —— 页面的 section-title-row / glass-card / theme-light
 * 等共享样式继续作用到组件内部节点。
 */
Component({
  options: { styleIsolation: 'apply-shared' },

  properties: {
    /* 组件 wxss 的 .theme-light 后代选择器无法匹配组件外的页面根节点，
       须把主题类挂到组件自身根节点上才能生效 */
    themeClass: { type: String, value: '' },
    themeMode: { type: String, value: 'dark' },
    rocketArtStyle: { type: String, value: 'original' },
    contentLang: { type: String, value: 'zh' },
    briefingEnabled: { type: Boolean, value: false },
    settingsPanelOpen: { type: Boolean, value: false },
    settingsPanelPadTop: { type: Number, value: 44 },
    rocketOptions: { type: Array, value: [] },
    siteOptions: { type: Array, value: [] },
    notifyOptions: { type: Array, value: [] },
    rocketMap: { type: Object, value: {} },
    siteMap: { type: Object, value: {} },
    selectedRocketCount: { type: Number, value: 0 },
    selectedSiteCount: { type: Number, value: 0 },
    prefRocketsExpanded: { type: Boolean, value: false },
    prefSitesExpanded: { type: Boolean, value: false },
    notifyMinutes: { type: Number, value: 30 },
    roadClosureAlert: { type: Boolean, value: true },
    prefSaving: { type: Boolean, value: false },
    myReminders: { type: Array, value: [] },
    oaAlertEnabled: { type: Boolean, value: false },
    oaAlertFollowed: { type: Boolean, value: false },
    oaAlertReady: { type: Boolean, value: false },
    oaAlertMessage: { type: String, value: '' },
    oaAlertLoading: { type: Boolean, value: false },
    oaQrGuideOpen: { type: Boolean, value: false },
    oaFollowQrUrl: { type: String, value: '' },
    voteStats: { type: Object, value: { total: 0 } },
    voteHistory: { type: Array, value: [] },
    voteHistoryExpanded: { type: Boolean, value: false },
    quizQuestion: { type: Object, value: null },
    quizAnswered: { type: Boolean, value: false },
    quizSelectedIndex: { type: Number, value: -1 },
    quizResult: { type: Object, value: null },
    quizStats: { type: Object, value: { accuracy: 0 } },
    aboutText: { type: String, value: '' },
    aboutWechat: { type: String, value: '' },
    figmaShareEnabled: { type: Boolean, value: false },
    myPrizes: { type: Array, value: [] }
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

    noop() {},

    emitCloseSettingsPanel(e) { this._emit('closeSettingsPanel', e) },
    emitOnThemeModeTap(e) { this._emit('onThemeModeTap', e) },
    emitOnRocketArtTap(e) { this._emit('onRocketArtTap', e) },
    emitOnContentLangChange(e) { this._emit('onContentLangChange', e) },
    emitOnBriefingToggle(e) { this._emit('onBriefingToggle', e) },
    emitOnTogglePrefRocketsExpand(e) { this._emit('onTogglePrefRocketsExpand', e) },
    emitOnTogglePrefSitesExpand(e) { this._emit('onTogglePrefSitesExpand', e) },
    emitOnTogglePrefRocket(e) { this._emit('onTogglePrefRocket', e) },
    emitOnTogglePrefSite(e) { this._emit('onTogglePrefSite', e) },
    emitOnNotifyPrefChange(e) { this._emit('onNotifyPrefChange', e) },
    emitOnRoadClosurePrefChange(e) { this._emit('onRoadClosurePrefChange', e) },
    emitOnSaveReminderPrefs(e) { this._emit('onSaveReminderPrefs', e) },
    emitOnOaAlertSwitch(e) { this._emit('onOaAlertSwitch', e) },
    emitOnCopyOaName(e) { this._emit('onCopyOaName', e) },
    emitShowOaQrGuide(e) { this._emit('showOaQrGuide', e) },
    emitCloseOaQrGuide(e) { this._emit('closeOaQrGuide', e) },
    emitOnReminderTap(e) { this._emit('onReminderTap', e) },
    emitOnCancelReminder(e) { this._emit('onCancelReminder', e) },
    emitOnGoAstroCalendar(e) { this._emit('onGoAstroCalendar', e) },
    emitOnVoteHistoryTap(e) { this._emit('onVoteHistoryTap', e) },
    emitOnVoteHistoryRocketImageError(e) { this._emit('onVoteHistoryRocketImageError', e) },
    emitOnClearVoteHistory(e) { this._emit('onClearVoteHistory', e) },
    emitOnToggleVoteHistory(e) { this._emit('onToggleVoteHistory', e) },
    emitOnQuizSelect(e) { this._emit('onQuizSelect', e) },
    emitOnCopyWechat(e) { this._emit('onCopyWechat', e) },
    emitOnContactCallback(e) { this._emit('onContactCallback', e) },
    emitOnShareFigma(e) { this._emit('onShareFigma', e) },
    emitOnCopyTracking(e) { this._emit('onCopyTracking', e) }
  }
})
