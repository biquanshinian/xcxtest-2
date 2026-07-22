/**
 * 通用 WXSS 规则搬移：把页面 wxss 中选择器命中指定 class 前缀的规则移到分包组件 wxss。
 * 规则：
 * - 选择器含 .theme-light 的规则一律留在页面（经组件 apply-shared 作用进去）
 * - @keyframes：若其动画名只被「被搬走的规则」引用 → 随组件走；被双方引用 → 页面保留 + 组件复制
 * - @import 留在页面
 * 用法：node scripts/_split_wxss_by_prefix.js <page.wxss> <component.wxss> <prefix1,prefix2,...>
 * 输出：改写两个文件（组件 wxss 追加），并打印字节收益。dry-run 加第 4 参 --dry
 */
const fs = require('fs')

function parseRules(src) {
  // 顶层规则切分（支持 @keyframes 嵌套花括号）
  const rules = []
  let i = 0
  const n = src.length
  let buf = ''
  while (i < n) {
    const ch = src[i]
    buf += ch
    if (ch === '{') {
      let depth = 1
      i++
      while (i < n && depth > 0) {
        buf += src[i]
        if (src[i] === '{') depth++
        else if (src[i] === '}') depth--
        i++
      }
      rules.push(buf)
      buf = ''
      continue
    }
    if (ch === ';') { // @import ...;
      rules.push(buf)
      buf = ''
    }
    i++
  }
  if (buf.trim()) rules.push(buf)
  return rules
}

function selectorOf(rule) {
  // 去掉选择器前挂着的块注释，避免把「注释 + 规则」误判为纯注释
  return (rule.split('{')[0] || '').replace(/\/\*[\s\S]*?\*\//g, '').trim()
}

function main() {
  const [pageFile, compFile, prefixCsv, dryFlag] = process.argv.slice(2)
  const prefixes = prefixCsv.split(',').map((s) => s.trim()).filter(Boolean)
  const src = fs.readFileSync(pageFile, 'utf8')
  const rules = parseRules(src)

  const moved = []
  const kept = []
  const keyframes = [] // {name, rule}
  for (const r of rules) {
    const sel = selectorOf(r)
    if (sel.startsWith('@keyframes')) {
      keyframes.push({ name: sel.replace('@keyframes', '').trim(), rule: r })
      kept.push(r) // 先占位，最后再定去留
      continue
    }
    if (sel.startsWith('@import') || sel.startsWith('/*') && !sel.includes('{')) { kept.push(r); continue }
    const isThemeLight = sel.includes('.theme-light')
    const hit = prefixes.some((p) => sel.includes(p))
    if (hit && !isThemeLight) moved.push(r)
    else kept.push(r)
  }

  // keyframes 归属判定
  const movedText = moved.join('\n')
  const keptTextNoKf = kept.filter((r) => !selectorOf(r).startsWith('@keyframes')).join('\n')
  const kfMovedOnly = []
  for (const kf of keyframes) {
    const usedInMoved = new RegExp('animation[^;]*\\b' + kf.name + '\\b').test(movedText)
    const usedInKept = new RegExp('animation[^;]*\\b' + kf.name + '\\b').test(keptTextNoKf)
    if (usedInMoved && !usedInKept) {
      kfMovedOnly.push(kf)
    } else if (usedInMoved && usedInKept) {
      moved.push(kf.rule) // 复制到组件；页面保留
    }
  }
  const finalKept = kept.filter((r) => {
    const sel = selectorOf(r)
    if (!sel.startsWith('@keyframes')) return true
    const name = sel.replace('@keyframes', '').trim()
    return !kfMovedOnly.some((kf) => kf.name === name)
  })
  kfMovedOnly.forEach((kf) => moved.push(kf.rule))

  const movedOut = moved.map((r) => r.trim()).join('\n\n') + '\n'
  const keptOut = finalKept.map((r) => r.replace(/^\n+/, '')).join('\n').replace(/\n{3,}/g, '\n\n')

  console.log('page 原:', (src.length / 1024).toFixed(1) + 'KB',
    '→ 保留:', (keptOut.length / 1024).toFixed(1) + 'KB',
    '| 搬走:', (movedOut.length / 1024).toFixed(1) + 'KB',
    '| 规则数:', moved.length, '| keyframes 随迁:', kfMovedOnly.length)

  if (dryFlag === '--dry') {
    moved.slice(0, 200).forEach((r) => console.log('  MOVE', selectorOf(r).replace(/\s+/g, ' ').slice(0, 90)))
    return
  }
  const existing = fs.existsSync(compFile) ? fs.readFileSync(compFile, 'utf8') : ''
  fs.writeFileSync(compFile, existing + (existing && !existing.endsWith('\n') ? '\n' : '') + movedOut)
  fs.writeFileSync(pageFile, keptOut)
  console.log('已写入', compFile)
}

main()
