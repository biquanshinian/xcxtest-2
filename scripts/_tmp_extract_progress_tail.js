/**
 * Extract progress page below-fold blocks AFTER event-updates into progress-extra.
 * Starts at road-closure notice-section (not hardware / event-updates).
 */
const fs = require('fs')
const path = require('path')

const WXML = 'pages/progress/progress.wxml'
const WXSS = 'pages/progress/progress.wxss'
const ROOT = 'subpackages/progress-extra/components/progress-below-fold'

let wxml = fs.readFileSync(WXML, 'utf8')
const start = wxml.indexOf('    <!-- 封路通知（API + DB覆盖） -->')
if (start < 0) throw new Error('notice start missing')
// end before closing scroll-view / container — find last major section end
const endMarkers = [
  wxml.indexOf('\n  </scroll-view>', start),
  wxml.indexOf('\n</scroll-view>', start)
].filter((n) => n > 0)
if (!endMarkers.length) throw new Error('scroll-view end missing')
const end = Math.min(...endMarkers)
const raw = wxml.slice(start, end)
console.log('block KB', (Buffer.byteLength(raw) / 1024).toFixed(1))
console.log('tail preview', wxml.slice(end, end + 60).replace(/\s+/g, ' '))

const HANDLERS = [
  'openRoadClosureDetail',
  'openRoadClosureMap',
  'openVehicleTracker',
  'openMissionSim',
  'onNsfChecklistTap',
  'onNsfChecklistExpand',
  'onFlightTestTap',
  'onFlightTestExpand',
  'goNsfChecklistDetail',
  'goLl2Timeline',
  'goLl2LaunchUpdates'
]

// Discover actual handlers from block
const found = new Set()
const re = /\b(?:bindtap|catchtap|bind:tap)="([a-zA-Z_][\w]*)"/g
let m
while ((m = re.exec(raw))) found.add(m[1])
console.log('handlers found', [...found].join(', '))

function toEmit(name) {
  return 'emit' + name.charAt(0).toUpperCase() + name.slice(1)
}

let compWxml = raw
for (const h of found) {
  const emit = toEmit(h)
  for (const a of ['bindtap', 'catchtap']) {
    compWxml = compWxml.split(`${a}="${h}"`).join(`${a}="${emit}"`)
  }
  compWxml = compWxml.split(`bind:tap="${h}"`).join(`bind:tap="${emit}"`)
}
compWxml = `<view class="progress-below-fold {{themeClass}}">\n${compWxml.trim()}\n</view>\n`

fs.mkdirSync(ROOT, { recursive: true })
fs.writeFileSync(path.join(ROOT, 'index.wxml'), compWxml)

// props from {{ident}}
const propSet = new Set(['themeClass'])
const pre = /\{\{([a-zA-Z_][\w]*)/g
while ((m = pre.exec(compWxml))) {
  if (!['true', 'false', 'item', 'index', 'length'].includes(m[1])) propSet.add(m[1])
}
const props = [...propSet].sort()
console.log('props', props.length)

const propDecls = props
  .map((n) => {
    if (n === 'themeClass') return `    ${n}: { type: String, value: '' }`
    if (/^(is|enable|show|has|roadClosureSyncing)/i.test(n) || /Expanded$|Loading$|Loaded$/.test(n)) {
      return `    ${n}: { type: Boolean, value: false }`
    }
    if (/Count$|Total$|Done$|Height$|Index$/.test(n)) return `    ${n}: { type: Number, value: 0 }`
    if (/s$|List$|Items$|Visible$/.test(n) || n === 'roadClosure') return `    ${n}: { type: null, value: null }`
    return `    ${n}: { type: null, value: null }`
  })
  .join(',\n')

const methodDecls = [...found]
  .map((h) => `    ${toEmit(h)}(e) { this._emit('${h}', e) }`)
  .join(',\n')

fs.writeFileSync(
  path.join(ROOT, 'index.js'),
  `Component({
  options: { styleIsolation: 'apply-shared' },
  properties: {
${propDecls}
  },
  methods: {
    _emit(name, e) {
      this.triggerEvent('sectionevent', {
        name,
        dataset: (e && e.currentTarget && e.currentTarget.dataset) || {},
        edetail: (e && e.detail) || {}
      })
    },
${methodDecls}
  }
})
`
)
fs.writeFileSync(
  path.join(ROOT, 'index.json'),
  JSON.stringify({ component: true, styleIsolation: 'apply-shared' }, null, 2) + '\n'
)

// CSS: notice / mission-sim / nsf-checklist / flight-
const lines = fs.readFileSync(WXSS, 'utf8').split(/\n/)
function cssPred(l) {
  const t = l.trim()
  return (
    /^\.(notice-|mission-sim-|nsf-checklist|flight-checklist|schedule-|time-label|time-value)/.test(t) ||
    /^\.theme-light \.(notice-|mission-sim-|nsf-checklist|flight-checklist|schedule-|time-)/.test(t)
  )
}
const moved = []
const kept = []
let d = 0
let active = false
for (const l of lines) {
  const opens = (l.match(/\{/g) || []).length
  const closes = (l.match(/\}/g) || []).length
  if (d === 0 && cssPred(l)) active = true
  if (active) moved.push(l)
  else kept.push(l)
  d += opens - closes
  if (active && d === 0 && opens + closes > 0) active = false
}
fs.writeFileSync(path.join(ROOT, 'index.wxss'), moved.join('\n') + '\n')
fs.writeFileSync(WXSS, kept.join('\n'))

const binds = props
  .map((n) => {
    const kebab = n.replace(/([A-Z])/g, '-$1').toLowerCase()
    return `      ${kebab}="{{${n}}}"`
  })
  .join('\n')

const slot = `    <!-- 封路/在轨追踪/指挥室/检查清单：progress-extra 分包 -->
    <progress-below-fold
${binds}
      bind:sectionevent="onProgressBelowFoldEvent"
    />

`
wxml = wxml.slice(0, start) + slot + wxml.slice(end)
fs.writeFileSync(WXML, wxml)

const j = JSON.parse(fs.readFileSync('pages/progress/progress.json', 'utf8'))
j.usingComponents['progress-below-fold'] =
  '/subpackages/progress-extra/components/progress-below-fold/index'
j.componentPlaceholder = j.componentPlaceholder || {}
j.componentPlaceholder['progress-below-fold'] = 'view'
j.componentPlaceholder['event-updates'] = j.componentPlaceholder['event-updates'] || 'view'
fs.writeFileSync('pages/progress/progress.json', JSON.stringify(j, null, 2) + '\n')

let pjs = fs.readFileSync('pages/progress/progress.js', 'utf8')
if (!pjs.includes('onProgressBelowFoldEvent')) {
  const bridge = `
  onProgressBelowFoldEvent(e) {
    const { name, dataset, edetail } = (e && e.detail) || {}
    if (!name || typeof this[name] !== 'function') return
    return this[name]({ currentTarget: { dataset: dataset || {} }, detail: edetail || {} })
  },
`
  if (pjs.includes('onProgressSectionEvent')) {
    pjs = pjs.replace(/(onProgressSectionEvent\([\s\S]*?\n  \},)/, `$1\n${bridge}`)
  } else {
    pjs = pjs.replace(/Page\(\{/, `Page({\n${bridge}`)
  }
  fs.writeFileSync('pages/progress/progress.js', pjs)
}

console.log('css moved', (Buffer.byteLength(moved.join('\n')) / 1024).toFixed(1))
console.log('page wxss', (Buffer.byteLength(kept.join('\n')) / 1024).toFixed(1), 'wxml', (Buffer.byteLength(wxml) / 1024).toFixed(1))
