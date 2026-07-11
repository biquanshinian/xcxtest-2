/**
 * 原子组件：launch-stats-card — 年度全球发射统计卡片
 * 承接 getGlobalLaunchStats 的 structuredContent
 * 卡片右上角入口进入小程序「全球发射统计」页（relatedPage 动态带 year）
 */
Component({
  data: {
    year: '',
    total: 0,
    successCount: 0,
    failureCount: 0,
    topAgencies: []
  },

  lifetimes: {
    created() {
      const modelCtx = wx.modelContext.getContext(this)
      this._viewCtx = wx.modelContext.getViewContext(this)
      const { NotificationType } = wx.modelContext

      modelCtx.on(NotificationType.Result, (data) => {
        const result = (data && data.result) || {}
        const sc = result.structuredContent || {}
        this.setData({
          year: sc.year || '',
          total: sc.total || 0,
          successCount: sc.successCount || 0,
          failureCount: sc.failureCount || 0,
          topAgencies: (sc.topAgencies || []).slice(0, 3)
        })
        if (sc.year) {
          this._viewCtx.setRelatedPage({ query: `year=${sc.year}` })
        }
      })
    }
  },

  methods: {
    onMoreTap() {
      const modelCtx = wx.modelContext.getContext(this)
      modelCtx.sendFollowUpMessage({
        content: [
          { type: 'text', text: `${this.data.year} 年哪个发射商发射次数最多？` }
        ]
      })
    }
  }
})
