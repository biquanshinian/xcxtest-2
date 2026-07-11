/**
 * 简报详情页
 * 入口：「我的太空」今日简报卡片点击 / 首页简报弹窗与本页的「分享今日简报」落地
 * 内容渲染复用 morning-briefing 组件（mode="page"），无本地数据时组件内部会从 API 兜底拉取
 */
const pageBase = require('./page-base.js')
const { ROUTES } = require('../../utils/routes.js')

Page({
  behaviors: [pageBase],

  onLoad() {
    this.initUiShell()
  },

  onShareAppMessage() {
    return {
      title: '每日太空简报 — 今天太空发生了什么？',
      path: ROUTES.BRIEFING,
      imageUrl: ''
    }
  },

  onShareTimeline() {
    return {
      title: '每日太空简报 — 今天太空发生了什么？'
    }
  }
})
