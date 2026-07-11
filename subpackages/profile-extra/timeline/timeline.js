const { getTimeline, backfillTimeline, MILESTONE_TYPES } = require('../../../utils/user-growth.js')
const { drawTimelinePoster, canvasToTempFile } = require('../utils/poster-canvas.js')
const { getUiShellLayout } = require('../../../utils/layout.js')
const { getThemeClassSync, isLightSync, getPageBgSync } = require('../../../utils/theme.js')
const { getCheckinSummary, checkAchievements } = require('../utils/checkin.js')
const { getSubscribedMissions } = require('../../../utils/subscribe.js')
const { getAllStats } = require('../../../utils/behavior-stats.js')
const { getMyVoteResults } = require('../../../utils/api-app-services.js')
const { getMembershipState, isPro, MEMBER_ICONS } = require('../../../utils/membership.js')
const storageCache = require('../../../utils/storage-sync-cache.js')

const USER_NICKNAME_KEY = '_user_nickname'
const USER_ID_DISPLAY_KEY = '_user_id_display'

Page({
  data: {
    statusBarHeight: 44,
    navPlaceholderHeight: 0,
    themeClass: '',
    themeLight: false,
    pageBgColor: '#000000',
    timeline: [],
    empty: false,
    generating: false,
    nickname: '',
    userId: ''
  },

  onLoad() {
    var layout = getUiShellLayout()
    this.setData({
      statusBarHeight: layout.statusBarHeight,
      navPlaceholderHeight: layout.navPlaceholderHeight,
      themeClass: getThemeClassSync(),
      themeLight: isLightSync(),
      pageBgColor: getPageBgSync()
    })

    var self = this
    setTimeout(function () {
      var nickname = storageCache.readSync(USER_NICKNAME_KEY, '') || ''
      var userId = storageCache.readSync(USER_ID_DISPLAY_KEY, '') || ''
      self.setData({ nickname: nickname, userId: userId })

      if (!userId && wx.cloud) {
        try {
          wx.cloud.callFunction({
            name: 'membership',
            data: { action: 'getOpenid' }
          }).then(function (res) {
            var openid = (res.result && res.result.openid) || ''
            var displayId = ''
            if (openid.length > 12) {
              displayId = openid.slice(0, 8) + '...' + openid.slice(-4)
            } else {
              displayId = openid || ''
            }
            if (displayId) {
              storageCache.persistAsync(USER_ID_DISPLAY_KEY, displayId)
              self.setData({ userId: displayId })
            }
          }).catch(function () {})
        } catch (e) {}
      }

      backfillTimeline()
      self._loadTimeline()
    }, 0)
  },

  _loadTimeline() {
    var raw = getTimeline()
    var timeline = raw.map(function (item) {
      var def = MILESTONE_TYPES[item.type] || {}
      return {
        type: item.type,
        name: def.name || item.type,
        desc: def.desc || '',
        icon: def.icon || 'rocket',
        timestamp: item.timestamp,
        timeText: formatRelativeTime(item.timestamp),
        meta: item.meta || {}
      }
    })
    this.setData({
      timeline: timeline,
      empty: timeline.length === 0
    })
  },

  onNicknameInput(e) {
    this.setData({ nickname: e.detail.value })
  },

  onNicknameSave() {
    var nickname = (this.data.nickname || '').trim()
    if (nickname) {
      storageCache.persistAsync(USER_NICKNAME_KEY, nickname)
    }
  },

  async onGeneratePoster() {
    if (this.data.generating) return
    this.setData({ generating: true })

    var self = this
    var query = wx.createSelectorQuery()
    query.select('#posterCanvas')
      .fields({ node: true, size: true })
      .exec(async function (res) {
        if (!res || !res[0] || !res[0].node) {
          self.setData({ generating: false })
          wx.showToast({ title: '画布初始化失败', icon: 'none' })
          return
        }

        var canvas = res[0].node
        var width = 340
        var height = 560

        var checkin = getCheckinSummary()
        var achievements = checkAchievements()
        var subscriptions = getSubscribedMissions()
        var behaviorStats = getAllStats()

        // 竞猜战绩：与「我的太空」loadVoteStats 同一规则（不可使用接口可能不返回的 isCorrect）
        var voteTotal = 0
        var voteSettled = 0
        var voteCorrect = 0
        try {
          var serverResults = await getMyVoteResults()
          if (serverResults && serverResults.length > 0) {
            voteTotal = serverResults.length
            for (var vi = 0; vi < serverResults.length; vi++) {
              var vit = serverResults[vi]
              var result = (vit && vit.result) ? String(vit.result) : ''
              if (result) {
                voteSettled++
                if (vit.choice === result) voteCorrect++
              }
            }
          }
        } catch (e) {}
        var voteAccuracy = voteSettled > 0 ? Math.round(voteCorrect / voteSettled * 100) : 0

        var memberBadgeText = 'FREE'
        var memberBadgeIcon = MEMBER_ICONS.FREE
        try {
          var memberState = await getMembershipState()
          if (isPro(memberState)) {
            memberBadgeText = 'PRO'
            memberBadgeIcon = MEMBER_ICONS.PRO
          }
        } catch (e) {}

        var posterData = {
          nickname: self.data.nickname || '太空探索者',
          userId: self.data.userId || '',
          memberBadgeText: memberBadgeText,
          memberBadgeIcon: memberBadgeIcon,
          stats: {
            checkinDays: checkin.totalDays || 0,
            achievements: achievements.unlockedCount || 0,
            launches: self._countWitnessLaunches(),
            subscriptions: subscriptions.length || 0,
            voteTotal: voteTotal,
            voteSettled: voteSettled,
            voteCorrect: voteCorrect,
            voteAccuracy: voteAccuracy,
            newsRead: behaviorStats.newsReadCount || 0
          },
          milestones: self.data.timeline.slice(0, 5).map(function (m) {
            return { name: m.name, timestamp: m.timestamp }
          })
        }

        drawTimelinePoster(canvas, posterData, width, height).then(function () {
          setTimeout(function () {
            canvasToTempFile(canvas, width, height).then(function (path) {
              self.setData({ generating: false })
              wx.previewImage({ urls: [path], current: path })
            }).catch(function () {
              self.setData({ generating: false })
              wx.showToast({ title: '生成失败', icon: 'none' })
            })
          }, 300)
        })
      })
  },

  _countWitnessLaunches() {
    return this.data.timeline.filter(function (m) {
      return m.type === 'WITNESS_LAUNCH'
    }).length
  },

  goBack() {
    wx.navigateBack({ delta: 1 })
  }
})

function formatRelativeTime(ts) {
  if (!ts) return ''
  var diff = Date.now() - ts
  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前'
  if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前'
  if (diff < 2592000000) return Math.floor(diff / 86400000) + '天前'
  var d = new Date(ts)
  return d.getFullYear() + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + String(d.getDate()).padStart(2, '0')
}
