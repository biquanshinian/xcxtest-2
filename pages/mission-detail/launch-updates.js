const pageBase = require('../../utils/page-base.js')
const { fetchLl2LaunchUpdates } = require('../../utils/api-app-services.js')
const { mapRawUpdatesToLaunchUpdates } = require('./utils/api-launch-detail.js')
const { togglePageTranslation } = require('./utils/text-translate.js')
const { ROUTES } = require('../../utils/routes.js')
const {
  checkShareEntryGate,
  warmShareEntitlement,
  withShareStampPath,
  withShareStampQuery
} = require('./utils/share-gate.js')

const LAUNCH_UPDATES_PRODUCT_ID = 'launch_updates'
const LAUNCH_UPDATES_PRODUCT_NAME = '发射动态'

function safeDecode(value) {
  const str = value == null ? '' : String(value)
  if (!str) return ''
  try {
    return decodeURIComponent(str)
  } catch (e) {
    return str
  }
}

function buildShareQuery(launchId, missionName) {
  const parts = []
  if (launchId) parts.push('id=' + encodeURIComponent(launchId))
  if (missionName) parts.push('name=' + encodeURIComponent(String(missionName).slice(0, 80)))
  return parts.join('&')
}

Page({
  behaviors: [pageBase],
  _fallbackTab: '/pages/index/index',
  _launchId: '',

  data: {
    loading: true,
    errorMessage: '',
    navTitle: '发射动态',
    missionName: '',
    updates: [],
    translatedComments: [],
    descTranslated: false,
    descTranslating: false,
    shareTitle: '发射动态 | 火星探索日志',
    shareGateExpireAt: 0,
    isMomentsPreview: false,
    statusBarHeight: 44,
    navPlaceholderHeight: 0,
    tabBarReservedHeight: 0,
    menuButtonWidth: 88
  },

  async onLoad(options) {
    this.initUiShell()
    this.applyMomentsPreviewLayout()

    const id = safeDecode(options && options.id).trim()
    const name = safeDecode(options && options.name).trim()
    this._launchId = id

    // 分享卡片 24h 免门控；过期后走 gateCheck（Pro 放行）
    const shareAllowed = await checkShareEntryGate(
      this,
      options,
      LAUNCH_UPDATES_PRODUCT_ID,
      LAUNCH_UPDATES_PRODUCT_NAME
    )
    if (!shareAllowed) {
      this.setData({
        loading: false,
        errorMessage: '分享链接已过期，开通星际通行证后可继续查看',
        missionName: name
      })
      return
    }
    warmShareEntitlement(this, LAUNCH_UPDATES_PRODUCT_ID)

    if (!this.data.isMomentsPreview) {
      try {
        wx.showShareMenu({
          withShareTicket: true,
          menus: ['shareAppMessage', 'shareTimeline']
        })
      } catch (_) {}
    }

    if (!id) {
      this.setData({
        loading: false,
        errorMessage: '缺少任务 ID',
        missionName: name
      })
      return
    }

    const patch = { missionName: name }
    if (name) {
      patch.shareTitle = name + ' · 发射动态 | 火星探索日志'
    }
    this.setData(patch)

    // 从任务详情带入已有列表，首屏可立刻展示
    try {
      const channel = this.getOpenerEventChannel && this.getOpenerEventChannel()
      if (channel && typeof channel.on === 'function') {
        channel.on('init', (payload) => {
          const list = payload && Array.isArray(payload.updates) ? payload.updates : []
          const missionName = (payload && payload.missionName) || this.data.missionName
          if (!list.length) return
          if (this._launchId !== id) return
          this.setData({
            loading: false,
            errorMessage: '',
            updates: list,
            missionName: missionName || this.data.missionName,
            shareTitle: (missionName || name || '发射任务') + ' · 发射动态 | 火星探索日志',
            descTranslated: false,
            translatedComments: []
          })
        })
      }
    } catch (_) {}

    this.loadUpdates(id, { keepExisting: true })
  },

  applyMomentsPreviewLayout() {
    try {
      const launchInfo = wx.getLaunchOptionsSync()
      if (!launchInfo || launchInfo.scene !== 1154) return
      const app = getApp()
      const layout = (app && app.getUiShellLayout && app.getUiShellLayout()) || {}
      const safeBottom = Number(layout.safeBottomInset) || 0
      this.setData({
        isMomentsPreview: true,
        tabBarReservedHeight: 52 + safeBottom
      })
    } catch (_) {}
  },

  loadUpdates(launchId, options) {
    const id = String(launchId || this._launchId || '').trim()
    const keepExisting = !!(options && options.keepExisting)
    if (!id) {
      this.setData({ loading: false, errorMessage: '缺少任务 ID' })
      return
    }

    if (!keepExisting || !this.data.updates.length) {
      this.setData({ loading: true, errorMessage: '' })
    }

    fetchLl2LaunchUpdates(id, 15)
      .then((res) => {
        if (this._launchId !== id) return
        const list = res && Array.isArray(res.list) ? res.list : []
        const mapped = mapRawUpdatesToLaunchUpdates(list)
        const resolvedName = (res && res.resolvedLaunchName) || this.data.missionName
        const next = {
          loading: false,
          errorMessage: '',
          updates: mapped,
          descTranslated: false,
          translatedComments: []
        }
        if (resolvedName) {
          next.missionName = resolvedName
          next.shareTitle = resolvedName + ' · 发射动态 | 火星探索日志'
        }
        if (keepExisting && this.data.updates.length > mapped.length) {
          this.setData({ loading: false, errorMessage: '' })
          return
        }
        this.setData(next)
      })
      .catch((err) => {
        if (this._launchId !== id) return
        if (keepExisting && this.data.updates.length) {
          this.setData({ loading: false, errorMessage: '' })
          return
        }
        this.setData({
          loading: false,
          errorMessage: (err && err.message) || '发射动态加载失败'
        })
      })
  },

  retryLoad() {
    this.loadUpdates(this._launchId, { keepExisting: false })
  },

  onToggleTranslate() {
    const updates = Array.isArray(this.data.updates) ? this.data.updates : []
    const fields = updates.map((u, i) => ({
      path: 'translatedComments[' + i + ']',
      text: u && u.comment
    }))
    togglePageTranslation(this, {
      switchKey: 'descTranslated',
      loadingKey: 'descTranslating',
      fields
    })
  },

  copyLink(e) {
    const url = e.currentTarget.dataset.url
    if (!url) return
    const data = String(url)
    const doCopy = function () {
      wx.setClipboardData({
        data: data,
        success: function () { wx.showToast({ title: '链接已复制', icon: 'success' }) },
        fail: function () { wx.showModal({ title: '链接', content: data, showCancel: false }) }
      })
    }
    if (wx.requirePrivacyAuthorize) {
      wx.requirePrivacyAuthorize({ success: doCopy, fail: doCopy })
    } else {
      doCopy()
    }
  },

  onShareAppMessage() {
    const id = this._launchId
    const name = this.data.missionName
    const query = buildShareQuery(id, name)
    const base = ROUTES.LAUNCH_UPDATES + (query ? '?' + query : '')
    return {
      title: this.data.shareTitle || '发射动态 | 火星探索日志',
      path: withShareStampPath(base, this),
      imageUrl: ''
    }
  },

  onShareTimeline() {
    return {
      title: this.data.shareTitle || '发射动态 | 火星探索日志',
      query: withShareStampQuery(buildShareQuery(this._launchId, this.data.missionName), this),
      imageUrl: ''
    }
  }
})
