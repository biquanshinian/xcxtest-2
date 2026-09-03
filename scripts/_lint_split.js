// 一次性：拆分后 no-undef / no-unused-vars / no-dupe-keys 检查
const { Linter } = require('eslint')
const fs = require('fs')
const linter = new Linter({ configType: 'eslintrc' })
const globals = {}
;['wx', 'getApp', 'getCurrentPages', 'App', 'Page', 'Component', 'Behavior', 'requirePlugin',
  'console', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Promise'].forEach((g) => { globals[g] = 'readonly' })
for (const f of process.argv.slice(2)) {
  const msgs = linter.verify(fs.readFileSync(f, 'utf8'), {
    parserOptions: { ecmaVersion: 2022, sourceType: 'script' },
    env: { es2021: true, commonjs: true },
    globals,
    rules: { 'no-undef': 'error', 'no-unused-vars': ['warn', { args: 'none' }], 'no-dupe-keys': 'error' }
  })
  const bad = msgs.filter((m) => ['no-undef', 'no-unused-vars', 'no-dupe-keys'].includes(m.ruleId) && !/'e\d?'|'err'|'_'/.test(m.message))
  console.log('====', f, bad.length ? '' : 'OK')
  bad.forEach((m) => console.log('  L' + m.line, m.ruleId, m.message))
}
