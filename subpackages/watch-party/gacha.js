/**
 * 现场奖品抽奖页
 * 门槛：
 *   1) 现场物料码扫码（或手动输入场次短码）解锁次数
 *   2) 商家确认发射成功后开放抽取
 * 入口：物料小程序码 scene=wp:<短码>:<渠道>；也可手动输码
 */
const pageBase = require('../../utils/page-base.js')
const composerInput = require('./utils/composer-input-behavior.js')
const watchParty = require('./utils/api.js')
const { guardWatchPartyPage } = require('../../utils/watch-party-feature.js')
const { decoratePrizeCard } = require('./utils/prize-card.js')

Page({
  behaviors: [pageBase, composerInput],
  _fallbackTab: '/pages/index/index',

  data: {
    loading: true,
    error: '',
    session: null,
    fromMaterial: false,
    successUnlocked: false,
    quota: { total: 0, used: 0, remaining: 0 },
    passExpireText: '',
    codeInput: '',
    drawing: false,
    drawnCard: null,
    flipped: false,
    shareBonusUsed: false
  },

  onLoad(options) {
    this.initUiShell()
    this._options = options || {}
    this._channel = String(options.channel || '').trim() || 'site'
    guardWatchPartyPage(this).then((ok) => {
      if (!ok || this._unloaded) return
      this.unlock()
    })
  },

  onUnload() {
    this._unloaded = true
    if (this._flipTimer) {
      clearTimeout(this._flipTimer)
      this._flipTimer = null
    }
  },

  onHide() {
    if (this._sharePendingAt && Date.now() - this._sharePendingAt < 15000) {
      this._shareHiddenAt = Date.now()
    } else {
      this._sharePendingAt = 0
    }
  },

  onShow() {
    if (this._sharePendingAt && this._shareHiddenAt) {
      const hiddenMs = Date.now() - this._shareHiddenAt
      if (hiddenMs >= 4000) this._claimShareBonus()
    }
    this._sharePendingAt = 0
    this._shareHiddenAt = 0
  },

  _safeSetData(patch) {
    if (this._unloaded) return
    this.setData(patch)
  },

  _parseEntry() {
    const opts = this._options || {}
    if (opts.scene) {
      try {
        const scene = decodeURIComponent(opts.scene)
        const parts = scene.split(':')
        if (parts[0] === 'wp' && parts[1]) {
          this._channel = String(parts[2] || 'site').trim() || 'site'
          return { code: parts[1] }
        }
      } catch (e) {}
    }
    if (opts.code) return { code: opts.code }
    // 站内带 sessionId 仅用于查看场次状态，不发放抽奖次数
    if (opts.sessionId) return { sessionId: opts.sessionId }
    return null
  },

  unlock() {
    const entry = this._parseEntry()
    this.setData({ loading: true, error: '' })
    const params = entry ? { ...entry, channel: this._channel } : null

    const proceed = (p) => {
      watchParty.scanCheckIn(p).then((res) => {
        const session = res.session || null
        if (session) {
          session.prizes = Array.isArray(session.prizes) ? session.prizes : []
          session.prizeRemaining = Number(session.prizeRemaining) ||
            session.prizes.reduce((s, x) => s + (Number(x.remaining) || 0), 0)
        }
        const fromMaterial = res.fromMaterial === true
        const successUnlocked = res.successUnlocked === true
          || !!(session && session.successUnlocked)
        this._safeSetData({
          loading: false,
          session,
          fromMaterial,
          successUnlocked,
          quota: {
            total: res.total || 0,
            used: res.used || 0,
            remaining: res.remaining || 0
          }
        })
        this._applyPass(res)
      }).catch((err) => {
        this._safeSetData({ loading: false, error: (err && err.message) || '解锁抽奖失败，请重试' })
      })
    }

    if (!params) {
      this.setData({ loading: false, error: '请扫描现场物料码进入，或手动输入场次码' })
      return
    }
    proceed(params)
  },

  _applyPass(res) {
    const pass = res && res.pass
    if (!pass || !pass.expiresAt) return
    try {
      const watchPass = require('../../utils/watch-pass.js')
      watchPass.grant(pass.expiresAt, (res.session && res.session.sessionId) || '')
    } catch (e) {}
    const d = new Date(pass.expiresAt)
    if (isNaN(d.getTime())) return
    const p = (n) => (n < 10 ? '0' + n : '' + n)
    this._safeSetData({
      passExpireText: `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
    })
  },

  onRetry() {
    this.unlock()
  },

  // onCodeInput：composer-input-behavior

  onSubmitCode() {
    const code = String(this.data.codeInput || '').trim().toLowerCase()
    if (!code) {
      wx.showToast({ title: '请输入场次码', icon: 'none' })
      return
    }
    this._options = { code }
    this._channel = 'manual'
    this.unlock()
  },

  onDraw() {
    const { session, quota, drawing, fromMaterial, successUnlocked } = this.data
    if (!session || drawing) return
    if (!session.prizeDrawEnabled) {
      wx.showToast({ title: '本场次未开放现场抽奖', icon: 'none' })
      return
    }
    if (!fromMaterial) {
      wx.showToast({ title: '请先扫描现场物料码', icon: 'none' })
      return
    }
    if (!successUnlocked) {
      wx.showToast({ title: '等待商家确认发射成功', icon: 'none' })
      return
    }
    if (session.prizeRemaining === 0) {
      wx.showToast({ title: '奖品已抽完', icon: 'none' })
      return
    }
    if (quota.remaining <= 0) {
      wx.showToast({ title: '抽奖次数已用完，分享可再得1次', icon: 'none' })
      return
    }
    this.setData({ drawing: true, drawnCard: null, flipped: false })
    watchParty.drawCard(session.sessionId, 'scan').then((res) => {
      if (this._unloaded) return
      const prize = res.prize || res.card || {}
      const card = decoratePrizeCard(prize, {
        drawId: res.drawId || '',
        createdAt: Date.now(),
        sessionTitle: session.title || '',
        rocketName: session.rocketName || '',
        missionName: session.missionName || ''
      })
      const nextRemain = Math.max(0, (session.prizeRemaining || 1) - 1)
      this._safeSetData({
        drawing: false,
        drawnCard: card,
        'session.prizeRemaining': nextRemain,
        quota: {
          total: quota.total,
          used: quota.used + 1,
          remaining: Math.max(0, res.remaining != null ? res.remaining : quota.remaining - 1)
        }
      })
      this._flipTimer = setTimeout(() => {
        this._flipTimer = null
        this._safeSetData({ flipped: true })
        const strongTier = card.tier === 'SSR' || card.tier === 'SR'
        try { wx.vibrateShort({ type: strongTier ? 'heavy' : 'medium', fail: () => {} }) } catch (e) {}
      }, 600)
    }).catch((err) => {
      this._safeSetData({ drawing: false })
      wx.showToast({ title: (err && err.message) || '抽奖失败', icon: 'none' })
    })
  },

  onCloseCard() {
    this.setData({ drawnCard: null, flipped: false })
  },

  onGoAlbum() {
    wx.navigateTo({ url: '/subpackages/watch-party/album' })
  },

  onGoLanding() {
    const s = this.data.session
    wx.navigateTo({
      url: s
        ? `/subpackages/watch-party/watch-party?sessionId=${encodeURIComponent(s.sessionId)}`
        : '/subpackages/watch-party/watch-party'
    })
  },

  _claimShareBonus() {
    const s = this.data.session
    if (!s || this.data.shareBonusUsed || !this.data.fromMaterial) return
    watchParty.shareBonus(s.sessionId).then((res) => {
      if (this._unloaded) return
      this._safeSetData({
        shareBonusUsed: true,
        quota: {
          total: res.total || 0,
          used: res.used || 0,
          remaining: res.remaining || 0
        }
      })
      if (res.granted) {
        wx.showToast({ title: '分享成功，+1次抽奖', icon: 'none' })
      }
    }).catch(() => {})
  },

  onShareAppMessage() {
    const s = this.data.session
    const card = this.data.drawnCard
    this._sharePendingAt = Date.now()
    const title = card
      ? `我在火箭发射现场抽到了「${card.name}」！`
      : '火箭发射观礼现场，来抽现场奖品'
    const result = {
      title,
      path: s
        ? `/subpackages/watch-party/watch-party?sessionId=${encodeURIComponent(s.sessionId)}&channel=share`
        : '/subpackages/watch-party/watch-party'
    }
    if (card && card.image) result.imageUrl = card.image
    return result
  }
})
