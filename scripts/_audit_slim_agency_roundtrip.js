/**
 * 回归校验：LL2 真实 detailed 数据 → slimAgencyDetail → 前端消费字段逐项核对
 * 用法：node scripts/_audit_slim_agency_roundtrip.js
 */
const https = require('https')
const fs = require('fs')
const path = require('path')

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'slim-roundtrip-audit' } }, (res) => {
      let b = ''
      res.on('data', (d) => { b += d })
      res.on('end', () => {
        try { resolve(JSON.parse(b)) } catch (e) { reject(e) }
      })
    }).on('error', reject)
  })
}

// 从 _legacy.js 源码中提取 slimAgencyDetail（含 AGENCY_SLIM_SCHEMA 常量）
function loadSlimFn() {
  const src = fs.readFileSync(path.join(__dirname, '../cloudfunctions/syncSpaceDevsData/_legacy.js'), 'utf8')
  const start = src.indexOf('const AGENCY_SLIM_SCHEMA')
  const marker = '\n/**\n * 单个发射商详情同步'
  const end = src.indexOf(marker, start)
  if (start < 0 || end < 0) throw new Error('无法定位 slimAgencyDetail 源码')
  const snippet = src.slice(start, end)
  // eslint-disable-next-line no-new-func
  return new Function(snippet + '\nreturn slimAgencyDetail')()
}

const failures = []
let passCount = 0
function check(name, ok, detail) {
  if (ok) { passCount++; console.log('  PASS ' + name) }
  else { failures.push(name); console.log('  FAIL ' + name + (detail ? ' -- ' + detail : '')) }
}

async function main() {
  const slimAgencyDetail = loadSlimFn()
  const ids = [121, 88] // SpaceX + CASC（中外各一，结构可能有差异）
  for (const id of ids) {
    console.log('\n=== agency ' + id + ' ===')
    const raw = await fetchJson(`https://ll.thespacedevs.com/2.3.0/agencies/${id}/?mode=detailed&format=json`)
    const slim = slimAgencyDetail(raw)
    const sizeKB = Math.round(JSON.stringify(slim).length / 1024)
    console.log('  raw KB=' + Math.round(JSON.stringify(raw).length / 1024) + ' slim KB=' + sizeKB)

    check('体积 <800KB', sizeKB < 800, sizeKB + 'KB')
    check('_slimSchema=2', slim._slimSchema === 2)
    check('id/name 保留', slim.id === raw.id && slim.name === raw.name)

    // agency-detail.js formatAgencyDetail 消费的顶层字段
    const topFields = ['type', 'featured', 'country', 'description', 'administrator', 'founding_year',
      'launchers', 'spacecraft', 'parent', 'image', 'logo', 'social_logo', 'info_url', 'wiki_url',
      'total_launch_count', 'successful_launches', 'failed_launches', 'pending_launches',
      'consecutive_successful_launches', 'attempted_landings', 'successful_landings', 'failed_landings',
      'consecutive_successful_landings',
      'successful_landings_spacecraft', 'failed_landings_spacecraft', 'attempted_landings_spacecraft',
      'successful_landings_payload', 'failed_landings_payload', 'attempted_landings_payload',
      'social_media_links', 'launcher_list', 'spacecraft_list']
    const missing = topFields.filter((f) => !(f in slim))
    check('顶层消费字段齐全', missing.length === 0, '缺 ' + missing.join(','))

    // 统计值不失真（原始有值时瘦身后必须等值）
    const statKeys = topFields.filter((f) => /count|launches|landings/.test(f) && !/list/.test(f))
    const distorted = statKeys.filter((f) => raw[f] != null && slim[f] !== raw[f])
    check('统计值等值', distorted.length === 0, distorted.join(','))

    // launcher_list：每条必须有 name（agency-detail 以 name 去重展示）
    const rawL = Array.isArray(raw.launcher_list) ? raw.launcher_list.length : 0
    const named = (slim.launcher_list || []).filter((l) => l && l.name).length
    check('launcher_list 保留 name', rawL === 0 || (named > 0 && named === (slim.launcher_list || []).length),
      'raw=' + rawL + ' named=' + named)

    // spacecraft_list：normalizeLl2Spacecraft（spacecraft-detail.js 直传路径）消费字段
    const scFields = ['id', 'name', 'type', 'agency', 'family', 'in_use', 'image', 'capability',
      'history', 'details', 'maiden_flight', 'height', 'diameter', 'human_rated', 'crew_capacity',
      'payload_capacity', 'payload_return_capacity', 'flight_life', 'wiki_link', 'info_link',
      'spacecraft_flown', 'total_launch_count', 'successful_launches', 'failed_launches',
      'attempted_landings', 'successful_landings', 'failed_landings']
    const sc = (slim.spacecraft_list || [])[0]
    if (sc) {
      const scMissing = scFields.filter((f) => !(f in sc))
      check('spacecraft 条目直传字段齐全', scMissing.length === 0, '缺 ' + scMissing.join(','))
      check('spacecraft type.name 可读', !sc.type || typeof sc.type.name === 'string')
    } else {
      console.log('  (无 spacecraft_list，跳过条目校验)')
    }

    // social_media_links：agency-detail 消费 social_media.name / url / priority
    const sm = (slim.social_media_links || [])[0]
    if (sm) {
      check('social 链接结构', 'url' in sm && 'social_media' in sm && 'priority' in sm)
    }

    // syncOneAgencyDetail 写入前校验逻辑复现（rawL>0 时 named 必须 >0）
    check('写入前校验可通过', !(rawL > 0 && named === 0))
  }

  console.log('\n==== 结果: ' + passCount + ' PASS, ' + failures.length + ' FAIL ====')
  if (failures.length) { console.log(failures.join('\n')); process.exit(1) }
}

main().catch((e) => { console.error('脚本失败:', e.message); process.exit(1) })
