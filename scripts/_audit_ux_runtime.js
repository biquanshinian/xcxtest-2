const path = require('path')
const fs = require('fs')

function deepStub() {
  const f = function () { return deepStub() }
  return new Proxy(f, {
    get(t, k) {
      if (k === 'USER_DATA_PATH') return '/tmp/stub'
      if (k === Symbol.toPrimitive || k === 'toString') return () => 'stub'
      if (k === 'then') return undefined
      return deepStub()
    },
    apply() { return deepStub() }
  })
}
globalThis.wx = deepStub()
globalThis.getApp = () => deepStub()
globalThis.getCurrentPages = () => []

const uxDir = 'subpackages/index-extra/utils'
const src = fs.readFileSync(path.join(uxDir, 'index-ux.js'), 'utf8')
const reqs = [...src.matchAll(/require\(['"]([^'"]+)['"]\)/g)].map((m) => m[1])
let bad = 0
for (const r of reqs) {
  if (!r.startsWith('.')) continue
  let p = path.normalize(path.join(uxDir, r)).replace(/\\/g, '/')
  if (!p.endsWith('.js')) p += '.js'
  const ok = fs.existsSync(p)
  console.log(ok ? 'OK' : 'MISS', r, '->', p)
  if (!ok) bad++
}
const routes = require('../utils/routes.js')
const nav = require('../utils/index-mission-nav.js')
const demo = require('../utils/demo-engine.js')
console.log('ROUTES.SEARCH', routes.SEARCH)
console.log('resolveMissionSharePayload', typeof nav.resolveMissionSharePayload)
console.log('startDemo', typeof demo.startDemo)
console.log('isInitDone', typeof demo.isInitDone)

// simulate attachTo
const page = {
  data: { missionSwipeOpenWxkey: '', shareSheetVisible: false, shareImage: '' },
  setData(d) { Object.assign(this.data, d) },
  closeMissionSwipeCells() { this._closed = true }
}
const ux = require('../subpackages/index-extra/utils/index-ux.js')
ux.attachTo(page)
page.closeAnnouncementBanner()
console.log('closeAnnouncementBanner ok', page.data.announcementBanner === null, page._closed === true)
page.openShop()
page.ensureShareImageHttpUrl('')
page.ensureShareImageHttpUrl('wxfile://tmp/a.png')
console.log('ensureShare local', page.data.shareImage === 'wxfile://tmp/a.png')

// calendar-stats component shape
const cs = fs.readFileSync('subpackages/index-extra/components/calendar-stats/index.js', 'utf8')
const props = [...cs.matchAll(/(\w+):\s*\{\s*type:\s*(\w+)/g)].map((m) => m[1] + ':' + m[2])
console.log('props', props.join(', '))

process.exit(bad ? 1 : 0)
