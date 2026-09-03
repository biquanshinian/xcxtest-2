const pageBase = require('../../utils/page-base.js')
const spaceApi = require('./space-api')
const { beijingDateStr, beijingYear, buildAstroEvents, buildAstroEventsCovering } = require('./astro-events.js')

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
    astroYear: beijingYear(),
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
    this._astroRemindCheckedYear = beijingYear()
  },

  onShow() {
    const year = beijingYear()
    this._classifyEvents()
    if (year !== this._astroRemindCheckedYear) {
      this._astroRemindCheckedYear = year
      this._checkTodayReminders()
    }
  },

  _classifyEvents() {
    const today = beijingDateStr()
    const year = beijingYear()
    const events = buildAstroEvents(year)
    const reminded = loadReminders()
    const upcoming = events.filter(e => e.date >= today).map(e => ({
      ...e,
      reminded: !!reminded[e.date + '_' + e.title]
    }))
    const past = events.filter(e => e.date < today).reverse()
    this.setData({ astroYear: year, events, upcomingEvents: upcoming, pastEvents: past })
  },

  _checkTodayReminders() {
    const today = beijingDateStr()
    const tomorrow = beijingDateStr(Date.now() + 86400000)
    const reminded = loadReminders()
    const events = buildAstroEventsCovering([today, tomorrow])
    const todayEvents = events.filter(e => {
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
