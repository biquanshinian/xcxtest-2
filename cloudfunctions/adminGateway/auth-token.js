const crypto = require('crypto')

function b64urlJson(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url')
}

function createAdminToken(payload, secret, nowMs) {
  const header = b64urlJson({ alg: 'HS256', typ: 'JWT' })
  const body = b64urlJson(Object.assign({}, payload || {}, { iat: Number(nowMs) || Date.now() }))
  const signature = crypto.createHmac('sha256', secret).update(header + '.' + body).digest('base64url')
  return header + '.' + body + '.' + signature
}

function parseAdminToken(token, secret) {
  try {
    const parts = String(token || '').split('.')
    if (parts.length !== 3) return null
    const header = parts[0]
    const body = parts[1]
    const signature = parts[2]
    const expected = crypto.createHmac('sha256', secret).update(header + '.' + body).digest('base64url')
    const got = Buffer.from(signature)
    const want = Buffer.from(expected)
    if (got.length !== want.length) return null
    if (!crypto.timingSafeEqual(got, want)) return null
    const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
    if (!data || !data.id) return null
    return data
  } catch (e) {
    return null
  }
}

module.exports = { createAdminToken, parseAdminToken }
