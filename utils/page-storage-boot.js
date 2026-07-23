/**
 * Tab 页统一 warm：合并 onLoad/onShow 前的同步 storage 读，每 key 每会话最多 1 次 wx.getStorageSync。
 */
const storageCache = require('./storage-sync-cache.js')
const { warmBehaviorStatsSync } = require('./behavior-stats.js')
const { warmSubscribedStoreSync } = require('./subscribe.js')
const { warmMembershipStateSync } = require('./membership.js')
const { warmUserPreferencesSync } = require('./user-growth.js')
const { warmVotesStoreSync } = require('./index-page-helpers.js')

const DESKTOP_STRIP_SNOOZE_KEY = 'add_desktop_strip_snooze_until'
const OPENCLAW_GUIDE_DISMISSED_KEY = 'openclaw_guide_dismissed'
const BRIEFING_PROGRESS_FILTER_CLEAR_KEY = '_briefing_progress_filter_clear'
const BRIEFING_PROGRESS_FILTER_SOURCE_KEY = '_briefing_progress_filter_source'

let _profileWarmDone = false
let _progressWarmDone = false

function warmProfilePageStorageSync() {
  if (_profileWarmDone) return
  _profileWarmDone = true
  // 签到/问答实现已下沉 profile-extra；主包只预热 storage key，避免打进主包
  storageCache.warmSync('_checkin_data', null)
  storageCache.warmSync('_space_quiz_data', null)
  warmBehaviorStatsSync()
  warmSubscribedStoreSync()
  warmMembershipStateSync()
  warmUserPreferencesSync()
  warmVotesStoreSync()
  storageCache.warmSync(DESKTOP_STRIP_SNOOZE_KEY, 0)
  storageCache.warmSync('_milestone_config_cache_v2', [])
  storageCache.warmSync('_milestone_claims_cache', [])
  storageCache.warmSync('_knowledge_cards_cache', null)
  storageCache.warmSync('_voted_launches', {})
  storageCache.warmSync('_achievements_data', {})
  storageCache.warmSync('mission_detail_cache', {})
}

function warmProgressPageStorageSync() {
  if (_progressWarmDone) return
  _progressWarmDone = true
  warmMembershipStateSync()
  storageCache.warmSync(DESKTOP_STRIP_SNOOZE_KEY, 0)
  storageCache.warmSync(OPENCLAW_GUIDE_DISMISSED_KEY, false)
  storageCache.warmSync(BRIEFING_PROGRESS_FILTER_CLEAR_KEY, '')
  storageCache.warmSync(BRIEFING_PROGRESS_FILTER_SOURCE_KEY, '')
  storageCache.warmSync('_progress_last_viewed', 0)
  storageCache.warmSync('_event_updates_local_cache', null)
}

module.exports = {
  DESKTOP_STRIP_SNOOZE_KEY: DESKTOP_STRIP_SNOOZE_KEY,
  OPENCLAW_GUIDE_DISMISSED_KEY: OPENCLAW_GUIDE_DISMISSED_KEY,
  BRIEFING_PROGRESS_FILTER_CLEAR_KEY: BRIEFING_PROGRESS_FILTER_CLEAR_KEY,
  BRIEFING_PROGRESS_FILTER_SOURCE_KEY: BRIEFING_PROGRESS_FILTER_SOURCE_KEY,
  warmProfilePageStorageSync: warmProfilePageStorageSync,
  warmProgressPageStorageSync: warmProgressPageStorageSync
}
