const { getUiShellLayout } = require('../../../utils/layout.js')
const { getThemeClassSync, isLightSync, getPageBgSync } = require('../../../utils/theme.js')
const { getMembershipState, isPro, hasPurchased, purchaseSubscription, purchaseProduct, PRODUCTS, PLANS, MEMBER_ICONS, getEffectivePrices, warmMembershipStateSync } = require('../../../utils/membership.js')
const { getCachedIcon, preloadIcons } = require('../../../utils/icon-cache.js')

// 权益图标 URL
const BENEFIT_ICONS = [
  'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/徽章/1778741192678_gsejhy.png',
  'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/徽章/1778741195115_g7z847.png',
  'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/徽章/1778741195886_bbbiph.png',
  'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/徽章/1778741196495_ltn8qz.png',
  'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/徽章/1778741197093_xhd41j.png'
]

const PRODUCT_META = [
  { id: 'starlink_ar', vpayProductId: 'vp_starlink_ar', name: PRODUCTS.STARLINK_AR.name, desc: '实景增强现实观测星链卫星', defaultPrice: PRODUCTS.STARLINK_AR.price },
  { id: 'artemis_telemetry', vpayProductId: 'vp_artemis_telemetry', name: PRODUCTS.ARTEMIS_TELEMETRY.name, desc: '实时遥测数据专业面板', defaultPrice: PRODUCTS.ARTEMIS_TELEMETRY.price },
  { id: 'starlink_pro', vpayProductId: 'vp_starlink_pro', name: PRODUCTS.STARLINK_PRO.name, desc: '卫星详情、轨道预测、无水印截图', defaultPrice: PRODUCTS.STARLINK_PRO.price },
  { id: 'starship_flight_checklist', vpayProductId: 'vp_starship_chk', name: PRODUCTS.STARSHIP_FLIGHT_CHECKLIST.name, desc: '星舰进度页清单完整内容', defaultPrice: PRODUCTS.STARSHIP_FLIGHT_CHECKLIST.price }
]

function _resolvePrice(priceMap, vpayId, fallback) {
  const v = priceMap && priceMap[vpayId]
  return Number.isInteger(v) && v > 0 ? v : fallback
}

// 模块加载时立刻检测 iOS（避免 onLoad → setData 期间出现一帧的「按钮可点 → 拦截」闪烁）
// 优先 wx.getDeviceInfo（基础库 2.20.1+，新 API），回退 wx.getSystemInfoSync（向后兼容旧基础库）
const _IS_IOS_AT_LOAD = (function () {
  try {
    if (typeof wx !== 'undefined' && typeof wx.getDeviceInfo === 'function') {
      const d = wx.getDeviceInfo()
      if (d && d.platform) return d.platform === 'ios'
    }
  } catch (e) {}
  try {
    if (typeof wx !== 'undefined' && typeof wx.getSystemInfoSync === 'function') {
      const sys = wx.getSystemInfoSync()
      return !!(sys && sys.platform === 'ios')
    }
  } catch (e) {}
  return false
})()

Page({
  data: {
    statusBarHeight: 44,
    navPlaceholderHeight: 0,
    themeClass: '',
    themeLight: false,
    pageBgColor: '#000000',
    isPro: false,
    isExpired: false,
    expireDate: '',
    selectedPlan: 'yearly',
    currentPlan: '',
    subscribeBtnText: '立即开通',
    products: [],
    loading: true,
    userId: '',
    showDiscountModal: false,
    discountPlan: '',
    discountLabel: '',
    discountOriginalPrice: '',
    discountPrice: '',
    cardIcon: '',
    benefitIcons: [],
    monthlyPrice: (PLANS.MONTHLY.price / 100).toFixed(1),
    yearlyPrice: (PLANS.YEARLY.price / 100).toFixed(1),
    permanentPrice: (PLANS.PERMANENT.price / 100).toFixed(0),
    isIOS: _IS_IOS_AT_LOAD
  },

  onLoad(options) {
    const layout = getUiShellLayout()
    // 双保险：模块级已经检测过一次（_IS_IOS_AT_LOAD）；这里再检测一次，确保万一模块缓存复用时拿到正确值
    let _isIOS = _IS_IOS_AT_LOAD
    try {
      if (typeof wx.getDeviceInfo === 'function') {
        const d = wx.getDeviceInfo()
        if (d && d.platform) _isIOS = d.platform === 'ios'
      } else if (typeof wx.getSystemInfoSync === 'function') {
        const sys = wx.getSystemInfoSync()
        _isIOS = !!(sys && sys.platform === 'ios')
      }
    } catch (e) {}
    this.setData({
      statusBarHeight: layout.statusBarHeight,
      navPlaceholderHeight: layout.navPlaceholderHeight,
      themeClass: getThemeClassSync(),
      themeLight: isLightSync(),
      pageBgColor: getPageBgSync(),
      isIOS: _isIOS
    })

    try { warmMembershipStateSync() } catch (e) {}
    var self = this
    // onLoad 后紧跟的首次 onShow 不再重复加载（否则到期弹窗会连弹两次）
    this._skipNextOnShowRefresh = true
    setTimeout(function () {
      self._loadState()
    }, 0)

    if (options && options.buy) {
      this._autoBuyProductId = options.buy
    }
  },

  onReady() {
    var self = this
    setTimeout(function () {
      self._loadBenefitIcons()
    }, 0)
  },

  onShow() {
    if (this._skipNextOnShowRefresh) {
      this._skipNextOnShowRefresh = false
      return
    }
    var self = this
    setTimeout(function () {
      self._loadState()
    }, 0)
  },

  _loadBenefitIcons() {
    preloadIcons(BENEFIT_ICONS)
    this.setData({
      benefitIcons: BENEFIT_ICONS.map(function (u) { return getCachedIcon(u) })
    })
  },

  async _loadState() {
    try {
      const state = await getMembershipState(true)
      const pro = isPro(state)
      let expireDate = ''
      let isExpired = false

      if (state.expireAt) {
        const d = new Date(state.expireAt)
        // 永久会员（到期时间超过 50 年）显示"永久有效"
        const yearDiff = d.getFullYear() - new Date().getFullYear()
        if (yearDiff > 50) {
          expireDate = '永久有效'
        } else {
          expireDate = d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate()
        }
        if (!pro && state.type === 'pro') {
          isExpired = true
        }
      }

      // 获取用户 ID（展示脱敏；复制使用完整 openid，见 copyUserId）
      let userId = ''
      let rawOpenid = ''
      try {
        const res = await wx.cloud.callFunction({ name: 'membership', data: { action: 'getOpenid' } })
        const openid = (res.result && res.result.openid) || ''
        rawOpenid = openid
        if (openid.length > 12) {
          userId = openid.slice(0, 8) + '...' + openid.slice(-4)
        } else {
          userId = openid || '-'
        }
      } catch (e) {
        userId = '-'
        rawOpenid = ''
      }
      this._rawOpenid = rawOpenid

      const priceMap = await getEffectivePrices()
      const monthlyCents = _resolvePrice(priceMap, 'vp_sub_monthly', PLANS.MONTHLY.price)
      const yearlyCents = _resolvePrice(priceMap, 'vp_sub_yearly', PLANS.YEARLY.price)
      const permanentCents = _resolvePrice(priceMap, 'vp_sub_permanent', PLANS.PERMANENT.price)
      const yearlyDiscountCents = _resolvePrice(priceMap, 'vp_sub_year_dc', PLANS.YEARLY_DISCOUNT.price)
      const permanentDiscountCents = _resolvePrice(priceMap, 'vp_sub_perm_dc', PLANS.PERMANENT_DISCOUNT.price)

      this._priceMap = priceMap
      this._discountConfig = {
        yearly: { original: yearlyCents, discount: yearlyDiscountCents, label: '6折限时优惠' },
        permanent: { original: permanentCents, discount: permanentDiscountCents, label: '5折限时优惠' }
      }

      const products = PRODUCT_META.map(function (p) {
        const cents = _resolvePrice(priceMap, p.vpayProductId, p.defaultPrice)
        return {
          id: p.id,
          name: p.name,
          desc: p.desc,
          priceText: (cents / 100).toFixed(1),
          purchased: hasPurchased(state, p.id)
        }
      })

      // 判断当前订阅计划类型
      let currentPlan = ''
      if (pro && state.expireAt) {
        const yearDiff = new Date(state.expireAt).getFullYear() - new Date().getFullYear()
        if (yearDiff > 50) {
          currentPlan = 'permanent'
        } else {
          // 优先使用 planId，否则根据到期时间推断
          if (state.planId) {
            currentPlan = state.planId.replace('_discount', '')
          } else {
            // 无 planId 时根据到期天数推断
            const daysLeft = Math.ceil((new Date(state.expireAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
            if (daysLeft <= 31) {
              currentPlan = 'monthly'
            } else {
              currentPlan = 'yearly'
            }
          }
        }
      }

      const cardIconUrl = pro ? MEMBER_ICONS.PRO : MEMBER_ICONS.FREE
      preloadIcons([cardIconUrl])
      const cardIcon = getCachedIcon(cardIconUrl)

      this.setData({
        isPro: pro,
        isExpired,
        expireDate,
        products,
        loading: false,
        userId,
        currentPlan,
        cardIcon,
        monthlyPrice: (monthlyCents / 100).toFixed(1),
        yearlyPrice: (yearlyCents / 100).toFixed(1),
        permanentPrice: (permanentCents / 100).toFixed(permanentCents % 100 === 0 ? 0 : 1)
      })
      this._updateBtnText()

      // 到期提醒续费（每个页面实例只弹一次，返回本页时不重复打扰）
      if (isExpired && !this._expiredModalShown) {
        this._expiredModalShown = true
        setTimeout(() => {
          wx.showModal({
            title: '星际通行证已到期',
            content: '您的会员已到期，续费可继续享受全部高级功能',
            confirmText: '立即续费',
            cancelText: '稍后再说',
            success: (res) => {
              if (res.confirm) {
                this.setData({ selectedPlan: 'yearly' })
              }
            }
          })
        }, 500)
      }

      // 自动触发单独购买
      if (this._autoBuyProductId) {
        const pid = this._autoBuyProductId
        this._autoBuyProductId = null
        setTimeout(() => {
          this.handleBuyProduct({ currentTarget: { dataset: { id: pid } } })
        }, 300)
      }
    } catch (e) {
      this._rawOpenid = ''
      this.setData({ loading: false })
    }
  },

  goBack() {
    const pages = getCurrentPages()
    if (pages.length > 1) {
      wx.navigateBack()
    } else {
      wx.switchTab({ url: '/pages/profile/profile' })
    }
  },

  /** 订单记录：购买历史详情页 */
  goOrders() {
    try { wx.vibrateShort({ type: 'medium' }) } catch (e) {}
    wx.navigateTo({ url: '/subpackages/profile-extra/membership/orders' })
  },

  selectPlan(e) {
    const plan = e.currentTarget.dataset.plan
    this.setData({ selectedPlan: plan })
    this._updateBtnText()
  },

  _updateBtnText() {
    const { isPro, isExpired, selectedPlan, currentPlan } = this.data
    let text = '立即开通'
    if (isExpired) {
      text = '立即续费'
    } else if (isPro) {
      if (currentPlan === 'permanent') {
        text = '已是永久会员'
      } else if (selectedPlan === currentPlan) {
        text = '续费'
      } else {
        text = '升级'
      }
    }
    this.setData({ subscribeBtnText: text })
  },

  async handleSubscribe() {
    if (this.data.isIOS) {
      wx.showModal({ title: '暂不支持', content: 'iOS 端暂未开放付费功能。', showCancel: false })
      return
    }
    const { selectedPlan, currentPlan } = this.data

    // 永久会员不允许重复购买
    if (currentPlan === 'permanent') {
      wx.showToast({ title: '您已是永久会员', icon: 'none' })
      return
    }

    const planId = selectedPlan
    wx.showLoading({ title: '正在创建订单...' })
    const result = await purchaseSubscription(planId)
    wx.hideLoading()

    if (result.success) {
      wx.showToast({ title: '开通成功', icon: 'success' })
      this._loadState()
    } else if (result.cancelled) {
      // 用户取消 — 触发折扣挽留
      this._showDiscountOffer(planId)
    } else {
      wx.showModal({
        title: '支付失败',
        content: result.error || '未知错误',
        showCancel: false
      })
    }
  },

  _showDiscountOffer(planId) {
    const discount = this._discountConfig && this._discountConfig[planId]
    if (!discount) return

    this.setData({
      showDiscountModal: true,
      discountPlan: planId,
      discountLabel: discount.label,
      discountOriginalPrice: (discount.original / 100).toFixed(1),
      discountPrice: (discount.discount / 100).toFixed(1)
    })
  },

  closeDiscountModal() {
    this.setData({ showDiscountModal: false })
  },

  async handleDiscountBuy() {
    const planId = this.data.discountPlan
    const discount = this._discountConfig && this._discountConfig[planId]
    if (!discount) return

    this.setData({ showDiscountModal: false })
    wx.showLoading({ title: '正在创建订单...' })

    // 使用折扣价下单
    const result = await purchaseSubscription(planId + '_discount')
    wx.hideLoading()

    if (result.success) {
      wx.showToast({ title: '开通成功', icon: 'success' })
      this._loadState()
    } else if (!result.cancelled) {
      wx.showToast({ title: result.error || '支付失败', icon: 'none' })
    }
  },

  async handleBuyProduct(e) {
    if (this.data.isIOS) {
      wx.showModal({ title: '暂不支持', content: 'iOS 端暂未开放付费功能。', showCancel: false })
      return
    }
    const productId = e.currentTarget.dataset.id
    const product = this.data.products.find(p => p.id === productId)
    if (!product) return
    if (product.purchased) {
      wx.showToast({ title: '您已拥有此功能', icon: 'none' })
      return
    }

    wx.showLoading({ title: '正在创建订单...' })
    const result = await purchaseProduct(productId)
    wx.hideLoading()

    if (result.success) {
      wx.showToast({ title: '购买成功', icon: 'success' })
      this._loadState()
    } else if (result.cancelled) {
      // 用户取消
    } else {
      wx.showToast({ title: result.error || '支付失败', icon: 'none' })
    }
  },

  copyUserId() {
    const text = (this._rawOpenid && String(this._rawOpenid).trim()) || String(this.data.userId || '').trim()
    if (!text || text === '-') {
      wx.showToast({ title: '暂无用户ID', icon: 'none' })
      return
    }
    const data = String(text)
    const doCopy = function () {
      wx.setClipboardData({
        data: data,
        success: function () {
          wx.showToast({ title: '已复制', icon: 'success' })
        },
        fail: function () {
          wx.showModal({ title: '用户ID', content: data, confirmText: '好的', showCancel: false })
        }
      })
    }
    // 与「关于我们」复制微信号一致：先走隐私授权，否则部分版本无法写入剪贴板
    if (wx.requirePrivacyAuthorize) {
      wx.requirePrivacyAuthorize({
        success: doCopy,
        fail: function () {
          doCopy()
        }
      })
    } else {
      doCopy()
    }
  }
})
