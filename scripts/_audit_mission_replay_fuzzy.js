/**
 * 历史发射回放集锦：「精细 → 模糊+近时」兜底全链路审计
 * node scripts/_audit_mission_replay_fuzzy.js
 */
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const root = path.resolve(__dirname, '..')
let failed = 0

function assert(cond, msg) {
  if (cond) console.log('OK', msg)
  else {
    failed += 1
    console.error('FAIL', msg)
  }
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8')
}

function main() {
  console.log('== static: clip-match / agent / enqueue ==')

  const clipMatch = read('workers/replay-fetcher/src/clip-match.js')
  assert(clipMatch.includes('全部历史发射'), 'clip-match 声明覆盖全部历史发射')
  assert(clipMatch.includes('function scoreClipText'), 'scoreClipText 存在')
  assert(clipMatch.includes('fuzzyOk'), '精细失败有 fuzzyOk 降级')
  assert(clipMatch.includes('softFamilyGroups'), '家族词含编号词干抽取')
  assert(clipMatch.includes('extractFamilyStem'), 'extractFamilyStem 存在')
  assert(clipMatch.includes('pickBestClipCandidate'), '近时挑选 pickBestClipCandidate')
  assert(clipMatch.includes('parseUploadDateMs'), 'upload_date 解析')
  assert(clipMatch.includes('looksLikeConflictingGroupId'), '星链组号串台防护')
  assert(!/fuzzyOk\s*=\s*false\s*\/\/\s*starlink only/i.test(clipMatch), '模糊降级不是 Starlink 特例开关')

  const agent = read('workers/replay-fetcher/src/index.js')
  assert(agent.includes('pickBestClipCandidate'), 'Agent findClipVideo 使用近时挑选')
  assert(agent.includes('parseUploadDateMs'), 'Agent 解析 upload_date')
  assert(agent.includes('%(upload_date)s'), 'yt-dlp flat 拉 upload_date')
  assert(agent.includes('scoreClipText'), 'Agent 调用 scoreClipText')
  assert(agent.includes('clipSearch.netMs') || agent.includes('netMs'), 'Agent 补齐/使用 netMs')
  assert(agent.includes('集锦模糊匹配'), 'fuzzy 命中有日志')
  assert(agent.includes('job.net'), '缺 netMs 时回退 job.net')

  const missionReplay = read('cloudfunctions/syncSpaceDevsData/mission-replay.js')
  assert(missionReplay.includes('全部历史发射统一策略'), 'mission-replay 统一策略注释')
  assert(missionReplay.includes('netMs'), '入队 clipSearch 含 netMs')
  assert(missionReplay.includes('模糊') && missionReplay.includes('近时'), '入队注释含模糊+近时')
  assert(missionReplay.includes('state === \'requeued\'') || missionReplay.includes('state === "requeued"'), '失败任务可复活')
  assert(missionReplay.includes('clipSearch'), '复活/入队写 clipSearch')
  assert(missionReplay.includes('刷新') || missionReplay.includes('clipSearch,'), '复活时刷新线索')
  assert(missionReplay.includes('hints_refreshed') || missionReplay.includes('refreshExistingClipHints'), '已有队列也会刷新线索')
  assert(missionReplay.includes('unknown') && missionReplay.includes('payload'), '入队丢掉 Unknown Payload 占位 token')

  const rule = read('.cursor/rules/mission-replay-fuzzy-near-time.mdc')
  assert(rule.includes('模糊') && rule.includes('近时'), '项目规则要求模糊+近时')
  assert(rule.includes('全部') || rule.includes('所有'), '项目规则覆盖全部历史发射')
  assert(rule.includes('不要改小程序前端'), '规则禁止改前端补匹配')

  const testSrc = read('workers/replay-fetcher/src/clip-match.test.js')
  assert(testSrc.includes('Starlink 412'), '单测覆盖 Starlink 412↔Group 17-38')
  assert(testSrc.includes('fuzzy-matches') || testSrc.includes('fuzzy'), '单测覆盖 fuzzy')
  assert(testSrc.includes('pickBestClipCandidate'), '单测覆盖近时挑选')
  assert(testSrc.includes('Tianlian') || testSrc.includes('tianlian'), '单测覆盖编号词干家族模糊')
  assert(testSrc.includes('conflicting group') || testSrc.includes('Conflicting'), '单测覆盖串台拒绝')

  console.log('\n== unit: clip-match.test.js ==')
  const unit = spawnSync(
    process.execPath,
    ['--test', 'workers/replay-fetcher/src/clip-match.test.js'],
    { cwd: root, encoding: 'utf8' }
  )
  process.stdout.write(unit.stdout || '')
  process.stderr.write(unit.stderr || '')
  assert(unit.status === 0, 'clip-match 单测全绿')

  console.log('\n== runtime: scoreClipText 关键场景 ==')
  // 动态 import ESM
  const modPath = path.join(root, 'workers/replay-fetcher/src/clip-match.js').replace(/\\/g, '/')
  return import('file:///' + modPath).then((m) => {
    const cases = [
      {
        name: 'Starlink 412 fuzzy',
        title: 'SpaceX Starlink 412 launch and Falcon 9 first stage landing, 8 August 2026',
        desc: '',
        search: { dateText: '8 August 2026', tokens: ['starlink', '17-38'], rocketTokens: ['falcon'] },
        expect: { ok: true, fuzzy: true, strict: false }
      },
      {
        name: 'Starlink 10-45 strict',
        title: 'SpaceX Starlink 10 45 launch and Falcon 9 first stage landing, 14 July 2026',
        desc: '',
        search: { dateText: '14 July 2026', tokens: ['starlink', '10-45'], rocketTokens: ['falcon'] },
        expect: { ok: true, strict: true }
      },
      {
        name: 'reject wrong group same day',
        title: 'SpaceX Starlink 10 45 launch and Falcon 9 first stage landing, 8 August 2026',
        desc: '',
        search: { dateText: '8 August 2026', tokens: ['starlink', '17-38'], rocketTokens: ['falcon'] },
        expect: { ok: false }
      },
      {
        name: 'Tianlian stem fuzzy',
        title: 'Long March-3B launches TianLian-2 07',
        desc: 'on 23 July 2026',
        search: { dateText: '23 July 2026', tokens: ['tianlian-2-06'], rocketTokens: ['long', 'march'] },
        expect: { ok: true, fuzzy: true }
      },
      {
        name: 'Unknown Payload falls back to rocket+date',
        title: 'Long March-7A ChinaSat 4B launch, 10 August 2026',
        desc: '',
        search: { dateText: '10 August 2026', tokens: ['unknown', 'payload'], rocketTokens: ['long', 'march', '7a'] },
        expect: { ok: true }
      },
      {
        name: 'reject missing date',
        title: 'SpaceX Starlink 412 launch and Falcon 9 landing',
        desc: 'no calendar',
        search: { dateText: '8 August 2026', tokens: ['starlink', '17-38'], rocketTokens: ['falcon'] },
        expect: { ok: false }
      }
    ]

    for (const c of cases) {
      const scored = m.scoreClipText(c.title, c.desc, c.search)
      let pass = scored.ok === c.expect.ok
      if (c.expect.fuzzy != null) pass = pass && scored.fuzzy === c.expect.fuzzy
      if (c.expect.strict != null) pass = pass && scored.strict === c.expect.strict
      assert(pass, `runtime ${c.name} → ok=${scored.ok} strict=${scored.strict} fuzzy=${scored.fuzzy}`)
    }

    const near = m.pickBestClipCandidate([
      { id: 'far', scored: { ok: true, strict: false, fuzzy: true, score: 3 }, uploadMs: Date.UTC(2026, 7, 10) },
      { id: 'near', scored: { ok: true, strict: false, fuzzy: true, score: 3 }, uploadMs: Date.UTC(2026, 7, 8) }
    ], Date.UTC(2026, 7, 8, 16, 35))
    assert(near && near.id === 'near', 'runtime 近时挑选选中更近 upload')

    console.log(failed ? `\nDONE with ${failed} failure(s)` : '\nDONE all green')
    process.exit(failed ? 1 : 0)
  }).catch((e) => {
    console.error('FAIL runtime import', e)
    process.exit(1)
  })
}

main()
