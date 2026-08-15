/**
 * 1) prize section → profile-sections
 * 2) road-closure banner → index-extra component
 * 3) leftover calendar-* CSS on index page → calendar-stats wxss
 */
const fs = require('fs')
const path = require('path')

// ---- prize ----
let pw = fs.readFileSync('pages/profile/profile.wxml', 'utf8')
const prizeStart = pw.indexOf('    <!-- ══ 我的奖品')
const prizeEnd = pw.indexOf('    <!-- ══ 设置 / 我的提醒')
if (prizeStart < 0 || prizeEnd < 0) throw new Error('prize markers missing')
let prizeBlock = pw.slice(prizeStart, prizeEnd)
prizeBlock = prizeBlock.replace('catchtap="onCopyTracking"', 'catchtap="emitOnCopyTracking"')
pw = pw.slice(0, prizeStart) + pw.slice(prizeEnd)

// inject my-prizes prop on profile-sections
if (!pw.includes('my-prizes=')) {
  pw = pw.replace(
    '<profile-sections\n',
    '<profile-sections\n      my-prizes="{{myPrizes}}"\n'
  )
}
fs.writeFileSync('pages/profile/profile.wxml', pw)

let secWxml = fs.readFileSync(
  'subpackages/profile-extra/components/profile-sections/index.wxml',
  'utf8'
)
if (!secWxml.includes('prize-section')) {
  // insert after opening theme root, before settings drawer — or before about
  const insertAt = secWxml.indexOf('  <!-- ══ 在线客服')
  const block =
    prizeBlock
      .replace(/^    /gm, '  ')
      .replace(/\{\{myPrizes/g, '{{myPrizes') + '\n'
  // Actually prizeBlock already uses myPrizes — property name myPrizes
  if (insertAt < 0) throw new Error('insert point missing')
  secWxml = secWxml.slice(0, insertAt) + block + secWxml.slice(insertAt)
  fs.writeFileSync(
    'subpackages/profile-extra/components/profile-sections/index.wxml',
    secWxml
  )
}

let secJs = fs.readFileSync(
  'subpackages/profile-extra/components/profile-sections/index.js',
  'utf8'
)
if (!secJs.includes('myPrizes:')) {
  secJs = secJs.replace(
    'figmaShareEnabled: { type: Boolean, value: false }\n  },',
    `figmaShareEnabled: { type: Boolean, value: false },
    myPrizes: { type: Array, value: [] }
  },`
  )
  secJs = secJs.replace(
    "emitOnShareFigma(e) { this._emit('onShareFigma', e) }\n  }",
    `emitOnShareFigma(e) { this._emit('onShareFigma', e) },
    emitOnCopyTracking(e) { this._emit('onCopyTracking', e) }
  }`
  )
  fs.writeFileSync(
    'subpackages/profile-extra/components/profile-sections/index.js',
    secJs
  )
}

let pjs = fs.readFileSync('pages/profile/profile.js', 'utf8')
if (!pjs.includes("'onCopyTracking'") || !pjs.includes('SECTION_EVENT_METHODS')) {
  /* already in PROFILE_LAZY maybe */
}
if (!pjs.includes("SECTION_EVENT_METHODS") ) throw new Error('no section events')
if (!/SECTION_EVENT_METHODS = \[[\s\S]*'onCopyTracking'/.test(pjs)) {
  pjs = pjs.replace(
    'const SECTION_EVENT_METHODS = [',
    "const SECTION_EVENT_METHODS = [\n  'onCopyTracking',"
  )
  fs.writeFileSync('pages/profile/profile.js', pjs)
}

// move prize CSS
const pageWxssPath = 'pages/profile/profile.wxss'
const secWxssPath = 'subpackages/profile-extra/components/profile-sections/index.wxss'
const pageLines = fs.readFileSync(pageWxssPath, 'utf8').split(/\n/)
const prizePred = (l) => {
  const t = l.trim()
  return /^\.prize-/.test(t) || /^\.theme-light \.prize-/.test(t)
}
const moved = []
const kept = []
let d = 0
let active = false
for (const l of pageLines) {
  const opens = (l.match(/\{/g) || []).length
  const closes = (l.match(/\}/g) || []).length
  if (d === 0 && prizePred(l)) active = true
  if (active) moved.push(l)
  else kept.push(l)
  d += opens - closes
  if (active && d === 0 && opens + closes > 0) active = false
}
fs.writeFileSync(pageWxssPath, kept.join('\n'))
fs.appendFileSync(secWxssPath, '\n' + moved.join('\n') + '\n')
console.log('prize css KB', (Buffer.byteLength(moved.join('\n')) / 1024).toFixed(1))

// ---- road closure component ----
let iw = fs.readFileSync('pages/index/index.wxml', 'utf8')
const rcStart = iw.indexOf('    <!-- 封路通知横幅')
const rcEnd = iw.indexOf('    <!-- 发射日历视图')
if (rcStart < 0 || rcEnd < 0) throw new Error('road closure markers missing')
const rcRaw = iw.slice(rcStart, rcEnd)
const root = 'subpackages/index-extra/components/index-road-closure'
fs.mkdirSync(root, { recursive: true })
let rcWxml = rcRaw
  .replace('bindtap="openRoadClosureDetail"', 'bindtap="emitOpen"')
  .replace(/^    /gm, '')
rcWxml = rcWxml.replace(
  /wx:if="\{\{roadClosureNotice && roadClosureNotice\.isActive && missionType !== 'calendar'\}\}"/,
  'wx:if="{{notice && notice.isActive && missionType !== \'calendar\'}}"'
)
rcWxml = rcWxml
  .replace(/\{\{roadClosureNotice\./g, '{{notice.')
  .replace(/\{\{roadClosureNotice\./g, '{{notice.')
fs.writeFileSync(path.join(root, 'index.wxml'), rcWxml.trim() + '\n')
fs.writeFileSync(
  path.join(root, 'index.js'),
  `Component({
  options: { styleIsolation: 'apply-shared' },
  properties: {
    notice: { type: Object, value: null },
    missionType: { type: String, value: 'upcoming' }
  },
  methods: {
    emitOpen() { this.triggerEvent('open') }
  }
})
`
)
fs.writeFileSync(
  path.join(root, 'index.json'),
  JSON.stringify({ component: true, styleIsolation: 'apply-shared' }, null, 2) + '\n'
)

const indexLines = fs.readFileSync('pages/index/index.wxss', 'utf8').split(/\n/)
const roadPred = (l) => {
  const t = l.trim()
  return /^\.road-closure/.test(t) || /^\.theme-light \.road-closure/.test(t)
}
const roadCss = []
const indexKept = []
d = 0
active = false
for (const l of indexLines) {
  const opens = (l.match(/\{/g) || []).length
  const closes = (l.match(/\}/g) || []).length
  if (d === 0 && roadPred(l)) active = true
  if (active) roadCss.push(l)
  else indexKept.push(l)
  d += opens - closes
  if (active && d === 0 && opens + closes > 0) active = false
}
fs.writeFileSync(path.join(root, 'index.wxss'), roadCss.join('\n') + '\n')

iw =
  iw.slice(0, rcStart) +
  `    <index-road-closure
      notice="{{roadClosureNotice}}"
      mission-type="{{missionType}}"
      bind:open="openRoadClosureDetail"
    />

` +
  iw.slice(rcEnd)
fs.writeFileSync('pages/index/index.wxml', iw)

// calendar-day-missions 仍在页面级，CSS 必须留主包（组件 wxss 盖不到兄弟节点）
fs.writeFileSync('pages/index/index.wxss', indexKept.join('\n'))
console.log('road css', (Buffer.byteLength(roadCss.join('\n')) / 1024).toFixed(1))

const ij = JSON.parse(fs.readFileSync('pages/index/index.json', 'utf8'))
ij.usingComponents['index-road-closure'] =
  '/subpackages/index-extra/components/index-road-closure/index'
ij.componentPlaceholder = ij.componentPlaceholder || {}
ij.componentPlaceholder['index-road-closure'] = 'view'
fs.writeFileSync('pages/index/index.json', JSON.stringify(ij, null, 2) + '\n')
console.log('prize+road done')
