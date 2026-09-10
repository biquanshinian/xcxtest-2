/**
 * 观礼分包主题反色审计：
 * 找出依赖深色底的硬编码样式（浅色文字 / 白玻璃背景 / 浅色边框），
 * 且文件内没有 .theme-light 覆盖同类名的规则。
 * 运行：node scripts/_tmp_audit_wp_theme.js
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..', 'subpackages', 'watch-party')
const FILES = fs.readdirSync(ROOT).filter((f) => f.endsWith('.wxss'))

// 恒深色页面：跳过（大屏投屏场景）
const SKIP = new Set(['screen.wxss'])

function parseRules(src) {
  // 去注释
  const css = src.replace(/\/\*[\s\S]*?\*\//g, '')
  const rules = []
  const re = /([^{}]+)\{([^{}]*)\}/g
  let m
  while ((m = re.exec(css))) {
    rules.push({ sel: m[1].trim(), body: m[2].trim() })
  }
  return rules
}

// 浅色文字：#fff/#eee/#ddd/#ccc 或 rgba(255,255,255,>=0.4)
function lightTextIn(body) {
  const decls = body.split(';').map((s) => s.trim()).filter(Boolean)
  return decls.filter((d) => {
    if (!/^color\s*:/i.test(d)) return false
    if (/#f{3,6}\b/i.test(d) || /#e[0-9a-f]{2}\b/i.test(d) || /#d[0-9a-f]{2}\b/i.test(d) || /#c[0-9a-f]{2}\b/i.test(d)) return true
    const m = d.match(/rgba\(\s*255\s*,\s*255\s*,\s*255\s*,\s*([\d.]+)/i)
    return m && parseFloat(m[1]) >= 0.4
  })
}

// 白玻璃背景：rgba(255,255,255, <=0.25)（深色底上的浮层，浅色底上几乎不可见）
function glassBgIn(body) {
  const decls = body.split(';').map((s) => s.trim()).filter(Boolean)
  return decls.filter((d) => {
    if (!/^background(-color)?\s*:/i.test(d)) return false
    const m = d.match(/rgba\(\s*255\s*,\s*255\s*,\s*255\s*,\s*([\d.]+)/i)
    return m && parseFloat(m[1]) <= 0.25
  })
}

// 同规则里是否有自带的深色/彩色底（白字放彩底上两种主题都成立）
function hasOwnDarkBg(body) {
  return /background[^;]*(#0|#1|#2|#3|rgba\(\s*0|rgba\(\s*1[0-9]?\s*,|linear-gradient|var\(--color-brand|#3b82f6|#2563eb|#059669|#dc2626|#d946ef|#7c3aed|#ef4444|#f59e0b|#10b981)/i.test(body)
}

let flagged = 0
for (const file of FILES) {
  if (SKIP.has(file)) continue
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8')
  const rules = parseRules(src)
  const lightOverridden = new Set()
  rules.forEach((r) => {
    if (r.sel.indexOf('.theme-light') !== -1) {
      const names = r.sel.match(/\.[a-zA-Z][\w-]*/g) || []
      names.forEach((n) => lightOverridden.add(n))
    }
  })

  const problems = []
  rules.forEach((r) => {
    if (r.sel.indexOf('.theme-light') !== -1) return
    const names = (r.sel.match(/\.[a-zA-Z][\w-]*/g) || [])
    const covered = names.some((n) => lightOverridden.has(n))
    if (covered) return

    const lt = lightTextIn(r.body)
    const gb = glassBgIn(r.body)
    if (lt.length && !hasOwnDarkBg(r.body)) {
      problems.push({ sel: r.sel, decls: lt, kind: '浅色文字（浅色主题下不可读）' })
    }
    if (gb.length) {
      problems.push({ sel: r.sel, decls: gb, kind: '白玻璃背景（浅色主题下不可见）' })
    }
  })

  if (problems.length) {
    console.log(`\n■ ${file}`)
    problems.forEach((p) => {
      flagged++
      console.log(`  [${p.kind}] ${p.sel}`)
      p.decls.forEach((d) => console.log(`      ${d}`))
    })
  } else {
    console.log(`✓ ${file} 无未覆盖的深色依赖样式`)
  }
}

console.log(flagged ? `\n共 ${flagged} 处待人工确认` : '\n主题审计通过')
