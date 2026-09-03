import assert from 'assert'
import { documentDates, extractProjectMeta, formatAmountField, isDaysOnlyPublicity, parseChineseAmount, parseOcrText, summarizeParsed } from './ocr-parse.js'

function check(name, text, kind, expect) {
  const got = parseOcrText(text, kind)
  if (expect.date !== undefined) assert.strictEqual(got.date, expect.date, name + ' date')
  if (expect.startDate !== undefined) assert.strictEqual(got.startDate, expect.startDate, name + ' start')
  if (expect.endDate !== undefined) assert.strictEqual(got.endDate, expect.endDate, name + ' end')
  if (expect.amount !== undefined) assert.strictEqual(got.amount, expect.amount, name + ' amount')
}

check('invoice', '开票日期：2026年3月8日\n价税合计（小写）¥12,800.00', 'invoice', {
  date: '2026-03-08',
  amount: 12800
})

check('notice', '现将使用决议公示如下\n自2026年3月1日至2026年3月7日', 'notice', {
  startDate: '2026-03-01',
  endDate: '2026-03-07'
})

check('dash-range', '公示期 2026.03.01—2026.03.07', 'notice', {
  startDate: '2026-03-01',
  endDate: '2026-03-07'
})

check('days-only-no-range', '实施结果公示\n公示期7天\n请予监督', 'notice', {
  startDate: '',
  endDate: ''
})

check('days-only-stray-dates', '实施结果公示\n公示期7天\n印发2026年4月1日\n开会2026年4月8日', 'notice', {
  startDate: '',
  endDate: ''
})

check('split-range', '实施结果公示\n自\n2026年4月4日\n至\n2026年4月10日\n公示7天', 'notice', {
  startDate: '2026-04-04',
  endDate: '2026-04-10'
})

check('contract', '签订日期 2026/4/18\n合同金额：￥30000 元\n人民币叁万元整', 'contract', {
  date: '2026-04-18',
  amount: 30000
})

check('quote', '报价日期：2026年5月2日\n合计 980.50 元\n项目 2026', 'doc', {
  date: '2026-05-02',
  amount: 980.5
})

check('accept-sheet', '工程验收单\n验收日期：2026年4月2日\n验收金额：10000元', 'doc', {
  date: '2026-04-02',
  amount: 10000
})

check('township-letter', '关于乡政府的请示\n申请资金10000元\n请示日期：2026年2月3日', 'doc', {
  date: '2026-02-03',
  amount: 10000
})

check('township-letter-cn', '关于乡政府的请示\n请示日期：2026年2月3日\n申请资金人民币壹万元整', 'doc', {
  date: '2026-02-03',
  amount: 10000
})

check('township-letter-cn-date', '关于乡政府的请示\n申请资金人民币壹万元整\n二〇二六年二月三日', 'doc', {
  date: '2026-02-03',
  amount: 10000
})

check('skip-code', '发票代码 012345678901\n开票日期 2026年1月9日\n（小写）¥2100.00', 'invoice', {
  date: '2026-01-09',
  amount: 2100
})

check('line-items-vs-total', '货物A 800.00\n货物B 金额 900.00\n价税合计（小写）¥2,100.00', 'invoice', {
  amount: 2100
})

check('deposit-vs-contract', '履约保证金：3000元\n合同金额：30000元\n人民币叁万元整', 'contract', {
  amount: 30000
})

check('budget-vs-award', '预算金额：15000元\n中标金额：12800元', 'doc', {
  amount: 12800
})

check('award-then-budget', '中标金额：12800元\n预算金额：15000元', 'doc', {
  amount: 12800
})

check('unlabeled-max', '2100\n3500 元\n1800', 'doc', {
  amount: 3500
})

check('qty-vs-total', '数量 8000\n价税合计 ¥2100.00', 'invoice', {
  amount: 2100
})

check('unit-price-vs-total', '单价 8000 元\n合计 2100 元', 'doc', {
  amount: 2100
})

check('split-total-line', '价税合计（小写）\n¥12,800.00\n金额 300.00', 'invoice', {
  amount: 12800
})

check('compare-max', '甲公司合计 5000 元\n乙公司合计 4000 元\n丙公司合计 3000 元', 'doc', {
  amount: 5000
})

check('multi-page-class', '履约保证金 3000 元\n签订日期 2026年4月18日\n合同金额 30000 元', 'contract', {
  date: '2026-04-18',
  amount: 30000
})

assert.strictEqual(
  summarizeParsed({ date: '2026-03-08', startDate: '2026-03-08', endDate: '', amount: 12800 }),
  '2026-03-08 · 12800 元'
)

const noticeText = [
  '成交通知书',
  '项目名称：村部东侧硬化路',
  '中标人：东风建筑有限公司',
  '采购人：东风村村民委员会',
  '中标金额：人民币壹万元整',
  '中标日期：2026年3月10日'
].join('\n')
const noticeParsed = parseOcrText(noticeText, 'doc')
assert.strictEqual(noticeParsed.name, '村部东侧硬化路')
assert.strictEqual(noticeParsed.contractor, '东风建筑有限公司')
assert.strictEqual(noticeParsed.village, '东风村')
assert.strictEqual(noticeParsed.date, '2026-03-10')
assert.strictEqual(noticeParsed.amount, 10000)

const invoiceSeller = parseOcrText([
  '增值税专用发票',
  '购买方',
  '名称：东风村村民委员会',
  '销售方',
  '名称：东风建筑有限公司',
  '开票日期：2026年3月8日',
  '价税合计（小写）¥3000.00'
].join('\n'), 'invoice')
assert.strictEqual(invoiceSeller.contractor, '东风建筑有限公司')
assert.strictEqual(invoiceSeller.amount, 3000)

const quoteMeta = extractProjectMeta('供应商名称：东风建筑有限公司\n最低价 3000 元')
assert.strictEqual(quoteMeta.contractor, '东风建筑有限公司')

const aboutMeta = extractProjectMeta('关于村部东侧道路硬化工程的中标通知')
assert.strictEqual(aboutMeta.name, '村部东侧道路硬化工程')
assert.strictEqual(extractProjectMeta('根据政府采购法本项目中标通知书').name, '')

assert.strictEqual(parseChineseAmount('人民币壹万贰仟叁佰肆拾伍元陆角柒分'), 12345.67)
assert.strictEqual(parseChineseAmount('二〇二六年二月三日申请资金人民币壹万元整'), 10000)
assert.strictEqual(formatAmountField(12800), '12800')
assert.strictEqual(formatAmountField(980.5), '980.50')

assert.deepStrictEqual(
  documentDates('开会时间：2026年2月20日\n印发日期：2026年2月21日'),
  ['2026-02-20', '2026-02-21']
)
assert.deepStrictEqual(
  documentDates('出生日期：1990年1月2日\n开会时间：2026年2月20日'),
  ['2026-02-20']
)
assert.deepStrictEqual(
  documentDates('公示截止日期至2026年3月7日\n起始2026年3月1日'),
  ['2026-03-07', '2026-03-01']
)

assert.ok(isDaysOnlyPublicity('实施结果公示\n公示期7天\n请予监督'))
assert.ok(isDaysOnlyPublicity('实施结果公示\n公示期7天\n印发2026年4月1日\n开会2026年4月8日'))
assert.ok(!isDaysOnlyPublicity('实施结果公示\n自2026年4月4日至2026年4月10日\n公示7天'))
assert.ok(!isDaysOnlyPublicity('实施结果公示\n自\n2026年4月4日\n至\n2026年4月10日\n公示7天'))
assert.ok(!isDaysOnlyPublicity('开会时间：2026年2月20日'))

console.log('ocr-parse selfcheck ok')
