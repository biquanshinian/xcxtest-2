const {
  LIVE_STATUS,
  isChannelLiveSupported,
  getFinderUserName,
  validateFinderUserName,
  classifyLiveError,
  getLiveStatusMeta,
  fetchChannelsLiveInfo,
  shouldUseChannelLiveForTap,
  openChannelsLive,
  openChannelsUserProfile
} = require('../../utils/channels-live.js')
const { getChannelsLiveCoverConfig } = require('../../utils/channels-live-config-cache.js')

const COVER_DEFAULT = {
  enabled: false,
  coverType: 'default',
  mediaUrl: '',
  previewUrl: '',
  previewStatus: '',
  posterUrl: '',
  title: '',
  linkMode: 'auto',
  showLiveBadge: true
}

function isVideoMediaUrl(url) {
  if (!url || typeof url !== 'string') return false
  const base = url.trim().split(/[?#]/)[0].toLowerCase()
  return base.endsWith('.mp4') || base.endsWith('.m3u8') || base.endsWith('.mov') || base.endsWith('.m4v') || base.endsWith('.webm')
}

function normalizeCoverConfig(raw) {
  const cfg = Object.assign({}, COVER_DEFAULT, raw || {})
  if (!['default', 'image', 'video'].includes(cfg.coverType)) cfg.coverType = 'default'
  if (!['auto', 'custom', 'official'].includes(cfg.linkMode)) cfg.linkMode = 'auto'
  cfg.mediaUrl = String(cfg.mediaUrl || '').trim()
  cfg.previewUrl = String(cfg.previewUrl || '').trim()
  cfg.previewStatus = String(cfg.previewStatus || '').trim()
  cfg.posterUrl = String(cfg.posterUrl || '').trim()
  cfg.title = String(cfg.title || '').trim()
  cfg.enabled = !!cfg.enabled
  cfg.showLiveBadge = cfg.showLiveBadge !== false
  return cfg
}

function hasValidCustomCover(cover, coverLoadFailed) {
  return !!(
    cover &&
    cover.enabled &&
    cover.coverType !== 'default' &&
    cover.mediaUrl &&
    !coverLoadFailed
  )
}

function shouldShowOfficialPlayer(status, feedId, sdkSupported, cover, coverLoadFailed) {
  if (!sdkSupported || !feedId || status !== LIVE_STATUS.LIVE) return false
  if (!hasValidCustomCover(cover, coverLoadFailed)) return true
  if (cover.linkMode === 'custom') return false
  if (cover.linkMode === 'official') return true
  return cover.linkMode === 'auto'
}

function shouldShowCustomCover(status, cover, coverLoadFailed) {
  if (!hasValidCustomCover(cover, coverLoadFailed)) return false
  if (cover.linkMode === 'custom') return true
  if (cover.linkMode === 'official') return status !== LIVE_STATUS.LIVE
  return status !== LIVE_STATUS.LIVE
}

Component({
  properties: {
    /** 覆盖 config.channelsLive.finderUserName */
    finderUserName: { type: String, value: '' },
    /** 挂载后自动拉取直播信息 */
    autoLoad: { type: Boolean, value: true },
    /**
     * 未开播时优先走父页面「推荐视频号」引导（方案二），
     * 而不是打开自己的视频号主页
     */
    preferFallbackGuide: { type: Boolean, value: false },
    /** 操作区额外展示「推荐直播」入口（监控页） */
    showExtraGuide: { type: Boolean, value: false },
    extraGuideLabel: { type: String, value: '推荐直播' },
    extraGuideIcon: {
      type: String,
      value: 'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/%E5%9B%BE%E6%A0%87/1778430366049_f5kzse.svg'
    },
    /** 操作区额外展示 B 站直播入口（监控页） */
    showBiliLive: { type: Boolean, value: false },
    biliLiveLabel: { type: String, value: 'B站直播' },
    biliLiveIcon: {
      type: String,
      value: 'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/%E5%9B%BE%E6%A0%87/1778430483411_43m2pg.svg'
    }
  },

  data: {
    loading: false,
    coverLoading: false,
    sdkSupported: true,
    resolvedFinderUserName: '',
    feedId: '',
    nonceId: '',
    status: 0,
    description: '',
    nickname: '',
    statusLabel: '',
    statusHint: '',
    statusTone: 'idle',
    showPlayer: false,
    showCustomCover: false,
    showCustomCoverChannelLive: false,
    coverIsVideo: false,
    coverMediaUrl: '',
    coverPosterUrl: '',
    coverTitle: '',
    coverShowLiveBadge: true,
    canOpenLive: false,
    errorText: '',
    canRetry: false,
    coverLoadFailed: false
  },

  lifetimes: {
    attached() {
      this.setData({ sdkSupported: isChannelLiveSupported() })
      if (this.properties.autoLoad) {
        this.refresh()
      }
    }
  },

  methods: {
    refresh() {
      return Promise.all([
        this.loadCoverConfig(true),
        this.loadLiveInfo()
      ])
    },

    loadCoverConfig(forceRefresh) {
      this.setData({ coverLoading: true })
      return getChannelsLiveCoverConfig({
        forceRefresh: !!forceRefresh,
        onUpdate: (data) => {
          this.applyCoverConfig(data)
        }
      }).then((data) => {
        this.applyCoverConfig(data)
      }).catch(() => {
        this.applyCoverConfig(null)
      }).finally(() => {
        this.setData({ coverLoading: false })
      })
    },

    applyCoverConfig(raw) {
      const cover = normalizeCoverConfig(raw)
      const coverIsVideo = cover.coverType === 'video' || isVideoMediaUrl(cover.mediaUrl)
      this._coverConfig = cover
      const previewReady = !!(coverIsVideo && cover.previewUrl && cover.previewStatus === 'ready')
      this._usingPreview = previewReady
      this.setData({
        coverMediaUrl: previewReady ? cover.previewUrl : cover.mediaUrl,
        coverPosterUrl: cover.posterUrl,
        coverTitle: cover.title,
        coverShowLiveBadge: cover.showLiveBadge,
        coverIsVideo,
        coverLoadFailed: false
      })
      this.updateDisplayMode()
    },

    loadLiveInfo() {
      const finderUserName = getFinderUserName(this.properties.finderUserName)
      const validation = validateFinderUserName(finderUserName)
      if (!validation.valid) {
        this.applyPayload({
          finderUserName: validation.value || '',
          feedId: '',
          status: 0,
          description: '',
          errorText: validation.message,
          canRetry: false
        })
        return Promise.resolve()
      }

      this.setData({ loading: true, errorText: '', canRetry: false })

      return fetchChannelsLiveInfo(validation.value)
        .then((payload) => {
          this.applyPayload(payload)
        })
        .catch((err) => {
          const classified = classifyLiveError(err)
          if (classified.treatAsIdle) {
            this.applyPayload({
              finderUserName: validation.value,
              feedId: '',
              status: LIVE_STATUS.NONE,
              description: ''
            })
            return
          }

          this.applyPayload({
            finderUserName: validation.value,
            feedId: '',
            status: 0,
            description: '',
            errorText: classified.userMessage || '获取直播信息失败，请稍后重试',
            canRetry: classified.canRetry !== false
          })
        })
    },

    updateDisplayMode() {
      const cover = this._coverConfig || normalizeCoverConfig(null)
      const status = this.data.status || 0
      const feedId = this.data.feedId || ''
      const sdkSupported = this.data.sdkSupported
      const coverLoadFailed = this.data.coverLoadFailed
      const meta = getLiveStatusMeta(status)

      const showPlayer = shouldShowOfficialPlayer(status, feedId, sdkSupported, cover, coverLoadFailed)
      const showCustomCover = shouldShowCustomCover(status, cover, coverLoadFailed)
      const showCustomCoverChannelLive = showCustomCover && shouldUseChannelLiveForTap(status, feedId, sdkSupported)

      this.setData({
        showPlayer,
        showCustomCover,
        showCustomCoverChannelLive,
        statusLabel: meta.label,
        statusHint: this.data.errorText ? '' : meta.hint,
        statusTone: meta.tone
      })
    },

    applyPayload(payload) {
      const status = payload.status || 0
      const meta = getLiveStatusMeta(status)
      const sdkSupported = isChannelLiveSupported()
      const feedId = payload.feedId || ''
      const resolvedFinderUserName = payload.finderUserName || getFinderUserName(this.properties.finderUserName)
      const canOpenLive = !!feedId && status !== LIVE_STATUS.NONE
      const cover = this._coverConfig || normalizeCoverConfig(null)
      const coverLoadFailed = this.data.coverLoadFailed
      const showPlayer = shouldShowOfficialPlayer(status, feedId, sdkSupported, cover, coverLoadFailed)
      const showCustomCover = shouldShowCustomCover(status, cover, coverLoadFailed)
      const showCustomCoverChannelLive = showCustomCover && shouldUseChannelLiveForTap(status, feedId, sdkSupported)
      const displayTitle = (cover.title || payload.description || payload.nickname || '').trim()

      this.setData({
        loading: false,
        sdkSupported,
        resolvedFinderUserName,
        feedId,
        nonceId: payload.nonceId || '',
        status,
        description: payload.description || '',
        nickname: payload.nickname || '',
        statusLabel: meta.label,
        statusHint: payload.errorText ? '' : meta.hint,
        statusTone: meta.tone,
        showPlayer,
        showCustomCover,
        showCustomCoverChannelLive,
        coverTitle: displayTitle,
        canOpenLive,
        errorText: payload.errorText || '',
        canRetry: !!payload.canRetry
      })

      this.triggerEvent('statuschange', {
        status,
        feedId,
        description: payload.description || '',
        showPlayer,
        showCustomCover,
        nickname: payload.nickname || ''
      })
    },

    onCoverMediaError() {
      const cover = this._coverConfig || normalizeCoverConfig(null)
      // 压缩预览失败时回退原片，避免整块封面消失
      if (this._usingPreview && cover.mediaUrl && this.data.coverMediaUrl !== cover.mediaUrl) {
        this._usingPreview = false
        this.setData({ coverMediaUrl: cover.mediaUrl })
        return
      }
      this.setData({ coverLoadFailed: true, showCustomCover: false })
      this.updateDisplayMode()
    },

    onCustomCoverTap() {
      // 直播中自定义封面由透明 channel-live 接管点击，避免 openChannelsLive 确认弹窗
      if (this.data.showCustomCoverChannelLive) return
      if (this.data.canOpenLive) {
        this.onOpenLive()
        return
      }
      this.onOpenProfileOrFallbackGuide()
    },

    onRetry() {
      this.refresh()
    },

    onOpenLive() {
      openChannelsLive({
        finderUserName: getFinderUserName(this.properties.finderUserName),
        feedId: this.data.feedId,
        nonceId: this.data.nonceId
      }).then(() => {
        try {
          require('../../../../utils/user-growth.js').recordMilestone('WITNESS_LAUNCH')
        } catch (e) {}
      }).catch(() => {})
    },

    onOpenProfileOrFallbackGuide() {
      if (this.properties.preferFallbackGuide) {
        this.triggerEvent('fallbackguide', {
          status: this.data.status,
          feedId: this.data.feedId || ''
        })
        return
      }
      this.onOpenProfile()
    },

    onIdlePlaceholderTap() {
      if (!this.properties.preferFallbackGuide) return
      this.onOpenProfileOrFallbackGuide()
    },

    onOpenProfile() {
      openChannelsUserProfile(getFinderUserName(this.properties.finderUserName))
        .then(() => {
          try {
            require('../../../../utils/user-growth.js').recordMilestone('WITNESS_LAUNCH')
          } catch (e) {}
        })
        .catch(() => {})
    },

    onExtraGuideTap() {
      this.triggerEvent('extraguide')
    },

    onBiliLiveTap() {
      this.triggerEvent('bililive')
    }
  }
})
