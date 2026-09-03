/**
 * 冒烟：删除场次/商家时云存储媒体一并清理，不残留（内存 mock tcb db + mock cloud.deleteFile）
 * 覆盖：
 *  1. 商家删场次 → 大屏图/现场照片/视频+封面/群码/物料码全删；https 外链不动
 *  2. 奖品图：被中奖记录（souvenir_draws）引用的保留，未引用的删除
 *  3. 管理端删场次 → 同样清理
 *  4. 换头像 → 旧头像文件删除；删商家 → 头像文件删除
 * 运行：node scripts/_tmp_smoke_session_media_cleanup.js
 */
const { createWatchPartyApi } = require('../cloudfunctions/adminGateway/watchParty.js')

const CMD = {
  neq: (v) => ({ __cmd: 'neq', v }),
  lt: (v) => ({ __cmd: 'lt', v }),
  gt: (v) => ({ __cmd: 'gt', v }),
  inc: (v) => ({ __cmd: 'inc', v }),
  or: (arr) => ({ __cmd: 'or', arr }),
  addToSet: (v) => ({ __cmd: 'addToSet', v }),
  pull: (v) => ({ __cmd: 'pull', v })
}

const store = {}
let autoId = 1

function matchCond(doc, cond) {
  if (cond && cond.__cmd === 'or') return cond.arr.some((c) => matchCond(doc, c))
  return Object.keys(cond).every((k) => {
    const expect = cond[k]
    const actual = doc[k]
    if (expect && typeof expect === 'object' && expect.__cmd) {
      if (expect.__cmd === 'neq') return actual !== expect.v
      if (expect.__cmd === 'lt') return actual < expect.v
      if (expect.__cmd === 'gt') return actual > expect.v
    }
    if (Array.isArray(actual)) return actual.indexOf(expect) >= 0
    return actual === expect
  })
}

function applyUpdate(doc, data) {
  Object.keys(data).forEach((k) => {
    const v = data[k]
    const parts = k.split('.')
    let obj = doc
    for (let i = 0; i < parts.length - 1; i++) {
      if (!obj[parts[i]] || typeof obj[parts[i]] !== 'object') obj[parts[i]] = {}
      obj = obj[parts[i]]
    }
    const last = parts[parts.length - 1]
    if (v && typeof v === 'object' && v.__cmd === 'inc') {
      obj[last] = (Number(obj[last]) || 0) + v.v
    } else if (v && typeof v === 'object' && v.__cmd === 'addToSet') {
      if (!Array.isArray(obj[last])) obj[last] = []
      if (obj[last].indexOf(v.v) < 0) obj[last].push(v.v)
    } else if (v && typeof v === 'object' && v.__cmd === 'pull') {
      if (Array.isArray(obj[last])) obj[last] = obj[last].filter((x) => x !== v.v)
    } else {
      obj[last] = v
    }
  })
}

function collection(name) {
  if (!store[name]) store[name] = []
  const docs = store[name]

  function makeQuery(cond) {
    let _skip = 0
    let _limit = Infinity
    const q = {
      where: (c) => makeQuery(c),
      orderBy: () => q,
      skip: (n) => { _skip = n; return q },
      limit: (n) => { _limit = n; return q },
      field: () => q,
      get: async () => ({ data: docs.filter((d) => matchCond(d, cond)).slice(_skip, _skip + _limit).map((d) => ({ ...d })) }),
      count: async () => ({ total: docs.filter((d) => matchCond(d, cond)).length }),
      update: async ({ data }) => {
        const hits = docs.filter((d) => matchCond(d, cond))
        hits.forEach((d) => applyUpdate(d, data))
        return { stats: { updated: hits.length } }
      }
    }
    return q
  }

  return {
    where: (cond) => makeQuery(cond),
    orderBy: () => makeQuery({}),
    limit: (n) => makeQuery({}).limit(n),
    count: async () => ({ total: docs.length }),
    get: async () => ({ data: docs.map((d) => ({ ...d })) }),
    add: async ({ data }) => {
      const _id = data._id || `auto_${autoId++}`
      if (docs.some((d) => d._id === _id)) throw new Error('duplicate _id')
      docs.push({ ...data, _id })
      return { _id }
    },
    doc: (id) => ({
      get: async () => {
        const d = docs.find((x) => x._id === id)
        if (!d) throw new Error('not found')
        return { data: { ...d } }
      },
      update: async ({ data }) => {
        const d = docs.find((x) => x._id === id)
        if (!d) return { stats: { updated: 0 } }
        applyUpdate(d, data)
        return { stats: { updated: 1 } }
      },
      remove: async () => {
        const i = docs.findIndex((x) => x._id === id)
        if (i >= 0) docs.splice(i, 1)
        return {}
      }
    })
  }
}

const deletedFiles = []
const api = createWatchPartyApi({
  db: { collection, runTransaction: async (fn) => fn({ collection }) },
  _: CMD,
  ok: (data) => ({ code: 0, data }),
  fail: (code, message) => ({ code, message }),
  now: () => Date.now(),
  writeOpLog: async () => {},
  cloud: {
    deleteFile: async ({ fileList }) => {
      deletedFiles.push(...fileList)
      return { fileList: fileList.map((f) => ({ fileID: f, status: 0 })) }
    }
  },
  checkPerm: () => null
})

const admin = { username: 'tester', role: 'super_admin' }
let passed = 0
let failed = 0

function assert(name, cond, extra) {
  if (cond) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    console.log(`  ✗ ${name}`, extra != null ? JSON.stringify(extra) : '')
  }
}

const F = (p) => `cloud://prod-env.7072-bucket/watch_party/${p}`
const MEDIA = {
  sci1: F('science_images/sci1.png'),
  sci2: F('science_images/sci2.png'),
  photo1: F('site_photos/ph1.jpg'),
  photo2: F('site_photos/ph2.jpg'),
  video: F('site_video/v1.mp4'),
  poster: F('site_video/v1_poster.jpg'),
  qr1: F('wechat_qr/qr1.png'),
  material: F('session_qrcode/code1.png'),
  prize1: F('prizes/p1.jpg'),
  prize2: F('prizes/p2.jpg'),
  avatarA: F('merchant_avatar/a.jpg'),
  avatarB: F('merchant_avatar/b.jpg')
}
const HTTPS_EXT = 'https://cdn.example.com/keep-me.png'

async function main() {
  await collection('global_config').add({ data: { _id: 'main', enableWatchParty: true } })

  console.log('── 准备：入驻商家 + 两个带媒体的场次 ──')
  const apply = await api.applyMerchantLead({
    name: '文昌观礼小院', contactName: '阿文', phone: '13800000001'
  }, 'openid-m1')
  assert('自动入驻成功', apply.code === 0 && apply.data.autoApproved === true, apply)
  const merchantId = (await api.merchantMe('openid-m1')).data.merchant.merchantId

  const s1 = await api.createSession({
    code: 'wc01', title: '长七A观礼', missionId: 'll2-777', rocketName: 'Long March 7A',
    launchTime: new Date(Date.now() + 3600e3).toISOString(),
    merchantId, enabled: true
  }, admin)
  assert('创建场次1', s1.code === 0, s1)
  const sid1 = s1.data && (s1.data.id || s1.data._id)

  // 直接注入商家编辑后的入库媒体状态（含被引用/未引用奖品图、https 外链、物料码）
  await collection('watch_party_sessions').doc(sid1).update({
    data: {
      scienceImages: [MEDIA.sci1, MEDIA.sci2, HTTPS_EXT],
      sitePhotos: [MEDIA.photo1, MEDIA.photo2],
      siteVideo: MEDIA.video,
      siteVideoPoster: MEDIA.poster,
      wechatGroupQr: MEDIA.qr1,
      wechatGroupQrs: [MEDIA.qr1],
      qrCodeFileId: MEDIA.material,
      prizes: [
        { id: 'p1', name: '模型火箭', image: MEDIA.prize1, stock: 5, remaining: 4 },
        { id: 'p2', name: '徽章', image: MEDIA.prize2, stock: 10, remaining: 10 }
      ]
    }
  })
  // p1 有一条中奖记录（被引用，须保留）
  await collection('souvenir_draws').add({
    data: { openid: 'openid-u1', sessionId: sid1, prizeId: 'p1', name: '模型火箭', image: MEDIA.prize1, createdAt: Date.now() }
  })

  const s2 = await api.createSession({
    code: 'wc02', title: '长八观礼', missionId: 'll2-888', rocketName: 'Long March 8',
    launchTime: new Date(Date.now() + 7200e3).toISOString(),
    merchantId, enabled: true
  }, admin)
  const sid2 = s2.data && (s2.data.id || s2.data._id)
  await collection('watch_party_sessions').doc(sid2).update({
    data: { sitePhotos: [F('site_photos/s2ph.jpg')], siteVideo: F('site_video/s2v.mp4') }
  })

  console.log('── 1. 商家删除场次1：媒体全清，被引用奖品图保留 ──')
  deletedFiles.length = 0
  const del1 = await api.merchantDeleteSession(sid1, 'openid-m1')
  assert('删除成功', del1.code === 0, del1)
  const gone = (store['watch_party_sessions'] || []).every((d) => d._id !== sid1)
  assert('场次文档已删', gone)
  const expectDeleted = [MEDIA.sci1, MEDIA.sci2, MEDIA.photo1, MEDIA.photo2, MEDIA.video, MEDIA.poster, MEDIA.qr1, MEDIA.material, MEDIA.prize2]
  expectDeleted.forEach((f) => assert(`已删 ${f.split('/watch_party/')[1]}`, deletedFiles.indexOf(f) >= 0, deletedFiles))
  assert('被中奖记录引用的奖品图保留', deletedFiles.indexOf(MEDIA.prize1) < 0, deletedFiles)
  assert('https 外链不动', deletedFiles.indexOf(HTTPS_EXT) < 0, deletedFiles)
  assert('无重复删除', new Set(deletedFiles).size === deletedFiles.length, deletedFiles)

  console.log('── 2. 管理端删除场次2：同样清理 ──')
  deletedFiles.length = 0
  const del2 = await api.deleteSession(sid2, admin)
  assert('删除成功', del2.code === 0, del2)
  assert('照片已删', deletedFiles.indexOf(F('site_photos/s2ph.jpg')) >= 0, deletedFiles)
  assert('视频已删', deletedFiles.indexOf(F('site_video/s2v.mp4')) >= 0, deletedFiles)

  console.log('── 3. 换头像删旧文件；删商家删头像 ──')
  deletedFiles.length = 0
  await api.merchantUpdateAvatar({ avatar: MEDIA.avatarA }, 'openid-m1')
  assert('首次设头像不触发删除', deletedFiles.length === 0, deletedFiles)
  await api.merchantUpdateAvatar({ avatar: MEDIA.avatarB }, 'openid-m1')
  assert('换头像删除旧头像A', deletedFiles.indexOf(MEDIA.avatarA) >= 0, deletedFiles)
  assert('新头像B未被删', deletedFiles.indexOf(MEDIA.avatarB) < 0, deletedFiles)

  deletedFiles.length = 0
  const delM = await api.deleteMerchant(merchantId, admin)
  assert('删商家成功（名下已无场次）', delM.code === 0, delM)
  assert('商家头像B一并删除', deletedFiles.indexOf(MEDIA.avatarB) >= 0, deletedFiles)

  console.log(failed ? `\n${failed} 项未通过 / ${passed + failed}` : `\n全部通过（${passed} 项）`)
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
