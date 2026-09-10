/** Strip long JSDoc from a few main-package utils (keep short inline //). */
const fs = require('fs')
const files = [
  'utils/api-request.js',
  'utils/membership.js',
  'utils/api-app-services.js',
  'utils/api-monitor-data.js',
  'utils/landing-icons.js',
  'app.js',
  'pages/news/news.js',
  'pages/monitor/monitor.js',
  'pages/progress/progress.js',
  'pages/profile/profile.js',
  'pages/index/utils/index-settled-merge.js'
]
for (const p of files) {
  if (!fs.existsSync(p)) continue
  let s = fs.readFileSync(p, 'utf8')
  const before = Buffer.byteLength(s)
  s = s.replace(/\/\*\*[\s\S]*?\*\//g, (block) => {
    if (block.length < 60) return block
    if (/@license|copyright|不可|require\.async|禁止/i.test(block)) {
      // keep critical contract comments but trim if huge
      if (block.length > 400 && /不可|require\.async|禁止/.test(block)) {
        const first = block.split('\n').slice(0, 4).join('\n')
        return first + '\n */'
      }
      return block
    }
    return ''
  })
  s = s.replace(/\n{3,}/g, '\n\n')
  fs.writeFileSync(p, s)
  const after = Buffer.byteLength(s)
  if (after < before) {
    console.log((before / 1024).toFixed(1), '->', (after / 1024).toFixed(1), p)
  }
}
