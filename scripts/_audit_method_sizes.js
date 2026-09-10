const fs = require('fs')
const s = fs.readFileSync('pages/index/index.js', 'utf8')

function bodySmart(name) {
  // Find `async? name(` then find matching ) for params (handle nested {}), then body {
  const re = new RegExp(`(?:^|\\n)(  (?:async\\s+)?${name}\\s*\\()` )
  const m = s.match(re)
  if (!m) return null
  const start = m.index + (m[0].startsWith('\n') ? 1 : 0)
  // walk from first ( after name
  let i = s.indexOf('(', start)
  let depth = 0
  for (; i < s.length; i++) {
    const c = s[i]
    if (c === '(') depth++
    else if (c === ')') {
      depth--
      if (depth === 0) { i++; break }
    } else if (c === '"' || c === "'" || c === '`') {
      const q = c; i++
      while (i < s.length) {
        if (s[i] === '\\') { i += 2; continue }
        if (s[i] === q) break
        i++
      }
    } else if (c === '{') {
      // skip object literal in default params
      let d = 1; i++
      while (i < s.length && d) {
        if (s[i] === '{') d++
        else if (s[i] === '}') d--
        else if (s[i] === '"' || s[i] === "'") {
          const q = s[i]; i++
          while (i < s.length && s[i] !== q) { if (s[i] === '\\') i++; i++ }
        }
        i++
      }
      i--
    }
  }
  // now i at after ), find {
  while (i < s.length && s[i] !== '{') i++
  const brace = i
  depth = 0
  for (; i < s.length; i++) {
    const c = s[i]
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return { start, len: i + 1 - start, head: s.slice(start, Math.min(start + 60, i)) }
    } else if (c === '"' || c === "'" || c === '`') {
      const q = c; i++
      while (i < s.length) {
        if (s[i] === '\\') { i += 2; continue }
        if (s[i] === q) break
        i++
      }
    }
  }
  return null
}

for (const n of ['loadInitialData', 'fetchMissionList', 'loadMoreMissions', 'onShareAppMessage', 'openAISearch']) {
  const r = bodySmart(n)
  console.log(n, r ? r.len + 'B' : 'MISSING', r ? r.head.replace(/\n/g, ' ') : '')
}

// reminder handler name
const rem = [...s.matchAll(/onCountdown\w+|ReminderTap|subscribeReminder/g)].map(m => m[0])
console.log('reminder-ish', [...new Set(rem)].slice(0, 20))

// ensure no duplicate Page method names
const names = []
const re = /\n  ((?:async\s+)?[a-zA-Z_][\w]*)\s*\(/g
const page = s.slice(s.indexOf('Page({'))
let m
while ((m = re.exec(page))) {
  const name = m[1].replace(/^async\s+/, '')
  // skip if it's inside a string - rough
  names.push(name)
}
const counts = {}
names.forEach(n => { counts[n] = (counts[n] || 0) + 1 })
const dups = Object.entries(counts).filter(([, c]) => c > 1)
console.log('duplicate method-like names', dups.filter(([n]) => !['if','for','while','switch','catch','function'].includes(n)).slice(0, 30))
