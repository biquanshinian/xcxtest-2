import assert from 'assert'
import * as checklist from './checklist.js'
import * as dates from './date.js'
import * as audit from './audit.js'
import { applyParsed, pickBetterText } from './ocr-apply.js'
import { parseOcrText } from './ocr-parse.js'

function fileSet(n, prefix) {
  const files = []
  for (let i = 0; i < n; i++) files.push({ id: prefix + i, path: prefix + '_' + i })
  return files
}

function completeVillage() {
  const materials = {}
  checklist.getItems('village').forEach((item) => {
    const min = item.minFiles || 1
    materials[item.id] = Object.assign(checklist.emptyMaterial(), {
      files: item.hidden ? [] : fileSet(min, item.id),
      pairedPhoto: !!item.requirePairedPhoto,
      date: '2026-04-20',
      startDate: '2026-03-01',
      endDate: '2026-03-07',
      amount: 10000,
      peopleCount: 3,
      committeeCount: 2,
      hasSupervisor: true
    })
  })
  materials.approval_form.date = '2026-02-18'
  materials.minutes_party.date = '2026-02-20'
  materials.minutes_two_committees.date = '2026-02-21'
  materials.minutes_party_members.date = '2026-02-22'
  materials.minutes_villagers.date = '2026-02-23'
  materials.fund_briefing.date = '2026-02-23'
  materials.fund_record.date = '2026-02-23'
  materials.township_request.date = '2026-03-08'
  materials.zbj_request.date = '2026-03-08'
  materials.township_approval.date = '2026-03-08'
  materials.zbj_procurement.date = '2026-03-08'
  materials.responses.date = '2026-03-09'
  materials.review_report.date = '2026-03-09'
  materials.bid_notice.date = '2026-03-10'
  materials.contract.date = '2026-03-12'
  materials.construction_plan.date = '2026-03-13'
  materials.photo_before.date = ''
  materials.photo_during.date = ''
  materials.photo_after.date = ''
  materials.photo_accept.date = ''
  materials.accept_sheet.date = '2026-04-02'
  materials.invoices.date = '2026-04-03'
  materials.result_public.startDate = '2026-04-04'
  materials.result_public.endDate = '2026-04-10'
  return {
    id: 'p_test',
    name: '自检项目',
    orgType: 'village',
    village: '东风村',
    year: '2026',
    budgetAmount: 10000,
    bidAmount: 10000,
    awardAmount: 10000,
    contractAmount: 10000,
    bidDate: '2026-03-10',
    awardDate: '2026-03-10',
    materials
  }
}

assert.strictEqual(dates.noticeEnd('2026-03-01', 7), '2026-03-07')

const ok = audit.runAudit(completeVillage())
assert.strictEqual(ok.passed, true, JSON.stringify(ok.issues, null, 2))

const listed = audit.summarizeListItem(completeVillage())
assert.strictEqual(listed.amountText, '10000.00 元')
assert.strictEqual(listed.hasAmount, true)
assert.strictEqual(listed.dateLabel, '中标日期')
assert.strictEqual(listed.bidDateText, '2026-03-10')
assert.strictEqual(listed.hasBidDate, true)
assert.strictEqual(listed.done, true, '核验通过应归入已完成')
const listedBlank = audit.summarizeListItem({ id: 'p_blank', name: '空项目', orgType: 'township', materials: {} })
assert.strictEqual(listedBlank.amountText, '未填')
assert.strictEqual(listedBlank.dateLabel, '中标日期')
assert.strictEqual(listedBlank.bidDateText, '未填')
assert.strictEqual(listedBlank.done, false, '未齐项目应归入进行中')

const lateApproval = completeVillage()
lateApproval.materials.approval_form.date = '2026-04-20'
const lateApprovalResult = audit.runAudit(lateApproval)
assert.strictEqual(lateApprovalResult.passed, true, '审批表晚于验收应可通过')
assert.ok(!lateApprovalResult.issues.some((i) => String(i.title).indexOf('项目审批') >= 0 || String(i.title).indexOf('审批表') >= 0), '审批表补签不应报日期顺序')
const lateApprovalView = audit.auditProject(lateApproval)
assert.ok(!lateApprovalView.timeline.some((row) => row.inverted), '审批表补签不应把时间线标成倒签')

const townLateApproval = completeTownship()
townLateApproval.materials.approval_form.date = '2026-03-20'
assert.strictEqual(audit.runAudit(townLateApproval).passed, true, '乡政府审批表晚于验收应可通过')

const fake = completeVillage()
fake.materials.bid_notice.date = '2026-03-03'
fake.bidDate = '2026-03-03'
fake.awardDate = '2026-03-03'
const fakeResult = audit.runAudit(fake)
assert.ok(fakeResult.issues.some((i) => i.category === 'fraud' && String(i.title).indexOf('中标') >= 0), '中标落在公示期内应判假账')

const view = audit.auditProject(fake)
assert.ok(view.fraudIssues.length >= 1, '假账应单独列出')
assert.ok(view.timeline.some((row) => row.key === 'bid_notice' && row.inverted), '时间线应标出倒签')
assert.strictEqual(view.summary.tone, 'risk')
assert.ok(String(view.summary.text).indexOf('假账') >= 0)

const invert = completeVillage()
invert.materials.invoices.date = '2026-03-11'
const invertResult = audit.runAudit(invert)
const invertView = audit.auditProject(invert)
assert.ok(invertView.dateRisks.some((row) => String(row.title).indexOf('日期顺序') >= 0), '发票早于施工应判日期对不上')
assert.strictEqual(invertResult.passed, false, '日期倒签不应判可报账')
assert.ok(invertResult.errorCount > 0, '日期倒签应算硬伤')

const inherit = completeVillage()
inherit.materials.contract.amount = ''
inherit.materials.invoices.amount = ''
inherit.contractAmount = ''
const inheritResult = audit.runAudit(inherit)
assert.strictEqual(inheritResult.passed, true, '合同发票不填金额时应按中标金额通过')
assert.ok(!inheritResult.issues.some((i) => i.category === 'amount'))

const amount = completeVillage()
amount.materials.invoices.amount = 12000
const amountView = audit.auditProject(amount)
assert.ok(amountView.amountIssues.length >= 1, '发票认出不同金额时应判不符')

const oneYuan = completeVillage()
oneYuan.materials.contract.amount = 10001
oneYuan.contractAmount = 10001
const oneYuanResult = audit.runAudit(oneYuan)
assert.ok(oneYuanResult.issues.some((i) => i.category === 'amount'), '合同比中标多 1 元也应判不符')
assert.strictEqual(oneYuanResult.passed, false)

function completeSmall() {
  const materials = {}
  checklist.getItems('small').forEach((item) => {
    const min = item.minFiles || 1
    materials[item.id] = Object.assign(checklist.emptyMaterial(), {
      files: item.special === 'compare' ? [] : fileSet(min, item.id),
      date: item.special === 'photos' || item.special === 'compare' ? '' : '2026-04-10',
      amount: 3000
    })
  })
  materials.compare_high = Object.assign(checklist.emptyMaterial(), { files: fileSet(1, 'ch') })
  materials.compare_mid = Object.assign(checklist.emptyMaterial(), { files: fileSet(1, 'cm') })
  materials.compare_low = Object.assign(checklist.emptyMaterial(), { files: fileSet(1, 'cl') })
  materials.budget_quote.date = '2026-04-01'
  materials.compare_sheet.contractor = '东风建筑有限公司'
  materials.invoices.date = '2026-04-08'
  materials.invoices.contractor = '东风建筑有限公司'
  return {
    id: 'p_small',
    name: '小额自检',
    orgType: 'small',
    village: '东风村',
    year: '2026',
    budgetAmount: 3000,
    materials
  }
}

const smallOk = audit.runAudit(completeSmall())
assert.strictEqual(smallOk.passed, true, JSON.stringify(smallOk.issues, null, 2))
const listedSmall = audit.summarizeListItem(completeSmall())
assert.strictEqual(listedSmall.dateLabel, '报价日期')
assert.strictEqual(listedSmall.bidDateText, '2026-04-01')
assert.strictEqual(listedSmall.hasBidDate, true)
assert.strictEqual(listedSmall.done, true, '小额核验通过应归入已完成')

const smallEmptyInv = completeSmall()
smallEmptyInv.materials.invoices.amount = ''
const smallEmptyResult = audit.runAudit(smallEmptyInv)
assert.strictEqual(smallEmptyResult.passed, true, '小额发票不填金额时应按比价低价通过')

const smallBack = completeSmall()
smallBack.materials.invoices.date = '2026-03-20'
const smallBackView = audit.auditProject(smallBack)
assert.ok(smallBackView.dateRisks.some((row) => String(row.title).indexOf('日期顺序') >= 0), '发票早于预算报价应判日期对不上')
assert.ok(smallBackView.timeline.some((row) => row.key === 'invoices' && row.inverted))

const smallMissHigh = completeSmall()
smallMissHigh.materials.compare_high.files = []
const smallMissResult = audit.runAudit(smallMissHigh)
assert.ok(smallMissResult.issues.some((i) => String(i.title).indexOf('三家公司比价') >= 0), '比价缺高价框应判缺项')
assert.strictEqual(smallMissResult.passed, false)

const smallNameBad = completeSmall()
smallNameBad.materials.compare_sheet.contractor = '甲建筑公司'
smallNameBad.materials.invoices.contractor = '乙商贸公司'
const smallNameView = audit.auditProject(smallNameBad)
assert.ok(smallNameView.amountIssues.some((row) => String(row.title).indexOf('发票对不上') >= 0), '低价公司与发票名称不符应判对不上')

const smallNameClose = completeSmall()
smallNameClose.materials.compare_sheet.contractor = '东风建筑'
smallNameClose.materials.invoices.contractor = '东风建筑有限公司'
assert.strictEqual(audit.runAudit(smallNameClose).passed, true, '公司名简称与全称应对齐通过')

function completeJoint() {
  const project = completeVillage()
  project.jointBid = true
  project.village = '东风村'
  project.budgetAmount = 45000
  project.partnerVillage = '西风村'
  project.partnerAmount = 55000
  project.awardAmount = 100000
  project.contractAmount = 100000
  project.materials.bid_notice.amount = 100000
  project.materials.contract.amount = 100000
  project.materials.accept_sheet.amount = 100000
  project.materials.invoices.amount = 45000
  return project
}

const jointOk = audit.runAudit(completeJoint())
assert.strictEqual(jointOk.passed, true, JSON.stringify(jointOk.issues, null, 2))

const jointPackInvoice = completeJoint()
jointPackInvoice.materials.invoices.amount = 100000
const jointPackResult = audit.runAudit(jointPackInvoice)
assert.ok(jointPackResult.issues.some((i) => String(i.title).indexOf('分开开票') >= 0), '打包招标开整包发票应判须分开开票')
assert.strictEqual(jointPackResult.passed, false)

const jointBadSum = completeJoint()
jointBadSum.partnerAmount = 50000
const jointBadResult = audit.runAudit(jointBadSum)
assert.ok(jointBadResult.issues.some((i) => i.category === 'amount' && String(i.title).indexOf('两村') >= 0), '两村之和对不上整包应报金额问题')
assert.strictEqual(jointBadResult.passed, false)

const splitHint = completeVillage()
splitHint.budgetAmount = 4500
splitHint.materials.contract.amount = 10000
splitHint.contractAmount = 10000
const splitHintResult = audit.runAudit(splitHint)
assert.ok(splitHintResult.issues.some((i) => String(i.detail || '').indexOf('两村打包') >= 0), '未勾选打包但报账小于合同时应提示勾选')

function completeTownship() {
  const materials = {}
  checklist.getItems('township').forEach((item) => {
    const min = item.minFiles || 1
    materials[item.id] = Object.assign(checklist.emptyMaterial(), {
      files: fileSet(min, item.id),
      date: '2026-03-20',
      startDate: '2026-02-06',
      endDate: '2026-02-12',
      amount: 10000,
      peopleCount: 3,
      committeeCount: 2,
      hasSupervisor: true
    })
  })
  materials.approval_form.date = '2026-02-01'
  materials.impl_plan.date = '2026-02-02'
  materials.township_letter.date = '2026-02-03'
  materials.quote_sheet.date = '2026-02-04'
  materials.meeting_minutes.date = '2026-02-05'
  materials.meeting_signin.date = '2026-02-05'
  materials.zbj_procurement.date = '2026-02-13'
  materials.responses.date = '2026-02-14'
  materials.review_report.date = '2026-02-15'
  materials.bid_notice.date = '2026-02-16'
  materials.contract.date = '2026-02-18'
  materials.photo_before.date = ''
  materials.photo_during.date = ''
  materials.photo_after.date = ''
  materials.photo_accept.date = ''
  materials.accept_sheet.date = '2026-03-12'
  materials.invoices.date = '2026-03-13'
  materials.result_public.startDate = '2026-03-13'
  materials.result_public.endDate = '2026-03-19'
  materials.result_public.date = ''
  return {
    id: 'p_town',
    name: '乡政府自检',
    orgType: 'township',
    village: '东风乡',
    year: '2026',
    budgetAmount: 10000,
    bidAmount: 10000,
    awardAmount: 10000,
    contractAmount: 10000,
    materials
  }
}

assert.ok(audit.getDateChain('village').some((step) => step.id === 'accept_sheet'), '村流程日期应含验收单')
assert.ok(audit.getDateChain('township').some((step) => step.id === 'accept_sheet'), '乡流程日期应含验收单')
assert.ok(!audit.getDateChain('village').some((step) => String(step.id).indexOf('photo_') === 0), '施工/验收照片不应排进流程日期')
assert.ok(!audit.getDateChain('township').some((step) => String(step.id).indexOf('photo_') === 0), '乡政府施工/验收照片不应排进流程日期')
assert.deepStrictEqual(checklist.itemWritableFields(checklist.getItem('photo_before', 'village')), [])
assert.deepStrictEqual(checklist.itemWritableFields(checklist.getItem('photo_accept', 'village')), [])
assert.deepStrictEqual(checklist.itemWritableFields(checklist.getItem('zbj_procurement', 'village')), [])
assert.deepStrictEqual(checklist.itemWritableFields(checklist.getItem('responses', 'village')), [])
assert.deepStrictEqual(checklist.itemWritableFields(checklist.getItem('zbj_procurement', 'township')), [])
assert.deepStrictEqual(checklist.itemWritableFields(checklist.getItem('responses', 'township')), [])
assert.ok(!audit.getDateChain('village').some((step) => step.id === 'zbj_procurement'))
assert.ok(!audit.getDateChain('village').some((step) => step.id === 'responses'))
assert.ok(!audit.getDateChain('township').some((step) => step.id === 'zbj_procurement'))
assert.ok(!audit.getDateChain('township').some((step) => step.id === 'responses'))
assert.deepStrictEqual(checklist.itemWritableFields(checklist.getItem('accept_sheet', 'village')).sort(), ['amount', 'date'])
assert.ok(!audit.getDateChain('small').some((step) => step.id === 'compare_sheet'), '小额比价不核日期')
assert.ok(!audit.getDateChain('small').some((step) => step.id === 'lowest_sheet'))
assert.ok(!audit.getDateChain('small').some((step) => String(step.id).indexOf('photo_') === 0))
assert.deepStrictEqual(checklist.itemWritableFields(checklist.getItem('compare_sheet', 'small')).sort(), ['amount', 'contractor'])
assert.ok(!checklist.getItem('accept_sheet', 'small'))
assert.ok(!checklist.getItem('photo_accept', 'small'))

const villageProcNoDate = completeVillage()
villageProcNoDate.materials.zbj_procurement.date = ''
villageProcNoDate.materials.responses.date = ''
assert.ok(audit.isComplete(checklist.getItem('zbj_procurement', 'village'), villageProcNoDate.materials.zbj_procurement, villageProcNoDate), '村委会采购文件有件即可')
assert.ok(audit.isComplete(checklist.getItem('responses', 'village'), villageProcNoDate.materials.responses, villageProcNoDate), '村委会三家响应有件即可')
assert.strictEqual(audit.runAudit(villageProcNoDate).passed, true, JSON.stringify(audit.runAudit(villageProcNoDate).issues, null, 2))

const townProcNoDate = completeTownship()
townProcNoDate.materials.zbj_procurement.date = ''
townProcNoDate.materials.responses.date = ''
assert.ok(audit.isComplete(checklist.getItem('zbj_procurement', 'township'), townProcNoDate.materials.zbj_procurement, townProcNoDate), '乡政府采购文件有件即可')
assert.ok(audit.isComplete(checklist.getItem('responses', 'township'), townProcNoDate.materials.responses, townProcNoDate), '乡政府三家响应有件即可')
assert.strictEqual(audit.runAudit(townProcNoDate).passed, true, JSON.stringify(audit.runAudit(townProcNoDate).issues, null, 2))

const townOnePerson = completeTownship()
townOnePerson.materials.photo_accept.peopleCount = 1
townOnePerson.materials.photo_accept.committeeCount = ''
townOnePerson.materials.photo_accept.hasSupervisor = false
assert.ok(audit.peopleRulePass(townOnePerson.materials.photo_accept, 'township').ok, '乡政府验收 1 人应过')
assert.ok(audit.isComplete(checklist.getItem('photo_accept', 'township'), townOnePerson.materials.photo_accept, townOnePerson), '乡政府验收 1 人且有照片应齐')
assert.ok(!audit.runAudit(townOnePerson).issues.some((i) => i.category === 'people'), '乡政府验收 1 人不应再报人数问题')

const townZeroPerson = completeTownship()
townZeroPerson.materials.photo_accept.peopleCount = 0
assert.ok(!audit.peopleRulePass(townZeroPerson.materials.photo_accept, 'township').ok, '乡政府验收 0 人不应过')

const villageOnePerson = completeVillage()
villageOnePerson.materials.photo_accept.peopleCount = 1
villageOnePerson.materials.photo_accept.committeeCount = 1
villageOnePerson.materials.photo_accept.hasSupervisor = false
assert.ok(!audit.peopleRulePass(villageOnePerson.materials.photo_accept, 'village').ok, '村委会 1 人无监督仍应不过')

const missingLetterAmt = completeTownship()
missingLetterAmt.materials.township_letter.amount = ''
assert.ok(
  !audit.isComplete(checklist.getItem('township_letter', 'township'), missingLetterAmt.materials.township_letter, missingLetterAmt),
  '乡政府请示缺金额不应算齐'
)

const photoNoDate = completeVillage()
;['photo_before', 'photo_during', 'photo_after', 'photo_accept'].forEach((id) => {
  photoNoDate.materials[id].date = ''
  photoNoDate.materials[id].amount = ''
})
assert.ok(audit.isComplete(checklist.getItem('photo_before', 'village'), photoNoDate.materials.photo_before, photoNoDate), '施工前照片无日期仍算齐')
assert.ok(audit.isComplete(checklist.getItem('photo_accept', 'village'), photoNoDate.materials.photo_accept, photoNoDate), '现场验收照片无日期仍算齐')
assert.strictEqual(audit.runAudit(photoNoDate).passed, true, '施工和验收照片不填日期应可通过')

const missingAccept = completeVillage()
missingAccept.materials.accept_sheet.date = ''
missingAccept.materials.accept_sheet.amount = ''
assert.ok(
  !audit.isComplete(checklist.getItem('accept_sheet', 'village'), missingAccept.materials.accept_sheet, missingAccept),
  '验收单缺日期金额不应算齐'
)
const missingAcceptView = audit.auditProject(missingAccept)
assert.ok(
  missingAcceptView.warnings.some((row) => String(row.title).indexOf('验收单') >= 0),
  '验收单缺日期或金额应提示待补'
)

const acceptAmt = completeVillage()
acceptAmt.materials.accept_sheet.amount = 12000
const acceptAmtResult = audit.runAudit(acceptAmt)
assert.ok(
  acceptAmtResult.issues.some((i) => i.category === 'amount' && String(i.title).indexOf('验收单') >= 0),
  '验收单金额与合同不符应报金额问题'
)

assert.ok(checklist.itemCanScanFill(checklist.getItem('accept_sheet', 'village')), '验收单应可扫一扫填数')
assert.ok(!checklist.itemCanScanFill(checklist.getItem('photo_before', 'village')), '施工照片不应扫一扫填数')
const scannedAccept = completeVillage()
scannedAccept.materials.accept_sheet.files = []
scannedAccept.materials.accept_sheet.scanFilled = true
assert.ok(
  audit.isComplete(checklist.getItem('accept_sheet', 'village'), scannedAccept.materials.accept_sheet, scannedAccept),
  '验收单扫完日期金额后可不传图'
)
assert.strictEqual(audit.runAudit(scannedAccept).passed, true, '扫完验收单且其它齐时应可通过')
const scannedNotice = completeVillage()
scannedNotice.materials.notice_resolution.files = []
scannedNotice.materials.notice_resolution.scanFilled = true
assert.ok(
  !audit.isComplete(checklist.getItem('notice_resolution', 'village'), scannedNotice.materials.notice_resolution, scannedNotice),
  '决议公示同框照仍要传，扫描只填日期'
)

const townOk = audit.runAudit(completeTownship())
assert.strictEqual(townOk.passed, true, JSON.stringify(townOk.issues, null, 2))
assert.strictEqual(audit.getDateChain('township')[0].id, 'approval_form')
assert.ok(audit.getDateChain('township').some((step) => step.id === 'result_public'))
assert.ok(audit.getDateChain('village').some((step) => step.id === 'result_public'))
assert.ok(!checklist.getRequiredItems('village').some((item) => item.id === 'notice_plan'), '实施方案公示不应再单独必传')
assert.ok(!checklist.getItem('notice_resolution', 'village').extraRange, '决议公示不应再要求填实施方案公示日期')
assert.ok(checklist.getItem('notice_plan', 'village').hidden)

const noPlanDates = completeVillage()
noPlanDates.materials.notice_plan.startDate = ''
noPlanDates.materials.notice_plan.endDate = ''
noPlanDates.materials.notice_resolution.extraRangeStart = ''
noPlanDates.materials.notice_resolution.extraRangeEnd = ''
assert.ok(
  audit.isComplete(
    checklist.getItem('notice_resolution', 'village'),
    noPlanDates.materials.notice_resolution,
    noPlanDates
  ),
  '实施方案公示不填日期时决议公示仍应算齐'
)

const unpaired = completeVillage()
unpaired.materials.notice_resolution.ocrText = '现将使用决议公示如下公示期自2026年3月1日至2026年3月7日请予监督'
const unpairedResult = audit.runAudit(unpaired)
assert.ok(
  unpairedResult.issues.some((i) => String(i.title).indexOf('未见实施方案公示') >= 0),
  '决议公示OCR没有实施方案公示时应提醒同框拍'
)
assert.strictEqual(unpairedResult.passed, false, '认出不是同框照时不应判可报账')

const shortPlan = completeVillage()
shortPlan.materials.notice_plan.startDate = '2026-03-01'
shortPlan.materials.notice_plan.endDate = '2026-03-03'
shortPlan.materials.notice_resolution.extraRangeStart = '2026-03-01'
shortPlan.materials.notice_resolution.extraRangeEnd = '2026-03-03'
const shortPlanResult = audit.runAudit(shortPlan)
assert.ok(
  !shortPlanResult.issues.some((i) => String(i.title).indexOf('实施方案公示不足') >= 0),
  '实施方案公示没有天数要求，不满 7 天不应再拦'
)
assert.ok(!audit.getDateChain('village').some((step) => step.id === 'notice_plan'), '流程日期不应再排实施方案公示')

const shortResultNotice = completeVillage()
shortResultNotice.materials.result_public.endDate = '2026-04-06'
const shortResultAudit = audit.runAudit(shortResultNotice)
assert.ok(
  shortResultAudit.issues.some((i) => i.level === 'error' && String(i.title).indexOf('实施结果公示不足') >= 0),
  '实施结果公示不满 7 天应判硬伤'
)

const oldSplit = completeVillage()
oldSplit.materials.notice_resolution.pairedPhoto = false
oldSplit.materials.result_public.pairedPhoto = false
const oldSplitResult = audit.runAudit(oldSplit)
assert.strictEqual(oldSplitResult.passed, false, '旧的分开拍公示不应判可报账')
assert.ok(
  oldSplitResult.issues.filter((i) => String(i.title).indexOf('需要重拍') >= 0).length >= 2,
  '决议公示和实施结果公示都应要求重拍同框照'
)
assert.ok(
  !audit.isComplete(
    checklist.getItem('notice_resolution', 'village'),
    oldSplit.materials.notice_resolution,
    oldSplit
  ),
  '未重拍的决议公示不应算齐'
)

const skipUpload = completeVillage()
const skipIds = ['zbj_procurement', 'responses', 'review_report', 'bid_notice', 'construction_plan', 'contract', 'contract_watermark', 'license', 'bank_account', 'legal_id', 'invoices']
skipIds.forEach((id) => {
  skipUpload.materials[id].files = []
  skipUpload.materials[id].confirmed = true
})
assert.ok(checklist.getItem('zbj_procurement', 'village').allowConfirm, '网上采购应允许点确认')
assert.ok(checklist.getItem('contract', 'village').allowConfirm, '合同证照应允许点确认')
assert.ok(checklist.getItem('invoices', 'village').allowConfirm, '发票清单应允许点确认')
assert.strictEqual(audit.runAudit(skipUpload).passed, true, '采购合同发票点确认后应可过核验')
skipUpload.materials.zbj_procurement.confirmed = false
assert.ok(
  audit.runAudit(skipUpload).issues.some((i) => i.itemId === 'zbj_procurement' && i.level === 'error'),
  '未确认且未上传时应缺项'
)

const ocrText = '项目名称：东风村道路硬化工程\n中标人：华建公司\n中标金额：10000元\n中标日期：2026年3月10日'
const parsed = parseOcrText(ocrText, 'doc')
assert.strictEqual(parsed.date, '2026-03-10')
assert.strictEqual(parsed.amount, 10000)
assert.ok(String(parsed.name).indexOf('道路硬化') >= 0)

const fromOcr = completeVillage()
fromOcr.materials.bid_notice.amount = ''
fromOcr.materials.bid_notice.date = ''
fromOcr.bidDate = ''
fromOcr.awardDate = ''
fromOcr.awardAmount = ''
fromOcr.bidAmount = ''
const applied = applyParsed(fromOcr.materials.bid_notice, parsed, ['date', 'amount'])
Object.assign(fromOcr.materials.bid_notice, applied.next)
fromOcr.bidDate = applied.next.date
fromOcr.awardDate = applied.next.date
fromOcr.awardAmount = applied.next.amount
fromOcr.bidAmount = applied.next.amount
const fromOcrResult = audit.runAudit(fromOcr)
assert.strictEqual(fromOcrResult.passed, true, '认完成交通知后应按这条链通过核验')

const minutesOcr = applyParsed({ date: '', amount: '' }, parsed, ['date'])
assert.strictEqual(minutesOcr.next.amount, undefined, '纪要识别不应写入金额')
assert.ok(minutesOcr.filled.indexOf('金额') < 0, '纪要识别不应把金额标成已填')
assert.ok(String(minutesOcr.summary).indexOf('10000') < 0, '纪要识别提示不应带金额')

const letterOcr = applyParsed(
  { date: '', amount: '' },
  { date: '2026-02-03', amount: 10000 },
  checklist.itemWritableFields(checklist.getItem('township_letter', 'township'))
)
assert.strictEqual(letterOcr.next.date, '2026-02-03')
assert.strictEqual(letterOcr.next.amount, '10000')
assert.ok(letterOcr.filled.indexOf('日期') >= 0)
assert.ok(letterOcr.filled.indexOf('金额') >= 0)

const noInventEnd = applyParsed(
  { startDate: '', endDate: '' },
  { startDate: '2026-04-04', endDate: '' },
  ['startDate', 'endDate'],
  7
)
assert.strictEqual(noInventEnd.next.startDate, '2026-04-04')
assert.ok(!noInventEnd.next.endDate, 'OCR 只认到起始日时不应按 7 天臆造截止日')

const noDateAsStart = applyParsed(
  { startDate: '', endDate: '' },
  { date: '2026-04-01', startDate: '', endDate: '' },
  ['startDate', 'endDate']
)
assert.ok(!noDateAsStart.next.startDate, '公示识别不应把单独一个落款日期当成起始日')

assert.strictEqual(pickBetterText('待认项目', '东风村道路硬化工程'), '东风村道路硬化工程')
assert.strictEqual(pickBetterText('云端正式名', '待认项目'), '云端正式名')

const explained = audit.explainAudit(amountView)
assert.ok(explained.indexOf('金额') >= 0, '核验说明应提到金额')

const jointEmptyInvoice = completeJoint()
jointEmptyInvoice.materials.invoices.amount = ''
const jointEmptyResult = audit.runAudit(jointEmptyInvoice)
assert.strictEqual(jointEmptyResult.passed, true, '打包时发票金额空着应按本村实施结果通过')

const jointView = audit.auditProject(completeJoint())
assert.strictEqual(jointView.dates.jointBid, true)
assert.ok(String(audit.explainAudit(jointView)).indexOf('分开开具') >= 0)

const planBeforeContract = completeVillage()
planBeforeContract.materials.construction_plan.date = '2026-03-11'
assert.strictEqual(audit.runAudit(planBeforeContract).passed, true, '施工方案早于合同但晚于中标应可通过')

const planBeforeBid = completeVillage()
planBeforeBid.materials.construction_plan.date = '2026-03-09'
const planBeforeBidResult = audit.runAudit(planBeforeBid)
assert.ok(planBeforeBidResult.issues.some((i) => String(i.title).indexOf('施工方案') >= 0), '施工方案早于中标应判顺序异常')
assert.ok(String(planBeforeBidResult.issues.find((i) => String(i.title).indexOf('施工方案') >= 0).detail).indexOf('更正：') >= 0)

const earlyNotice = completeVillage()
earlyNotice.materials.notice_resolution.startDate = '2026-02-20'
const earlyNoticeResult = audit.runAudit(earlyNotice)
assert.ok(earlyNoticeResult.issues.some((i) => String(i.title).indexOf('决议公示起始') >= 0), '公示早于开会应判顺序异常')
assert.strictEqual(earlyNoticeResult.passed, false)

const earlyResult = completeVillage()
earlyResult.materials.result_public.startDate = '2026-03-20'
earlyResult.materials.result_public.endDate = '2026-03-26'
const earlyResultAudit = audit.runAudit(earlyResult)
assert.ok(earlyResultAudit.issues.some((i) => String(i.title).indexOf('实施结果公示起始') >= 0), '结果公示早于验收应判顺序异常')

const sameDayResult = completeVillage()
sameDayResult.materials.result_public.startDate = '2026-04-02'
sameDayResult.materials.result_public.endDate = '2026-04-08'
const sameDayAudit = audit.runAudit(sameDayResult)
assert.ok(
  sameDayAudit.issues.some((i) => String(i.title).indexOf('须晚于') >= 0 && String(i.title).indexOf('实施结果') >= 0),
  '验收当天做实施结果公示应判须次日'
)
assert.strictEqual(sameDayAudit.passed, false)

const townSameDay = completeTownship()
townSameDay.materials.result_public.startDate = '2026-03-12'
townSameDay.materials.result_public.endDate = '2026-03-18'
assert.ok(
  audit.runAudit(townSameDay).issues.some((i) => String(i.title).indexOf('须晚于') >= 0),
  '乡政府验收当天做结果公开应判须次日'
)

const townShortResult = completeTownship()
townShortResult.materials.result_public.endDate = '2026-03-16'
assert.ok(
  audit.runAudit(townShortResult).issues.some((i) => i.level === 'error' && String(i.title).indexOf('实施结果公开不足') >= 0),
  '乡政府实施结果公开不满 7 天应判硬伤'
)

const daysOnlyPaper = completeVillage()
daysOnlyPaper.materials.result_public.ocrText = '实施结果公示\n公示期7天\n请予监督'
assert.ok(
  audit.runAudit(daysOnlyPaper).issues.some((i) => String(i.title).indexOf('须写起止日期') >= 0),
  '结果公示只写7天没有日期范围应拦'
)

const rangedPaper = completeVillage()
rangedPaper.materials.result_public.ocrText = '实施结果公示\n自2026年4月4日至2026年4月10日\n公示7天'
assert.ok(
  !audit.runAudit(rangedPaper).issues.some((i) => String(i.title).indexOf('须写起止日期') >= 0),
  '写了起止日期后再写7天不应拦'
)

const missingEnd = completeVillage()
missingEnd.materials.result_public.endDate = ''
assert.ok(
  !audit.isComplete(checklist.getItem('result_public', 'village'), missingEnd.materials.result_public, missingEnd),
  '结果公示缺截止日不应算齐'
)
assert.ok(
  audit.auditProject(missingEnd).warnings.some((row) => String(row.title).indexOf('未填公示截止日') >= 0),
  '结果公示缺截止日应提示待补'
)

const townMinutesAfterSignin = completeTownship()
townMinutesAfterSignin.materials.meeting_signin.date = '2026-02-05'
townMinutesAfterSignin.materials.meeting_minutes.date = '2026-02-06'
assert.strictEqual(audit.runAudit(townMinutesAfterSignin).passed, true, '纪要晚于签到应可通过')

const townQuoteMismatch = completeTownship()
townQuoteMismatch.materials.quote_sheet.amount = 12000
const townQuoteResult = audit.runAudit(townQuoteMismatch)
assert.ok(townQuoteResult.issues.some((i) => i.category === 'amount' && String(i.title).indexOf('报价合计') >= 0), '乡政府报价与中标不一致应判金额不符')
assert.ok(String(townQuoteResult.issues.find((i) => i.category === 'amount').detail).indexOf('更正：') >= 0)

const townQuoteNoDate = completeTownship()
townQuoteNoDate.materials.quote_sheet.date = ''
assert.ok(
  audit.isComplete(checklist.getItem('quote_sheet', 'township'), townQuoteNoDate.materials.quote_sheet, townQuoteNoDate),
  '报价表不填日期仍算齐'
)
assert.strictEqual(audit.runAudit(townQuoteNoDate).passed, true, '报价表不填日期应可通过')
assert.ok(!audit.getDateChain('township').some((step) => step.id === 'budget_sheet'), '乡政府预算表不应再排进流程日期')
assert.ok(!checklist.getItems('township').some((item) => item.id === 'budget_sheet'), '乡政府清单不应再要预算表')
assert.ok(checklist.getItems('township').some((item) => item.id === 'quote_sheet'), '乡政府清单应保留报价表')

const townPlanEmpty = completeTownship()
townPlanEmpty.materials.impl_plan.date = ''
townPlanEmpty.materials.impl_plan.amount = ''
assert.deepStrictEqual(checklist.itemWritableFields(checklist.getItem('impl_plan', 'township')).sort(), ['amount', 'date'])
assert.ok(
  audit.isComplete(checklist.getItem('impl_plan', 'township'), townPlanEmpty.materials.impl_plan, townPlanEmpty),
  '乡政府实施方案不填日期金额仍算齐'
)
assert.strictEqual(audit.runAudit(townPlanEmpty).passed, true, '乡政府实施方案没有日期金额应自动通过')
assert.ok(!audit.getDateChain('township').some((step) => step.id === 'impl_plan'), '实施方案日期不应再排进流程日期')
assert.ok(
  !audit.auditProject(townPlanEmpty).warnings.some((row) => String(row.title).indexOf('未填日期') >= 0 && String(row.title).indexOf('实施方案') >= 0),
  '实施方案缺日期不应提示待补'
)
const planKept = applyParsed({ date: '', amount: '' }, { date: '2026-02-02', amount: 8800 }, checklist.itemWritableFields(checklist.getItem('impl_plan', 'township')))
assert.strictEqual(planKept.next.date, '2026-02-02', '实施方案认出日期应保留')
assert.strictEqual(planKept.next.amount, '8800', '实施方案认出金额应保留')

const missingDate = completeVillage()
missingDate.materials.minutes_party.date = ''
assert.ok(
  !audit.isComplete(checklist.getItem('minutes_party', 'village'), missingDate.materials.minutes_party, missingDate),
  '四议纪要缺日期不应算齐'
)
const missingDateView = audit.auditProject(missingDate)
assert.ok(missingDateView.warnings.some((row) => String(row.title).indexOf('未填日期') >= 0))
assert.ok(String(missingDateView.warnings.find((row) => String(row.title).indexOf('未填日期') >= 0).message).indexOf('更正：') >= 0)
assert.notStrictEqual(missingDateView.summary.tone, 'ok')

const minutesNoAmount = completeVillage()
;['minutes_party', 'minutes_two_committees', 'minutes_party_members', 'minutes_villagers', 'fund_briefing', 'fund_record', 'approval_form'].forEach((id) => {
  minutesNoAmount.materials[id].amount = ''
})
assert.ok(audit.isComplete(checklist.getItem('minutes_party', 'village'), minutesNoAmount.materials.minutes_party, minutesNoAmount), '纪要无金额仍算齐')
assert.strictEqual(audit.runAudit(minutesNoAmount).passed, true, '纪要、审批、会议材料不填金额应可通过')
assert.ok(!audit.auditProject(minutesNoAmount).warnings.some((row) => String(row.title).indexOf('未填金额') >= 0), '纪要等无金额栏不应提示待补金额')

const townMinutesNoAmount = completeTownship()
townMinutesNoAmount.materials.meeting_minutes.amount = ''
townMinutesNoAmount.materials.meeting_signin.amount = ''
assert.strictEqual(audit.runAudit(townMinutesNoAmount).passed, true, '乡政府会议纪要不填金额应可通过')

assert.ok(audit.getDateChain('village').some((step) => step.id === 'fund_record'))
assert.ok(!audit.getDateChain('village').some((step) => step.id === 'construction_plan'))
assert.strictEqual(audit.getDateChain('township').findIndex((step) => step.id === 'meeting_signin') < audit.getDateChain('township').findIndex((step) => step.id === 'meeting_minutes'), true)

const multiDate = completeVillage()
multiDate.materials.minutes_party.ocrText = '党支部提议\n开会时间：2026年2月20日\n印发日期：2026年2月28日'
const multiDateResult = audit.runAudit(multiDate)
assert.ok(multiDateResult.issues.some((i) => i.category === 'review' && i.itemId === 'minutes_party'), '同一张纪要多个日期对不上应拦报账')
assert.strictEqual(multiDateResult.passed, false)
const multiDateView = audit.auditProject(multiDate)
assert.ok(multiDateView.reviewIssues.some((row) => String(row.title).indexOf('人工核') >= 0))
assert.ok(String(multiDateView.reviewIssues[0].message).indexOf('更正：') >= 0)

const matchedNotice = completeVillage()
matchedNotice.materials.notice_resolution.ocrText = '现将使用决议公示如下\n自2026年3月1日至2026年3月7日'
assert.ok(!audit.runAudit(matchedNotice).issues.some((i) => i.category === 'review' && i.itemId === 'notice_resolution'), '公示起止都在图上应对得上')

const extraPrint = completeVillage()
extraPrint.materials.notice_resolution.ocrText = '现将使用决议公示如下\n自2026年3月1日至2026年3月7日\n印发 2026年2月10日'
assert.ok(audit.runAudit(extraPrint).issues.some((i) => i.category === 'review' && i.itemId === 'notice_resolution'), '公示图上多出印刷日期应警示')

const pairedPlanDates = completeVillage()
pairedPlanDates.materials.notice_resolution.ocrText = '使用决议公示\n自2026年3月1日至2026年3月7日\n使用实施方案公示\n印发 2026年2月20日'
assert.ok(
  !audit.runAudit(pairedPlanDates).issues.some((i) => i.category === 'review' && i.itemId === 'notice_resolution'),
  '同框实施方案上的日期无需核验'
)

const reviewed = completeVillage()
const reviewInfo = audit.inspectOcrDates(extraPrint, 'notice_resolution')
reviewed.materials.notice_resolution.ocrText = extraPrint.materials.notice_resolution.ocrText
reviewed.materials.notice_resolution.dateReviewOk = true
reviewed.materials.notice_resolution.dateReviewKey = reviewInfo.key
assert.ok(!audit.runAudit(reviewed).issues.some((i) => i.category === 'review' && i.itemId === 'notice_resolution'), '人工核对通过后不应再拦')

const stalePass = completeVillage()
stalePass.materials.notice_resolution.ocrText = extraPrint.materials.notice_resolution.ocrText
stalePass.materials.notice_resolution.dateReviewOk = true
stalePass.materials.notice_resolution.dateReviewKey = 'old'
assert.ok(audit.runAudit(stalePass).issues.some((i) => i.category === 'review' && i.itemId === 'notice_resolution'), '改日期或重认后旧通过应作废')

const deadlineLine = completeVillage()
deadlineLine.materials.notice_resolution.ocrText = '公示截止日期至2026年3月7日\n起始2026年3月1日\n印发 2026年2月10日'
assert.ok(audit.runAudit(deadlineLine).issues.some((i) => i.category === 'review' && i.itemId === 'notice_resolution'), '公示截止日期行上的日期不应被当成证件噪声丢掉')

const sameDateTwice = completeVillage()
sameDateTwice.materials.minutes_party.ocrText = '开会时间：2026年2月20日\n落款：2026年2月20日'
assert.ok(!audit.runAudit(sameDateTwice).issues.some((i) => i.category === 'review' && i.itemId === 'minutes_party'), '同一天写两次不应警示')

console.log('audit selfcheck ok')
