/**
 * 星问富消息一键全量审计（单测 + 结构 + 可运行态）
 * node scripts/_audit_ai_chat_all.js
 */
const { spawnSync } = require('child_process')
const path = require('path')

const root = path.resolve(__dirname, '..')
const steps = [
  ['test/ai-chat-rich-core.test.js', 'unit'],
  ['scripts/_audit_ai_chat_mission_card.js', 'structural'],
  ['scripts/_audit_ai_chat_rich_runtime.js', 'runtime']
]

let failed = 0
steps.forEach(([rel, label]) => {
  console.log('\n======== ' + label + ' ========')
  const r = spawnSync(process.execPath, [path.join(root, rel)], {
    cwd: root,
    stdio: 'inherit',
    env: process.env
  })
  if (r.status !== 0) {
    failed += 1
    console.error('RED', label)
  } else {
    console.log('GREEN', label)
  }
})

console.log('\n======== summary ========')
if (failed) {
  console.error(failed + '/' + steps.length + ' suites RED')
  process.exit(1)
}
console.log(steps.length + '/' + steps.length + ' suites GREEN — all lights on')
