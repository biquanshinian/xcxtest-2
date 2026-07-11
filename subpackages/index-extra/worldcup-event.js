/**
 * 临时活动页：NASA × FIFA 球迷节（休斯顿，2026-06-11 ~ 2026-07-19）
 * 倒计时纯本地计算；Hero 图片/视频由运营在后台管理系统维护（worldcup_event_media 集合），
 * 前端只读云数据库。活动下线后整页可删（同步删 app.json 注册与首页悬浮按钮）。
 */
const pageBase = require('../../utils/page-base.js')
const { toCdnUrl } = require('../../utils/cos-url.js')
const { isPlaybackAllowed } = require('../../utils/feature-flags.js')

// 休斯顿夏令时 UTC-5：开幕 = 6/11 当地 0 点，闭幕 = 7/19 当地 24 点
const EVENT_START_MS = Date.parse('2026-06-11T00:00:00-05:00')
const EVENT_END_MS = Date.parse('2026-07-20T00:00:00-05:00')
const DAY_MS = 24 * 60 * 60 * 1000

const NASA_EVENT_URL = 'https://www.nasa.gov/centers-and-facilities/johnson/how-nasa-science-and-artemis-are-shaping-the-2026-fifa-world-cup/'
const WORLDCUP_LOGO_URL = toCdnUrl('https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/%E5%9B%BE%E6%A0%87/1781152428682_whvs5h.svg')

function buildCountdown(nowMs) {
  if (nowMs < EVENT_START_MS) {
    return {
      status: 'upcoming',
      statusText: '未开始',
      countLabel: '距开幕',
      countDays: Math.ceil((EVENT_START_MS - nowMs) / DAY_MS)
    }
  }
  if (nowMs < EVENT_END_MS) {
    return {
      status: 'live',
      statusText: '进行中',
      countLabel: '距闭幕',
      countDays: Math.ceil((EVENT_END_MS - nowMs) / DAY_MS)
    }
  }
  return {
    status: 'ended',
    statusText: '已结束',
    countLabel: '',
    countDays: 0
  }
}

/**
 * 读取运营上传的 Hero 图片/视频（后台管理系统写 worldcup_event_media 集合）。
 * 文档结构：{ active: true, type: 'image' | 'video', url, poster?, createdAt }
 */
async function fetchHeroMedia() {
  try {
    if (!wx.cloud || !wx.cloud.database) return []
    const db = wx.cloud.database()
    const res = await Promise.race([
      db.collection('worldcup_event_media')
        .where({ active: true })
        .orderBy('createdAt', 'desc')
        .limit(9)
        .get(),
      new Promise((resolve) => setTimeout(() => resolve({ data: [] }), 4000))
    ]).catch(() => ({ data: [] }))
    return (res.data || [])
      .filter((item) => item && typeof item.url === 'string' && /^https?:\/\//i.test(item.url))
      .map((item) => ({
        id: item._id,
        type: item.type === 'video' || /\.(mp4|m3u8)(\?|$)/i.test(item.url) ? 'video' : 'image',
        url: toCdnUrl(item.url),
        poster: item.poster ? toCdnUrl(item.poster) : ''
      }))
  } catch (e) {
    return []
  }
}

Page({
  behaviors: [pageBase],
  _fallbackTab: '/pages/index/index',

  data: {
    navTitle: 'NASA × FIFA 球迷节',
    nasaLogoUrl: '/images/icons/nasa-logo.png',
    worldcupLogoUrl: WORLDCUP_LOGO_URL,
    status: 'live',
    statusText: '进行中',
    countLabel: '距闭幕',
    countDays: 0,
    mediaList: [],
    highlights: [
      { key: 'iss', title: '国际空间站研究展', desc: '近距离了解正在空间站上进行的科学实验' },
      { key: 'earth', title: '空间科学塑造地球生命', desc: '探索航天科技如何改变我们的日常生活' },
      { key: 'artemis', title: 'Artemis II 乘组分享', desc: '聆听阿尔忒弥斯 II 号船员绕月旅行后的见闻' }
    ]
  },

  onLoad() {
    this.initUiShell()
    this.setData(buildCountdown(Date.now()))
    Promise.all([
      fetchHeroMedia(),
      isPlaybackAllowed().catch(() => false)
    ]).then(([mediaList, playbackOk]) => {
      const list = Array.isArray(mediaList) ? mediaList : []
      // 过审关闭可播视频：只保留图片，去掉带 controls 的 <video>
      this.setData({
        mediaList: playbackOk ? list : list.filter((m) => m && m.type !== 'video')
      })
    })
  },

  onShow() {
    // 生命周期：页面驻留期间切回时按真实时间重算（跨过闭幕时刻自动切「已结束」）
    this.setData(buildCountdown(Date.now()))
  },

  onCopyLink() {
    const data = NASA_EVENT_URL
    // iOS 要求剪贴板写入保持在用户手势链内：必须在 tap 回调里「同步」调用，
    // 不能再套 requirePrivacyAuthorize 等异步回调，否则 iOS 静默失败（无反应）。
    wx.setClipboardData({
      data,
      success: () => {
        wx.showToast({ title: '链接已复制，请在浏览器打开', icon: 'none', duration: 2500 })
      },
      fail: () => {
        wx.showModal({ title: '请手动复制链接', content: data, showCancel: false })
      }
    })
  },

  /** Hero 图片点击 → 全屏预览（仅图片参与轮播） */
  onPreviewMedia(e) {
    const url = e.currentTarget.dataset.url
    if (!url) return
    const urls = this.data.mediaList.filter((m) => m.type === 'image').map((m) => m.url)
    if (!urls.length) return
    wx.previewImage({ current: url, urls })
  },

  /** 媒体加载失败 → 从列表移除，避免占位破图 */
  onMediaError(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    this.setData({ mediaList: this.data.mediaList.filter((m) => m.id !== id) })
  },

  onShareAppMessage() {
    return {
      title: 'NASA × FIFA 球迷节：足球和太空有什么共同点？',
      path: '/subpackages/index-extra/worldcup-event'
    }
  },

  onShareTimeline() {
    return {
      title: 'NASA × FIFA 球迷节：足球和太空有什么共同点？'
    }
  }
})
