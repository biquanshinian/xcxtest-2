/**
 * 微信服务号：access_token / 素材上传 / 草稿箱 / 发布
 * 凭证槽：
 *   1 → WECHAT_OA_APPID / WECHAT_OA_SECRET（火星探索日志）
 *   2 → WECHAT_OA_APPID_2 / WECHAT_OA_SECRET_2（火星空间探索）
 */
const https = require('https')
const http = require('http')
const net = require('net')
const dns = require('dns').promises
const { URL } = require('url')

/** @type {Record<string, { token: string, expireAt: number }>} */
const _tokenCacheBySlot = Object.create(null)
/** @type {Record<string, Promise<string>>} */
const _tokenInflightBySlot = Object.create(null)

const MAX_FETCH_BYTES = 5 * 1024 * 1024
const MAX_REDIRECTS = 3

function escapeAttr(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function escapeHtmlText(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function sanitizeMiniprogramPath(path) {
  let p = String(path || 'pages/index/index')
    .replace(/^\//, '')
    .trim()
  if (!p || p.includes('..') || !/^[a-zA-Z0-9_./-]+$/.test(p)) {
    p = 'pages/index/index'
  }
  return p.slice(0, 128)
}

function isBlockedIp(ip) {
  const v = String(ip || '')
    .replace(/^\[|\]$/g, '')
    .toLowerCase()
  if (!v) return true
  // IPv4-mapped IPv6 → 按内嵌 IPv4 再判
  const mapped = v.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/)
  if (mapped) return isBlockedIp(mapped[1])
  if (v === '::1' || v === '0.0.0.0' || v === '127.0.0.1') return true
  if (v === '169.254.169.254') return true
  if (v.startsWith('fe80:') || v.startsWith('fc') || v.startsWith('fd')) return true
  if (v.startsWith('10.') || v.startsWith('192.168.') || v.startsWith('169.254.')) return true
  const m = v.match(/^172\.(\d+)\./)
  if (m) {
    const n = Number(m[1])
    if (n >= 16 && n <= 31) return true
  }
  return false
}

async function assertSafeFetchUrl(fileUrl, redirectDepth = 0) {
  if (redirectDepth > MAX_REDIRECTS) throw new Error('图片下载重定向过多')
  let url
  try {
    url = new URL(String(fileUrl || ''))
  } catch (e) {
    throw new Error('非法图片 URL')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('仅允许 http/https 图片 URL')
  }
  const host = String(url.hostname || '').toLowerCase()
  if (
    !host ||
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host === 'metadata.google.internal' ||
    host === 'metadata'
  ) {
    throw new Error('禁止访问的图片主机')
  }
  if (net.isIP(host)) {
    if (isBlockedIp(host)) throw new Error('禁止访问内网/元数据地址')
  } else {
    const addrs = await dns.lookup(host, { all: true, verbatim: true }).catch(() => [])
    if (!addrs.length) throw new Error('图片主机解析失败')
    for (const a of addrs) {
      if (isBlockedIp(a.address)) throw new Error('禁止访问内网/元数据地址')
    }
  }
  return url
}

/**
 * 凭证槽配置化：槽 N（1–9）读 WECHAT_OA_APPID_N / WECHAT_OA_SECRET_N；
 * 槽 1 兼容旧的不带后缀 WECHAT_OA_APPID / WECHAT_OA_SECRET。
 */
function normalizeSlot(slot) {
  const s = String(slot == null || slot === '' ? '1' : slot).trim()
  return /^[1-9]$/.test(s) ? s : '1'
}

function resolveCredentials(slot) {
  const s = normalizeSlot(slot)
  const appidN = String(process.env[`WECHAT_OA_APPID_${s}`] || '').trim()
  const secretN = String(process.env[`WECHAT_OA_SECRET_${s}`] || '').trim()
  if (s === '1') {
    return {
      slot: '1',
      appid: appidN || String(process.env.WECHAT_OA_APPID || '').trim(),
      secret: secretN || String(process.env.WECHAT_OA_SECRET || '').trim()
    }
  }
  return { slot: s, appid: appidN, secret: secretN }
}

function getOaAppId(slot) {
  return resolveCredentials(slot).appid
}

function getOaSecret(slot) {
  return resolveCredentials(slot).secret
}

function getMiniAppId() {
  return String(
    process.env.WECHAT_OA_MINIPROGRAM_APPID ||
      process.env.WECHAT_MP_APPID ||
      process.env.APPID ||
      'wxf98b58309019771b'
  ).trim()
}

function credentialsReady(slot) {
  const c = resolveCredentials(slot)
  return !!(c.appid && c.secret)
}

/** 槽 1/2 恒返回（UI 兼容）；3–9 仅在配置了 appid 时列出 */
function credentialsStatus() {
  const out = {}
  for (let i = 1; i <= 9; i++) {
    const s = String(i)
    const appid = getOaAppId(s)
    if (i > 2 && !appid) continue
    out[s] = {
      ready: credentialsReady(s),
      appid: appid ? `${appid.slice(0, 6)}…` : ''
    }
  }
  return out
}

function httpJson(method, urlStr, bodyObj, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr)
    const lib = url.protocol === 'https:' ? https : http
    const raw = bodyObj == null ? null : Buffer.from(JSON.stringify(bodyObj), 'utf8')
    const req = lib.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        method,
        headers: {
          ...(raw
            ? { 'Content-Type': 'application/json', 'Content-Length': raw.length }
            : {}),
          ...headers
        },
        timeout: 30000
      },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          try {
            resolve(JSON.parse(text))
          } catch (e) {
            resolve({ raw: text, statusCode: res.statusCode })
          }
        })
      }
    )
    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('wechat api timeout'))
    })
    if (raw) req.write(raw)
    req.end()
  })
}

function httpUpload(urlStr, fieldName, filename, buffer, contentType) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr)
    const boundary = '----OaBoundary' + Date.now()
    const head =
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\n` +
      `Content-Type: ${contentType || 'application/octet-stream'}\r\n\r\n`
    const tail = `\r\n--${boundary}--\r\n`
    const body = Buffer.concat([
      Buffer.from(head, 'utf8'),
      Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer),
      Buffer.from(tail, 'utf8')
    ])
    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': body.length
        },
        timeout: 60000
      },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          try {
            resolve(JSON.parse(text))
          } catch (e) {
            resolve({ raw: text })
          }
        })
      }
    )
    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('upload timeout'))
    })
    req.write(body)
    req.end()
  })
}

function imageUrlCandidates(fileUrl) {
  let u = String(fileUrl || '')
    .trim()
    .replace(/&amp;/g, '&')
  if (!u) return []
  const out = []
  const push = (x) => {
    const s = String(x || '').trim()
    if (s && !out.includes(s)) out.push(s)
  }
  // Cloudflare 拦原站图床（NSF 等）：优先走 Photon / wsrv，避免先打一串 403
  for (const m of cfBypassImageMirrors(u)) push(m)
  push(u)
  if (u.startsWith('http://')) push('https://' + u.slice(7))
  // 微信图床常见尺寸变体
  if (/qpic\.cn|qlogo\.cn/i.test(u)) {
    push(u.replace(/\/(?:0|64|132|146|352|640|960)(\?|$)/, '/0$1'))
    push(u.replace(/\/(?:0|64|132|146|352|640|960)(\?|$)/, '/640$1'))
    push(u.replace(/\/(?:0|64|132|146|352|640|960)(\?|$)/, '/1000$1'))
  }
  return out
}

/**
 * 原站被 Cloudflare 拦图时的镜像候选。
 * WordPress Photon (i0.wp.com) 实测可拉通 nasaspaceflight.com 配图；
 * format=jpg 避免 Photon 默认 WebP（微信 uploadimg 不稳）。
 */
function cfBypassImageMirrors(fileUrl) {
  try {
    const parsed = new URL(String(fileUrl || '').trim())
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase()
    if (host !== 'nasaspaceflight.com' && !host.endsWith('.nasaspaceflight.com')) return []
    const pathOnly = parsed.pathname
    const hostFull = parsed.hostname
    return [
      `https://i0.wp.com/${hostFull}${pathOnly}?ssl=1&format=jpg`,
      `https://i1.wp.com/${hostFull}${pathOnly}?ssl=1&format=jpg`,
      `https://wsrv.nl/?url=${encodeURIComponent(parsed.toString())}&output=jpg`
    ]
  } catch (e) {
    return []
  }
}

/** 入库/展示用：NSF 等站直接改写为 Photon，浏览器可预览 */
function hotlinkSafeImageUrl(fileUrl) {
  const mirrors = cfBypassImageMirrors(fileUrl)
  return mirrors[0] || String(fileUrl || '').trim()
}

function sniffImageExt(buf, urlHint) {
  if (buf && buf.length >= 4) {
    if (buf[0] === 0xff && buf[1] === 0xd8) return 'jpg'
    if (buf[0] === 0x89 && buf[1] === 0x50) return 'png'
    if (buf[0] === 0x47 && buf[1] === 0x49) return 'gif'
    if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
      return 'jpg' // 微信 uploadimg 对 webp 不稳，按 jpeg 扩展名尝试（多数仍拒）
    }
  }
  const lower = String(urlHint || '').toLowerCase()
  if (lower.includes('.png') || /wx_fmt=png/i.test(lower)) return 'png'
  if (lower.includes('.gif') || /wx_fmt=gif/i.test(lower)) return 'gif'
  return 'jpg'
}

function buildFetchHeaderProfiles(url) {
  const isWxPic = /qpic\.cn|qlogo\.cn|mp\.weixin\.qq\.com/i.test(url.hostname)
  const isPhoton = /i[0-3]\.wp\.com/i.test(url.hostname)
  const ua =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  // Photon 见 Accept:webp 会回 WebP；微信转存要 JPEG/PNG
  const accept = isPhoton
    ? 'image/jpeg,image/png,image/gif,*/*;q=0.8'
    : 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8'
  const base = {
    'User-Agent': ua,
    Accept: accept,
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
  }
  const profiles = []
  if (isWxPic) {
    profiles.push({ ...base, Referer: 'https://mp.weixin.qq.com/' })
    profiles.push({ ...base, Referer: 'https://weixin.qq.com/' })
    profiles.push({ ...base }) // 无 Referer
  } else if (isPhoton) {
    profiles.push({ ...base, Referer: 'https://i0.wp.com/' })
    profiles.push({ ...base })
  } else {
    profiles.push({ ...base, Referer: `${url.protocol}//${url.hostname}/` })
    profiles.push({ ...base, Referer: url.origin + '/' })
    profiles.push({ ...base })
  }
  return profiles
}

async function fetchBufferOnce(fileUrl, redirectDepth = 0, headerProfile = null) {
  const url = await assertSafeFetchUrl(fileUrl, redirectDepth)
  const headers = headerProfile || buildFetchHeaderProfiles(url)[0]
  return new Promise((resolve, reject) => {
    const lib = url.protocol === 'https:' ? https : http
    const req = lib.get(
      url,
      {
        timeout: 25000,
        headers
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const next = new URL(res.headers.location, url).toString()
          fetchBufferOnce(next, redirectDepth + 1, headerProfile).then(resolve, reject)
          return
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          res.resume()
          reject(new Error(`图片下载失败 HTTP ${res.statusCode}`))
          return
        }
        const len = Number(res.headers['content-length'] || 0)
        if (len > MAX_FETCH_BYTES) {
          res.resume()
          reject(new Error('图片过大'))
          return
        }
        const chunks = []
        let total = 0
        res.on('data', (c) => {
          total += c.length
          if (total > MAX_FETCH_BYTES) {
            req.destroy()
            reject(new Error('图片过大'))
            return
          }
          chunks.push(c)
        })
        res.on('end', () => {
          const buf = Buffer.concat(chunks)
          if (!buf.length) {
            reject(new Error('图片为空'))
            return
          }
          // 微信防盗链占位图很小且多为 PNG 提示图，当作失败
          if (buf.length < 2500 && isLikelyHotlinkPlaceholder(buf)) {
            reject(new Error('图片下载失败 HTTP 403（防盗链占位图）'))
            return
          }
          resolve(buf)
        })
      }
    )
    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('download timeout'))
    })
  })
}

function isLikelyHotlinkPlaceholder(buf) {
  // 微信「未经允许不可引用」占位图特征：小体积 PNG
  if (!buf || buf.length < 8) return true
  const isPng = buf[0] === 0x89 && buf[1] === 0x50
  return isPng && buf.length < 8000
}

/** 多候选 URL + 多组请求头重试，绕过部分防盗链 */
async function fetchBuffer(fileUrl) {
  const candidates = imageUrlCandidates(fileUrl)
  let lastErr = null
  for (const cand of candidates) {
    let profiles = [{ Referer: 'https://mp.weixin.qq.com/' }]
    try {
      const u = await assertSafeFetchUrl(cand, 0)
      profiles = buildFetchHeaderProfiles(u)
    } catch (e) {
      lastErr = e
      continue
    }
    for (const headers of profiles) {
      try {
        return await fetchBufferOnce(cand, 0, headers)
      } catch (e) {
        lastErr = e
      }
    }
  }
  throw lastErr || new Error('图片下载失败')
}

function isTokenInvalidRes(res) {
  const code = Number(res && res.errcode)
  return code === 40001 || code === 42001
}

/**
 * @param {boolean|object} forceOrOpts
 * @param {string} [maybeSlot]
 */
async function getAccessToken(forceOrOpts, maybeSlot) {
  let force = false
  let slot = '1'
  if (forceOrOpts && typeof forceOrOpts === 'object') {
    force = !!forceOrOpts.force
    slot = normalizeSlot(forceOrOpts.credentialSlot || forceOrOpts.slot || '1')
  } else {
    force = !!forceOrOpts
    slot = normalizeSlot(maybeSlot || '1')
  }
  const nowMs = Date.now()
  const cached = _tokenCacheBySlot[slot]
  if (!force && cached && cached.token && cached.expireAt > nowMs + 60 * 1000) {
    return cached.token
  }
  if (!force && _tokenInflightBySlot[slot]) {
    return _tokenInflightBySlot[slot]
  }

  const fetchPromise = (async () => {
    const { appid, secret } = resolveCredentials(slot)
    if (!appid || !secret) {
      throw new Error(
        slot === '1'
          ? '未配置 WECHAT_OA_APPID / WECHAT_OA_SECRET（发稿号凭证槽 1）'
          : `未配置 WECHAT_OA_APPID_${slot} / WECHAT_OA_SECRET_${slot}（发稿号凭证槽 ${slot}）`
      )
    }

    // 官方推荐 stable_token：多端/多云函数共用同一 AppID 时不会互相顶掉
    try {
      const stable = await httpJson('POST', 'https://api.weixin.qq.com/cgi-bin/stable_token', {
        grant_type: 'client_credential',
        appid,
        secret,
        force_refresh: !!force
      })
      if (stable && stable.access_token) {
        const ttlSec = Math.max(60, (Number(stable.expires_in) || 7200) - 300)
        _tokenCacheBySlot[slot] = {
          token: stable.access_token,
          expireAt: Date.now() + ttlSec * 1000
        }
        return _tokenCacheBySlot[slot].token
      }
      console.warn('[oaWechatApi] stable_token 异常，回落 cgi-bin/token', JSON.stringify(stable))
    } catch (e) {
      console.warn('[oaWechatApi] stable_token 失败，回落 cgi-bin/token', e.message || e)
    }

    const data = await httpJson(
      'GET',
      `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(
        appid
      )}&secret=${encodeURIComponent(secret)}`
    )
    if (!data || !data.access_token) {
      throw new Error(`获取服务号 access_token 失败(槽${slot}): ` + JSON.stringify(data))
    }
    const ttlSec = Math.max(60, (Number(data.expires_in) || 7200) - 300)
    _tokenCacheBySlot[slot] = {
      token: data.access_token,
      expireAt: Date.now() + ttlSec * 1000
    }
    return _tokenCacheBySlot[slot].token
  })()

  if (!force) _tokenInflightBySlot[slot] = fetchPromise
  try {
    return await fetchPromise
  } finally {
    if (_tokenInflightBySlot[slot] === fetchPromise) delete _tokenInflightBySlot[slot]
  }
}

function optsSlot(opts) {
  if (!opts) return '1'
  if (typeof opts === 'string' || typeof opts === 'number') return normalizeSlot(opts)
  return normalizeSlot(opts.credentialSlot || opts.slot || '1')
}

/** 业务接口遇到 40001/42001 时强制刷新 token 再打一次 */
async function withTokenRetry(slot, runner) {
  let res = await runner(await getAccessToken({ credentialSlot: slot }))
  if (isTokenInvalidRes(res)) {
    console.warn('[oaWechatApi] access_token 失效，强制刷新后重试 slot=', slot, res.errcode)
    res = await runner(await getAccessToken({ credentialSlot: slot, force: true }))
  }
  return res
}

async function uploadThumbFromUrl(imageUrl, opts) {
  if (!imageUrl) throw new Error('缺少封面图 URL')
  const slot = optsSlot(opts)
  const buf = await fetchBuffer(imageUrl)
  const lower = String(imageUrl).toLowerCase()
  const ext = lower.includes('.png') ? 'png' : lower.includes('.gif') ? 'gif' : 'jpg'
  const ctype = ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : 'image/jpeg'
  const res = await withTokenRetry(slot, (token) =>
    httpUpload(
      `https://api.weixin.qq.com/cgi-bin/material/add_material?access_token=${token}&type=thumb`,
      'media',
      `cover.${ext}`,
      buf,
      ctype
    )
  )
  if (!res || (!res.media_id && !res.thumb_media_id) || res.errcode) {
    throw new Error('上传封面失败: ' + JSON.stringify(res))
  }
  return res.media_id || res.thumb_media_id
}

async function uploadContentImageFromUrl(imageUrl, opts) {
  const slot = optsSlot(opts)
  const buf = await fetchBuffer(imageUrl)
  if (!buf || buf.length < 100) throw new Error('图片过小或无效')
  const ext = sniffImageExt(buf, imageUrl)
  const ctype = ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : 'image/jpeg'
  const res = await withTokenRetry(slot, (token) =>
    httpUpload(
      `https://api.weixin.qq.com/cgi-bin/media/uploadimg?access_token=${token}`,
      'media',
      `img.${ext}`,
      buf,
      ctype
    )
  )
  if (!res || !res.url || res.errcode) {
    throw new Error('上传正文图失败: ' + JSON.stringify(res))
  }
  return res.url
}

async function addDraft(article, opts) {
  const slot = optsSlot(opts)
  const res = await withTokenRetry(slot, (token) =>
    httpJson('POST', `https://api.weixin.qq.com/cgi-bin/draft/add?access_token=${token}`, {
      articles: [article]
    })
  )
  if (!res || !res.media_id || res.errcode) {
    throw new Error('创建微信草稿失败: ' + JSON.stringify(res))
  }
  return res
}

async function freepublishSubmit(mediaId, opts) {
  const slot = optsSlot(opts)
  const res = await withTokenRetry(slot, (token) =>
    httpJson(
      'POST',
      `https://api.weixin.qq.com/cgi-bin/freepublish/submit?access_token=${token}`,
      { media_id: mediaId }
    )
  )
  if (!res || res.errcode) {
    throw new Error('提交发布失败: ' + JSON.stringify(res))
  }
  return res
}

function miniprogramAnchorOpen(path) {
  const appid = escapeAttr(getMiniAppId())
  const p = escapeAttr(sanitizeMiniprogramPath(path))
  return `<a data-miniprogram-appid="${appid}" data-miniprogram-path="${p}" href="">`
}

function buildMiniprogramLinkHtml({ path, text }) {
  const label = escapeHtmlText(text || '打开小程序 · 火星探索日志')
  // 官方文档要求 href=""；写 http://www.qq.com 会在未识别小程序属性时直接打开网页
  return (
    `<p class="oa-mp-cta" data-oa-cta="1" style="margin:24px 0;text-align:center;">` +
    `${miniprogramAnchorOpen(path)}${label}</a>` +
    `</p>`
  )
}

/**
 * 正文所有配图点击跳转小程序：
 * 先拆掉包住 img 的普通/脏 <a>（含 <br>），再统一包小程序锚点，避免嵌套与孤儿标签。
 */
function wrapAllImagesWithMiniprogram(html, { path } = {}) {
  const open = miniprogramAnchorOpen(path)
  let s = String(html || '')
  s = s.replace(
    /<a\b[^>]*>\s*(<img\b[^>]*>)\s*(?:<br\s*\/?\s*>\s*)?<\/a>/gi,
    '$1'
  )
  return s.replace(/<img\b[^>]*>/gi, (img) => `${open}${img}</a>`)
}

/** 45166 最终回退：去掉配图上的小程序锚点，仅保留裸图 */
function unwrapMiniprogramImageLinks(html) {
  return String(html || '').replace(
    /<a\b[^>]*data-miniprogram-appid=["'][^"']+["'][^>]*>\s*(<img\b[^>]*>)\s*<\/a>/gi,
    '$1'
  )
}

/**
 * 小程序引流：
 * - image：图片跳转（API 稳定，视觉接近卡片，推荐）
 * - link：文字链
 * - card：官方卡片标签（部分账号 draft/add 会 45166，仅作尝试）
 */
async function buildMiniprogramCtaHtml({
  path,
  text,
  title,
  imageUrl,
  mode = 'image',
  credentialSlot = '1',
  trustMmbiz = false
}) {
  const appid = escapeAttr(getMiniAppId())
  const p = sanitizeMiniprogramPath(path)
  const cardTitleRaw = String(title || text || '火星探索日志').slice(0, 20)
  const cardTitle = escapeAttr(cardTitleRaw)
  const cardTitleText = escapeHtmlText(cardTitleRaw)
  const m = String(mode || 'image')
  const slot = normalizeSlot(credentialSlot)

  let cardImg = ''
  if (imageUrl && (m === 'image' || m === 'card')) {
    try {
      const raw = String(imageUrl || '').trim()
      const isMmbiz = /mmbiz\.qpic\.cn|mmbiz\.qlogo\.cn/i.test(raw)
      // trustMmbiz：调用方已保证为本槽 uploadimg 产物，跳过重复上传
      if (raw && isMmbiz && trustMmbiz) {
        cardImg = raw
      } else if (raw) {
        cardImg = await uploadContentImageFromUrl(raw, { credentialSlot: slot })
      }
      if (!/^https?:\/\//i.test(cardImg)) cardImg = ''
    } catch (e) {
      console.warn('[oaWechatApi] upload cta image fail', e.message || e)
      cardImg = ''
    }
  }

  if (m === 'card' && cardImg) {
    return (
      `<mp-common-miniprogram data-miniprogram-appid="${appid}" data-miniprogram-path="${escapeAttr(p)}" ` +
      `data-miniprogram-title="${cardTitle}" data-miniprogram-imageurl="${escapeAttr(cardImg)}" ` +
      `data-miniprogram-type="card"></mp-common-miniprogram>`
    )
  }

  if (cardImg) {
    // 图片跳转：与官方 uploadnewsmsg 示例一致，href 必须为空字符串
    return (
      `<p class="oa-mp-cta" data-oa-cta="1" style="margin:24px 0;text-align:center;">` +
      `${miniprogramAnchorOpen(p)}` +
      `<img src="${escapeAttr(cardImg)}" alt="${cardTitle}" data-width="null" data-ratio="NaN" style="max-width:100%;height:auto;border-radius:6px;" />` +
      `</a></p>` +
      `<p class="oa-mp-cta" data-oa-cta="1" style="margin:8px 0 24px;text-align:center;color:#576b95;font-size:14px;">` +
      `${miniprogramAnchorOpen(p)}${cardTitleText}</a>` +
      `</p>`
    )
  }

  return buildMiniprogramLinkHtml({ path: p, text: text || cardTitleRaw })
}

/** 只剥文末 CTA，不误伤正文配图上的小程序锚点 */
function stripMiniprogramCta(html) {
  return String(html || '')
    .replace(/<mp-common-miniprogram\b[^>]*>\s*<\/mp-common-miniprogram>/gi, '')
    .replace(/<p\b[^>]*\bdata-oa-cta=["']?1["']?[^>]*>[\s\S]*?<\/p>/gi, '')
    .replace(/<p\b[^>]*class=["'][^"']*\boa-mp-cta\b[^"']*["'][^>]*>[\s\S]*?<\/p>/gi, '')
    .replace(/<section[^>]*>\s*<\/section>/gi, '')
}

function isInvalidContentError(err) {
  const msg = String((err && err.message) || err || '')
  return /45166|invalid content/i.test(msg)
}

/**
 * 文首提示语（发射预测免责声明等）：
 * 文案里第一个【…】自动包小程序跳转锚点（默认蓝色文字）。
 * data-oa-lead="1" 标记，重建 HTML 时可先剥再加，避免重复。
 */
function buildLeadDisclaimerHtml({ text, path, color } = {}) {
  const raw = String(text || '').trim()
  if (!raw) return ''
  const appid = escapeAttr(getMiniAppId())
  const p = escapeAttr(sanitizeMiniprogramPath(path))
  const c = escapeAttr(String(color || '#1a73e8').slice(0, 24))
  const m = raw.match(/【[^】]{1,30}】/)
  let inner
  if (m) {
    const before = escapeHtmlText(raw.slice(0, m.index))
    const name = escapeHtmlText(m[0])
    const after = escapeHtmlText(raw.slice(m.index + m[0].length))
    inner =
      before +
      `<a data-miniprogram-appid="${appid}" data-miniprogram-path="${p}" href="" ` +
      `style="color:${c};text-decoration:none;font-weight:600;">${name}</a>` +
      after
  } else {
    inner = escapeHtmlText(raw)
  }
  return (
    `<section data-oa-lead="1" style="margin:0 0 18px;padding:10px 12px;` +
    `font-size:13px;line-height:1.8;color:#595959;background:#f6f7f8;border-radius:6px;">` +
    inner +
    `</section>`
  )
}

/** 剥掉已存在的文首提示语（重建/重推时防重复） */
function stripLeadDisclaimer(html) {
  return String(html || '').replace(
    /<section\b[^>]*\bdata-oa-lead=["']?1["']?[^>]*>[\s\S]*?<\/section>/gi,
    ''
  )
}

module.exports = {
  getOaAppId,
  getMiniAppId,
  normalizeSlot,
  resolveCredentials,
  credentialsReady,
  credentialsStatus,
  getAccessToken,
  uploadThumbFromUrl,
  uploadContentImageFromUrl,
  fetchBuffer,
  imageUrlCandidates,
  cfBypassImageMirrors,
  hotlinkSafeImageUrl,
  addDraft,
  freepublishSubmit,
  buildMiniprogramCtaHtml,
  buildMiniprogramLinkHtml,
  buildLeadDisclaimerHtml,
  stripLeadDisclaimer,
  wrapAllImagesWithMiniprogram,
  unwrapMiniprogramImageLinks,
  stripMiniprogramCta,
  isInvalidContentError,
  escapeAttr,
  sanitizeMiniprogramPath,
  assertSafeFetchUrl,
  isBlockedIp
}
