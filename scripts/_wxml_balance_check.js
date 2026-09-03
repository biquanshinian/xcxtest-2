// 一次性脚本：WXML 标签配平检查
const fs = require('fs')
const files = process.argv.slice(2)
const VOID = new Set(['input', 'import', 'include', 'wxs'])
let bad = 0
for (const f of files) {
  const s = fs.readFileSync(f, 'utf8').replace(/<!--[\s\S]*?-->/g, '')
  const stack = []
  const re = /<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g
  let m, ok = true
  while ((m = re.exec(s))) {
    const [, close, tag, , self] = m
    if (self || VOID.has(tag)) continue
    if (close) {
      const top = stack.pop()
      if (top !== tag) {
        console.log(`${f}: mismatch </${tag}> vs <${top}> at offset ${m.index}`)
        ok = false
        break
      }
    } else {
      stack.push(tag)
    }
  }
  if (ok && stack.length) {
    console.log(`${f}: unclosed tags: ${stack.join(', ')}`)
    ok = false
  }
  if (ok) console.log(f, 'OK')
  else bad++
}
process.exit(bad ? 1 : 0)
