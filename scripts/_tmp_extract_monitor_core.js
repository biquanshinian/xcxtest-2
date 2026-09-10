/**
 * Extract monitor station + space-notices + starlink + pass UI into
 * monitor-pages/components/monitor-core-sections (same pattern as monitor-galleries).
 */
const fs = require('fs')
const path = require('path')

const PAGE_WXML = 'pages/monitor/monitor.wxml'
const PAGE_WXSS = 'pages/monitor/monitor.wxss'
const ROOT = 'subpackages/monitor-pages/components/monitor-core-sections'

let wxml = fs.readFileSync(PAGE_WXML, 'utf8')
const wxss = fs.readFileSync(PAGE_WXSS, 'utf8')
const lines = wxss.split(/\n/)

const start = wxml.indexOf('    <!-- 进度显示框 -->')
const startAlt = wxml.indexOf('    <view class="station-section')
const startAt = start >= 0 ? start : startAlt
if (startAt < 0) throw new Error('station block start missing')

const endMarker = '    <!-- 图鉴四板块'
const end = wxml.indexOf(endMarker)
if (end < 0) throw new Error('galleries marker missing')

const raw = wxml.slice(startAt, end)
console.log('block KB', (Buffer.byteLength(raw) / 1024).toFixed(1))

const HANDLERS = [
  'onLoadStationStatus',
  'onStationCardTap',
  'onStationImageLoad',
  'onStationImageError',
  'markPendingShareType',
  'onLoadStarlink',
  'retryLoadStarlink',
  'toggleStarlinkPause',
  'onStarlinkTouchStart',
  'onStarlinkTouchMove',
  'onStarlinkTouchEnd',
  'openStarlinkFullscreen',
  'openSpaceNotices',
  'refreshPasses',
  'onLoadStarlinkPasses',
  'openPassDetail',
  'openPassMap',
  'openStarlinkAR',
  'requestPassLocation'
]

function toEmit(name) {
  return 'emit' + name.charAt(0).toUpperCase() + name.slice(1)
}

let compWxml = raw
for (const h of HANDLERS) {
  const emit = toEmit(h)
  const attrs = ['bindtap', 'catchtap', 'binderror', 'bindload', 'bindtouchstart', 'bindtouchmove', 'bindtouchend']
  for (const a of attrs) {
    compWxml = compWxml.split(`${a}="${h}"`).join(`${a}="${emit}"`)
  }
  // lazy-load-card uses bind:tap
  compWxml = compWxml.split(`bind:tap="${h}"`).join(`bind:tap="${emit}"`)
}

// wrap with themeClass root for theme-light descendant selectors
compWxml = `<view class="monitor-core-sections {{themeClass}}">\n${compWxml.trim()}\n</view>\n`

fs.mkdirSync(ROOT, { recursive: true })
fs.writeFileSync(path.join(ROOT, 'index.wxml'), compWxml)

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

function cssPred(l) {
  const t = l.trim()
  return (
    /^\.(station-|starlink-|pass-|space-notices|MARS-preview|preview-card)/.test(t) ||
    /^\.theme-light \.(station-|starlink-|pass-|space-notices|MARS-preview|preview-card)/.test(t) ||
    /^\.ctrl-icon-/.test(t) ||
    /^\.theme-light \.ctrl-icon-/.test(t)
  )
}

const css = extractCss(cssPred)
fs.writeFileSync(path.join(ROOT, 'index.wxss'), css)

const propNames = [
  'themeClass',
  'isProUser',
  'stationReady',
  'stationLoading',
  'stationList',
  'stationImageLoadedMap',
  'starlinkReady',
  'starlinkLoading',
  'starlinkError',
  'starlinkCount',
  'starlinkPaused',
  'starlinkUpdateTime',
  'enableSpaceNotices',
  'passReady',
  'passLoading',
  'passNoLocation',
  'passError',
  'passLocation',
  'passList'
]

const propDecls = propNames
  .map((n) => {
    if (n === 'themeClass') return `    ${n}: { type: String, value: '' }`
    if (/^(is|enable|stationReady|stationLoading|starlinkReady|starlinkLoading|starlinkPaused|passReady|passLoading|passNoLocation)/.test(n)) {
      return `    ${n}: { type: Boolean, value: false }`
    }
    if (/Count$/.test(n)) return `    ${n}: { type: Number, value: 0 }`
    if (n.endsWith('List') || n.endsWith('Map')) return `    ${n}: { type: null, value: null }`
    return `    ${n}: { type: String, value: '' }`
  })
  .join(',\n')

const methodDecls = HANDLERS.map(
  (h) => `    ${toEmit(h)}(e) { this._emit('${h}', e) }`
).join(',\n')

fs.writeFileSync(
  path.join(ROOT, 'index.js'),
  `/**
 * 监控页核心板块：空间站 / 星链分布 / 发射通告 / 过境预报
 * 展示在 monitor-pages 分包；交互经 coreevent 回传页面。
 */
Component({
  options: { styleIsolation: 'apply-shared' },
  properties: {
${propDecls}
  },
  methods: {
    _emit(name, e) {
      this.triggerEvent('coreevent', {
        name,
        dataset: (e && e.currentTarget && e.currentTarget.dataset) || {},
        edetail: (e && e.detail) || {},
        touches: (e && e.touches) || null,
        changedTouches: (e && e.changedTouches) || null
      })
    },
${methodDecls}
  }
})
`
)

fs.writeFileSync(
  path.join(ROOT, 'index.json'),
  JSON.stringify(
    {
      component: true,
      styleIsolation: 'apply-shared',
      usingComponents: {
        'lazy-load-card': '/components/lazy-load-card/index'
      }
    },
    null,
    2
  ) + '\n'
)

const pageSlot = `    <!-- 空间站/星链/通告/过境：组件在 monitor-pages，交互经 coreevent 回传 -->
    <monitor-core-sections
      theme-class="{{themeClass}}"
      is-pro-user="{{isProUser}}"
      station-ready="{{stationReady}}"
      station-loading="{{stationLoading}}"
      station-list="{{stationList}}"
      station-image-loaded-map="{{stationImageLoadedMap}}"
      starlink-ready="{{starlinkReady}}"
      starlink-loading="{{starlinkLoading}}"
      starlink-error="{{starlinkError}}"
      starlink-count="{{starlinkCount}}"
      starlink-paused="{{starlinkPaused}}"
      starlink-update-time="{{starlinkUpdateTime}}"
      enable-space-notices="{{enableSpaceNotices}}"
      pass-ready="{{passReady}}"
      pass-loading="{{passLoading}}"
      pass-no-location="{{passNoLocation}}"
      pass-error="{{passError}}"
      pass-location="{{passLocation}}"
      pass-list="{{passList}}"
      bind:coreevent="onCoreSectionEvent"
    />

`

wxml = wxml.slice(0, startAt) + pageSlot + wxml.slice(end)
fs.writeFileSync(PAGE_WXML, wxml)

const kept = []
let d = 0
let active = false
for (const l of lines) {
  const opens = (l.match(/\{/g) || []).length
  const closes = (l.match(/\}/g) || []).length
  if (d === 0 && cssPred(l)) active = true
  if (!active) kept.push(l)
  d += opens - closes
  if (active && d === 0 && opens + closes > 0) active = false
}
fs.writeFileSync(PAGE_WXSS, kept.join('\n'))

// wire page json
const jsonPath = 'pages/monitor/monitor.json'
const j = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
j.usingComponents['monitor-core-sections'] =
  '/subpackages/monitor-pages/components/monitor-core-sections/index'
j.componentPlaceholder = j.componentPlaceholder || {}
j.componentPlaceholder['monitor-core-sections'] = 'view'
fs.writeFileSync(jsonPath, JSON.stringify(j, null, 2) + '\n')

// wire page event bridge near galleries handler if present
let pageJs = fs.readFileSync('pages/monitor/monitor.js', 'utf8')
if (!pageJs.includes('onCoreSectionEvent')) {
  const bridge = `
  /** 分包核心板块交互回传（还原 dataset/detail/touches） */
  onCoreSectionEvent(e) {
    const d = (e && e.detail) || {}
    const name = d.name
    if (!name || typeof this[name] !== 'function') return
    const fake = {
      currentTarget: { dataset: d.dataset || {} },
      target: { dataset: d.dataset || {} },
      detail: d.edetail || {},
      touches: d.touches || [],
      changedTouches: d.changedTouches || []
    }
    this[name](fake)
  },
`
  // insert after onGalleryEvent if exists, else before onShareAppMessage / Page({ methods
  if (pageJs.includes('onGalleryEvent(')) {
    pageJs = pageJs.replace(/(onGalleryEvent\([\s\S]*?\n  \},)/, `$1\n${bridge}`)
  } else {
    pageJs = pageJs.replace(/Page\(\{/, `Page({\n${bridge}`)
  }
  fs.writeFileSync('pages/monitor/monitor.js', pageJs)
}

console.log('css moved KB', (Buffer.byteLength(css) / 1024).toFixed(1))
console.log(
  'page wxss',
  (Buffer.byteLength(kept.join('\n')) / 1024).toFixed(1),
  'wxml',
  (Buffer.byteLength(wxml) / 1024).toFixed(1)
)
