/**
 * 1) Extract vote-box UI from index into index-extra/components/index-vote-box
 * 2) Extract badge-modal from profile into profile-extra/components/badge-modal
 * 3) Move related CSS out of main package pages
 */
const fs = require('fs')
const path = require('path')

function extractCss(lines, pred) {
  const chunks = []
  let buf = []
  let depth = 0
  let active = false
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    const opens = (l.match(/\{/g) || []).length
    const closes = (l.match(/\}/g) || []).length
    if (depth === 0 && pred(l)) active = true
    if (active) buf.push(l)
    depth += opens - closes
    if (active && depth === 0 && opens + closes > 0) {
      chunks.push(buf.join('\n'))
      buf = []
      active = false
    }
  }
  return chunks.join('\n\n') + '\n'
}

function stripCss(lines, pred) {
  const kept = []
  let depth = 0
  let active = false
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    const opens = (l.match(/\{/g) || []).length
    const closes = (l.match(/\}/g) || []).length
    if (depth === 0 && pred(l)) active = true
    if (!active) kept.push(l)
    depth += opens - closes
    if (active && depth === 0 && opens + closes > 0) active = false
  }
  return kept.join('\n')
}

// ===== VOTE BOX =====
let indexWxml = fs.readFileSync('pages/index/index.wxml', 'utf8')
let indexWxss = fs.readFileSync('pages/index/index.wxss', 'utf8')
const indexLines = indexWxss.split(/\n/)

const voteStart = indexWxml.indexOf('            <!-- VOTE_ANTIMIS_V1:START')
const voteEnd = indexWxml.indexOf('            <view wx:else class="vote-box-placeholder"></view>')
if (voteStart < 0 || voteEnd < 0) {
  console.warn('vote marks missing, skip vote extract', voteStart, voteEnd)
} else {
  const voteEndFull = indexWxml.indexOf('\n', voteEnd)
  const voteBlock = indexWxml.slice(voteStart, voteEndFull > 0 ? voteEndFull + 1 : voteEnd)
  // Keep placeholder outside; component replaces the vote-box block including antimiss comment
  const voteInnerEnd = indexWxml.indexOf('            <!-- VOTE_ANTIMIS_V1:END')
  let blockEnd = voteEnd
  if (voteInnerEnd > voteStart) {
    const lineEnd = indexWxml.indexOf('\n', voteInnerEnd)
    blockEnd = lineEnd > 0 ? lineEnd + 1 : voteInnerEnd
  } else {
    // end before placeholder
    blockEnd = voteEnd
  }

  let raw = indexWxml.slice(voteStart, blockEnd)
  // If END marker missing, take until placeholder
  if (!raw.includes('vote-box')) {
    throw new Error('vote block empty')
  }

  // Find actual vote-box view through its closing — use placeholder as end
  raw = indexWxml.slice(voteStart, voteEnd)

  const renamed = raw
    .replace(/activeVoteType/g, 'activeType')
    .replace(/voteOntimeEnabled/g, 'ontimeEnabled')
    .replace(/voteOutcomeEnabled/g, 'outcomeEnabled')
    .replace(/voteSlotVisible/g, 'slotVisible')
    .replace(/voteTotal/g, 'total')
    .replace(/voteData/g, 'vote')
    .replace(/voteGePct/g, 'gePct')
    .replace(/voteBugePct/g, 'bugePct')
    .replace(/myVote/g, 'myVote')
    .replace(/countdown\.isExpired/g, 'cdExpired')
    .replace(/countdownTimeUnknown/g, 'cdUnknown')
    .replace(/launchData\.countryDisplay/g, 'countryDisplay')
    .replace(/catchtap="onVoteTypeSwitch"/g, 'catchtap="onTypeSwitch"')
    .replace(/catchtap="onVote"/g, 'catchtap="onVote"')

  // Simpler: keep original field names via properties mirroring page data fields
  const compWxml =
    renamed
      .replace(/<!-- VOTE_ANTIMIS_V1:START[\s\S]*?\n/, '')
      .trim() + '\n'

  // Actually keep page data field names by using properties with same names — rewrite approach:
  // Use the original markup but wrap; properties pass-through with same names.
  const originalVote = indexWxml.slice(voteStart, voteEnd)
  // strip comment start line
  const voteWxml =
    originalVote.replace(/^\s*<!-- VOTE_ANTIMIS_V1:START[\s\S]*?\n/, '') +
    '\n'

  const voteRoot = 'subpackages/index-extra/components/index-vote-box'
  fs.mkdirSync(voteRoot, { recursive: true })
  fs.writeFileSync(path.join(voteRoot, 'index.wxml'), voteWxml)

  const voteCss = extractCss(
    indexLines,
    (l) => /^\.vote-/.test(l) || /\.vote-/.test(l) && /^[.@]/.test(l.trim()) || /@keyframes vote/.test(l)
  )
  // tighter pred
  const voteCss2 = extractCss(indexLines, (l) => {
    const t = l.trim()
    return (
      t.startsWith('.vote-') ||
      t.startsWith('.theme-light .vote-') ||
      t.startsWith('@keyframes vote') ||
      (t.startsWith('.countdown') && t.includes('vote'))
    )
  })
  fs.writeFileSync(path.join(voteRoot, 'index.wxss'), voteCss2 || voteCss)
  fs.writeFileSync(
    path.join(voteRoot, 'index.json'),
    JSON.stringify({ component: true, styleIsolation: 'apply-shared' }, null, 2) + '\n'
  )
  fs.writeFileSync(
    path.join(voteRoot, 'index.js'),
    `Component({
  options: { styleIsolation: 'apply-shared' },
  properties: {
    slotVisible: { type: Boolean, value: false },
    cdExpired: { type: Boolean, value: false },
    cdUnknown: { type: Boolean, value: false },
    ontimeEnabled: { type: Boolean, value: false },
    outcomeEnabled: { type: Boolean, value: false },
    activeType: { type: String, value: 'ontime' },
    total: { type: Number, value: 0 },
    myVote: { type: String, value: '' },
    vote: { type: Object, value: {} },
    countryDisplay: { type: String, value: '' },
    gePct: { type: Number, value: 0 },
    bugePct: { type: Number, value: 0 }
  },
  methods: {
    onTypeSwitch(e) {
      const type = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.type
      this.triggerEvent('typeswitch', { type })
    },
    onVote(e) {
      const pill = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.pill
      this.triggerEvent('vote', { pill })
    }
  }
})
`
  )

  // Rewrite vote wxml to use properties
  let vw = voteWxml
  vw = vw
    .replace(/voteSlotVisible/g, 'slotVisible')
    .replace(/!countdown\.isExpired && !countdownTimeUnknown && /g, '')
    .replace(
      /wx:if="\{\{!countdown\.isExpired && !countdownTimeUnknown && voteSlotVisible\}\}"/g,
      'wx:if="{{slotVisible && !cdExpired && !cdUnknown}}"'
    )
    .replace(/voteOntimeEnabled/g, 'ontimeEnabled')
    .replace(/voteOutcomeEnabled/g, 'outcomeEnabled')
    .replace(/activeVoteType/g, 'activeType')
    .replace(/voteTotal/g, 'total')
    .replace(/voteData/g, 'vote')
    .replace(/voteGePct/g, 'gePct')
    .replace(/voteBugePct/g, 'bugePct')
    .replace(/launchData\.countryDisplay/g, 'countryDisplay')
    .replace(/catchtap="onVoteTypeSwitch"/g, 'catchtap="onTypeSwitch"')
    .replace(/catchtap="onVote"/g, 'catchtap="onVote"')
  // fix wx:if on root vote-box if still old
  vw = vw.replace(
    /class="vote-box vote-box--antimiss \{\{ontimeEnabled && outcomeEnabled \? 'vote-box--dual' : ''\}\}" wx:if="\{\{slotVisible\}\}"/,
    'class="vote-box vote-box--antimiss {{ontimeEnabled && outcomeEnabled ? \'vote-box--dual\' : \'\'}}" wx:if="{{slotVisible && !cdExpired && !cdUnknown}}"'
  )
  fs.writeFileSync(path.join(voteRoot, 'index.wxml'), vw)

  const pageVote = `            <!-- 竞猜：index-extra 组件 -->
            <index-vote-box
              slot-visible="{{voteSlotVisible}}"
              cd-expired="{{countdown.isExpired}}"
              cd-unknown="{{countdownTimeUnknown}}"
              ontime-enabled="{{voteOntimeEnabled}}"
              outcome-enabled="{{voteOutcomeEnabled}}"
              active-type="{{activeVoteType}}"
              total="{{voteTotal}}"
              my-vote="{{myVote}}"
              vote="{{voteData}}"
              country-display="{{launchData.countryDisplay}}"
              ge-pct="{{voteGePct}}"
              buge-pct="{{voteBugePct}}"
              bind:typeswitch="onVoteTypeSwitchFromComp"
              bind:vote="onVoteFromComp"
            />
`
  indexWxml = indexWxml.slice(0, voteStart) + pageVote + indexWxml.slice(voteEnd)
  indexWxss = stripCss(indexLines, (l) => {
    const t = l.trim()
    return t.startsWith('.vote-') || t.startsWith('.theme-light .vote-') || t.startsWith('@keyframes vote')
  })
  fs.writeFileSync('pages/index/index.wxml', indexWxml)
  fs.writeFileSync('pages/index/index.wxss', indexWxss)
  console.log('vote css KB', ((voteCss2 || voteCss).length / 1024).toFixed(1))
}

// ===== BADGE MODAL =====
let profileWxml = fs.readFileSync('pages/profile/profile.wxml', 'utf8')
let profileWxss = fs.readFileSync('pages/profile/profile.wxss', 'utf8')
const profileLines = profileWxss.split(/\n/)

const badgeStart = profileWxml.indexOf('    <view class="badge-modal-mask"')
if (badgeStart < 0) {
  console.warn('badge modal missing')
} else {
  // find matching end — next sibling at same indent after modal
  const after = profileWxml.slice(badgeStart)
  // badge modal is a mask view; find closing by counting views is hard — use next major comment/section
  let badgeEnd = -1
  const candidates = [
    after.indexOf('\n    <popup-ad'),
    after.indexOf('\n    <privacy-modal'),
    after.indexOf('\n    <demo-overlay'),
    after.indexOf('\n    <milestone-egg'),
    after.indexOf('\n  <popup-ad'),
    after.indexOf('\n  <privacy-modal'),
    after.indexOf('\n  <demo-overlay')
  ].filter((n) => n >= 0)
  if (!candidates.length) throw new Error('badge end not found')
  badgeEnd = badgeStart + Math.min(...candidates)
  const badgeRaw = profileWxml.slice(badgeStart, badgeEnd)

  const badgeRoot = 'subpackages/profile-extra/components/badge-modal'
  fs.mkdirSync(badgeRoot, { recursive: true })
  const badgeWxml = badgeRaw
    .replace(/showBadgeModal/g, 'visible')
    .replace(/badgeModalData/g, 'data')
    .replace(/bindtap="closeBadgeModal"/g, 'bindtap="onClose"')
  fs.writeFileSync(path.join(badgeRoot, 'index.wxml'), badgeWxml.trim() + '\n')

  const badgeCss = extractCss(
    profileLines,
    (l) => /badge-modal/.test(l) || /@keyframes badge/.test(l)
  )
  fs.writeFileSync(path.join(badgeRoot, 'index.wxss'), badgeCss)
  fs.writeFileSync(
    path.join(badgeRoot, 'index.json'),
    JSON.stringify({ component: true, styleIsolation: 'apply-shared' }, null, 2) + '\n'
  )
  fs.writeFileSync(
    path.join(badgeRoot, 'index.js'),
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

  const badgeReplace = `    <badge-modal visible="{{showBadgeModal}}" data="{{badgeModalData}}" bind:close="closeBadgeModal" />

`
  profileWxml = profileWxml.slice(0, badgeStart) + badgeReplace + profileWxml.slice(badgeEnd)
  profileWxss = stripCss(profileLines, (l) => /badge-modal/.test(l) || /@keyframes badge/.test(l))
  fs.writeFileSync('pages/profile/profile.wxml', profileWxml)
  fs.writeFileSync('pages/profile/profile.wxss', profileWxss)
  console.log('badge css KB', (badgeCss.length / 1024).toFixed(1))
}

console.log('index wxml', (fs.statSync('pages/index/index.wxml').size / 1024).toFixed(1))
console.log('index wxss', (fs.statSync('pages/index/index.wxss').size / 1024).toFixed(1))
console.log('profile wxss', (fs.statSync('pages/profile/profile.wxss').size / 1024).toFixed(1))
