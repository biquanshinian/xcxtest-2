const pageBase = require('../../utils/page-base.js')
const spaceApi = require('./space-api')

const ASTRO_EVENTS_2026 = [
  { date: '2026-01-03', title: '象限仪座流星雨极大', icon: '☄️', desc: 'ZHR~120，月光干扰较小' },
  { date: '2026-01-21', title: '满月', icon: '🌕', desc: '狼月 Wolf Moon' },
  { date: '2026-02-01', title: '金星东大距', icon: '✨', desc: '日落后西方低空可见' },
  { date: '2026-02-17', title: '水星西大距', icon: '🌟', desc: '日出前东方低空可见' },
  { date: '2026-03-29', title: '日偏食', icon: '🌑', desc: '亚洲部分地区可见' },
  { date: '2026-04-22', title: '天琴座流星雨极大', icon: '☄️', desc: 'ZHR~18，辐射点在织女星附近' },
  { date: '2026-05-06', title: '宝瓶座η流星雨极大', icon: '☄️', desc: 'ZHR~50，哈雷彗星碎片' },
  { date: '2026-05-31', title: '火星冲日', icon: '🔴', desc: '火星距地球最近，整夜可见' },
  { date: '2026-06-21', title: '夏至', icon: '☀️', desc: '北半球白昼最长' },
  { date: '2026-07-28', title: '宝瓶座δ南流星雨极大', icon: '☄️', desc: 'ZHR~25' },
  { date: '2026-08-12', title: '英仙座流星雨极大', icon: '☄️', desc: 'ZHR~100，年度最佳流星雨之一' },
  { date: '2026-08-12', title: '日全食', icon: '🌑', desc: '西伯利亚、格陵兰和大西洋可见全食' },
  { date: '2026-09-22', title: '秋分', icon: '🍂', desc: '昼夜等长' },
  { date: '2026-10-21', title: '猎户座流星雨极大', icon: '☄️', desc: 'ZHR~20，哈雷彗星碎片' },
  { date: '2026-11-04', title: '金牛座南流星雨极大', icon: '☄️', desc: 'ZHR~5，偶有明亮火流星' },
  { date: '2026-11-17', title: '狮子座流星雨极大', icon: '☄️', desc: 'ZHR~15' },
  { date: '2026-12-14', title: '双子座流星雨极大', icon: '☄️', desc: 'ZHR~150，年度最佳' },
  { date: '2026-12-21', title: '冬至', icon: '❄️', desc: '北半球白昼最短' }
]

const ASTRO_REMIND_KEY = '_astro_event_reminders'

function loadReminders() {
  try { return wx.getStorageSync(ASTRO_REMIND_KEY) || {} } catch (e) { return {} }
}
function saveReminders(map) {
  try { wx.setStorageSync(ASTRO_REMIND_KEY, map) } catch (e) {}
}

Page({
  behaviors: [pageBase],
  _fallbackTab: '/pages/index/index',

  data: {
    loading: true,
    error: '',
    apod: null,
    apodDate: '',
    events: [],
    upcomingEvents: [],
    pastEvents: [],
    remindedMap: {}
  },

  onLoad() {
    this.initUiShell()
    const today = spaceApi.dateStr()
    this.setData({ apodDate: today, remindedMap: loadReminders() })
    this._classifyEvents()
    this._loadAPOD(today)
    this._checkTodayReminders()
  },

  _classifyEvents() {
    const today = new Date().toISOString().slice(0, 10)
    const reminded = loadReminders()
    const upcoming = ASTRO_EVENTS_2026.filter(e => e.date >= today).map(e => ({
      ...e,
      reminded: !!reminded[e.date + '_' + e.title]
    }))
    const past = ASTRO_EVENTS_2026.filter(e => e.date < today).reverse()
    this.setData({ events: ASTRO_EVENTS_2026, upcomingEvents: upcoming, pastEvents: past })
  },

  _checkTodayReminders() {
    const today = new Date().toISOString().slice(0, 10)
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
    const reminded = loadReminders()
    const todayEvents = ASTRO_EVENTS_2026.filter(e => {
      const key = e.date + '_' + e.title
      return reminded[key] && (e.date === today || e.date === tomorrow)
    })
    if (todayEvents.length > 0) {
      const ev = todayEvents[0]
      const prefix = ev.date === today ? '今天' : '明天'
      wx.showModal({
        title: `${ev.icon} 天象提醒`,
        content: `${prefix}有天文事件：${ev.title}\n${ev.desc}`,
        showCancel: false,
        confirmText: '知道了'
      })
    }
  },

  onToggleRemind(e) {
    const { date, title } = e.currentTarget.dataset
    if (!date || !title) return
    const key = date + '_' + title
    const reminded = loadReminders()

    if (reminded[key]) {
      delete reminded[key]
      wx.showToast({ title: '已取消提醒', icon: 'none' })
    } else {
      reminded[key] = Date.now()
      wx.vibrateShort({ type: 'light' })
      wx.showToast({ title: '将在事件前提醒你', icon: 'none' })
    }

    saveReminders(reminded)
    this.setData({ remindedMap: reminded })
    this._classifyEvents()
  },

  _loadAPOD(date) {
    this.setData({ loading: true, error: '' })
    spaceApi.getAPOD(date).then(data => {
      const actualDate = data.date || date
      const apod = {
        title: data.title,
        explanation: data.explanation,
        url: data._localUrl || data.url,
        hdurl: data.hdurl,
        mediaType: data.media_type,
        date: actualDate,
        copyright: data.copyright || ''
      }
      this.setData({ loading: false, apodDate: actualDate, apod })

      if (!data._localUrl && data.media_type !== 'video' && data.url) {
        this._cacheImage(actualDate, data.url)
      }
    }).catch(err => {
      console.error('[APOD] error:', err)
      this.setData({ loading: false, error: err.message || '加载失败' })
    })
  },

  _cacheImage(date, remoteUrl) {
    wx.downloadFile({
      url: remoteUrl,
      success: res => {
        if (res.statusCode !== 200 || !res.tempFilePath) return
        const fs = wx.getFileSystemManager()
        const ext = remoteUrl.split('.').pop().split('?')[0] || 'jpg'
        const savedPath = `${wx.env.USER_DATA_PATH}/apod_${date}.${ext}`
        try {
          fs.saveFileSync(res.tempFilePath, savedPath)
          spaceApi.updateAPODCache(date, { _localUrl: savedPath })
          if (this.data.apod && this.data.apod.date === date) {
            this.setData({ 'apod.url': savedPath })
          }
        } catch (_) {}
      }
    })
  },

  onDateChange(e) {
    const date = e.detail.value
    this.setData({ apodDate: date })
    this._loadAPOD(date)
  },

  onRetry() {
    this._loadAPOD(this.data.apodDate)
  },

  onPreviewImage() {
    const apod = this.data.apod
    if (!apod || apod.mediaType === 'video') return
    wx.previewImage({ current: apod.hdurl || apod.url, urls: [apod.hdurl || apod.url] })
  },

  onShareAppMessage() {
    const apod = this.data.apod
    const title = apod ? 'NASA每日一图：' + apod.title : '天文日历 - 火星探索日志'
    const result = { title, path: '/pages/space-explore/astro-calendar' }
    if (apod && apod.mediaType !== 'video' && apod.url) result.imageUrl = apod.url
    return result
  },

  onShareTimeline() {
    const apod = this.data.apod
    const title = apod ? 'NASA每日一图：' + apod.title : '天文日历 - 火星探索日志'
    const result = { title }
    if (apod && apod.mediaType !== 'video' && apod.url) result.imageUrl = apod.url
    return result
  }
})
