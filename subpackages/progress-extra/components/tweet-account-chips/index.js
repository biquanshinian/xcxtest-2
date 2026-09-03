/**
 * 今日推文账号胶囊条（横向滑动筛选）。
 * 进展页事件更新区与事件详情页共用同一套 UI / 溢出渐隐 / 滑动轻震。
 */
Component({
  options: { styleIsolation: 'apply-shared' },

  properties: {
    themeClass: { type: String, value: '' },
    tweetAccountStats: { type: Array, value: [] },
    isProUser: { type: Boolean, value: false },
    selectedSource: { type: String, value: '' }
  },

  data: {
    hasOverflow: false
  },

  lifetimes: {
    attached() {
      this._updateOverflow()
    }
  },

  observers: {
    tweetAccountStats() {
      this._updateOverflow()
    }
  },

  methods: {
    onAccountTap(e) {
      const ds = (e && e.currentTarget && e.currentTarget.dataset) || {}
      this.triggerEvent('accounttap', {
        index: ds.index,
        source: ds.source,
        label: ds.label
      })
    },

    onChipsScroll(e) {
      const left = Math.max(0, Number((e.detail && e.detail.scrollLeft) || 0))
      const stepPx = 52
      const bucket = Math.floor(left / stepPx)
      if (this._hapticBucket == null) {
        this._hapticBucket = bucket
        return
      }
      if (bucket === this._hapticBucket) return
      this._hapticBucket = bucket
      try { wx.vibrateShort({ type: 'light' }) } catch (err) {}
    },

    _updateOverflow() {
      const stats = this.data.tweetAccountStats || []
      if (!stats.length) {
        if (this.data.hasOverflow) this.setData({ hasOverflow: false })
        return
      }
      wx.nextTick(() => {
        const query = this.createSelectorQuery()
        query.select('.tweet-stats-scroll').boundingClientRect()
        query.select('.tweet-stats-chips-row').boundingClientRect()
        query.exec((res) => {
          const scrollRect = res && res[0]
          const rowRect = res && res[1]
          const hasOverflow = !!(scrollRect && rowRect && rowRect.width > scrollRect.width + 2)
          if (hasOverflow !== this.data.hasOverflow) {
            this.setData({ hasOverflow })
          }
        })
      })
    }
  }
})
