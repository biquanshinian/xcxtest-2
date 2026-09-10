Component({
  properties: {
    boosterSerial: { type: String, value: '' },
    currentLaunchId: { type: String, value: '' },
    maxCollapsed: { type: Number, value: 2 },
    showTitle: { type: Boolean, value: true }
  },

  data: {
    loading: true,
    missions: [],
    displayMissions: [],
    hasMore: false
  },

  observers: {
    'boosterSerial': function (serial) {
      if (serial) this.loadHistory(serial)
    }
  },

  lifetimes: {
    attached() {
      // observer 在 attach 赋值时已触发，这里只兜底 observer 未触发的场景（loadHistory 内部会去重）
      if (this.properties.boosterSerial) {
        this.loadHistory(this.properties.boosterSerial)
      }
    }
  },

  methods: {
    loadHistory(boosterSerial) {
      if (!boosterSerial) return
      // attached + observer 双触发去重：同一 serial 正在加载则跳过
      if (this._loadingSerial === boosterSerial) return
      this._loadingSerial = boosterSerial
      // 递增 seq：serial 快速切换时丢弃旧响应，避免旧数据覆盖新 serial
      var seq = (this._loadSeq || 0) + 1
      this._loadSeq = seq
      this.setData({ loading: true, missions: [], displayMissions: [], hasMore: false })
      var self = this
      var db = wx.cloud.database()
      var docId = boosterSerial.replace(/[^a-zA-Z0-9_-]/g, '_')

      db.collection('booster_genealogy').doc(docId).get().then(function (res) {
        if (seq !== self._loadSeq) return
        self._loadingSerial = null
        self._processBoosterData(res && res.data)
      }).catch(function () {
        if (seq !== self._loadSeq) return
        self._loadingSerial = null
        self.setData({ loading: false, missions: [], hasMore: false })
      })
    },

    _processBoosterData(data) {
      var self = this
      if (!data || !Array.isArray(data.flightHistory) || data.flightHistory.length === 0) {
        self.setData({ loading: false, missions: [], hasMore: false })
        return
      }

      var history = data.flightHistory
      var allMissions = []
      var currentId = String(self.properties.currentLaunchId || '')

      for (var i = 0; i < history.length; i++) {
        var h = history[i]
        if (!h || !h.date) continue
        var isFailed = h.success === false
        var statusIcon = isFailed ? '✗' : '✓'
        var statusAbbrev = isFailed ? 'Failure' : 'Success'

        var missionId = h.launchId || h.id || ''
        if (missionId && String(missionId) === currentId) continue

        allMissions.push({
          id: missionId,
          name: h.mission || h.name || '未知任务',
          net: h.date || '',
          date: self._fmtDate(h.date),
          statusAbbrev: statusAbbrev,
          statusIcon: statusIcon,
          hasDetailLink: !!missionId
        })
      }

      allMissions.sort(function (a, b) { return (b.net || '').localeCompare(a.net || '') })

      var limit = self.properties.maxCollapsed || 2
      self.setData({
        loading: false,
        missions: allMissions,
        displayMissions: allMissions.slice(0, limit),
        hasMore: allMissions.length > limit
      })
    },

    toggleExpand() {
      // 跳转到历史任务详情页（替代原地展开）
      var serial = this.properties.boosterSerial
      if (!serial) return
      wx.navigateTo({
        url: '/subpackages/monitor-pages/booster-history?serial=' + encodeURIComponent(serial) + '&currentLaunchId=' + encodeURIComponent(this.properties.currentLaunchId || '')
      })
    },

    onMissionTap(e) {
      var item = e.currentTarget.dataset.item
      if (!item) return
      if (item.id) {
        wx.navigateTo({
          url: '/pages/mission-detail/mission-detail?id=' + item.id + '&type=completed'
        })
      }
    },

    _fmtDate(d) {
      if (!d) return '—'
      try {
        var dt = new Date(d)
        if (isNaN(dt.getTime())) return d
        return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0')
      } catch (e) { return d }
    }
  }
})
