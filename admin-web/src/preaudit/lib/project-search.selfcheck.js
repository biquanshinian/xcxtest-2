import assert from 'assert'
import { summarizeListItem } from './audit.js'
import {
  filterProjectsByKeyword,
  matchesProjectKeyword,
  projectSearchTokens,
  readHomeKeyword,
  writeHomeKeyword
} from './project-search.js'

const village = {
  name: '村道硬化',
  village: '东风村',
  year: '2026',
  contractor: 'Dongfeng Build',
  orgType: 'village',
  orgName: '村委会',
  amountText: '10000.00 元',
  bidDateText: '2026-03-10',
  status: '可报账',
  done: true,
  jointBid: true,
  notes: '应急抢修',
  partnerVillage: '西风村'
}

const small = {
  name: '路灯更换',
  village: '南湾组',
  year: '2025',
  contractor: '光明电业',
  orgType: 'small',
  orgName: '村委会小额',
  amountText: '3200.00 元',
  bidDateText: '2025-11-02',
  status: '进行中',
  done: false,
  jointBid: false,
  notes: '',
  partnerVillage: ''
}

const town = {
  name: '办公楼维修',
  village: '财政所',
  year: '2026',
  contractor: '乡建公司',
  orgType: 'township',
  orgName: '乡政府',
  amountText: '未填',
  bidDateText: '未填',
  status: '未上传',
  done: false,
  jointBid: false,
  notes: '汛期',
  partnerVillage: ''
}

assert.deepStrictEqual(projectSearchTokens('  东风  2026 '), ['东风', '2026'])
assert.strictEqual(matchesProjectKeyword(village, ''), true)
assert.strictEqual(matchesProjectKeyword(village, '   '), true)
assert.strictEqual(matchesProjectKeyword(village, '村道'), true)
assert.strictEqual(matchesProjectKeyword(village, '东风村'), true)
assert.strictEqual(matchesProjectKeyword(village, '东风 2026'), true)
assert.strictEqual(matchesProjectKeyword(village, 'dongfeng'), true)
assert.strictEqual(matchesProjectKeyword(village, '小额'), false)
assert.strictEqual(matchesProjectKeyword(village, '两村打包'), true)
assert.strictEqual(matchesProjectKeyword(village, '西风'), true)
assert.strictEqual(matchesProjectKeyword(village, '应急'), true)
assert.strictEqual(matchesProjectKeyword(village, '可报账'), true)
assert.strictEqual(matchesProjectKeyword(village, '10000'), true)
assert.strictEqual(matchesProjectKeyword(village, '村委会报账'), true)
assert.strictEqual(matchesProjectKeyword(small, '小额'), true)
assert.strictEqual(matchesProjectKeyword(small, '乡里'), false)
assert.strictEqual(matchesProjectKeyword(village, '已完成'), true)
assert.strictEqual(matchesProjectKeyword(village, '进行中'), false)
assert.strictEqual(matchesProjectKeyword(small, '进行中'), true)
assert.strictEqual(matchesProjectKeyword(town, '乡政府'), true)
assert.strictEqual(matchesProjectKeyword(town, '汛期'), true)
assert.strictEqual(matchesProjectKeyword(town, '财政所'), true)
assert.strictEqual(matchesProjectKeyword(null, '村道'), false)
assert.deepStrictEqual(
  filterProjectsByKeyword([village, small, town], '南湾').map((row) => row.name),
  ['路灯更换']
)
assert.strictEqual(filterProjectsByKeyword([village, small, town], '没有这个词').length, 0)
assert.strictEqual(filterProjectsByKeyword([village, small, town], '').length, 3)
assert.strictEqual(filterProjectsByKeyword(null, '村道').length, 0)

const listed = summarizeListItem({
  id: 'p_search',
  name: '沟渠清淤',
  orgType: 'township',
  village: '财政所',
  year: '2026',
  contractor: '乡建公司',
  notes: '汛期',
  materials: {}
})
assert.strictEqual(listed.notes, '汛期')
assert.ok(listed.status, '列表项应有状态')
assert.ok(matchesProjectKeyword(listed, '沟渠'))
assert.ok(matchesProjectKeyword(listed, '乡里'))
assert.ok(matchesProjectKeyword(listed, listed.status))

writeHomeKeyword('东风 2026')
assert.strictEqual(readHomeKeyword(), '东风 2026')
writeHomeKeyword('')
assert.strictEqual(readHomeKeyword(), '')

console.log('project-search selfcheck ok')
