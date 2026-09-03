/**
 * Extract monitor station + starlink + pass sections into monitor-pages component.
 */
const fs = require('fs')
const path = require('path')

let wxml = fs.readFileSync('pages/monitor/monitor.wxml', 'utf8')
const wxss = fs.readFileSync('pages/monitor/monitor.wxss', 'utf8')
const lines = wxss.split(/\n/)

const start = wxml.indexOf('    <view class="station-section')
if (start < 0) throw new Error('station-section missing')
// end after pass-section — next major block
const after = wxml.slice(start)
const endCands = [
  after.indexOf('\n    <monitor-galleries'),
  after.indexOf('\n    <monitor-orbital'),
  after.indexOf('\n    <!-- 图鉴'),
  after.indexOf('\n    <!-- 轨道'),
  after.indexOf('\n    <view class="gallery'),
  after.indexOf('\n    <view class="orbital')
].filter((n) => n > 0)
if (!endCands.length) {
  console.log(after.slice(0, 100))
  // dump nearby class names
  const classes = after.match(/class="[^"]+"/g) || []
  console.log(classes.slice(0, 40))
  throw new Error('monitor section end not found')
}
const end = start + Math.min(...endCands)
const raw = wxml.slice(start, end)
console.log('block KB', (raw.length / 1024).toFixed(1), 'next', wxml.slice(end, end + 80).replace(/\s+/g, ' '))

const root = 'subpackages/monitor-pages/components/monitor-core-sections'
fs.mkdirSync(root, { recursive: true })

// Rewrite events to emit — keep data field names as properties via pass-through listing later
let compWxml = raw
// Generic: convert bindtap/binderror handlers that are page methods to emit*
const handlers = [
  'onLoadStationStatus',
  'onStationCardTap',
  'onStationImageLoad',
  'onStationImageError',
  'onDockedShipTap',
  'onLoadStarlink',
  'retryLoadStarlink',
  'toggleStarlinkPause',
  'onStarlinkTouchStart',
  'onStarlinkTouchMove',
  'onStarlinkTouchEnd',
  'openStarlinkFullscreen',
  'openStarlinkAR',
  'onPassLocationTap',
  'onPassRefresh',
  'openPassMap',
  'onPassCardTap'
]
for (const h of handlers) {
  const emit = 'emit' + h.replace(/^on/, '').replace(/^open/, 'Open')
  compWxml = compWxml
    .replace(new RegExp(`bindtap="${h}"`, 'g'), `bindtap="${emit}"`)
    .replace(new RegExp(`catchtap="${h}"`, 'g'), `catchtap="${emit}"`)
    .replace(new RegExp(`binderror="${h}"`, 'g'), `binderror="${emit}"`)
    .replace(new RegExp(`bindload="${h}"`, 'g'), `bindload="${emit}"`)
    .replace(new RegExp(`bindtouchstart="${h}"`, 'g'), `bindtouchstart="${emit}"`)
    .replace(new RegExp(`bindtouchmove="${h}"`, 'g'), `bindtouchmove="${emit}"`)
    .replace(new RegExp(`bindtouchend="${h}"`, 'g'), `bindtouchend="${emit}"`)
}

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
    /^\.(station-|starlink-|pass-|monitor-block)/.test(t) ||
    /^\.theme-light \.(station-|starlink-|pass-)/.test(t)
  )
})
fs.writeFileSync(path.join(root, 'index.wxss'), css)
fs.writeFileSync(
  path.join(root, 'index.json'),
  JSON.stringify({ component: true, styleIsolation: 'apply-shared' }, null, 2) + '\n'
)

// Collect {{ident}} top-level property candidates from wxml
const propSet = new Set()
const re = /\{\{([a-zA-Z_][\w]*)/g
let m
while ((m = re.exec(compWxml))) {
  if (!['true', 'false', 'item', 'index', 'length'].includes(m[1])) propSet.add(m[1])
}
// Remove item.* parents already covered
const props = [...propSet].sort()
console.log('props', props.length, props.slice(0, 30).join(','))

const propBlock = props
  .map((n) => {
    // guess type
    if (/^(is|show|has|enable|loading|pending)/i.test(n) || /Loaded$|Visible$|Paused$|Ready$/.test(n)) {
      return `    ${n}: { type: Boolean, value: false }`
    }
    if (/Count$|Height$|Width$|Index$|Progress$/.test(n)) {
      return `    ${n}: { type: Number, value: 0 }`
    }
    if (/s$|List$|Items$|Rows$|Ships$|Passes$/.test(n) || n === 'starlinkCanvas' ) {
      return `    ${n}: { type: null, value: null }`
    }
    return `    ${n}: { type: null, value: null }`
  })
  .join(',\n')

const methodBlock = handlers
  .map((h) => {
    const emit = 'emit' + h.replace(/^on/, '').replace(/^open/, 'Open')
    return `    ${emit}(e) {
      const ds = (e && e.currentTarget && e.currentTarget.dataset) || {}
      this.triggerEvent('${h.toLowerCase()}', { ...ds, detail: e && e.detail, touches: e && e.touches, changedTouches: e && e.changedTouches })
    }`
  })
  .join(',\n')

fs.writeFileSync(
  path.join(root, 'index.js'),
  `Component({
  options: { styleIsolation: 'apply-shared' },
  properties: {
${propBlock}
  },
  methods: {
${methodBlock}
  }
})
`
)

const binds = props
  .map((n) => {
    const kebab = n.replace(/([A-Z])/g, '-$1').toLowerCase()
    return `      ${kebab}="{{${n}}}"`
  })
  .join('\n')

const eventBinds = handlers
  .map((h) => {
    return `      bind:${h.toLowerCase()}="${h}"`
  })
  .join('\n')

const pageReplace = `    <monitor-core-sections
${binds}
${eventBinds}
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
    (/^\.(station-|starlink-|pass-|monitor-block)/.test(t) || /^\.theme-light \.(station-|starlink-|pass-)/.test(t))
  ) {
    active = true
  }
  if (!active) kept.push(l)
  d += opens - closes
  if (active && d === 0 && opens + closes > 0) active = false
}

fs.writeFileSync('pages/monitor/monitor.wxml', wxml)
fs.writeFileSync('pages/monitor/monitor.wxss', kept.join('\n'))
console.log('css KB', (css.length / 1024).toFixed(1))
console.log('page wxss', (kept.join('\n').length / 1024).toFixed(1), 'wxml', (wxml.length / 1024).toFixed(1))
