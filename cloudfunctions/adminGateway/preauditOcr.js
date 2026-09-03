/**
 * 一键预审 OCR：调腾讯云识别后立刻丢掉图片，不写 COS、不写库。
 * 公开接口，按 IP 限流；已登录管理员额度更高。
 * 需云函数角色具备 ocr:GeneralBasicOCR / ocr:GeneralAccurateOCR / ocr:VatInvoiceOCR，
 * 或配置 OCR_SECRET_ID / OCR_SECRET_KEY。
 */
const https = require('https')

const OCR_HOST = 'ocr.tencentcloudapi.com'
const OCR_SERVICE = 'ocr'
const OCR_VERSION = '2018-11-19'
const OCR_REGION = 'ap-guangzhou'
const MAX_BASE64_CHARS = 5500000
const HOUR_LIMIT = 80
const DAY_LIMIT = 240
const AUTH_HOUR_LIMIT = 120
const AUTH_DAY_LIMIT = 360
const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
const RATE_COLLECTION = 'security_rate_limits'

function sha256Hex(crypto, msg) {
  return crypto.createHash('sha256').update(msg, 'utf8').digest('hex')
}

function hmac(crypto, key, msg) {
  return crypto.createHmac('sha256', key).update(msg, 'utf8').digest()
}

function stripDataUrl(raw) {
  const s = String(raw || '').trim()
  const i = s.indexOf('base64,')
  return i >= 0 ? s.slice(i + 7) : s.replace(/\s+/g, '')
}

function getCreds() {
  const dedicatedId = String(process.env.OCR_SECRET_ID || '').trim()
  const dedicatedKey = String(process.env.OCR_SECRET_KEY || '').trim()
  if (dedicatedId && dedicatedKey && dedicatedId !== 'FILL_ME') {
    return { secretId: dedicatedId, secretKey: dedicatedKey, token: '' }
  }
  const secretId = String(process.env.TENCENTCLOUD_SECRETID || '').trim()
  const secretKey = String(process.env.TENCENTCLOUD_SECRETKEY || '').trim()
  const token = String(process.env.TENCENTCLOUD_SESSIONTOKEN || '').trim()
  return { secretId, secretKey, token }
}

function callOcr(crypto, action, payloadObj) {
  const { secretId, secretKey, token } = getCreds()
  if (!secretId || !secretKey) {
    const err = new Error('识别密钥未配置')
    err.code = 'NO_KEY'
    throw err
  }
  const timestamp = Math.floor(Date.now() / 1000)
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10)
  const payload = JSON.stringify(payloadObj)
  const canonicalRequest = [
    'POST',
    '/',
    '',
    'content-type:application/json; charset=utf-8',
    'host:' + OCR_HOST,
    '',
    'content-type;host',
    sha256Hex(crypto, payload)
  ].join('\n')
  const credentialScope = date + '/' + OCR_SERVICE + '/tc3_request'
  const stringToSign = [
    'TC3-HMAC-SHA256',
    String(timestamp),
    credentialScope,
    sha256Hex(crypto, canonicalRequest)
  ].join('\n')
  const secretDate = hmac(crypto, 'TC3' + secretKey, date)
  const secretService = hmac(crypto, secretDate, OCR_SERVICE)
  const secretSigning = hmac(crypto, secretService, 'tc3_request')
  const signature = hmac(crypto, secretSigning, stringToSign).toString('hex')
  const authorization =
    'TC3-HMAC-SHA256 Credential=' + secretId + '/' + credentialScope +
    ', SignedHeaders=content-type;host, Signature=' + signature

  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    Host: OCR_HOST,
    'X-TC-Action': action,
    'X-TC-Version': OCR_VERSION,
    'X-TC-Region': OCR_REGION,
    'X-TC-Timestamp': String(timestamp),
    Authorization: authorization
  }
  if (token) headers['X-TC-Token'] = token

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: OCR_HOST,
      port: 443,
      path: '/',
      method: 'POST',
      headers,
      timeout: 20000
    }, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        try {
          const json = JSON.parse(data)
          if (json.Response && json.Response.Error) {
            const e = new Error(json.Response.Error.Message || json.Response.Error.Code || 'OCR 失败')
            e.code = json.Response.Error.Code
            reject(e)
            return
          }
          resolve((json && json.Response) || {})
        } catch (e) {
          reject(new Error('OCR 返回无法解析'))
        }
      })
    })
    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('OCR 超时'))
    })
    req.write(payload)
    req.end()
  })
}

function joinDetections(resp) {
  const list = (resp && resp.TextDetections) || []
  return list.map((row) => row && row.DetectedText).filter(Boolean).join('\n')
}

function validYmd(y, m, d) {
  const year = Number(y)
  const month = Number(m)
  const day = Number(d)
  if (!year || !month || !day) return ''
  const dt = new Date(year, month - 1, day)
  if (dt.getFullYear() !== year || dt.getMonth() !== month - 1 || dt.getDate() !== day) return ''
  const pad = (n) => (n < 10 ? '0' + n : String(n))
  return year + '-' + pad(month) + '-' + pad(day)
}

function parseLooseDate(raw) {
  const m = String(raw || '').match(/((?:19|20)\d{2})\s*[.\-/年]\s*(\d{1,2})\s*[.\-/月]\s*(\d{1,2})/)
  return m ? validYmd(m[1], m[2], m[3]) : ''
}

function parseLooseAmount(raw) {
  const m = String(raw || '').replace(/,/g, '').match(/(\d+(?:\.\d{1,2})?)/)
  if (!m) return null
  const n = Number(m[1])
  if (!isFinite(n) || n <= 0) return null
  return Math.round(n * 100) / 100
}

function fromVatInvoice(resp) {
  const infos = (resp && resp.VatInvoiceInfos) || []
  const map = {}
  infos.forEach((row) => {
    if (row && row.Name) map[row.Name] = row.Value || ''
  })
  const date = parseLooseDate(map['开票日期'] || map['填开日期'] || '')
  const amount = parseLooseAmount(
    map['价税合计(小写)'] ||
    map['价税合计（小写）'] ||
    map['小写'] ||
    map['合计金额'] ||
    ''
  )
  const text = infos.map((row) => (row.Name || '') + ' ' + (row.Value || '')).join('\n')
  const invoice = (date || amount != null) ? { date, amount } : null
  return { text, invoice }
}

async function assertRateLimit(db, crypto, clientIp, now, user) {
  const ip = String(clientIp || 'unknown').slice(0, 64)
  const id = 'preaudit_ocr_' + crypto.createHash('sha256').update(ip).digest('hex').slice(0, 24)
  const ts = now()
  const hourCap = (user && user.id) ? AUTH_HOUR_LIMIT : HOUR_LIMIT
  const dayCap = (user && user.id) ? AUTH_DAY_LIMIT : DAY_LIMIT
  let data = null
  try {
    const snap = await db.collection(RATE_COLLECTION).doc(id).get()
    data = snap && snap.data
  } catch (e) {
    data = null
  }
  let hourStart = Number(data && data.hourStart) || ts
  let dayStart = Number(data && data.dayStart) || ts
  let hourCount = Number(data && data.hourCount) || 0
  let dayCount = Number(data && data.dayCount) || 0
  if (ts - hourStart > HOUR_MS) {
    hourStart = ts
    hourCount = 0
  }
  if (ts - dayStart > DAY_MS) {
    dayStart = ts
    dayCount = 0
  }
  if (hourCount >= hourCap) return { ok: false, message: '识别太勤了，过一会儿再试' }
  if (dayCount >= dayCap) return { ok: false, message: '今天识别次数用完了' }
  try {
    await db.collection(RATE_COLLECTION).doc(id).set({
      data: {
        kind: 'preaudit_ocr',
        hourStart,
        hourCount: hourCount + 1,
        dayStart,
        dayCount: dayCount + 1,
        updatedAt: ts
      }
    })
  } catch (e) {
    // 限流表写失败不挡识别，避免集合未建时整页不可用
  }
  return { ok: true }
}

function createPreauditOcrApi({ db, ok, fail, now, crypto, createCOSClient, COS_BUCKET, COS_REGION, COS_BASE_URL }) {
  function allowedImageUrl(url) {
    const s = String(url || '')
    const base = String(COS_BASE_URL || '')
    return !!(base && s.indexOf(base) === 0 && /preaudit\//.test(s))
  }

  function ocrInput(imageBase64, imageUrl) {
    if (imageUrl) return { ImageUrl: imageUrl }
    return { ImageBase64: imageBase64 }
  }

  function signPut(key) {
    const cos = createCOSClient()
    return new Promise((resolve, reject) => {
      cos.getObjectUrl({
        Bucket: COS_BUCKET,
        Region: COS_REGION,
        Key: key,
        Method: 'PUT',
        Sign: true,
        Expires: 180,
        Protocol: 'https:'
      }, (err, data) => err ? reject(err) : resolve(data && data.Url))
    })
  }

  async function sign(ctx) {
    const limited = await assertRateLimit(db, crypto, ctx && ctx.clientIp, now, ctx && ctx.user)
    if (!limited.ok) return fail(4290, limited.message)
    if (typeof createCOSClient !== 'function') return fail(5001, '云存储未配置')
    const fileId = 'o' + now().toString(36) + crypto.randomBytes(4).toString('hex')
    const key = 'preaudit/ocr-tmp/' + fileId + '.jpg'
    try {
      const uploadUrl = await signPut(key)
      return ok({
        key,
        uploadUrl,
        url: String(COS_BASE_URL || '') + encodeURI(key)
      })
    } catch (e) {
      return fail(5001, (e && e.message) || '没拿到上传地址')
    }
  }

  async function recognize(body, ctx) {
    const imageUrl = String((body && body.imageUrl) || '').trim()
    const imageBase64 = stripDataUrl(body && body.imageBase64)
    const kind = String((body && body.kind) || 'doc').slice(0, 20)
    if (!imageBase64 && !imageUrl) return fail(4000, '没有图')
    if (imageUrl && !allowedImageUrl(imageUrl)) return fail(4000, '图片地址不对')
    if (imageBase64 && imageBase64.length > MAX_BASE64_CHARS) return fail(4000, '图太大，请换一张清楚的近照')

    const limited = await assertRateLimit(db, crypto, ctx && ctx.clientIp, now, ctx && ctx.user)
    if (!limited.ok) return fail(4290, limited.message)
    const input = ocrInput(imageBase64, imageUrl)

    try {
      let text = ''
      let invoice = null
      let engine = 'tencent'
      if (kind === 'invoice') {
        try {
          const vat = await callOcr(crypto, 'VatInvoiceOCR', input)
          const parsed = fromVatInvoice(vat)
          text = parsed.text
          invoice = parsed.invoice
          if (!text && !invoice) throw new Error('empty vat')
          engine = 'tencent-invoice'
        } catch (e) {
          const general = await callOcr(crypto, 'GeneralAccurateOCR', input)
          text = joinDetections(general)
        }
      } else if (kind === 'fast') {
        try {
          const basic = await callOcr(crypto, 'GeneralBasicOCR', input)
          text = joinDetections(basic)
          engine = 'tencent-fast'
        } catch (e) {
          const general = await callOcr(crypto, 'GeneralAccurateOCR', input)
          text = joinDetections(general)
        }
      } else {
        const general = await callOcr(crypto, 'GeneralAccurateOCR', input)
        text = joinDetections(general)
      }
      return ok({
        engine,
        text: String(text || '').slice(0, 12000),
        invoice
      })
    } catch (e) {
      const msg = (e && e.message) || '识别失败'
      if (e && e.code === 'NO_KEY') return fail(5002, msg)
      if (/服务未开通|UnOpenError|ResourceUnavailable/i.test(msg)) {
        return fail(5004, '腾讯云文字识别还没开通，请到控制台开通 OCR 后再认')
      }
      if (e && /Unauthorized|AuthFailure|not authorized/i.test(String(e.code || '') + msg)) {
        return fail(5003, '识别服务未开通权限')
      }
      return fail(5001, msg)
    }
  }

  return { recognize, sign }
}

module.exports = { createPreauditOcrApi }
