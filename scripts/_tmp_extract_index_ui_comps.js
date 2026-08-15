/**
 * Extract announcement + share-dialog UI from index into index-extra components.
 */
const fs = require('fs')
const path = require('path')

function writeComp(name, wxmlBody, wxssBody, props, methods) {
  const root = path.join('subpackages/index-extra/components', name)
  fs.mkdirSync(root, { recursive: true })
  fs.writeFileSync(path.join(root, 'index.wxml'), wxmlBody.trim() + '\n')
  fs.writeFileSync(path.join(root, 'index.wxss'), wxssBody.trim() + '\n')
  fs.writeFileSync(
    path.join(root, 'index.json'),
    JSON.stringify({ component: true, styleIsolation: 'apply-shared' }, null, 2) + '\n'
  )
  const propLines = Object.entries(props)
    .map(([k, t]) => `    ${k}: { type: ${t.type}, value: ${JSON.stringify(t.value)} }`)
    .join(',\n')
  const methodLines = methods
    .map((m) => {
      if (m === 'noop') return `    noop() {}`
      if (m === 'preventMove') return `    preventMove() {}`
      return `    ${m}(e) { this.triggerEvent('${m.replace(/^on/, '').toLowerCase()}', (e && e.detail) || {}) }`
    })
    .join(',\n')
  // handcrafted methods below
  return root
}

let wxml = fs.readFileSync('pages/index/index.wxml', 'utf8')
let wxss = fs.readFileSync('pages/index/index.wxss', 'utf8')
const lines = wxss.split(/\n/)

// ---- share dialog ----
const shareStart = wxml.indexOf('  <!-- 任务卡片长按 → 分享面板')
const shareEnd = wxml.indexOf('  <!-- 公告详情弹窗')
if (shareStart < 0 || shareEnd < 0) throw new Error('share marks missing')
let shareBlock = wxml.slice(shareStart, shareEnd)
const shareInner = shareBlock
  .replace(/shareSheetVisible/g, 'visible')
  .replace(/pendingShareMission/g, 'mission')
  .replace(/bindtap="onShareSheetClose"/g, 'bindtap="onClose"')
  .replace(/bindtap="onShareSheetItemTap"/g, 'bindtap="onItemTap"')
  .replace(/catchtouchmove="noop"/g, 'catchtouchmove="noop"')

const shareRoot = 'subpackages/index-extra/components/index-share-sheet'
fs.mkdirSync(shareRoot, { recursive: true })
fs.writeFileSync(path.join(shareRoot, 'index.wxml'), shareInner.replace(/^[\s\S]*?<view/, '<view').replace(/<!-- 任务卡片长按[\s\S]*?\n/, '') + '\n')
// rewrite file cleanly
const shareWxml = `<view class="share-dialog-mask {{visible ? 'share-dialog-mask--visible' : ''}}"
      wx:if="{{visible}}"
      bindtap="onClose"
      catchtouchmove="noop">
  <view class="share-dialog" catchtap="noop">
    <view class="share-dialog-header">
      <text class="share-dialog-title">分享任务</text>
      <text class="share-dialog-subtitle" wx:if="{{mission.missionName}}">{{mission.missionName}}</text>
    </view>
    <view class="share-dialog-actions share-dialog-actions--single">
      <button class="share-dialog-btn"
              open-type="share"
              data-share-type="mission"
              data-id="{{mission.id}}"
              data-type="{{mission.detailType}}"
              hover-class="share-dialog-btn--hover"
              plain="true"
              bindtap="onItemTap">
        <view class="share-dialog-icon">
          <image class="share-dialog-icon-img" src="/images/icons/ic-share-chat.svg" mode="aspectFit"></image>
        </view>
        <text class="share-dialog-label">微信好友</text>
      </button>
    </view>
    <view class="share-dialog-cancel" hover-class="share-dialog-cancel--hover" bindtap="onClose">取消</view>
  </view>
</view>
`
fs.writeFileSync(path.join(shareRoot, 'index.wxml'), shareWxml)

// extract share CSS by class prefix
function extractCssByPrefixes(prefixes) {
  const out = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const isRule =
      prefixes.some((p) => line.startsWith('.' + p) || line.includes(' .' + p) || line.startsWith('@keyframes ' + p)) ||
      (line.startsWith('@keyframes') && prefixes.some((p) => line.includes(p)))
    if (isRule || (prefixes.some((p) => line.includes('.' + p)) && /^[.@]/.test(line.trim()) === false && false)) {
      // collect until brace balance 0
    }
    i++
  }
  // simpler: line ranges from known comments
  return ''
}

// Find share-dialog CSS
let shareCssStart = -1
let shareCssEnd = -1
for (let i = 0; i < lines.length; i++) {
  if (shareCssStart < 0 && (lines[i].includes('share-dialog-mask') || lines[i].includes('分享面板') || lines[i].includes('share-dialog'))) {
    if (lines[i].startsWith('.share-dialog') || lines[i].includes('分享')) shareCssStart = i
  }
}
// scan for contiguous .share-dialog / .share-dialog-mask block region
const shareCssLines = []
let collecting = false
for (let i = 0; i < lines.length; i++) {
  const l = lines[i]
  if (/^\.share-dialog/.test(l) || /^\.share-dialog-mask/.test(l) || (collecting && (/^\s/.test(l) || l.trim() === '' || /^@keyframes share/.test(l) || /^\}/.test(l.trim())))) {
    if (/^\.share-dialog/.test(l) || /^\.share-dialog-mask/.test(l) || /^@keyframes share/.test(l)) collecting = true
    if (collecting) shareCssLines.push(l)
    if (collecting && l.trim() === '}' && !/^\s/.test(lines[i + 1] || 'x') && !/^@keyframes share/.test(lines[i + 1] || '') && !/^\.share-dialog/.test(lines[i + 1] || '')) {
      // peek ahead
      let j = i + 1
      while (j < lines.length && lines[j].trim() === '') j++
      if (j < lines.length && !/^\.share-dialog/.test(lines[j]) && !/^@keyframes share/.test(lines[j])) {
        collecting = false
      }
    }
  } else if (collecting) {
    collecting = false
  }
}

// More robust CSS extract: include any line that is part of rules whose selector contains share-dialog
const cssChunks = []
let buf = []
let depth = 0
let active = false
for (let i = 0; i < lines.length; i++) {
  const l = lines[i]
  const opens = (l.match(/\{/g) || []).length
  const closes = (l.match(/\}/g) || []).length
  if (depth === 0 && (/share-dialog/.test(l) || /@keyframes share/.test(l))) {
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
const shareCss = cssChunks.join('\n\n') + '\n'
fs.writeFileSync(path.join(shareRoot, 'index.wxss'), shareCss)
fs.writeFileSync(
  path.join(shareRoot, 'index.json'),
  JSON.stringify({ component: true, styleIsolation: 'apply-shared' }, null, 2) + '\n'
)
fs.writeFileSync(
  path.join(shareRoot, 'index.js'),
  `Component({
  options: { styleIsolation: 'apply-shared' },
  properties: {
    visible: { type: Boolean, value: false },
    mission: { type: Object, value: null }
  },
  methods: {
    noop() {},
    onClose() { this.triggerEvent('close') },
    onItemTap() { this.triggerEvent('itemtap') }
  }
})
`
)

const shareReplace = `  <!-- 分享面板：index-extra 组件 -->
  <index-share-sheet
    visible="{{shareSheetVisible}}"
    mission="{{pendingShareMission}}"
    bind:close="onShareSheetClose"
    bind:itemtap="onShareSheetItemTap"
  />

`
wxml = wxml.slice(0, shareStart) + shareReplace + wxml.slice(shareEnd)

// Remove share CSS from page wxss
const shareCssSet = new Set(shareCss.split(/\n/).map((l) => l.trim()).filter(Boolean))
// Remove by re-parsing: drop rules whose selector contains share-dialog
const kept = []
buf = []
depth = 0
active = false
for (let i = 0; i < lines.length; i++) {
  const l = lines[i]
  const opens = (l.match(/\{/g) || []).length
  const closes = (l.match(/\}/g) || []).length
  if (depth === 0 && (/share-dialog/.test(l) || /@keyframes share/.test(l))) {
    active = true
  }
  if (!active) kept.push(l)
  depth += opens - closes
  if (active && depth === 0 && opens + closes > 0) {
    active = false
  }
}
wxss = kept.join('\n')

fs.writeFileSync('pages/index/index.wxml', wxml)
fs.writeFileSync('pages/index/index.wxss', wxss)

console.log('share-sheet css KB', (shareCss.length / 1024).toFixed(1))
console.log('page wxml KB', (wxml.length / 1024).toFixed(1), 'wxss KB', (wxss.length / 1024).toFixed(1))
