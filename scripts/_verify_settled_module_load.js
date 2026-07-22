// 一次性校验：wx 打桩后加载 index-settled-merge.js，确认依赖与导出可解析
function deepStub() {
  const f = function () {
    return deepStub()
  }
  return new Proxy(f, {
    get(t, k) {
      if (k === 'USER_DATA_PATH') return '/tmp/stub'
      if (k === Symbol.toPrimitive || k === 'toString') return () => 'stub'
      if (k === 'then') return undefined
      return deepStub()
    },
    apply() {
      return deepStub()
    }
  })
}
globalThis.wx = deepStub()
globalThis.getApp = () => deepStub()
globalThis.App = () => {}
globalThis.Page = () => {}
globalThis.Component = () => {}
globalThis.Behavior = () => ({})
globalThis.getCurrentPages = () => []

const m = require('../pages/index/utils/index-settled-merge.js')
const names = Object.keys(m.methods)
console.log('loaded OK,', names.length, 'methods')
console.log('exports:', Object.keys(m).join(', '))
console.log('isSettleableLiveStatusId(6) =', m.isSettleableLiveStatusId(6))
console.log('isSettleableLiveStatusId(1) =', m.isSettleableLiveStatusId(1))
console.log('isSettleableLiveStatusId(3) =', m.isSettleableLiveStatusId(3))
console.log('RECENT_SETTLED_MEM_TTL_MS =', m.RECENT_SETTLED_MEM_TTL_MS)
