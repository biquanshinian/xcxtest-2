/**
 * 只读探测：云函数 / space_devs_cache / public API 是否可用。
 * 用法：node scripts/_tmp_probe_space_devs_cache_health.js
 */
const https = require('https')

const CLOUD_ENV = 'cloud1-9gdqgdt5bfaa20fb'
const PUBLIC_GATEWAY =
  `https://${CLOUD_ENV}-1397421562.ap-shanghai.app.tcloudbase.com/public`
const PUBLIC_V1 = 'https://api.marsx.com.cn/public/v1'

function postJson(url, body, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const data = JSON.stringify(body)
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data)
        },
        timeout: timeoutMs
      },
      (res) => {
        let raw = ''
        res.on('data', (c) => { raw += c })
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(raw) })
          } catch (e) {
            reject(new Error(`bad json status=${res.statusCode}: ${raw.slice(0, 200)}`))
          }
        })
      }
    )
    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('timeout'))
    })
    req.write(data)
    req.end()
  })
}

function getJson(url, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: timeoutMs }, (res) => {
      let raw = ''
      res.on('data', (c) => { raw += c })
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(raw) })
        } catch (e) {
          reject(new Error(`bad json status=${res.statusCode}: ${raw.slice(0, 200)}`))
        }
      })
    })
    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('timeout'))
    })
  })
}

async function main() {
  const report = {
    cloudEnv: CLOUD_ENV,
    pingGateway: null,
    pingCustom: null,
    launchesGateway: null,
    launchesPublicV1: null,
    verdict: ''
  }

  try {
    const r = await postJson(PUBLIC_GATEWAY, { path: '/ping', method: 'GET', query: {} })
    report.pingGateway = { ok: r.body && r.body.code === 0, body: r.body }
  } catch (e) {
    report.pingGateway = { ok: false, error: String(e.message || e) }
  }

  try {
    const r = await getJson(`${PUBLIC_V1}/ping`)
    report.pingCustom = { ok: r.body && r.body.code === 0, body: r.body }
  } catch (e) {
    report.pingCustom = { ok: false, error: String(e.message || e) }
  }

  try {
    const r = await postJson(PUBLIC_GATEWAY, {
      path: '/launches/upcoming',
      method: 'GET',
      query: { limit: '3' }
    })
    const d = r.body && r.body.data
    report.launchesGateway = {
      ok: !!(r.body && r.body.code === 0 && d && Array.isArray(d.results) && d.results.length),
      count: d && d.count,
      sample: d && d.results && d.results[0] && d.results[0].name
    }
  } catch (e) {
    report.launchesGateway = { ok: false, error: String(e.message || e) }
  }

  try {
    const r = await getJson(`${PUBLIC_V1}/launches/upcoming?limit=3`)
    const d = r.body && r.body.data
    report.launchesPublicV1 = {
      ok: !!(r.body && r.body.code === 0 && d && Array.isArray(d.results) && d.results.length),
      count: d && d.count,
      sample: d && d.results && d.results[0] && d.results[0].name
    }
  } catch (e) {
    report.launchesPublicV1 = { ok: false, error: String(e.message || e) }
  }

  const serverOk =
    report.pingGateway && report.pingGateway.ok &&
    report.launchesGateway && report.launchesGateway.ok

  report.verdict = serverOk
    ? 'SERVER_OK: 云函数与 space_devs_cache 可读。若小程序仍「数据暂不可用」，根因在客户端 database SDK/本地缓存，非库空或 sync 全挂。'
    : 'SERVER_DEGRADED: 服务端探测失败，需查云开发控制台配额/函数部署/网关。'

  console.log(JSON.stringify(report, null, 2))
  process.exit(serverOk ? 0 : 2)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
