/* eslint-disable no-console */
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const norm = (p) => p.replace(/\\/g, '/')

const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'))
const registered = new Set()
app.pages.forEach((p) => registered.add(norm(p)))
app.subPackages.forEach((sp) =>
  sp.pages.forEach((p) => registered.add(norm(`${sp.root}/${p}`)))
)

const skipParts = new Set([
  'node_modules',
  'admin-web',
  'cloudfunctions',
  'scripts',
  'docs',
  '.cursor',
  '.git',
  'miniprogram_npm',
  'agent-config'
])

const diskPages = []
function walk(dir) {
  let ents
  try {
    ents = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const ent of ents) {
    const full = path.join(dir, ent.name)
    const rel = norm(path.relative(root, full))
    if (ent.isDirectory()) {
      if (skipParts.has(ent.name)) continue
      if (rel.split('/').some((p) => skipParts.has(p))) continue
      walk(full)
    } else if (ent.name.endsWith('.json')) {
      if (rel.includes('/components/')) continue
      if (rel.includes('/agent-skills/')) continue
      const bn = ent.name
      if (
        [
          'app.json',
          'project.config.json',
          'project.private.config.json',
          'sitemap.json',
          'package.json',
          'mcp.json'
        ].includes(bn)
      )
        continue
      const base = rel.replace(/\.json$/, '')
      if (
        fs.existsSync(path.join(root, base + '.js')) &&
        fs.existsSync(path.join(root, base + '.wxml'))
      ) {
        diskPages.push(base)
      }
    }
  }
}
walk(root)
const diskSet = new Set(diskPages)

const srcFiles = []
function walkSrc(dir) {
  let ents
  try {
    ents = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const ent of ents) {
    const full = path.join(dir, ent.name)
    const rel = norm(path.relative(root, full))
    if (ent.isDirectory()) {
      if (skipParts.has(ent.name)) continue
      if (rel.split('/').some((p) => skipParts.has(p))) continue
      walkSrc(full)
    } else if (/\.(js|wxml|json|wxss|wxs)$/.test(ent.name)) {
      srcFiles.push(full)
    }
  }
}
walkSrc(root)

const fileContents = new Map()
for (const f of srcFiles) {
  try {
    fileContents.set(f, fs.readFileSync(f, 'utf8'))
  } catch {
    fileContents.set(f, '')
  }
}
const allSrc = [...fileContents.values()].join('\n')

function countRefs(pagePath) {
  const variants = [
    pagePath,
    '/' + pagePath,
    pagePath.replace(/^pages\//, ''),
    pagePath.replace(/^subpackages\/[^/]+\//, '')
  ]
  let total = 0
  for (const v of [...new Set(variants)]) {
    if (!v || v.length < 4) continue
    const re = new RegExp(v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')
    const m = allSrc.match(re)
    if (m) total += m.length
  }
  return total
}

function refsOutsideSelf(pagePath) {
  let total = 0
  const selfPrefix = path.join(root, pagePath.replace(/\//g, path.sep))
  const variants = [pagePath, '/' + pagePath]
  for (const [file, content] of fileContents) {
    const isSelf = file.startsWith(selfPrefix)
    for (const v of variants) {
      const re = new RegExp(v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')
      const m = content.match(re)
      if (m) {
        if (!isSelf) total += m.length
      }
    }
  }
  return total
}

const unregistered = [...diskSet].filter((p) => !registered.has(p)).sort()
const missing = [...registered].filter((p) => !diskSet.has(p)).sort()

console.log('=== SUMMARY ===')
console.log('Registered:', registered.size)
console.log('Disk pages:', diskSet.size)
console.log('Unregistered on disk:', unregistered.length)
console.log('Registered but missing:', missing.length)

console.log('\n=== UNREGISTERED ON DISK ===')
for (const p of unregistered) {
  console.log(`${p}\textRefs=${refsOutsideSelf(p)} totalRefs=${countRefs(p)}`)
}

console.log('\n=== REGISTERED LOW EXTERNAL REFS (<=2) ===')
const low = []
for (const p of [...registered].sort()) {
  const ext = refsOutsideSelf(p)
  if (ext <= 2) low.push({ p, ext, total: countRefs(p) })
}
for (const { p, ext, total } of low) {
  console.log(`${p}\textRefs=${ext} totalRefs=${total}`)
}

// Main package utils
const utilsDir = path.join(root, 'utils')
const utilsFiles = fs.readdirSync(utilsDir).filter((f) => f.endsWith('.js'))
console.log('\n=== ROOT UTILS LOW REF (<=1 ext ref, exclude self) ===')
for (const f of utilsFiles.sort()) {
  const name = f.replace(/\.js$/, '')
  const full = norm(path.relative(root, path.join(utilsDir, f)))
  let ext = 0
  for (const [file, content] of fileContents) {
    if (file.endsWith(f) && norm(file).endsWith(full)) continue
    if (content.includes(`utils/${name}`) || content.includes(`utils/${name}.js`)) {
      ext += (content.match(new RegExp(`utils/${name}(?:\\.js)?`, 'g')) || []).length
    }
  }
  if (ext <= 1) console.log(`${full}\textRefs~=${ext}`)
}

// Root components
const compDir = path.join(root, 'components')
console.log('\n=== ROOT COMPONENTS ===')
for (const ent of fs.readdirSync(compDir, { withFileTypes: true })) {
  if (!ent.isDirectory()) continue
  const tag = ent.name
  let ext = 0
  for (const [file, content] of fileContents) {
    if (file.includes(`components/${tag}/`)) continue
    if (
      content.includes(`components/${tag}/`) ||
      content.includes(`"${tag}"`) ||
      content.includes(`'${tag}'`) ||
      content.includes(`<${tag}`)
    ) {
      ext++
    }
  }
  console.log(`${tag}\tusedInFiles~=${ext}`)
}
