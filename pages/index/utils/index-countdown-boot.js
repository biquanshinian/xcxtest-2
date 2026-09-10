/**
 * 首页倒计时冷启动快显：
 * - 上次会话即将发射头部快照（异步 hydrate，不挡首帧）
 * - 本会话内存列表 peek（开屏预拉 / 在飞请求）
 * - 面板选型与云 apply 同一套 pickCountdownDisplayMission，不用 list[0]
 * - 落库快照回灌有短等待，避免先画出已进历史的任务
 * 完整云列表回来后仍走 applyInitialUpcomingLaunchState 覆盖。
 */

const COUNTDOWN_BOOT_KEY = '_idx_countdown_boot_v1'
// 隔天/隔周才打开的用户占多数，24h 会让他们每次都吃空面板。过期条目由
// filterExpiredMissions 兜底剔除，云端数据几百毫秒内就会盖回来，放宽到 72h 收益远大于风险
const COUNTDOWN_BOOT_TTL_MS = 72 * 60 * 60 * 1000
const COUNTDOWN_BOOT_LIST_MAX = 8
const COUNTDOWN_BOOT_MIN_WRITE_GAP_MS = 5 * 1000
const COUNTDOWN_BOOT_HYDRATE_WAIT_MS = 80
const COUNTDOWN_BOOT_SETTLED_WAIT_MS = 80
const COUNTDOWN_BOOT_LANG_KEYS = [
  'rocketNameEn',
  'rocketNameZh',
  'missionNameEn',
  'missionNameZh',
  'nameEn',
  'nameZh',
  'launchSiteEn',
  'launchSiteZh',
  'padLocationEn',
  'padLocationZh',
  'launchAgencyEn',
  'launchAgencyZh',
  'countryDisplayEn',
  'countryDisplayZh',
  'statusBadgeTextEn',
  'statusBadgeTextZh'
]

function slimLangPackForCountdownBoot(pack) {
  if (!pack || typeof pack !== 'object') return null
  const out = {}
  let n = 0
  for (let i = 0; i < COUNTDOWN_BOOT_LANG_KEYS.length; i++) {
    const key = COUNTDOWN_BOOT_LANG_KEYS[i]
    const val = pack[key]
    if (typeof val !== 'string') continue
    const trimmed = val.trim()
    if (!trimmed) continue
    out[key] = trimmed
    n += 1
  }
  return n ? out : null
}

function slimMissionForCountdownBoot(mission) {
  if (!mission || mission.id == null) return null
  let image = mission.rocketImage || mission.image || ''
  if (typeof image === 'string' && /^wxfile:\/\//i.test(image.trim())) {
    try {
      const iconCache = require('../../../utils/icon-cache.js')
      const remote = iconCache.getRocketHttpsUrlForLocal(image.trim())
      if (remote) image = remote
    } catch (e) {}
  }
  const row = {
    id: mission.id,
    name: mission.name || '',
    missionName: mission.missionName || '',
    rocketName: mission.rocketName || '',
    launchTime: mission.launchTime || '',
    previousNet: mission.previousNet || '',
    windowStart: mission.windowStart || '',
    windowEnd: mission.windowEnd || '',
    netPrecision: mission.netPrecision || '',
    rocketImage: image,
    image,
    rocketConfiguration: mission.rocketConfiguration || null,
    status: mission.status || '',
    statusId: mission.statusId,
    statusAbbrev: mission.statusAbbrev || '',
    statusCategory: mission.statusCategory || '',
    statusBadgeText: mission.statusBadgeText || '',
    statusTextZh: mission.statusTextZh || '',
    launchAgency: mission.launchAgency || '',
    launchAgencyId: mission.launchAgencyId != null ? mission.launchAgencyId : '',
    launchAgencyImage: mission.launchAgencyImage || '',
    rocketConfigId: mission.rocketConfigId != null
      ? mission.rocketConfigId
      : (mission.rocketConfiguration && mission.rocketConfiguration.id != null
        ? mission.rocketConfiguration.id
        : null),
    padLocationId: mission.padLocationId != null
      ? mission.padLocationId
      : (mission.padDetail && mission.padDetail.locationId != null
        ? mission.padDetail.locationId
        : null),
    launchSite: mission.launchSite || '',
    countryDisplay: mission.countryDisplay || '',
    probability: mission.probability
  }
  const langPack = slimLangPackForCountdownBoot(mission._langPack)
  if (langPack) row._langPack = langPack
  return row
}

function parseCountdownBootPayload(data, now) {
  const ts = now != null ? now : Date.now()
  if (!data || !Array.isArray(data.list) || !data.list.length) return null
  const at = Number(data.at)
  if (!Number.isFinite(at) || ts - at > COUNTDOWN_BOOT_TTL_MS || at > ts + 60 * 1000) return null
  return data.list.filter((row) => row && row.id != null)
}

function waitRecentSettledHydrateForBoot(page) {
  if (!page) return null
  if (page._recentSettledHydrateDone) return null
  if (page._launchRecordsById && page._launchRecordsById.size) return null
  const pending = page._recentSettledHydratePromise
  if (!pending || typeof pending.then !== 'function') return null
  return Promise.race([
    Promise.resolve(pending).then(() => {}, () => {}),
    new Promise((resolve) => setTimeout(resolve, COUNTDOWN_BOOT_SETTLED_WAIT_MS))
  ])
}

/** 与云 apply / _resolveCountdownPanelMission 同一套选型，已落库任务不会入选 */
function pickCountdownBootPanelMission(list, page) {
  if (!Array.isArray(list) || !list.length) return null
  try {
    if (page && typeof page._resolveCountdownPanelMission === 'function') {
      return page._resolveCountdownPanelMission(list).panelMission || null
    }
    const { pickCountdownDisplayMission } = require('../../../utils/index-launch-state.js')
    const { getServerNow } = require('../../../utils/server-clock.js')
    return pickCountdownDisplayMission(list, getServerNow(), {
      recordsById: (page && page._launchRecordsById) || null
    }) || null
  } catch (e) {
    return list[0] || null
  }
}

async function paintCountdownFromBootCacheWork(page, stateGeneration, options) {
  if (!page || !page.data || page.data.missionType !== 'upcoming') return false
  if (page.data.launchData && page.data.launchData.id) return false
  // 落库快照未回灌时最多等 80ms，让 filter / 状态机能跳过已进历史的任务。
  // 已回灌或没有 hydrate 承诺时不 await，同步源仍可同帧出卡。
  const settledWait = waitRecentSettledHydrateForBoot(page)
  if (settledWait) {
    await settledWait
    if (!page._isLaunchStateGenerationCurrent(stateGeneration)) return false
    if (page.data.launchData && page.data.launchData.id) return false
  }
  // 同步源（内存快照 / app 引导缓存 / 本地列表缓存）优先：命中就整条链路不 await，
  // 首帧同帧出卡。只有全都空时才值得为异步 storage 花那 80ms
  let list = page._resolveCountdownBootList(options)
  if (!list.length) {
    await Promise.race([
      page._hydrateCountdownBootFromStorage(),
      new Promise((resolve) => setTimeout(resolve, COUNTDOWN_BOOT_HYDRATE_WAIT_MS))
    ])
    if (!page._isLaunchStateGenerationCurrent(stateGeneration)) return false
    if (page.data.launchData && page.data.launchData.id) return false
    list = page._resolveCountdownBootList(options)
  }
  if (!list.length) return false
  const first = pickCountdownBootPanelMission(list, page)
  if (!first) return false
  page._countdownBootPainting = true
  try {
    const head = list.slice(0, COUNTDOWN_BOOT_LIST_MAX)
    if (typeof page._applyInitialUpcomingLaunchStateSync === 'function') {
      page._applyInitialUpcomingLaunchStateSync(first, head, {
        hasMore: true,
        nextOffset: head.length
      }, { countdownFirst: true, deferSecondary: true })
    } else {
      page.applyInitialUpcomingLaunchState(first, head, {
        hasMore: true,
        nextOffset: head.length
      })
    }
    return true
  } catch (e) {
    return false
  } finally {
    page._countdownBootPainting = false
  }
}

function normalizeBootMissionList(list) {
  const { normalizeMissionItem } = require('../../../utils/index-mission-services.js')
  const { filterExpiredMissions } = require('../../../utils/index-page-helpers.js')
  const raw = Array.isArray(list) ? list : []
  return filterExpiredMissions(
    raw.map((mission, index) =>
      normalizeMissionItem(mission, { type: 'upcoming', index, baseIndex: 0 })
    )
  )
}

function readCountdownBootFromStorage() {
  return new Promise((resolve) => {
    let settled = false
    const done = (list) => {
      if (settled) return
      settled = true
      resolve(list && list.length ? list : null)
    }
    try {
      wx.getStorage({
        key: COUNTDOWN_BOOT_KEY,
        success: (res) => {
          let list = null
          try {
            list = parseCountdownBootPayload(res && res.data)
          } catch (e) {}
          done(list)
        },
        fail: () => done(null)
      })
    } catch (e) {
      done(null)
    }
  })
}

/**
 * onLaunch 预拉阶段就把引导快照读进内存。promise 挂在 app 上供页面复用，
 * 避免同一个 key 在冷启动最忙的那几十毫秒里被读两遍。
 */
function hydrateCountdownBootToApp(app) {
  let a = null
  try {
    a = app || (typeof getApp === 'function' ? getApp() : null)
  } catch (e) {}
  if (!a) return readCountdownBootFromStorage()
  if (a._countdownBootHydratePromise) return a._countdownBootHydratePromise
  a._countdownBootHydrateStarted = true
  a._countdownBootHydratePromise = readCountdownBootFromStorage().then((list) => {
    if (list && list.length) a._countdownBootList = list
    return a._countdownBootList || null
  })
  return a._countdownBootHydratePromise
}

const methods = {
  _hydrateCountdownBootFromStorage() {
    if (this._countdownBootHydratePromise) return this._countdownBootHydratePromise
    try {
      const app = getApp()
      if (app && Array.isArray(app._countdownBootList) && app._countdownBootList.length) {
        this._countdownBootList = app._countdownBootList
      }
    } catch (eApp) {}
    this._countdownBootHydratePromise = new Promise((resolve) => {
      let settled = false
      const done = (list) => {
        if (settled) return
        settled = true
        if (Array.isArray(list) && list.length) this._countdownBootList = list
        if (!this._countdownBootList || !this._countdownBootList.length) {
          try {
            const app = getApp()
            if (app && Array.isArray(app._countdownBootList) && app._countdownBootList.length) {
              this._countdownBootList = app._countdownBootList
            }
          } catch (e) {}
        }
        resolve(this._countdownBootList || null)
      }
      if (this._countdownBootList && this._countdownBootList.length) {
        done(null)
        return
      }
      try {
        // onLaunch 预拉已经在读同一个 key：复用它的 promise，不再起第二次 storage 往返
        hydrateCountdownBootToApp().then(done, () => done(null))
        setTimeout(() => done(null), 200)
      } catch (e) {
        done(null)
      }
    })
    return this._countdownBootHydratePromise
  },

  _persistCountdownBootList(list) {
    if (this._countdownBootPainting) return
    const slim = (Array.isArray(list) ? list : [])
      .map(slimMissionForCountdownBoot)
      .filter(Boolean)
      .slice(0, COUNTDOWN_BOOT_LIST_MAX)
    if (!slim.length) return
    const now = Date.now()
    if (this._countdownBootPersistAt && now - this._countdownBootPersistAt < COUNTDOWN_BOOT_MIN_WRITE_GAP_MS) {
      return
    }
    this._countdownBootPersistAt = now
    this._countdownBootList = slim
    try {
      const app = getApp()
      if (app) app._countdownBootList = slim
    } catch (eApp) {}
    try {
      wx.setStorage({
        key: COUNTDOWN_BOOT_KEY,
        data: { list: slim, at: now },
        fail: () => {}
      })
    } catch (e) {}
  },

  _peekUpcomingMissionsListSafe() {
    try {
      const listApi = require('../../../utils/api-launch-list.js')
      if (typeof listApi.peekUpcomingMissionsList === 'function') {
        const mem = listApi.peekUpcomingMissionsList()
        if (mem && mem.length) return mem
      }
    } catch (e) {}
    return null
  },

  _peekUpcomingFromLocalApiCache() {
    try {
      const listApi = require('../../../utils/api-launch-list.js')
      if (typeof listApi.peekUpcomingMissionsFromLocalCache === 'function') {
        return listApi.peekUpcomingMissionsFromLocalCache(8)
      }
    } catch (e) {}
    return null
  },

  _resolveCountdownBootList(options) {
    const allowLocalApi = !!(options && options.allowLocalApi)
    let list = this._peekUpcomingMissionsListSafe()
    if (!list || !list.length) list = this._countdownBootList || null
    if (!list || !list.length) {
      try {
        const app = getApp()
        if (app && Array.isArray(app._countdownBootList)) list = app._countdownBootList
      } catch (eApp) {}
    }
    if ((!list || !list.length) && allowLocalApi) {
      list = this._peekUpcomingFromLocalApiCache()
    }
    if (!list || !list.length) return []
    try {
      list = this._filterUpcomingAgainstSettled(normalizeBootMissionList(list))
    } catch (e2) {
      list = normalizeBootMissionList(list)
    }
    return Array.isArray(list) ? list : []
  },

  async _paintCountdownFromBootCache(stateGeneration, options) {
    if (this.data.missionType !== 'upcoming') return false
    if (this.data.launchData && this.data.launchData.id) return false
    if (this._countdownBootPaintPromise) return this._countdownBootPaintPromise
    const pending = paintCountdownFromBootCacheWork(this, stateGeneration, options)
    this._countdownBootPaintPromise = pending
    try {
      return await pending
    } finally {
      if (this._countdownBootPaintPromise === pending) this._countdownBootPaintPromise = null
    }
  }
}

module.exports = {
  COUNTDOWN_BOOT_KEY,
  COUNTDOWN_BOOT_TTL_MS,
  COUNTDOWN_BOOT_LIST_MAX,
  slimMissionForCountdownBoot,
  slimLangPackForCountdownBoot,
  parseCountdownBootPayload,
  normalizeBootMissionList,
  pickCountdownBootPanelMission,
  waitRecentSettledHydrateForBoot,
  hydrateCountdownBootToApp,
  COUNTDOWN_BOOT_SETTLED_WAIT_MS,
  methods
}
