const pageBase = require('../../utils/page-base.js')

Page({
  behaviors: [pageBase],
  _fallbackTab: '/pages/monitor/monitor',
  data: {
    loading: true,
    errorMessage: '',
    serial: '',
    missions: [],
    discussionTopic: '',
    navTitle: '历史任务',
    statusBarHeight: 44,
    navPlaceholderHeight: 0,
    menuButtonWidth: 88
  },

  onLoad(options) {
    this.initUiShell()
    var serial = options.serial ? decodeURIComponent(options.serial) : ''
    var currentLaunchId = options.currentLaunchId ? decodeURIComponent(options.currentLaunchId) : ''

    if (!serial) {
      this.setData({ loading: false, errorMessage: '缺少助推器参数，请返回重试' })
      return
    }

    this.setData({
      serial: serial,
      navTitle: serial + ' 历史任务',
      discussionTopic: serial + ' 助推器讨论'
    })
    this.loadHistory(serial, currentLaunchId)
  },

  loadHistory(serial, currentLaunchId) {
    var self = this
    var db = wx.cloud.database()
    var docId = serial.replace(/[^a-zA-Z0-9_-]/g, '_')

    db.collection('booster_genealogy').doc(docId).get().then(function (res) {
      var history = (res && res.data && Array.isArray(res.data.flightHistory)) ? res.data.flightHistory : []
      if (history.length === 0) {
        self.setData({ loading: false, errorMessage: '暂无 ' + serial + ' 的历史任务数据' })
        return
      }

      var missions = []
      for (var i = 0; i < history.length; i++) {
        var h = history[i]
        if (!h || !h.date) continue
        var isFailed = h.success === false
        var missionId = h.launchId || h.id || ''
        if (missionId && currentLaunchId && String(missionId) === String(currentLaunchId)) continue

        missions.push({
          id: missionId,
          name: h.mission || h.name || '未知任务',
          net: h.date || '',
          date: self._fmtDate(h.date),
          statusText: isFailed ? '失败' : '成功',
          statusClass: isFailed ? 'fail' : 'success',
          statusIcon: isFailed ? '✗' : '✓',
          hasDetailLink: !!missionId,
          seq: 0
        })
      }

      // 按时间正序编号（第 N 次飞行），再倒序展示
      missions.sort(function (a, b) { return (a.net || '').localeCompare(b.net || '') })
      for (var j = 0; j < missions.length; j++) missions[j].seq = j + 1
      missions.reverse()

      self.setData({ loading: false, missions: missions })
    }).catch(function () {
      self.setData({ loading: false, errorMessage: '数据加载失败，请稍后重试' })
    })
  },

  onMissionTap(e) {
    var item = e.currentTarget.dataset.item
    if (!item || !item.id) return
    wx.navigateTo({
      url: '/pages/mission-detail/mission-detail?id=' + item.id + '&type=completed'
    })
  },

  _fmtDate(d) {
    if (!d) return '—'
    try {
      var dt = new Date(d)
      if (isNaN(dt.getTime())) return d
      return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0')
    } catch (e) { return d }
  },

  onShareAppMessage() {
    return {
      title: this.data.serial + ' 历史任务 | 火星探索日志',
      path: '/subpackages/monitor-pages/booster-history?serial=' + encodeURIComponent(this.data.serial)
    }
  },

  onShareTimeline() {
    return {
      title: this.data.serial + ' 历史任务 | 火星探索日志',
      query: 'serial=' + encodeURIComponent(this.data.serial)
    }
  }
})
