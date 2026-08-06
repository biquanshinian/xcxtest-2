/**
 * 商家中心 · 场次预约名单（简约明细）
 * - 汇总：待到场 / 已核销 / 取消 / 有效人数
 * - 列表：姓名、手机、人数、状态、预约时间；可拨打与核销
 */
const pageBase = require('../../utils/page-base.js')
const watchParty = require('./utils/api.js')
const { guardWatchPartyPage } = require('../../utils/watch-party-feature.js')

function pad2(n) {
  return n < 10 ? '0' + n : '' + n
}

function formatTime(ts) {
  const t = Number(ts || 0)
  if (!t) return ''
  const d = new Date(t)
  if (isNaN(d.getTime())) return ''
  return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

function statusMeta(status) {
  if (status === 'checked_in') return { label: '已核销', cls: 'wpr-tag--ok' }
  if (status === 'cancelled') return { label: '已取消', cls: 'wpr-tag--off' }
  return { label: '待到场', cls: 'wpr-tag--pending' }
}

Page({
  behaviors: [pageBase],
  _fallbackTab: '/pages/index/index',

  data: {
    loading: true,
    error: '',
    sessionId: '',
    sessionTitle: '',
    sessionSub: '',
    filter: 'all',
    summary: { pending: 0, checkedIn: 0, cancelled: 0, active: 0, people: 0 },
    list: [],
    total: 0,
    page: 1,
    hasMore: false,
    loadingMore: false,
    checkingId: ''
  },

  onLoad(options) {
    this.initUiShell()
    this._sessionId = String((options && options.sessionId) || '').trim()
    this._titleHint = String((options && options.title) || '').trim()
    this.setData({
      sessionId: this._sessionId,
      sessionTitle: this._titleHint || '预约名单'
    })
    guardWatchPartyPage(this).then((ok) => {
      if (!ok || this._unloaded) return
      if (!this._sessionId) {
        this._safeSetData({ loading: false, error: '缺少场次信息' })
        return
      }
      this.loadList(true)
    })
  },

  onUnload() {
    this._unloaded = true
  },

  onShow() {
    if (typeof this.syncTheme === 'function') this.syncTheme()
  },

  _safeSetData(patch) {
    if (this._unloaded) return
    this.setData(patch)
  },

  onRetry() {
    this.loadList(true)
  },

  onFilterTap(e) {
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {}
    const filter = String(ds.filter || 'all')
    if (filter === this.data.filter) return
    this.setData({ filter })
    this.loadList(true)
  },

  _statusQuery() {
    const f = this.data.filter
    if (f === 'pending' || f === 'checked_in' || f === 'cancelled') return f
    return ''
  },

  loadList(reset) {
    if (!this._sessionId) return
    const page = reset ? 1 : (this.data.page || 1)
    if (reset) {
      this.setData({ loading: true, error: '', list: [], page: 1, hasMore: false })
    } else {
      this.setData({ loadingMore: true })
    }
    const query = { page, pageSize: 30 }
    const st = this._statusQuery()
    if (st) query.status = st

    watchParty.fetchMerchantReservations(this._sessionId, query).then((res) => {
      if (this._unloaded) return
      const session = (res && res.session) || {}
      const summary = (res && res.summary) || {}
      const raw = (res && Array.isArray(res.list)) ? res.list : []
      const mapped = raw.map((row) => {
        const meta = statusMeta(row.status)
        return {
          reservationId: row.reservationId,
          name: row.name || '未填姓名',
          phone: row.phone || '',
          headcount: row.headcount || 1,
          status: row.status || 'pending',
          statusLabel: meta.label,
          statusClass: meta.cls,
          timeText: formatTime(row.createdAt),
          canCheckIn: row.status === 'pending'
        }
      })
      const prev = reset ? [] : (this.data.list || [])
      const list = prev.concat(mapped)
      const total = Number((res && res.total) || 0)
      const rocket = session.rocketName || ''
      const mission = session.missionName || ''
      const sessionSub = [rocket, mission].filter(Boolean).join(' · ')
      this._safeSetData({
        loading: false,
        loadingMore: false,
        error: '',
        sessionTitle: session.title || this._titleHint || '预约名单',
        sessionSub,
        summary: {
          pending: Number(summary.pending || 0),
          checkedIn: Number(summary.checkedIn || 0),
          cancelled: Number(summary.cancelled || 0),
          active: Number(summary.active || 0),
          people: Number(summary.people || 0)
        },
        list,
        total,
        page,
        hasMore: list.length < total
      })
    }).catch((err) => {
      if (this._unloaded) return
      this._safeSetData({
        loading: false,
        loadingMore: false,
        error: (err && err.message) || '加载失败，请重试'
      })
    })
  },

  onLoadMore() {
    if (this.data.loading || this.data.loadingMore || !this.data.hasMore) return
    this.setData({ page: (this.data.page || 1) + 1 })
    this.loadList(false)
  },

  onCall(e) {
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {}
    const phone = String(ds.phone || '').trim()
    if (!/^1\d{10}$/.test(phone)) {
      wx.showToast({ title: '手机号无效', icon: 'none' })
      return
    }
    wx.makePhoneCall({ phoneNumber: phone, fail: () => {} })
  },

  onCopyPhone(e) {
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {}
    const phone = String(ds.phone || '').trim()
    if (!phone) return
    wx.setClipboardData({
      data: phone,
      success: () => wx.showToast({ title: '已复制手机号', icon: 'none' })
    })
  },

  onCheckIn(e) {
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {}
    const id = String(ds.id || '').trim()
    const name = String(ds.name || '').trim() || '该预约'
    if (!id || this.data.checkingId) return
    wx.showModal({
      title: '确认核销到场？',
      content: `确认「${name}」已到场？`,
      confirmText: '核销',
      confirmColor: '#07C160',
      success: (res) => {
        if (!res.confirm || this._unloaded) return
        this._safeSetData({ checkingId: id })
        watchParty.merchantCheckInReservation(id).then(() => {
          if (this._unloaded) return
          wx.showToast({ title: '已核销', icon: 'success' })
          this._safeSetData({ checkingId: '' })
          this.loadList(true)
        }).catch((err) => {
          if (this._unloaded) return
          this._safeSetData({ checkingId: '' })
          wx.showToast({ title: (err && err.message) || '核销失败', icon: 'none' })
        })
      }
    })
  }
})
