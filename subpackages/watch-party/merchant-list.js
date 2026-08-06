/**
 * 观礼商家列表（C 端）
 * - 有 missionId：展示该发射任务下全部可预约商家，用户点选后再进详情
 * - 无 missionId：展示当前开放的观礼场次（我的/冷启动）
 */
const pageBase = require('../../utils/page-base.js')
const watchParty = require('./utils/api.js')
const { getRocketImage } = require('../../utils/util.js')
const { guardWatchPartyPage } = require('../../utils/watch-party-feature.js')

function resolveRocketImage(session) {
  const name = session && session.rocketName ? String(session.rocketName).trim() : ''
  return name ? (getRocketImage(name) || '') : ''
}

function serviceLabels(services) {
  if (!Array.isArray(services)) return []
  return services.map((s) => {
    if (!s) return ''
    if (typeof s === 'string') return s
    return s.label || s.name || s.id || ''
  }).filter(Boolean).slice(0, 4)
}

Page({
  behaviors: [pageBase],
  _fallbackTab: '/pages/index/index',

  data: {
    loading: true,
    error: '',
    missionId: '',
    missionTitle: '',
    sessions: []
  },

  onLoad(options) {
    this.initUiShell()
    this._options = options || {}
    this._missionId = String((options && options.missionId) || '').trim()
    this._channel = String((options && options.channel) || '').trim() || 'list'
    this.setData({ missionId: this._missionId })
    guardWatchPartyPage(this).then((ok) => {
      if (!ok || this._unloaded) return
      this.loadList()
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
    this.loadList()
  },

  loadList() {
    this.setData({ loading: true, error: '' })
    const params = {}
    if (this._missionId) params.missionId = this._missionId
    watchParty.fetchPublicSessions(params).then((res) => {
      if (this._unloaded) return
      const raw = (res && Array.isArray(res.list)) ? res.list : []
      const sessions = raw.map((s) => {
        const row = Object.assign({}, s)
        row.rocketImage = resolveRocketImage(row)
        row.services = serviceLabels(row.services)
        return row
      })
      const rocket = (res && res.rocketName) || (sessions[0] && sessions[0].rocketName) || ''
      const mission = (res && res.missionName) || (sessions[0] && sessions[0].missionName) || ''
      const missionTitle = [rocket, mission].filter(Boolean).join(' · ')
      this._safeSetData({
        loading: false,
        sessions,
        missionTitle,
        missionId: (res && res.missionId) || this._missionId || ''
      })
    }).catch((err) => {
      this._safeSetData({
        loading: false,
        error: (err && err.message) || '加载失败，请重试'
      })
    })
  },

  onSelect(e) {
    const id = e && e.currentTarget && e.currentTarget.dataset
      ? e.currentTarget.dataset.id
      : ''
    if (!id) return
    wx.navigateTo({
      url: '/subpackages/watch-party/watch-party?sessionId=' +
        encodeURIComponent(id) +
        '&channel=' + encodeURIComponent(this._channel || 'list')
    })
  },

  onGoMerchant() {
    wx.navigateTo({ url: '/subpackages/watch-party/merchant' })
  }
})
