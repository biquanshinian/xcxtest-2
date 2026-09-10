const { execSync } = require('child_process')
const fs = require('fs')

const head = execSync('git show HEAD:pages/profile/profile.wxss', { encoding: 'utf8' })
const curPath = 'subpackages/profile-extra/components/profile-sections/index.wxss'
const cur = fs.readFileSync(curPath, 'utf8')

const lines = head.split(/\n/)
function extract(pred) {
  const out = []
  let d = 0
  let active = false
  for (const l of lines) {
    const opens = (l.match(/\{/g) || []).length
    const closes = (l.match(/\}/g) || []).length
    if (d === 0 && pred(l)) active = true
    if (active) out.push(l)
    d += opens - closes
    if (active && d === 0 && opens + closes > 0) active = false
  }
  return out
}

const kws = [
  'settings-drawer',
  'settings-body',
  'drawer-card',
  'drawer-block',
  'drawer-row',
  'drawer-seg',
  'drawer-divider',
  'drawer-block-title',
  'drawer-block-desc',
  'drawer-row-text',
  'theme-mode',
  'pref-chip',
  'pref-group',
  'pref-label',
  'pref-save',
  'notify-opt',
  'notify-row',
  'rocket-art',
  'appearance-grid',
  'briefing'
]

function matchKw(l) {
  const t = l.trim()
  if (!(t.startsWith('.') || t.startsWith('@'))) return false
  return kws.some((k) => t.includes(k))
}

const blocks = extract(matchKw)
const text = blocks.join('\n')
console.log('extracted lines', blocks.length, 'KB', (Buffer.byteLength(text) / 1024).toFixed(2))

// Find which important selectors missing
const selectors = []
for (const l of blocks) {
  const m = l.trim().match(/^([^{]+)\s*\{/)
  if (m) selectors.push(m[1].trim())
}
const missing = selectors.filter((s) => {
  // check if rule body roughly present - look for selector string
  return !cur.includes(s)
})
console.log('missing selectors', missing.length)
console.log(missing.slice(0, 80).join('\n'))

// Write full extracted drawer CSS to a patch file for merge
fs.writeFileSync('scripts/_tmp_drawer_css_from_head.txt', text)
console.log('wrote scripts/_tmp_drawer_css_from_head.txt')
