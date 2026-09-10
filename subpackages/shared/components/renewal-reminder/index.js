/**
 * 会员弹窗（两种变体，按会员状态自动分流）
 *
 *   renewal — PRO 临期续费提醒：
 *             · 赠送会员（里程碑/邀请/人工）：到期前 3 天，每个自然日弹一次
 *             · 付费会员：到期前 5 天内或过期后 3 天内；手动关闭后本到期周期不再弹
 *   promo   — 免费用户升级推荐：进入即弹；手动关闭后 2 天冷却
 *
 * 触发时机：首页在太空简报弹窗关闭后（或确认简报不弹时）调用 maybeShow()
 *
 * 配图：权益插画与「我的」通行证卡 / 会员页宫格同源（MEMBER_BENEFIT_ICONS）
 *
 *   DEV  — MEMBERSHIP_POPUP_DEV_MODE=true：等开屏/简报让路后强制弹出升级推荐
 * ★ 调试满意后把 MEMBERSHIP_POPUP_DEV_MODE 改回 false 再上线
 */
const membership = require('../../../../utils/membership.js')
const { isFeatureEnabled } = require('../../../../utils/feature-flags.js')
const { getCachedIcon, preloadIcons } = require('../../../../utils/icon-cache.js')
const themeUtil = require('../../../../utils/theme.js')
const { getSystemInfo } = require('../../../../utils/system.js')

/** ★ 开发预览时改 true；生产保持 false */
const MEMBERSHIP_POPUP_DEV_MODE = false

// 付费会员：到期前 N 天开始提醒 / 过期后 N 天内仍提醒（挽回窗口）
const REMIND_DAYS_BEFORE = 5
const REMIND_DAYS_AFTER = 3
// 赠送会员：到期前 3 天每天一次
const GIFT_REMIND_DAYS_BEFORE = 3

// promo：关闭后的冷却天数
const PROMO_COOLDOWN_DAYS = 2
const PROMO_DISMISS_KEY = '_pro_promo_dismissed_at'

/** 与通行证卡 MEMBER_PASS_BENEFITS 同一套下标，文案略完整（弹窗可读） */
const POPUP_BENEFITS = [
  { name: 'AI 无限对话', desc: '太空助手不限次提问', iconIndex: 0 },
  { name: '去除广告', desc: '无弹窗，纯净体验', iconIndex: 1 },
  { name: '24 小时过境预报', desc: '星链卫星未来 24 小时精确预报', iconIndex: 2 },
  { name: '会员专属徽章', desc: '专属成就与金色边框', iconIndex: 4 }
]

function fenToYuanText(fen) {
  return membership.formatPriceYuan(fen) || '0'
}

function isGiftedGrantSource(source) {
  const s = String(source || '')
  return s === 'milestone' || s === 'invite' || s === 'admin' || s === 'system'
}

function localDateKey(ms) {
  const d = new Date(ms || Date.now())
  const y = d.getFullYear()
  const m = d.getMonth() + 1
  const day = d.getDate()
  return y + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day
}

function isPermanentExpire(expireMs) {
  if (!expireMs) return true
  return new Date(expireMs).getFullYear() - new Date().getFullYear() > 50
}

function getIndexPage() {
  try {
    const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : []
    for (let i = pages.length - 1; i >= 0; i--) {
      const p = pages[i]
      const route = p && p.route != null ? String(p.route).replace(/^\//, '') : ''
      if (route === 'pages/index/index') return p
    }
    return pages.length ? pages[pages.length - 1] : null
  } catch (e) {
    return null
  }
}

function resolveMemberIcon() {
  const url = membership.MEMBER_ICONS.PRO
  return url ? getCachedIcon(url) : ''
}

function resolveBenefitRows() {
  return POPUP_BENEFITS.map(function (b) {
    const url = membership.MEMBER_BENEFIT_ICONS[b.iconIndex] || ''
    return {
      name: b.name,
      desc: b.desc,
      iconUrl: url ? getCachedIcon(url) : ''
    }
  })
}

function preloadPopupArt() {
  const urls = [membership.MEMBER_ICONS.PRO].concat(membership.MEMBER_BENEFIT_ICONS || [])
  preloadIcons(urls.filter(Boolean))
}

/** iPad / 宽屏：rpx 随 windowWidth 放大，弹窗会顶出安全区；缩放兼容态则用机型判断 */
function isTabletLayout() {
  try {
    const info = getSystemInfo() || {}
    const w = Number(info.windowWidth) || 0
    const h = Number(info.windowHeight) || 0
    const model = String(info.model || '')
    const system = String(info.system || '')
    if (/iPad/i.test(model) || /iPad/i.test(system)) return true
    if (Math.min(w, h) >= 500) return true
    return false
  } catch (e) {
    return false
  }
}

function tabletClassName() {
  return isTabletLayout() ? 'renewal-mask--tablet' : ''
}

function themePayload() {
  let themeClass = ''
  try {
    themeClass = themeUtil.getThemeClassSync() || ''
  } catch (e) {}
  return {
    themeClass: themeClass,
    tabletClass: tabletClassName(),
    memberIcon: resolveMemberIcon(),
    benefits: resolveBenefitRows(),
    devMode: !!MEMBERSHIP_POPUP_DEV_MODE
  }
}

Component({
  data: {
    visible: false,
    themeClass: '',
    tabletClass: '',
    mode: 'renewal', // renewal | promo
    expired: false,
    daysLeft: 0,
    expireDateText: '',
    priceMonthly: '',
    priceYearly: '',
    memberIcon: membership.MEMBER_ICONS.PRO,
    benefits: [],
    devMode: !!MEMBERSHIP_POPUP_DEV_MODE
  },

  lifetimes: {
    attached() {
      preloadPopupArt()
      try {
        this.setData(themePayload())
      } catch (e) {}
      const self = this
      this._onWindowResize = function () {
        const next = tabletClassName()
        if (next !== self.data.tabletClass) self.setData({ tabletClass: next })
      }
      if (typeof wx.onWindowResize === 'function') {
        wx.onWindowResize(this._onWindowResize)
      }
      if (MEMBERSHIP_POPUP_DEV_MODE) {
        this._scheduleDevPreview()
      }
    },
    detached() {
      if (this._devTimer) {
        clearTimeout(this._devTimer)
        this._devTimer = null
      }
      if (this._onWindowResize && typeof wx.offWindowResize === 'function') {
        wx.offWindowResize(this._onWindowResize)
      }
      this._onWindowResize = null
    }
  },

  pageLifetimes: {
    show() {
      try {
        this.setData({
          themeClass: themeUtil.getThemeClassSync() || '',
          tabletClass: tabletClassName()
        })
      } catch (e) {}
    }
  },

  methods: {
    isDevMode() {
      return !!MEMBERSHIP_POPUP_DEV_MODE
    },

    _scheduleDevPreview() {
      const self = this
      let tries = 0
      const tick = function () {
        tries += 1
        const page = getIndexPage()
        const splashOn = !!(page && page.data && (page.data.splashVisible || page.data.splashFading))
        let briefingOn = false
        try {
          const briefing = page && page.selectComponent && page.selectComponent('#morningBriefing')
          briefingOn = !!(briefing && briefing.data && briefing.data.showPopup)
        } catch (e) {}
        if ((splashOn || briefingOn) && tries < 80) {
          self._devTimer = setTimeout(tick, 300)
          return
        }
        self._forceShowPromo()
      }
      this._devTimer = setTimeout(tick, 400)
    },

    _forceShowPromo() {
      const self = this
      if (self.data.visible) return
      preloadPopupArt()
      return membership.getEffectivePrices()
        .then(function (prices) {
          const monthly = membership.resolvePriceFromMap(prices, 'vp_sub_monthly', membership.PLANS.MONTHLY.price)
          const yearly = membership.resolvePriceFromMap(prices, 'vp_sub_yearly', membership.PLANS.YEARLY.price)
          self.setData(Object.assign(themePayload(), {
            visible: true,
            mode: 'promo',
            priceMonthly: fenToYuanText(monthly),
            priceYearly: fenToYuanText(yearly)
          }))
        })
        .catch(function () {
          self.setData(Object.assign(themePayload(), {
            visible: true,
            mode: 'promo',
            priceMonthly: fenToYuanText(membership.PLANS.MONTHLY.price),
            priceYearly: fenToYuanText(membership.PLANS.YEARLY.price)
          }))
        })
    },

    /**
     * 判断并弹出。返回 Promise<boolean>（是否真正弹出）。
     * isBlocked：可选回调，异步取状态期间若其他弹窗（如简报）占屏则放弃本次。
     */
    maybeShow(isBlocked) {
      const self = this
      if (MEMBERSHIP_POPUP_DEV_MODE) return Promise.resolve(false)
      if (self._inflight || self.data.visible) return Promise.resolve(false)
      self._inflight = true

      // 全局配置 enableMembershipPopup：缺省视为开启；关闭后首页不再自动弹会员广告
      return membership.isMembershipEnabled()
        .then(function (enabled) {
          if (!enabled) return false
          return Promise.all([
            membership.getMembershipState(),
            isFeatureEnabled('enableMembershipPopup')
          ]).then(function (pair) {
            const state = pair[0]
            const popupOn = pair[1]
            if (!state) return false
            if (state.type === 'pro' && state.expireAt) {
              const expireMs = new Date(state.expireAt).getTime()
              if (!expireMs || isNaN(expireMs)) return false
              if (isPermanentExpire(expireMs) || state.grantSource === 'whitelist') return false
              const diffDays = Math.ceil((expireMs - Date.now()) / 86400000)
              if (isGiftedGrantSource(state.grantSource)) {
                if (diffDays >= 1 && diffDays <= GIFT_REMIND_DAYS_BEFORE) {
                  return self._prepareGiftedDaily(state, diffDays)
                }
                if (diffDays > GIFT_REMIND_DAYS_BEFORE) return false
                if (!popupOn) return false
                return self._preparePromo()
              }
              if (!popupOn) return false
              if (diffDays > REMIND_DAYS_BEFORE) return false
              if (diffDays >= -REMIND_DAYS_AFTER) return self._prepareRenewal(state, diffDays)
              return self._preparePromo()
            }
            if (!popupOn) return false
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
          self.setData(Object.assign(themePayload(), payload))
          return true
        })
    },

    // ── 赠送 PRO：到期前 3 天，每个自然日最多弹一次 ──
    _prepareGiftedDaily(state, diffDays) {
      const expireMs = new Date(state.expireAt).getTime()
      const dayKey = '_gift_renewal_' + expireMs + '_' + localDateKey()
      try {
        if (wx.getStorageSync(dayKey)) return false
      } catch (e) {}

      const d = new Date(expireMs)
      this._dismissKey = dayKey
      this._dismissForever = false
      return {
        visible: true,
        mode: 'renewal',
        expired: false,
        daysLeft: Math.max(diffDays, 0),
        expireDateText: d.getFullYear() + ' 年 ' + (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日'
      }
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
      this._dismissForever = true
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

      // 关闭后的冷却期
      try {
        const dismissedAt = Number(wx.getStorageSync(PROMO_DISMISS_KEY) || 0)
        if (dismissedAt && (Date.now() - dismissedAt) < PROMO_COOLDOWN_DAYS * 86400000) return false
      } catch (e) {}

      this._dismissKey = ''
      this._dismissForever = false
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
      if (MEMBERSHIP_POPUP_DEV_MODE) return
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
      this.triggerEvent('closed')
      wx.navigateTo({ url: '/subpackages/profile-extra/membership/membership' })
    },

    noop() {}
  }
})
