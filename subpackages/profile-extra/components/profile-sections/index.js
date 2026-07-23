/**
 * 我的页下半屏区块组件（从 pages/profile/profile.wxml 拆出，wxml/wxss 不占主包）：
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
    myReminders: { type: Array, value: [] },
    oaAlertEnabled: { type: Boolean, value: false },
    oaAlertFollowed: { type: Boolean, value: false },
    oaAlertReady: { type: Boolean, value: false },
    oaAlertMessage: { type: String, value: '' },
    oaAlertLoading: { type: Boolean, value: false },
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
    figmaShareEnabled: { type: Boolean, value: false }
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

    emitGoPreferences(e) { this._emit('goPreferences', e) },
    emitOnOaAlertSwitch(e) { this._emit('onOaAlertSwitch', e) },
    emitOnCopyOaName(e) { this._emit('onCopyOaName', e) },
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
    emitOnShareFigma(e) { this._emit('onShareFigma', e) }
  }
})
