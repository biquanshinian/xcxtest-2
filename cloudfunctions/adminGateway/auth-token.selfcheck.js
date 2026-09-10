const assert = require('assert')
const crypto = require('crypto')
const { createAdminToken, parseAdminToken } = require('./auth-token.js')

const secret = 's'.repeat(32)
const token = createAdminToken({ id: 'u1', tokenVersion: 0, pwdUpdatedAt: 9 }, secret, 1700000000000)
const parsed = parseAdminToken(token, secret)
assert.strictEqual(parsed.id, 'u1')
assert.strictEqual(parsed.tokenVersion, 0)
assert.strictEqual(parsed.pwdUpdatedAt, 9)
assert.ok(!Object.prototype.hasOwnProperty.call(parsed, 'exp'), '新 token 不应带过期时间')
assert.strictEqual(parseAdminToken(token, 'other-secret-must-be-32-chars!!'), null)
assert.strictEqual(parseAdminToken('bad', secret), null)

const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
const expiredBody = Buffer.from(JSON.stringify({
  id: 'u2',
  iat: 1,
  exp: 2,
  tokenVersion: 0
})).toString('base64url')
const expiredSig = crypto.createHmac('sha256', secret).update(header + '.' + expiredBody).digest('base64url')
const expired = parseAdminToken(header + '.' + expiredBody + '.' + expiredSig, secret)
assert.strictEqual(expired.id, 'u2', '旧 token 即使 exp 已过也应继续可用')

console.log('auth-token selfcheck ok')
