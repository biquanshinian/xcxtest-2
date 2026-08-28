/**
 * 改期弹窗用的首页任务卡火箭配置图解析。
 * 只被 shared 分包的 net-change-modal 使用，不放主包 utils/，
 * 避免微信「主包内不应存在主包未使用的 JS 文件」质量检查失败。
 * 与倒计时/列表卡相同：resolveMissionRocketImage(stamped, rocketNameForImage, configuration, true)
 * 允许 default 盖章被 fuzzy/字典升级，禁止把已正确的配置图降回 default。
 */
const { resolveMissionRocketImage, getRocketImage, isDefaultRocketSrc } = require('../../../utils/util.js')
const { rocketNameForImage } = require('../../../utils/launch-card-i18n.js')

function resolveIndexCardRocketImage(mission) {
  if (!mission || typeof mission !== 'object') return ''
  const name = rocketNameForImage(mission)
  const stamped = mission.rocketImage || mission.image || ''
  const cfg = mission.rocketConfiguration || null
  const resolved = resolveMissionRocketImage(stamped, name, cfg, true)
  if (resolved && !isDefaultRocketSrc(resolved)) return resolved
  if (stamped && !isDefaultRocketSrc(stamped)) return stamped
  if (resolved) return resolved
  if (name) {
    const fallback = getRocketImage(name) || ''
    if (fallback) return fallback
  }
  return stamped || ''
}

function hydrateNetChangePayloadFromCard(payload, card) {
  const base = payload && typeof payload === 'object' ? payload : {}
  if (!card || typeof card !== 'object') return base
  const nameEn = rocketNameForImage(card)
  return Object.assign({}, base, {
    rocketImage: card.rocketImage || card.image || base.rocketImage,
    image: card.rocketImage || card.image || base.image,
    rocketConfiguration: card.rocketConfiguration || base.rocketConfiguration || null,
    rocketName: card.rocketName || base.rocketName,
    rocketNameEn: nameEn || base.rocketNameEn,
    _langPack: card._langPack || base._langPack
  })
}

function normalizeMissionLabel(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[号#]/g, '')
    .replace(/[-_·|/，,]/g, '')
}

function collectHomepageCards(pageData) {
  const out = []
  const seen = {}
  const push = (m) => {
    if (!m || typeof m !== 'object') return
    const id = m.id != null ? String(m.id) : ''
    const key = id || String(m.missionName || m.name || '') + '|' + String(m.rocketName || '')
    if (!key || seen[key]) return
    seen[key] = true
    out.push(m)
  }
  const d = pageData && typeof pageData === 'object' ? pageData : {}
  const lists = [d.upcomingMissions, d.displayedUpcomingMissions]
  for (let i = 0; i < lists.length; i++) {
    const list = lists[i]
    if (!Array.isArray(list)) continue
    for (let j = 0; j < list.length; j++) push(list[j])
  }
  push(d.launchData)
  push(d.overlapSideCard)
  return out
}

function cardLabels(m) {
  const pack = (m && m._langPack) || {}
  return [m && m.missionName, m && m.name, pack.missionNameZh, pack.missionNameEn, pack.nameZh]
    .map(normalizeMissionLabel)
    .filter(Boolean)
}

function labelsMatch(a, b) {
  if (!a || !b) return false
  if (a === b) return true
  return a.length >= 2 && b.length >= 2 && (a.indexOf(b) >= 0 || b.indexOf(a) >= 0)
}

function findHomepageCardForNetChange(payload, pageData) {
  const cards = collectHomepageCards(pageData)
  const id = String((payload && (payload.missionId || payload.id)) || '')
  if (id) {
    for (let i = 0; i < cards.length; i++) {
      if (String(cards[i].id) === id) return cards[i]
    }
  }
  const names = [payload && payload.missionName, payload && payload.name]
    .map(normalizeMissionLabel)
    .filter(Boolean)
  if (names.length) {
    for (let i = 0; i < cards.length; i++) {
      const labels = cardLabels(cards[i])
      for (let n = 0; n < names.length; n++) {
        for (let l = 0; l < labels.length; l++) {
          if (labelsMatch(names[n], labels[l])) return cards[i]
        }
      }
    }
  }
  const rocket = normalizeMissionLabel(
    (payload && (payload.rocketNameEn || payload.rocketName)) || ''
  )
  if (rocket && rocket.length >= 2) {
    const hits = []
    for (let i = 0; i < cards.length; i++) {
      const r = normalizeMissionLabel(rocketNameForImage(cards[i]) || cards[i].rocketName || '')
      if (r && labelsMatch(r, rocket)) hits.push(cards[i])
    }
    if (hits.length === 1) return hits[0]
  }
  return null
}

module.exports = {
  resolveIndexCardRocketImage,
  hydrateNetChangePayloadFromCard,
  findHomepageCardForNetChange
}
