/**
 * 首页低频 UX：演示模式 / 隐私与续费 / 分享面板 / 公告关闭 / 入口跳转
 * 主包 index.js 通过 require.async + attachTo 委托加载
 */
const { startDemo } = require('../../../utils/demo-engine.js')
const { resolveMissionRocketImage } = require('../../../utils/util.js')
const { ROUTES } = require('../../../utils/routes.js')
const {
  resolveMissionSharePayload
} = require('../../../utils/index-mission-nav.js')

const methods = {
  closeAnnouncementBanner() {
    if (this.data.missionSwipeOpenWxkey) this.closeMissionSwipeCells()
    this.setData({ announcementBanner: null })
  },

  closeAnnouncementDetail() {
    this.setData({ announcementDialogVisible: false })
  },

  /** 首页放大镜：直达星问详情（智能搜索能力已并入星问） */
  openAISearch() {
    this.closeMissionSwipeCells()
    const { isAIAvailable } = require('../../../utils/aiService.js')
    const { isFeatureEnabled } = require('../../../utils/feature-flags.js')
    if (!isAIAvailable()) {
      wx.showToast({ title: '星问AI暂未开放', icon: 'none' })
      return
    }
    isFeatureEnabled('enableAIChat', { failClosed: true }).then((on) => {
      if (!on) {
        wx.showToast({ title: '星问AI暂未开放', icon: 'none' })
        return
      }
      wx.navigateTo({
        url: ROUTES.AI_CHAT,
        fail: () => {
          wx.showToast({ title: '打开星问失败', icon: 'none' })
        }
      })
    }).catch(() => {
      wx.showToast({ title: '星问AI暂未开放', icon: 'none' })
    })
  },

  openShop() {
    wx.showToast({ title: '筹备中，敬请期待', icon: 'none' })
  },

  _initDemoMode() {
    const app = getApp && getApp()
    if (!app) return
    if (this._demoInited) return
    this._demoInited = true

    const tryInit = (retries) => {
      const { isLiveAccount: isLive, isInitDone } = require('../../../utils/demo-engine.js')

      if (!isInitDone()) {
        if (retries > 0) {
          setTimeout(() => tryInit(retries - 1), 2000)
        }
        return
      }

      const live = isLive()

      if (live) {
        this.setData({ _isDemoLiveAccount: true })
        const overlay = this.selectComponent('#demoOverlay')
        if (overlay) {
          overlay.startRemoteControl()
        } else {
          console.warn('[Index] DemoMode overlay component not found')
        }
      }
    }

    // 演示引擎在 app.js 里 3s 后初始化，这里 5s 后开始检查，最多重试 5 次
    setTimeout(() => tryInit(5), 5000)
  },

  onDemoRemoteStart(e) {
    const scriptName = (e.detail && e.detail.scriptName) || 'fullTour'
    startDemo(this, scriptName)
  },

  onDemoStop() {
    // 演示结束，可以做一些清理
  },

  _maybePromptPrivacy() {
    const app = getApp()
    if (!app || app._privacyPromptedThisSession) return
    app._privacyPromptedThisSession = true
    const check =
      app.globalData && app.globalData.needPrivacyAuthorization
        ? Promise.resolve({ needAuthorization: true })
        : typeof app.updatePrivacySettingCache === 'function'
          ? app.updatePrivacySettingCache()
          : Promise.resolve({})
    check
      .then((res) => {
        if (res && res.needAuthorization && typeof app.ensurePrivacyAuthorized === 'function') {
          app.ensurePrivacyAuthorized().then(() => {
            // 隐私弹窗关闭后接力被错峰跳过的弹窗：太空简报优先，未弹则判定续费提醒
            setTimeout(() => this._resumeDeferredPopups(), 400)
          })
        }
      })
      .catch(() => {})
  },

  _resumeDeferredPopups() {
    let briefingShown = false
    try {
      const comp = this.selectComponent('#morningBriefing')
      if (comp && typeof comp._maybeAutoShowPopup === 'function') {
        briefingShown = !!comp._maybeAutoShowPopup(true)
      }
    } catch (e) {}
    // 简报弹出时续费提醒由其 closed 事件接力；否则这里直接判定
    if (!briefingShown) {
      this._tryShowRenewalReminder()
    }
  },

  onMissionShareTap() {
    // 分享由 open-type="share" 自动处理
  },

  onMissionLongPress(e) {
    var ds = (e && e.currentTarget && e.currentTarget.dataset) || {}
    var id = ds.id == null ? '' : String(ds.id).trim()
    if (!id) return

    // 中度震动反馈
    try {
      wx.vibrateShort({ type: 'medium' })
    } catch (_) {
      try {
        wx.vibrateShort()
      } catch (__) {}
    }

    var detailType = ds.type === 'completed' ? 'completed' : 'upcoming'
    this.setData({
      shareSheetVisible: true,
      pendingShareMission: {
        id: id,
        detailType: detailType,
        missionName: ds.name || '',
        rocketName: ds.rocket || ''
      }
    })

    // 同步预下载该任务卡片的火箭图，确保长按面板分享时缩略图能加载
    var sharePayload = resolveMissionSharePayload(this.data, { id: id, detailType: detailType })
    var targetMission = sharePayload && sharePayload.mission
    var targetImage = targetMission && (targetMission.rocketImage || targetMission.image)
    if (targetImage) {
      this.ensureShareImageHttpUrl(
        resolveMissionRocketImage(targetImage, targetMission.rocketName, targetMission.rocketConfiguration)
      )
    }
  },

  onShareSheetClose() {
    if (!this.data.shareSheetVisible) return
    this.setData({ shareSheetVisible: false })
  },

  onShareSheetItemTap() {
    this.setData({ shareSheetVisible: false })
  },

  onShareBriefing(e) {
    // 分享由 button open-type="share" 触发，走 onShareAppMessage
  },

  onBriefingClosed() {
    this._tryShowRenewalReminder()
  },

  onRenewalClosed() {
    this._tryShowNetChangeModal()
  },

  _isIndexPageCurrent() {
    try {
      const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : []
      const top = pages.length ? pages[pages.length - 1] : null
      const route = top && top.route != null ? String(top.route).replace(/^\//, '') : ''
      return route === 'pages/index/index'
    } catch (e) {
      return false
    }
  },

  /**
   * 首页弹窗占屏：冲突时无感让路，不叠层。
   * wait = 等对方 closed / 隐私收尾接力，不重试、不消耗冷启动名额
   * retry = 开屏/列表/不在首页等短暂态，稍后静默再试
   */
  _getHomePopupBlock(opts) {
    try {
      const appInst = getApp()
      if (appInst && appInst.globalData && appInst.globalData.needPrivacyAuthorization) {
        return 'wait'
      }
    } catch (e) {}
    if (this.data && (this.data.splashVisible || this.data.splashFading)) return 'retry'
    if (!this._isIndexPageCurrent()) return 'retry'
    if (this.data && this.data.announcementDialogVisible) return 'retry'
    if (this.data && this.data.shareSheetVisible) return 'retry'
    try {
      const briefing = this.selectComponent('#morningBriefing')
      if (briefing && briefing.data && briefing.data.showPopup) return 'wait'
    } catch (e) {}
    try {
      const renewal = this.selectComponent('#renewalReminder')
      if (renewal && (renewal._inflight || (renewal.data && renewal.data.visible))) return 'wait'
    } catch (e) {}
    if (!(opts && opts.ignoreNetChange)) {
      try {
        const netChange = this.selectComponent('#netChangeModal')
        if (netChange && ((netChange.data && netChange.data.visible) || netChange._opening)) return 'wait'
      } catch (e) {}
    }
    return ''
  },

  _tryShowRenewalReminder() {
    try {
      const block = this._getHomePopupBlock()
      if (block === 'wait') return
      if (block === 'retry') {
        this._scheduleHomePopupQueueRetry()
        return
      }
      const comp = this.selectComponent('#renewalReminder')
      if (!comp || typeof comp.maybeShow !== 'function') {
        this._tryShowNetChangeModal()
        return
      }
      if (comp._inflight || (comp.data && comp.data.visible)) return
      const self = this
      const p = comp.maybeShow(function () {
        return self._getHomePopupBlock() === 'wait'
      })
      Promise.resolve(p)
        .then(function (shown) {
          if (shown) return
          if (self._getHomePopupBlock() === 'wait') return
          self._tryShowNetChangeModal()
        })
        .catch(function () {
          if (self._getHomePopupBlock() === 'wait') return
          self._tryShowNetChangeModal()
        })
    } catch (e) {
      this._tryShowNetChangeModal()
    }
  },

  _scheduleHomePopupQueueRetry() {
    if (this._homePopupRetryTimer) return
    if (this._homePopupRetryLeft == null) this._homePopupRetryLeft = 10
    if (this._homePopupRetryLeft <= 0) return
    this._homePopupRetryLeft -= 1
    const self = this
    this._homePopupRetryTimer = setTimeout(function () {
      self._homePopupRetryTimer = null
      self._tryShowRenewalReminder()
    }, 1200)
  },

  _scheduleNetChangeColdStartRetry() {
    if (this._netChangeRetryTimer) return
    if (this._netChangeRetryLeft == null) this._netChangeRetryLeft = 10
    if (this._netChangeRetryLeft <= 0) return
    this._netChangeRetryLeft -= 1
    const self = this
    this._netChangeRetryTimer = setTimeout(function () {
      self._netChangeRetryTimer = null
      self._tryShowNetChangeModal()
    }, 1200)
  },

  _prewarmNetChangeScan() {
    try {
      const comp = this.selectComponent('#netChangeModal')
      if (comp && typeof comp.prewarm === 'function') comp.prewarm()
    } catch (e) {}
  },

  _tryShowNetChangeModal() {
    try {
      const appInst = getApp()
      if (!appInst || !appInst._netChangeColdStartPending) return
      const block = this._getHomePopupBlock()
      if (block === 'wait') return
      if (block === 'retry') {
        this._scheduleNetChangeColdStartRetry()
        return
      }
      const comp = this.selectComponent('#netChangeModal')
      if (!comp || typeof comp.maybeShow !== 'function') {
        this._scheduleNetChangeColdStartRetry()
        return
      }
      if (typeof comp.isDevMode === 'function' && comp.isDevMode()) return
      if (appInst._netChangeModalLock) return
      appInst._netChangeModalLock = true
      const self = this
      Promise.resolve(
        comp.maybeShow(function () {
          return self._getHomePopupBlock({ ignoreNetChange: true }) === 'wait'
        })
      )
        .then(function (shown) {
          if (comp && comp._lastScanBlocked) return
          // 已弹出，或服务号同源行已到达且确认无待弹 → 结束本进程
          if (shown || (comp && comp._lastScanFromServer && comp._lastScanServerCount > 0)) {
            appInst._netChangeColdStartPending = false
            return
          }
          // launch_data 尚未打标 / 拉取失败：保留名额，等队列下一轮再扫
          self._scheduleNetChangeColdStartRetry()
        })
        .catch(function () {
          self._scheduleNetChangeColdStartRetry()
        })
        .then(function () {
          appInst._netChangeModalLock = false
        })
    } catch (e) {}
  },

  ensureShareImageHttpUrl(imageUrl) {
    if (!imageUrl || typeof imageUrl !== 'string') return
    var trimmed = imageUrl.trim()
    if (!trimmed) return
    // 已经是本地临时路径：直接写入，无需再下载
    if (trimmed.startsWith('wxfile://') || /^http:\/\/tmp/.test(trimmed)) {
      if (this.data.shareImage !== trimmed) this.setData({ shareImage: trimmed })
      return
    }
    // 命中缓存：URL 没变 + 本地路径已就绪
    if (this._shareImageSourceUrl === trimmed && this.data.shareImage) return
    this._shareImageSourceUrl = trimmed

    var self = this
    wx.getImageInfo({
      src: trimmed,
      success: function (res) {
        // 下载完成期间用户可能已经切换到了别的任务，这里用 _shareImageSourceUrl 做校验
        if (res && res.path && self._shareImageSourceUrl === trimmed) {
          self.setData({ shareImage: res.path })
        }
      },
      fail: function () {
        // 下载失败时清掉缓存标记，允许下次重试
        if (self._shareImageSourceUrl === trimmed) {
          self._shareImageSourceUrl = ''
        }
      }
    })
  }
}

function attachTo(page) {
  page.__uxMethods = methods
  Object.assign(page, methods)
  page.__uxAttached = true
}

module.exports = { attachTo, methods }
