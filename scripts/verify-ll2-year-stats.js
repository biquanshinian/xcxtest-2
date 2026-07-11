#!/usr/bin/env node
/**
 * verify-ll2-year-stats.js — LL2 年度发射统计「真值」对账脚本
 *
 * 用途：直接打 Launch Library 2 REST 接口，按 UTC 自然年用 count 端点取
 *       总数 / 成功 / 失败 / 部分失败，以及按国家、运营商的拆分，作为云函数
 *       getLaunchStats 缓存对账的基准真值。
 *
 * 口径（与云函数一致）：
 *   - 时间窗口：net__gte=`${Y}-01-01T00:00:00Z`、net__lt=`${Y+1}-01-01T00:00:00Z`
 *     （左闭右开，避免把 12-31 当天漏掉、也不把次年 01-01 算进来）
 *   - 已完成发射用 /launches/previous/，只读响应 count 字段（limit=1）
 *   - status__ids：3=成功，4=失败(Launch Failure)，7=部分失败(Partial Failure)
 *
 * 限流：LL2 免费层 15 次/小时/IP。脚本串行 + 间隔，默认请求数为个位数。
 *       设置环境变量 LL2_API_TOKEN 可加 Authorization 头提高额度。
 *
 * 用法：
 *   node scripts/verify-ll2-year-stats.js            # 默认 2025
 *   node scripts/verify-ll2-year-stats.js 2024
 *   $env:LL2_API_TOKEN="xxx"; node scripts/verify-ll2-year-stats.js 2025
 */

const https = require('https')

const API = 'https://ll.thespacedevs.com/2.3.0'
const REQUEST_GAP_MS = 2500
const TOKEN = (process.env.LL2_API_TOKEN || '').trim()

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function buildQuery(params) {
  return Object.keys(params)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
    .join('&')
}

function getCount(params) {
  const qs = buildQuery({ limit: 1, mode: 'list', format: 'json', ...params })
  const url = `${API}/launches/previous/?${qs}`
  return new Promise((resolve) => {
    const headers = { 'User-Agent': 'verify-ll2/1.0', Accept: 'application/json' }
    if (TOKEN) headers.Authorization = `Token ${TOKEN}`
    https.get(url, { headers, timeout: 20000 }, (res) => {
      let data = ''
      res.on('data', (c) => { data += c })
      res.on('end', () => {
        try {
          const j = JSON.parse(data)
          resolve({ status: res.statusCode, count: typeof j.count === 'number' ? j.count : null, detail: j.detail })
        } catch (e) {
          resolve({ status: res.statusCode, count: null, raw: data.slice(0, 160) })
        }
      })
    }).on('error', (e) => resolve({ status: 0, count: null, err: e.message }))
  })
}

function yearParams(year) {
  return {
    net__gte: `${year}-01-01T00:00:00Z`,
    net__lt: `${year + 1}-01-01T00:00:00Z`
  }
}

async function main() {
  const year = Number(process.argv[2]) || 2025
  const yp = yearParams(year)
  console.log(`\n=== LL2 真值对账 year=${year} (UTC, net__gte=${yp.net__gte} net__lt=${yp.net__lt}) ===`)
  console.log(`Token: ${TOKEN ? '已配置' : '未配置(免费层 15 次/小时)'}\n`)

  let reqs = 0
  const ask = async (label, params) => {
    reqs += 1
    const r = await getCount(params)
    console.log(`[#${reqs}] ${label}: count=${r.count}` + (r.status !== 200 ? `  (status=${r.status}${r.detail ? ' ' + r.detail : ''})` : ''))
    await sleep(REQUEST_GAP_MS)
    return r.count
  }

  const total = await ask('总数(全部状态)', yp)
  const success = await ask('成功(status__ids=3)', { ...yp, status__ids: 3 })
  const failure = await ask('失败(status__ids=4)', { ...yp, status__ids: 4 })
  const partialFail = await ask('部分失败(status__ids=7)', { ...yp, status__ids: 7 })
  const failCombined = await ask('失败+部分失败(status__ids=4,7)', { ...yp, status__ids: '4,7' })

  const usa = await ask('国家=美国(pad country US)', { ...yp, pad__location__country__alpha_2_code: 'US' })
  const cn = await ask('国家=中国(pad country CN)', { ...yp, pad__location__country__alpha_2_code: 'CN' })
  const spacex = await ask('运营商=SpaceX(lsp__name)', { ...yp, lsp__name: 'SpaceX' })

  console.log('\n--- 汇总(真值基准) ---')
  console.log(JSON.stringify({
    year,
    total,
    success,
    failure,
    partialFail,
    failCombined,
    successPlusFailCombined: (success != null && failCombined != null) ? success + failCombined : null,
    byCountry: { US: usa, CN: cn },
    byProvider: { SpaceX: spacex }
  }, null, 2))
  console.log(`\n总请求数: ${reqs}（限流额度 15/小时/IP）`)
  if (total != null && success != null && failCombined != null) {
    const accounted = success + failCombined
    console.log(`\n口径校验: success(${success}) + fail+partial(${failCombined}) = ${accounted}，total=${total}，差额(进行中/未分类)=${total - accounted}`)
  }
}

main().catch((e) => { console.error('FATAL', e); process.exit(1) })
