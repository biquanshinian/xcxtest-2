const fs = require('fs')
const p = 'pages/index/index.js'
let s = fs.readFileSync(p, 'utf8')

const specs = [
  ['delegateCalendar', '__calendarAttached', '__calendarLoadPromise', '__calendarMethods', 'CALENDAR_PKG', false],
  ['delegateSaveImage', '__saveImageAttached', '__saveImageLoadPromise', '__saveImageMethods', 'SAVE_IMAGE_PKG', false],
  ['delegateVote', '__voteAttached', '__voteLoadPromise', '__voteMethods', 'VOTE_PKG', false],
  ['delegateCarousel', '__carouselAttached', '__carouselLoadPromise', '__carouselMethods', 'CAROUSEL_PKG', true],
  ['delegateSplash', '__splashAttached', '__splashLoadPromise', '__splashMethods', 'SPLASH_PKG', true],
  ['delegateLiveSettle', '__liveSettleAttached', '__liveSettleLoadPromise', '__liveSettleMethods', 'LIVE_SETTLE_PKG', true],
  ['delegateUx', '__uxAttached', '__uxLoadPromise', '__uxMethods', 'UX_PKG', true]
]

function makeBody(fn, attached, loadPromise, methodsKey, pkg, withCatch) {
  const catchBlock = withCatch
    ? `.catch((err) => {
        page.${loadPromise} = null
        throw err
      })`
    : ''
  return `function ${fn}(name) {
  return function (...args) {
    const page = this
    const run = () => {
      const fnImpl = page.${methodsKey} && page.${methodsKey}[name]
      if (typeof fnImpl === 'function') return fnImpl.apply(page, args)
      return page[name](...args)
    }
    if (page.${attached} && page.${methodsKey}) return run()
    if (!page.${loadPromise}) {
      page.${loadPromise} = require.async(${pkg}).then((mod) => {
        mod.attachTo(page)
        page.${methodsKey} = (mod && mod.methods) || page.${methodsKey}
        return mod
      })${catchBlock}
    }
    return page.${loadPromise}.then(() => run())
  }
}`
}

for (const [fn, attached, loadPromise, methodsKey, pkg, withCatch] of specs) {
  const re = new RegExp(`function ${fn}\\(name\\) \\{[\\s\\S]*?\\n\\}`)
  if (!re.test(s)) {
    console.warn('miss', fn)
    continue
  }
  s = s.replace(re, makeBody(fn, attached, loadPromise, methodsKey, pkg, withCatch))
  console.log('ok', fn)
}

fs.writeFileSync(p, s)

// Ensure attachTo stashes methods for carousel/splash/live-settle
const more = [
  ['subpackages/index-extra/utils/index-carousel.js', '__carouselAttached', '__carouselMethods'],
  ['subpackages/index-extra/utils/index-splash.js', '__splashAttached', '__splashMethods'],
  ['subpackages/index-extra/utils/index-live-settle.js', '__liveSettleAttached', '__liveSettleMethods']
]
for (const [file, attached, methodsKey] of more) {
  if (!fs.existsSync(file)) {
    console.warn('missing file', file)
    continue
  }
  let t = fs.readFileSync(file, 'utf8')
  if (t.includes(methodsKey + ' =')) {
    console.log('already', file)
    continue
  }
  // find attachTo and inject
  const m = t.match(/function attachTo\(page\) \{\n  if \(page\.(__\w+Attached)\) return (\w+)\n  Object\.keys\(\2\)\.forEach/)
  if (m) {
    t = t.replace(
      `function attachTo(page) {\n  if (page.${m[1]}) return ${m[2]}\n  Object.keys(${m[2]}).forEach`,
      `function attachTo(page) {\n  if (page.${m[1]}) return ${m[2]}\n  page.${methodsKey} = ${m[2]}\n  Object.keys(${m[2]}).forEach`
    )
    // also ensure module.exports has methods
    if (!/module\.exports\s*=\s*\{[^}]*methods/.test(t)) {
      t = t.replace(/module\.exports\s*=\s*\{\s*attachTo\s*\}/, `module.exports = { attachTo, methods: ${m[2]} }`)
      t = t.replace(/module\.exports\s*=\s*\{\s*attachTo\s*,/, `module.exports = { attachTo, methods: ${m[2]},`)
    }
    fs.writeFileSync(file, t)
    console.log('attach patched', file)
  } else {
    console.warn('attach pattern miss', file)
    // show attach snippet
    const i = t.indexOf('function attachTo')
    console.log(t.slice(i, i + 200))
  }
}
