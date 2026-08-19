/**
 * 导入朱雀三号两套小红书科普（各 6 图）到后台草稿，并写入 variants.xhs
 * node scripts/_tmp_import_zq3_xhs_drafts.js
 */
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const importScript = path.join(ROOT, '.cursor/skills/oa-update-log/scripts/import-to-drafts.js')

function loadEnv(file) {
  const out = {}
  if (!fs.existsSync(file)) return out
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (!m) continue
    out[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
  }
  return out
}

function requestJson(url, { token, body }) {
  const http = require('http')
  const https = require('https')
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const lib = u.protocol === 'https:' ? https : http
    const payload = Buffer.from(JSON.stringify(body))
    const req = lib.request(
      {
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': payload.length,
          Authorization: `Bearer ${token}`
        }
      },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
          } catch (e) {
            reject(new Error('bad json'))
          }
        })
      }
    )
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

const PACKS = [
  {
    abs: path.join(ROOT, 'docs/xhs-zq3-y2-2026-08'),
    xhsTitle: '朱雀三号遥二·六图科普',
    xhsBody: [
      '朱雀三号遥二窗口临近，先把关键点说清楚👇',
      '',
      '这不是普通「打上去就行」的任务。',
      '朱雀三号是蓝箭航天的不锈钢液氧甲烷火箭，方向是可重复使用——',
      '遥二重点，会再次挑战：一级飞到预定回收场，做陆上垂直软着陆。',
      '',
      '你可以这样理解本场：',
      '>> 先看能不能按计划起飞、完成飞行任务',
      '>> 再看一级回不回得来（这是大家最关注的）',
      '>> 成功/不成功都是工程验证的一部分，别只当热闹看完',
      '',
      '公开航警信息显示：窗口大约在 8 月 19 日清晨（约 7:27–8:04），酒泉东风商业航天方向。',
      '气象、箭上状态都可能影响实际点火，以官方最终通知为准。',
      '',
      '我追这类任务，常用「火星探索日志」看倒计时、发射动态和相关通知。',
      '左滑 6 张图：从「它是什么」到「这场看什么」一次捋清。',
      '',
      '你们最想看到哪一步成功？评论区聊聊～'
    ].join('\n'),
    topics: ['朱雀三号', '蓝箭航天', '商业航天', '可回收火箭', '航天爱好者', '太空干货'],
    pinned: '窗口以官方最终公告为准；外形按公开配置图还原。'
  },
  {
    abs: path.join(ROOT, 'docs/xhs-zq3-y2-2026-08-detail'),
    xhsTitle: '朱雀三号细讲·六图干货',
    xhsBody: [
      '上篇把窗口和看点说了，这篇细一点👇',
      '',
      '朱雀三号（ZQ-3）是蓝箭航天的不锈钢液氧甲烷火箭，方向是可重复使用。',
      '要真正看懂它，建议记住这几块：',
      '',
      '>> 结构：白头罩 + 银箭身，标识很认脸',
      '>> 动力：液氧甲烷，尾焰气质和煤油箭不一样',
      '>> 回收：栅格舵转向 + 着陆腿撑地，一级想「站回来」',
      '',
      '遥二重点仍是挑战一级陆上垂直软着陆。',
      '成与败都是工程数据——盯过程，比只喊口号有意思。',
      '',
      '公开航警窗口大约在 8 月 19 日清晨，酒泉东风商业航天方向；',
      '实际点火以官方最终公告为准。',
      '',
      '我用「火星探索日志」盯倒计时和任务动态。',
      '左滑 6 张：从外形拆解到回收件，一次补课。',
      '',
      '你最想先搞懂哪一块？评论区说～'
    ].join('\n'),
    topics: ['朱雀三号', '蓝箭航天', '液氧甲烷', '可回收火箭', '商业航天', '航天干货'],
    pinned: '细讲篇，与总览六图互补；点火以官方为准。'
  }
]

async function main() {
  const local = loadEnv(path.join(ROOT, '.cursor', 'oa-admin.local.env'))
  let token = local.OA_ADMIN_TOKEN
  const base = String(local.ADMIN_API_BASE || '').replace(/\/$/, '')
  if (!token) {
    spawnSync(process.execPath, [path.join(ROOT, 'scripts/ops-admin-login.js')], {
      cwd: ROOT,
      stdio: 'inherit'
    })
    token = loadEnv(path.join(ROOT, '.cursor', 'oa-admin.local.env')).OA_ADMIN_TOKEN
  }
  if (!token || !base) throw new Error('MISSING_TOKEN')

  const results = []
  for (const pack of PACKS) {
    console.log('\n=== import', path.basename(pack.abs), '===')
    const r = spawnSync(process.execPath, [importScript, pack.abs], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024
    })
    process.stdout.write(r.stdout || '')
    if (r.stderr) process.stderr.write(r.stderr)
    if (r.status) throw new Error('import failed: ' + pack.abs)

    const m = String(r.stdout || '').match(/IMPORT_OK\s*(\{[\s\S]*?\n\})/)
    let id = ''
    if (m) {
      try {
        id = JSON.parse(m[1].replace(/'/g, '"').replace(/(\w+):/g, '"$1":').replace(/,(\s*[}\]])/g, '$1'))._id
      } catch (e) {
        /* fallback below */
      }
    }
    if (!id) {
      const m2 = String(r.stdout || '').match(/_id:\s*'([^']+)'/)
      id = m2 ? m2[1] : ''
    }
    if (!id) throw new Error('cannot parse draft id')

    // fetch draft for imageUrls order
    const get = await requestJson(base, {
      token,
      body: {
        path: `/oa-content/drafts/${id}`,
        method: 'GET',
        query: {},
        body: {},
        headers: { Authorization: `Bearer ${token}` }
      }
    })
    const draft = (get.data && get.data) || get.data || get
    const images = [].concat(draft.imageUrls || []).filter((u) => /^https?:\/\//i.test(u)).slice(0, 9)
    console.log('draft images', images.length, 'id', id)

    const put = await requestJson(base, {
      token,
      body: {
        path: `/oa-content/drafts/${id}`,
        method: 'PUT',
        query: {},
        body: {
          platforms: ['wechat', 'xhs'],
          variants: {
            xhs: {
              title: pack.xhsTitle.slice(0, 20),
              body: pack.xhsBody,
              topics: pack.topics,
              pinnedComment: pack.pinned,
              images,
              coverIndex: 0,
              status: 'ready'
            }
          }
        },
        headers: { Authorization: `Bearer ${token}` }
      }
    })
    if (put.code && put.code !== 0) {
      throw new Error('PUT xhs failed: ' + (put.message || JSON.stringify(put)))
    }
    results.push({ id, title: pack.xhsTitle, images: images.length })
    console.log('XHS_OK', results[results.length - 1])
  }

  console.log('\nALL_DONE', results)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
