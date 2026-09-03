// 全项目 require 解析检查：每个相对 require 必须指向存在的文件；
// 并输出「主包 utils 中仅被分包引用」的文件清单（下一轮质量扫描的预判）
const fs = require('fs')
const path = require('path')

function walk(dir, list = []) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f)
    const st = fs.statSync(p)
    if (st.isDirectory()) {
      if (/node_modules|\.git|miniprogram_npm|admin-web|cloudfunctions|scripts|workers|test|docs|terminals|\.cursor/.test(f)) continue
      walk(p, list)
    } else if (/\.js$/.test(f)) list.push(p)
  }
  return list
}
const files = walk('.')
let fail = 0
const mainRoots = ['pages/index/', 'pages/monitor/', 'pages/progress/', 'pages/news/', 'pages/profile/', 'utils/', 'components/', 'custom-tab-bar/', 'styles/']
const isMain = (f) => {
  const rel = path.relative('.', f).replace(/\\/g, '/')
  if (rel === 'app.js') return true
  return mainRoots.some((r) => rel.startsWith(r))
}

const utilImporters = {} // utils/xxx.js -> {main: n, sub: n}
for (const f of files) {
  // 剥掉注释，避免文档示例里的 require 造成误报
  const s = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  for (const m of s.matchAll(/require(?:\.async)?\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    const spec = m[1]
    if (!spec.startsWith('.')) continue
    let r = path.resolve(path.dirname(f), spec)
    if (!/\.(js|json)$/.test(r)) r += '.js'
    if (!fs.existsSync(r)) {
      fail++
      console.log('[断链] ' + path.relative('.', f) + ' → ' + spec)
      continue
    }
    const rel = path.relative('.', r).replace(/\\/g, '/')
    if (rel.startsWith('utils/')) {
      if (!utilImporters[rel]) utilImporters[rel] = { main: 0, sub: 0 }
      utilImporters[rel][isMain(f) ? 'main' : 'sub']++
    }
  }
}
console.log(fail ? ('断链 ' + fail + ' 处') : '全部 require 可解析')

const subOnly = Object.entries(utilImporters).filter(([, v]) => v.main === 0 && v.sub > 0)
console.log('\n主包 utils 仅被分包引用（下轮质量扫描将标黄）:')
subOnly.length ? subOnly.forEach(([k, v]) => console.log('  ' + k + ' (分包引用 ' + v.sub + ' 处, ' + (fs.statSync(k).size / 1024).toFixed(1) + 'KB)')) : console.log('  (无)')
process.exit(fail ? 1 : 0)
