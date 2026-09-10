/**
 * Carefully extract ONLY the badge-modal block from profile.wxml + related CSS.
 */
const fs = require('fs')
const path = require('path')

let wxml = fs.readFileSync('pages/profile/profile.wxml', 'utf8')
let wxss = fs.readFileSync('pages/profile/profile.wxss', 'utf8')
const lines = wxss.split(/\n/)

const start = wxml.indexOf('    <view class="badge-modal-mask"')
if (start < 0) throw new Error('badge-modal-mask not found')

// Walk braces/views: find the end of this top-level mask view by tracking <view and </view>
let i = start
let depth = 0
let end = -1
const slice = wxml.slice(start)
const re = /<\/?view\b[^>]*>/g
let m
while ((m = re.exec(slice))) {
  const tag = m[0]
  if (tag.startsWith('</view')) {
    depth--
    if (depth === 0) {
      end = start + m.index + tag.length
      break
    }
  } else if (!/\/>$/.test(tag)) {
    depth++
  }
}
if (end < 0) throw new Error('failed to find badge modal end, depth=' + depth)

const raw = wxml.slice(start, end)
console.log('badge block chars', raw.length, 'preview end:', raw.slice(-80).replace(/\s+/g, ' '))

const root = 'subpackages/profile-extra/components/badge-modal'
fs.mkdirSync(root, { recursive: true })

const compWxml = raw
  .replace(/showBadgeModal/g, 'visible')
  .replace(/badgeModalData/g, 'data')
  .replace(/bindtap="closeBadgeModal"/g, 'bindtap="onClose"')
  .trim() + '\n'

fs.writeFileSync(path.join(root, 'index.wxml'), compWxml)

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

const css = extractCss((l) => /badge-modal/.test(l) || /@keyframes badge/.test(l))
fs.writeFileSync(path.join(root, 'index.wxss'), css)
fs.writeFileSync(
  path.join(root, 'index.json'),
  JSON.stringify({ component: true, styleIsolation: 'apply-shared' }, null, 2) + '\n'
)
fs.writeFileSync(
  path.join(root, 'index.js'),
  `Component({
  options: { styleIsolation: 'apply-shared' },
  properties: {
    visible: { type: Boolean, value: false },
    data: { type: Object, value: null }
  },
  methods: {
    onClose() { this.triggerEvent('close') }
  }
})
`
)

wxml = wxml.slice(0, start) + '    <badge-modal visible="{{showBadgeModal}}" data="{{badgeModalData}}" bind:close="closeBadgeModal" />\n' + wxml.slice(end)

const kept = []
let d = 0
let active = false
for (const l of lines) {
  const opens = (l.match(/\{/g) || []).length
  const closes = (l.match(/\}/g) || []).length
  if (d === 0 && (/badge-modal/.test(l) || /@keyframes badge/.test(l))) active = true
  if (!active) kept.push(l)
  d += opens - closes
  if (active && d === 0 && opens + closes > 0) active = false
}
// also strip comments
let outCss = kept.join('\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\n{3,}/g, '\n\n')

fs.writeFileSync('pages/profile/profile.wxml', wxml)
fs.writeFileSync('pages/profile/profile.wxss', outCss)
console.log('badge css KB', (css.length / 1024).toFixed(1))
console.log('comp wxml KB', (compWxml.length / 1024).toFixed(1))
console.log('profile still has profile-sections?', wxml.includes('profile-sections'))
console.log('profile still has prize-section?', wxml.includes('prize-section'))
console.log('profile wxss KB', (outCss.length / 1024).toFixed(1))
