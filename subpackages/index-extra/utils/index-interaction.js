/**
 * 首页用户触发 / 可延迟交互：详情跳转、缓存、助推器/发射商入口、图片错误回退、分享
 * 主包 index.js 通过 require.async + attachTo 委托（index-extra 已 preload）。
 *
 * 注意：首屏仍会调用 _preloadVisibleRocketImages / syncLaunchPanel* ——
 * 委托壳在调用时 await 分包 attach，preloadRule 下几乎无等待。
 */
const {
  resolveMissionRocketImage,
  isDefaultRocketSrc,
  shouldReplaceRocketImage
} = require('../../../utils/util.js')
const { rocketNameForImage } = require('../../../utils/launch-card-i18n.js')
const {
  DEFAULT_ROCKET_IMAGE,
  setMissionDetailCacheEntry
} = require('../../../utils/index-page-helpers.js')
const { loadCloudMediaMap } = require('../../../utils/image-config.js')
const { markDownloadFailed } = require('../../../utils/download-fail-cache.js')
const { gateCheck } = require('../../../utils/membership.js')
const { ROUTES, navigateTo } = require('../../../utils/routes.js')
const storageCache = require('../../../utils/storage-sync-cache.js')
const { shareMission } = require('../../../utils/api-app-services.js')
const {
  resolveMissionDetailSourceData,
  buildMissionDetailNavigation,
  collectMissionShareCandidates
} = require('../../../utils/index-mission-nav.js')

const interactionMethods = {
  viewMissionDetail(e) {
    this.closeMissionSwipeCells()
    const dataset = e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset : {}
    const context = this.buildMissionDetailViewContext(dataset)
    if (!context) return

    this.persistMissionDetailListSnapshot(context)

    wx.navigateTo({
      url: context.navigation.url,
      success: (res) => {
        // 快照经 eventChannel 直达详情页做首屏加速；storage 快照保留作分享冷启动兜底
        try {
          if (res && res.eventChannel && context.mission) {
            res.eventChannel.emit('missionSnapshot', context.mission)
          }
        } catch (err) {}
      }
    })
  },

  getMissionDetailCacheStore() {
    // 全局共享内存缓存（storage-sync-cache）：index / mission-detail / search / profile
    // 共用同一份内存层，同一进程内 mission_detail_cache 最多同步读 1 次
    const stored = storageCache.readMemOrSync('mission_detail_cache', {})
    const safe = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {}
    return { ...safe }
  },

  setMissionDetailCacheStore(cache, options = {}) {
    const safe = cache && typeof cache === 'object' && !Array.isArray(cache) ? cache : {}
    try {
      if (options && options.syncWrite) {
        // 同步写入：navigateTo 跳详情页前落盘（详情页同进程读内存层，磁盘兜底冷启动场景）
        storageCache.persistSync('mission_detail_cache', safe)
      } else {
        // 异步写入，避免阻塞主线程；内存层已立即生效，下次读不会回源 storage
        storageCache.persistAsync('mission_detail_cache', safe)
      }
    } catch (err) {}
  },

  updateMissionDetailCacheEntries(entries = [], options = {}) {
    const safeEntries = Array.isArray(entries) ? entries : []
    let cache =
      options && options.cache && typeof options.cache === 'object' && !Array.isArray(options.cache)
        ? { ...options.cache }
        : this.getMissionDetailCacheStore()

    safeEntries.forEach((entry) => {
      const safeEntry = entry && typeof entry === 'object' ? entry : null
      if (!safeEntry || safeEntry.id == null || !safeEntry.mission) return
      cache = setMissionDetailCacheEntry(cache, safeEntry.id, safeEntry.detailType, safeEntry.mission, {
        source: safeEntry.source,
        cachedAt: safeEntry.cachedAt
      })
    })

    if (safeEntries.length > 0 && options.persist !== false) {
      this.setMissionDetailCacheStore(cache, { syncWrite: !!options.syncWrite })
    }

    return cache
  },

  sanitizeMissionDetailCacheStore() {
    // 经共享内存层异步预热读取：已 warm 时直接用内存值，避免读到落后于内存的磁盘数据
    storageCache
      .warmAsync('mission_detail_cache', {})
      .then((raw) => {
        const stored = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {}
        const keys = Object.keys(stored)
        if (!keys.length) return

        const sanitized = {}
        const cleanFallback = (value) => (value === '加载失败' ? '' : value)
        let i = 0
        const CHUNK = 20
        const self = this

        const step = () => {
          const end = Math.min(i + CHUNK, keys.length)
          for (; i < end; i++) {
            const key = keys[i]
            const mission = stored[key]
            if (!mission || typeof mission !== 'object') continue
            sanitized[key] = {
              ...mission,
              description: cleanFallback(mission.description),
              missionDetails: cleanFallback(mission.missionDetails),
              rocketInfo: cleanFallback(mission.rocketInfo),
              launchAgency: cleanFallback(mission.launchAgency),
              launchSite: cleanFallback(mission.launchSite),
              boosterInfo: self.normalizeBoosterInfo(mission.boosterInfo, mission)
            }
          }
          if (i < keys.length) {
            setTimeout(step, 0)
          } else {
            self.setMissionDetailCacheStore(sanitized)
          }
        }

        setTimeout(step, 0)
      })
      .catch(() => {})
  },

  buildMissionDetailViewContext(dataset = {}) {
    const safeDataset = dataset && typeof dataset === 'object' ? dataset : {}
    const id = safeDataset.id
    if (!id) return null

    const resolved = resolveMissionDetailSourceData(this.data, safeDataset.type, id)
    const navigation = buildMissionDetailNavigation({
      id: resolved.id,
      detailType: resolved.detailType,
      fromSearch: safeDataset.source === 'search'
    })
    const mission =
      collectMissionShareCandidates(this.data).find((item) => String(item && item.id) === String(resolved.id)) || null

    return {
      resolved,
      navigation,
      mission
    }
  },

  persistMissionDetailListSnapshot(context) {
    const safeContext = context && typeof context === 'object' ? context : {}
    const resolved = safeContext.resolved || {}
    const mission = safeContext.mission
    if (!resolved.id || !mission) return

    this.updateMissionDetailCacheEntries(
      [
        {
          id: resolved.id,
          detailType: resolved.detailType,
          mission,
          source: 'list'
        }
      ],
      { syncWrite: true }
    )
  },

  buildPrefetchedMissionDetail(mission, apiDetail) {
    const hasRecovery =
      apiDetail.boosterInfo &&
      (apiDetail.boosterInfo.configReusable === true ||
        (!apiDetail.boosterInfo.inferredRecovery &&
          (apiDetail.boosterInfo.landingType ||
            apiDetail.boosterInfo.landingLocation ||
            (typeof apiDetail.boosterInfo.landingDescription === 'string' &&
              apiDetail.boosterInfo.landingDescription.trim()))))
    const boosterInfo = hasRecovery ? apiDetail.boosterInfo : mission.boosterInfo || apiDetail.boosterInfo

    return {
      ...apiDetail,
      boosterInfo,
      isRecoverableThisMission: !!(
        boosterInfo &&
        (boosterInfo.configReusable === true ||
          (!boosterInfo.inferredRecovery &&
            (boosterInfo.landingType ||
              boosterInfo.landingLocation ||
              (typeof boosterInfo.landingDescription === 'string' && boosterInfo.landingDescription.trim()))))
      ),
      launchTimeCST: this.formatToCST(apiDetail.launchTime || mission.launchTime),
      windowStartCST: apiDetail.windowStart ? this.formatToCST(apiDetail.windowStart) : '',
      windowEndCST: apiDetail.windowEnd ? this.formatToCST(apiDetail.windowEnd) : '',
      // 与详情 mergeMissionDetailData 同源：空 stamped + force，避免列表错误盖章锁死头图
      rocketImage: resolveMissionRocketImage(
        '',
        rocketNameForImage(apiDetail) || rocketNameForImage(mission),
        apiDetail.rocketConfiguration || mission.rocketConfiguration,
        true
      )
    }
  },

  buildDetailPrefetchCacheEntries(results = []) {
    const safeResults = Array.isArray(results) ? results : []
    return safeResults
      .filter((result) => result && result.status === 'fulfilled' && result.value)
      .map((result) => ({
        id: result.value.data.id,
        detailType: result.value.data.missionType || result.value.type || 'upcoming',
        mission: result.value.data,
        source: 'prefetch'
      }))
  },

  normalizeBoosterInfo(boosterInfo, detailSource = {}) {
    if (!boosterInfo || typeof boosterInfo !== 'object') return boosterInfo

    const normalized = { ...boosterInfo }
    const textPool = [
      normalized.landingDescription || '',
      (detailSource.missionFull && detailSource.missionFull.description) ||
        detailSource.missionDetails ||
        detailSource.description ||
        '',
      detailSource.missionName || detailSource.name || ''
    ].join(' ')

    const serial = normalized.serialNumber
    const serialText = serial == null ? '' : String(serial).trim()
    // 纯数字序列号通常是内部ID；Unknown* 为 LL2 占位，不给用户展示/跳转
    if (!serialText || /^\d+$/.test(serialText) || /^unknown/i.test(serialText)) {
      const serialMatch = textPool.match(/\bB\d{3,5}\b/i)
      normalized.serialNumber = serialMatch ? serialMatch[0].toUpperCase() : null
    }

    const pickValidFlightCount = (val) => {
      const n = Number(val)
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : null
    }

    if (normalized.flights == null) {
      const flightCandidates = [
        normalized.flight,
        normalized.flightCount,
        normalized.flight_count,
        normalized.reuseCount,
        normalized.reuse_count,
        detailSource.flight,
        detailSource.flights,
        detailSource.flightCount,
        detailSource.flight_count,
        detailSource.reuseCount,
        detailSource.reuse_count,
        detailSource.launcherLanding &&
          detailSource.launcherLanding.general &&
          detailSource.launcherLanding.general.flights
      ]

      for (const candidate of flightCandidates) {
        const flightCount = pickValidFlightCount(candidate)
        if (flightCount) {
          normalized.flights = flightCount
          break
        }
      }
    }

    if (normalized.flights == null) {
      const flightMatchEn = textPool.match(/\b(\d{1,3})(?:st|nd|rd|th)?\s+flight\b/i)
      const flightMatchCn = textPool.match(/第\s*(\d{1,3})\s*次飞行/)
      const flightMatch = flightMatchEn || flightMatchCn
      if (flightMatch) {
        const n = Number(flightMatch[1])
        if (!isNaN(n) && n > 0) normalized.flights = Math.floor(n)
      }
    }

    return normalized
  },

  async onGoBoosterDetail() {
    try {
      wx.vibrateShort({ type: 'medium' })
    } catch (e) {}
    const launch = this.data.launchData || {}
    const serial = String((launch.boosterInfo && launch.boosterInfo.serialNumber) || '').trim()
    const { openBoosterEntityDetail } = require('./booster-nav.js')
    await openBoosterEntityDetail(serial)
  },

  async onGoAgencyDetail() {
    try {
      wx.vibrateShort({ type: 'medium' })
    } catch (e) {}
    const launch = this.data.launchData || {}
    const id = launch.launchAgencyId
    const abbrev = launch.launchAgencyAbbrev || ''
    if (id == null && !abbrev) return
    const allowed = await gateCheck('agency_encyclopedia', '全球发射商图鉴')
    if (!allowed) return
    const params = {}
    if (id != null) params.id = id
    else params.abbrev = abbrev
    navigateTo(ROUTES.AGENCY_DETAIL, params)
  },

  async onImageError(e) {
    const index = e.currentTarget.dataset.index
    const missionType = this.data.missionType
    const isCalendar = missionType === 'calendar'
    const listKey =
      missionType === 'upcoming' ? 'upcomingMissions' : isCalendar ? 'calendarAllMissions' : 'completedMissions'
    const missions = isCalendar
      ? this.data.expandedDateMissions || []
      : missionType === 'upcoming'
        ? this.data.displayedUpcomingMissions || []
        : this.data.completedMissions || []

    if (!missions || !missions[index]) return
    const mission = missions[index]
    const failedImage = mission.rocketImage
    const rocketName = rocketNameForImage(mission)

    if (failedImage && /^https?:\/\//i.test(String(failedImage).trim())) {
      markDownloadFailed(String(failedImage).trim(), 404)
    }

    const fallbackDefault = resolveMissionRocketImage(DEFAULT_ROCKET_IMAGE, rocketName, mission.rocketConfiguration)
    const applyImage = (nextImage) => {
      if (isCalendar) {
        this._patchCalendarMissionRocketImage(mission.id, nextImage)
        return
      }
      const currentList = this.data[listKey]
      if (!Array.isArray(currentList)) return
      const idx = currentList.findIndex((m) => m && String(m.id) === String(mission.id))
      if (idx < 0) return
      currentList[idx].rocketImage = nextImage
      this.setData({ [listKey]: currentList })
      // 即将发射卡片实际渲染自 displayedUpcomingMissions（筛选后列表），必须同步补图，
      // 否则加载失败的配置图永远停留在破图状态
      if (missionType === 'upcoming') {
        const disp = this.data.displayedUpcomingMissions || []
        const dIdx = disp.findIndex((m) => m && String(m.id) === String(mission.id))
        if (dIdx >= 0 && disp[dIdx].rocketImage !== nextImage) {
          this.setData({ [`displayedUpcomingMissions[${dIdx}].rocketImage`]: nextImage })
        }
      }
      this.syncLaunchDataRocketImageFromListByMissionId(mission.id, nextImage)
    }

    // 等云端文件清单加载完成（已加载会立刻 resolve；并发请求会被去重）
    try {
      await loadCloudMediaMap()
    } catch (err) {}

    // 即使当前已是 default，也强制重算：default 能加载成功不会触发 error，但 map 晚到时需主动升级
    const fuzzyMatchImage = resolveMissionRocketImage(failedImage, rocketName, mission.rocketConfiguration, true)

    if (fuzzyMatchImage && fuzzyMatchImage !== failedImage) {
      applyImage(fuzzyMatchImage)
      return
    }

    if (!rocketName || isDefaultRocketSrc(failedImage)) {
      applyImage(fallbackDefault)
      return
    }

    applyImage(fallbackDefault)
  },

  async onCountdownRocketImageError() {
    if (this.data.missionType !== 'upcoming' || this.data.loadError) return
    const ld = this.data.launchData
    if (!ld || !ld.id) return

    const idStr = String(ld.id)
    if (this._countdownRocketImageLaunchId !== idStr) {
      this._countdownRocketImageLaunchId = idStr
      this._countdownRocketImageErrorPasses = 0
    }
    this._countdownRocketImageErrorPasses = (this._countdownRocketImageErrorPasses || 0) + 1
    if (this._countdownRocketImageErrorPasses > 5) return

    const failedImage = ld.rocketImage || ld.image || ''
    const rocketName = rocketNameForImage(ld)

    // 与列表卡片一致：记录失败 URL，后续 resolve 不再返回同一个坏链接
    if (failedImage && /^https?:\/\//i.test(String(failedImage).trim())) {
      markDownloadFailed(String(failedImage).trim(), 404)
    }

    const applyImage = (nextImage) => {
      if (!nextImage || nextImage === (this.data.launchData && this.data.launchData.rocketImage)) return
      // 用户可能已切到别的任务，校验 id 再写
      if (!this.data.launchData || String(this.data.launchData.id) !== idStr) return
      this.setData({
        'launchData.image': nextImage,
        'launchData.rocketImage': nextImage
      })
      // 倒计时与列表同源显示：把修好的图回写到列表同 id 行
      this._patchUpcomingListsRocketImage(idStr, nextImage)
    }

    try {
      await loadCloudMediaMap()
    } catch (err) {}

    const nextImage = resolveMissionRocketImage(failedImage, rocketName, ld.rocketConfiguration, true)
    if (nextImage && nextImage !== failedImage) {
      applyImage(nextImage)
      return
    }

    if (!rocketName) {
      applyImage(resolveMissionRocketImage(DEFAULT_ROCKET_IMAGE))
    }
  },

  async refreshLaunchPanelRocketImageUrl() {
    const ld = this.data.launchData
    if (!ld || !ld.id) return

    const idStr = String(ld.id)
    if (this._countdownRocketImageLaunchId !== idStr) {
      this._countdownRocketImageLaunchId = idStr
      this._countdownRocketImageErrorPasses = 0
    }

    try {
      await loadCloudMediaMap()
    } catch (e) {}

    const curImg = ld.image || ld.rocketImage || ''
    // 按火箭名重算；已有正确图时传入 stamped，避免 fuzzy miss 降级成 default
    const url = resolveMissionRocketImage(curImg, rocketNameForImage(ld), ld.rocketConfiguration, true)
    if (!shouldReplaceRocketImage(curImg, url)) return

    this.setData({
      'launchData.image': url,
      'launchData.rocketImage': url
    })
    this._patchUpcomingListsRocketImage(idStr, url)
  },

  syncLaunchPanelRocketImageWithUpcomingList() {
    if (this.data.missionType !== 'upcoming') return
    const ld = this.data.launchData
    const list = this.data.upcomingMissions || []
    if (!ld || !ld.id || !list.length) return
    let row = null
    for (let i = 0; i < list.length; i++) {
      if (list[i] && String(list[i].id) === String(ld.id)) {
        row = list[i]
        break
      }
    }
    if (!row || !row.rocketImage) return
    this.syncLaunchDataRocketImageFromListByMissionId(ld.id, row.rocketImage)
  },

  syncLaunchDataRocketImageFromListByMissionId(missionId, rocketImageSrc) {
    if (this.data.missionType !== 'upcoming' || this.data.loadError) return
    const ld = this.data.launchData
    if (!ld || ld.id == null || missionId == null) return
    if (String(ld.id) !== String(missionId)) return
    if (!rocketImageSrc || typeof rocketImageSrc !== 'string' || !rocketImageSrc.trim()) return
    const cur = (ld.rocketImage || ld.image || '').trim()
    if (!shouldReplaceRocketImage(cur, rocketImageSrc)) return
    this.setData({
      'launchData.image': rocketImageSrc,
      'launchData.rocketImage': rocketImageSrc
    })
  },

  _patchUpcomingListsRocketImage(missionId, nextImage) {
    if (!missionId || !nextImage) return
    const patch = {}
    const list = this.data.upcomingMissions || []
    const idx = list.findIndex((m) => m && String(m.id) === String(missionId))
    if (idx >= 0 && shouldReplaceRocketImage(list[idx].rocketImage, nextImage)) {
      patch[`upcomingMissions[${idx}].rocketImage`] = nextImage
    }
    const disp = this.data.displayedUpcomingMissions || []
    const dIdx = disp.findIndex((m) => m && String(m.id) === String(missionId))
    if (dIdx >= 0 && shouldReplaceRocketImage(disp[dIdx].rocketImage, nextImage)) {
      patch[`displayedUpcomingMissions[${dIdx}].rocketImage`] = nextImage
    }
    if (Object.keys(patch).length) this.setData(patch)
  },

  _preloadVisibleRocketImages(list, n) {
    if (!Array.isArray(list) || !list.length) return
    const max = Math.max(0, Math.min(Number(n) || 0, list.length))
    if (!max) return

    const urls = []
    for (let i = 0; i < max; i++) {
      const item = list[i]
      const ru = item && (item.rocketImage || item.image)
      if (typeof ru === 'string' && /^https?:\/\//i.test(ru.trim())) {
        urls.push(ru.trim())
      }
    }
    if (urls.length) preloadRocketConfigMedia(urls)
  },

  _withResolvedRocketImage(mission) {
    if (!mission || typeof mission !== 'object') return mission
    // 与详情头图同源：始终 forceRecompute；保留 stamped 仅用于防 default 降级
    const stamped = mission.rocketImage || mission.image || ''
    const resolved = resolveMissionRocketImage(
      stamped,
      rocketNameForImage(mission),
      mission.rocketConfiguration,
      true
    )
    if (resolved === mission.rocketImage && resolved === mission.image) return mission
    return { ...mission, rocketImage: resolved, image: resolved }
  },

  async shareMission() {
    try {
      // TODO: 调用分享API
      await shareMission(this.data.launchData)

      wx.showShareMenu({
        withShareTicket: true,
        menus: ['shareAppMessage', 'shareTimeline']
      })
    } catch (error) {
      wx.showToast({
        title: '分享失败',
        icon: 'none'
      })
    }
  },

  onCountdownCardTap(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    this.viewMissionDetail(e)
  },

  onOverlapSideCardTap(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    this.viewMissionDetail(e)
  },
}

function attachTo(page) {
  if (page.__interactionAttached) return interactionMethods
  page.__interactionMethods = interactionMethods
  Object.keys(interactionMethods).forEach((key) => {
    page[key] = interactionMethods[key]
  })
  page.__interactionAttached = true
  return interactionMethods
}

module.exports = { attachTo, methods: interactionMethods }
