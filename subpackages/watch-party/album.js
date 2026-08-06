/**
 * 我的现场奖品
 */
const pageBase = require('../../utils/page-base.js')
const watchParty = require('./utils/api.js')
const { guardWatchPartyPage } = require('../../utils/watch-party-feature.js')

function pad2(n) {
  return n < 10 ? '0' + n : '' + n
}

Page({
  behaviors: [pageBase],
  _fallbackTab: '/pages/profile/profile',

  data: {
    loading: true,
    error: '',
    total: 0,
    list: [],
    viewCard: null
  },

  onLoad() {
    this.initUiShell()
    guardWatchPartyPage(this).then((ok) => {
      if (!ok || this._unloaded) return
      this.loadCards()
      this._loadOpenid()
    })
  },

  onUnload() {
    this._unloaded = true
  },

  _safeSetData(patch) {
    if (this._unloaded) return
    this.setData(patch)
  },

  _loadOpenid() {
    this._openid = ''
    try {
      const { getInviteState } = require('../../utils/invite.js')
      getInviteState().then((r) => {
        this._openid = (r && r.openid) || ''
      }).catch(() => {})
    } catch (e) {}
  },

  loadCards() {
    this.setData({ loading: true, error: '' })
    watchParty.fetchMyCards().then((raw) => {
      const list = (raw || []).map((c) => ({
        ...c,
        dateText: this._formatDate(c.createdAt),
        valueText: c.valueYuan != null ? `¥${c.valueYuan}` : (c.desc || '')
      }))
      this._safeSetData({ loading: false, total: list.length, list })
    }).catch((err) => {
      this._safeSetData({ loading: false, error: (err && err.message) || '加载失败，请重试' })
    })
  },

  _formatDate(ts) {
    if (!ts) return ''
    const d = new Date(Number(ts))
    if (isNaN(d.getTime())) return ''
    return `${d.getFullYear()}.${pad2(d.getMonth() + 1)}.${pad2(d.getDate())}`
  },

  onRetry() {
    this.loadCards()
  },

  onViewCard(e) {
    const idx = Number(e.currentTarget.dataset.index)
    const card = this.data.list[idx]
    if (!card) return
    this.setData({ viewCard: card })
  },

  onCloseView() {
    this.setData({ viewCard: null })
  },

  onGoGacha() {
    wx.showModal({
      title: '现场奖品抽奖',
      content: '请扫描现场物料码进入抽奖；商家确认发射成功后开放抽取。',
      confirmText: '去输场次码',
      cancelText: '知道了',
      success: (res) => {
        if (!res.confirm) return
        wx.navigateTo({ url: '/subpackages/watch-party/gacha' })
      }
    })
  },

  onShareAppMessage() {
    const card = this.data.viewCard
    const inviterQs = this._openid ? `&inviter=${this._openid}` : ''
    if (card) {
      const result = {
        title: `我在火箭观礼现场抽到了「${card.name}」！`,
        path: card.sessionId
          ? `/subpackages/watch-party/watch-party?sessionId=${encodeURIComponent(card.sessionId)}&channel=card${inviterQs}`
          : `/subpackages/watch-party/watch-party?channel=card${inviterQs}`
      }
      if (card.image) result.imageUrl = card.image
      return result
    }
    return {
      title: `我已抽到${this.data.total}件火箭观礼现场奖品`,
      path: `/subpackages/watch-party/watch-party?channel=album${inviterQs}`
    }
  },

  onShareTimeline() {
    const card = this.data.viewCard
    return {
      title: card
        ? `我在火箭发射现场抽到了「${card.name}」`
        : '火箭观礼现场奖品',
      query: this._openid ? `inviter=${this._openid}` : ''
    }
  }
})
