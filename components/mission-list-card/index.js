/**
 * 首页即将发射任务卡片（内容区）——供检查清单等页复用，保证回收/溅落图标与首页一致
 */
Component({
  properties: {
    item: {
      type: Object,
      value: {}
    },
    index: {
      type: Number,
      value: 0
    },
    themeLight: {
      type: Boolean,
      value: false
    }
  },

  methods: {
    onTap() {
      const item = this.data.item || {}
      this.triggerEvent('cardtap', {
        id: item.id,
        type: item._detailType || 'upcoming'
      })
    }
  }
})
