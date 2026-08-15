/**
 * Extract announcement banner + dialog from index into index-extra component.
 * Preserves original dialog markup (vote UI) with property renames.
 */
const fs = require('fs')
const path = require('path')

let wxml = fs.readFileSync('pages/index/index.wxml', 'utf8')
const wxss = fs.readFileSync('pages/index/index.wxss', 'utf8')
const lines = wxss.split(/\n/)

const bannerStart = wxml.indexOf('    <!-- 系统通知滚动横幅 -->')
const bannerEnd = wxml.indexOf('    <!-- 发射倒计时卡片')
if (bannerStart < 0 || bannerEnd < 0) throw new Error('banner marks missing')

const dialogStart = wxml.indexOf('  <!-- 公告详情弹窗')
if (dialogStart < 0) throw new Error('dialog mark missing')
const after = wxml.slice(dialogStart)
const endRel = after.indexOf('\n<nasa-float')
if (endRel < 0) throw new Error('dialog end (nasa-float) not found')
const dialogEnd = dialogStart + endRel

const bannerRaw = wxml.slice(bannerStart, bannerEnd)
const dialogRaw = wxml.slice(dialogStart, dialogEnd)

function rename(src) {
  return src
    .replace(/announcementDialogVisible/g, 'dialogVisible')
    .replace(/announcementScrollMaxPx/g, 'scrollMaxPx')
    .replace(/announcementVote/g, 'vote')
    .replace(/announcementBanner/g, 'banner')
    .replace(/bindtap="openAnnouncementDetail"/g, 'bindtap="onOpen"')
    .replace(/catchtap="closeAnnouncementBanner"/g, 'catchtap="onCloseBanner"')
    .replace(/bindtap="closeAnnouncementDetail"/g, 'bindtap="onCloseDialog"')
    .replace(/catchtap="onAnnouncementVoteTap"/g, 'catchtap="onVoteTap"')
    .replace(/bindcontact="onContactCallback"/g, 'bindcontact="onContact"')
}

const root = 'subpackages/index-extra/components/index-announcement'
fs.mkdirSync(root, { recursive: true })

const bannerPart = rename(bannerRaw).replace(/^\s*<!-- 系统通知滚动横幅 -->\s*/, '')
const dialogPart = rename(dialogRaw).replace(/^\s*<!-- 公告详情弹窗[\s\S]*?\n/, '')

fs.writeFileSync(path.join(root, 'index.wxml'), bannerPart.trim() + '\n\n' + dialogPart.trim() + '\n')

const cssChunks = []
let buf = []
let depth = 0
let active = false
for (let i = 0; i < lines.length; i++) {
  const l = lines[i]
  const opens = (l.match(/\{/g) || []).length
  const closes = (l.match(/\}/g) || []).length
  if (depth === 0 && (/announcement-/.test(l) || /@keyframes announcement/.test(l))) {
    active = true
  }
  if (active) buf.push(l)
  depth += opens - closes
  if (active && depth === 0 && opens + closes > 0) {
    cssChunks.push(buf.join('\n'))
    buf = []
    active = false
  }
}
const annCss = cssChunks.join('\n\n') + '\n'
fs.writeFileSync(path.join(root, 'index.wxss'), annCss)
fs.writeFileSync(
  path.join(root, 'index.json'),
  JSON.stringify({ component: true, styleIsolation: 'apply-shared' }, null, 2) + '\n'
)
fs.writeFileSync(
  path.join(root, 'index.js'),
  `Component({
  options: { styleIsolation: 'apply-shared' },
  properties: {
    banner: { type: Object, value: null },
    dialogVisible: { type: Boolean, value: false },
    vote: { type: Object, value: null },
    scrollMaxPx: { type: Number, value: 320 }
  },
  methods: {
    noop() {},
    onOpen() { this.triggerEvent('open') },
    onCloseBanner() { this.triggerEvent('closebanner') },
    onCloseDialog() { this.triggerEvent('closedialog') },
    onVoteTap(e) {
      const ds = (e && e.currentTarget && e.currentTarget.dataset) || {}
      this.triggerEvent('votetap', ds)
    },
    onContact(e) { this.triggerEvent('contact', (e && e.detail) || {}) }
  }
})
`
)

const bannerReplace = `    <!-- 系统通知：index-extra 组件 -->
    <index-announcement
      banner="{{announcementBanner}}"
      dialog-visible="{{announcementDialogVisible}}"
      vote="{{announcementVote}}"
      scroll-max-px="{{announcementScrollMaxPx}}"
      bind:open="openAnnouncementDetail"
      bind:closebanner="closeAnnouncementBanner"
      bind:closedialog="closeAnnouncementDetail"
      bind:votetap="onAnnouncementVoteFromComp"
      bind:contact="onContactCallback"
    />

`

wxml = wxml.slice(0, bannerStart) + bannerReplace + wxml.slice(bannerEnd)
const d0 = wxml.indexOf('  <!-- 公告详情弹窗')
if (d0 < 0) throw new Error('dialog mark missing after banner replace')
const after2 = wxml.slice(d0)
const end2 = after2.indexOf('\n<nasa-float')
if (end2 < 0) throw new Error('dialog end missing after banner replace')
wxml = wxml.slice(0, d0) + wxml.slice(d0 + end2)

const kept = []
buf = []
depth = 0
active = false
for (let i = 0; i < lines.length; i++) {
  const l = lines[i]
  const opens = (l.match(/\{/g) || []).length
  const closes = (l.match(/\}/g) || []).length
  if (depth === 0 && (/announcement-/.test(l) || /@keyframes announcement/.test(l))) {
    active = true
  }
  if (!active) kept.push(l)
  depth += opens - closes
  if (active && depth === 0 && opens + closes > 0) {
    active = false
  }
}

fs.writeFileSync('pages/index/index.wxml', wxml)
fs.writeFileSync('pages/index/index.wxss', kept.join('\n'))
console.log('announcement css KB', (annCss.length / 1024).toFixed(1))
console.log('comp wxml KB', (fs.statSync(path.join(root, 'index.wxml')).size / 1024).toFixed(1))
console.log('page wxml', (wxml.length / 1024).toFixed(1), 'wxss', (kept.join('\n').length / 1024).toFixed(1))
