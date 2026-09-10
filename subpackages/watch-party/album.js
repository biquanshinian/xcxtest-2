/**
 * 我的现场奖品
 */
const pageBase = require('../../utils/page-base.js')
const watchParty = require('./utils/api.js')
const { guardWatchPartyPage } = require('../../utils/watch-party-feature.js')
const { decoratePrizeCard } = require('./utils/prize-card.js')

const TIER_ORDER = ['SSR', 'SR', 'R', 'N']

Page({
  behaviors: [pageBase],
  _fallbackTab: '/pages/profile/profile',

  data: {
    loading: true,
    error: '',
    total: 0,
    list: [],
    tierCounts: [],
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
      const list = (raw || []).map((c) => {
        const decorated = decoratePrizeCard(c, {
          drawId: c.drawId || '',
          createdAt: c.createdAt,
          sessionTitle: c.sessionTitle || ''
        })
        return {
          ...c,
          ...decorated,
          // 网格里价值优先，无价值时回落商家文案
          valueText: decorated.valueText || decorated.desc
        }
      })
      const tierCounts = TIER_ORDER
        .map((tier) => {
          const hit = list.filter((item) => item.tier === tier)
          return { tier, count: hit.length, label: hit.length ? hit[0].tierLabel : '' }
        })
        .filter((x) => x.count > 0)
      this._safeSetData({ loading: false, total: list.length, list, tierCounts })
    }).catch((err) => {
      this._safeSetData({ loading: false, error: (err && err.message) || '加载失败，请重试' })
    })
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
  }

  // 不提供 onShareTimeline：朋友圈单页模式会打开「查看者自己的」奖品册
  // （个人数据页 + 云能力不可用），落地必然空白/报错；好友转发已指向观礼详情页
})
