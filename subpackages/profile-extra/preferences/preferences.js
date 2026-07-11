const { loadPreferences, savePreferences, warmUserPreferencesSync, ROCKET_TYPE_OPTIONS, LAUNCH_SITE_OPTIONS } = require('../../../utils/user-growth.js')
const { getUiShellLayout } = require('../../../utils/layout.js')
const { getThemeClassSync, isLightSync, getPageBgSync } = require('../../../utils/theme.js')
function arrayToMap(arr) {
  var map = {}
  if (arr && arr.length) {
    for (var i = 0; i < arr.length; i++) {
      map[arr[i]] = true
    }
  }
  return map
}

Page({
  data: {
    statusBarHeight: 44,
    navPlaceholderHeight: 0,
    themeClass: '',
    themeLight: false,
    pageBgColor: '#000000',
    rocketOptions: ROCKET_TYPE_OPTIONS,
    siteOptions: LAUNCH_SITE_OPTIONS,
    notifyOptions: [
      { value: 30, label: '30分钟前' },
      { value: 60, label: '1小时前' },
      { value: 120, label: '2小时前' }
    ],
    selectedRockets: [],
    selectedSites: [],
    rocketMap: {},
    siteMap: {},
    notifyMinutes: 60,
    briefingEnabled: true,
    saving: false  },

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
      try { warmUserPreferencesSync() } catch (e) {}
      self._loadPrefs()
    }, 0)
  },

  _loadPrefs() {
    var prefs = loadPreferences()
    var rockets = prefs.rocketTypes || []
    var sites = prefs.launchSites || []
    this.setData({
      selectedRockets: rockets,
      selectedSites: sites,
      rocketMap: arrayToMap(rockets),
      siteMap: arrayToMap(sites),
      notifyMinutes: prefs.notifyMinutes || 60,
      briefingEnabled: prefs.briefingEnabled !== false    })
  },

  onToggleRocket(e) {
    var name = e.currentTarget.dataset.name
    var list = this.data.selectedRockets.slice()
    var map = Object.assign({}, this.data.rocketMap)
    var idx = list.indexOf(name)
    if (idx >= 0) {
      list.splice(idx, 1)
      delete map[name]
    } else {
      list.push(name)
      map[name] = true
    }
    this.setData({ selectedRockets: list, rocketMap: map })
  },

  onToggleSite(e) {
    var name = e.currentTarget.dataset.name
    var list = this.data.selectedSites.slice()
    var map = Object.assign({}, this.data.siteMap)
    var idx = list.indexOf(name)
    if (idx >= 0) {
      list.splice(idx, 1)
      delete map[name]
    } else {
      list.push(name)
      map[name] = true
    }
    this.setData({ selectedSites: list, siteMap: map })
  },

  onNotifyChange(e) {
    this.setData({ notifyMinutes: Number(e.currentTarget.dataset.value) || 60 })
  },

  onBriefingToggle(e) {
    this.setData({ briefingEnabled: !!e.detail.value })
  },

  onSave() {    if (this.data.saving) return
    this.setData({ saving: true })

    // 在现有 preferences 上合并保存，避免覆盖掉其它字段（如收藏 favoriteAgencies）
    var prefs = loadPreferences() || {}
    prefs.rocketTypes = this.data.selectedRockets
    prefs.launchSites = this.data.selectedSites
    prefs.notifyMinutes = this.data.notifyMinutes
    prefs.briefingEnabled = this.data.briefingEnabled
    savePreferences(prefs)
    var self = this
    // 保存后请求订阅消息授权（发射提醒 + 结果通知），确保后续自动匹配的提醒能发出去
    var tmplIds = [
      'T5J5sRh2UdEwFE7q_VTbdowA0PeXrz_3bUweWEL6uBs',
      'ulf34VqAS9Tj32BMqj4M1qudtKKy04iiBM7Qb9_VDb4'
    ]
    wx.requestSubscribeMessage({
      tmplIds: tmplIds,
      complete: function () {
        self.setData({ saving: false })
        wx.showToast({ title: '保存成功', icon: 'success' })
      }
    })
  },

  goBack() {
    wx.navigateBack({ delta: 1 })
  }
})
