/**
 * Strip bulky JSDoc / stub comment blocks from pages/index/index.js (logic untouched).
 */
const fs = require('fs')
const p = 'pages/index/index.js'
let s = fs.readFileSync(p, 'utf8')
const before = Buffer.byteLength(s)

// Remove block comments that are purely documentation (keep /*! and eslint)
s = s.replace(/\/\*\*[\s\S]*?\*\//g, (block) => {
  if (block.length < 40) return block
  // keep if looks like license
  if (/@license|copyright/i.test(block)) return block
  return ''
})

// Collapse consecutive blank lines
s = s.replace(/\n{3,}/g, '\n\n')

// Shorten attachTo stub comments
s = s.replace(/^[ \t]*\/\/[ \t]*[a-zA-Z_][\w]*[ \t]*→[ \t]*index-[^\n]+\n/gm, '')

fs.writeFileSync(p, s)
console.log('index.js', (before / 1024).toFixed(1), '->', (Buffer.byteLength(s) / 1024).toFixed(1))
