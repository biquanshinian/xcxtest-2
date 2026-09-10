/**
 * 导入光谱号 10 图贴图，写入小红书变体，删除旧 4:3 草稿
 * node scripts/_tmp_replace_spectrum_draft.js
 */
const { spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const http = require('http')
const https = require('https')

const ROOT = path.resolve(__dirname, '..')
const OLD_ID = '2612439e6a9d0d3f020eedd50b0939c9'

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
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const lib = u.protocol === 'https:' ? https : http
    const payload = Buffer.from(JSON.stringify(body))
    const req = lib.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': payload.length,
          Authorization: 'Bearer ' + token
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

async function main() {
  const env = loadEnv(path.join(ROOT, '.cursor', 'oa-admin.local.env'))
  const token = env.OA_ADMIN_TOKEN
  const base = String(env.ADMIN_API_BASE || '').replace(/\/$/, '')
  if (!token || !base) throw new Error('MISSING_TOKEN')

  const r = spawnSync(
    process.execPath,
    [
      '.cursor/skills/oa-update-log/scripts/import-to-drafts.js',
      'docs/wechat-oa/hot-2026-09-06-spectrum',
      '--brand',
      'mars_space',
      '--newspic'
    ],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }
  )
  process.stdout.write(r.stdout || '')
  process.stderr.write(r.stderr || '')
  if (r.status) throw new Error('import failed')

  const m = String(r.stdout || '').match(/_id:\s*'([^']+)'/)
  const id = m ? m[1] : ''
  if (!id) throw new Error('no new id')
  console.log('NEW_ID', id)

  const get = await requestJson(base, {
    token,
    body: {
      path: '/oa-content/drafts/' + id,
      method: 'GET',
      query: {},
      body: {},
      headers: { Authorization: 'Bearer ' + token }
    }
  })
  const draft = get.data || get
  const images = []
    .concat(draft.imageUrls || [])
    .filter((u) => /^https?:\/\//i.test(u))
    .slice(0, 20)
  console.log('images', images.length)

  const bodyText = [
    '光谱号第二次飞，公开报道说入轨了👇',
    '',
    '北京时间 9 月 6 日凌晨 4:12（当地 9 月 5 日 22:12），德国伊萨尔的光谱号从挪威安岛升起。',
    '公司稿写的是：第二次飞行，把立方星送进轨道，并称这是欧洲大陆商业火箭第一次入轨。',
    '卫星状态还在和客户核对。',
    '',
    '你可以这样看这场：',
    '>> 先看它是不是真的进了轨（第二次才做成）',
    '>> 再看带上去的立方星状态',
    '>> 入轨了，还不等于已经每周都能发',
    '',
    '我追这类任务，常用「火星探索日志」看倒计时、发射动态和相关通知。',
    '左滑 10 张图：从它是谁，到这场看什么，一次捋清。'
  ].join('\n')

  const put = await requestJson(base, {
    token,
    body: {
      path: '/oa-content/drafts/' + id,
      method: 'PUT',
      query: {},
      body: {
        platforms: ['wechat', 'xhs'],
        variants: {
          xhs: {
            title: '光谱号第二次飞，入轨了',
            body: bodyText,
            topics: ['光谱号', 'Spectrum', '伊萨尔', '商业航天', '火箭发射', '航天爱好者'],
            pinnedComment: '时间与入轨以公开报道 / 官方口径为准。',
            images,
            coverIndex: 0,
            status: 'ready'
          }
        }
      },
      headers: { Authorization: 'Bearer ' + token }
    }
  })
  if (put.code && put.code !== 0) {
    throw new Error('PUT xhs ' + (put.message || JSON.stringify(put)))
  }
  console.log('XHS_OK')

  if (OLD_ID && OLD_ID !== id) {
    const del = await requestJson(base, {
      token,
      body: {
        path: '/oa-content/drafts/' + OLD_ID,
        method: 'DELETE',
        query: {},
        body: {},
        headers: { Authorization: 'Bearer ' + token }
      }
    })
    console.log('DEL_OLD', del.code || 0, del.message || 'ok')
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
