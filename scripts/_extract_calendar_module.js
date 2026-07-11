#!/usr/bin/env node
/** One-time helper: extract calendar Page methods from index.js into subpackage module. */
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const indexPath = path.join(root, 'pages/index/index.js')
const outPath = path.join(root, 'subpackages/index-extra/utils/index-calendar-page.js')

const src = fs.readFileSync(indexPath, 'utf8')
const lines = src.split(/\r?\n/)

// 0-based inclusive line ranges to extract (calendar-only Page methods)
const ranges = [
  [2219, 2236], // _processCalendarMission
  [2407, 3350], // calendar helpers + handlers
  [3834, 3849], // _patchCalendarMissionRocketImage
]

const picked = new Set()
for (const [a, b] of ranges) {
  for (let i = a; i <= b; i++) picked.add(i)
}

const methodLines = []
for (let i = 0; i < lines.length; i++) {
  if (picked.has(i)) methodLines.push(lines[i])
}

const header = `/**
 * 首页「发射日历」Tab 逻辑 — 分包异步加载，减轻主包体积
 */
const { formatDate, resolveMissionRocketImage } = require('../../../utils/util.js')
const { attachMissionDetailMeta } = require('../../../utils/index-mission-nav.js')
const {
  CALENDAR_PAGE_LIMIT,
  getValidCalendarCache,
  buildCalendarMissionBatch
} = require('../../../utils/index-mission-services.js')
const {
  shouldHydrateCalendarFromMissionLists,
  buildCalendarExpandedState,
  buildCalendarSummaryFallback,
  buildCalendarDerivedSetData
} = require('../../../utils/index-mission-state.js')
const { CALENDAR_SITE_META } = require('../../../utils/index-page-helpers.js')

const LAUNCH_CALENDAR_ACK_SIG_KEY = '_launch_calendar_ack_missions_sig'

function djb2Hash(str) {
  let hash = 5381
  const s = String(str || '')
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) + hash) + s.charCodeAt(i)
    hash = hash | 0
  }
  return (hash >>> 0).toString(36)
}

function computeLaunchCalendarSignature(missions) {
  const arr = Array.isArray(missions) ? missions : []
  if (!arr.length) return ''
  const rows = arr.map((m) => {
    if (!m) return ''
    const id = m.id != null ? String(m.id) : ''
    const net = String(m.net || m.launchTime || m.launch_time || m.formattedTime || '')
    const badge = String(m.statusBadgeText || m.statusCategory || '')
    const nm = String(m.missionName || m.name || '')
    return [id, net, badge, nm].join('\\x1f')
  }).filter(Boolean).sort()
  const payload = rows.join('\\x1e')
  return \`\${arr.length}:\${djb2Hash(payload)}\`
}

const calendarMethods = {
`

const footer = `
}

function attachTo(page) {
  if (page.__calendarAttached) return calendarMethods
  Object.keys(calendarMethods).forEach((key) => {
    page[key] = calendarMethods[key]
  })
  page.__calendarAttached = true
  return calendarMethods
}

module.exports = {
  attachTo,
  computeLaunchCalendarSignature,
  LAUNCH_CALENDAR_ACK_SIG_KEY
}
`

// Strip trailing comma on last method if needed
let body = methodLines.join('\n')
body = body.replace(/^  /gm, '  ')

fs.writeFileSync(outPath, header + body + footer, 'utf8')
console.log('Wrote', outPath, 'lines:', methodLines.length)
