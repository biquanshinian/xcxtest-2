/**
 * Fix Page delegate shells: after attach, call mod.methods[name].apply(page)
 * instead of page[name](...args) which can recurse into the shell.
 */
const fs = require('fs')
const p = 'pages/index/index.js'
let s = fs.readFileSync(p, 'utf8')

const pairs = [
  ['__calendarAttached', '__calendarMethods', 'CALENDAR'],
  ['__saveImageAttached', '__saveImageMethods', 'SAVE'],
  ['__voteAttached', '__voteMethods', 'VOTE'],
  ['__carouselAttached', '__carouselMethods', 'CAROUSEL'],
  ['__splashAttached', '__splashMethods', 'SPLASH'],
  ['__liveSettleAttached', '__liveSettleMethods', 'LIVE'],
  ['__uxAttached', '__uxMethods', 'UX'],
  ['__agencySubAttached', '__agencySubMethods', 'AGENCY'],
  ['__interactionAttached', '__interactionMethods', 'INTERACTION']
]

// Generic rewrite of each delegate function body pattern
s = s.replace(
  /function delegate(\w+)\(name\) \{\n  return function \(\.\.\.args\) \{\n    const page = this\n    if \(page\.(__\w+Attached)\) return page\[name\]\(\.\.\.args\)\n    if \(!page\.(__\w+LoadPromise)\) \{\n      page\.\3 = require\.async\(([^)]+)\)\.then\(\(mod\) => \{\n        mod\.attachTo\(page\)\n        return mod\n      \}\)(?:\.catch\(\(err\) => \{\n        page\.\3 = null\n        throw err\n      \}\))?\n    \}\n    return page\.\3\.then\(\(\) => page\[name\]\(\.\.\.args\)\)\n  \}\n\}/g,
  (full, kind, attached, loadPromise, pkg) => {
    const methodsKey = attached.replace('Attached', 'Methods')
    return `function delegate${kind}(name) {
  return function (...args) {
    const page = this
    const run = () => {
      const fn = page.${methodsKey} && page.${methodsKey}[name]
      if (typeof fn === 'function') return fn.apply(page, args)
      return page[name](...args)
    }
    if (page.${attached} && page.${methodsKey}) return run()
    if (!page.${loadPromise}) {
      page.${loadPromise} = require.async(${pkg}).then((mod) => {
        mod.attachTo(page)
        page.${methodsKey} = (mod && mod.methods) || page.${methodsKey}
        return mod
      }).catch((err) => {
        page.${loadPromise} = null
        throw err
      })
    }
    return page.${loadPromise}.then(() => run())
  }
}`
  }
)

fs.writeFileSync(p, s)

// Patch attachTo in index-extra utils to stash methods on page
const attachFiles = [
  'subpackages/index-extra/utils/index-interaction.js',
  'subpackages/index-extra/utils/index-agency-sub.js',
  'subpackages/index-extra/utils/index-calendar-page.js',
  'subpackages/index-extra/utils/index-vote.js',
  'subpackages/index-extra/utils/index-carousel.js',
  'subpackages/index-extra/utils/index-splash.js',
  'subpackages/index-extra/utils/index-live-settle.js',
  'subpackages/index-extra/utils/index-ux.js',
  'subpackages/index-extra/utils/index-save-image.js'
]

for (const f of attachFiles) {
  if (!fs.existsSync(f)) continue
  let t = fs.readFileSync(f, 'utf8')
  const before = t
  // interaction
  t = t.replace(
    /function attachTo\(page\) \{\n  if \(page\.__interactionAttached\) return interactionMethods\n  Object\.keys\(interactionMethods\)\.forEach\(\(key\) => \{\n    page\[key\] = interactionMethods\[key\]\n  \}\)\n  page\.__interactionAttached = true\n  return interactionMethods\n\}/,
    `function attachTo(page) {
  if (page.__interactionAttached) return interactionMethods
  page.__interactionMethods = interactionMethods
  Object.keys(interactionMethods).forEach((key) => {
    page[key] = interactionMethods[key]
  })
  page.__interactionAttached = true
  return interactionMethods
}`
  )
  // agency-sub uses `methods`
  t = t.replace(
    /function attachTo\(page\) \{\n  if \(page\.__agencySubAttached\) return methods\n  Object\.keys\(methods\)\.forEach\(\(key\) => \{\n    page\[key\] = methods\[key\]\n  \}\)\n  page\.__agencySubAttached = true\n  return methods\n\}/,
    `function attachTo(page) {
  if (page.__agencySubAttached) return methods
  page.__agencySubMethods = methods
  Object.keys(methods).forEach((key) => {
    page[key] = methods[key]
  })
  page.__agencySubAttached = true
  return methods
}`
  )
  // calendar
  t = t.replace(
    /function attachTo\(page\) \{\n  if \(page\.__calendarAttached\) return[^\n]+\n  Object\.keys\((\w+)\)\.forEach\(\(key\) => \{\n    page\[key\] = \1\[key\]\n  \}\)\n  page\.__calendarAttached = true\n  return \1\n\}/,
    (m, obj) => `function attachTo(page) {
  if (page.__calendarAttached) return ${obj}
  page.__calendarMethods = ${obj}
  Object.keys(${obj}).forEach((key) => {
    page[key] = ${obj}[key]
  })
  page.__calendarAttached = true
  return ${obj}
}`
  )
  // generic for other packages: __xxxAttached
  t = t.replace(
    /function attachTo\(page\) \{\n  if \(page\.(__(\w+)Attached)\) return (\w+)\n  Object\.keys\(\3\)\.forEach\(\(key\) => \{\n    page\[key\] = \3\[key\]\n  \}\)\n  page\.\1 = true\n  return \3\n\}/g,
    (m, attached, stem, obj) => {
      if (attached.includes('interaction') || attached.includes('agencySub') || attached.includes('calendar')) {
        return m // already handled or skip if unmatched
      }
      const methodsKey = `__${stem}Methods`
      // stem might be vote, carousel, etc. - capitalize carefully
      // __voteAttached -> stem = vote from regex (__(\w+)Attached) 
      return `function attachTo(page) {
  if (page.${attached}) return ${obj}
  page.${methodsKey} = ${obj}
  Object.keys(${obj}).forEach((key) => {
    page[key] = ${obj}[key]
  })
  page.${attached} = true
  return ${obj}
}`
    }
  )
  if (t !== before) {
    fs.writeFileSync(f, t)
    console.log('patched attach', f)
  } else {
    console.log('no attach change', f)
  }
}

console.log('delegates rewritten?', s.includes('__interactionMethods'))
console.log('sample', (s.match(/function delegateInteraction[\s\S]{0,400}/) || [''])[0].slice(0, 400))
