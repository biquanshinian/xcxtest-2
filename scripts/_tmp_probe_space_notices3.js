const fs = require('fs')
const path = require('path')
const body = fs.readFileSync(path.join(__dirname, '_tmp_sn_notice.html'), 'utf8')

// Find a JSON-ish object containing rawText
const idx = body.indexOf('"rawText"')
console.log('idx', idx)
const start = body.lastIndexOf('{', idx)
// expand window
const chunk = body.slice(Math.max(0, idx - 2000), idx + 4000)
fs.writeFileSync(path.join(__dirname, '_tmp_sn_chunk.txt'), chunk)
console.log('chunk written')

// Try to unescape RSC string payloads that look like JSON objects
const re = /\{[^{}]*"rawText"\s*:\s*"(?:\\.|[^"\\])*"[^{}]*\}/g
const hits = chunk.match(re)
console.log('hits', hits && hits.length)
if (hits) {
  try {
    const obj = JSON.parse(hits[0].replace(/\\r\\n/g, '\\n'))
    console.log(Object.keys(obj))
    console.log(JSON.stringify(obj, null, 2).slice(0, 1500))
  } catch (e) {
    console.log('parse fail', e.message)
    console.log(hits[0].slice(0, 500))
  }
}

// Broader: find key fields nearby
for (const k of ['"name"', '"type"', '"reason"', '"areas"', '"dates"', '"sourceName"', '"noticeKey"', '"id"']) {
  console.log(k, chunk.indexOf(k))
}
