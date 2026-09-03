/**
 * SPACE_NOTICES_FEATURE — 站点 entry ↔ LL2 发射的模糊匹配（纯函数，可本地测）
 *
 * 站点只给「任务名 - 火箭名」，LL2 给「火箭名 | 任务名」。任务名里的数字序列
 * 区分度最高（Starlink 17-51 与 17-52 只差一位），所以数字不一致直接判负。
 */

/** "TianLian-2 (06)" / "Tianlian 2-06" → "tianlian 2 06" */
function normalizeName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

/** 数字组序列："starlink group 17 51" → ['17','51']；前导零归一（06 → 6） */
function digitGroups(s) {
  return (String(s || '').match(/\d+/g) || []).map((d) => String(Number(d)))
}

function words(s) {
  return normalizeName(s)
    .split(' ')
    .filter((w) => w && !/^\d+$/.test(w))
}

/** LL2 名："Falcon 9 Block 5 | Starlink Group 17-51" → { rocketPart, missionPart } */
function splitLl2Title(title) {
  const t = String(title || '')
  const idx = t.indexOf('|')
  if (idx < 0) return { rocketPart: '', missionPart: t.trim() }
  return {
    rocketPart: t.slice(0, idx).trim(),
    missionPart: t.slice(idx + 1).trim()
  }
}

/** 火箭名：站点给短名（Falcon 9），LL2 给全名（Falcon 9 Block 5），互为前缀即算命中 */
function rocketScore(siteRocket, ll2Rocket, ll2Subtitle) {
  const a = normalizeName(siteRocket)
  if (!a) return 0
  const candidates = [normalizeName(ll2Rocket), normalizeName(ll2Subtitle)].filter(Boolean)
  for (const b of candidates) {
    if (!b) continue
    if (a === b) return 15
    if (b.indexOf(a) === 0 || a.indexOf(b) === 0) return 12
    const aw = a.split(' ')
    const bw = b.split(' ')
    const shared = aw.filter((w) => bw.indexOf(w) >= 0).length
    if (shared && shared === Math.min(aw.length, bw.length)) return 9
  }
  return -10
}

function earliestMs(isoList) {
  const times = (Array.isArray(isoList) ? isoList : [])
    .map((s) => Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(String(s)) ? s : String(s) + 'Z'))
    .filter((n) => Number.isFinite(n))
  return times.length ? Math.min(...times) : 0
}

/** 站点通告窗口最早时刻 ≈ 首次发射尝试；相差越小越可信 */
function dateScore(siteDates, ll2Net) {
  const site = earliestMs(siteDates)
  const net = Date.parse(String(ll2Net || ''))
  if (!site || !Number.isFinite(net)) return 0
  const days = Math.abs(net - site) / 86400000
  if (days <= 1.5) return 15
  if (days <= 4) return 10
  if (days <= 10) return 4
  if (days <= 30) return -8
  return -30
}

/**
 * @param {{ missionName: string, rocketName?: string, siteDates?: string[] }} meta
 * @param {{ ll2Id: string, title: string, subtitle?: string, net?: string }} launch
 * @returns {number} 分数，越大越可信
 */
function scoreMatch(meta, launch) {
  const { rocketPart, missionPart } = splitLl2Title(launch && launch.title)
  const siteMission = normalizeName(meta && meta.missionName)
  const ll2Mission = normalizeName(missionPart)
  if (!siteMission || !ll2Mission) return -100

  const sd = digitGroups(siteMission)
  const ld = digitGroups(ll2Mission)
  // 数字是硬约束：都有数字但序列不同 → 不是同一场任务
  if (sd.length && ld.length && sd.join('-') !== ld.join('-')) return -100

  let score = 0
  if (siteMission === ll2Mission) {
    score = 70
  } else {
    const sw = words(siteMission)
    const lw = words(ll2Mission)
    const shared = sw.filter((w) => lw.indexOf(w) >= 0).length
    const union = new Set(sw.concat(lw)).size || 1
    const overlap = shared / union
    // 数字序列一致且共享词条：任务名多半只是写法差异（TianLian-2 (06) / Tianlian 2-06）
    if (sd.length && sd.join('-') === ld.join('-') && shared) score = 55 + Math.round(overlap * 15)
    else score = Math.round(overlap * 55)
  }

  score += rocketScore(meta && meta.rocketName, rocketPart, launch && launch.subtitle)
  score += dateScore(meta && meta.siteDates, launch && launch.net)
  return score
}

const MATCH_THRESHOLD = 62

/**
 * @param {object} meta entry 元信息
 * @param {object[]} launches LL2 slim 列表
 * @returns {{ launch: object, score: number }|null}
 */
function matchEntryToLaunch(meta, launches) {
  let best = null
  let bestScore = -Infinity
  ;(Array.isArray(launches) ? launches : []).forEach((l) => {
    if (!l || !l.ll2Id) return
    const s = scoreMatch(meta, l)
    if (s > bestScore) {
      bestScore = s
      best = l
    }
  })
  if (!best || bestScore < MATCH_THRESHOLD) return null
  return { launch: best, score: bestScore }
}

module.exports = {
  MATCH_THRESHOLD,
  normalizeName,
  digitGroups,
  splitLl2Title,
  rocketScore,
  dateScore,
  scoreMatch,
  matchEntryToLaunch
}
