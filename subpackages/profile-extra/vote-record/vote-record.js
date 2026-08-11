const { getUiShellLayout } = require('../../../utils/layout.js')
const { getThemeClassSync, isLightSync, getPageBgSync, applyThemeToPage } = require('../../../utils/theme.js')
const { getMyVoteResults } = require('../../../utils/api-app-services.js')
const { ROUTES } = require('../../../utils/routes.js')
const storageCache = require('../../../utils/storage-sync-cache.js')
const { resolveVoteChoiceMeta } = require('../../../utils/index-page-helpers.js')
const { resolveMissionRocketImageFresh, isDefaultRocketSrc } = require('../../../utils/util.js')
const { translateRocketName } = require('../../../utils/rocket-name-i18n.js')
const { localizeMissionTitle } = require('../../../utils/mission-title-i18n.js')
const { isContentLangEn } = require('../../../utils/locale.js')
const rocketArtUtil = require('../../../utils/rocket-config-art.js')

function getMissionFromLocalCache(missionId) {
  try {
    const cache = storageCache.readMemOrSync('mission_detail_cache', {}) || {}
    const keys = [missionId + '_upcoming', missionId + '_completed']
    for (let i = 0; i < keys.length; i++) {
      const entry = cache[keys[i]]
      if (entry && typeof entry === 'object' && (entry.missionName || entry.name)) return entry
    }
  } catch (e) {}
  return null
}

/** 与 profile-lazy / 首页任务卡同源的展示字段 */
function localizeVoteRow(missionName, rocketName, cachedMission, stored) {
  stored = stored || {}
  const pack = cachedMission && cachedMission._langPack
  const cfg = cachedMission && cachedMission.rocketConfiguration
  let rocketEn =
    stored.rocketNameEn ||
    (pack && pack.rocketNameEn) ||
    (cfg && (cfg.full_name || cfg.name)) ||
    (cachedMission && cachedMission.rocketName) ||
    rocketName ||
    ''
  rocketEn = String(rocketEn || '').trim()
  if (rocketEn && /[\u4e00-\u9fff]/.test(rocketEn) && !stored.rocketNameEn) {
    rocketEn =
      (pack && pack.rocketNameEn) ||
      (cfg && (cfg.full_name || cfg.name)) ||
      (cachedMission && cachedMission.rocketName) ||
      ''
  }
  const rocketZh = (pack && pack.rocketNameZh) || translateRocketName(rocketEn) || rocketEn
  let nameEn =
    stored.nameEn ||
    (pack && (pack.nameEn || pack.missionNameEn)) ||
    ''
  const nameRaw = String(missionName || '').trim()
  if (!nameEn) {
    if (nameRaw && !/[\u4e00-\u9fff]/.test(nameRaw)) nameEn = nameRaw
    else if (cachedMission) {
      nameEn = String(
        (pack && (pack.nameEn || pack.missionNameEn)) ||
          cachedMission.missionName ||
          cachedMission.name ||
          ''
      ).trim()
      if (nameEn && /[\u4e00-\u9fff]/.test(nameEn) && !(pack && pack.nameEn)) nameEn = ''
    }
  }
  const nameZh =
    (pack && (pack.nameZh || pack.missionNameZh)) ||
    localizeMissionTitle(nameEn || nameRaw, rocketEn) ||
    nameRaw
  const useEn = isContentLangEn()
  return {
    name: useEn ? (nameEn || nameZh || nameRaw) : (nameZh || nameEn || nameRaw),
    nameEn: nameEn || '',
    rocket: useEn ? (rocketEn || rocketZh) : (rocketZh || rocketEn),
    rocketNameEn: rocketEn || '',
    rocketNameZh: rocketZh || ''
  }
}

Page({
  data: {
    statusBarHeight: 44,
    navPlaceholderHeight: 0,
    themeClass: '',
    themeLight: false,
    pageBgColor: '#000000',
    loading: true,
    voteStats: { total: 0, settled: 0, correct: 0, accuracy: 0, streak: 0, bestStreak: 0 },
    history: []
  },

  onLoad() {
    const layout = getUiShellLayout()
    this.setData({
      statusBarHeight: layout.statusBarHeight,
      navPlaceholderHeight: layout.navPlaceholderHeight,
      themeClass: getThemeClassSync(),
      themeLight: isLightSync(),
      pageBgColor: getPageBgSync()
    })
    try {
      wx.showShareMenu({ withShareTicket: true, menus: ['shareAppMessage', 'shareTimeline'] })
    } catch (e) {}
    this._load()
  },

  onShow() {
    applyThemeToPage(this)
    this.setData({
      themeClass: getThemeClassSync(),
      themeLight: isLightSync(),
      pageBgColor: getPageBgSync()
    })
    rocketArtUtil.applyRocketConfigArtIfNeeded(this)
  },

  refreshRocketConfigArt() {
    const history = this.data.history || []
    if (!history.length) return true
    const patch = {}
    for (let i = 0; i < history.length; i++) {
      const h = history[i]
      const cached = getMissionFromLocalCache(h.launchId)
      const cfg = cached && cached.rocketConfiguration
      const img = resolveMissionRocketImageFresh(h.rocketNameEn || h.rocket || '', cfg)
      if (img && img !== h.rocketImage) patch['history[' + i + '].rocketImage'] = img
    }
    if (Object.keys(patch).length) this.setData(patch)
    return true
  },

  async _load() {
    this.setData({ loading: true })
    try {
      const rows = (await getMyVoteResults()) || []
      let settled = 0
      let correct = 0
      const history = []

      for (let i = 0; i < rows.length; i++) {
        const item = rows[i]
        const meta = resolveVoteChoiceMeta(item.choice, item.voteType)
        let choice = meta.choice
        const choiceLabel = item.choiceLabel || meta.choiceLabel
        const voteType = meta.voteType
        const voteTypeLabel = item.voteTypeLabel || meta.voteTypeLabel
        let result = item.result || ''
        if (voteType === 'outcome') {
          if (result === 'buge') result = 'success'
          else if (result === 'ge') result = 'failure'
        }
        const isCorrect = !!(result && choice && choice === result)
        if (result) {
          settled += 1
          if (isCorrect) correct += 1
        }

        let missionName = item.missionName || item.name || ''
        let rocketName = item.rocketName || ''
        const cachedMission = getMissionFromLocalCache(item.launchId)
        if (cachedMission) {
          if (!missionName) missionName = cachedMission.missionName || cachedMission.name || ''
          if (!rocketName) rocketName = cachedMission.rocketName || ''
        }
        const disp = localizeVoteRow(missionName, rocketName, cachedMission, {
          rocketNameEn: item.rocketName || rocketName
        })
        const rocketImage = resolveMissionRocketImageFresh(
          disp.rocketNameEn || rocketName,
          cachedMission && cachedMission.rocketConfiguration
        )

        const launchTimeStr = item.lockedLaunchTime || item.launchTime || ''
        let daysLabel = ''
        if (result) {
          daysLabel = isCorrect ? '✓ 猜对' : '✕ 猜错'
        } else if (launchTimeStr) {
          const ltMs = new Date(launchTimeStr).getTime()
          if (ltMs > 0) {
            const diffDays = Math.ceil((ltMs - Date.now()) / 86400000)
            if (diffDays <= 0) daysLabel = '待揭晓'
            else if (diffDays === 1) daysLabel = '明天'
            else daysLabel = diffDays + '天后'
          } else {
            daysLabel = '待揭晓'
          }
        } else {
          daysLabel = '待揭晓'
        }

        history.push({
          id: String(item.launchId || i) + '::' + voteType,
          launchId: item.launchId,
          voteType: voteType,
          voteTypeLabel: voteTypeLabel,
          name: disp.name || ('任务 #' + item.launchId),
          rocket: disp.rocket,
          rocketNameEn: disp.rocketNameEn,
          rocketImage: rocketImage,
          choice: choice,
          choiceLabel: choiceLabel,
          result: result,
          isCorrect: isCorrect,
          daysLabel: daysLabel,
          sortTime: launchTimeStr ? new Date(launchTimeStr).getTime() || 0 : 0
        })
      }

      history.sort(function (a, b) { return b.sortTime - a.sortTime })

      let streak = 0
      let bestStreak = 0
      let tempStreak = 0
      for (let si = 0; si < history.length; si++) {
        if (!history[si].result) continue
        if (history[si].isCorrect) {
          tempStreak++
          if (tempStreak > bestStreak) bestStreak = tempStreak
        } else {
          tempStreak = 0
        }
      }
      for (let sj = 0; sj < history.length; sj++) {
        if (!history[sj].result) continue
        if (history[sj].isCorrect) streak++
        else break
      }

      this.setData({
        loading: false,
        history,
        voteStats: {
          total: rows.length,
          settled,
          correct,
          accuracy: settled > 0 ? Math.round((correct / settled) * 100) : 0,
          streak,
          bestStreak
        }
      })
    } catch (e) {
      this.setData({ loading: false, history: [] })
    }
  },

  onRocketImageError(e) {
    const idx = Number(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.index)
    if (!Number.isFinite(idx)) return
    const h = (this.data.history || [])[idx]
    if (!h || isDefaultRocketSrc(h.rocketImage)) return
    this.setData({ ['history[' + idx + '].rocketImage']: resolveMissionRocketImageFresh('', null) })
  },

  onItemTap(e) {
    const id = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id
    if (!id) return
    wx.navigateTo({ url: ROUTES.MISSION_DETAIL + '?id=' + encodeURIComponent(id) + '&type=upcoming' })
  },

  goBack() {
    wx.navigateBack({ delta: 1 })
  },

  onShareAppMessage() {
    return {
      title: '我的竞猜战绩 · 火星探索日志',
      path: ROUTES.VOTE_RECORD
    }
  },

  onShareTimeline() {
    return {
      title: '我的竞猜战绩 · 火星探索日志',
      query: ''
    }
  }
})
