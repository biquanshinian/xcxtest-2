/**
 * Extract index image carousel into index-extra component.
 */
const fs = require('fs')
const path = require('path')

let wxml = fs.readFileSync('pages/index/index.wxml', 'utf8')
const wxss = fs.readFileSync('pages/index/index.wxss', 'utf8')
const lines = wxss.split(/\n/)

const start = wxml.indexOf('    <view class="image-carousel image-carousel--skeleton"')
if (start < 0) throw new Error('carousel skeleton not found')
// find end after the main carousel view closes — look for next major section
const after = wxml.slice(start)
// two top-level carousel views: skeleton + main. End before next indent-4 comment or section
const endRelCandidates = [
  after.indexOf('\n    <!-- 封路通知横幅'),
  after.indexOf('\n    <view class="road-closure-banner"')
].filter((n) => n > 0)
if (!endRelCandidates.length) {
  // fallback: find second top-level view close after skeleton+main
  console.log(after.slice(0, 200))
  throw new Error('carousel end not found')
}
const end = start + Math.min(...endRelCandidates)
const raw = wxml.slice(start, end)
console.log('carousel block KB', (raw.length / 1024).toFixed(1), 'end preview', wxml.slice(end, end + 60).replace(/\s+/g, ' '))

const root = 'subpackages/index-extra/components/index-carousel'
fs.mkdirSync(root, { recursive: true })

const compWxml = raw
  .replace(/binderror="onCarouselImageError"/g, 'binderror="emitImageError"')
  .replace(/bindload="onCarouselImageLoad"/g, 'bindload="emitImageLoad"')
  .replace(/bindtap="previewCarouselImage"/g, 'bindtap="emitPreview"')
  .replace(/bindlongpress="saveCarouselImage"/g, 'bindlongpress="emitSave"')
  .replace(/catchtap="onCarouselCaptionTap"/g, 'catchtap="emitCaption"')
  .replace(/bindtap="onCarouselVideoTap"/g, 'bindtap="emitVideoTap"')
  .replace(/bindchange="onCarouselChange"/g, 'bindchange="emitChange"')
  .replace(/bindtimeupdate="onCarouselVideoTimeUpdate"/g, 'bindtimeupdate="emitTimeUpdate"')
  .replace(/binderror="onCarouselVideoError"/g, 'binderror="emitVideoError"')
  .replace(/bindtap="onCarouselAvatarError"/g, 'bindtap="emitAvatarError"')
  .replace(/binderror="onCarouselAvatarError"/g, 'binderror="emitAvatarError"')

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
    t.startsWith('.image-carousel') ||
    t.startsWith('.carousel-') ||
    t.startsWith('.swiper') ||
    t.startsWith('.theme-light .image-carousel') ||
    t.startsWith('.theme-light .carousel-') ||
    t.startsWith('.theme-light .swiper')
  )
})
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
    carouselPending: { type: Boolean, value: false },
    carouselItems: { type: Array, value: [] },
    missionType: { type: String, value: 'upcoming' },
    carouselCurrent: { type: Number, value: 0 }
  },
  methods: {
    _ds(e) { return (e && e.currentTarget && e.currentTarget.dataset) || {} },
    emitImageError(e) { this.triggerEvent('imageerror', { ...this._ds(e), detail: e.detail }) },
    emitImageLoad(e) { this.triggerEvent('imageload', { ...this._ds(e), detail: e.detail }) },
    emitPreview(e) { this.triggerEvent('preview', this._ds(e)) },
    emitSave(e) { this.triggerEvent('save', this._ds(e)) },
    emitCaption(e) { this.triggerEvent('caption', this._ds(e)) },
    emitVideoTap(e) { this.triggerEvent('videotap', this._ds(e)) },
    emitChange(e) { this.triggerEvent('change', e.detail || {}) },
    emitTimeUpdate(e) { this.triggerEvent('timeupdate', { ...this._ds(e), detail: e.detail }) },
    emitVideoError(e) { this.triggerEvent('videoerror', { ...this._ds(e), detail: e.detail }) },
    emitAvatarError(e) { this.triggerEvent('avatarerror', this._ds(e)) }
  }
})
`
)

const pageReplace = `    <index-carousel
      carousel-pending="{{carouselPending}}"
      carousel-items="{{carouselItems}}"
      mission-type="{{missionType}}"
      carousel-current="{{carouselCurrent}}"
      bind:imageerror="onCarouselImageError"
      bind:imageload="onCarouselImageLoad"
      bind:preview="previewCarouselImage"
      bind:save="saveCarouselImage"
      bind:caption="onCarouselCaptionTap"
      bind:videotap="onCarouselVideoTap"
      bind:change="onCarouselChange"
      bind:timeupdate="onCarouselVideoTimeUpdate"
      bind:videoerror="onCarouselVideoError"
      bind:avatarerror="onCarouselAvatarError"
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
    (t.startsWith('.image-carousel') ||
      t.startsWith('.carousel-') ||
      t.startsWith('.swiper') ||
      t.startsWith('.theme-light .image-carousel') ||
      t.startsWith('.theme-light .carousel-') ||
      t.startsWith('.theme-light .swiper'))
  ) {
    active = true
  }
  if (!active) kept.push(l)
  d += opens - closes
  if (active && d === 0 && opens + closes > 0) active = false
}

fs.writeFileSync('pages/index/index.wxml', wxml)
fs.writeFileSync('pages/index/index.wxss', kept.join('\n'))
console.log('css KB', (css.length / 1024).toFixed(1))
console.log('page wxss', (kept.join('\n').length / 1024).toFixed(1), 'wxml', (wxml.length / 1024).toFixed(1))
