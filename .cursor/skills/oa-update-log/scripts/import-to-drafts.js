/**
 * 将 docs/wechat-oa/.../article.md 成品导入后台草稿箱（不洗稿）。
 *
 * 用法：
 *   node .cursor/skills/oa-update-log/scripts/import-to-drafts.js [文章目录或 article.md]
 *   [--brand mars_space|mars_log] [--newspic] [--dry] [--batch]
 * 文首 YAML 也可写 type: newspic / brand: mars_space
 *
 * 鉴权（任选其一）：
 *   - 环境变量 OA_ADMIN_TOKEN / ADMIN_TOKEN
 *   - 文件 .cursor/oa-admin.local.env（勿提交）含 OA_ADMIN_TOKEN=
 *   - 同文件可写 ADMIN_API_BASE=
 *   - 若无 token：可用 scripts/ops-admin-login.js 自动登录写入（需 OA_ADMIN_PASS）
 *
 * 行为：本地配图 → COS proxy-upload → POST /oa-content/drafts/import
 */
const fs = require('fs')
const path = require('path')
const http = require('http')
const https = require('https')
const { markdownToDigest } = require(path.resolve(
  __dirname,
  '../../../../cloudfunctions/adminGateway/oaStudioHelpers'
))

const ROOT = path.resolve(__dirname, '../../../..')
const DEFAULT_API =
  'https://cloud1-9gdqgdt5bfaa20fb-1397421562.ap-shanghai.app.tcloudbase.com/admin'

function loadEnvFile(file) {
  const out = {}
  if (!fs.existsSync(file)) return out
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (!m) continue
    out[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
  }
  return out
}

function resolveAuth() {
  const local = loadEnvFile(path.join(ROOT, '.cursor', 'oa-admin.local.env'))
  const replay = loadEnvFile(path.join(ROOT, 'workers', 'replay-fetcher', '.env'))
  const token =
    process.env.OA_ADMIN_TOKEN ||
    process.env.ADMIN_TOKEN ||
    local.OA_ADMIN_TOKEN ||
    local.ADMIN_TOKEN ||
    ''
  const base = (
    process.env.ADMIN_API_BASE ||
    local.ADMIN_API_BASE ||
    replay.REPLAY_ADMIN_API_BASE ||
    DEFAULT_API
  ).replace(/\/$/, '')
  return { token, base }
}

function requestJson(url, { method = 'POST', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const lib = u.protocol === 'https:' ? https : http
    const payload = body == null ? null : Buffer.from(JSON.stringify(body))
    const req = lib.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': payload.length } : {}),
          ...headers
        }
      },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          let json = null
          try {
            json = JSON.parse(text)
          } catch (e) {
            return reject(new Error(`非 JSON HTTP ${res.statusCode}: ${text.slice(0, 200)}`))
          }
          resolve({ status: res.statusCode, json })
        })
      }
    )
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

function callAdmin(base, token, apiPath, body, method = 'POST') {
  return requestJson(base, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: {
      path: apiPath,
      method,
      query: {},
      body: body || {},
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    }
  })
}

function parseFrontmatter(markdown) {
  const s = String(markdown || '').replace(/^\uFEFF/, '')
  const m = s.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!m) return { meta: {}, body: s }
  const meta = {}
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z][\w-]*)\s*:\s*(.*?)\s*$/)
    if (!kv) continue
    meta[kv[1]] = kv[2].replace(/^['"]|['"]$/g, '')
  }
  return { meta, body: m[2] }
}

function normalizeImportBrand(v) {
  const s = String(v || '')
    .trim()
    .toLowerCase()
    .replace(/-/g, '_')
  if (s === 'mars_space' || s === 'space' || s === '火星空间探索') return 'mars_space'
  if (s === 'mars_log' || s === 'log' || s === '火星探索日志') return 'mars_log'
  return ''
}

function inferBrandFromDir(dir) {
  const base = path.basename(dir || '')
  if (/^hot-/i.test(base)) return 'mars_space'
  return ''
}

function captionFromMarkdown(markdown) {
  let s = String(markdown || '')
    .replace(/^\uFEFF/, '')
    .trim()
  s = s.replace(/^#\s+[^\n]+\n+/, '')
  s = s.replace(/!\[[^\]]*\]\([^)]+\)/g, ' ')
  return s
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

function resolveImportMeta(dir, meta, brandOpt, typeOpt) {
  const brandKey =
    normalizeImportBrand(brandOpt) ||
    normalizeImportBrand(meta.brand || meta.brandKey) ||
    normalizeImportBrand(process.env.OA_BRAND_KEY) ||
    inferBrandFromDir(dir) ||
    'mars_log'
  const wxArticleType =
    normalizeImportType(typeOpt) ||
    normalizeImportType(meta.type || meta.wxArticleType) ||
    'news'
  return { brandKey, wxArticleType }
}

function assertExclusiveCover(dirName, markdown, files) {
  const hasCoverFile = (files || []).some((f) => /^cover/i.test(f.name))
  const mdHasCover = /!\[[^\]]*\]\([^)]*cover[^)]*\)/i.test(markdown)
  if (!hasCoverFile && !mdHasCover) {
    throw new Error(`缺专属封面（禁止默认封面）: ${dirName} 需 cover*.jpg 且文首引用`)
  }
}

function titleFromMarkdown(markdown, wxArticleType) {
  const m = String(markdown || '')
    .replace(/^\uFEFF/, '')
    .trim()
    .match(/^#\s+(.+?)\s*$/m)
  const max = wxArticleType === 'newspic' ? 32 : 64
  return m ? m[1].trim().slice(0, max) : ''
}

function normalizeImportType(v) {
  const s = String(v || '')
    .trim()
    .toLowerCase()
  if (
    s === 'newspic' ||
    s === 'pic' ||
    s === 'image' ||
    s === '贴图' ||
    s === '图片消息' ||
    s === '图片帖'
  ) {
    return 'newspic'
  }
  if (s === 'news' || s === 'article' || s === '图文') return 'news'
  return ''
}

function resolveArticleDir(arg) {
  const raw = arg || path.join(ROOT, 'docs', 'wechat-oa')
  let p = path.isAbsolute(raw) ? raw : path.join(ROOT, raw)
  if (fs.existsSync(p) && fs.statSync(p).isFile()) {
    return path.dirname(p)
  }
  if (fs.existsSync(path.join(p, 'article.md'))) return p
  // 取 wechat-oa 下最新含 article.md 的子目录
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
    const kids = fs
      .readdirSync(p)
      .map((n) => path.join(p, n))
      .filter((d) => fs.existsSync(path.join(d, 'article.md')))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
    if (kids[0]) return kids[0]
  }
  throw new Error(`找不到 article.md：${raw}`)
}

function contentTypeOf(file) {
  const e = path.extname(file).toLowerCase()
  if (e === '.png') return 'image/png'
  if (e === '.webp') return 'image/webp'
  if (e === '.gif') return 'image/gif'
  return 'image/jpeg'
}

function collectLocalImages(dir, markdown) {
  const names = new Set()
  const re = /!\[[^\]]*\]\(([^)]+)\)/g
  let m
  while ((m = re.exec(markdown))) {
    const src = String(m[1] || '')
      .trim()
      .replace(/^<|>$/g, '')
      .split(/\s+/)[0]
    if (!src || /^https?:\/\//i.test(src)) continue
    names.add(path.basename(src))
  }
  // 同目录常见配图也扫一遍
  for (const f of fs.readdirSync(dir)) {
    if (/\.(jpe?g|png|webp|gif)$/i.test(f)) names.add(f)
  }
  const files = []
  for (const name of names) {
    const full = path.join(dir, name)
    if (fs.existsSync(full) && fs.statSync(full).isFile()) {
      files.push({ name, full })
    }
  }
  return files
}

function putBinary(url, buf, contentType) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const lib = u.protocol === 'https:' ? https : http
    const req = lib.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        method: 'PUT',
        headers: {
          'Content-Type': contentType,
          'Content-Length': buf.length
        }
      },
      (res) => {
        res.resume()
        if (res.statusCode >= 200 && res.statusCode < 300) resolve()
        else reject(new Error(`COS PUT HTTP ${res.statusCode}`))
      }
    )
    req.on('error', reject)
    req.write(buf)
    req.end()
  })
}

async function uploadLocal(base, token, dirName, file) {
  const buf = fs.readFileSync(file.full)
  if (buf.length > 12 * 1024 * 1024) {
    throw new Error(`图过大(>12MB): ${file.name}`)
  }
  const key = `oa-update-log/${dirName}/${Date.now()}-${file.name}`.replace(/\s+/g, '_')
  const ct = contentTypeOf(file.name)
  // 直传：presign + PUT，避免云函数 EXCEED_MAX_PAYLOAD_SIZE
  const res = await callAdmin(base, token, '/cos/presign', { key })
  const j = res.json || {}
  const data = j.data || j
  if (j.code && j.code !== 0) {
    throw new Error(j.message || `presign 失败 ${file.name}`)
  }
  const uploadUrl = data.uploadUrl
  const cosUrl = data.cosUrl || data.url
  if (!uploadUrl || !cosUrl) throw new Error(`presign 无 URL: ${file.name}`)
  await putBinary(uploadUrl, buf, ct)
  return cosUrl
}

async function importOneDir(dir, { dry, token, base, brandKey: brandOpt, wxArticleType: typeOpt }) {
  const mdPath = path.join(dir, 'article.md')
  if (!fs.existsSync(mdPath)) throw new Error(`无 article.md: ${dir}`)
  const rawMd = fs.readFileSync(mdPath, 'utf8')
  const { meta, body: markdown } = parseFrontmatter(rawMd)
  const dirName = path.basename(dir)
  const files = collectLocalImages(dir, markdown)

  const { brandKey, wxArticleType } = resolveImportMeta(dir, meta, brandOpt, typeOpt)
  const mdTitle = titleFromMarkdown(markdown, wxArticleType)

  console.log('article', mdPath)
  console.log('images', files.map((f) => f.name).join(', ') || '(none)')
  console.log('meta', { brandKey, wxArticleType, title: mdTitle })

  assertExclusiveCover(dirName, markdown, files)

  if (dry) {
    console.log('DRY OK', dirName)
    return { dry: true, dir: dirName, brandKey, wxArticleType, title: mdTitle }
  }

  const imageMap = {}
  const imageUrls = []

  for (const f of files) {
    process.stderr.write(`upload ${f.name}…\n`)
    const url = await uploadLocal(base, token, dirName, f)
    imageMap[f.name] = url
    imageMap[`./${f.name}`] = url
    imageUrls.push(url)
    console.log('  →', url.slice(0, 80) + (url.length > 80 ? '…' : ''))
  }

  const coverUrl =
    imageMap['cover-火星探索日志更新.jpg'] ||
    Object.entries(imageMap).find(([k]) => /^cover/i.test(path.basename(k)))?.[1] ||
    imageUrls[0] ||
    ''

  const themeId = process.env.OA_THEME_ID || 'bytedance'
  const authorByBrand = {
    mars_log: '火星探索日志',
    mars_space: '火星空间探索'
  }
  const author =
    process.env.OA_AUTHOR || authorByBrand[brandKey] || '火星探索日志'
  // 显式传 digest，避免云端旧逻辑把 ![封面](url) 变成「封面https://…」
  const digest = markdownToDigest(markdown)
  const wxPicContent =
    wxArticleType === 'newspic' ? captionFromMarkdown(markdown) : undefined
  const res = await callAdmin(base, token, '/oa-content/drafts/import', {
    title: mdTitle || undefined,
    markdown,
    themeId,
    coverUrl: coverUrl || undefined,
    imageUrls,
    imageMap,
    digest: digest || undefined,
    brandKey,
    author,
    wxArticleType,
    wxPicContent,
    miniprogramPath: 'pages/index/index'
  })
  const j = res.json || {}
  if (j.code && j.code !== 0) {
    throw new Error(j.message || `IMPORT_FAIL ${dirName}`)
  }
  const data = j.data || j
  console.log('IMPORT_OK', {
    _id: data._id || data.id,
    title: data.title,
    themeId: data.themeId || themeId,
    brandKey,
    wxArticleType,
    images: imageUrls.length
  })
  return data
}

function listBatchDirs(rootDir) {
  if (!fs.existsSync(rootDir) || !fs.statSync(rootDir).isDirectory()) return []
  return fs
    .readdirSync(rootDir)
    .map((n) => path.join(rootDir, n))
    .filter((d) => fs.existsSync(path.join(d, 'article.md')))
    .sort((a, b) => path.basename(a).localeCompare(path.basename(b), 'en'))
}

function parseCli(argv) {
  const rest = []
  const out = { dry: false, batch: false, newspic: false, brand: '', path: '' }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dry') out.dry = true
    else if (a === '--batch') out.batch = true
    else if (a === '--newspic') out.newspic = true
    else if (a === '--brand') {
      const next = argv[i + 1]
      if (next && !String(next).startsWith('--')) {
        out.brand = String(next)
        i += 1
      }
    } else if (!a.startsWith('--')) rest.push(a)
  }
  out.path = rest[0] || ''
  return out
}

async function main() {
  const cli = parseCli(process.argv.slice(2))
  const arg = cli.path
  const dry = cli.dry
  const batch = cli.batch
  const typeOpt = cli.newspic ? 'newspic' : ''
  const brandOpt = cli.brand

  if (batch) {
    const root = path.isAbsolute(arg || '')
      ? arg
      : path.join(ROOT, arg || path.join('docs', 'wechat-oa'))
    const dirs = listBatchDirs(root)
    if (!dirs.length) throw new Error(`批量目录下没有含 article.md 的子夹: ${root}`)
    console.log('batch', dirs.length, 'dirs under', root)

    let token = ''
    let base = ''
    if (!dry) {
      ;({ token, base } = resolveAuth())
      if (!token) {
        console.error('MISSING_TOKEN')
        process.exit(2)
      }
    }

    let ok = 0
    const fails = []
    for (const d of dirs) {
      try {
        await importOneDir(d, { dry, token, base, brandKey: brandOpt, wxArticleType: typeOpt })
        ok += 1
      } catch (e) {
        console.error('FAIL', path.basename(d), e.message || e)
        fails.push({ dir: path.basename(d), error: String(e.message || e) })
      }
    }
    console.log('BATCH_DONE', { ok, fail: fails.length, fails })
    process.exit(fails.length ? 1 : 0)
  }

  const dir = resolveArticleDir(arg)
  if (dry) {
    await importOneDir(dir, {
      dry: true,
      token: '',
      base: '',
      brandKey: brandOpt,
      wxArticleType: typeOpt
    })
    process.exit(0)
  }
  const { token, base } = resolveAuth()
  if (!token) {
    console.error(
      [
        'MISSING_TOKEN',
        '请先配置管理员 JWT：',
        '  1) 浏览器打开后台，登录后 DevTools → Application → Local Storage → admin_token',
        '  2) 写入 .cursor/oa-admin.local.env ：',
        '       OA_ADMIN_TOKEN=<粘贴>',
        '       ADMIN_API_BASE=https://cloud1-9gdqgdt5bfaa20fb-1397421562.ap-shanghai.app.tcloudbase.com/admin',
        '然后重跑本脚本。'
      ].join('\n')
    )
    process.exit(2)
  }
  await importOneDir(dir, {
    dry: false,
    token,
    base,
    brandKey: brandOpt,
    wxArticleType: typeOpt
  })
}

if (require.main === module) {
  main().catch((e) => {
    console.error('ERR', e.message || e)
    process.exit(1)
  })
} else {
  module.exports = {
    parseFrontmatter,
    normalizeImportBrand,
    normalizeImportType,
    inferBrandFromDir,
    captionFromMarkdown,
    resolveImportMeta,
    titleFromMarkdown,
    parseCli
  }
}
