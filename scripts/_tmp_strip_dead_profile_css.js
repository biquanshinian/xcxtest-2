/**
 * Remove CSS from profile.wxss whose selectors are unused in profile.wxml
 * (already moved into profile-sections / badge-modal, or truly dead).
 */
const fs = require('fs')

const wxml = fs.readFileSync('pages/profile/profile.wxml', 'utf8')
const wxssPath = 'pages/profile/profile.wxss'
const lines = fs.readFileSync(wxssPath, 'utf8').split(/\n/)

// Class tokens used in profile page wxml (rough)
const used = new Set()
const classRe = /class="([^"]+)"/g
let m
while ((m = classRe.exec(wxml))) {
  m[1].split(/\s+/).forEach((c) => {
    c = c.replace(/\{\{[^}]*\}\}/g, '').trim()
    if (c && !c.includes('{')) used.add(c.split('--')[0]) // base
    if (c) used.add(c)
  })
}

function selectorUsed(sel) {
  // extract class names from selector
  const classes = sel.match(/\.([a-zA-Z_][\w-]*)/g) || []
  if (!classes.length) return true // keep keyframes/@media etc. handled elsewhere
  // if ANY class in selector appears in wxml, keep
  return classes.some((c) => {
    const name = c.slice(1)
    if (used.has(name)) return true
    // prefix match for BEM
    for (const u of used) {
      if (u === name || name.startsWith(u + '-') || name.startsWith(u + '_')) return true
    }
    return false
  })
}

const DEAD_PREFIXES = [
  'growth-',
  'membership-entry',
  'vote-history',
  'quiz-',
  'oa-alert',
  'theme-mode',
  'about-',
  'settings-panel', // if in profile-sections
  'reminder-',
  'pref-'
]

function isDeadRule(headerLine) {
  const t = headerLine.trim()
  if (t.startsWith('@keyframes')) {
    return DEAD_PREFIXES.some((p) => t.includes(p.replace(/-$/, '')))
  }
  return DEAD_PREFIXES.some((p) => t.includes('.' + p) || t.includes(' .' + p))
}

const kept = []
let depth = 0
let activeDead = false
let removed = 0
for (let i = 0; i < lines.length; i++) {
  const l = lines[i]
  const opens = (l.match(/\{/g) || []).length
  const closes = (l.match(/\}/g) || []).length
  if (depth === 0 && isDeadRule(l)) {
    activeDead = true
  }
  if (!activeDead) kept.push(l)
  else removed += l.length + 1
  depth += opens - closes
  if (activeDead && depth === 0 && opens + closes > 0) activeDead = false
}

let out = kept.join('\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\n{3,}/g, '\n\n')
fs.writeFileSync(wxssPath, out)
console.log('removed ~KB', (removed / 1024).toFixed(1), 'now', (out.length / 1024).toFixed(1))
