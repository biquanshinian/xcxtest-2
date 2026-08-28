/**
 * 猎鹰重型芯级角色名：#1 侧助推器1，#2 侧助推器2，#3 中央芯级
 * 运行：node --test test/falcon-heavy-roles.test.js
 */
const test = require('node:test')
const assert = require('node:assert/strict')

const {
  resolveFalconHeavyRoleLabel,
  sortFalconHeavyStagesForDisplay
} = require('../pages/mission-detail/utils/falcon-heavy-roles.js')

test('LL2 Strap-On + Core：按类型标 #1/#2 侧助推、#3 中央芯级', () => {
  const stages = [
    { type: 'Strap-On Booster' },
    { type: 'Strap-On Booster' },
    { type: 'Core' }
  ]
  assert.equal(resolveFalconHeavyRoleLabel(stages, 0), '侧助推器1')
  assert.equal(resolveFalconHeavyRoleLabel(stages, 1), '侧助推器2')
  assert.equal(resolveFalconHeavyRoleLabel(stages, 2), '中央芯级')
})

test('类型未区分时最后一根为中央芯级（修正旧的 idx===0 中央芯）', () => {
  const stages = [{ type: 'Core' }, { type: 'Core' }, { type: 'Core' }]
  assert.equal(resolveFalconHeavyRoleLabel(stages, 0), '侧助推器1')
  assert.equal(resolveFalconHeavyRoleLabel(stages, 1), '侧助推器2')
  assert.equal(resolveFalconHeavyRoleLabel(stages, 2), '中央芯级')
})

test('Core 排在最前时仍正确识别，展示顺序排到最后', () => {
  const stages = [
    { type: 'Core' },
    { type: 'Strap-On Booster' },
    { type: 'Strap-On Booster' }
  ]
  const labeled = stages.map((item, idx) => ({
    role: resolveFalconHeavyRoleLabel(stages, idx),
    type: item.type
  }))
  assert.equal(labeled[0].role, '中央芯级')
  assert.equal(labeled[1].role, '侧助推器1')
  assert.equal(labeled[2].role, '侧助推器2')
  const ordered = sortFalconHeavyStagesForDisplay(labeled)
  assert.deepEqual(ordered.map((s) => s.role), ['侧助推器1', '侧助推器2', '中央芯级'])
})
