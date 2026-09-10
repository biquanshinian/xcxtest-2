/**
 * X 认证标归一化
 */
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const {
  normalizeVerifyBadge,
  verifyBadgeSrc
} = require('../subpackages/progress-extra/utils/x-verify-badge.js')

const copies = [
  'subpackages/progress-extra/utils/x-verify-badge.js',
  'subpackages/index-extra/utils/x-verify-badge.js',
  'subpackages/shared/utils/x-verify-badge.js'
].map((rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8').replace(/\r\n/g, '\n'))
assert.strictEqual(copies[0], copies[1], 'index-extra 认证标副本需与 progress-extra 一致')
assert.strictEqual(copies[0], copies[2], 'shared 认证标副本需与 progress-extra 一致')
assert.ok(!fs.existsSync(path.join(__dirname, '..', 'utils/x-verify-badge.js')), '主包不应再放 x-verify-badge.js')


assert.strictEqual(normalizeVerifyBadge('grey'), 'grey')
assert.strictEqual(normalizeVerifyBadge('gray'), 'grey')
assert.strictEqual(normalizeVerifyBadge('Government'), 'grey')
assert.strictEqual(normalizeVerifyBadge('blue'), 'blue')
assert.strictEqual(normalizeVerifyBadge('gold'), 'gold')
assert.strictEqual(normalizeVerifyBadge('Business'), 'gold')
assert.strictEqual(normalizeVerifyBadge(''), 'none')
assert.strictEqual(normalizeVerifyBadge('nope'), 'none')
assert.strictEqual(verifyBadgeSrc('grey'), '/images/x-verify/grey.svg')
assert.strictEqual(verifyBadgeSrc('none'), '')
assert.strictEqual(verifyBadgeSrc('blue'), '/images/x-verify/blue.svg')
assert.strictEqual(verifyBadgeSrc('gold'), '/images/x-verify/gold.svg')
console.log('x-verify-badge tests passed')
