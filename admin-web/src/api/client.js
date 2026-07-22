const DEFAULT_API_BASE = 'https://cloud1-9gdqgdt5bfaa20fb-1397421562.ap-shanghai.app.tcloudbase.com/admin'
const API_BASE = import.meta.env.VITE_ADMIN_API_BASE || DEFAULT_API_BASE

function getUser() {
  try {
    const raw = localStorage.getItem('admin_user')
    return raw ? JSON.parse(raw) : null
  } catch (e) {
    return null
  }
}

function clearAuth() {
  localStorage.removeItem('admin_token')
  localStorage.removeItem('admin_user')
}

function hasRole(minRole) {
  const user = getUser()
  const role = user?.role || 'viewer'
  const rank = { viewer: 1, reviewer: 2, editor: 3, super_admin: 4 }
  return (rank[role] || 0) >= (rank[minRole] || 0)
}

async function request(path, { method = 'GET', query, body } = {}) {
  const token = localStorage.getItem('admin_token')
  if (!API_BASE) {
    throw new Error('管理端 API 地址未配置（VITE_ADMIN_API_BASE）')
  }
  const url = API_BASE

  const payload = {
    path,
    method,
    query: query || {},
    body: body || {},
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  }

  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify(payload)
  })

  const data = await res.json()
  if (data.code === 4010) {
    clearAuth()
    window.location.href = '/#/login'
    throw new Error('登录已过期，请重新登录')
  }
  if (data.code !== 0) {
    const err = new Error(data.message || '请求失败')
    err.code = data.code
    err.data = data.data || null
    throw err
  }
  return data.data
}

function hasPermission(mod) {
  const user = getUser()
  if (!user) return false
  if (user.role === 'super_admin') return true
  const perms = user.permissions || []
  return perms.includes(mod)
}

export const auth = {
  getUser,
  clearAuth,
  hasRole,
  hasPermission
}

export const api = {
  getCaptcha() {
    return request('/auth/captcha', { method: 'GET' })
  },
  login(body) {
    return request('/auth/login', { method: 'POST', body })
  },
  dashboardOverview() {
    return request('/dashboard/overview', { method: 'GET' })
  },
  listEvents(query) {
    return request('/news/events', { method: 'GET', query })
  },
  createEvent(body) {
    return request('/news/events', { method: 'POST', body })
  },
  updateEvent(id, body) {
    return request(`/news/events/${id}`, { method: 'PUT', body })
  },
  deleteEvent(id) {
    return request(`/news/events/${id}`, { method: 'DELETE' })
  },
  listArticles(query) {
    return request('/news/articles', { method: 'GET', query })
  },
  createArticle(body) {
    return request('/news/articles', { method: 'POST', body })
  },
  updateArticle(id, body) {
    return request(`/news/articles/${id}`, { method: 'PUT', body })
  },
  deleteArticle(id) {
    return request(`/news/articles/${id}`, { method: 'DELETE' })
  },
  getNewsManualConfig() {
    return request('/news-manual-config', { method: 'GET' })
  },
  updateNewsManualConfig(body) {
    return request('/news-manual-config', { method: 'PUT', body })
  },
  getRoadClosure() {
    return request('/road-closure', { method: 'GET' })
  },
  updateRoadClosure(body) {
    return request('/road-closure', { method: 'PUT', body })
  },
  syncRoadClosure() {
    return request('/road-closure/sync', { method: 'POST' })
  },
  deleteRoadClosureItem(id) {
    return request(`/road-closure/${id}`, { method: 'DELETE' })
  },
  getStarshipStatus() {
    return request('/starship/status', { method: 'GET' })
  },
  updateStarshipStatus(body) {
    return request('/starship/status', { method: 'PUT', body })
  },
  getNsfChecklistAdmin() {
    return request('/starship/nsf-checklist', { method: 'GET' })
  },
  updateNsfChecklistOverrides(body) {
    return request('/starship/nsf-checklist/overrides', { method: 'PUT', body })
  },
  getStarshipSplash() {
    return request('/starship/splash', { method: 'GET' })
  },
  updateStarshipSplash(body) {
    return request('/starship/splash', { method: 'PUT', body })
  },
  listChecklistHistory(query) {
    return request('/starship/checklist-history', { method: 'GET', query })
  },
  getChecklistHistory(id) {
    return request(`/starship/checklist-history/${id}`, { method: 'GET' })
  },
  deleteChecklistHistory(id) {
    return request(`/starship/checklist-history/${id}`, { method: 'DELETE' })
  },
  getCarouselGlobalEnabled() {
    return request('/carousel/global-enabled', { method: 'GET' })
  },
  setCarouselGlobalEnabled(body) {
    return request('/carousel/global-enabled', { method: 'PUT', body })
  },
  listCarousel() {
    return request('/carousel', { method: 'GET' })
  },
  createCarousel(body) {
    return request('/carousel', { method: 'POST', body })
  },
  updateCarousel(id, body) {
    return request(`/carousel/${id}`, { method: 'PUT', body })
  },
  deleteCarousel(id) {
    return request(`/carousel/${id}`, { method: 'DELETE' })
  },
  syncAutoCarousel() {
    return request('/carousel/sync-auto', { method: 'POST' })
  },
  listUsers(query) {
    return request('/users', { method: 'GET', query })
  },
  restoreUser(id) {
    return request(`/users/${id}/restore`, { method: 'POST' })
  },
  createUser(body) {
    return request('/users', { method: 'POST', body })
  },
  updateUser(id, body) {
    return request(`/users/${id}`, { method: 'PUT', body })
  },
  getUserById(id, query = {}) {
    return request(`/users/${id}`, { method: 'GET', query })
  },
  deleteUser(id, body = {}) {
    return request(`/users/${id}`, { method: 'DELETE', body })
  },
  listLogs(query) {
    return request('/logs', { method: 'GET', query })
  },
  getLogsStats() {
    return request('/logs/stats', { method: 'GET' })
  },
  cleanLogs(beforeDays) {
    return request('/logs/clean', { method: 'POST', body: { beforeDays } })
  },
  getMenuUnread(lastReadMap, modules) {
    const query = {}
    try { query.lastReadMap = JSON.stringify(lastReadMap || {}) } catch (e) { query.lastReadMap = '{}' }
    if (Array.isArray(modules) && modules.length) query.modules = modules.join(',')
    return request('/logs/unread-by-module', { method: 'GET', query })
  },
  cosProxyUpload(body) {
    return request('/cos/proxy-upload', { method: 'POST', body })
  },
  cosPresign(body) {
    return request('/cos/presign', { method: 'POST', body })
  },
  cosCreateFolder(body) {
    return request('/cos/folder', { method: 'POST', body })
  },
  cosListFiles(query) {
    return request('/cos/list', { method: 'GET', query })
  },
  cosDeleteFile(body) {
    return request('/cos/file', { method: 'DELETE', body })
  },
  syncRocketMediaCosIndex() {
    return request('/rocket-config/sync-cos-index', { method: 'POST' })
  },
  listMediaAssets(query) {
    return request('/media-assets', { method: 'GET', query })
  },
  createMediaAsset(body) {
    return request('/media-assets', { method: 'POST', body })
  },
  updateMediaAsset(id, body) {
    return request(`/media-assets/${id}`, { method: 'PUT', body })
  },
  deleteMediaAsset(id) {
    return request(`/media-assets/${id}`, { method: 'DELETE' })
  },
  batchUpdateMediaAssets(body) {
    return request('/media-assets/batch', { method: 'POST', body })
  },
  listMediaFeed(query) {
    return request('/media-feed', { method: 'GET', query })
  },
  createMediaFeed(body) {
    return request('/media-feed', { method: 'POST', body })
  },
  updateMediaFeed(id, body) {
    return request(`/media-feed/${id}`, { method: 'PUT', body })
  },
  deleteMediaFeed(id) {
    return request(`/media-feed/${id}`, { method: 'DELETE' })
  },
  batchUpdateMediaFeed(body) {
    return request('/media-feed/batch', { method: 'POST', body })
  },
  listShopFeed(query) {
    return request('/shop-feed', { method: 'GET', query })
  },
  createShopFeed(body) {
    return request('/shop-feed', { method: 'POST', body })
  },
  updateShopFeed(id, body) {
    return request(`/shop-feed/${id}`, { method: 'PUT', body })
  },
  deleteShopFeed(id) {
    return request(`/shop-feed/${id}`, { method: 'DELETE' })
  },
  batchUpdateShopFeed(body) {
    return request('/shop-feed/batch', { method: 'POST', body })
  },
  getPopupAdConfig() {
    return request('/popup-ad-config', { method: 'GET' })
  },
  updatePopupAdConfig(body) {
    return request('/popup-ad-config', { method: 'PUT', body })
  },
  listStarshipEvents(query) {
    return request('/starship-events', { method: 'GET', query })
  },
  createStarshipEvent(body) {
    return request('/starship-events', { method: 'POST', body })
  },
  updateStarshipEvent(id, body) {
    return request(`/starship-events/${id}`, { method: 'PUT', body })
  },
  deleteStarshipEvent(id) {
    return request(`/starship-events/${id}`, { method: 'DELETE' })
  },

  triggerSync() {
    return request('/system/sync', { method: 'POST', body: { scope: 'all' } })
  },
  cleanCache() {
    return request('/system/cache/clean', { method: 'POST' })
  },
  getPermissionModules() {
    return request('/permissions/modules', { method: 'GET' })
  },
  listPushSubscriptions(query) {
    return request('/push/subscriptions', { method: 'GET', query })
  },
  listPushHistory(query) {
    return request('/push/history', { method: 'GET', query })
  },
  triggerPush(body) {
    return request('/push/trigger', { method: 'POST', body })
  },
  listLaunchData(query) {
    return request('/launch-data', { method: 'GET', query })
  },
  getLaunchData(id) {
    return request(`/launch-data/${id}`, { method: 'GET' })
  },
  updateLaunchData(id, body) {
    return request(`/launch-data/${id}`, { method: 'PUT', body })
  },
  syncLaunchData() {
    return request('/launch-data/sync', { method: 'POST' })
  },
  cleanLaunchDataCache() {
    return request('/launch-data/clean', { method: 'POST' })
  },
  listTweetMonitor(query) {
    return request('/tweet-monitor', { method: 'GET', query })
  },
  getTweetSyncStatus() {
    return request('/tweet-monitor/status', { method: 'GET' })
  },
  syncTweets() {
    return request('/tweet-monitor/sync', { method: 'POST' })
  },
  listTweetAccounts() {
    return request('/tweet-monitor/accounts', { method: 'GET' })
  },
  addTweetAccount(body) {
    return request('/tweet-monitor/accounts', { method: 'POST', body })
  },
  deleteTweetAccount(id) {
    return request(`/tweet-monitor/accounts/${id}`, { method: 'DELETE' })
  },
  toggleTweetAccount(id, enabled) {
    return request(`/tweet-monitor/accounts/${id}/toggle`, { method: 'PUT', body: { enabled } })
  },
  getStatisticsOverview() {
    return request('/statistics/overview', { method: 'GET' })
  },
  getLiveConfig() {
    return request('/live', { method: 'GET' })
  },
  updateLiveConfig(body) {
    return request('/live', { method: 'PUT', body })
  },
  getChannelsLiveCoverConfig() {
    return request('/channels-live-config', { method: 'GET' })
  },
  updateChannelsLiveCoverConfig(body) {
    return request('/channels-live-config', { method: 'PUT', body })
  },
  getChannelsLiveFallbackGuide() {
    return request('/channels-live-fallback-guide', { method: 'GET' })
  },
  updateChannelsLiveFallbackGuide(body) {
    return request('/channels-live-fallback-guide', { method: 'PUT', body })
  },
  getDemoConfig() {
    return request('/demo-mode', { method: 'GET' })
  },
  updateDemoConfig(body) {
    return request('/demo-mode', { method: 'PUT', body })
  },
  sendDemoCommand(body) {
    return request('/demo-mode/command', { method: 'POST', body })
  },
  getDemoAudioUrls(scriptName) {
    return request('/demo-mode/audio', { method: 'GET', query: { scriptName } })
  },
  updateDemoAudioUrls(body) {
    return request('/demo-mode/audio', { method: 'PUT', body })
  },
  listCloudFunctions() {
    return request('/cloud-functions', { method: 'GET' })
  },
  triggerCloudFunction(name) {
    return request(`/cloud-functions/${name}/trigger`, { method: 'POST' })
  },
  getGlobalConfig() {
    return request('/global-config', { method: 'GET' })
  },
  updateGlobalConfig(body) {
    return request('/global-config', { method: 'PUT', body })
  },
  getOrbitalConfig() {
    return request('/orbital-config', { method: 'GET' })
  },
  updateOrbitalConfig(body) {
    return request('/orbital-config', { method: 'PUT', body })
  },
  getOrbitalConfig() {
    return request('/orbital-config', { method: 'GET' })
  },
  updateOrbitalConfig(body) {
    return request('/orbital-config', { method: 'PUT', body })
  },
  getYearReviewConfig() {
    return request('/year-review-config', { method: 'GET' })
  },
  updateYearReviewConfig(body) {
    return request('/year-review-config', { method: 'PUT', body })
  },
  rebuildYearReviewSnapshot(body) {
    return request('/year-review-config/rebuild-snapshot', { method: 'POST', body })
  },
  listAnnouncements(query) {
    return request('/announcements', { method: 'GET', query })
  },
  createAnnouncement(body) {
    return request('/announcements', { method: 'POST', body })
  },
  updateAnnouncement(id, body) {
    return request(`/announcements/${id}`, { method: 'PUT', body })
  },
  deleteAnnouncement(id) {
    return request(`/announcements/${id}`, { method: 'DELETE' })
  },
  exportData(body) {
    return request('/data-export', { method: 'POST', body })
  },
  // SpaceX 发射统计
  getSpaceXStats() {
    return request('/spacex-stats', { method: 'GET' })
  },
  updateSpaceXStats(body) {
    return request('/spacex-stats', { method: 'PUT', body })
  },
  syncSpaceXStats() {
    return request('/spacex-stats/sync', { method: 'POST' })
  },
  deleteSpaceXStatsItem(id) {
    return request(`/spacex-stats/${id}`, { method: 'DELETE' })
  },
  // 发射投票
  getVoteConfig() {
    return request('/vote-config', { method: 'GET' })
  },
  updateVoteConfig(body) {
    return request('/vote-config', { method: 'PUT', body })
  },
  listLaunchVotes(query) {
    return request('/launch-votes', { method: 'GET', query })
  },
  createLaunchVote(body) {
    return request('/launch-votes', { method: 'POST', body })
  },
  updateLaunchVote(id, body) {
    return request(`/launch-votes/${id}`, { method: 'PUT', body })
  },
  deleteLaunchVote(id) {
    return request(`/launch-votes/${id}`, { method: 'DELETE' })
  },
  rebuildLaunchVoteSettle(body = {}) {
    return request('/launch-votes/rebuild-settle', { method: 'POST', body })
  },
  // 月愿计划
  listLunarWishes(query) {
    return request('/lunar-wishes/list', { method: 'GET', query })
  },
  reviewLunarWish(body) {
    return request('/lunar-wishes/review', { method: 'POST', body })
  },
  batchReviewLunarWishes(body) {
    return request('/lunar-wishes/batch-review', { method: 'POST', body })
  },
  deleteLunarWish(body) {
    return request('/lunar-wishes/delete', { method: 'POST', body })
  },
  exportLunarWishes() {
    return request('/lunar-wishes/export', { method: 'GET' })
  },
  lunarWishesStats() {
    return request('/lunar-wishes/stats', { method: 'GET' })
  },
  // 里程碑彩蛋
  listMilestoneRewards(query) {
    return request('/milestone-rewards', { method: 'GET', query })
  },
  createMilestoneReward(body) {
    return request('/milestone-rewards', { method: 'POST', body })
  },
  updateMilestoneReward(id, body) {
    return request(`/milestone-rewards/${id}`, { method: 'PUT', body })
  },
  deleteMilestoneReward(id) {
    return request(`/milestone-rewards/${id}`, { method: 'DELETE' })
  },
  listMilestoneClaims(query) {
    return request('/milestone-claims', { method: 'GET', query })
  },
  updateMilestoneClaimStatus(id, body) {
    return request(`/milestone-claims/${id}`, { method: 'PUT', body })
  },
  deleteMilestoneClaim(id) {
    return request(`/milestone-claims/${id}`, { method: 'DELETE' })
  },
  // 知识卡
  listKnowledgeCards(query) {
    return request('/knowledge-cards', { method: 'GET', query })
  },
  createKnowledgeCard(body) {
    return request('/knowledge-cards', { method: 'POST', body })
  },
  updateKnowledgeCard(id, body) {
    return request(`/knowledge-cards/${id}`, { method: 'PUT', body })
  },
  deleteKnowledgeCard(id) {
    return request(`/knowledge-cards/${id}`, { method: 'DELETE' })
  },
  batchImportKnowledgeCards(body) {
    return request('/knowledge-cards/batch-import', { method: 'POST', body })
  },
  getMembershipList() {
    return request('/membership/list', { method: 'GET' })
  },
  updateMembershipProWhitelist(openids) {
    return request('/membership/pro-whitelist', { method: 'PUT', body: { openids } })
  },
  listMembershipOrders(query) {
    return request('/membership/orders', { method: 'GET', query })
  },
  exportMembershipOrders(query) {
    return request('/membership/orders/export', { method: 'GET', query })
  },
  recheckPendingMembershipOrders() {
    return request('/membership/orders/recheck-pending', { method: 'POST' })
  },
  grantMembershipPro(body) {
    return request('/membership/grant-pro', { method: 'POST', body })
  },
  refundMembershipOrder(body) {
    return request('/membership/refund', { method: 'POST', body })
  },
  updateVPayConfig(body) {
    return request('/membership/vpay-config', { method: 'PUT', body })
  },
  getMembershipSkuPrices() {
    return request('/membership/sku-prices', { method: 'GET' })
  },
  updateMembershipSkuPrices(prices) {
    return request('/membership/sku-prices', { method: 'PUT', body: { prices } })
  },
  getInviteStats() {
    return request('/invites/stats', { method: 'GET' })
  },
  listInviteRecords(query) {
    return request('/invites/records', { method: 'GET', query })
  },
  getBilibiliAutoPublish() {
    return request('/bilibili-auto-publish', { method: 'GET' })
  },
  updateBilibiliAutoPublish(body) {
    return request('/bilibili-auto-publish', { method: 'PUT', body })
  },
  enqueueBilibiliPublish() {
    return request('/bilibili-auto-publish/enqueue', { method: 'POST' })
  },
  listBilibiliTopics(query) {
    return request('/bilibili-topics', { method: 'GET', query })
  },
  createBilibiliTopic(body) {
    return request('/bilibili-topics', { method: 'POST', body })
  },
  updateBilibiliTopic(id, body) {
    return request(`/bilibili-topics/${id}`, { method: 'PUT', body })
  },
  deleteBilibiliTopic(id) {
    return request(`/bilibili-topics/${id}`, { method: 'DELETE' })
  },
  seedBilibiliTopics() {
    return request('/bilibili-topics/seed', { method: 'POST' })
  },
  promoteBilibiliTopic(id) {
    return request(`/bilibili-topics/${id}/promote`, { method: 'POST' })
  },
  rejectBilibiliTopic(id) {
    return request(`/bilibili-topics/${id}/reject`, { method: 'POST' })
  },
  listBilibiliTopicBlacklist() {
    return request('/bilibili-topic-blacklist', { method: 'GET' })
  },
  addBilibiliTopicBlacklist(body) {
    return request('/bilibili-topic-blacklist', { method: 'POST', body })
  },
  removeBilibiliTopicBlacklist(id) {
    return request(`/bilibili-topic-blacklist/${id}`, { method: 'DELETE' })
  }
}
