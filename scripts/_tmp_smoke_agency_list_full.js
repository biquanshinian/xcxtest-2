/**
 * 冒烟：图鉴全量列表不再被 featured 15 家污染
 * node scripts/_tmp_smoke_agency_list_full.js
 */
const path = require('path')
const ROOT = path.resolve(__dirname, '..')

const storage = {}
global.wx = {
  env: { USER_DATA_PATH: '/tmp' },
  getStorageSync: (k) => storage[k],
  setStorage: ({ key, data }) => { storage[key] = data },
  setStorageSync: (k, v) => { storage[k] = v }
}

function stub(absPath, exportsObj) {
  require.cache[absPath] = { id: absPath, filename: absPath, loaded: true, exports: exportsObj }
}

const U = (p) => path.join(ROOT, 'utils', p)

// —— 可切换的 getAgencies 桩 ——
let mode = 'cacheMiss' // 'cacheMiss' | 'full'
const FEATURED = Array.from({ length: 15 }, (_, i) => ({
  id: i + 1, name: `Featured ${i + 1}`, featured: true, type: { name: 'Commercial' }
}))
const ALL = Array.from({ length: 350 }, (_, i) => ({
  id: i + 1, name: `Agency ${i + 1}`, featured: i < 15, type: { name: 'Commercial' }
}))

stub(U('api-monitor-data.js'), {
  getAgencies: async (opts) => {
    const o = opts || {}
    if (o.featured) return { count: 15, results: FEATURED }
    if (mode === 'cacheMiss') return { count: 0, results: [], __cacheMiss: true }
    return { count: 350, results: ALL.slice(0, 400) }
  },
  getAgencyDetail: async () => { throw new Error('no detail in test') }
})
stub(U('agency-logo-cache.js'), {
  resolveAgencyLogoForDisplay: (u) => u,
  isRemoteAgencyLogoUrl: (u) => /^https?:/i.test(String(u || '')),
  getCachedAgencyLogoPath: () => '',
  persistAgencyLogoAfterRemoteLoad: () => {},
  normalizeAgencyLogoCacheKey: (u) => u,
  invalidateAgencyLogoCache: () => {}
})
stub(U('agency-logo-bg.js'), { resolveAgencyLogoBgTone: () => '', ensureAgencyLogoBgTone: () => {} })
stub(U('space-terms-i18n.js'), { translateAgencyName: () => '', translateSpacecraftName: () => '' })
stub(U('ll2-image.js'), { buildLl2ImageChain: () => [], isOwnCdnUrl: () => true, proxiedImageUrl: (u) => u, stripImageProcess: (u) => u, advanceImageFallback: () => ({ next: '', remaining: [] }) })

const agencyData = require(path.join(ROOT, 'subpackages/monitor-pages/utils/agency-data.js'))

let pass = 0
let fail = 0
function must(cond, label) {
  if (cond) { pass++; console.log('  ok', label) }
  else { fail++; console.log('  FAIL', label) }
}

;(async () => {
  console.log('=== 1. 聚合缓存 __cacheMiss：featured 不得冒充全量 ===')
  const r1 = await agencyData.getAllAgencies()
  must(r1.list.length === 15, `仅 featured 15 家（实际 ${r1.list.length}）`)
  must(r1.partial === true, 'partial 标记为 true')
  must(storage['_agency_list_persist_v5'] === undefined, 'partial 结果不落盘持久缓存')

  console.log('=== 2. 云端缓存恢复后：重进页面自动升级为全量 ===')
  mode = 'full'
  const r2 = await agencyData.getAllAgencies()
  must(r2.list.length === 350, `全量 350 家（实际 ${r2.list.length}）`)
  must(r2.partial === false, 'partial 标记为 false')
  must(!!storage['_agency_list_persist_v5'], '全量结果写入持久缓存')

  console.log('=== 3. 全量内存缓存命中：快速返回不再重拉 ===')
  mode = 'cacheMiss'
  const r3 = await agencyData.getAllAgencies()
  must(r3.list.length === 350, '10 分钟内直接复用全量内存缓存')

  console.log(`\n${fail === 0 ? 'ALL PASS' : 'HAS FAILURES'} (pass=${pass} fail=${fail})`)
  process.exit(fail === 0 ? 0 : 1)
})().catch((e) => {
  console.error('FAIL 异常:', e && e.stack || e)
  process.exit(1)
})
