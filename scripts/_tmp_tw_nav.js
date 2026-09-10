const fs = require('fs')
const path = require('path')
const s = fs.readFileSync(path.join(process.env.TEMP, 'tw-index.js'), 'utf8')

const labels = [...s.matchAll(/["']([\u4e00-\u9fff]{2,20})["']/g)].map((m) => m[1])
console.log('CN labels:\n' + [...new Set(labels)].join('\n'))

const paths = [...s.matchAll(/["'](\/[a-zA-Z0-9_\-\/]+)["']/g)].map((m) => m[1])
console.log('\nPATHS:\n' + [...new Set(paths)].join('\n'))

const assets = [...s.matchAll(/assets\/([A-Za-z0-9_.-]+\.js)/g)].map((m) => m[1])
console.log('\nASSETS:\n' + [...new Set(assets)].join('\n'))
