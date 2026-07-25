/**
 * 翻译链路总审计：客户端分支 + 云端混元主通道 + five_fixes 中的 translate 契约
 * 用法：node scripts/_audit_translate_all.js
 */
const { spawnSync } = require('child_process')
const path = require('path')

const scripts = [
  'scripts/_audit_cloud_translate_hunyuan.js',
  'scripts/_audit_translate_branches.js',
  'scripts/_audit_five_fixes_once.js'
]

let failed = 0
for (const rel of scripts) {
  console.log('\n######## RUN ' + rel + ' ########')
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', rel)], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
    stdio: 'inherit'
  })
  if (r.status !== 0) {
    failed++
    console.log('######## FAIL ' + rel + ' (exit ' + r.status + ') ########')
  } else {
    console.log('######## OK ' + rel + ' ########')
  }
}

console.log('\n======== TRANSLATE ALL: ' + (scripts.length - failed) + '/' + scripts.length + ' green ========')
process.exit(failed ? 1 : 0)
