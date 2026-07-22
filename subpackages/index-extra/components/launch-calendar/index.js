/**
 * 首页「发射日历」展示组件（月份导航 + 筛选面板 + 日历网格）
 *
 * 纯展示组件：所有状态由页面持有并通过 properties 下发，
 * 交互统一 triggerEvent 交回页面（逻辑在 index-extra/utils/index-calendar-page.js）。
 * 放在 index-extra 分包 + componentPlaceholder，wxml/wxss 不占主包体积。
 *
 * styleIsolation: apply-shared —— 让页面的 glass-card / .theme-light 主题样式
 * 继续作用到组件内部节点，日历自身样式则收敛在本组件 wxss。
 */
Component({
  options: {
    styleIsolation: 'apply-shared'
  },

  properties: {
    /* 组件 wxss 的 .theme-light 后代选择器无法匹配组件外的页面根节点，
       须把主题类挂到组件自身根节点上才能生效 */
    themeClass: { type: String, value: '' },
    calendarYear: { type: Number, value: 0 },
    calendarMonth: { type: Number, value: 1 },
    calendarIsCurrentMonth: { type: Boolean, value: true },
    calendarFilterSummaryText: { type: String, value: '全部任务' },
    calendarFilteredCount: { type: Number, value: 0 },
    calendarFilterCollapsed: { type: Boolean, value: true },
    calendarQuickFilter: { type: String, value: 'all' },
    calendarSiteFilter: { type: String, value: 'all' },
    calendarSiteOptions: { type: Array, value: [] },
    calendarStatusFilter: { type: String, value: 'all' },
    calendarDays: { type: Array, value: [] },
    calendarPageAnimClass: { type: String, value: '' }
  },

  methods: {
    calendarPrevMonth() {
      this.triggerEvent('prevmonth')
    },

    calendarNextMonth() {
      this.triggerEvent('nextmonth')
    },

    calendarGoToday() {
      this.triggerEvent('gotoday')
    },

    /** picker 的 e.detail.value 原样透传，页面侧读取方式不变 */
    onCalendarMonthPickerChange(e) {
      this.triggerEvent('monthpicker', { value: e.detail.value })
    },

    toggleCalendarFilterPanel() {
      this.triggerEvent('togglefilter')
    },

    onCalendarQuickFilterTap(e) {
      this.triggerEvent('quickfilter', { value: e.currentTarget.dataset.value || 'all' })
    },

    onCalendarSiteFilterTap(e) {
      this.triggerEvent('sitefilter', { value: e.currentTarget.dataset.value || 'all' })
    },

    onCalendarStatusFilterTap(e) {
      this.triggerEvent('statusfilter', { value: e.currentTarget.dataset.value || 'all' })
    },

    resetCalendarFilters() {
      this.triggerEvent('resetfilters')
    },

    onCalendarDateTap(e) {
      const key = e.currentTarget.dataset.key
      this.triggerEvent('datetap', { key })
    },

    // ── 左右滑动翻月：检测在组件内完成，只把方向交回页面 ──
    onCalendarSwipeStart(e) {
      const target = e.target || {}
      const dataset = (target && target.dataset) || {}
      const hasLaunch = dataset && (dataset.hasLaunch === true || dataset.hasLaunch === 'true')
      if (hasLaunch) {
        // 有任务的格子横滑常是误触（用户想点格子），锁定本次滑动不翻月
        this._swipeLocked = true
        this._swipeStartX = 0
        this._swipeStartY = 0
        return
      }
      if (e.touches && e.touches[0]) {
        this._swipeLocked = false
        this._swipeStartX = e.touches[0].clientX
        this._swipeStartY = e.touches[0].clientY
      }
    },

    onCalendarSwipeEnd(e) {
      if (this._swipeLocked) {
        this._swipeLocked = false
        this._swipeStartX = 0
        this._swipeStartY = 0
        return
      }
      if (!this._swipeStartX || !e.changedTouches || !e.changedTouches[0]) return
      const dx = e.changedTouches[0].clientX - this._swipeStartX
      const dy = e.changedTouches[0].clientY - this._swipeStartY
      this._swipeStartX = 0
      this._swipeStartY = 0
      if (Math.abs(dx) < 80 || Math.abs(dx) < Math.abs(dy) * 1.8) return
      if (dx < 0) {
        this.triggerEvent('nextmonth')
      } else {
        this.triggerEvent('prevmonth')
      }
    }
  }
})
