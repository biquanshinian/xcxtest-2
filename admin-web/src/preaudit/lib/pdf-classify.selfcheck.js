import assert from 'assert'
import { assignPages, classifyPage, isPhotoLike, isSkipText, isSparseText, pickPhotoSlot, pickSparseOcrPages, scorePage } from './pdf-classify.js'

function must(name, text, org, id) {
  const hit = classifyPage(text, org)
  assert.strictEqual(hit.id, id, name + ' => ' + hit.id + ' score=' + hit.score)
}

must('award', '成交通知书\n项目名称：村部东侧硬化路\n中标人：东风建筑', 'village', 'bid_notice')
must('invoice', '增值税专用发票\n发票代码 0123\n价税合计（小写）¥10000', 'village', 'invoices')
must('contract', '施工合同\n合同编号 HT-1\n发包方 东风村\n合同金额 10000', 'village', 'contract')
must('minutes', '中国共产党东风村支部委员会\n党支部提议纪要', 'village', 'minutes_party')
must('signin-in-record', '会议签到表\n姓名 职务 签字', 'village', 'fund_record')
must('tw-signin', '会议签到表\n姓名 职务 签字', 'township', 'meeting_signin')
must('notice', '现将使用决议公示如下\n公示期自2026年3月1日至2026年3月7日', 'village', 'notice_resolution')
must('plan-notice', '使用实施方案公示\n现予公布', 'village', 'notice_plan')
must('result-notice', '实施结果公示\n现将本项目实施结果予以公布', 'village', 'result_public')
must('pair-res-plan', '使用决议公示\n使用实施方案公示\n现予公布', 'village', 'notice_resolution')
must('pair-result-plan', '实施结果公示\n使用实施方案公示\n现予公布', 'village', 'result_public')
must('lowest', '手写最低价清单盖鲜章\n最低价 3000 元', 'small', 'compare_sheet')
must('compare', '三家公司比价清单\n甲公司 乙公司 丙公司', 'small', 'compare_sheet')
must('tw-plan', '使用实施方案\n一、项目概况', 'township', 'impl_plan')
must('accept-sheet', '工程验收单\n验收日期：2026年4月2日\n验收金额：10000元', 'village', 'accept_sheet')
must('accept-not-photo', '现场验收单\n落款 2026年4月2日\n验收金额 10000元', 'village', 'accept_sheet')
must('accept-photo', '现场验收照片\n验收现场', 'village', 'photo_accept')

const watermark = classifyPage('仅供报账彩打 / 硬化路 / 2026-04-01', 'village')
assert.strictEqual(watermark.id, 'contract_watermark')

const weak = scorePage('根据政府采购法本项目中标通知书', 'village')
assert.ok(weak.best === 'bid_notice' && weak.bestScore >= 8)

assert.strictEqual(pickPhotoSlot('village', {}), 'photo_before')
assert.strictEqual(pickPhotoSlot('village', { photo_before: 1 }), 'photo_during')
assert.ok(isPhotoLike('', { id: '', score: 0 }))
assert.ok(!isPhotoLike('增值税专用发票价税合计', { id: 'invoices', score: 20 }))
assert.ok(isSkipText('目录\n一、审批表 二、合同'))
assert.ok(isSkipText('目录\n一、成交通知书 二、施工合同'))
assert.strictEqual(classifyPage('目录\n一、审批表 二、合同', 'village').source, 'skip')

must('plan-not-photo', '施工方案\n施工前准备及人员安排', 'village', 'construction_plan')
const buyer = classifyPage('采购文件\n购买方：东风村村民委员会', 'village')
assert.strictEqual(buyer.id, 'zbj_procurement')

const review = classifyPage('评审报告\n评标委员会确定中标人东风建筑', 'village')
assert.strictEqual(review.id, 'review_report')

const shuffled = assignPages([
  { index: 1, text: '增值税专用发票\n发票代码 111\n价税合计（小写）¥10000' },
  { index: 2, text: '党支部提议纪要\n会议时间 2026年2月20日' },
  { index: 3, text: '成交通知书\n项目名称：硬化路\n成交供应商：东风建筑' },
  { index: 4, text: '施工合同\n合同编号 HT-1\n发包方 东风村\n合同金额 10000' }
], 'village')
assert.deepStrictEqual(shuffled.map((r) => r.itemId), ['invoices', 'minutes_party', 'bid_notice', 'contract'])

const sandwich = assignPages([
  { index: 1, text: '施工合同\n合同编号 HT-1\n发包方 东风村' },
  { index: 2, text: '根据双方约定支付工程款，承包方应按期完工。' },
  { index: 3, text: '合同金额人民币壹万元整\n本合同一式肆份' }
], 'village')
assert.strictEqual(sandwich[0].itemId, 'contract')
assert.strictEqual(sandwich[1].itemId, 'contract')
assert.strictEqual(sandwich[2].itemId, 'contract')

const splitNeighbors = assignPages([
  { index: 1, text: '成交通知书\n成交供应商 东风' },
  { index: 2, text: '根据有关法律规定实施本项目。' },
  { index: 3, text: '增值税专用发票\n发票代码 111\n价税合计（小写）¥10000' }
], 'village')
assert.strictEqual(splitNeighbors[0].itemId, 'bid_notice')
assert.strictEqual(splitNeighbors[2].itemId, 'invoices')
assert.strictEqual(splitNeighbors[1].itemId, '', '夹在两类中间且无关键词的页不应硬归')

const bookmarked = assignPages([
  { index: 1, text: '附件正文无标题', bookmark: '成交通知书' }
], 'village')
assert.strictEqual(bookmarked[0].itemId, 'bid_notice')
assert.strictEqual(bookmarked[0].source, 'bookmark')

assert.ok(!isSkipText('封面\n成交通知书\n项目名称：硬化路\n成交供应商：东风建筑'))
must('cover-award', '封面\n成交通知书\n项目名称：硬化路\n成交供应商：东风建筑', 'village', 'bid_notice')

const mentioned = classifyPage('施工合同\n合同编号 HT-1\n详见项目审批表附件', 'village')
assert.strictEqual(mentioned.id, 'contract')

const longHole = assignPages([
  { index: 1, text: '施工合同\n合同编号 HT-1\n发包方 东风村' },
  { index: 2, text: '第一条 工程内容以图纸为准。' },
  { index: 3, text: '第二条 工期自开工之日起九十天。' },
  { index: 4, text: '第三条 质量达到合格标准。' },
  { index: 5, text: '合同金额人民币壹万元整\n本合同一式肆份' }
], 'village')
assert.ok(longHole.every((row) => row.itemId === 'contract'), '长合同中间无标题页应被两边夹住归入合同')

const hintedHole = assignPages([
  { index: 1, text: '施工合同\n合同编号 HT-1\n发包方 东风村' },
  { index: 2, text: '请示事项如下，请予批复。' },
  { index: 3, text: '合同金额人民币壹万元整\n本合同一式肆份' }
], 'village')
assert.strictEqual(hintedHole[1].itemId, '', '夹在合同中间但像另一份文件开头的页不应硬并')

const far = [{ index: 1, text: '增值税专用发票\n发票代码 111\n价税合计（小写）¥10000' }]
for (let i = 2; i <= 15; i++) far.push({ index: i, text: '本页为装订说明，无具体条款。' })
far.push({ index: 16, text: '增值税专用发票\n发票代码 222\n价税合计（小写）¥20000' })
assert.ok(assignPages(far, 'village').slice(1, 15).every((row) => !row.itemId), '隔太远的两张同类页不应把中间全部并过去')

const bookmarkedCover = assignPages([
  { index: 1, text: '封面', bookmark: '成交通知书' }
], 'village')
assert.strictEqual(bookmarkedCover[0].itemId, 'bid_notice')

const responses = assignPages([
  { index: 1, text: '甲公司投标文件' },
  { index: 2, text: '成交通知书' },
  { index: 3, text: '乙公司响应文件' },
  { index: 4, text: '丙公司投标函' }
], 'village')
assert.strictEqual(responses[0].itemId, 'responses')
assert.strictEqual(responses[1].itemId, 'bid_notice')
assert.strictEqual(responses[2].itemId, 'responses')
assert.strictEqual(responses[3].itemId, 'responses')

assert.ok(isSparseText(''))
assert.ok(isSparseText('第1页'))
assert.ok(!isSparseText('增值税专用发票价税合计（小写）¥10000'))

assert.deepStrictEqual(pickSparseOcrPages([], 8), [])
const dense = [{ index: 1, text: '增值税专用发票价税合计（小写）¥10000' }]
assert.strictEqual(pickSparseOcrPages(dense, 8).length, 0, '有正文的页不应再抽去识别')

const allScan = []
for (let i = 1; i <= 40; i++) allScan.push({ index: i, text: '' })
const sampled = pickSparseOcrPages(allScan, 8)
assert.strictEqual(sampled.length, 8)
assert.strictEqual(sampled[0].index, 1)
assert.strictEqual(sampled[7].index, 40)
const sampleSet = sampled.map((p) => p.index)
assert.ok(sampleSet.indexOf(1) >= 0 && sampleSet.indexOf(40) >= 0)
assert.ok(new Set(sampleSet).size === 8, '抽页不应重复')

const mixed = [
  { index: 1, text: '增值税专用发票价税合计（小写）¥10000' },
  { index: 2, text: '' },
  { index: 3, text: '' },
  { index: 4, text: '成交通知书\n项目名称：硬化路工程\n成交供应商：东风建筑' }
]
assert.deepStrictEqual(pickSparseOcrPages(mixed, 8).map((p) => p.index), [2, 3])

const already = [{ index: 1, text: '', engine: 'tencent' }, { index: 2, text: '' }]
assert.deepStrictEqual(pickSparseOcrPages(already, 8).map((p) => p.index), [2])

console.log('pdf-classify selfcheck ok')
