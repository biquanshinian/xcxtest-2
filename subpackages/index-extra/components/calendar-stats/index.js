/**
 * 日历视图下的全球发射统计 + SpaceX 统计（纯展示，事件回传页面）
 */
function utcStatsYear() {
  return new Date().getUTCFullYear()
}

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
    launchStats: { type: Object, value: null, observer: 'syncStatsYear' },
    launchStatsError: { type: String, value: '' },
    launchStatsLoading: { type: Boolean, value: false },
    spacexStats: { type: Object, value: null },
    spacexStatsLoading: { type: Boolean, value: false },
    calendarAllMissionsEmpty: { type: Boolean, value: false }
  },
  data: {
    statsYear: utcStatsYear()
  },
  lifetimes: {
    attached() {
      this.syncStatsYear(this.data.launchStats)
    }
  },
  methods: {
    syncStatsYear(stats) {
      const fromStats = Number(stats && stats.year)
      const year = Number.isFinite(fromStats) && fromStats >= 1957 ? fromStats : utcStatsYear()
      if (year !== this.data.statsYear) this.setData({ statsYear: year })
    },
    goGlobalLaunchStats() {
      this.triggerEvent('goglobalstats')
    }
  }
})
