/**
 * 3D 展陈星问退卡：把详情页卡片压成头顶宽屏能看的薄卡，点按走主包路由。
 * 不嵌 <ai-chat>，不放主包。
 */

const { ROUTES } = require('../../utils/routes.js')
const { buildMissionDetailUrl } = require('../../utils/index-mission-nav.js')
const { gateCheck } = require('../../utils/membership.js')

const TAB_ROUTES = [ROUTES.INDEX, ROUTES.MONITOR, ROUTES.PROGRESS, ROUTES.NEWS, ROUTES.PROFILE]

function isTabRoute(url) {
  const path = String(url || '').split('?')[0]
  return TAB_ROUTES.indexOf(path) >= 0
}

function viewListItems(items) {
  const list = Array.isArray(items) ? items : []
  return list.slice(0, 4).map(function (row, i) {
    const src = row && typeof row === 'object' ? row : {}
    return {
      id: String(src.id || 'row-' + i),
      name: String(src.name || src.title || ''),
      formattedTime: String(src.formattedTime || ''),
      statusText: String(src.statusText || ''),
      rocketName: String(src.rocketName || ''),
      rocketImage: String(src.rocketImage || ''),
      detailType: src.detailType === 'completed' ? 'completed' : 'upcoming',
      detailUrl: String(src.detailUrl || '')
    }
  })
}

function viewSpecRows(rows) {
  const list = Array.isArray(rows) ? rows : []
  return list.slice(0, 4).map(function (row) {
    const src = row && typeof row === 'object' ? row : {}
    return {
      label: String(src.label || ''),
      value: String(src.value || '')
    }
  })
}

function looksLikeExhibitSpecAsk(text) {
  const q = String(text || '')
  return /(多高|多长|直径|参数|规格|多重|全长)/.test(q) ||
    /(这[枚个]?火箭|当前火箭|这个型号|这型号)/.test(q)
}

function looksLikeLaunchListAsk(text) {
  const q = String(text || '')
  return /(接下来|即将|马上|最近).{0,6}(发射|火箭)/.test(q) ||
    /(发射计划|发射列表|有什么发射|下一发)/.test(q)
}

function buildExhibitSpecCard(context) {
  const src = context && typeof context === 'object' ? context : {}
  const title = String(src.rocketName || src.title || '').trim()
  if (!title) return null
  const rows = []
  if (src.length) rows.push({ label: '全长', value: String(src.length).trim() })
  if (src.diameter) rows.push({ label: '直径', value: String(src.diameter).trim() })
  if (!rows.length && !src.intro) return null
  return {
    id: 'exhibit-spec',
    cardType: 'spec',
    specKind: src.configId ? 'rocket_model' : '',
    targetId: String(src.configId || ''),
    title: title,
    subtitle: String(src.rocketNameEn || '').trim(),
    desc: String(src.intro || '').trim().slice(0, 80),
    cta: src.configId ? '查看型号' : '查看详情',
    rows: rows
  }
}

function buildExhibitLaunchListCard() {
  return {
    id: 'exhibit-upcoming',
    cardType: 'launch_list',
    title: '接下来发射',
    cta: '查看更多',
    items: [],
    listMode: 'upcoming',
    moreUrl: ROUTES.INDEX
  }
}

function fillExhibitCards(text, context, richCards) {
  const cards = Array.isArray(richCards) ? richCards.filter(function (c) { return c && typeof c === 'object' }) : []
  if (cards.length) return cards
  if (looksLikeExhibitSpecAsk(text)) {
    const spec = buildExhibitSpecCard(context)
    if (spec) return [spec]
  }
  if (looksLikeLaunchListAsk(text)) return [buildExhibitLaunchListCard()]
  return []
}

function viewExhibitCards(cards) {
  const list = Array.isArray(cards) ? cards : []
  const out = []
  for (let i = 0; i < list.length; i++) {
    const card = list[i]
    if (!card || typeof card !== 'object') continue
    const type = String(card.cardType || 'entry')
    out.push({
      id: String(card.id || type + '-' + i),
      cardType: type,
      title: String(card.title || card.name || card.displayName || ''),
      sub: String(card.subtitle || card.formattedTime || card.desc || card.statusText || card.scopeLabel || ''),
      image: String(card.rocketImage || card.image || card.logoUrl || card.poster || ''),
      cta: String(card.cta || '查看详情'),
      items: type === 'launch_list' ? viewListItems(card.items) : [],
      rows: type === 'spec' ? viewSpecRows(card.rows) : [],
      boosterId: card.booster && card.booster.id ? String(card.booster.id) : '',
      boosterStatus: card.booster && card.booster.status ? String(card.booster.status) : '',
      shipId: card.ship && card.ship.id ? String(card.ship.id) : '',
      shipStatus: card.ship && card.ship.status ? String(card.ship.status) : '',
      detailUrl: String(card.detailUrl || ''),
      moreUrl: String(card.moreUrl || ''),
      detailType: card.detailType === 'completed' ? 'completed' : 'upcoming',
      missionId: String(card.missionId || (type === 'mission' ? card.id : '') || ''),
      entryKind: String(card.entryKind || ''),
      specKind: String(card.specKind || ''),
      targetId: String(card.targetId || ''),
      listMode: String(card.listMode || ''),
      gateProductId: String(card.gateProductId || ''),
      gateProductName: String(card.gateProductName || ''),
      year: card.year != null ? String(card.year) : '',
      countryKey: String(card.countryKey || ''),
      playable: !!card.playable,
      videoUrl: String(card.videoUrl || ''),
      poster: String(card.poster || ''),
      launchId: String(card.launchId || ''),
      stationId: String(card.stationId || '')
    })
  }
  return out
}

function specNavUrl(card) {
  const kind = String((card && card.specKind) || '')
  const id = String((card && card.targetId) || '').trim()
  if (kind === 'rocket_model' && id) return ROUTES.ROCKET_MODEL_DETAIL + '?configId=' + encodeURIComponent(id)
  if (kind === 'launch_site' && id) return ROUTES.LAUNCH_SITE_DETAIL + '?id=' + encodeURIComponent(id)
  if (kind === 'spacecraft' && id) return ROUTES.SPACECRAFT_DETAIL + '?id=' + encodeURIComponent(id)
  if (kind === 'booster' && id) return ROUTES.BOOSTER_DETAIL + '?serial=' + encodeURIComponent(id)
  if (kind === 'hardware' && id) return ROUTES.HARDWARE_DETAIL + '?id=' + encodeURIComponent(id)
  if (kind === 'apod') return ROUTES.ASTRO_CALENDAR
  if (kind === 'booster_genealogy') return ROUTES.BOOSTER_GENEALOGY
  return ''
}

function entryNav(card) {
  const kind = String((card && card.entryKind) || '')
  const missionId = String((card && card.missionId) || '').trim()
  const detailType = card && card.detailType === 'completed' ? 'completed' : 'upcoming'
  if (kind === 'vehicle_tracker') return { url: ROUTES.VEHICLE_TRACKER }
  if (kind === 'mission_sim') return { url: '/subpackages/mission-sim/mission-sim' }
  if (kind === 'road_closure') return { url: ROUTES.ROAD_CLOSURE_DETAIL }
  if (kind === 'starship_progress') return { url: ROUTES.PROGRESS, switchTab: true }
  if (kind === 'station') return { url: ROUTES.MONITOR, switchTab: true }
  if (kind === 'flight_demo') {
    const parts = []
    if (missionId) {
      parts.push('id=' + encodeURIComponent(missionId))
      parts.push('type=' + detailType)
    }
    return { url: '/subpackages/mission-sim/flight-demo' + (parts.length ? '?' + parts.join('&') : '') }
  }
  if (kind === 'booster_genealogy') return { url: ROUTES.BOOSTER_GENEALOGY }
  if (kind === 'launch_vote' && missionId) {
    return { url: buildMissionDetailUrl({ id: missionId, detailType: detailType }) }
  }
  if (kind === 'year_review') return { url: ROUTES.YEAR_REVIEW }
  if (kind === 'astro_calendar') return { url: ROUTES.ASTRO_CALENDAR }
  if (kind === 'news') return { url: ROUTES.NEWS, switchTab: true }
  if (kind === 'starlink_pass' || kind === 'live_watch') return { url: ROUTES.MONITOR, switchTab: true }
  if (kind === 'starlink_map') return { url: ROUTES.STARLINK_FULLSCREEN }
  if (kind === 'artemis') return { url: ROUTES.ARTEMIS_DETAIL }
  if (kind === 'starship_hardware') return { url: ROUTES.HARDWARE_LIST }
  if (kind === 'watch_party') {
    return {
      url:
        '/subpackages/watch-party/merchant-list?channel=ai' +
        (missionId ? '&missionId=' + encodeURIComponent(missionId) : '')
    }
  }
  if (kind === 'badges') return { url: ROUTES.BADGES }
  if (kind === 'favorites') return { url: ROUTES.FAVORITES }
  if (kind === 'daily_quiz') return { url: ROUTES.DAILY_QUIZ }
  if (kind === 'collect') return { url: ROUTES.COLLECT }
  if (kind === 'exoplanet') return { url: ROUTES.EXOPLANET }
  if (kind === 'nasa_data') return { url: ROUTES.NASA_DATA }
  if (kind === 'spacecraft_gallery') return { url: ROUTES.SPACECRAFT_GALLERY }
  if (kind === 'launch_site_gallery') return { url: ROUTES.LAUNCH_SITE_MAP }
  return null
}

function resolveExhibitCardNav(card, extra) {
  const src = card && typeof card === 'object' ? card : {}
  const more = extra && extra.more
  const row = extra && extra.row && typeof extra.row === 'object' ? extra.row : null
  if (row) {
    if (row.detailUrl) return { url: row.detailUrl, switchTab: isTabRoute(row.detailUrl) }
    if (row.id) {
      return { url: buildMissionDetailUrl({ id: row.id, detailType: row.detailType }) }
    }
  }
  if (more) {
    const moreUrl = src.moreUrl || (src.listMode === 'history' ? ROUTES.SEARCH : ROUTES.INDEX)
    return { url: moreUrl, switchTab: isTabRoute(moreUrl) }
  }
  if (src.detailUrl) return { url: src.detailUrl, switchTab: isTabRoute(src.detailUrl) }
  if (src.moreUrl) return { url: src.moreUrl, switchTab: isTabRoute(src.moreUrl) }
  const type = String(src.cardType || '')
  if (type === 'mission' && src.id) {
    return { url: buildMissionDetailUrl({ id: src.id, detailType: src.detailType }) }
  }
  if (type === 'reminder' && (src.missionId || src.id)) {
    return { url: buildMissionDetailUrl({ id: src.missionId || src.id, detailType: src.detailType }) }
  }
  if (type === 'starship_status') return { url: ROUTES.PROGRESS, switchTab: true }
  if (type === 'agency' && src.id) {
    return { url: ROUTES.AGENCY_DETAIL + '?id=' + encodeURIComponent(String(src.id)) }
  }
  if (type === 'launch_stats') {
    const parts = []
    if (src.year) parts.push('year=' + encodeURIComponent(String(src.year)))
    if (src.countryKey && src.countryKey !== '_all') {
      parts.push('country=' + encodeURIComponent(String(src.countryKey)))
    }
    return { url: ROUTES.GLOBAL_LAUNCH_STATS + (parts.length ? '?' + parts.join('&') : '') }
  }
  if (type === 'mission_replay') {
    if (src.playable && src.videoUrl) {
      return { url: ROUTES.VIDEO_PLAYER, replay: true }
    }
    const replayId = src.launchId || src.id
    if (replayId) return { url: buildMissionDetailUrl({ id: replayId, detailType: src.detailType }) }
  }
  if (type === 'spec') {
    const specUrl = specNavUrl(src)
    if (specUrl) return { url: specUrl, switchTab: isTabRoute(specUrl) }
  }
  if (type === 'entry') {
    const entry = entryNav(src)
    if (entry && entry.url) return entry
  }
  if (type === 'merchant_gacha') {
    return { url: '/subpackages/watch-party/merchant-list?channel=ai' }
  }
  return null
}

function _armReplay(card) {
  try {
    const app = typeof getApp === 'function' ? getApp() : null
    if (!app || !app.globalData) return
    const poster = String((card && (card.poster || card.image)) || '')
    const url = String((card && card.videoUrl) || '')
    app.globalData.pendingEventVideo = {
      url: url,
      poster: poster,
      showmenu: false,
      remoteUrl: url,
      originalUrl: '',
      sourceUrl: '',
      share: null
    }
  } catch (e) {}
}

async function openExhibitCard(card, extra) {
  const nav = resolveExhibitCardNav(card, extra)
  if (!nav || !nav.url) return false
  const src = card && typeof card === 'object' ? card : {}
  if (src.gateProductId) {
    try {
      const allowed = await gateCheck(src.gateProductId, src.gateProductName || '星问')
      if (!allowed) return false
    } catch (e) {
      return false
    }
  }
  if (nav.replay) _armReplay(src)
  try {
    wx.vibrateShort({ type: 'light' })
  } catch (e) {}
  if (nav.switchTab) {
    wx.switchTab({
      url: nav.url,
      fail: function () {
        try {
          wx.showToast({ title: '打不开', icon: 'none' })
        } catch (e2) {}
      }
    })
    return true
  }
  wx.navigateTo({
    url: nav.url,
    fail: function () {
      try {
        wx.showToast({ title: '打不开', icon: 'none' })
      } catch (e2) {}
    }
  })
  return true
}

module.exports = {
  viewExhibitCards,
  resolveExhibitCardNav,
  openExhibitCard,
  isTabRoute,
  looksLikeExhibitSpecAsk,
  looksLikeLaunchListAsk,
  buildExhibitSpecCard,
  buildExhibitLaunchListCard,
  fillExhibitCards
}
