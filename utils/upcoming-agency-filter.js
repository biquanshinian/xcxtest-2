/**
 * 「即将发射」按发射服务商筛选：聚合计数、胶囊排序与列表过滤
 */

const {
  isRemoteAgencyLogoUrl,
  resolveAgencyLogoForDisplay
} = require('./agency-logo-cache.js')
const { resolveAgencyLogoBgTone } = require('./agency-logo-bg.js')
const { applyLaunchAgencyLogoOverridesToMission } = require('./agency-logo-overrides.js')

const ALL_TASKS_CHIP_LOGO = '/images/icons/ic-orbit-globe.svg'
const AGENCY_FALLBACK_LOGO = '/images/icons/ic-rocket-outline.svg'

/**
 * 为胶囊补齐 logoUrl（优先本地缓存）与 logoRemoteSrc（用于 bindload 后持久化）。
 * 与图鉴 formatAgency 同一口径：resolveAgencyLogoForDisplay + 透明 logo 自动取色填底
 * （resolveAgencyLogoBgTone 命中缓存立即生效；未采样为 '' 走默认衬底，bindload 后回写）。
 */
function finalizeChipLogoFields(rawLogoUrl) {
  const raw = typeof rawLogoUrl === 'string' && rawLogoUrl.trim()
    ? rawLogoUrl.trim()
    : AGENCY_FALLBACK_LOGO

  if (!isRemoteAgencyLogoUrl(raw)) {
    // 本地占位火箭为白色描边，固定黑底衬托；自动取色只作用于远程真 logo
    const logoBgTone = raw.indexOf('ic-rocket-outline') !== -1 ? 'dark' : ''
    return { logoUrl: raw, logoRemoteSrc: '', logoBgTone }
  }

  const logoUrl = resolveAgencyLogoForDisplay(raw) || raw
  const logoBgTone = resolveAgencyLogoBgTone(raw)
  return { logoUrl, logoRemoteSrc: raw, logoBgTone }
}

function normalizeAgencyName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

function normalizeLogo(url) {
  const s = typeof url === 'string' ? url.trim() : ''
  return s || ''
}

/**
 * @param {Object} mission mapLaunchToListItem 产物
 * @returns {string} 稳定分组键
 */
function getAgencyKeyFromMission(mission) {
  if (!mission || typeof mission !== 'object') return 'unknown:'
  const id = mission.launchAgencyId
  if (id != null && String(id).trim() !== '') {
    return `id:${String(id)}`
  }
  const name = normalizeAgencyName(mission.launchAgency || mission.launchAgencyAbbrev || '')
  return `name:${name || '_'}`
}

/** 胶囊优先展示机构名（已随 contentLang 本地化），过长由样式省略 */
function pickChipLabel(mission) {
  const { launchCardUiText } = require('./locale.js')
  if (!mission || typeof mission !== 'object') return launchCardUiText('unknownCountry')
  const full = String(mission.launchAgency || '').trim()
  const abbr = String(mission.launchAgencyAbbrev || '').trim()
  return full || abbr || launchCardUiText('unknownCountry')
}

function collectAgencyAggregation(missions) {
  const list = Array.isArray(missions) ? missions : []
  const bucket = new Map()
  for (let i = 0; i < list.length; i++) {
    const m = list[i]
    const key = getAgencyKeyFromMission(m)
    const prev = bucket.get(key)
    const img = normalizeLogo(applyLaunchAgencyLogoOverridesToMission(m).launchAgencyImage)
    if (!prev) {
      bucket.set(key, {
        key,
        label: pickChipLabel(m),
        count: 1,
        logoUrl: img || AGENCY_FALLBACK_LOGO
      })
    } else {
      prev.count += 1
      if (img && prev.logoUrl === AGENCY_FALLBACK_LOGO) prev.logoUrl = img
    }
  }
  const agencies = Array.from(bucket.values()).sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count
    return String(a.label).localeCompare(String(b.label), 'en')
  }).map((row) => {
    const fin = finalizeChipLogoFields(row.logoUrl)
    return {
      ...row,
      logoUrl: fin.logoUrl,
      logoRemoteSrc: fin.logoRemoteSrc,
      logoBgTone: fin.logoBgTone
    }
  })
  return { list, total: list.length, agencies }
}

/**
 * @param {Object[]} missions 即将发射列表（已做过期过滤为佳）
 * @param {string} selectedKey '_all' | agency key
 */
function buildUpcomingAgencyFilterState(missions, selectedKey) {
  const { list, total, agencies } = collectAgencyAggregation(missions)

  const { launchCardUiText } = require('./locale.js')
  const allChip = {
    key: '_all',
    label: launchCardUiText('allTasks'),
    count: total,
    logoUrl: ALL_TASKS_CHIP_LOGO,
    logoRemoteSrc: '',
    logoBgTone: '',
    active: selectedKey === '_all' || !selectedKey
  }

  const agencyChips = agencies.map((a) => ({
    ...a,
    active: selectedKey === a.key
  }))

  const displayed = [allChip, ...agencyChips]

  const filtered =
    !selectedKey || selectedKey === '_all'
      ? list
      : list.filter((m) => getAgencyKeyFromMission(m) === selectedKey)

  const emptyFiltered = filtered.length === 0 && total > 0

  return {
    upcomingAgencyChipsDisplayed: displayed,
    displayedUpcomingMissions: filtered,
    upcomingAgencyFilterEmpty: emptyFiltered
  }
}

function filterMissionsByAgencyKey(missions, selectedKey) {
  const list = Array.isArray(missions) ? missions : []
  if (!selectedKey || selectedKey === '_all') return list
  return list.filter((m) => getAgencyKeyFromMission(m) === selectedKey)
}

module.exports = {
  getAgencyKeyFromMission,
  buildUpcomingAgencyFilterState,
  filterMissionsByAgencyKey
}
