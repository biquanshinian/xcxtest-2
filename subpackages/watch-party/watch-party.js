/**
 * 火箭观礼服务落地页
 * - 场次信息 + 发射倒计时
 * - 坐标一键导航 / 停车点指引
 * - 免费预约登记（线下收款，页面内不涉及售票）
 */
const pageBase = require('../../utils/page-base.js')
const composerInput = require('./utils/composer-input-behavior.js')
const watchParty = require('./utils/api.js')
const { getRocketImage } = require('../../utils/util.js')
const { guardWatchPartyPage } = require('../../utils/watch-party-feature.js')

function pad2(n) {
  return n < 10 ? '0' + n : '' + n
}

function resolveRocketImage(session) {
  const name = session && session.rocketName ? String(session.rocketName).trim() : ''
  return name ? (getRocketImage(name) || '') : ''
}

/** 分享标题：默认场次名已是「火箭名发射观礼」，避免再拼一次前缀造成重复 */
function buildWatchPartyShareTitle(session, opts) {
  const s = session || {}
  const title = String(s.title || '').trim()
  const rocket = String(s.rocketName || '').trim()
  const autoPrefix = (rocket || '火箭') + '发射观礼'
  let base
  if (!title) {
    base = autoPrefix
  } else if (
    title === autoPrefix
    || title.indexOf('发射观礼') >= 0
    || (rocket && title.indexOf(rocket) === 0)
  ) {
    base = title
  } else {
    base = autoPrefix + ' · ' + title
  }
  if (opts && opts.withDistance) {
    return base + '，距发射工位仅1.5公里'
  }
  return base
}

Page({
  behaviors: [pageBase, composerInput],
  _fallbackTab: '/pages/index/index',
  _timer: null,

  data: {
    loading: true,
    error: '',
    /** 无开放场次的空态（非错误）：保留卡册入口与商家合作申请，解决冷启动无入口问题 */
    empty: false,
    session: null,
    navTitle: '火箭观礼',
    rocketImage: '',
    launchTimeText: '',
    countdown: null,
    countdownDone: false,
    myReservation: null,
    form: { name: '', phone: '', headcount: 1 },
    submitting: false,
    cancelling: false,
    /** 同行商家合作申请 */
    coopOpen: false,
    coopDone: false,
    coopSubmitting: false,
    coopForm: { name: '', contactName: '', phone: '', location: '', note: '' }
  },

  onLoad(options) {
    this.initUiShell()
    this._options = options || {}
    // 过审开关：分享/扫码直达也要拦下（failClosed）
    guardWatchPartyPage(this).then((ok) => {
      if (!ok || this._unloaded) return
      // 无 sessionId/code：进商家列表，避免默认只露出一家
      if (!options.sessionId && !options.code && !options.scene) {
        const mid = String(options.missionId || '').trim()
        const channel = String(options.channel || 'app').trim() || 'app'
        const q = mid
          ? ('missionId=' + encodeURIComponent(mid) + '&channel=' + encodeURIComponent(channel))
          : ('channel=' + encodeURIComponent(channel))
        wx.redirectTo({
          url: '/subpackages/watch-party/merchant-list?' + q,
          fail: () => this.loadSession()
        })
        return
      }
      this.loadSession()
    })
  },

  onShow() {
    // 从其他页返回或系统主题变化时，确保浅/深色变量与 page-meta 底色同步
    if (typeof this.syncTheme === 'function') this.syncTheme()
  },

  onUnload() {
    this._unloaded = true
    this._clearTimer()
  },

  _clearTimer() {
    if (this._timer) {
      clearInterval(this._timer)
      this._timer = null
    }
  },

  /** 异步回调专用：页面已卸载则丢弃，避免 setData 打 WARN */
  _safeSetData(patch) {
    if (this._unloaded) return
    this.setData(patch)
  },

  // 输入/键盘：复用 composer-input-behavior（星问 AI 成熟协议）

  loadSession() {
    const opts = this._options || {}
    this.setData({ loading: true, error: '', empty: false })
    const fetcher = opts.sessionId
      ? watchParty.fetchSession({ sessionId: opts.sessionId })
      : (opts.code
        ? watchParty.fetchSession({ code: opts.code })
        : watchParty.fetchWatchPartyEntry())
    fetcher.then((session) => {
      if (this._unloaded) return
      if (!session) {
        this._safeSetData({ loading: false, empty: true, session: null, rocketImage: '' })
        return
      }
      if (!Array.isArray(session.services)) session.services = []
      if (!Array.isArray(session.parkingSpots)) session.parkingSpots = []
      const merchant = String(session.merchantName || '').trim()
      const navTitle = merchant ? (merchant + '·火箭观礼') : '火箭观礼'
      this._safeSetData({
        loading: false,
        session,
        navTitle,
        rocketImage: resolveRocketImage(session),
        launchTimeText: this._formatLaunchTime(session.launchTime)
      })
      this._startCountdown()
      this._loadMyReservation()
    }).catch((err) => {
      // 服务关停/场次下线：清入口缓存，让首页/详情页入口尽快隐藏（否则要等 30 分钟缓存过期）
      if (err && (err.code === 4030 || err.code === 4040)) {
        try { watchParty.invalidateEntryCache() } catch (e) {}
      }
      this._safeSetData({ loading: false, error: (err && err.message) || '加载失败，请重试' })
    })
  },

  _formatLaunchTime(iso) {
    if (!iso) return '发射时间待定'
    try {
      const d = new Date(iso)
      if (isNaN(d.getTime())) return '发射时间待定'
      return `${d.getFullYear()}年${pad2(d.getMonth() + 1)}月${pad2(d.getDate())}日 ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
    } catch (e) {
      return '发射时间待定'
    }
  },

  _startCountdown() {
    this._clearTimer()
    const session = this.data.session
    if (!session || !session.launchTime) return
    const target = new Date(session.launchTime).getTime()
    if (!target || isNaN(target)) return
    const tick = () => {
      if (this._unloaded) {
        this._clearTimer()
        return
      }
      const diff = target - Date.now()
      if (diff <= 0) {
        this._safeSetData({ countdown: null, countdownDone: true })
        this._clearTimer()
        return
      }
      const days = Math.floor(diff / 86400000)
      const hours = Math.floor((diff % 86400000) / 3600000)
      const mins = Math.floor((diff % 3600000) / 60000)
      const secs = Math.floor((diff % 60000) / 1000)
      this._safeSetData({
        countdown: { days, hours: pad2(hours), mins: pad2(mins), secs: pad2(secs) },
        countdownDone: false
      })
    }
    tick()
    this._timer = setInterval(tick, 1000)
  },

  _loadMyReservation() {
    const session = this.data.session
    if (!session) return
    watchParty.fetchMyReservation(session.sessionId).then((r) => {
      this._safeSetData({ myReservation: r || null })
    }).catch(() => {})
  },

  onRetry() {
    this.loadSession()
  },

  // ── 导航 ──

  onOpenLocation() {
    const s = this.data.session
    if (!s || !s.lat || !s.lng) {
      wx.showToast({ title: '坐标未配置', icon: 'none' })
      return
    }
    wx.openLocation({
      latitude: s.lat,
      longitude: s.lng,
      name: s.title || '火箭观礼点',
      address: s.address || ''
    })
  },

  onOpenParking(e) {
    const idx = Number(e.currentTarget.dataset.index)
    const s = this.data.session
    const spot = s && s.parkingSpots && s.parkingSpots[idx]
    if (!spot || !spot.lat || !spot.lng) {
      wx.showToast({ title: '坐标未配置', icon: 'none' })
      return
    }
    wx.openLocation({
      latitude: spot.lat,
      longitude: spot.lng,
      name: spot.name || '观礼停车点',
      address: spot.note || ''
    })
  },

  _vehicleBookingUrl() {
    const raw = String((this.data.session && this.data.session.vehicleBookingUrl) || '').trim()
    if (!raw) return ''
    if (/^https?:\/\//i.test(raw)) return raw
    return 'https://' + raw
  },

  onCopyVehicleUrl() {
    const url = this._vehicleBookingUrl()
    if (!url) {
      wx.showToast({ title: '暂无预约网址', icon: 'none' })
      return
    }
    wx.setClipboardData({
      data: url,
      success: () => wx.showToast({ title: '已复制网址', icon: 'success' }),
      fail: () => wx.showToast({ title: '复制失败', icon: 'none' })
    })
  },

  onOpenVehicleUrl() {
    const url = this._vehicleBookingUrl()
    if (!url) {
      wx.showToast({ title: '暂无预约网址', icon: 'none' })
      return
    }
    wx.navigateTo({
      url: `/pages/webview/webview?url=${encodeURIComponent(url)}`,
      fail: () => {
        wx.setClipboardData({
          data: url,
          success: () => {
            wx.showModal({
              title: '请在浏览器打开',
              content: '网址已复制，请粘贴到浏览器访问预约页面。',
              showCancel: false,
              confirmText: '知道了'
            })
          }
        })
      }
    })
  },

  onPreviewWechatQr() {
    const url = this.data.session && this.data.session.wechatGroupQr
    if (!url) return
    wx.previewImage({ urls: [url], current: url })
  },

  // ── 预约表单（文字输入见 composer-input-behavior.onTextInput）──

  /** 滑动过程中度震动（步进变化才震，避免连打） */
  onHeadcountChanging(e) {
    const v = Math.min(10, Math.max(1, Number(e.detail.value) || 1))
    if (v === this._lastHeadcountVibrate) return
    this._lastHeadcountVibrate = v
    try { wx.vibrateShort({ type: 'medium', fail: () => {} }) } catch (err) {}
  },

  onHeadcountChange(e) {
    const v = Math.min(10, Math.max(1, Number(e.detail.value) || 1))
    this._lastHeadcountVibrate = v
    if (v === (this.data.form && this.data.form.headcount)) return
    this.setData({ 'form.headcount': v })
  },

  /** 本地设备指纹：供云端短窗限流（非隐私敏感，仅防脚本连打） */
  _getReserveDeviceKey() {
    const KEY = 'wp_reserve_device_key'
    try {
      let v = wx.getStorageSync(KEY)
      if (v && String(v).length >= 8) return String(v).slice(0, 64)
      v = 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12)
      wx.setStorageSync(KEY, v)
      return v
    } catch (e) {
      return ''
    }
  },

  onSubmitReserve() {
    const { session, form, submitting } = this.data
    if (!session || submitting) return
    const name = String(form.name || '').trim()
    const phone = String(form.phone || '').trim()
    if (!name) {
      wx.showToast({ title: '请填写姓名/昵称', icon: 'none' })
      return
    }
    if (!/^1\d{10}$/.test(phone)) {
      wx.showToast({ title: '请填写正确的手机号', icon: 'none' })
      return
    }
    this.setData({ submitting: true })
    watchParty.reserve({
      sessionId: session.sessionId,
      name,
      phone,
      headcount: form.headcount,
      channel: (this._options && this._options.channel) || 'app',
      deviceKey: this._getReserveDeviceKey()
    }).then(() => {
      try { wx.vibrateShort({ type: 'light', fail: () => {} }) } catch (e) {}
      wx.showToast({ title: '预约成功', icon: 'success' })
      this._safeSetData({ submitting: false })
      this._loadMyReservation()
    }).catch((err) => {
      this._safeSetData({ submitting: false })
      wx.showToast({ title: (err && err.message) || '预约失败', icon: 'none' })
    })
  },

  onCancelReserve() {
    const { session, cancelling } = this.data
    if (!session || cancelling) return
    wx.showModal({
      title: '取消预约',
      content: '确定取消本场观礼预约吗？',
      success: (res) => {
        if (!res.confirm || this._unloaded) return
        this._safeSetData({ cancelling: true })
        watchParty.cancelReservation(session.sessionId).then(() => {
          this._safeSetData({ cancelling: false, myReservation: null })
          wx.showToast({ title: '已取消', icon: 'none' })
        }).catch(() => {
          this._safeSetData({ cancelling: false })
          wx.showToast({ title: '取消失败', icon: 'none' })
        })
      }
    })
  },

  // ── 同行商家合作申请 ──

  onCoopToggle() {
    this.setData({ coopOpen: !this.data.coopOpen })
  },

  onCoopSubmit() {
    const { coopForm, coopSubmitting, session } = this.data
    if (coopSubmitting) return
    const name = String(coopForm.name || '').trim()
    const contactName = String(coopForm.contactName || '').trim()
    const phone = String(coopForm.phone || '').trim()
    if (!name) {
      wx.showToast({ title: '请填写商家/观礼点名称', icon: 'none' })
      return
    }
    if (!contactName) {
      wx.showToast({ title: '请填写联系人姓名', icon: 'none' })
      return
    }
    if (!/^1\d{10}$/.test(phone)) {
      wx.showToast({ title: '请填写正确的手机号', icon: 'none' })
      return
    }
    this.setData({ coopSubmitting: true })
    watchParty.applyMerchantCooperation({
      name,
      contactName,
      phone,
      location: String(coopForm.location || '').trim(),
      note: String(coopForm.note || '').trim(),
      sessionId: (session && session.sessionId) || ''
    }).then(() => {
      try { wx.vibrateShort({ type: 'light', fail: () => {} }) } catch (e) {}
      this._safeSetData({ coopSubmitting: false, coopDone: true })
    }).catch((err) => {
      this._safeSetData({ coopSubmitting: false })
      const msg = (err && err.message) || '提交失败，请重试'
      // 重复申请视为已提交成功，直接展示完成态
      if (err && err.code === 4002) {
        this._safeSetData({ coopDone: true })
      }
      wx.showToast({ title: msg, icon: 'none' })
    })
  },

  // ── 跳转 ──

  onGoGacha() {
    wx.showModal({
      title: '现场奖品抽奖',
      content: '请使用商家提供的现场物料码扫码进入。须商家确认发射成功后才能抽取；站内入口无法代替扫码。',
      confirmText: '去输场次码',
      cancelText: '知道了',
      success: (res) => {
        if (!res.confirm || this._unloaded) return
        wx.navigateTo({ url: '/subpackages/watch-party/gacha' })
      }
    })
  },

  onGoAlbum() {
    wx.navigateTo({ url: '/subpackages/watch-party/album' })
  },

  /** 已入驻商家管理入口：凭运营发放的商家编号绑定后自助建场次 */
  onGoMerchant() {
    wx.navigateTo({ url: '/subpackages/watch-party/merchant' })
  },

  onShareAppMessage() {
    const s = this.data.session
    const title = s
      ? buildWatchPartyShareTitle(s, { withDistance: true })
      : '火箭发射现场观礼，近距离感受升空震撼'
    const path = s
      ? `/subpackages/watch-party/watch-party?sessionId=${encodeURIComponent(s.sessionId)}&channel=share`
      : '/subpackages/watch-party/watch-party'
    return { title, path }
  },

  onShareTimeline() {
    const s = this.data.session
    return {
      title: s ? buildWatchPartyShareTitle(s) : '火箭发射现场观礼',
      query: s ? `sessionId=${encodeURIComponent(s.sessionId)}&channel=timeline` : ''
    }
  }
})
