const test = require('node:test')
const assert = require('node:assert/strict')
const {
  isVoteChoiceForType,
  inferRecordVoteType,
  recordChoiceForType,
  pickUserVoteFromRecords,
  expandUserVoteRecords,
  buildUserVoteTypePatch
} = require('../cloudfunctions/adminGateway/vote-record-helpers.js')

test('准时与成败选项互不认作对方题型', () => {
  assert.equal(isVoteChoiceForType('ge', 'ontime'), true)
  assert.equal(isVoteChoiceForType('buge', 'ontime'), true)
  assert.equal(isVoteChoiceForType('success', 'ontime'), false)
  assert.equal(isVoteChoiceForType('ge', 'outcome'), false)
  assert.equal(isVoteChoiceForType('success', 'outcome'), true)
  assert.equal(isVoteChoiceForType('failure', 'outcome'), true)
})

test('旧记录缺 voteType 时用 choice 推断题型', () => {
  assert.equal(inferRecordVoteType({ choice: 'success' }), 'outcome')
  assert.equal(inferRecordVoteType({ choice: 'ge' }), 'ontime')
  assert.equal(inferRecordVoteType({ voteType: 'outcome', choice: 'ge' }), 'outcome')
})

test('同一文档可同时挂准时和成败，互不覆盖', () => {
  const row = {
    launchId: 'L1',
    voteType: 'ontime',
    choice: 'ge',
    ontimeChoice: 'ge',
    outcomeChoice: 'success'
  }
  assert.equal(recordChoiceForType(row, 'ontime'), 'ge')
  assert.equal(recordChoiceForType(row, 'outcome'), 'success')
  assert.equal(pickUserVoteFromRecords([row], 'ontime').choice, 'ge')
  assert.equal(pickUserVoteFromRecords([row], 'outcome').choice, 'success')
})

test('猜了成败（旧数据无 voteType）不能挡住准时题', () => {
  const outcomeOnly = { launchId: 'L1', choice: 'failure' }
  assert.equal(pickUserVoteFromRecords([outcomeOnly], 'ontime').choice, '')
  assert.equal(pickUserVoteFromRecords([outcomeOnly], 'outcome').choice, 'failure')
})

test('猜了准时不能挡住成败题', () => {
  const ontimeOnly = { launchId: 'L1', voteType: 'ontime', choice: 'buge' }
  assert.equal(pickUserVoteFromRecords([ontimeOnly], 'outcome').choice, '')
  assert.equal(pickUserVoteFromRecords([ontimeOnly], 'ontime').choice, 'buge')
})

test('战绩展开：一条双题记录变成两条', () => {
  const rows = expandUserVoteRecords([{
    launchId: 'L1',
    voteType: 'ontime',
    choice: 'ge',
    ontimeChoice: 'ge',
    outcomeChoice: 'success',
    createdAt: 1
  }])
  assert.equal(rows.length, 2)
  assert.deepEqual(rows.map((r) => r.voteType + ':' + r.choice).sort(), ['ontime:ge', 'outcome:success'])
})

test('写入补丁只碰对应题型字段', () => {
  assert.deepEqual(buildUserVoteTypePatch('outcome', 'success', 1, 't'), {
    outcomeChoice: 'success',
    outcomeRound: 1,
    outcomeLaunchTimeAtVote: 't'
  })
  assert.equal(buildUserVoteTypePatch('ontime', 'ge', 2, '').ontimeChoice, 'ge')
})

test('两条独立记录展开后仍是两道题，不会交叉污染', () => {
  const rows = expandUserVoteRecords([
    { launchId: 'L1', voteType: 'ontime', choice: 'ge' },
    { launchId: 'L1', voteType: 'outcome', choice: 'success' }
  ])
  assert.equal(rows.length, 2)
  assert.deepEqual(rows.map((r) => r.voteType + ':' + r.choice).sort(), ['ontime:ge', 'outcome:success'])
  const list = [
    { launchId: 'L1', voteType: 'ontime', choice: 'buge' },
    { launchId: 'L1', voteType: 'outcome', choice: 'failure' }
  ]
  assert.equal(pickUserVoteFromRecords(list, 'ontime').choice, 'buge')
  assert.equal(pickUserVoteFromRecords(list, 'outcome').choice, 'failure')
})

test('成败文档上后挂的准时字段可被读出，且不改原成败选项', () => {
  const merged = {
    launchId: 'L1',
    voteType: 'outcome',
    choice: 'success',
    ontimeChoice: 'ge'
  }
  assert.equal(recordChoiceForType(merged, 'outcome'), 'success')
  assert.equal(recordChoiceForType(merged, 'ontime'), 'ge')
})

test('成败题历史误存 ge/buge 时纠正为 failure/success，且不挡住准时', () => {
  const dirty = { launchId: 'L1', voteType: 'outcome', choice: 'ge' }
  assert.equal(recordChoiceForType(dirty, 'outcome'), 'failure')
  assert.equal(recordChoiceForType(dirty, 'ontime'), '')
})

test('空输入与缺字段安全', () => {
  assert.equal(pickUserVoteFromRecords(null, 'ontime').choice, '')
  assert.equal(pickUserVoteFromRecords([], 'outcome').choice, '')
  assert.equal(recordChoiceForType(null, 'outcome'), '')
  assert.equal(expandUserVoteRecords(null).length, 0)
})
