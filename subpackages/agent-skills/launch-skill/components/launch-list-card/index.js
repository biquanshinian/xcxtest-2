/**
 * 原子组件：launch-list-card — 发射任务列表卡片
 * 承接 getUpcomingLaunches / getRecentLaunches 的 structuredContent
 * 点击某一项 → 代用户上行消息并显式指定调用 getLaunchDetail
 */
Component({
  data: {
    title: '即将发射',
    items: []
  },

  lifetimes: {
    created() {
      const modelCtx = wx.modelContext.getContext(this)
      const { NotificationType } = wx.modelContext

      modelCtx.on(NotificationType.Result, (data) => {
        const result = (data && data.result) || {}
        const sc = result.structuredContent || {}
        const items = Array.isArray(sc.items) ? sc.items : []
        this.setData({
          title: sc.recent ? '近期发射' : `未来 ${sc.days || 7} 天发射`,
          items
        })
      })
    }
  },

  methods: {
    onItemTap(e) {
      const idx = Number(e.currentTarget.dataset.index)
      const item = this.data.items[idx]
      if (!item || !item.launchId) return
      const modelCtx = wx.modelContext.getContext(this)
      modelCtx.sendFollowUpMessage({
        content: [
          { type: 'text', text: `看看「${item.name}」这次发射的详情` },
          { type: 'api/call', data: { name: 'getLaunchDetail', arguments: { launchId: item.launchId } } }
        ]
      })
    }
  }
})
