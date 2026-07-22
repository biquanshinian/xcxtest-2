/**
 * 日历视图下的全球发射统计 + SpaceX 统计（纯展示，事件回传页面）
 */
Component({
  options: {
    styleIsolation: 'apply-shared'
  },
  properties: {
    /* 组件 wxss 的 .theme-light 后代选择器无法匹配组件外的页面根节点，
       须把主题类挂到组件自身根节点上才能生效 */
    themeClass: { type: String, value: '' },
    expandedDateKey: { type: String, value: '' },
    calendarLoading: { type: Boolean, value: false },
    launchStats: { type: Object, value: null },
    launchStatsError: { type: String, value: '' },
    launchStatsLoading: { type: Boolean, value: false },
    spacexStats: { type: Object, value: null },
    spacexStatsLoading: { type: Boolean, value: false },
    calendarAllMissionsEmpty: { type: Boolean, value: false }
  },
  methods: {
    goGlobalLaunchStats() {
      this.triggerEvent('goglobalstats')
    }
  }
})
