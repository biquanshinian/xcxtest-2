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

/** CZ-3BE / Long March 3B/E / 3BE 写成同一组别名，避免 70-10=60 反复落空 */
function rocketAliases(name) {
  const n = normalizeName(name)
  if (!n) return []
  const out = new Set()
  const add = (s) => {
    const t = normalizeName(s)
    if (t) out.add(t)
  }
  add(n)
  // 3BE ↔ 3B E；不要把 3B 拆成 3 B（会和 3B/E 对不上）
  const expanded = n.replace(/\b(\d+)([a-z])([a-z]+)\b/g, '$1$2 $3')
  const compact = n.replace(/\b(\d+[a-z])\s+([a-z]+)\b/g, '$1$2')
  add(expanded)
  add(compact)
  ;[n, expanded, compact].forEach((s) => {
    if (/^cz\b/.test(s)) add(s.replace(/^cz\b/, 'long march'))
    if (/^long march\b/.test(s)) add(s.replace(/^long march\b/, 'cz'))
  })
  return Array.from(out)
}

/** 火箭名：站点给短名（Falcon 9），LL2 给全名（Falcon 9 Block 5），互为前缀即算命中 */
function rocketScore(siteRocket, ll2Rocket, ll2Subtitle) {
  const aliases = rocketAliases(siteRocket)
  if (!aliases.length) return 0
  const candidates = []
  ;[ll2Rocket, ll2Subtitle].forEach((x) => {
    rocketAliases(x).forEach((a) => candidates.push(a))
  })
  for (let i = 0; i < aliases.length; i += 1) {
    const a = aliases[i]
    for (let j = 0; j < candidates.length; j += 1) {
      const b = candidates[j]
      if (!b) continue
      if (a === b) return 15
      if (b.indexOf(a) === 0 || a.indexOf(b) === 0) return 12
      const aw = a.split(' ')
      const bw = b.split(' ')
      const shared = aw.filter((w) => bw.indexOf(w) >= 0).length
      if (shared && shared === Math.min(aw.length, bw.length)) return 9
    }
  }
  return -10
}

function earliestMs(isoList) {
  const times = (Array.isArray(isoList) ? isoList : [])
    .map((s) => Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(String(s)) ? s : String(s) + 'Z'))
    .filter((n) => Number.isFinite(n))
  return times.length ? Math.min(...times) : 0
}

/** 已废弃：页面 ISO 是航警窗口，不是发射 NET，参与打分会绑错 ll2Id */
function dateScore() {
  return 0
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
  // 数字是硬约束：任一侧有组号就必须一致，避免「Starlink」配到 17-51
  if (sd.join('-') !== ld.join('-')) return -100

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
  // 不把页面上的航警 ISO 时间当发射 NET：窗口常比发射早/晚数周，会绑错 ll2Id
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
  rocketAliases,
  rocketScore,
  dateScore,
  scoreMatch,
  matchEntryToLaunch
}
