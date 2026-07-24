const { getUiShellLayout } = require('../../utils/layout.js')
const { cloudEnv } = require('../../utils/config.js')
const { getThemeClassSync, isLightSync, getPageBgSync } = require('../../utils/theme.js')
const { isFeatureEnabled } = require('../../utils/feature-flags.js')

const pad2 = (n) => String(n).padStart(2, '0')
function formatTime(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const now = new Date()
  const diffMs = now - d
  if (diffMs < 60000) return '刚刚'
  if (diffMs < 3600000) return Math.floor(diffMs / 60000) + '分钟前'
  if (diffMs < 86400000) return Math.floor(diffMs / 3600000) + '小时前'
  return d.getFullYear() + '/' + pad2(d.getMonth() + 1) + '/' + pad2(d.getDate())
}

function formatDate(ts) {
  const d = new Date(ts)
  const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC']
  return pad2(d.getDate()) + ' ' + months[d.getMonth()] + ' ' + d.getFullYear()
}

/** FNV-1a 32-bit，供 mulberry32 种子 */
function fnv1aHash32(str) {
  let h = 2166136261 >>> 0
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h >>> 0
}

/** 确定性 PRNG，同一 seed 序列固定 */
function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), a | 1) >>> 0
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61) >>> 0
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 心愿星在容器内的近似月盘（百分比）。真机若与背景有偏差，只调此处即可。 */
const LUNAR_MOON_ELLIPSE = { cx: 50, cy: 72, rx: 36, ry: 24, margin: 4 }
const LUNAR_STAR_SEED_SUFFIX = ':lunar-star'

Page({
  data: {
    statusBarHeight: 44,
    navPlaceholderHeight: 0,
    loading: true,
    checkingWish: true,
    submitting: false,
    formName: '',
    formLocation: '',
    formWish: '',
    wishLength: 0,
    boardingPass: null,
    passRevealed: false,
    passAnimated: false,
    hasSubmitted: false,
    stats: { totalWishes: 0 },
    countdown: 0,
    wishList: [],
    starPoints: [],
    activeWishId: '',
    activeWish: null,
    musicPlaying: false,
    wallPage: 0,
    hasMore: true,
    loadingMore: false,
    themeClass: '',
    themeLight: false,
    pageBgColor: '#000000',
    /** 功能开关未确认前不渲染详情，避免审核直达先看到完整页 */
    featureAllowed: false
  },

  onLoad(options) {
    const deviceInfo = wx.getDeviceInfo()
    const windowInfo = wx.getWindowInfo()
    const systemInfo = Object.assign({}, deviceInfo, windowInfo, wx.getAppBaseInfo())
    const uiShellLayout = getUiShellLayout(systemInfo)
    const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : []
    this.setData({
      statusBarHeight: uiShellLayout.statusBarHeight,
      navPlaceholderHeight: uiShellLayout.navPlaceholderHeight,
      isDirectEntry: pages.length <= 1,
      themeClass: getThemeClassSync(),
      themeLight: isLightSync(),
      pageBgColor: getPageBgSync(),
      featureAllowed: false
    })

    // 先门禁再初始化：读不到配置 / 显式关闭都拦截（failClosed）
    isFeatureEnabled('enableLunarWishes', { failClosed: true })
      .then((on) => {
        if (!on) {
          this._blockLunarAccess()
          return
        }
        this._bootLunarPage()
      })
      .catch(() => {
        this._blockLunarAccess()
      })
  },

  _blockLunarAccess() {
    this.setData({ featureAllowed: false, loading: false, checkingWish: false })
    wx.showToast({ title: '功能暂未开放', icon: 'none' })
    setTimeout(() => {
      if (this.data.isDirectEntry) this._switchToHomeFallback()
      else wx.navigateBack({ fail: () => this._switchToHomeFallback() })
    }, 300)
  },

  _bootLunarPage() {
    this.setData({ featureAllowed: true })

    const launchDate = new Date('2028-09-01')
    const daysLeft = Math.max(0, Math.ceil((launchDate - new Date()) / 86400000))
    this.setData({ countdown: daysLeft })

    this._bgAudio = wx.createInnerAudioContext({ useWebAudioImplement: true })
    this._bgAudio.obeyMuteSwitch = false
    this._bgAudio.src = 'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/%E9%9F%B3%E9%A2%91/1776023812613_6q1kna.MP3'
    this._bgAudio.loop = true
    this._bgAudio.volume = 1
    this._bgAudio.onError((e) => console.error('[Music] error:', e))
    this._bgAudio.onCanplay(() => { this._audioReady = true })

    this._restoreOrCheckWish()
    this._loadStats()
    this._loadWishWall(true)
  },

  onUnload() {
    if (this._bgAudio) {
      this._bgAudio.stop()
      this._bgAudio.destroy()
      this._bgAudio = null
    }
  },

  onToggleMusic() {
    if (this.data.musicPlaying) {
      this._bgAudio.pause()
      this.setData({ musicPlaying: false })
    } else {
      this._bgAudio.play()
      this.setData({ musicPlaying: true })
    }
  },

  goBack() {
    const pages = getCurrentPages()
    if (pages.length > 1) {
      wx.navigateBack({ fail: () => this._switchToHomeFallback() })
      return
    }
    // 从分享卡片冷启动进入（页面栈只有 1 层）→ 多重兜底回首页
    // wx.reLaunch 不支持 tabBar 页面，所以兜底链要一直走 switchTab
    this._switchToHomeFallback()
  },

  _switchToHomeFallback() {
    wx.switchTab({
      url: '/pages/index/index',
      fail: () => {
        setTimeout(() => {
          wx.switchTab({
            url: '/pages/index/index',
            fail: () => {
              try { wx.showToast({ title: '返回失败，请重启小程序', icon: 'none' }) } catch (_) {}
            }
          })
        }, 50)
      }
    })
  },

  onNameInput(e) { this.setData({ formName: e.detail.value }) },
  onLocationInput(e) { this.setData({ formLocation: e.detail.value }) },
  onWishInput(e) {
    this.setData({ formWish: e.detail.value, wishLength: (e.detail.value || '').length })
  },

  async onSubmit() {
    const { formName, formWish, formLocation, submitting, hasSubmitted } = this.data
    if (submitting) return
    if (hasSubmitted) {
      wx.showToast({ title: '每人仅限一份心愿哦', icon: 'none' })
      return
    }
    if (!formWish || !formWish.trim()) {
      wx.showToast({ title: '请写下你的心愿', icon: 'none' })
      return
    }

    this.setData({ submitting: true })
    try {
      const res = await wx.cloud.callFunction({
        name: 'lunarWishes',
        config: { env: cloudEnv },
        data: {
          action: 'submit',
          name: formName || '匿名探索者',
          wish: formWish.trim(),
          location: formLocation || '中国',
          language: 'zh'
        }
      })

      const result = res.result || {}
      if (result.code !== 0) {
        wx.showToast({ title: result.message || '提交失败', icon: 'none', duration: 2500 })
        this.setData({ submitting: false })
        return
      }

      const passData = result.data || {}
      const isPending = passData.status === 'pending'
      try { wx.setStorageSync('lunar_boarding_pass', passData) } catch (e) {}
      this.setData({
        submitting: false,
        hasSubmitted: true,
        boardingPass: {
          ...passData,
          dateText: formatDate(passData.createdAt)
        }
      })

      wx.showToast({
        title: isPending ? '已提交，审核通过后点亮星空' : '心愿已送出 🚀',
        icon: 'none',
        duration: 2500
      })
      this.setData({ passAnimated: true })
      setTimeout(() => this.setData({ passRevealed: true }), 600)
      this._loadStats()
      // 待审不上墙，无需立刻刷新星空；通过后再刷
      if (!isPending) this._loadWishWall(true)
    } catch (e) {
      console.error('[LunarWishes] submit error:', e)
      wx.showToast({ title: '网络异常，请重试', icon: 'none' })
      this.setData({ submitting: false })
    }
  },

  _restoreOrCheckWish() {
    try {
      const cached = wx.getStorageSync('lunar_boarding_pass')
      if (cached && cached.boardingPassId) {
        this.setData({
          hasSubmitted: true,
          checkingWish: false,
          passRevealed: true,
          passAnimated: false,
          boardingPass: {
            ...cached,
            dateText: formatDate(cached.createdAt)
          }
        })
        return
      }
    } catch (e) {}
    this._checkExistingWish()
  },

  async _checkExistingWish(retryCount) {
    const attempt = retryCount || 0
    try {
      const res = await wx.cloud.callFunction({
        name: 'lunarWishes',
        config: { env: cloudEnv },
        data: { action: 'myWish' }
      })
      const result = res.result || {}
      if (result.code === 0 && result.data) {
        const passData = result.data
        try { wx.setStorageSync('lunar_boarding_pass', passData) } catch (e) {}
        this.setData({
          hasSubmitted: true,
          checkingWish: false,
          passRevealed: true,
          passAnimated: false,
          boardingPass: {
            ...passData,
            dateText: formatDate(passData.createdAt)
          }
        })
        return
      }
    } catch (e) {
      console.error('[LunarWishes] _checkExistingWish error:', e)
      if (attempt < 2) {
        await new Promise(r => setTimeout(r, 1000))
        return this._checkExistingWish(attempt + 1)
      }
    }
    this.setData({ checkingWish: false })
  },

  onFlipPass() {
    if (!this.data.passRevealed) {
      this.setData({ passAnimated: true, passRevealed: true })
    }
  },

  onStarTap(e) {
    const id = e.currentTarget.dataset.id
    if (this.data.activeWishId === id) {
      this.setData({ activeWishId: '', activeWish: null })
      return
    }
    const wish = this.data.wishList.find(w => w._id === id)
    if (!wish) return
    this.setData({ activeWishId: id, activeWish: wish })
  },

  onClosePopup() {
    this.setData({ activeWishId: '', activeWish: null })
  },

  onFieldTap() {
    if (this.data.activeWish) {
      this.setData({ activeWishId: '', activeWish: null })
    }
  },

  onCopyWish() {
    const wish = this.data.activeWish
    if (!wish) return
    const text = `"${wish.wish}" —— ${wish.name}${wish.location ? '（' + wish.location + '）' : ''} [${wish.boardingPassId}]`
    wx.setClipboardData({
      data: text,
      success: () => wx.showToast({ title: '已复制', icon: 'success' })
    })
  },

  onShareToMoments() {
    wx.showToast({ title: '请点击右上角 ··· 分享到朋友圈', icon: 'none', duration: 2500 })
  },

  noop() {},

  _buildStarPoints(list) {
    const { cx, cy, rx, ry, margin } = LUNAR_MOON_ELLIPSE
    const used = []

    const sampleInMoonEllipse = (rnd) => {
      const u1 = rnd()
      const u2 = rnd()
      const angle = u1 * Math.PI * 2
      const r = Math.sqrt(u2)
      let x = cx + Math.cos(angle) * r * rx
      let y = cy + Math.sin(angle) * r * ry
      x = Math.max(margin, Math.min(100 - margin, x))
      y = Math.max(margin, Math.min(100 - margin, y))
      return { x, y }
    }

    /** 与原逻辑一致：与任一点同时在 ±sep 矩形内视为过近 */
    const sep = 6
    const farEnough = (x, y) => used.every((p) => Math.abs(p.x - x) > sep || Math.abs(p.y - y) > sep)

    const stars = list.map((item) => {
      const seed = fnv1aHash32(String(item._id) + LUNAR_STAR_SEED_SUFFIX)
      const rnd = mulberry32(seed)
      let x = cx
      let y = cy
      const maxTries = 48
      for (let tries = 0; tries < maxTries; tries++) {
        const p = sampleInMoonEllipse(rnd)
        x = p.x
        y = p.y
        if (farEnough(x, y)) break
      }
      used.push({ x, y })
      return {
        _id: item._id,
        x: Math.round(x * 10) / 10,
        y: Math.round(y * 10) / 10,
        delay: (rnd() * 3).toFixed(1)
      }
    })
    this.setData({ starPoints: stars })
  },

  onCollectScroll() {
    try {
      const { pulseNasaFloatOnScroll } = require('../../utils/nasa-float-scroll.js')
      pulseNasaFloatOnScroll(this)
    } catch (e) {}
  },

  loadMore() {
    if (this.data.loadingMore || !this.data.hasMore) return
    this._loadWishWall(false)
  },

  async _loadStats() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'lunarWishes',
        config: { env: cloudEnv },
        data: { action: 'stats' }
      })
      const result = res.result || {}
      if (result.code === 0 && result.data) {
        this.setData({ stats: result.data })
      }
    } catch (e) {}
  },

  async _loadWishWall(refresh) {
    if (this.data.loadingMore) return
    this.setData({ loadingMore: true })

    const page = refresh ? 0 : this.data.wallPage
    try {
      const res = await wx.cloud.callFunction({
        name: 'lunarWishes',
        config: { env: cloudEnv },
        data: { action: 'wall', page, sort: 'latest', pageSize: 50 }
      })
      const result = res.result || {}
      if (result.code === 0 && result.data) {
        const newItems = (result.data.list || []).map(item => ({
          ...item,
          timeText: formatTime(item.createdAt)
        }))
        const wishList = refresh ? newItems : this.data.wishList.concat(newItems)
        this.setData({
          wishList,
          wallPage: page + 1,
          hasMore: result.data.hasMore,
          loading: false,
          loadingMore: false
        })
        this._buildStarPoints(wishList)
      } else {
        this.setData({ loading: false, loadingMore: false })
      }
    } catch (e) {
      this.setData({ loading: false, loadingMore: false })
    }
  },

  onShareAppMessage(opts) {
    // 待审心愿不上墙、不分享具体文案，避免未审核内容外传
    if (this.data.activeWish) {
      const w = this.data.activeWish
      return {
        title: `"${w.wish.slice(0, 40)}${w.wish.length > 40 ? '...' : ''}" —— ${w.name} 的月球心愿`,
        path: '/pages/collect/collect'
      }
    }
    const pass = this.data.boardingPass
    if (pass && pass.status === 'pending') {
      return {
        title: '月愿计划 · 把你的心愿送上月球 🌙',
        path: '/pages/collect/collect'
      }
    }
    return {
      title: '月愿计划 · 把你的心愿送上月球 🌙',
      path: '/pages/collect/collect'
    }
  },

  onShareTimeline() {
    return {
      title: '月愿计划 · 把你的心愿送上月球'
    }
  }
})
