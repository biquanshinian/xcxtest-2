/**
 * 原子组件：starship-status-card — 星舰当前状态卡片
 * 承接 getStarshipStatus 的 structuredContent
 */
Component({
  data: {
    booster: null,
    ship: null,
    checklist: null
  },

  lifetimes: {
    created() {
      const modelCtx = wx.modelContext.getContext(this)
      const { NotificationType } = wx.modelContext

      modelCtx.on(NotificationType.Result, (data) => {
        const result = (data && data.result) || {}
        const sc = result.structuredContent || {}
        this.setData({
          booster: sc.booster || null,
          ship: sc.ship || null,
          checklist: sc.checklist && sc.checklist.total > 0 ? sc.checklist : null
        })
      })
    }
  },

  methods: {
    onNextFlightTap() {
      const modelCtx = wx.modelContext.getContext(this)
      modelCtx.sendFollowUpMessage({
        content: [
          { type: 'text', text: '星舰下次试飞是什么时候？' },
          { type: 'api/call', data: { name: 'getStarshipNextFlight', arguments: {} } }
        ]
      })
    }
  }
})
