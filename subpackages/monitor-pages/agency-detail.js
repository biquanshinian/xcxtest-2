const { getAgencyDetail, resolveAgencyReference } = require('../../utils/api-monitor-data.js')
const { fetchAgencyLaunchCards } = require('./utils/agency-launch-cards.js')
const pageBase = require('../../utils/page-base.js')
const { translateAgencyName } = require('../../utils/space-terms-i18n.js')
const { togglePageTranslation } = require('../../utils/text-translate.js')
const { getRocketConfigMeta, getSpaceXLaunchStats } = require('../../utils/api-app-services.js')
const { ROUTES, navigateTo } = require('../../utils/routes.js')
const { overrideAgencyLogoUrl } = require('../../utils/agency-logo-overrides.js')
const { gateCheck, isProSync } = require('../../utils/membership.js')
const { checkShareEntryGate, warmShareEntitlement, withShareStampPath, withShareStampQuery } = require('./utils/share-gate.js')
const { isFavoriteAgency, toggleFavoriteAgency } = require('../../utils/agency-favorites.js')
const { runPullRefresh } = require('../../utils/pull-refresh.js')
const { isVideoUrl, videoSnapshotUrl } = require('../../utils/cos-url.js')
const { getCachedMediaImage } = require('../../utils/icon-cache.js')

/**
 * 机构 LL2 id → 事件更新推文账号（starship_event_updates.source）映射；
 * 仅命中映射的发射商详情页展示「事件更新」板块
 */
const AGENCY_TWEET_SOURCES = {
  121: ['SpaceX', 'Starlink', 'elonmusk', 'NASASpaceflight'], // SpaceX
  259: ['LandSpace_Tech'] // 蓝箭航天
}

/** 页内只预览最新 2 条，更多经标题右侧「查看更多」进事件更新列表页 */
const AGENCY_TWEETS_PREVIEW_COUNT = 2
// Artemis 遥测模块与本页同分包，可直接同步 require（监控中心是跨分包才用 require.async）
const artemisArow = require('./utils/artemis-arow.js')
const { artemisArow: ARTEMIS_AROW_CONFIG } = require('../../utils/config.js')

function formatAgencyDetail(agency) {
  if (!agency) return null

  const currentYear = new Date().getFullYear()
  const foundingYear = agency.founding_year || null
  const age = foundingYear ? Math.max(0, currentYear - foundingYear) : null
  const launchers = agency.launchers || ''
  const spacecraft = agency.spacecraft || ''
  const countryList = Array.isArray(agency.country) ? agency.country : []
  const countryNames = countryList.map(item => item && item.name).filter(Boolean)
  const countryCodes = countryList.map(item => item && item.alpha_2_code).filter(Boolean)
  // 保留 LL2 构型 id：火箭标签匹配族谱档案跳 rocket-model-detail，飞船标签跳 spacecraft-detail
  // LL2 按构型 id 返回，同名型号（如 Falcon 9 的多个 Block）会出现多条 → 按名称去重、合并 id
  const launcherList = []
  if (Array.isArray(agency.launcher_list)) {
    const byName = {}
    agency.launcher_list.forEach((entry) => {
      if (!entry || !entry.name) return
      if (byName[entry.name]) {
        if (entry.id != null) byName[entry.name].ids.push(entry.id)
        return
      }
      const rec = { name: entry.name, ids: entry.id != null ? [entry.id] : [], hasDetail: false, archiveId: null }
      byName[entry.name] = rec
      launcherList.push(rec)
    })
  }
  const spacecraftList = []
  const spacecraftRawById = {}
  if (Array.isArray(agency.spacecraft_list)) {
    const seen = {}
    agency.spacecraft_list.forEach((entry) => {
      if (!entry || !entry.name || seen[entry.name]) return
      seen[entry.name] = true
      spacecraftList.push({ id: entry.id != null ? entry.id : null, name: entry.name })
      // 内嵌对象已含全量详情字段，点击跳转时直传飞船详情页秒开
      if (entry.id != null) spacecraftRawById[String(entry.id)] = entry
    })
  }
  const socialLinks = Array.isArray(agency.social_media_links)
    ? agency.social_media_links.map((item) => {
      const social = item && item.social_media
      return {
        id: item && item.id,
        name: (social && social.name) || '社交媒体',
        url: item && item.url ? item.url : '',
        priority: item && item.priority != null ? item.priority : 999
      }
    }).filter(item => item.url).sort((a, b) => a.priority - b.priority)
    : []

  const vehicleTags = []
  if (launchers) launchers.split('|').map(s => s.trim()).filter(Boolean).forEach(t => vehicleTags.push(t))
  if (spacecraft) spacecraft.split('|').map(s => s.trim()).filter(Boolean).forEach(t => vehicleTags.push(t))
  launcherList.forEach((entry) => {
    if (!vehicleTags.includes(entry.name)) vehicleTags.push(entry.name)
  })
  spacecraftList.forEach((entry) => {
    if (!vehicleTags.includes(entry.name)) vehicleTags.push(entry.name)
  })

  // 计算成功率
  const totalLaunchCount = agency.total_launch_count != null ? agency.total_launch_count : null
  const successfulLaunches = agency.successful_launches != null ? agency.successful_launches : null
  const successRate = (totalLaunchCount && totalLaunchCount > 0 && successfulLaunches != null)
    ? Math.round((successfulLaunches / totalLaunchCount) * 100)
    : null

  // 计算着陆成功率
  const attemptedLandings = agency.attempted_landings != null ? agency.attempted_landings : null
  const successfulLandings = agency.successful_landings != null ? agency.successful_landings : null
  const landingRate = (attemptedLandings && attemptedLandings > 0 && successfulLandings != null)
    ? Math.round((successfulLandings / attemptedLandings) * 100)
    : null

  // 判断是否有着陆数据
  const hasLandingData = !!(
    successfulLandings ||
    attemptedLandings ||
    agency.consecutive_successful_launches ||
    agency.successful_landings_spacecraft ||
    agency.successful_landings_payload
  )

  const nameZh = translateAgencyName(agency.name, agency.abbrev)

  return {
    id: agency.id,
    // Hero/讨论区用中文名（词典命中时），"全称"行保留英文原名
    name: nameZh || agency.name || '未知机构',
    nameEn: agency.name || '未知机构',
    abbrev: agency.abbrev || '',
    typeName: agency.type ? agency.type.name : '未知',
    typeClass: ((agency.type && agency.type.name) || '').toLowerCase().replace(/\s+/g, '-'),
    featured: !!agency.featured,
    countryName: countryNames[0] || '',
    countryCode: countryCodes[0] || '',
    countryText: countryNames.join(' / ') || countryCodes.join(' / '),
    countryCount: countryNames.length || countryCodes.length,
    foundingYear,
    age,
    // SpaceX logo 全局统一（与全球发射统计页同源）
    logoUrl: overrideAgencyLogoUrl(agency, agency.logo ? (agency.logo.thumbnail_url || agency.logo.image_url) : ''),
    imageUrl: agency.image ? (agency.image.thumbnail_url || agency.image.image_url) : '',
    socialLogoUrl: agency.social_logo ? (agency.social_logo.thumbnail_url || agency.social_logo.image_url) : '',
    description: agency.description || '暂无简介',
    administrator: agency.administrator || '',
    // LL2 parent 可能是字符串或对象（含 name），统一取字符串
    parent: (agency.parent && agency.parent.name) || (typeof agency.parent === 'string' ? agency.parent : ''),
    infoUrl: agency.info_url || '',
    wikiUrl: agency.wiki_url || '',
    totalLaunchCount,
    successfulLaunches,
    failedLaunches: agency.failed_launches != null ? agency.failed_launches : null,
    pendingLaunches: agency.pending_launches != null ? agency.pending_launches : null,
    consecutiveSuccessfulLaunches: agency.consecutive_successful_launches != null ? agency.consecutive_successful_launches : null,
    consecutiveSuccessfulLandings: agency.consecutive_successful_landings != null ? agency.consecutive_successful_landings : null,
    successfulLandings,
    failedLandings: agency.failed_landings != null ? agency.failed_landings : null,
    attemptedLandings,
    successfulSpacecraftLandings: agency.successful_landings_spacecraft != null ? agency.successful_landings_spacecraft : null,
    failedSpacecraftLandings: agency.failed_landings_spacecraft != null ? agency.failed_landings_spacecraft : null,
    attemptedSpacecraftLandings: agency.attempted_landings_spacecraft != null ? agency.attempted_landings_spacecraft : null,
    successfulPayloadLandings: agency.successful_landings_payload != null ? agency.successful_landings_payload : null,
    failedPayloadLandings: agency.failed_landings_payload != null ? agency.failed_landings_payload : null,
    attemptedPayloadLandings: agency.attempted_landings_payload != null ? agency.attempted_landings_payload : null,
    launcherCount: launcherList.length || (launchers ? launchers.split('|').filter(s => s.trim()).length : 0),
    spacecraftCount: spacecraftList.length || (spacecraft ? spacecraft.split('|').filter(s => s.trim()).length : 0),
    launcherList,
    spacecraftList,
    _spacecraftRawById: spacecraftRawById,
    socialLinks,
    vehicleTags,
    successRate,
    landingRate,
    hasLandingData
  }
}

Page({
  behaviors: [pageBase],
  _fallbackTab: '/pages/monitor/monitor',
  data: {
    loading: true,
    errorMessage: '',
    item: null,
    // 即将发射 / 历史发射板块（复用首页规范缓存按发射商过滤）
    launchesLoading: false,
    agencyUpcoming: [],
    agencyHistory: [],
    upcomingVisible: [],
    historyVisible: [],
    // 收藏状态（我的太空「我的收藏」联动）
    isFavorited: false,
    heroImageLoaded: false,
    partialData: false,
    partialMessage: '',
    navTitle: '发射商详情',
    shareTitle: '发射商详情 | 火星探索日志',
    statusBarHeight: 44,
    navPlaceholderHeight: 0,
    scrollRefreshing: false,
    tabBarReservedHeight: 0,
    menuButtonWidth: 88,
    descTranslated: false,
    descTranslating: false,
    descI18n: { agencyDesc: '' },
    // SpaceX 专属：回收方式统计（海上/陆地/消耗 + 一级回收率），其它发射商为 null 不展示
    spacexRecovery: null,
    // SpaceX 专属：手机直连星链 D2C 统计（自监控中心迁入）
    spacexD2C: null,
    d2cRecentExpanded: false,
    // NASA 专属：Artemis II 实时遥测（自监控中心迁入）
    artemisSectionVisible: false,
    artemisMissionPhase: 'active',
    artemisMissionSummary: null,
    artemisEndedExpanded: false,
    artemisLoading: false,
    artemisError: '',
    artemisMet: '',
    artemisVelocityKmh: '—',
    artemisDistEarthKm: '—',
    isProUser: false,
    // 事件更新（推文）：仅 AGENCY_TWEET_SOURCES 命中的机构展示，页内只预览 2 条
    agencyTweetsVisible: false,
    agencyTweets: [],
    agencyTweetsLoading: false
  },

  /** 机构简介「翻译/原文」 */
  onToggleDescTranslate() {
    if (this.data.descTranslating) return
    const item = this.data.item || {}
    togglePageTranslation(this, {
      switchKey: 'descTranslated',
      loadingKey: 'descTranslating',
      fields: [{ path: 'descI18n.agencyDesc', text: item.description || '' }]
    })
  },

  async onLoad(options) {
    // 小程序 AI 接力：领取 handoff payload（query 已含 id，payload 供首屏加速参考）
    try {
      const app = getApp()
      if (app && typeof app.takeAgentHandoff === 'function' && typeof this.getPageId === 'function') {
        this._agentHandoff = app.takeAgentHandoff(this.getPageId())
      }
    } catch (e) {}

    const id = options.id ? String(options.id).trim() : ''
    const name = options.name ? decodeURIComponent(String(options.name)).trim() : ''
    const abbrev = options.abbrev ? decodeURIComponent(String(options.abbrev)).trim() : ''
    this.initUiShell()

    // 分享卡片 24h 免门控窗口：过期后走 gateCheck（会员放行，非会员弹开通引导）
    const shareAllowed = await checkShareEntryGate(this, options, 'agency_encyclopedia', '全球发射商图鉴')
    if (!shareAllowed) {
      this.setData({ loading: false, errorMessage: '分享链接已过期，开通星际通行证后可继续查看' })
      return
    }
    warmShareEntitlement(this, 'agency_encyclopedia')

    if (!id && !name && !abbrev) {
      this.setData({ loading: false, errorMessage: '缺少发射商参数，请返回重试' })
      return
    }

    await this.loadDetail({ id, name, abbrev })
  },

  async resolveAgencyId(params = {}) {
    const resolved = await resolveAgencyReference({
      agencyId: params.id,
      agencyName: params.name,
      agencyAbbrev: params.abbrev
    })
    return resolved && resolved.id ? resolved : null
  },

  async loadDetail(params = {}) {
    const requestParams = typeof params === 'string'
      ? { id: params }
      : (params || {})
    const _tag = '[agency-detail]'
    // silent（下拉刷新）：已有内容时不回退到加载骨架，只显示微信原生刷新指示器
    const silentRefresh = !!(requestParams.silent && this.data.item)
    if (!silentRefresh) {
      this.setData({
        loading: true,
        errorMessage: '',
        heroImageLoaded: false,
        partialData: false,
        partialMessage: '',
        descTranslated: false,
        descTranslating: false,
        descI18n: { agencyDesc: '' },
        spacexRecovery: null,
        spacexD2C: null,
        d2cRecentExpanded: false,
        artemisSectionVisible: false
      })
      this._clearArtemisPoll()
      this._textTranslateCache = null
    }
    try {
      const resolved = await this.resolveAgencyId(requestParams)
      if (!resolved || !resolved.id) {
        throw new Error('未找到对应的发射商信息')
      }
      const data = await getAgencyDetail(resolved.id, { skipLocalCache: !!requestParams.skipLocalCache })
      if (!data) {
        throw new Error('未获取到发射商数据')
      }
      const item = formatAgencyDetail(data)
      // 原始飞船构型对象仅存内存（体积大，不进 setData），跳转时直传详情页秒开
      this._spacecraftRawById = (item && item._spacecraftRawById) || {}
      if (item) delete item._spacecraftRawById
      const partialData = !!(data && data.__partial)
      const partialMessage = partialData && data.__partialMessage
        ? data.__partialMessage
        : '当前先展示机构基础信息，统计与扩展资料将在云端详情同步完成后补齐。'
      this.setData({
        loading: false,
        item,
        partialData,
        partialMessage: partialData ? partialMessage : '',
        isFavorited: isFavoriteAgency(item && item.id),
        navTitle: '发射商详情',
        shareTitle: `${(item && item.name) || '发射商详情'} | 火星探索日志`
      })
      this._markLauncherArchives()
      this._loadSpacexRecoveryStats(item)
      this._initArtemisSection(item)
      this._loadAgencyLaunches(item)
      this._loadAgencyTweets(item)
    } catch (error) {
      console.error(_tag, '❌ 加载发射商详情失败:', error)

      // 缓存未命中且有名称参数时，用已知信息构建最小化展示
      if (error && error.type === 'cache_miss' && (requestParams.name || requestParams.abbrev)) {
        const minimalItem = formatAgencyDetail({
          id: requestParams.id || null,
          name: requestParams.name || requestParams.abbrev || '未知机构',
          abbrev: requestParams.abbrev || '',
          type: null,
          country: [],
          founding_year: null,
          description: '该发射商的详细资料正在云端同步中，部分数据暂时无法展示。请稍后重新打开此页面查看完整信息。',
          total_launch_count: null,
          successful_launches: null,
          failed_launches: null,
          pending_launches: null,
          attempted_landings: null,
          successful_landings: null
        })
        this.setData({
          loading: false,
          item: minimalItem,
          partialData: true,
          partialMessage: '完整数据正在云端同步，当前仅展示基础信息。稍后重新打开即可查看完整统计与扩展资料。',
          navTitle: '发射商详情',
          shareTitle: `${requestParams.name || '发射商详情'} | 火星探索日志`
        })
        return
      }

      let errorMessage = '发射商详情加载失败，请稍后重试'
      if (error && error.statusCode === 429) {
        errorMessage = 'API请求频率超限，请稍后再试。数据已缓存，请等待缓存更新。'
      } else if (error && error.type === 'cache_miss') {
        errorMessage = '数据暂不可用，请稍后再试。数据由云函数定时同步，请等待更新。'
      } else if (error && (error.errMsg || error.message)) {
        errorMessage = error.errMsg || error.message
      }
      
      this.setData({
        loading: false,
        errorMessage,
        partialData: false,
        partialMessage: ''
      })
    }
  },

  /**
   * 即将发射 / 历史发射板块：复用首页 limit=100 规范缓存（云函数后台刷新，不直连 LL2），
   * 客户端按发射商过滤。异步执行不阻塞首屏。
   */
  async _loadAgencyLaunches(item) {
    if (!item || (item.id == null && !item.abbrev)) return
    const agencyKey = { id: item.id, abbrev: item.abbrev || '' }
    this.setData({ launchesLoading: true })
    // 两个列表相互独立，一个失败不影响另一个（fetchAgencyLaunchCards 内部兜底空数组）
    const [upcoming, history] = await Promise.all([
      fetchAgencyLaunchCards(agencyKey, 'upcoming'),
      fetchAgencyLaunchCards(agencyKey, 'completed')
    ])
    // 页面已切换到其它发射商（下拉刷新/重试）时丢弃过期结果
    const current = this.data.item
    if (!current || String(current.id) !== String(item.id)) return

    this.setData({
      launchesLoading: false,
      agencyUpcoming: upcoming,
      agencyHistory: history,
      upcomingVisible: upcoming.slice(0, 2),
      historyVisible: history.slice(0, 2)
    })
  },

  // ========== 事件更新（推文，仅 SpaceX / 蓝箭等映射机构） ==========

  /** 推文记录 → 展示卡片（时间文本 + 头像缓存 + 图片缩略，最多 3 张） */
  _enrichAgencyTweet(item) {
    const pad = n => String(n).padStart(2, '0')
    let timeText = ''
    if (item.publishedAt) {
      const d = new Date(item.publishedAt)
      timeText = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes())
    }
    // 图片缩略：图片直取，视频取缩略图（无缩略图的 COS mp4 用数据万象截帧）
    const images = []
    ;(item.mediaList || []).forEach((m) => {
      if (images.length >= 3 || !m) return
      if (m.type === 'image' && m.url) {
        images.push(getCachedMediaImage(m.url, 'medium'))
      } else if (m.type === 'video') {
        let thumb = m.thumbnailUrl || ''
        if (!thumb && !m.isLongVideo && isVideoUrl(m.url)) thumb = videoSnapshotUrl(m.url, 1)
        if (thumb) images.push(getCachedMediaImage(thumb, 'none'))
      }
    })
    // 头像：代理地址视为无效（与 progress 页同口径）
    let avatar = item.authorAvatar || ''
    if (avatar && !avatar.includes('.cos.')) avatar = ''
    if (avatar) avatar = getCachedMediaImage(avatar, 'thumb')
    return {
      _id: item._id,
      author: item.author || item.source || '',
      authorAvatar: avatar,
      content: item.content || item.title || '',
      publishedAtText: timeText,
      images
    }
  },

  /** 加载最新 2 条推文预览，映射未命中直接隐藏板块 */
  async _loadAgencyTweets(item) {
    const sources = item && item.id != null ? AGENCY_TWEET_SOURCES[item.id] : null
    if (!sources || !sources.length) {
      this.setData({ agencyTweetsVisible: false, agencyTweets: [] })
      return
    }
    this._tweetSources = sources
    this.setData({ agencyTweetsVisible: true, agencyTweetsLoading: true, agencyTweets: [] })
    try {
      const db = wx.cloud.database()
      const _ = db.command
      const res = await db.collection('starship_event_updates')
        .where({ status: 'published', source: _.in(sources) })
        .orderBy('publishedAt', 'desc')
        .limit(AGENCY_TWEETS_PREVIEW_COUNT)
        .get()
      // 页面已切换到其它发射商时丢弃过期结果
      const current = this.data.item
      if (!current || String(current.id) !== String(item.id)) return
      const rows = (res.data || []).map(t => this._enrichAgencyTweet(t))
      this.setData({
        agencyTweets: rows,
        agencyTweetsLoading: false
      })
    } catch (e) {
      console.warn('[agency-detail] 事件更新加载失败:', e)
      this.setData({ agencyTweetsLoading: false })
    }
  },

  /** 标题右侧「查看更多」→ 事件更新列表页（按本机构账号过滤） */
  onViewAllAgencyTweets() {
    const sources = this._tweetSources
    if (!sources || !sources.length) return
    try { wx.vibrateShort({ type: 'medium' }) } catch (e) {}
    navigateTo(ROUTES.EVENT_DETAIL, {
      mode: 'list_all',
      sources: sources.join(','),
      label: (this.data.item && this.data.item.name) || ''
    })
  },

  /** 点推文卡片 → 事件详情页 */
  onAgencyTweetTap(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    navigateTo(ROUTES.EVENT_DETAIL, { id })
  },

  /** 查看全部 → 独立任务列表页（有独立路径，便于分享） */
  _goAgencyLaunches(type) {
    const item = this.data.item
    if (!item || item.id == null) return
    try { wx.vibrateShort({ type: 'medium' }) } catch (e) {}
    navigateTo(ROUTES.AGENCY_LAUNCHES, {
      id: item.id,
      name: item.name || '',
      abbrev: item.abbrev || '',
      type
    })
  },

  /** 「发射统计」板块整体点击 → 全球发射统计（门控口径与首页日历/任务详情页一致） */
  async onGoGlobalLaunchStats() {
    try { wx.vibrateShort({ type: 'medium' }) } catch (e) {}
    // 专属 id 不在 PRODUCTS 单品表内 → 门控弹窗只提供开通星际通行证，无永久购买
    const allowed = await gateCheck('global_launch_stats', '全球发射统计')
    if (!allowed) return
    navigateTo(ROUTES.GLOBAL_LAUNCH_STATS)
  },

  /** 「回收统计」板块整体点击 → 助推器族谱（与监控中心入口一致：页面入口不门控，页内点卡片才门控） */
  onGoBoosterGenealogy() {
    try { wx.vibrateShort({ type: 'medium' }) } catch (e) {}
    navigateTo(ROUTES.BOOSTER_GENEALOGY)
  },

  onViewAllUpcoming() {
    this._goAgencyLaunches('upcoming')
  },

  onViewAllHistory() {
    this._goAgencyLaunches('completed')
  },

  /** 收藏星标：切换收藏状态并同步到「我的太空 · 我的收藏」 */
  onToggleFavorite() {
    const item = this.data.item
    if (!item || item.id == null) {
      wx.showToast({ title: '数据加载中，请稍后', icon: 'none' })
      return
    }
    try { wx.vibrateShort({ type: 'medium' }) } catch (e) {}
    const favorited = toggleFavoriteAgency({
      id: item.id,
      name: item.name || '',
      abbrev: item.abbrev || '',
      logoUrl: item.logoUrl || '',
      typeName: item.typeName || ''
    })
    this.setData({ isFavorited: favorited })
    wx.showToast({ title: favorited ? '已收藏' : '已取消收藏', icon: 'none' })
  },

  /** 任务卡片 → 任务详情页（data-type 区分 upcoming/completed） */
  onTapAgencyLaunch(e) {
    const ds = (e.currentTarget && e.currentTarget.dataset) || {}
    if (!ds.id) return
    try { wx.vibrateShort({ type: 'medium' }) } catch (err) {}
    const type = ds.type === 'completed' ? 'completed' : 'upcoming'
    navigateTo(ROUTES.MISSION_DETAIL, { id: ds.id, type })
  },

  /** SpaceX 专属：加载回收方式统计 + 手机直连星链 D2C（复用监控中心预计算数据，零额外云调用） */
  async _loadSpacexRecoveryStats(item) {
    const isSpaceX = item && (item.id === 121 || item.abbrev === 'SpX' || item.nameEn === 'SpaceX')
    if (!isSpaceX) return
    try {
      const stats = await getSpaceXLaunchStats()
      const updates = {}
      const r = stats && stats.recoveryStats
      if (r && r.total) {
        const total = r.total || 1
        const droneshipDeg = Math.round((r.droneship / total) * 360)
        updates.spacexRecovery = {
          ...r,
          droneshipDeg,
          landingZoneDeg: droneshipDeg + Math.round((r.landingZone / total) * 360),
          droneshipPct: Math.round(r.droneship / total * 100),
          landingZonePct: Math.round(r.landingZone / total * 100),
          expendedPct: Math.round(r.expended / total * 100),
          recoveryRatePct: ((r.droneship + r.landingZone) / total * 100).toFixed(1)
        }
      }
      const d2c = stats && stats.d2cStats
      if (d2c && d2c.starlinkTotal > 0) {
        updates.spacexD2C = d2c
      }
      if (Object.keys(updates).length) this.setData(updates)
    } catch (e) {}
  },

  /** D2C 最近任务折叠切换 */
  toggleD2CRecent() {
    this.setData({ d2cRecentExpanded: !this.data.d2cRecentExpanded })
  },

  // ========== NASA 专属：Artemis II 实时遥测（自监控中心迁入） ==========

  /** 仅 NASA 详情页展示；active 阶段自动拉取遥测并轮询 */
  _initArtemisSection(item) {
    const isNasa = item && (item.id === 44 || item.abbrev === 'NASA')
    if (!isNasa || !artemisArow.shouldShowArtemisArowSection()) {
      this._clearArtemisPoll()
      if (this.data.artemisSectionVisible) this.setData({ artemisSectionVisible: false })
      return
    }
    const phase = artemisArow.getArtemisMissionPhase()
    const patch = {
      artemisSectionVisible: true,
      artemisMissionPhase: phase,
      isProUser: isProSync()
    }
    if (phase !== 'active') patch.artemisMissionSummary = artemisArow.getArtemisMissionSummary()
    this.setData(patch)
    if (phase === 'active') {
      this.refreshArtemisBriefing(true)
      this._scheduleArtemisPoll()
    } else {
      this._clearArtemisPoll()
    }
  },

  async retryArtemisBriefing() {
    try {
      await this.refreshArtemisBriefing(true)
      if (!this.data.artemisError) {
        this._scheduleArtemisPoll()
      }
    } catch (_e) {
      this.setData({
        artemisLoading: false,
        artemisError: '模块加载失败，请稍后重试'
      })
    }
  },

  _scheduleArtemisPoll() {
    if (!artemisArow.shouldShowArtemisArowSection()) return
    this._clearArtemisPoll()
    const cfg = ARTEMIS_AROW_CONFIG || {}
    const ms = Math.max(12000, Number(cfg.pollIntervalMs) || 15000)
    this._artemisPollTimer = setInterval(() => {
      this.refreshArtemisBriefing(false)
    }, ms)
  },

  _clearArtemisPoll() {
    if (this._artemisPollTimer) {
      clearInterval(this._artemisPollTimer)
      this._artemisPollTimer = null
    }
    this._stopArtemisInterp()
  },

  async refreshArtemisBriefing(showLoading) {
    if (!artemisArow.shouldShowArtemisArowSection() || artemisArow.getArtemisMissionPhase() !== 'active') {
      this._clearArtemisPoll()
      return
    }
    // 竞态保护：轮询/手动刷新/onShow 可能并发触发，旧响应不得覆盖新响应
    const seq = (this._artemisFetchSeq = (this._artemisFetchSeq || 0) + 1)
    if (showLoading) {
      this.setData({ artemisLoading: true, artemisError: '' })
    }
    try {
      const data = await artemisArow.fetchArtemisIiBriefing()
      if (seq !== this._artemisFetchSeq) return
      if (!data || !data.ok) {
        this.setData({
          artemisLoading: false,
          artemisError: (data && data.error) ? String(data.error) : '数据不可用'
        })
        return
      }
      const fmtInt = (n) => {
        if (!Number.isFinite(n)) return '—'
        return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
      }

      this.setData({
        artemisLoading: false,
        artemisError: '',
        artemisMet: data.missionElapsedText || '—',
        artemisVelocityKmh: fmtInt(data.velocityKmh),
        artemisDistEarthKm: fmtInt(data.distanceFromEarthKm)
      })

      // 保存原始数值用于插值
      this._artemisRaw = {
        velocityKmh: data.velocityKmh || 0,
        distEarthKm: data.distanceFromEarthKm || 0,
        snapshotMs: Date.now()
      }
      // 启动每秒插值（卡片上 MET + 速率 + 距地）
      this._startArtemisInterp()
    } catch (_e) {
      if (seq !== this._artemisFetchSeq) return
      this.setData({
        artemisLoading: false,
        artemisError: '网络异常，请稍后重试'
      })
    }
  },

  /** 每秒插值：基于速率推算距离变化，MET 精确到秒 */
  _startArtemisInterp() {
    this._stopArtemisInterp()
    const launchMs = artemisArow.getArtemisLaunchMs()
    const pad2 = (n) => String(n).padStart(2, '0')
    const fmtInt = (n) => {
      if (!Number.isFinite(n)) return '—'
      return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    }

    // 立即执行一次
    this._artemisInterpTick(launchMs, pad2, fmtInt)

    this._artemisInterpTimer = setInterval(() => {
      this._artemisInterpTick(launchMs, pad2, fmtInt)
    }, 1000)
  },

  _artemisInterpTick(launchMs, pad2, fmtInt) {
    const raw = this._artemisRaw
    if (!raw) return
    const now = Date.now()
    const dtS = (now - raw.snapshotMs) / 1000

    // MET 精确到秒
    let met = '—'
    if (isFinite(launchMs) && now >= launchMs) {
      let s = Math.floor((now - launchMs) / 1000)
      const d = Math.floor(s / 86400); s -= d * 86400
      const h = Math.floor(s / 3600); s -= h * 3600
      const m = Math.floor(s / 60); s -= m * 60
      met = pad2(d) + ':' + pad2(h) + ':' + pad2(m) + ':' + pad2(s)
    }

    const vKmS = raw.velocityKmh / 3600
    const distEarth = raw.distEarthKm + vKmS * dtS

    // 只下发有变化的字段（速率两次快照之间不变，距地公里数取整后也常不变）
    const velocityText = fmtInt(raw.velocityKmh)
    const distText = fmtInt(distEarth)
    const patch = {}
    if (this.data.artemisMet !== met) patch.artemisMet = met
    if (this.data.artemisVelocityKmh !== velocityText) patch.artemisVelocityKmh = velocityText
    if (this.data.artemisDistEarthKm !== distText) patch.artemisDistEarthKm = distText
    if (Object.keys(patch).length) this.setData(patch)
  },

  _stopArtemisInterp() {
    if (this._artemisInterpTimer) {
      clearInterval(this._artemisInterpTimer)
      this._artemisInterpTimer = null
    }
  },

  async goArtemisDetail() {
    const allowed = await gateCheck('artemis_telemetry', 'Artemis 遥测面板')
    if (!allowed) return
    navigateTo(ROUTES.ARTEMIS_DETAIL)
  },

  toggleArtemisEnded() {
    this.setData({ artemisEndedExpanded: !this.data.artemisEndedExpanded })
  },

  onShow() {
    // 返回本页时恢复遥测轮询（active 阶段）
    if (this.data.artemisSectionVisible && this.data.artemisMissionPhase === 'active') {
      this._scheduleArtemisPoll()
      this.refreshArtemisBriefing(false)
    }
  },

  onHide() {
    this._clearArtemisPoll()
  },

  onUnload() {
    this._clearArtemisPoll()
  },

  /** 火箭型号标签：同名标签的多个构型 id 逐个匹配族谱 _config_meta，命中的标记为可跳转 */
  async _markLauncherArchives() {
    const list = (this.data.item && this.data.item.launcherList) || []
    if (!list.length) return
    try {
      const meta = await getRocketConfigMeta()
      const configs = (meta && meta.configs) || {}
      const kv = {}
      list.forEach((entry, i) => {
        const hit = (entry.ids || []).find(id => configs[String(id)])
        if (hit != null) {
          kv[`item.launcherList[${i}].hasDetail`] = true
          kv[`item.launcherList[${i}].archiveId`] = hit
        }
      })
      if (Object.keys(kv).length) this.setData(kv)
    } catch (e) {}
  },

  /** 火箭型号标签点击：有族谱档案时跳火箭型号详情页 */
  onTapLauncher(e) {
    const ds = e.currentTarget.dataset
    if (ds.cid == null || ds.cid === '') return
    navigateTo(ROUTES.ROCKET_MODEL_DETAIL, { configId: ds.cid })
  },

  /** 飞船型号标签点击：跳飞船详情页（内嵌详情对象直传，免请求秒开） */
  onTapSpacecraft(e) {
    const ds = e.currentTarget.dataset
    if (ds.cid == null || ds.cid === '') return
    const raw = (this._spacecraftRawById && this._spacecraftRawById[String(ds.cid)]) || null
    if (raw) {
      const app = getApp && getApp()
      if (app) app._spacecraftDetailData = raw
    }
    navigateTo(ROUTES.SPACECRAFT_DETAIL, { id: ds.cid, name: ds.name || '' })
  },

  retryLoad() {
    const pages = getCurrentPages()
    const currentPage = pages[pages.length - 1]
    const options = (currentPage && currentPage.options) || {}
    const id = options.id ? String(options.id).trim() : ''
    const name = options.name ? decodeURIComponent(String(options.name)).trim() : ''
    const abbrev = options.abbrev ? decodeURIComponent(String(options.abbrev)).trim() : ''
    if (!id && !name && !abbrev) return
    this.loadDetail({ id, name, abbrev })
  },

  /** 原生三点下拉刷新：跳过本地缓存重读云缓存，绝不直接触发 LL2 */
  onScrollRefresh() {
    this._runAgencyDetailPullRefresh('scrollRefreshing')
  },

  onPullDownRefresh() {
    this._runAgencyDetailPullRefresh()
  },

  _runAgencyDetailPullRefresh(key) {
    const pages = getCurrentPages()
    const currentPage = pages[pages.length - 1]
    const options = (currentPage && currentPage.options) || {}
    const id = options.id ? String(options.id).trim() : ''
    const name = options.name ? decodeURIComponent(String(options.name)).trim() : ''
    const abbrev = options.abbrev ? decodeURIComponent(String(options.abbrev)).trim() : ''
    runPullRefresh(this, () => {
      if (!id && !name && !abbrev) return Promise.resolve()
      return this.loadDetail({ id, name, abbrev, skipLocalCache: true, silent: true })
    }, key)
  },

  // goBack inherited from pageBase

  onHeroImageLoad() {
    this.setData({ heroImageLoaded: true })
  },

  /** 点击头图全屏预览（与火箭型号详情页一致） */
  onHeroImageTap() {
    const item = this.data.item
    if (item && item.imageUrl) {
      wx.previewImage({ current: item.imageUrl, urls: [item.imageUrl] })
    }
  },

  onHeroImageError() {
    this.setData({
      heroImageLoaded: false,
      'item.imageUrl': ''
    })
  },

  copyLink(e) {
    const url = e.currentTarget.dataset.url
    if (!url) return
    wx.setClipboardData({
      data: url,
      success: () => {
        wx.showToast({ title: '链接已复制', icon: 'none' })
      }
    })
  },

  onShareAppMessage() {
    const item = this.data.item
    return {
      title: this.data.shareTitle,
      path: item
        ? withShareStampPath(`/subpackages/monitor-pages/agency-detail?id=${item.id}`, this)
        : '/pages/monitor/monitor'
    }
  },

  onShareTimeline() {
    const item = this.data.item
    return {
      title: this.data.shareTitle,
      query: item ? withShareStampQuery(`id=${item.id}`, this) : ''
    }
  }
})
