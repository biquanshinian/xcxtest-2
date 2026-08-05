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
    // 官方：custom-style 基础库 ≥ 3.7.1
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
    // 兜底：至少保证 card 存在，避免基础库读 null.card
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
    'visible, shopItem, leaving'(visible, shopItem, leaving) {
      if (!visible) {
        this.setData({
          leaving: false,
          showStoreProduct: false,
          storeAppid: '',
          storeProductId: '',
          storePromotionLink: '',
          storeMediaId: '',
          fallbackTip: '商品未配置 ID，请联系管理员'
        })
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

      // 官方 tip：product-promotion-link / media-id 仅首次加载传入，故在挂载前一次写定
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
    }
  },

  lifetimes: {
    attached() {
      this._themeHandler = () => {
        if (!this.data.visible || !this.data.showStoreProduct) return
        // 主题切换时只更新官方对象样式，不重建 product-id（避免非法二次改参）
        this.setData({
          storeCustomStyle: pickStoreCustomStyle(themeUtil.isLightSync())
        })
      }
      themeUtil.onThemeChange(this._themeHandler)
    },
    detached() {
      if (this._themeHandler) {
        themeUtil.offThemeChange(this._themeHandler)
        this._themeHandler = null
      }
    }
  },

  methods: {
    onClose() {
      // 先卸掉原生 store-product，再播离场动画，避免卸载竞态触发渲染层空指针
      this.setData({ leaving: true, showStoreProduct: false })
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
      const detail = (e && e.detail) || {}
      const msg = detail.errMsg || detail.message || '打开小店失败'
      wx.showToast({ title: String(msg).slice(0, 20), icon: 'none' })
    },

    onFallbackTap() {
      wx.showToast({ title: this.data.fallbackTip || '商品未配置', icon: 'none' })
    }
  }
})
