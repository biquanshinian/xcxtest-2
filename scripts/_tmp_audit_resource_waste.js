/* 资源浪费审计验证：
 * 1) fuzzy memo：重复解析同名火箭 O(1)；map 更新后 memo 正确失效；前缀隔离
 * 2) rocket-config-art：同款重复点选不触发全栈重刷
 * 3) userDataGateway getMediaAssetsMap：小集合零额外读；截断时补拉火箭 key
 */
'use strict'
const path = require('path')
const fs = require('fs')

let failed = 0
function assert(cond, label) {
  if (cond) { console.log('  PASS  ' + label) }
  else { failed += 1; console.log('  FAIL  ' + label) }
}

// ── wx 全局 mock ──
const storage = {}
global.wx = {
  env: { USER_DATA_PATH: '/mock' },
  getStorageSync: (k) => storage[k],
  setStorageSync: (k, v) => { storage[k] = v },
  removeStorageSync: (k) => { delete storage[k] },
  getStorage: (o) => { (o && o.fail) && o.fail() },
  setStorage: (o) => { if (o && o.key) storage[o.key] = o.data },
  removeStorage: (o) => { if (o && o.key) delete storage[o.key] },
  getFileSystemManager: () => ({
    accessSync: () => { throw new Error('no file') },
    mkdirSync: () => {},
    unlink: () => {},
    unlinkSync: () => {},
    readdirSync: () => []
  }),
  getNetworkType: (o) => o && o.success && o.success({ networkType: 'none' }),
  downloadFile: (o) => o && o.fail && o.fail(new Error('mock')),
  cloud: null
}
global.getCurrentPages = () => []

const ROOT = path.resolve(__dirname, '..')

// ── 1) fuzzy memo ──
console.log('[1] findFuzzyRocketConfigUrl memo')
const config = require(path.join(ROOT, 'utils/config.js'))
if (!config.imageCDN) config.imageCDN = {}
config.imageCDN.enabled = true

const imageConfig = require(path.join(ROOT, 'utils/image-config.js'))
const { findFuzzyRocketConfigUrl } = imageConfig

// 用内部 setCloudMediaMap（未导出）→ 通过模块文件重新解析？改走导出面：
// image-config 导出里没有 setCloudMediaMap，检查一下导出
const hasSetter = typeof imageConfig.setCloudMediaMap === 'function'
console.log('  setCloudMediaMap exported:', hasSetter)

let setMap = imageConfig.setCloudMediaMap
if (!hasSetter) {
  // 兜底：通过 require cache 拿模块内部不可行；直接用导出的 loadCloudMediaMap 不合适。
  // 改为临时 eval 模块源码到受控沙箱验证 memo 逻辑。
  const src = fs.readFileSync(path.join(ROOT, 'utils/image-config.js'), 'utf8')
  const Module = require('module')
  const m = new Module('image-config-sandbox', null)
  m.filename = path.join(ROOT, 'utils/__sandbox_image_config.js')
  m.paths = Module._nodeModulePaths(path.join(ROOT, 'utils'))
  m._compile(src + '\nmodule.exports.__setCloudMediaMap = setCloudMediaMap\nmodule.exports.__findFuzzy = findFuzzyRocketConfigUrl\n', m.filename)
  setMap = m.exports.__setCloudMediaMap
  global.__fuzzy = m.exports.__findFuzzy
}
const fuzzy = global.__fuzzy || findFuzzyRocketConfigUrl

// 构造 1500 key 的 map（100 个火箭 key）
const bigMap = {}
for (let i = 0; i < 1400; i++) bigMap['其它素材/asset_' + i + '.png'] = 'https://cos/other_' + i + '.png'
for (let i = 0; i < 98; i++) bigMap['火箭配置图/Rocket Model ' + i + '.png'] = 'https://cos/rk_' + i + '.png'
bigMap['火箭配置图/Falcon 9.png'] = 'https://cos/f9.png'
bigMap['火箭配置图-机娘/Falcon 9.png'] = 'https://cos/f9_mecha.png'
setMap(bigMap)

const r1 = fuzzy('Falcon 9')
assert(r1 === 'https://cos/f9.png', '原图前缀命中 Falcon 9')
const r1m = fuzzy('Falcon 9', { keyPrefix: '火箭配置图-机娘/' })
assert(r1m === 'https://cos/f9_mecha.png', '机娘前缀命中且与原图隔离')
const rMiss = fuzzy('Nonexistent Rocket XYZ')
assert(rMiss === '', '未命中返回空串')

// 重复调用性能：2000 次同名解析（memo 生效应在个位数 ms；无 memo 时约需全量扫描 2000 遍）
const t0 = Date.now()
for (let i = 0; i < 2000; i++) {
  fuzzy('Falcon 9')
  fuzzy('Falcon 9', { keyPrefix: '火箭配置图-机娘/' })
  fuzzy('Nonexistent Rocket XYZ')
}
const elapsed = Date.now() - t0
console.log('  6000 次重复解析耗时: ' + elapsed + 'ms')
assert(elapsed < 200, '重复解析走 memo（<200ms）')

// map 更新后 memo 失效：新增更优 key 应生效
setMap({ '火箭配置图/Falcon 9 Block 5.png': 'https://cos/f9b5.png' })
const r2 = fuzzy('Falcon 9 Block 5')
assert(r2 === 'https://cos/f9b5.png', 'map 更新后 memo 失效，新 key 可命中')
const r3 = fuzzy('Falcon 9')
assert(!!r3, 'map 更新后原有名字仍可解析')

// ── 2) rocket-config-art 同款不重刷 ──
console.log('[2] setRocketConfigArtStyle 同款去重')
delete storage['_rocket_config_art']
const artPath = path.join(ROOT, 'utils/rocket-config-art.js')
delete require.cache[require.resolve(artPath)]
const art = require(artPath)

let refreshCalls = 0
global.getCurrentPages = () => [{ refreshRocketConfigArt() { refreshCalls += 1; return true } }]

const v0 = art.getRocketConfigArtVersion()
art.setRocketConfigArtStyle('original')   // 已是默认 original
assert(refreshCalls === 0, '同款(original)重复设置不触发页面刷新')
assert(art.getRocketConfigArtVersion() === v0, '同款设置不递增版本')

art.setRocketConfigArtStyle('mecha')
assert(refreshCalls === 1, '切换到 mecha 触发一次刷新')
assert(art.getRocketConfigArtVersion() === v0 + 1, '切换递增版本')

art.setRocketConfigArtStyle('mecha')
assert(refreshCalls === 1, '同款(mecha)重复设置不再刷新')

art.setRocketConfigArtStyle('original')
assert(refreshCalls === 2, '切回 original 触发刷新')

// ── 3) userDataGateway handleGetMediaAssetsMap 读放大 ──
console.log('[3] getMediaAssetsMap 分页读')
const gwSrc = fs.readFileSync(path.join(ROOT, 'cloudfunctions/userDataGateway/index.js'), 'utf8')
const fnMatch = gwSrc.match(/async function handleGetMediaAssetsMap\(\)\s*\{[\s\S]*?\n\}/)
assert(!!fnMatch, '能从源码提取 handleGetMediaAssetsMap')

function makeMockDb(docs) {
  const stats = { plainReads: 0, regexpReads: 0, plainQueries: 0, regexpQueries: 0 }
  const db = {
    RegExp: (o) => ({ __re: new RegExp(o.regexp, o.options || '') }),
    collection: () => {
      const q = { where: null, skip: 0, limit: 20 }
      const chain = {
        where(w) { q.where = w; return chain },
        field() { return chain },
        orderBy() { return chain },
        skip(n) { q.skip = n; return chain },
        limit(n) { q.limit = n; return chain },
        async get() {
          const isRegexp = !!(q.where && q.where.key && q.where.key.__re)
          let rows = docs.filter((d) => d.enabled)
          if (isRegexp) rows = rows.filter((d) => q.where.key.__re.test(d.key))
          const page = rows.slice(q.skip, q.skip + q.limit)
          if (isRegexp) { stats.regexpQueries += 1; stats.regexpReads += page.length }
          else { stats.plainQueries += 1; stats.plainReads += page.length }
          return { data: page.map((d) => ({ key: d.key, url: d.url })) }
        }
      }
      return chain
    }
  }
  return { db, stats }
}

async function runGateway(docs) {
  const { db, stats } = makeMockDb(docs)
  const fn = new Function('db', fnMatch[0] + '\nreturn handleGetMediaAssetsMap;')(db)
  const out = await fn()
  return { out, stats }
}

;(async () => {
  // 场景 A：小集合（300 条含 30 条火箭）→ 单趟扫描，零 regexp 查询
  const docsA = []
  for (let i = 0; i < 270; i++) docsA.push({ enabled: true, key: '素材/a' + i + '.png', url: 'u' + i })
  for (let i = 0; i < 20; i++) docsA.push({ enabled: true, key: '火箭配置图/rk' + i + '.png', url: 'r' + i })
  for (let i = 0; i < 10; i++) docsA.push({ enabled: true, key: '火箭配置图-机娘/mk' + i + '.png', url: 'm' + i })
  const A = await runGateway(docsA)
  assert(A.out.count === 300, 'A: 全量 300 条进 map (实际 ' + A.out.count + ')')
  assert(A.stats.regexpQueries === 0, 'A: 未截断时零 regexp 查询 (实际 ' + A.stats.regexpQueries + ')')
  assert(A.stats.plainReads === 300, 'A: 主扫描读数 == 文档数 (实际 ' + A.stats.plainReads + ')')

  // 场景 B：大集合（2000 条，火箭 key 排在 _id 末尾会被主扫描截断）→ 补拉火箭 key
  const docsB = []
  for (let i = 0; i < 1900; i++) docsB.push({ enabled: true, key: '素材/b' + i + '.png', url: 'u' + i })
  for (let i = 0; i < 60; i++) docsB.push({ enabled: true, key: '火箭配置图/rk' + i + '.png', url: 'r' + i })
  for (let i = 0; i < 40; i++) docsB.push({ enabled: true, key: '火箭配置图-机娘/mk' + i + '.png', url: 'm' + i })
  const B = await runGateway(docsB)
  const rocketInMap = Object.keys(B.out.map).filter((k) => /^火箭配置图(\/|-机娘\/)/.test(k)).length
  assert(rocketInMap === 100, 'B: 截断后火箭 key 全部补齐 (实际 ' + rocketInMap + '/100)')
  assert(B.stats.regexpQueries > 0, 'B: 截断时才触发 regexp 补拉')
  assert(B.out.count >= 1500, 'B: map 容量 ≥ MAX_ROWS (实际 ' + B.out.count + ')')

  // 场景 C：恰好等于容量（1500 条全非火箭）→ 补拉是空结果、不误加
  const docsC = []
  for (let i = 0; i < 1500; i++) docsC.push({ enabled: true, key: '素材/c' + i + '.png', url: 'u' + i })
  const C = await runGateway(docsC)
  assert(C.out.count === 1500, 'C: 恰满容量输出 1500')

  console.log(failed === 0 ? '\nALL GREEN' : '\n' + failed + ' FAILED')
  process.exit(failed === 0 ? 0 : 1)
})().catch((e) => { console.error(e); process.exit(1) })
