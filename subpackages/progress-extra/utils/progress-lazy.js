/**
 * subpackages/progress-extra/utils/progress-lazy.js
 * 进展页纯用户触发的低频逻辑（从 pages/progress/progress.js 拆出）：
 * - 长按星舰卡片保存图片到相册
 * - 封路信息手动同步 / 密码验证 / 手动录入（运营兜底流程）
 *
 * 主包 progress.js 通过 require.async + attachTo 委托加载，
 * 与首页 index-vote / 监控页 monitor-pass 模式一致。
 * progress 页在 preloadRule 中预下载 progress-extra 分包，实际几乎无加载等待。
 */
const {
  syncRoadClosureFromCloud,
  verifyRoadClosurePassword,
  saveManualRoadClosureNotice
} = require('../../../utils/progress-road-closure.js') // 纯同步 helper，仍驻主包
const {
  saveImageToAlbum: saveImageToAlbumUtil,
  handleEventImageLongPress,
  closeEventImageSavePicker,
  toggleEventImageSaveSelect,
  selectAllEventImageSave,
  confirmEventImageSavePicker,
  parseLongPressDataset,
  previewEventImages
} = require('./event-image-save.js')

// ══ 事件动态 / LL2 折叠区依赖（原 progress.js 首屏后延迟加载逻辑） ══
const { fetchLl2LaunchUpdates, fetchLl2LaunchTimeline } = require('../../../utils/api-app-services.js')
const { normalizeLl2TimelineList } = require('./ll2-launch-timeline.js')
const { formatCloudError } = require('../../../utils/launch-stats-cloud.js')
const { getCachedMediaImage } = require('../../../utils/icon-cache.js')
const { enrichVideoMediaItem, eventVideoAdUnlockId, playEventVideo, saveEventOriginalVideo } = require('./event-video.js')
const { resolveTweetAccountAvatarUrl, resolveEventAuthorAvatarUrl } = require('../../shared/utils/event-share-image.js')
const { warmEventShareImage } = require('../../../utils/event-share-image.js')
try { warmEventShareImage() } catch (e) {}
const { fetchLiveStatusBatch, parseLiveStatus } = require('./live-status.js')
const { isLiveEntryAllowed } = require('../../../utils/feature-flags.js')
const { isPermissionDenied, getPermissionDeniedMessage } = require('./single-page.js')
const { gateCheck, isProSync, isMembershipEnabled, canUsePaidCloudSync, canPrefetchVideoSync, canSaveOriginalVideoSync } = require('../../../utils/membership.js')
const { getMemberPolicy } = require('../../../utils/member-policy.js')
const { isVideoUrl } = require('../../../utils/cos-url.js')
const { runPullRefresh } = require('../../../utils/pull-refresh.js')
const { ROUTES, navigateTo } = require('../../../utils/routes.js')
const storageCache = require('../../../utils/storage-sync-cache.js')

/** 事件列表直播状态批量查询延后，避免与首屏 DB 查询抢带宽 */
const PROGRESS_LIVE_STATUS_DEFER_MS = 600

/** LL2 自动解析星舰发射失败时的可读文案 */
function formatLl2AutoError(message) {
  const m = String(message || '')
  if (m === 'no_starship_launch') {
    return 'LL2 上暂未找到火箭配置为「Starship」的发射（已查 upcoming / previous）。可稍后下拉刷新，或在后台手动填写发射 UUID。'
  }
  return formatCloudError(new Error(m))
}

const methods = {
  saveImageToAlbum(imageUrl, opts) {
    return saveImageToAlbumUtil(imageUrl, opts)
  },

  async onSyncRoadClosure() {
    if (this.data.roadClosureSyncing) return
    this.setData({ roadClosureSyncing: true })

    try {
      await syncRoadClosureFromCloud()
    } catch (e) {
    }

    await this.loadRoadClosureNotice()

    // 第三步：如果仍无数据，提示用户手动录入
    if (!this.data.roadClosure.isActive) {
      this.setData({ roadClosureSyncing: false })
      wx.showModal({
        title: '自动抓取暂不可用',
        content: '无法从 starbase.texas.gov 获取数据。是否手动录入当前封路信息？',
        confirmText: '手动录入',
        cancelText: '取消',
        success: (res) => {
          if (res.confirm) {
            this.showManualRoadClosureInput()
          }
        }
      })
      return
    }

    wx.showToast({ title: '同步成功', icon: 'success' })
    this.setData({ roadClosureSyncing: false })
  },

  async showManualRoadClosureInput() {
    const that = this
    wx.showModal({
      title: '需要验证',
      editable: true,
      placeholderText: '请输入操作密码',
      async success(res) {
        if (!res.confirm) return
        const input = (res.content || '').trim()
        if (!input) {
          wx.showToast({ title: '请输入密码', icon: 'none' })
          return
        }
        try {
          const verified = await verifyRoadClosurePassword(input)
          if (verified) {
            that.showRoadClosureForm()
          } else {
            wx.showToast({ title: '密码错误', icon: 'none' })
          }
        } catch (e) {
          wx.showToast({ title: '验证失败，请重试', icon: 'none' })
        }
      }
    })
  },

  showRoadClosureForm() {
    const that = this
    let inputMsg = ''
    let inputTime = ''

    wx.showModal({
      title: '星舰基地封路通知内容',
      editable: true,
      placeholderText: '如：Boca Chica Beach 已关闭',
      success(res) {
        if (!res.confirm) return
        inputMsg = (res.content || '').trim()
        if (!inputMsg) {
          wx.showToast({ title: '内容不能为空', icon: 'none' })
          return
        }

        wx.showModal({
          title: '时间范围（可选）',
          editable: true,
          placeholderText: '如：Mar. 9 8:00 AM - 8:00 PM',
          success(res2) {
            inputTime = (res2.content || '').trim()
            that.saveManualRoadClosure(inputMsg, inputTime)
          }
        })
      }
    })
  },

  async saveManualRoadClosure(message, timeRange) {
    try {
      wx.showLoading({ title: '保存中...' })
      await saveManualRoadClosureNotice(message, timeRange)
      wx.hideLoading()
      await this.loadRoadClosureNotice()
      wx.showToast({ title: '保存成功', icon: 'success' })
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: '保存失败: ' + (e.errMsg || e.message || ''), icon: 'none' })
    }
  },

  loadLl2LaunchUpdates() {
    // in-flight 去重：starship 状态加载与首屏下方延迟调度两条路径可能各触发一次
    if (this._ll2UpdatesInflight) return this._ll2UpdatesInflight
    this._ll2UpdatesInflight = this._doLoadLl2LaunchUpdates().finally(() => {
      this._ll2UpdatesInflight = null
    })
    return this._ll2UpdatesInflight
  },

  async _doLoadLl2LaunchUpdates() {
    const manualId = String(this.data.ll2TrackedLaunchId || '').trim()
    const enabled = this.data.showLaunchLibraryUpdates !== false
    const autoStarship = !manualId
    if (!enabled) {
      this.setData({
        ll2LaunchUpdates: [],
        ll2LaunchUpdatesLoading: false,
        ll2LaunchUpdatesError: ''
      })
      return
    }
    this.setData({ ll2LaunchUpdatesLoading: true, ll2LaunchUpdatesError: '' })
    try {
      const res = await fetchLl2LaunchUpdates(manualId, 15, { autoStarship })
      const list = (res.list || []).map((item) => ({
        ...item,
        timeLabel: this.formatEventTime(item.createdOn)
      }))
      this.setData({
        ll2LaunchUpdates: list,
        ll2LaunchUpdatesLoading: false,
        ll2LaunchUpdatesError: ''
      })
    } catch (e) {
      const raw = (e && e.message) ? String(e.message) : '加载失败'
      this.setData({
        ll2LaunchUpdates: [],
        ll2LaunchUpdatesLoading: false,
        ll2LaunchUpdatesError: formatLl2AutoError(raw)
      })
    }
  },

  onRefreshLl2LaunchUpdates() {
    if (this.data.ll2LaunchUpdatesLoading) return
    this.loadLl2LaunchUpdates()
  },

  loadLl2LaunchTimeline() {
    if (this._ll2TimelineInflight) return this._ll2TimelineInflight
    this._ll2TimelineInflight = this._doLoadLl2LaunchTimeline().finally(() => {
      this._ll2TimelineInflight = null
    })
    return this._ll2TimelineInflight
  },

  async _doLoadLl2LaunchTimeline() {
    const manualId = String(this.data.ll2TrackedLaunchId || '').trim()
    const enabled = this.data.showLaunchLibraryUpdates !== false
    const autoStarship = !manualId
    if (!enabled) {
      this.setData({
        ll2TimelineRows: [],
        ll2TimelineLoading: false,
        ll2TimelineError: ''
      })
      return
    }
    this.setData({ ll2TimelineLoading: true, ll2TimelineError: '' })
    try {
      const res = await fetchLl2LaunchTimeline(manualId, { autoStarship })
      const rows = normalizeLl2TimelineList(res.timeline || [])
      this.setData({
        ll2TimelineRows: rows,
        ll2TimelineLoading: false,
        ll2TimelineError: ''
      })
    } catch (e) {
      const raw = (e && e.message) ? String(e.message) : '加载失败'
      this.setData({
        ll2TimelineRows: [],
        ll2TimelineLoading: false,
        ll2TimelineError: formatLl2AutoError(raw)
      })
    }
  },

  onRefreshLl2Timeline() {
    if (this.data.ll2TimelineLoading) return
    this.loadLl2LaunchTimeline()
  },

  async loadEventVideoConfig() {
    try {
      // 走 feature-flags 的 global_config 共享缓存（5 分钟 + inflight 去重），
      // 避免每次进页直读一次云库同一文档；fail-closed，读不到配置不放出视频
      const { isPlaybackAllowed } = require('../../../utils/feature-flags.js')
      const enabled = await isPlaybackAllowed()
      this.setData({ enableEventVideo: enabled })
    } catch (e) {}
  },

  _loadTweetAccountStats() {
    var self = this
    if (!wx.cloud) return
    var canShowChips = canUsePaidCloudSync()
    // 非会员不展示账号胶囊，但仍拉今日总数供标题红角标
    if (!canShowChips && (this.data.tweetAccountStats || []).length) {
      this.setData({ tweetAccountStats: [] })
    }
    // 推文统计为当日聚合数据，10 分钟内进页复用缓存，不重复打云函数
    var TTL = 10 * 60 * 1000
    var now = Date.now()
    var cached = this._tweetStatsCache
    if (cached && now - cached.at < TTL) {
      var cachedPatch = { tweetEventTotal: cached.total || 0 }
      if (canShowChips && cached.stats && cached.stats.length > 0) {
        cachedPatch.tweetAccountStats = cached.stats
      }
      this.setData(cachedPatch)
      if (canShowChips) this._updateTweetStatsChipsOverflowHint()
      return
    }
    wx.cloud.callFunction({
      name: 'userDataGateway',
      data: { action: 'getTodayTweetStats' }
    }).then(function (res) {
      var result = res.result || {}
      if (!result.success) return
      var total = typeof result.total === 'number' ? result.total : 0
      var stats = (result.tweetStats && result.tweetStats.length > 0)
        ? result.tweetStats.map(function (item) {
          return {
            screenName: item.screenName,
            label: item.label,
            avatarUrl: item.avatarUrl || resolveTweetAccountAvatarUrl(item.screenName) || '',
            todayCount: item.todayCount
          }
        })
        : []
      self._tweetStatsCache = { at: Date.now(), stats: stats, total: total }
      var patch = { tweetEventTotal: total }
      if (canShowChips && stats.length > 0) {
        patch.tweetAccountStats = stats
      }
      self.setData(patch)
      if (canShowChips) self._updateTweetStatsChipsOverflowHint()
    }).catch(function () {})
  },

  /** 胶囊条是否溢出可滑动：控制右侧渐隐提示（与首页发射商胶囊一致）
      胶囊条 wxml 已迁入 event-updates 分包组件，selectorQuery 需以组件实例为查询上下文 */
  _updateTweetStatsChipsOverflowHint() {
    // nextTick：等待 tweetAccountStats 属性下发并完成组件渲染后再量宽度
    wx.nextTick(() => {
      const comp = typeof this.selectComponent === 'function' ? this.selectComponent('#eventUpdatesSection') : null
      if (!comp) return
      const query = wx.createSelectorQuery().in(comp)
      query.select('.tweet-stats-scroll').boundingClientRect()
      query.select('.tweet-stats-chips-row').boundingClientRect()
      query.exec((res) => {
        const scrollRect = res && res[0]
        const rowRect = res && res[1]
        const hasOverflow = !!(scrollRect && rowRect && rowRect.width > scrollRect.width + 2)
        if (hasOverflow !== this.data.tweetStatsChipsHasOverflow) {
          this.setData({ tweetStatsChipsHasOverflow: hasOverflow })
        }
      })
    })
  },

  /** 横向滑动：按 scrollLeft 阶梯触发中度震动（复用首页发射商胶囊手感） */
  onTweetStatsChipsScroll(e) {
    const left = Math.max(0, Number((e.detail && e.detail.scrollLeft) || 0))
    const stepPx = 52
    const bucket = Math.floor(left / stepPx)
    if (this._tweetStatsScrollHapticBucket == null) {
      this._tweetStatsScrollHapticBucket = bucket
      return
    }
    if (bucket === this._tweetStatsScrollHapticBucket) return
    const jumps = Math.min(Math.abs(bucket - this._tweetStatsScrollHapticBucket), 4)
    for (let i = 0; i < jumps; i++) {
      try { wx.vibrateShort({ type: 'medium' }) } catch (err) {}
    }
    this._tweetStatsScrollHapticBucket = bucket
  },

  /** 事件更新胶囊 → 按账号进入列表详情（PRO 门控；与简报胶囊逻辑一致但进度 Tab 单独拦截） */
  async onTweetAccountTap(e) {
    var allowed = await gateCheck('starship_progress_event_source', '星舰事件更新 · 按账号查看')
    if (!allowed) return
    var ds = e.currentTarget.dataset || {}
    var list = this.data.tweetAccountStats || []
    var item = list[ds.index]
    if (!item && ds.index !== undefined && ds.index !== '') {
      var n = parseInt(ds.index, 10)
      if (!isNaN(n)) item = list[n]
    }
    var screenName = (item && item.screenName) || ds.source || ''
    if (!screenName) return
    var params = { source: String(screenName) }
    var label = (item && item.label) || ds.label
    if (label) params.label = String(label)
    navigateTo(ROUTES.EVENT_DETAIL, params)
  },

  _enrichEventItem(item) {
    const enrichedMediaList = (item.mediaList || []).map(m => {
      if (m.type !== 'video') {
        if (m.type === 'image' && m.url) {
          // 列表卡片用 thumb；remoteUrl 供分享（缓存后 url 可能是 wxfile://）
          const remoteUrl = m.url
          return { ...m, remoteUrl, url: getCachedMediaImage(m.url, 'thumb') }
        }
        return m
      }
      return enrichVideoMediaItem(m, { getCachedMediaImage, thumbPreset: 'thumb' })
    })

    // 头像：按 source 约定路径校验，防转推脏数据串号；再走本地缓存
    let avatar = resolveEventAuthorAvatarUrl(item)
    const authorAvatarRemote = avatar || ''
    if (avatar) avatar = getCachedMediaImage(avatar, 'thumb')

    // 缩略图与原图一一对应（同下标），避免预览/保存映射错位
    const imageUrls = []
    const imageOriginalUrls = []
    enrichedMediaList.forEach((m) => {
      if (!m || m.type !== 'image') return
      const original = m.remoteUrl || m.url
      const thumb = m.url || original
      if (!thumb && !original) return
      imageUrls.push(thumb || original)
      imageOriginalUrls.push(original || thumb)
    })
    const imageCount = imageUrls.length

    return {
      ...item,
      mediaList: enrichedMediaList,
      publishedAtText: this.formatEventTime(item.publishedAt),
      authorAvatar: avatar,
      authorAvatarRemote,
      imageUrls,
      // 预览用 imageUrls（缩略图）；长按保存用 imageOriginalUrls（源文件）
      imageOriginalUrls,
      imageCount,
      imageGridCols: Math.min(4, Math.max(1, imageCount || 1)),
      _liveStatus: 0,
      _liveCover: '',
      _liveTitle: ''
    }
  },

  /** 缓存里若仍有英文正文（未翻译），应跳过本地缓存走云库 */
  _eventCacheHasUntranslated(list) {
    const rows = Array.isArray(list) ? list : []
    return rows.some((evt) => {
      if (!evt) return false
      if (evt.translated === false) return true
      const content = String(evt.content || '').trim()
      if (!content) return false
      return !/[\u4e00-\u9fff]/.test(content)
    })
  },

  async loadEventUpdates(refresh, filterSource, opts = {}) {
    if (this.data.eventUpdatesLoading) return
    this.setData({ eventUpdatesLoading: true })

    // 保存筛选条件
    if (filterSource !== undefined) {
      this._filterSource = filterSource || ''
    }

    // silent（下拉刷新）：已有列表时不先清空（避免闪“加载中”占位），成功后整页替换
    if (refresh && !(opts.silent && (this.data.eventUpdates || []).length > 0)) {
      this.setData({ eventUpdates: [], eventUpdatesNoMore: false })
    }

    const skip = refresh ? 0 : this.data.eventUpdates.length

    if (skip === 0 && !this._filterSource) {
      try {
        const cached = storageCache.readMemOrSync(this._eventCacheKey, null)
        if (cached && cached.timestamp && (Date.now() - cached.timestamp < this._eventCacheTTL)) {
          if (!this._eventCacheHasUntranslated(cached.data)) {
            this._stashRawEventDocs(cached.data)
            const items = (cached.data || []).map(item => this._enrichEventItem(item))
            this.setData({
              eventUpdates: items,
              eventUpdatesNoMore: items.length < 10,
              eventUpdatesLoading: false,
              eventUpdatesError: ''
            })
            this._scheduleLiveStatusCheck(items)
            return
          }
        }
      } catch (e) {}
    }

    try {
      const db = wx.cloud.database()
      const limit = 10
      const where = { status: 'published' }
      if (this._filterSource) {
        where.source = this._filterSource
      }
      const res = await db.collection('starship_event_updates')
        .where(where)
        .orderBy('publishedAt', 'desc')
        .skip(skip)
        .limit(limit)
        .get()

      this._stashRawEventDocs(res.data)
      const newItems = (res.data || []).map(item => this._enrichEventItem(item))

      const merged = refresh ? newItems : this.data.eventUpdates.concat(newItems)
      this.setData({
        eventUpdates: merged,
        eventUpdatesNoMore: newItems.length < limit,
        eventUpdatesLoading: false,
        eventUpdatesError: ''
      })

      if (skip === 0 && res.data && res.data.length > 0) {
        try {
          storageCache.persistAsync(this._eventCacheKey, { data: res.data, timestamp: Date.now() })
        } catch (e) {}
      }

      this._scheduleLiveStatusCheck(merged)
    } catch (e) {
      if (isPermissionDenied(e)) {
        this.setData({ eventUpdatesLoading: false, eventUpdatesError: getPermissionDeniedMessage() })
      } else {
        this.setData({ eventUpdatesLoading: false })
      }
    }
  },

  _extractRoomId(raw) {
    if (!raw) return ''
    const m = String(raw).match(/(?:live\.bilibili\.com\/(?:h5\/)?)?(\d+)/)
    return m ? m[1] : String(raw).replace(/\D/g, '')
  },

  /** 原始事件文档按 _id 暂存（未 enrich）：跳详情页时经 eventChannel 传快照做首屏加速 */
  _stashRawEventDocs(rows) {
    if (!Array.isArray(rows) || !rows.length) return
    if (!this._rawEventDocsById) this._rawEventDocsById = {}
    rows.forEach((row) => {
      if (row && row._id) this._rawEventDocsById[row._id] = row
    })
  },

  _emitEventSnapshot(res, eventId) {
    try {
      const raw = this._rawEventDocsById && this._rawEventDocsById[eventId]
      if (res && res.eventChannel && raw) {
        res.eventChannel.emit('eventSnapshot', raw)
      }
    } catch (e) {}
  },

  _scheduleLiveStatusCheck(items) {
    const liveItems = (items || []).filter((it) => it.liveRoomId)
    if (!liveItems.length) return
    if (this._liveStatusDeferTimer) clearTimeout(this._liveStatusDeferTimer)
    this._liveStatusDeferTimer = setTimeout(() => {
      this._liveStatusDeferTimer = null
      this._checkLiveStatus(items)
    }, PROGRESS_LIVE_STATUS_DEFER_MS)
  },

  async _checkLiveStatus(items) {
    const liveItems = (items || []).filter(it => it.liveRoomId)
    if (!liveItems.length) return

    // 过审关闭直播入口：不发起 B 站直播状态查询（wxml 侧同开关已隐藏直播卡）
    const allowed = await isLiveEntryAllowed().catch(() => false)
    if (this.data.enableLiveEntry !== !!allowed) {
      this.setData({ enableLiveEntry: !!allowed })
    }
    if (!allowed) return

    const roomIds = [...new Set(liveItems.map(it => this._extractRoomId(it.liveRoomId)))]
    const statusMap = await fetchLiveStatusBatch(roomIds)

    let updates = this.data.eventUpdates || []
    for (const roomId of roomIds) {
      const { liveStatus, cover, liveTitle } = parseLiveStatus(statusMap[roomId])
      updates = updates.map(it => {
        if (it.liveRoomId && this._extractRoomId(it.liveRoomId) === roomId) {
          return {
            ...it,
            _liveStatus: liveStatus,
            _liveCover: it.liveCover || cover,
            _liveTitle: liveTitle
          }
        }
        return it
      })
    }
    this.setData({ eventUpdates: updates })
  },

  openEventDetail(e) {
    const eventId = e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.id : ''
    if (!eventId) return
    wx.navigateTo({
      url: `${ROUTES.EVENT_DETAIL}?id=${encodeURIComponent(eventId)}`,
      success: (res) => this._emitEventSnapshot(res, eventId)
    })
  },

  openEventShareSheet(e) {
    const dataset = (e && e.currentTarget && e.currentTarget.dataset) || {}
    const item = this.findEventUpdateItem(dataset.id, dataset.idx)
    if (!item || !item._id) return
    this.setData({
      showEventShareSheet: true,
      selectedEventShareId: String(item._id),
      pressedEventId: ''
    })
  },

  closeEventShareSheet() {
    this.setData({
      showEventShareSheet: false,
      selectedEventShareId: '',
      pressedEventId: ''
    })
  },

  onEventShareButtonTap() {
    this.setData({ showEventShareSheet: false, pressedEventId: '' })
  },

  openSelectedEventDetailForShare() {
    const eventId = this.data.selectedEventShareId
    this.setData({ showEventShareSheet: false, pressedEventId: '' })
    if (!eventId) return
    wx.navigateTo({
      url: `${ROUTES.EVENT_DETAIL}?id=${encodeURIComponent(eventId)}`,
      success: (res) => {
        this._emitEventSnapshot(res, eventId)
        wx.showToast({
          title: '打开右上角可分享到朋友圈/收藏',
          icon: 'none',
          duration: 2200
        })
      }
    })
  },

  onFlightChecklistDetailTap(e) {
    const url = e.currentTarget.dataset.url
    if (!url || typeof url !== 'string') return
    const data = url.trim()
    if (!/^https?:\/\//.test(data)) {
      wx.showToast({ title: '链接格式无效', icon: 'none' })
      return
    }
    const doCopy = () => {
      wx.setClipboardData({
        data,
        success: () => wx.showToast({ title: '链接已复制', icon: 'success' }),
        fail: () => wx.showModal({ title: '链接', content: data, showCancel: false })
      })
    }
    if (wx.requirePrivacyAuthorize) {
      wx.requirePrivacyAuthorize({ success: doCopy, fail: doCopy })
    } else {
      doCopy()
    }
  },

  onLiveCardTap(e) {
    if (!this.data.enableLiveEntry) return
    const idx = Number(e.currentTarget.dataset.idx)
    const item = this.data.eventUpdates[idx]
    if (!item) return

    const rid = this._extractRoomId(item.liveRoomId)
    const liveUrl = `https://live.bilibili.com/${rid}`

    if (item._liveStatus !== 1) {
      wx.showToast({ title: '主播尚未开播', icon: 'none', duration: 2000 })
      return
    }

    wx.setClipboardData({
      data: liveUrl,
      success() {
        wx.showModal({
          title: '直播中',
          content: '直播链接已复制到剪贴板，请在浏览器中打开观看直播',
          showCancel: false,
          confirmText: '我知道了'
        })
      }
    })
  },

  formatEventTime(ts) {
    if (!ts) return ''
    const d = new Date(ts)
    const pad = n => String(n).padStart(2, '0')
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes())
  },

  /** 点击：微信原生预览缩略图；原图保存走列表长按 */
  onEventImagePreview(e) {
    previewEventImages(e.currentTarget.dataset)
  },

  /** 长按图片：保存原图 / 多图选择保存（禁用系统转发菜单） */
  onEventImageLongPress(e) {
    handleEventImageLongPress(this, parseLongPressDataset(e.currentTarget.dataset))
  },

  closeEventImageSavePicker() {
    closeEventImageSavePicker(this)
  },

  toggleEventImageSaveSelect(e) {
    const idx = (e.currentTarget.dataset || {}).index
    toggleEventImageSaveSelect(this, idx)
  },

  selectAllEventImageSave() {
    selectAllEventImageSave(this)
  },

  confirmEventImageSavePicker() {
    return confirmEventImageSavePicker(this)
  },

  /** 推文视频播放为会员权益；非会员点封面弹开通引导（一次广告只解锁当前这条视频） */
  async _eventVideoPlayAllowed(opts) {
    try {
      const enabled = await isMembershipEnabled()
      if (!enabled) return true
      if (isProSync()) return true
      if (canPrefetchVideoSync()) return true
      const o = opts || {}
      return await gateCheck('starship_event_list_full', '星舰事件更新 · 视频播放', {
        adUnlockId: eventVideoAdUnlockId(o.eventId, o.mediaIndex, o.url)
      })
    } catch (err) {
      return true
    }
  },

  async onVideoThumbnailTap(e) {
    const dataset = e.currentTarget.dataset || {}
    const url = dataset.url
    const eventId = dataset.eventid || ''
    const mIdx = dataset.midx
    const videoUrl = dataset.videourl || ''
    const isLong = !!dataset.islong
    if (!url && !dataset.playurl) return

    // 非会员：只展示封面，点击触发门控，不播放不下载
    const playAllowed = await this._eventVideoPlayAllowed({
      eventId,
      mediaIndex: mIdx,
      url: dataset.playurl || url
    })
    if (!playAllowed) return

    // 长视频未存储，点击直接复制视频直链
    if (isLong || videoUrl) {
      wx.setClipboardData({
        data: videoUrl || dataset.sourceurl || url,
        success() {
          wx.showToast({ title: '视频链接已复制，请在浏览器中打开', icon: 'none', duration: 2500 })
        }
      })
      return
    }

    // COS 可播视频：跳转详情页自动播压缩预览
    if (isVideoUrl(url) || isVideoUrl(dataset.playurl)) {
      if (eventId) {
        wx.navigateTo({
          url: `${ROUTES.EVENT_DETAIL}?id=${encodeURIComponent(eventId)}&autoPlayVideo=${mIdx}`,
          success: (res) => this._emitEventSnapshot(res, eventId)
        })
      } else {
        await playEventVideo({
          url,
          playUrl: dataset.playurl || url,
          originalUrl: dataset.original || url,
          thumb: dataset.thumb || '',
          videoUrl: '',
          sourceUrl: dataset.sourceurl || '',
          isLong: false,
          // 原片保存仅 Pro/已购；广告解锁只放行预览播放
          canSave: canSaveOriginalVideoSync('starship_event_list_full'),
          onSaveHint: () => {}
        })
      }
      return
    }

    // 外部链接（如 x.com），直接复制到剪贴板
    wx.setClipboardData({
      data: url,
      success() {
        wx.showToast({ title: '链接已复制，请在浏览器中打开', icon: 'none', duration: 2500 })
      }
    })
  },

  async onVideoSaveOriginal(e) {
    const dataset = e.currentTarget.dataset || {}
    const original = dataset.original || dataset.url
    if (!original || !isVideoUrl(original)) return
    if (dataset.islong || dataset.videourl) return
    // 原片体积大（COS 成本高）：仅 Pro/已购放行，不提供广告通道
    if (!canUsePaidCloudSync()) {
      const allowed = await gateCheck('starship_event_list_full', '星舰事件更新 · 原视频下载', { allowAd: false })
      if (!allowed) return
    }
    await saveEventOriginalVideo(original)
  },

  async onEventScrollToLower() {
    if (this.data.eventUpdatesNoMore || this.data.eventUpdatesLoading) return
    // Tab 展开态翻页：非会员触底弹开通引导（enableEventListGate 关闭则放行）
    if (!canUsePaidCloudSync()) {
      const policy = await getMemberPolicy()
      if (policy.enableEventListGate) {
        if (this._eventGateChecking) return
        this._eventGateChecking = true
        try {
          const allowed = await gateCheck('starship_event_list_full', '星舰事件更新 · 完整浏览')
          if (!allowed) return
        } finally {
          this._eventGateChecking = false
        }
      }
    }
    this.loadEventUpdates(false)
  },

  onEventScrollRefresh() {
    runPullRefresh(this, () => this.loadEventUpdates(true, undefined, { silent: true }), 'eventScrollRefreshing')
  },

  toggleEventUpdatesExpanded() {
    this.setData({ eventUpdatesExpanded: !this.data.eventUpdatesExpanded })
  },

  /** 查看更多事件更新 → 进入详情页列表模式；入口不设门控，页内免费前 5 条，翻页/播视频再拦 */
  openEventUpdatesList() {
    const params = { mode: 'list_all' }
    if (this._filterSource) params.source = this._filterSource
    navigateTo(ROUTES.EVENT_DETAIL, params)
  },

  onAvatarError(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    const idx = this.data.eventUpdates.findIndex(item => item._id === id)
    if (idx >= 0) {
      this.setData({ [`eventUpdates[${idx}]._avatarError`]: true })
    }
  },
}

/** 把低频方法挂到页面实例上（覆盖主包里的委托占位方法） */
function attachTo(page) {
  Object.keys(methods).forEach((name) => {
    page[name] = methods[name]
  })
  page.__progressLazyAttached = true
}

module.exports = { attachTo, methods }
