const fs = require('fs')
const s = fs.readFileSync('pages/index/index.js', 'utf8')
const i = s.indexOf('noop()')
console.log('--- snippet ---')
console.log(JSON.stringify(s.slice(i, i + 500)))
console.log('---')
try {
  new Function(s)
  console.log('Function parse OK')
} catch (e) {
  console.log('parse fail', e.message)
}
console.log('onShareAppMessage def', /onShareAppMessage\s*\(/.test(s))
console.log('onShareTimeline def', /onShareTimeline\s*\(/.test(s))
console.log('onAddToFavorites def', /onAddToFavorites\s*\(/.test(s))

// Extract from git
const { execSync } = require('child_process')
const head = execSync('git show HEAD:pages/index/index.js', {
  encoding: 'utf8',
  maxBuffer: 30 * 1024 * 1024
})
const m = head.match(/\n  noop\(\) \{\},[\s\S]*?\n  onAddToFavorites\(\) \{[\s\S]*?\n  \},?\n\n\}\)/)
if (!m) {
  // try another pattern
  const a = head.indexOf('\n  noop() {},')
  const b = head.indexOf('\n  onShareAppMessage(')
  const c = head.lastIndexOf('\n  onAddToFavorites(')
  console.log('git indexes', a, b, c)
  const end = head.indexOf('\n})', c)
  const chunk = head.slice(a + 1, end)
  fs.writeFileSync('scripts/_restored_share_tail.js', chunk)
  console.log('wrote restored tail', chunk.length, 'first line:', chunk.split('\n')[0])
} else {
  fs.writeFileSync('scripts/_restored_share_tail.js', m[0].slice(1))
  console.log('wrote via regex', m[0].length)
}
