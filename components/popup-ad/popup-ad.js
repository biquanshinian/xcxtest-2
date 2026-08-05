const { storeAppid: DEFAULT_STORE_APPID } = require('../../utils/config.js')
const themeUtil = require('../../utils/theme.js')
const {
  buildStoreProductCustomStyle,
  validateStoreProductCustomStyle
} = require('../../utils/store-product-style.js')

function canUseStoreProduct() {
  try {
    return !!(wx.canIUse && wx.canIUse('store-product'))
  } catch (e) {
    return false
  }
}

function canUseStoreCustomStyle() {
  try {
    return !!(wx.canIUse && wx.canIUse('store-product.custom-style'))
  } catch (e) {
    return false
  }
}

function resolveShowStoreProduct(shopItem, leaving) {
  if (leaving) return false
  if (!shopItem || typeof shopItem !== 'object') return false
  if (!canUseStoreProduct()) return false
  const productId = String(shopItem.productId || '').trim()
  const appid = String(shopItem.appid || DEFAULT_STORE_APPID || '').trim()
  return !!(productId && appid)
}

function pickStoreCustomStyle(light) {
  const style = buildStoreProductCustomStyle(!!light)
  const check = validateStoreProductCustomStyle(style)
  if (!check.ok) {
    return { card: { 'background-color': light ? '#FAFAFA' : '#1C1C1E' } }
  }
  return style
}

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
    showStoreProduct: false,
    useCustomStyle: false,
    storeCustomStyle: buildStoreProductCustomStyle(false),
    storeAppid: '',
    storeProductId: '',
    storePromotionLink: '',
    storeMediaId: '',
    fallbackTip: '商品未配置 ID，请联系管理员',
    defaultStoreAppid: DEFAULT_STORE_APPID || ''
  },

  observers: {
    // 注意：不要观察 leaving 又在回调里 setData(leaving)，部分基础库会形成死循环 → Tab 黑屏
    'visible, shopItem'(visible, shopItem) {
      this._syncStoreState(visible, shopItem, this.data.leaving)
    }
  },

  lifetimes: {
    attached() {
      this._themeHandler = () => {
        if (!this.data.visible || !this.data.showStoreProduct) return
        this.setData({
          storeCustomStyle: pickStoreCustomStyle(themeUtil.isLightSync())
        })
      }
      themeUtil.onThemeChange(this._themeHandler)
      this._syncStoreState(this.properties.visible, this.properties.shopItem, this.data.leaving)
    },
    detached() {
      if (this._closeTimer) {
        clearTimeout(this._closeTimer)
        this._closeTimer = null
      }
      if (this._themeHandler) {
        themeUtil.offThemeChange(this._themeHandler)
        this._themeHandler = null
      }
    }
  },

  methods: {
    _syncStoreState(visible, shopItem, leaving) {
      if (!visible) {
        const patch = {}
        if (this.data.showStoreProduct) patch.showStoreProduct = false
        if (this.data.storeAppid) patch.storeAppid = ''
        if (this.data.storeProductId) patch.storeProductId = ''
        if (this.data.storePromotionLink) patch.storePromotionLink = ''
        if (this.data.storeMediaId) patch.storeMediaId = ''
        if (Object.keys(patch).length) this.setData(patch)
        return
      }

      const light = themeUtil.isLightSync()
      const useCustomStyle = canUseStoreCustomStyle()
      const storeCustomStyle = pickStoreCustomStyle(light)
      const showStoreProduct = resolveShowStoreProduct(shopItem, leaving)

      let fallbackTip = '商品未配置 ID，请联系管理员'
      if (!showStoreProduct) {
        if (!canUseStoreProduct()) {
          fallbackTip = '当前微信版本过低，暂无法展示商品'
        } else if (shopItem && !String(shopItem.productId || '').trim()) {
          fallbackTip = '商品未配置 ID，请联系管理员'
        } else if (shopItem && !String(shopItem.appid || DEFAULT_STORE_APPID || '').trim()) {
          fallbackTip = '小店未配置，请联系管理员'
        }
      }

      const storeAppid = showStoreProduct
        ? String(shopItem.appid || DEFAULT_STORE_APPID || '').trim()
        : ''
      const storeProductId = showStoreProduct
        ? String(shopItem.productId || '').trim()
        : ''
      const storePromotionLink = showStoreProduct
        ? String(shopItem.productPromotionLink || '').trim()
        : ''
      const storeMediaId = showStoreProduct
        ? String(shopItem.mediaId || '').trim()
        : ''

      this.setData({
        showStoreProduct,
        useCustomStyle,
        storeCustomStyle,
        storeAppid,
        storeProductId,
        storePromotionLink,
        storeMediaId,
        fallbackTip
      })
    },

    onClose() {
      // 先卸掉原生 store-product，再播离场动画
      this.setData({ leaving: true, showStoreProduct: false })
      if (this._closeTimer) clearTimeout(this._closeTimer)
      this._closeTimer = setTimeout(() => {
        this._closeTimer = null
        this.triggerEvent('close')
        this.setData({ leaving: false })
      }, 380)
    },

    onMaskTap() {
      this.onClose()
    },

    onStoreEnterSuccess() {},

    onStoreEnterError(e) {
      const detail = (e && e.detail) || {}
      const msg = detail.errMsg || detail.message || '打开小店失败'
      wx.showToast({ title: String(msg).slice(0, 20), icon: 'none' })
    },

    onFallbackTap() {
      wx.showToast({ title: this.data.fallbackTip || '商品未配置', icon: 'none' })
    }
  }
})
