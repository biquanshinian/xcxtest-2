const { storeAppid: DEFAULT_STORE_APPID } = require('../../utils/config.js')

Component({
  properties: {
    visible: {
      type: Boolean,
      value: false
    },
    shopItem: {
      type: Object,
      value: null
    }
  },

  data: {
    leaving: false,
    defaultStoreAppid: DEFAULT_STORE_APPID || '',
    storeCustomStyle: 'width:100%;min-height:260rpx;'
  },

  observers: {
    visible(v) {
      if (v) {
        this.setData({ leaving: false })
      }
    }
  },

  methods: {
    onClose() {
      this.setData({ leaving: true })
      setTimeout(() => {
        this.triggerEvent('close')
        this.setData({ leaving: false })
      }, 380)
    },

    onMaskTap() {
      this.onClose()
    },

    onStoreEnterSuccess() {},

    onStoreEnterError(e) {
      const msg = (e && e.detail && e.detail.errMsg) || '打开小店失败'
      wx.showToast({ title: msg, icon: 'none' })
    },

    onFallbackTap() {
      wx.showToast({ title: '商品未配置', icon: 'none' })
    }
  }
})
