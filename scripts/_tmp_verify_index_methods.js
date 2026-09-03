const fs = require('fs')
const path = require('path')

function methodLiveStatus(file, methods) {
  const lines = fs.readFileSync(file, 'utf8').split(/\n/)
  let inBlock = false
  const status = {}
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    let j = 0
    while (j < line.length) {
      if (!inBlock && line[j] === '/' && line[j + 1] === '/') break
      if (!inBlock && line[j] === '/' && line[j + 1] === '*') {
        inBlock = true
        j += 2
        continue
      }
      if (inBlock && line[j] === '*' && line[j + 1] === '/') {
        inBlock = false
        j += 2
        continue
      }
      j++
    }
    for (const m of methods) {
      const re = new RegExp('^\\s*' + m + '\\s*\\(')
      if (re.test(line)) {
        status[m] = { state: inBlock ? 'COMMENT' : 'LIVE', line: i + 1 }
      }
    }
  }
  return status
}

const indexStatus = methodLiveStatus('pages/index/index.js', [
  '_attachSwipeRowFlagsToDisplayedPatch',
  '_getMissionCardCountdownDeps',
  '_attachCardCountdownToDisplayedPatch',
  '_buildMissionCardCountdownTickPatch',
  'applyUpcomingAgencyFilterToPatch',
  'applyInitialUpcomingLaunchState'
])
console.log('index methods', JSON.stringify(indexStatus, null, 2))

// app.json page existence
const app = JSON.parse(fs.readFileSync('app.json', 'utf8'))
const missing = []
for (const p of app.pages || []) {
  for (const ext of ['.js', '.wxml', '.json']) {
    if (!fs.existsSync(p + ext)) missing.push(p + ext)
  }
}
let subMissing = []
for (const sp of app.subPackages || []) {
  for (const p of sp.pages || []) {
    const base = (sp.root.replace(/\/$/, '') + '/' + p).replace(/\\/g, '/')
    if (!fs.existsSync(base + '.js')) subMissing.push(base + '.js')
  }
}
console.log(
  JSON.stringify(
    {
      mainPages: (app.pages || []).length,
      mainMissing: missing,
      subPackageJsMissing: subMissing.length,
      subMissingSample: subMissing.slice(0, 10)
    },
    null,
    2
  )
)
