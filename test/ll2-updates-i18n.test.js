/**
 * 星舰动态追踪 / LL2 updates 翻译
 * 运行：node --test test/ll2-updates-i18n.test.js
 */
const test = require('node:test')
const assert = require('node:assert/strict')

const fs = require('fs')
const path = require('path')
const { translateUpdateComment, translateWhen } = require('../cloudfunctions/ll2Query/ll2-updates-i18n.js')
const { isUsableZhText } = require('../cloudfunctions/ll2Query/space-terms-i18n.js')
const client = require('../subpackages/progress-extra/utils/ll2-updates-i18n.js')

const CLIENT_COPIES = [
  'subpackages/progress-extra/utils/ll2-updates-i18n.js',
  'pages/mission-detail/utils/ll2-updates-i18n.js'
]

const CASES = [
  ['NET early September.', '最早不早于9月上旬。'],
  ['Added launch.', '已添加发射。'],
  ['Added launch', '已添加发射。'],
  ['NET January.', '最早不早于1月。'],
  ['NET May 12, TBC.', '最早不早于5月12日，待确认。'],
  ['NET May 15 per new marine navigation warnings, TBC.', '最早不早于5月15日（依据最新海上航行警告），待确认。'],
  ['GO for launch.', '发射就绪。'],
  ['Now targeting May 20 at 22:30 UTC', '当前目标发射时间：5月20日 22:30 UTC。'],
  ['Next attempt NET May 22.', '下一次尝试最早不早于5月22日。'],
  ['Confirmed rescheduled for May 22.', '已确认改期至5月22日。'],
  ['Liftoff.', '升空。'],
  ['Tweaked T-0.', '已微调 T-0。'],
  ['Launch time is to the second.', '发射时间已精确到秒。'],
  ['Updated launch weather, 55% GO.', '已更新发射天气，55% 具备发射条件。'],
  ['Scrub for the day after hold at T-40.', '在 T-40 保持后取消当日发射。'],
  ['Moved to NET Q1 based on vehicle testing progress.', '已调整为最早不早于第一季度，依据载具测试进展。'],
  ['Targeting March', '当前目标发射时间：3月。'],
  ['Successful liftoff and ascent of Starship and Super Heavy', '星舰与超重型助推器成功升空并完成上升段。'],
  ['NET early Sept.', '最早不早于9月上旬。']
]

test('截图与常见 LL2 动态句式自动译成可用中文', () => {
  for (const [en, zh] of CASES) {
    assert.equal(translateUpdateComment(en), zh, en)
    assert.equal(isUsableZhText(zh), true, zh)
    assert.equal(client.translateUpdateComment(en), zh, 'client:' + en)
  }
})

test('保留转播品牌名', () => {
  assert.equal(
    translateUpdateComment('Unofficial Re-stream by SPACE AFFAIRS has started'),
    'SPACE AFFAIRS 的非官方转播已开始。'
  )
})

test('日期短语', () => {
  assert.equal(translateWhen('early September'), '9月上旬')
  assert.equal(translateWhen('late October'), '10月下旬')
  assert.equal(translateWhen('May 12, TBC'), '5月12日，待确认')
  assert.equal(translateWhen('Q2'), '第二季度')
})

test('分包动态 i18n 客户端副本一致', () => {
  const root = path.join(__dirname, '..')
  const base = fs.readFileSync(path.join(root, CLIENT_COPIES[0]), 'utf8').replace(/\r\n/g, '\n')
  for (const rel of CLIENT_COPIES.slice(1)) {
    const other = fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n')
    assert.equal(other, base, rel + ' 与 progress-extra 副本不一致')
  }
})
