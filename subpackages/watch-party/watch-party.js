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
const rocketArtUtil = require('../../utils/rocket-config-art.js')
const { guardWatchPartyPage } = require('../../utils/watch-party-feature.js')

function pad2(n) {
  return n < 10 ? '0' + n : '' + n
}

function resolveRocketImage(session) {
  // 优先用商家自动获取任务时锁定的 rocketImageName：手动改火箭名不换配置图
  const lockName = session && session.rocketImageName ? String(session.rocketImageName).trim() : ''
  const name = lockName || (session && session.rocketName ? String(session.rocketName).trim() : '')
  return name ? (getRocketImage(name) || '') : ''
}

/** 预约截止时刻：优先用云端下发的 reserveCloseAt，旧缓存兜底为发射前 30 分钟（与云端常量对齐） */
function reserveCloseAtOf(session) {
  const server = Number(session && session.reserveCloseAt) || 0
  if (server > 0) return server
  const t = session && session.launchTime ? Date.parse(session.launchTime) : NaN
  if (!t || isNaN(t)) return 0
  return t - 30 * 60 * 1000
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
    /** 联系商家入口（电话/微信好友二维码至少其一时展示，文案按组合派生） */
    hasContact: false,
    contactHint: '',
    contactBtnText: '',
    contactClosedBtnText: '',
    /** 微信联系弹层：展示添加好友二维码，顾客长按识别 */
    contactQrVisible: false,
    contactQrUrl: '',
    /** 合作申请：可选微信好友二维码 fileID */
    coopQrUploading: false,
    countdown: null,
    countdownDone: false,
    /** 朋友圈单页模式：仅浏览引导，云能力不可用 */
    singlePage: false,
    /** 预约截止（发射前 30 分钟，云端硬校验，这里只做展示） */
    reserveClosed: false,
    reserveCloseText: '',
    /** 同商家其他任务场次（切换入口） */
    merchantOtherSessions: [],
    myReservation: null,
    form: { name: '', phone: '', headcount: 1 },
    submitting: false,
    cancelling: false,
    /** 同行商家合作申请 */
    coopOpen: false,
    coopDone: false,
    coopSubmitting: false,
    coopForm: { name: '', contactName: '', phone: '', wechatQr: '', location: '', note: '' },
    /** 现场视频：默认只显示封面，点击才挂 src 播放（省流量；商家压缩短视频，免门控） */
    siteVideoPlaying: false
  },

  onLoad(options) {
    this.initUiShell()
    this._options = options || {}
    // 朋友圈单页模式（scene 1154）：云能力与登录态不可用，直接给「前往小程序」引导，
    // 避免打一半的云调用报错；正常打开小程序后走完整流程
    let enterScene = 0
    try {
      const enter = (wx.getEnterOptionsSync && wx.getEnterOptionsSync())
        || (wx.getLaunchOptionsSync && wx.getLaunchOptionsSync())
        || {}
      enterScene = Number(enter.scene) || 0
    } catch (e) {}
    if (enterScene === 1154) {
      this.setData({ loading: false, singlePage: true })
      return
    }
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
    rocketArtUtil.applyRocketConfigArtIfNeeded(this)
  },

  refreshRocketConfigArt() {
    const session = this.data.session
    if (!session) return
    const next = resolveRocketImage(session)
    if (next === this.data.rocketImage) return
    this._safeSetData({ rocketImage: next })
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

  /**
   * 小程序码 scene 兜底解析：支持 wp:<短码>:<渠道>（物料码同款）与 k=v 键值对
   * （sessionId= / c= / code=）。解析成功才按精确场次取数，避免掉进
   * 「入口最佳场次」造成扫 A 家的码进了 B 家的场。
   */
  _parseSceneEntry() {
    const raw = this._options && this._options.scene
    if (!raw) return null
    try {
      const scene = decodeURIComponent(String(raw))
      const wp = scene.split(':')
      if (wp[0] === 'wp' && wp[1]) {
        if (wp[2] && !this._options.channel) this._options.channel = wp[2]
        return { code: wp[1] }
      }
      const kv = {}
      scene.split('&').forEach((seg) => {
        const i = seg.indexOf('=')
        if (i > 0) kv[seg.slice(0, i)] = seg.slice(i + 1)
      })
      if (kv.sessionId) return { sessionId: kv.sessionId }
      if (kv.c || kv.code) return { code: kv.c || kv.code }
    } catch (e) {}
    return null
  },

  loadSession() {
    const opts = this._options || {}
    this.setData({ loading: true, error: '', empty: false })
    const sceneEntry = (!opts.sessionId && !opts.code) ? this._parseSceneEntry() : null
    const fetcher = opts.sessionId
      ? watchParty.fetchSession({ sessionId: opts.sessionId })
      : (opts.code
        ? watchParty.fetchSession({ code: opts.code })
        : (sceneEntry
          ? watchParty.fetchSession(sceneEntry)
          : watchParty.fetchWatchPartyEntry()))
    fetcher.then((session) => {
      if (this._unloaded) return
      if (!session) {
        this._safeSetData({ loading: false, empty: true, session: null, rocketImage: '' })
        return
      }
      if (!Array.isArray(session.services)) session.services = []
      if (!Array.isArray(session.parkingSpots)) session.parkingSpots = []
      if (!Array.isArray(session.sitePhotos)) session.sitePhotos = []
      if (!Array.isArray(session.wechatGroupQrs)) {
        session.wechatGroupQrs = session.wechatGroupQr ? [session.wechatGroupQr] : []
      }
      const merchant = String(session.merchantName || '').trim()
      const navTitle = merchant ? (merchant + '·火箭观礼') : '火箭观礼'
      const closeAt = reserveCloseAtOf(session)
      this._safeSetData({
        loading: false,
        session,
        navTitle,
        rocketImage: resolveRocketImage(session),
        launchTimeText: this._formatLaunchTime(session.launchTime),
        reserveClosed: closeAt > 0 && Date.now() >= closeAt,
        reserveCloseText: this._formatCloseTime(closeAt),
        merchantOtherSessions: this._mapOtherSessions(session.merchantOtherSessions),
        siteVideoPlaying: false,
        ...this._buildContactUi(session)
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

  /** 「联系商家」入口文案：按电话/微信好友二维码有无组合（hasContact 供 wxml 控显隐） */
  _buildContactUi(session) {
    const phone = session && session.contactPhone ? String(session.contactPhone).trim() : ''
    const qr = session && session.contactWechatQr ? String(session.contactWechatQr).trim() : ''
    if (phone && qr) {
      return {
        hasContact: true,
        contactHint: phone + ' · 支持微信扫码 / 电话咨询',
        contactBtnText: '联系',
        contactClosedBtnText: '联系商家协调（电话 / 微信）'
      }
    }
    if (qr) {
      return {
        hasContact: true,
        contactHint: '微信扫码添加 · 观礼咨询 / 到场协调',
        contactBtnText: '加微信',
        contactClosedBtnText: '扫码添加商家微信'
      }
    }
    if (phone) {
      return {
        hasContact: true,
        contactHint: phone + ' · 观礼咨询 / 到场协调',
        contactBtnText: '拨打',
        contactClosedBtnText: '拨打商家电话 ' + phone
      }
    }
    return { hasContact: false, contactHint: '', contactBtnText: '', contactClosedBtnText: '' }
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

  /** 预约截止提示：如「8月9日 11:30 停止预约」；无有效发射时间返回空 */
  _formatCloseTime(ts) {
    if (!ts) return ''
    const d = new Date(ts)
    if (isNaN(d.getTime())) return ''
    return `${d.getMonth() + 1}月${d.getDate()}日 ${pad2(d.getHours())}:${pad2(d.getMinutes())} 停止预约`
  },

  /** 同商家其他场次：补展示字段（发射时间文案 + 预约状态标签） */
  _mapOtherSessions(list) {
    if (!Array.isArray(list) || !list.length) return []
    const nowTs = Date.now()
    return list.map((s) => {
      const row = Object.assign({}, s)
      const closeAt = reserveCloseAtOf(row)
      if (row.status !== 'open') {
        row.statusType = 'off'
        row.statusLabel = '停止预约'
      } else if (closeAt > 0 && nowTs >= closeAt) {
        row.statusType = 'closed'
        row.statusLabel = '预约截止'
      } else {
        row.statusType = 'open'
        row.statusLabel = '预约中'
      }
      row.launchTimeText = this._formatLaunchTime(row.launchTime)
      return row
    })
  },

  /** 切换到同商家其他场次详情；页面栈接近上限时用 redirect 防溢出 */
  onOpenOtherSession(e) {
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {}
    const id = ds.id
    if (!id || (this.data.session && id === this.data.session.sessionId)) return
    const url = '/subpackages/watch-party/watch-party?sessionId=' + encodeURIComponent(id) +
      '&channel=' + encodeURIComponent((this._options && this._options.channel) || 'switch')
    let depth = 0
    try { depth = (getCurrentPages() || []).length } catch (err) { depth = 0 }
    if (depth >= 9) {
      wx.redirectTo({ url })
    } else {
      wx.navigateTo({ url })
    }
  },

  _startCountdown() {
    this._clearTimer()
    const session = this.data.session
    if (!session || !session.launchTime) return
    const target = new Date(session.launchTime).getTime()
    if (!target || isNaN(target)) return
    const closeAt = reserveCloseAtOf(session)
    const tick = () => {
      if (this._unloaded) {
        this._clearTimer()
        return
      }
      const diff = target - Date.now()
      if (diff <= 0) {
        this._safeSetData({ countdown: null, countdownDone: true, reserveClosed: closeAt > 0 })
        this._clearTimer()
        return
      }
      const days = Math.floor(diff / 86400000)
      const hours = Math.floor((diff % 86400000) / 3600000)
      const mins = Math.floor((diff % 3600000) / 60000)
      const secs = Math.floor((diff % 60000) / 1000)
      const patch = {
        countdown: { days, hours: pad2(hours), mins: pad2(mins), secs: pad2(secs) },
        countdownDone: false
      }
      // 页面停留期间跨过 T-30min：即时切到「预约已截止」态
      const closedNow = closeAt > 0 && Date.now() >= closeAt
      if (closedNow !== this.data.reserveClosed) patch.reserveClosed = closedNow
      this._safeSetData(patch)
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

  /** 分享/扫码链接对应场次已删或下线时的逃生口：换到商家列表继续选 */
  onGoOtherMerchants() {
    wx.redirectTo({
      url: '/subpackages/watch-party/merchant-list?channel=fallback',
      fail: () => {
        try { wx.switchTab({ url: '/pages/index/index' }) } catch (e) {}
      }
    })
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
    if (/^#小程序:\/\//.test(raw)) return raw
    if (/^https?:\/\//i.test(raw)) return raw
    return 'https://' + raw
  },

  onOpenVehicleUrl() {
    const url = this._vehicleBookingUrl()
    if (!url) {
      wx.showToast({ title: '暂无预约信息', icon: 'none' })
      return
    }
    // 小程序短链：直接跳转到对应预约小程序
    if (/^#小程序:\/\//.test(url)) {
      if (typeof wx.navigateToMiniProgram !== 'function') {
        wx.showToast({ title: '当前微信版本不支持跳转，请升级微信', icon: 'none' })
        return
      }
      wx.navigateToMiniProgram({
        shortLink: url,
        fail: (err) => {
          const msg = (err && err.errMsg) || ''
          if (/cancel/i.test(msg)) return
          wx.setClipboardData({
            data: url,
            success: () => wx.showToast({ title: '跳转失败，已复制短链', icon: 'none' }),
            fail: () => wx.showToast({ title: '跳转失败', icon: 'none' })
          })
        }
      })
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

  onPreviewWechatQr(e) {
    const s = this.data.session || {}
    const list = (Array.isArray(s.wechatGroupQrs) && s.wechatGroupQrs.length)
      ? s.wechatGroupQrs
      : (s.wechatGroupQr ? [s.wechatGroupQr] : [])
    if (!list.length) return
    const idx = Number(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.index) || 0
    wx.previewImage({ urls: list, current: list[idx] || list[0], fail: () => {} })
  },

  // ── 现场照片 / 现场视频（商家自传压缩短视频 ≤20MB，不做会员门控；点击才挂 src 省流量） ──

  onPreviewSitePhoto(e) {
    const list = (this.data.session && this.data.session.sitePhotos) || []
    if (!list.length) return
    const idx = Number(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.index) || 0
    wx.previewImage({ urls: list, current: list[idx] || list[0], fail: () => {} })
  },

  onPlaySiteVideo() {
    const s = this.data.session || {}
    if (!s.siteVideo || this.data.siteVideoPlaying) return
    this._safeSetData({ siteVideoPlaying: true })
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

  /**
   * 联系商家（预约卡 / 位置导航卡 / 预约截止卡共用）：
   * 电话、微信好友二维码都有时弹窗二选一；只有其一则直达对应方式。
   * 微信联系 = 弹层展示二维码，顾客长按识别添加（小程序无法直接跳转加好友页）。
   */
  onContactMerchant() {
    const s = this.data.session || {}
    const phone = s.contactPhone ? String(s.contactPhone).trim() : ''
    const qr = s.contactWechatQr ? String(s.contactWechatQr).trim() : ''
    if (phone && qr) {
      wx.showActionSheet({
        itemList: ['微信联系（扫码添加）', '电话联系 ' + phone],
        success: (r) => {
          if (this._unloaded) return
          if (r.tapIndex === 0) this._showContactWechatQr(qr)
          else if (r.tapIndex === 1) wx.makePhoneCall({ phoneNumber: phone, fail: () => {} })
        },
        fail: () => {}
      })
      return
    }
    if (qr) {
      this._showContactWechatQr(qr)
      return
    }
    if (phone) wx.makePhoneCall({ phoneNumber: phone, fail: () => {} })
  },

  _showContactWechatQr(url) {
    if (!url) return
    this.setData({ contactQrVisible: true, contactQrUrl: url })
  },

  onCloseContactQr() {
    this.setData({ contactQrVisible: false, contactQrUrl: '' })
  },

  onPreviewContactQr() {
    const url = this.data.contactQrUrl
    if (!url) return
    wx.previewImage({ urls: [url], current: url, fail: () => {} })
  },

  noop() {},

  /** 把发射窗口写入手机日历（提前 2 小时提醒，方便赶往观礼点） */
  onAddCalendar() {
    const s = this.data.session
    const start = s && s.launchTime ? Math.floor(new Date(s.launchTime).getTime() / 1000) : 0
    if (!start || isNaN(start)) {
      wx.showToast({ title: '发射时间待定，暂不能设置提醒', icon: 'none' })
      return
    }
    if (typeof wx.addPhoneCalendar !== 'function') {
      wx.showToast({ title: '当前微信版本不支持日历提醒', icon: 'none' })
      return
    }
    wx.addPhoneCalendar({
      title: s.title || '火箭发射观礼',
      startTime: start,
      endTime: start + 3600,
      location: s.address || '',
      description: '记得提前出发前往观礼点' + (s.address ? '：' + s.address : ''),
      alarm: true,
      alarmOffset: 7200,
      success: () => wx.showToast({ title: '已加入手机日历', icon: 'success' }),
      fail: (err) => {
        const msg = (err && err.errMsg) || ''
        console.warn('[watch-party] addPhoneCalendar fail:', msg, err && err.errno)
        if (/cancel/i.test(msg)) return
        // 平台隐私指引未声明日历权限（errno 112）：去公众平台声明后才可用，去系统设置无效
        if ((err && Number(err.errno) === 112) || /not declared in the privacy agreement/i.test(msg)) {
          wx.showModal({
            title: '日历接口未声明',
            content: '请在微信公众平台 → 用户隐私保护指引中声明「使用你的日历（仅写入）权限」（对应 wx.addPhoneCalendar），审核通过后再试。',
            showCancel: false,
            confirmText: '知道了'
          })
          return
        }
        // 用户尚未同意小程序隐私协议：重试会再次弹隐私授权
        if (/privacy permission is not authorized/i.test(msg)) {
          wx.showToast({ title: '请先同意隐私保护指引后重试', icon: 'none' })
          return
        }
        // 拒绝过日历系统授权：引导去设置开启（与保存相册同模式）
        if (/auth|deny|permission/i.test(msg)) {
          wx.showModal({
            title: '需要日历权限',
            content: '请在设置中允许使用日历，以便发射前收到观礼提醒。',
            confirmText: '去设置',
            cancelText: '取消',
            success: (r) => {
              if (r.confirm) wx.openSetting({ fail: () => {} })
            }
          })
          return
        }
        wx.showToast({ title: '未能添加日历提醒', icon: 'none' })
      }
    })
  },

  onCancelReserve() {
    const { session, cancelling } = this.data
    if (!session || cancelling) return
    wx.showModal({
      title: '取消这次预约吗',
      content: '取消后，这个名额会让给其他想来的朋友。之后想来的话，只要还有名额，随时可以重新预约。',
      confirmText: '取消预约',
      cancelText: '再想想',
      confirmColor: '#EF4444',
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

  /** 合作申请：上传微信「添加朋友」二维码（选填，云存储 fileID） */
  onUploadCoopWechatQr() {
    if (this.data.coopQrUploading) return
    if (typeof wx.chooseMedia !== 'function') {
      wx.showToast({ title: '当前微信版本不支持选图', icon: 'none' })
      return
    }
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: (res) => {
        if (this._unloaded) return
        const f = res && res.tempFiles && res.tempFiles[0]
        if (!f || !f.tempFilePath) return
        if (!wx.cloud || typeof wx.cloud.uploadFile !== 'function') {
          wx.showToast({ title: '云能力不可用', icon: 'none' })
          return
        }
        this._safeSetData({ coopQrUploading: true })
        wx.showLoading({ title: '上传中…', mask: true })
        const extMatch = /\.(\w+)$/.exec(f.tempFilePath || '')
        const ext = (extMatch && extMatch[1].toLowerCase()) || 'jpg'
        wx.cloud.uploadFile({
          cloudPath: `watch_party/contact_wechat_qr/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`,
          filePath: f.tempFilePath,
          success: (up) => {
            try { wx.hideLoading() } catch (e) {}
            if (this._unloaded) return
            const fileID = (up && up.fileID) || ''
            this._safeSetData({ coopQrUploading: false, 'coopForm.wechatQr': fileID })
            if (!fileID) wx.showToast({ title: '上传失败，请重试', icon: 'none' })
            else wx.showToast({ title: '二维码已上传', icon: 'success' })
          },
          fail: () => {
            try { wx.hideLoading() } catch (e) {}
            if (this._unloaded) return
            this._safeSetData({ coopQrUploading: false })
            wx.showToast({ title: '上传失败，请重试', icon: 'none' })
          }
        })
      },
      fail: (err) => {
        if (this._unloaded) return
        const msg = (err && err.errMsg) || ''
        if (/cancel/i.test(msg)) return
        wx.showToast({ title: '选图失败，请重试', icon: 'none' })
      }
    })
  },

  onRemoveCoopWechatQr() {
    this.setData({ 'coopForm.wechatQr': '' })
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
      wechatQr: String(coopForm.wechatQr || '').trim(),
      location: String(coopForm.location || '').trim(),
      note: String(coopForm.note || '').trim(),
      sessionId: (session && session.sessionId) || ''
    }).then((res) => {
      try { wx.vibrateShort({ type: 'light', fail: () => {} }) } catch (e) {}
      this._safeSetData({ coopSubmitting: false, coopDone: true })
      // 自动入驻已通过：直接引导进商家中心创建场次（微信已自动绑定）
      if (res && res.autoApproved) {
        wx.showModal({
          title: '入驻成功',
          content: `您已成为观礼合作商家（编号 ${res.merchantCode || '见商家中心'}），当前微信已自动绑定。现在就去商家中心创建观礼场次吧！`,
          confirmText: '进商家中心',
          cancelText: '稍后再去',
          success: (r) => {
            if (!r.confirm || this._unloaded) return
            wx.navigateTo({ url: '/subpackages/watch-party/merchant' })
          }
        })
      }
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
    const share = { title, path }
    // 配置图为包内本地图，可直接作分享卡封面；无图时微信自动截图
    if (this.data.rocketImage) share.imageUrl = this.data.rocketImage
    return share
  },

  onShareTimeline() {
    const s = this.data.session
    const share = {
      title: s ? buildWatchPartyShareTitle(s) : '火箭发射现场观礼',
      query: s ? `sessionId=${encodeURIComponent(s.sessionId)}&channel=timeline` : ''
    }
    if (this.data.rocketImage) share.imageUrl = this.data.rocketImage
    return share
  }
})
