/**
 * 冒烟：首页胶囊发射商 logo 链路（目录权威 + 自动取色保留）
 * node scripts/_tmp_smoke_agency_chip_logo_chain.js
 */

const path = require('path')
const ROOT = path.resolve(__dirname, '..')

const storage = {}
global.wx = {
  env: { USER_DATA_PATH: '/tmp' },
  getStorageSync: (k) => storage[k],
  setStorage: ({ key, data }) => { storage[key] = data },
  setStorageSync: (k, v) => { storage[k] = v },
  getFileSystemManager: () => ({
    accessSync: () => { throw new Error('no file') },
    mkdirSync: () => {},
    unlink: () => {}
  }),
  downloadFile: () => {},
  getImageInfo: () => {}
}

let pass = 0
let fail = 0
function must(cond, label) {
  if (cond) { pass++; console.log('  ok', label) }
  else { fail++; console.log('  FAIL', label) }
}

const filter = require(path.join(ROOT, 'utils/upcoming-agency-filter.js'))
const enrich = require(path.join(ROOT, 'utils/upcoming-agency-logo-enrich.js'))
const { SPACEX_LAUNCH_SERVICE_PROVIDER_LOGO_URL } = require(path.join(ROOT, 'utils/agency-logo-overrides.js'))

console.log('=== 1. logoUrlFromAgencyRecord 与图鉴口径一致 ===')
const cosUrl = 'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/LL2%E9%95%9C%E5%83%8F/abc.png'
must(
  enrich.logoUrlFromAgencyRecord({ id: 88, name: 'CASC', logo: { thumbnail_url: cosUrl } }) === cosUrl,
  '普通机构取 logo.thumbnail_url'
)
must(
  enrich.logoUrlFromAgencyRecord({ id: 121, name: 'SpaceX', logo: { thumbnail_url: cosUrl } }) ===
    SPACEX_LAUNCH_SERVICE_PROVIDER_LOGO_URL,
  'SpaceX 走统一覆盖'
)
must(
  enrich.logoUrlFromAgencyRecord({ id: 63, name: 'ROSCOSMOS', logo: { image_url: '/media/roscosmos.png' } }) ===
    'https://ll.thespacedevs.com/media/roscosmos.png',
  '相对路径补全域名'
)

console.log('=== 2. buildUpcomingAgencyFilterState 芯片字段 ===')
const missions = [
  { id: 'a1', launchAgencyId: 121, launchAgency: 'SpaceX', launchAgencyImage: '' },
  { id: 'b1', launchAgencyId: 147, launchAgency: '火箭实验室', launchAgencyImage: cosUrl },
  { id: 'b2', launchAgencyId: 147, launchAgency: '火箭实验室', launchAgencyImage: cosUrl },
  { id: 'c1', launchAgencyId: null, launchAgency: '神秘机构', launchAgencyImage: '' }
]
const state = filter.buildUpcomingAgencyFilterState(missions, '_all')
const chips = state.upcomingAgencyChipsDisplayed
must(chips[0].key === '_all' && chips[0].count === 4, '全部胶囊计数')
const sx = chips.find((c) => c.label === 'SpaceX')
must(!!sx && sx.logoRemoteSrc === SPACEX_LAUNCH_SERVICE_PROVIDER_LOGO_URL, 'SpaceX 芯片 logoRemoteSrc=统一 COS 图')
const rl = chips.find((c) => c.label === '火箭实验室')
must(!!rl && rl.logoRemoteSrc === cosUrl, '火箭实验室芯片 logoRemoteSrc=COS 目录图')
must(rl.count === 2, '同机构聚合计数')
const unknown = chips.find((c) => c.label === '神秘机构')
must(!!unknown && unknown.logoRemoteSrc === '' && unknown.logoUrl.indexOf('ic-rocket-outline') !== -1, '无图机构回退占位火箭')
must(unknown.logoBgTone === 'dark', '占位火箭固定黑底（白描边可见）')

console.log('=== 3. 自动取色：tone 缓存命中即写入芯片 ===')
// 预写 tone 持久化缓存（键=normalize 后 URL），模拟冷启动命中
const { getCachedAgencyLogoBgTone } = require(path.join(ROOT, 'utils/agency-logo-bg.js'))
const { normalizeAgencyLogoCacheKey } = require(path.join(ROOT, 'utils/agency-logo-cache.js'))
const key = normalizeAgencyLogoCacheKey(cosUrl)
storage['_agency_logo_bg_index'] = { [key]: 'dark' }
// agency-logo-bg 模块内存态已初始化为空，需重载模块
delete require.cache[require.resolve(path.join(ROOT, 'utils/agency-logo-bg.js'))]
delete require.cache[require.resolve(path.join(ROOT, 'utils/upcoming-agency-filter.js'))]
const filter2 = require(path.join(ROOT, 'utils/upcoming-agency-filter.js'))
const state2 = filter2.buildUpcomingAgencyFilterState(missions, '_all')
const rl2 = state2.upcomingAgencyChipsDisplayed.find((c) => c.label === '火箭实验室')
must(rl2.logoBgTone === 'dark', '冷启动命中 tone 缓存 → 芯片直接黑底')

console.log('=== 4. enrich：目录权威覆盖内嵌外链 ===')
const externalUrl = 'https://spacelaunchnow-prod-east.nyc3.digitaloceanspaces.com/media/agency_images/casc_logo.png'
storage['_agencies_f0_l400_o0_s_t'] = {
  ts: Date.now(),
  data: {
    count: 1,
    results: [{ id: 88, name: 'CASC', logo: { thumbnail_url: cosUrl } }]
  }
}
delete require.cache[require.resolve(path.join(ROOT, 'utils/upcoming-agency-logo-enrich.js'))]
const enrich2 = require(path.join(ROOT, 'utils/upcoming-agency-logo-enrich.js'))
enrich2
  .enrichMissionsLaunchAgencyImages([
    { id: 'x1', launchAgencyId: 88, launchAgency: 'CASC', launchAgencyImage: externalUrl }
  ])
  .then((out) => {
    must(out[0].launchAgencyImage === cosUrl, '外链被目录 COS 图覆盖（同一条路）')

    console.log('=== 5. 按 id 本地缓存即可出胶囊，不等 400 家 ===')
    storage['_agency_logo_by_id'] = { '147': cosUrl }
    delete require.cache[require.resolve(path.join(ROOT, 'utils/upcoming-agency-logo-enrich.js'))]
    delete require.cache[require.resolve(path.join(ROOT, 'utils/upcoming-agency-filter.js'))]
    const filter3 = require(path.join(ROOT, 'utils/upcoming-agency-filter.js'))
    const state3 = filter3.buildUpcomingAgencyFilterState([
      { id: 'b1', launchAgencyId: 147, launchAgency: '火箭实验室', launchAgencyImage: '' }
    ], '_all')
    const rl3 = state3.upcomingAgencyChipsDisplayed.find((c) => c.label === '火箭实验室')
    must(!!rl3 && rl3.logoRemoteSrc === cosUrl, '缺 launchAgencyImage 时用按 id 缓存出图')

    console.log('=== 6. 权重：可回收 / 知名优先 ===')
    delete require.cache[require.resolve(path.join(ROOT, 'utils/upcoming-agency-logo-enrich.js'))]
    const enrich3 = require(path.join(ROOT, 'utils/upcoming-agency-logo-enrich.js'))
    const sx = enrich3.scoreAgencyLogoPriority({
      id: 'a',
      launchAgencyId: 121,
      launchAgency: 'SpaceX',
      isRecoverableThisMission: true
    })
    const rl = enrich3.scoreAgencyLogoPriority({
      id: 'b',
      launchAgencyId: 147,
      launchAgency: '火箭实验室',
      isRecoverableThisMission: true
    })
    const casc = enrich3.scoreAgencyLogoPriority({
      id: 'c',
      launchAgencyId: 88,
      launchAgency: '中国航天科技集团'
    })
    const obscure = enrich3.scoreAgencyLogoPriority({
      id: 'd',
      launchAgencyId: 9999,
      launchAgency: 'Obscure Launch Co'
    })
    must(sx > casc && rl > casc, '可回收发射商权重大于普通知名')
    must(casc > obscure, '知名发射商权重大于无名')
    const ranked = enrich3.rankUpcomingAgenciesForLogo([
      { id: 'd1', launchAgencyId: 9999, launchAgency: 'Obscure Launch Co' },
      { id: 'c1', launchAgencyId: 88, launchAgency: '中国航天科技集团' },
      { id: 'a1', launchAgencyId: 121, launchAgency: 'SpaceX', isRecoverableThisMission: true },
      { id: 'b1', launchAgencyId: 147, launchAgency: '火箭实验室', isRecoverableThisMission: true }
    ])
    must(ranked[0].id === '121' || ranked[0].id === '147', '排序首位是可回收发射商')
    const missing = new Set(ranked.map((r) => r.id))
    const waves = enrich3.splitLogoFetchWaves(ranked, missing)
    must(waves.high.indexOf('121') !== -1 && waves.high.indexOf('147') !== -1, '高权重复用/知名进第一波')
    must(waves.high.length === 4 && waves.rest.length === 0, '不足 20 家时第一波吃满当前列表')
    const overflow = []
    for (let i = 0; i < 25; i++) {
      overflow.push({
        id: 'x' + i,
        launchAgencyId: 8000 + i,
        launchAgency: i < 2 ? 'SpaceX' : 'Obscure Launch Co ' + i,
        isRecoverableThisMission: i < 2
      })
    }
    const rankedMany = enrich3.rankUpcomingAgenciesForLogo(overflow)
    const wavesMany = enrich3.splitLogoFetchWaves(rankedMany, new Set(rankedMany.map((r) => r.id)))
    must(wavesMany.high.length === 20 && wavesMany.rest.length === 5, '第一波上限 20 家，其余后台补')
    must(wavesMany.high.indexOf('8000') !== -1 && wavesMany.high.indexOf('8001') !== -1, '溢出时仍优先可回收')

    console.log(`\n${fail === 0 ? 'ALL PASS' : 'HAS FAILURES'} (pass=${pass} fail=${fail})`)
    process.exit(fail === 0 ? 0 : 1)
  })
  .catch((e) => {
    console.log('  FAIL enrich 异常', e && e.message)
    process.exit(1)
  })
