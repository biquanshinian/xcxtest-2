/**
 * Extract progress below-fold UI (hardware→ll2) into progress-extra component.
 * WXML keeps original data field names as component properties.
 */
const fs = require('fs')
const path = require('path')

let wxml = fs.readFileSync('pages/progress/progress.wxml', 'utf8')
const wxss = fs.readFileSync('pages/progress/progress.wxss', 'utf8')
const lines = wxss.split(/\n/)

const startMark = '    <!-- 星舰硬件设施（NSF 数据） -->'
const endMark = '    <view style="height: {{tabBarReservedHeight}}px;"></view>'
const start = wxml.indexOf(startMark)
const end = wxml.indexOf(endMark)
if (start < 0 || end < 0) throw new Error('marks missing')

const raw = wxml.slice(start, end)
console.log('block KB', (raw.length / 1024).toFixed(1))

const root = 'subpackages/progress-extra/components/progress-below-fold'
fs.mkdirSync(root, { recursive: true })

const compWxml = raw
  .replace(/bindtap="openStarbaseMap"/g, 'bindtap="emitOpenStarbaseMap"')
  .replace(/bindtap="openLaunchSiteMap"/g, 'bindtap="emitOpenLaunchSiteMap"')
  .replace(/bindtap="onHardwareViewAllTap"/g, 'bindtap="emitViewAll"')
  .replace(/bindtap="onHardwareCardTap"/g, 'bindtap="emitCardTap"')
  .replace(/binderror="onHardwareImageError"/g, 'binderror="emitImageError"')
  .replace(/catchtap="onHardwareFilterTap"/g, 'catchtap="emitFilterTap"')
  .replace(/bindtap="onNsfChecklistExpandTap"/g, 'bindtap="emitNsfExpand"')
  .replace(/bindtap="onLl2TimelineExpandTap"/g, 'bindtap="emitLl2Timeline"')
  .replace(/bindtap="onLl2LaunchUpdatesExpandTap"/g, 'bindtap="emitLl2Updates"')
  .replace(/catchtap="onFlightChecklistDetailTap"/g, 'catchtap="emitChecklistDetail"')
  .replace(/bindtap="openMissionSim"/g, 'bindtap="emitOpenMissionSim"')

fs.writeFileSync(path.join(root, 'index.wxml'), compWxml.trim() + '\n')

function extractCss(pred) {
  const chunks = []
  let buf = []
  let d = 0
  let active = false
  for (const l of lines) {
    const opens = (l.match(/\{/g) || []).length
    const closes = (l.match(/\}/g) || []).length
    if (d === 0 && pred(l)) active = true
    if (active) buf.push(l)
    d += opens - closes
    if (active && d === 0 && opens + closes > 0) {
      chunks.push(buf.join('\n'))
      buf = []
      active = false
    }
  }
  return chunks.join('\n\n') + '\n'
}

const css = extractCss((l) => {
  const t = l.trim()
  return (
    /^\.(hardware-|nsf-|ll2-|flight-checklist-|mission-sim-entry|booster-view-all|progress-map-)/.test(t) ||
    /^\.theme-light \.(hardware-|nsf-|ll2-|flight-checklist-|mission-sim-entry|booster-view-all|progress-map-)/.test(t)
  )
})
fs.writeFileSync(path.join(root, 'index.wxss'), css)
fs.writeFileSync(
  path.join(root, 'index.json'),
  JSON.stringify({ component: true, styleIsolation: 'apply-shared' }, null, 2) + '\n'
)

const propNames = [
  ['hardwareLoaded', 'Boolean', false],
  ['hardwareFilterKey', 'String', 'all'],
  ['hardwareFilterOptions', 'Array', []],
  ['displayedHardwareVehicles', 'Array', []],
  ['nsfChecklistItems', 'Array', []],
  ['nsfChecklistProgressDone', 'Number', 0],
  ['nsfChecklistProgressTotal', 'Number', 0],
  ['nsfChecklistSyncing', 'Boolean', false],
  ['nsfChecklistError', 'String', ''],
  ['belowFoldSectionsReady', 'Boolean', false],
  ['showLaunchLibraryUpdates', 'Boolean', false],
  ['ll2TimelineRows', 'Array', []],
  ['ll2TimelineLoading', 'Boolean', false],
  ['ll2TimelineError', 'String', ''],
  ['ll2LaunchUpdates', 'Array', []],
  ['ll2LaunchUpdatesLoading', 'Boolean', false],
  ['ll2LaunchUpdatesError', 'String', '']
]

const propBlock = propNames
  .map(([n, t, v]) => `    ${n}: { type: ${t}, value: ${JSON.stringify(v)} }`)
  .join(',\n')

fs.writeFileSync(
  path.join(root, 'index.js'),
  `Component({
  options: { styleIsolation: 'apply-shared' },
  properties: {
${propBlock}
  },
  methods: {
    emitOpenStarbaseMap() { this.triggerEvent('openstarbasemap') },
    emitOpenLaunchSiteMap() { this.triggerEvent('openlaunchsitemap') },
    emitViewAll() { this.triggerEvent('viewall') },
    emitCardTap(e) { this.triggerEvent('cardtap', (e.currentTarget && e.currentTarget.dataset) || {}) },
    emitImageError(e) { this.triggerEvent('imageerror', (e.currentTarget && e.currentTarget.dataset) || {}) },
    emitFilterTap(e) { this.triggerEvent('filtertap', (e.currentTarget && e.currentTarget.dataset) || {}) },
    emitNsfExpand() { this.triggerEvent('nsfexpand') },
    emitLl2Timeline() { this.triggerEvent('ll2timeline') },
    emitLl2Updates() { this.triggerEvent('ll2updates') },
    emitChecklistDetail(e) { this.triggerEvent('checklistdetail', (e.currentTarget && e.currentTarget.dataset) || {}) },
    emitOpenMissionSim() { this.triggerEvent('openmissionsim') }
  }
})
`
)

const binds = propNames
  .map(([n]) => {
    const kebab = n.replace(/([A-Z])/g, '-$1').toLowerCase()
    return `      ${kebab}="{{${n}}}"`
  })
  .join('\n')

const pageReplace = `    <progress-below-fold
${binds}
      bind:openstarbasemap="openStarbaseMap"
      bind:openlaunchsitemap="openLaunchSiteMap"
      bind:viewall="onHardwareViewAllTap"
      bind:cardtap="onHardwareCardTapFromComp"
      bind:imageerror="onHardwareImageErrorFromComp"
      bind:filtertap="onHardwareFilterTapFromComp"
      bind:nsfexpand="onNsfChecklistExpandTap"
      bind:ll2timeline="onLl2TimelineExpandTap"
      bind:ll2updates="onLl2LaunchUpdatesExpandTap"
      bind:checklistdetail="onFlightChecklistDetailTapFromComp"
      bind:openmissionsim="openMissionSim"
    />

`

wxml = wxml.slice(0, start) + pageReplace + wxml.slice(end)

const kept = []
let d = 0
let active = false
for (const l of lines) {
  const opens = (l.match(/\{/g) || []).length
  const closes = (l.match(/\}/g) || []).length
  const t = l.trim()
  if (
    d === 0 &&
    (/^\.(hardware-|nsf-|ll2-|flight-checklist-|mission-sim-entry|booster-view-all|progress-map-)/.test(t) ||
      /^\.theme-light \.(hardware-|nsf-|ll2-|flight-checklist-|mission-sim-entry|booster-view-all|progress-map-)/.test(t))
  ) {
    active = true
  }
  if (!active) kept.push(l)
  d += opens - closes
  if (active && d === 0 && opens + closes > 0) active = false
}

fs.writeFileSync('pages/progress/progress.wxml', wxml)
fs.writeFileSync(
  'pages/progress/progress.wxss',
  kept.join('\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\n{3,}/g, '\n\n')
)
console.log('css KB', (css.length / 1024).toFixed(1))
console.log('page wxss', (fs.statSync('pages/progress/progress.wxss').size / 1024).toFixed(1))
console.log('page wxml', (wxml.length / 1024).toFixed(1))
