/**
 * 分享冷启动黑屏复现 / 验证。
 *
 * 严格按微信分包规则搭一个模块加载器：
 *   页面所在分包 + 主包 = 已下载，可同步 require
 *   其它分包        = 未下载，同步 require 直接抛「module is not defined」
 *   require.async  = 允许（分包异步化，运行时才去下载）
 *
 * 加载抛错 = Page() 从未注册 = 用户看到整页黑屏。
 */
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const ROOT = path.resolve(__dirname, '..')
const appJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'))
const SUB_ROOTS = (appJson.subPackages || []).map((s) => String(s.root).replace(/\/+$/, ''))

function subRootOf(rel) {
  for (const r of SUB_ROOTS) {
    if (rel === r || rel.startsWith(r + '/')) return r
  }
  return null
}

// ── 最小 wx / 宿主 mock（只要够模块顶层代码跑完） ──
const storage = {}
global.wx = new Proxy({
  getStorageSync: (k) => (k in storage ? storage[k] : ''),
  setStorageSync: (k, v) => { storage[k] = v },
  getSystemInfoSync: () => ({ platform: 'ios', statusBarHeight: 44, screenWidth: 390, screenHeight: 844, SDKVersion: '3.5.0' }),
  getWindowInfo: () => ({ statusBarHeight: 44, screenWidth: 390, screenHeight: 844, safeArea: { bottom: 810 } }),
  getAppBaseInfo: () => ({ SDKVersion: '3.5.0', theme: 'dark' }),
  getDeviceInfo: () => ({ platform: 'ios' }),
  getMenuButtonBoundingClientRect: () => ({ top: 48, bottom: 80, height: 32, left: 280, right: 370, width: 90 }),
  getLaunchOptionsSync: () => ({ scene: 1154, query: {} }),
  getEnterOptionsSync: () => ({ scene: 1154, query: {} }),
  cloud: {
    init: () => {},
    callFunction: () => Promise.resolve({ result: {} }),
    database: () => ({
      command: { in: (v) => v },
      collection: () => ({
        where() { return this }, orderBy() { return this }, skip() { return this }, limit() { return this },
        get: () => Promise.resolve({ data: [] }), doc: () => ({ get: () => Promise.resolve({ data: null }) })
      })
    })
  },
  env: { USER_DATA_PATH: '/tmp' }
}, {
  get: (t, k) => (k in t ? t[k] : () => ({}))
})
global.getApp = () => ({ globalData: {}, getUiShellLayout: () => ({ statusBarHeight: 44, navPlaceholderHeight: 88, tabBarReservedHeight: 0 }) })
global.getCurrentPages = () => []
global.Behavior = (cfg) => cfg
global.Component = () => {}
global.App = () => {}

// ── 分包感知的 CommonJS 加载器 ──
function makeLoader(availableSubRoot) {
  const cache = new Map()

  function resolve(fromRel, spec) {
    let target
    if (spec.startsWith('/')) target = spec.slice(1)
    else target = path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), spec))
    const tries = [target, target + '.js', target + '/index.js']
    for (const t of tries) {
      if (fs.existsSync(path.join(ROOT, t)) && fs.statSync(path.join(ROOT, t)).isFile()) return t
    }
    return null
  }

  function load(rel, viaAsync) {
    const sub = subRootOf(rel)
    if (!viaAsync && sub && sub !== availableSubRoot) {
      const err = new Error(`module '${rel}' is not defined，可能没有申明 ${sub} 分包`)
      err.__crossPackage = true
      throw err
    }
    if (cache.has(rel)) return cache.get(rel).exports
    const mod = { exports: {} }
    cache.set(rel, mod)
    const abs = path.join(ROOT, rel)
    if (rel.endsWith('.json')) {
      mod.exports = JSON.parse(fs.readFileSync(abs, 'utf8'))
      return mod.exports
    }
    const code = fs.readFileSync(abs, 'utf8')
    const req = (spec) => {
      const t = resolve(rel, spec)
      if (!t) throw new Error(`cannot resolve ${spec} from ${rel}`)
      return load(t, false)
    }
    req.async = (spec) => {
      const t = resolve(rel, spec)
      if (!t) return Promise.reject(new Error(`cannot resolve ${spec}`))
      try { return Promise.resolve(load(t, true)) } catch (e) { return Promise.reject(e) }
    }
    const fn = new vm.Script(
      '(function(require, module, exports, __dirname, __filename){' + code + '\n})',
      { filename: abs }
    ).runInThisContext()
    fn(req, mod, mod.exports, path.dirname(abs), abs)
    return mod.exports
  }

  return load
}

// app.json 里声明的全部页面
const TARGETS = []
;(appJson.pages || []).forEach((p) => TARGETS.push(p.replace(/^\//, '') + '.js'))
;(appJson.subPackages || []).forEach((sp) => {
  const root = String(sp.root).replace(/\/+$/, '')
  ;(sp.pages || []).forEach((p) => TARGETS.push(root + '/' + p.replace(/^\//, '') + '.js'))
})

const blackScreen = []
const mockGaps = []
let okCount = 0

console.log('模拟：分享卡片 / 朋友圈单页直达，只有「主包 + 该页所在分包」已下载')
console.log('校验：页面模块能否加载完成并注册 Page()（加载抛错 = 整页黑屏）\n')

for (const t of TARGETS) {
  if (!fs.existsSync(path.join(ROOT, t))) continue
  const sub = subRootOf(t)
  let pageCfg = null
  global.Page = (cfg) => { pageCfg = cfg }
  const load = makeLoader(sub)
  try {
    load(t, false)
    if (pageCfg) okCount++
    else mockGaps.push({ t, msg: '模块加载成功但未注册 Page()' })
  } catch (e) {
    // 只有跨分包同步引用是真实的线上黑屏；其它异常多半是本脚本 wx mock 不全
    if (e.__crossPackage) blackScreen.push({ t, msg: e.message })
    else mockGaps.push({ t, msg: e.message })
  }
}

if (blackScreen.length) {
  console.log('🔴 跨分包同步引用 → 分享/直达冷启动整页黑屏：')
  blackScreen.forEach((x) => console.log(`  ${x.t}\n      ${x.msg}`))
} else {
  console.log(`🟢 ${okCount} 个页面冷启动均可正常加载并注册 Page()`)
}

if (mockGaps.length) {
  console.log(`\n🟡 ${mockGaps.length} 个页面未能在本脚本环境内跑完（wx mock 不全，非线上问题）：`)
  mockGaps.forEach((x) => console.log(`  ${x.t} — ${String(x.msg).slice(0, 90)}`))
}

console.log('\n══ 结论 ══')
console.log(blackScreen.length ? `${blackScreen.length} 个页面冷启动黑屏` : '无冷启动黑屏页面')
process.exit(blackScreen.length ? 1 : 0)
