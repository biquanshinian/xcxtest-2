/**
 * 会员弹窗（两种变体，按会员状态自动分流）
 *
 *   renewal — PRO 临期续费提醒：到期前 5 天内或过期后 3 天内；
 *             手动关闭后本到期周期（以 expireAt 为 key）不再弹，续费后下周期可再弹
 *   promo   — 免费用户升级推荐：进入即弹；
 *             手动关闭后 2 天冷却；iOS 端不弹（虚拟支付不可用，避免死胡同）
 *
 * 触发时机：首页在太空简报弹窗关闭后（或确认简报不弹时）调用 maybeShow()
 */
const membership = require('../../../../utils/membership.js')

// renewal：到期前 N 天开始提醒 / 过期后 N 天内仍提醒（挽回窗口）
const REMIND_DAYS_BEFORE = 5
const REMIND_DAYS_AFTER = 3

// promo：关闭后的冷却天数
const PROMO_COOLDOWN_DAYS = 2
const PROMO_DISMISS_KEY = '_pro_promo_dismissed_at'

function fenToYuanText(fen) {
  return membership.formatPriceYuan(fen) || '0'
}

function isIOS() {
  try {
    if (typeof wx.getDeviceInfo === 'function') {
      const d = wx.getDeviceInfo()
      if (d && d.platform) return d.platform === 'ios'
    }
  } catch (e) {}
  try {
    const sys = wx.getSystemInfoSync()
    return !!(sys && sys.platform === 'ios')
  } catch (e) {
    return false
  }
}

Component({
  data: {
    visible: false,
    mode: 'renewal', // renewal | promo
    expired: false,
    daysLeft: 0,
    expireDateText: '',
    priceMonthly: '',
    priceYearly: '',
    memberIcon: membership.MEMBER_ICONS.PRO
  },

  methods: {
    /**
     * 判断并弹出。返回 Promise<boolean>（是否真正弹出）。
     * isBlocked：可选回调，异步取状态期间若其他弹窗（如简报）占屏则放弃本次。
     */
    maybeShow(isBlocked) {
      const self = this
      if (self._inflight || self.data.visible) return Promise.resolve(false)
      self._inflight = true

      return membership.isMembershipEnabled()
        .then(function (enabled) {
          if (!enabled) return false
          return membership.getMembershipState().then(function (state) {
            if (!state) return false
            if (state.type === 'pro' && state.expireAt) {
              const expireMs = new Date(state.expireAt).getTime()
              if (!expireMs || isNaN(expireMs)) return false
              const diffDays = Math.ceil((expireMs - Date.now()) / 86400000)
              // 远未到期（含永久/白名单）：不弹
              if (diffDays > REMIND_DAYS_BEFORE) return false
              // 临期或刚过期（挽回窗口内）：续费提醒
              if (diffDays >= -REMIND_DAYS_AFTER) return self._prepareRenewal(state, diffDays)
              // 过期已久：视同免费用户，走升级推荐
              return self._preparePromo()
            }
            if (state.type === 'free') {
              return self._preparePromo()
            }
            return false
          })
        })
        .catch(function () { return false })
        .then(function (payload) {
          self._inflight = false
          if (!payload) return false
          // 异步等待期间简报弹窗可能已弹出，避免叠层
          if (typeof isBlocked === 'function' && isBlocked()) return false
          self.setData(payload)
          return true
        })
    },

    // ── PRO 临期续费 ──
    _prepareRenewal(state, diffDays) {
      const expireMs = new Date(state.expireAt).getTime()
      const dismissKey = '_renewal_dismissed_' + expireMs
      try {
        if (wx.getStorageSync(dismissKey)) return false
      } catch (e) {}

      const d = new Date(expireMs)
      this._dismissKey = dismissKey
      return {
        visible: true,
        mode: 'renewal',
        expired: diffDays <= 0,
        daysLeft: Math.max(diffDays, 0),
        expireDateText: d.getFullYear() + ' 年 ' + (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日'
      }
    },

    // ── 免费用户升级推荐 ──
    _preparePromo() {
      const self = this
      if (isIOS()) return false

      // 关闭后的冷却期
      try {
        const dismissedAt = Number(wx.getStorageSync(PROMO_DISMISS_KEY) || 0)
        if (dismissedAt && (Date.now() - dismissedAt) < PROMO_COOLDOWN_DAYS * 86400000) return false
      } catch (e) {}

      self._dismissKey = ''
      // 动态价格（与后台管理系统 vpaySkuPrices 对齐），失败时用常量兜底
      return membership.getEffectivePrices()
        .then(function (prices) {
          const monthly = membership.resolvePriceFromMap(prices, 'vp_sub_monthly', membership.PLANS.MONTHLY.price)
          const yearly = membership.resolvePriceFromMap(prices, 'vp_sub_yearly', membership.PLANS.YEARLY.price)
          return {
            visible: true,
            mode: 'promo',
            priceMonthly: fenToYuanText(monthly),
            priceYearly: fenToYuanText(yearly)
          }
        })
        .catch(function () {
          return {
            visible: true,
            mode: 'promo',
            priceMonthly: fenToYuanText(membership.PLANS.MONTHLY.price),
            priceYearly: fenToYuanText(membership.PLANS.YEARLY.price)
          }
        })
    },

    _markDismissed() {
      try {
        if (this.data.mode === 'promo') {
          wx.setStorageSync(PROMO_DISMISS_KEY, Date.now())
        } else if (this._dismissKey) {
          wx.setStorageSync(this._dismissKey, 1)
        }
      } catch (e) {}
    },

    onClose() {
      try {
        if (typeof wx.vibrateShort === 'function') wx.vibrateShort({ type: 'light' })
      } catch (e) {}
      this._markDismissed()
      this.setData({ visible: false })
      this.triggerEvent('closed')
    },

    onRenew() {
      this._markDismissed()
      this.setData({ visible: false })
      wx.navigateTo({ url: '/subpackages/profile-extra/membership/membership' })
    },

    noop() {}
  }
})
