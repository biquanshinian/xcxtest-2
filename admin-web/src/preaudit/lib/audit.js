import * as checklist from './checklist.js'
import * as dateUtil from './date.js'
import * as format from './format.js'
import * as util from './util.js'
import * as orgUtil from './org.js'
import { documentDates, isDaysOnlyPublicity, parseOcrText } from './ocr-parse.js'

var AMOUNT_TOLERANCE = 1

var VILLAGE_DATE_CHAIN = [
  { id: 'approval_form', label: '项目审批', skipOrder: true },
  { id: 'minutes_party', label: '党支部提议' },
  { id: 'minutes_two_committees', label: '村两委商议' },
  { id: 'minutes_party_members', label: '党员大会审议' },
  { id: 'minutes_villagers', label: '村民代表会议决' },
  { id: 'fund_briefing', label: '经费专题会议' },
  { id: 'fund_record', label: '专题会议记录' },
  { id: 'notice_resolution', field: 'endDate', label: '决议公示结束' },
  { id: 'township_request', label: '乡政府请示批复' },
  { id: 'zbj_request', label: '八戒网招标请示' },
  { id: 'township_approval', label: '同意发布批复' },
  { id: 'review_report', label: '评审报告' },
  { id: 'bid_notice', label: '中标/成交通知' },
  { id: 'contract', label: '合同签订' },
  { id: 'accept_sheet', label: '验收单' },
  { id: 'invoices', label: '开具发票' },
  { id: 'result_public', field: 'endDate', label: '实施结果公示结束' }
]

var TOWNSHIP_DATE_CHAIN = [
  { id: 'approval_form', label: '审批表', skipOrder: true },
  { id: 'township_letter', label: '乡政府请示' },
  { id: 'meeting_signin', label: '会议签到' },
  { id: 'meeting_minutes', label: '会议纪要' },
  { id: 'notice_resolution', field: 'endDate', label: '决议公示结束' },
  { id: 'review_report', label: '评审报告' },
  { id: 'bid_notice', label: '中标/成交通知' },
  { id: 'contract', label: '合同签订' },
  { id: 'accept_sheet', label: '验收单' },
  { id: 'invoices', label: '开具发票' },
  { id: 'result_public', field: 'startDate', label: '实施结果公开起始' }
]

var SMALL_DATE_CHAIN = [
  { id: 'budget_quote', label: '预算金额报价' },
  { id: 'invoices', label: '开具发票' }
]

var DATE_CHAIN = VILLAGE_DATE_CHAIN

function orgTypeOf(project) {
  return checklist.getOrgType(project)
}

function getDateChain(orgType) {
  var type = orgTypeOf(orgType)
  if (type === 'township') return TOWNSHIP_DATE_CHAIN
  if (type === 'small') return SMALL_DATE_CHAIN
  return VILLAGE_DATE_CHAIN
}

function materialOf(project, itemId) {
  var base = checklist.emptyMaterial()
  var raw = (project && project.materials && project.materials[itemId]) || {}
  return Object.assign({}, base, raw, {
    files: Array.isArray(raw.files) ? raw.files : []
  })
}

function fileCount(mat) {
  return (mat.files || []).length
}

function hasMinFiles(item, mat, project) {
  if (item && item.allowConfirm && mat && mat.confirmed) return true
  if (mat && mat.scanFilled && checklist.itemCanSkipFilesAfterScan(item)) return true
  if (item && item.special === 'compare') return checklist.compareSlotsReady(project)
  var need = item.minFiles || 1
  if (fileCount(mat) >= need) return true
  if (item.shareFilesFrom && project) {
    return fileCount(materialOf(project, item.shareFilesFrom)) >= need
  }
  return false
}

function extraRangeOf(item, mat, project) {
  if (!item || !item.extraRange) return { start: '', end: '' }
  var start = (mat && mat.extraRangeStart) || ''
  var end = (mat && mat.extraRangeEnd) || ''
  if (project) {
    var plan = materialOf(project, 'notice_plan')
    if (!start) start = plan.startDate || ''
    if (!end) end = plan.endDate || ''
  }
  var minDays = item.extraRange.minDays || 7
  if (!end && start) end = dateUtil.noticeEnd(start, minDays)
  return { start: start, end: end }
}

function withPlanDates(project, mat) {
  var res = materialOf(project, 'notice_resolution')
  return Object.assign({}, mat, {
    startDate: (mat && mat.startDate) || res.extraRangeStart || '',
    endDate: (mat && mat.endDate) || res.extraRangeEnd || ''
  })
}

function publicityRange(mat, item) {
  var start = (mat && mat.startDate) || ''
  var end = (mat && mat.endDate) || ''
  return { start: start, end: end }
}

function reasonFix(reason, fix) {
  return '原因：' + reason + '\n更正：' + fix
}

function itemDate(project, itemId, which) {
  var org = orgTypeOf(project)
  var item = checklist.getItem(itemId, org)
  var mat = materialOf(project, itemId)
  if (itemId === 'notice_plan') mat = withPlanDates(project, mat)
  if (which === 'start' || which === 'end') {
    var range = publicityRange(mat, item)
    if (which === 'start') return range.start || mat.date || ''
    return range.end || mat.date || ''
  }
  return mat.date || ''
}

function amountInherited(item) {
  return !!(item && (item.role === 'contract' || item.role === 'invoice'))
}

function canonicalAward(project) {
  var org = orgTypeOf(project)
  if (org === 'small') {
    var compare = materialOf(project, 'compare_sheet')
    return {
      key: 'compare_sheet',
      name: '三家比价低价',
      amount: format.parseMoney(compare.amount),
      date: ''
    }
  }
  var award = materialOf(project, 'bid_notice')
  return {
    key: 'bid_notice',
    name: '中标/成交通知',
    amount: format.parseMoney(award.amount || (project && (project.awardAmount || project.bidAmount))),
    date: award.date || (project && (project.awardDate || project.bidDate)) || ''
  }
}

function isCanonicalItem(item, project) {
  var canon = canonicalAward(project)
  return !!(item && (item.id === canon.key || item.role === 'award' || item.role === 'lowest'))
}

function isPublicityItem(item) {
  var fields = (item && item.fields) || []
  return !!(item && (item.role === 'publicity' || fields.indexOf('startDate') >= 0))
}

function effectiveAmount(mat, project) {
  var parsed = format.parseMoney(mat && mat.amount)
  if (parsed !== null) return parsed
  return canonicalAward(project).amount
}

function fieldsFilled(item, mat, project) {
  var fields = item.fields || []
  for (var i = 0; i < fields.length; i++) {
    var f = fields[i]
    if (f === 'people') continue
    if (f === 'endDate' || f === 'startDate') {
      if (!isPublicityItem(item)) continue
      if (f === 'endDate') {
        if (!mat.endDate) return false
        continue
      }
      if (!mat.startDate) return false
      continue
    }
    if (f === 'date') {
      if (!mat.date) return false
      continue
    }
    if (f === 'amount') {
      if (amountInherited(item)) continue
      if (mat.amount === '' || mat.amount === null || mat.amount === undefined) return false
    }
  }
  return true
}

function needsPairedReshoot(item, mat) {
  return !!(item && item.requirePairedPhoto && !(mat && mat.pairedPhoto))
}

function describeFieldGap(item, mat, project) {
  var canon = canonicalAward(project)
  var name = item.name
  if (isCanonicalItem(item, project)) {
    var needDate = (item.fields || []).indexOf('date') >= 0
    var missingDate = needDate && !mat.date
    var missingAmt = mat.amount === '' || mat.amount == null
    if (missingDate || missingAmt) {
      return {
        title: '请先认' + canon.name + '：' + name,
        detail: reasonFix(
          canon.key === 'compare_sheet'
            ? '比价低价金额是后面发票比对的基准，现在还空着。'
            : '中标/成交日期和金额是后面合同、发票比对的基准，现在还空着。',
          canon.key === 'compare_sheet'
            ? '打开「' + name + '」，把低价报价单拍照或上传后识别，或手填低价金额和公司名称。'
            : '打开「' + name + '」，点「识别填写」或按通知书手填日期和金额。其它项金额空着时，一律按这个数对。'
        )
      }
    }
  }
  var fields = item.fields || []
  if (fields.indexOf('amount') >= 0 && !amountInherited(item) && (mat.amount === '' || mat.amount == null)) {
    return {
      title: '未填金额：' + name,
      detail: reasonFix(
        '已上传，但核验信息没有金额，无法和报账、中标、发票核对。',
        '打开「' + name + '」，点「扫一扫填数据」对准纸面认，或按纸质件手填；OCR 认错也可直接改。'
      )
    }
  }
  if (fields.indexOf('startDate') >= 0 && !mat.startDate) {
    return {
      title: '未填公示起始日：' + name,
      detail: reasonFix(
        '已上传，但公示起止还空着。公示必须写成日期范围，不能只写「7 天」。',
        '打开「' + name + '」，按纸上的「自×年×月×日至×年×月×日」填写起始日和截止日。'
      )
    }
  }
  if (fields.indexOf('endDate') >= 0 && !mat.endDate) {
    return {
      title: '未填公示截止日：' + name,
      detail: reasonFix(
        '已填起始日，但截止日还空着。公示须写完整起止日期，含首尾满 7 天，不能只写天数。',
        '打开「' + name + '」，按纸上的截止日填写；若纸上没写起止，须把文件改成日期范围后再认。'
      )
    }
  }
  return {
    title: '未填日期：' + name,
    detail: reasonFix(
      '已上传，但核验信息没有日期，无法核对这项和前后环节谁先谁后。',
      '打开「' + name + '」，点「扫一扫填数据」或按纸质件落款选择日期；也可识别已上传的图后再手改。'
    )
  }
}

function isUploaded(item, mat, project) {
  if (item && item.allowConfirm && mat && mat.confirmed) return true
  if (mat && mat.scanFilled && checklist.itemCanSkipFilesAfterScan(item)) return true
  if (needsPairedReshoot(item, mat)) return false
  if (item && item.special === 'compare') return checklist.compareSlotsReady(project)
  return fileCount(mat) >= 1
}

function peopleStats(mat) {
  var list = mat.people || []
  if (list.length) {
    var village = 0
    var supervisor = 0
    var named = 0
    list.forEach(function (person) {
      if (person && String(person.name || '').trim()) named += 1
      if (person && person.role === 'village') village += 1
      if (person && person.role === 'supervisor') supervisor += 1
    })
    return {
      people: named || list.length,
      committee: village,
      hasSupervisor: supervisor > 0
    }
  }
  return {
    people: format.parseMoney(mat.peopleCount),
    committee: format.parseMoney(mat.committeeCount),
    hasSupervisor: !!mat.hasSupervisor
  }
}

function peopleRulePass(mat, org) {
  var stats = peopleStats(mat)
  if (org === 'township') {
    if (stats.people !== null && stats.people >= 1) {
      return { ok: true, preferred: true }
    }
    return {
      ok: false,
      preferred: false,
      message: '请登记到场总人数，至少 1 人。乡政府验收不必确认监督员是否到场。'
    }
  }
  var preferred = stats.committee !== null && stats.committee >= 2 && stats.hasSupervisor
  var fallback = stats.people !== null && stats.people >= 3
  if (preferred || fallback) {
    return { ok: true, preferred: preferred }
  }
  return {
    ok: false,
    preferred: false,
    message: '验收宜有村委会两人及监督委员到场；若没有监督委员，请至少保证照片能看出三个人作为佐证，并登记到场人员。'
  }
}

function isComplete(item, mat, project) {
  if (!hasMinFiles(item, mat, project)) return false
  if (needsPairedReshoot(item, mat)) return false
  if (!fieldsFilled(item, mat, project)) return false
  if (item.needsPeople && !peopleRulePass(mat, item.orgType).ok) return false
  return true
}

function itemStamp(step, mat, orgType, project) {
  if (step.id === 'notice_plan' && project) mat = withPlanDates(project, mat)
  if (step.field === 'endDate' || step.field === 'startDate') {
    var item = checklist.getItem(step.id, orgType)
    var range = publicityRange(mat, item)
    if (step.field === 'endDate') return range.end || ''
    return range.start || ''
  }
  return mat.date || ''
}

function pushIssue(issues, spec) {
  issues.push({
    id: spec.id || spec.category + '_' + (spec.itemId || 'x') + '_' + issues.length,
    level: spec.level || 'warn',
    category: spec.category,
    itemId: spec.itemId || '',
    itemName: spec.itemName || '',
    title: spec.title,
    detail: spec.detail || ''
  })
}

function checkMissing(project, issues) {
  var org = orgTypeOf(project)
  checklist.getRequiredItems(org).forEach(function (item) {
    if (item.hidden) return
    var mat = materialOf(project, item.id)
    if (!hasMinFiles(item, mat, project)) {
      if (item.special === 'compare') {
        var miss = checklist.missingCompareNames(project)
        pushIssue(issues, {
          category: 'missing',
          level: 'error',
          itemId: item.id,
          itemName: item.name,
          title: '缺项：' + item.name,
          detail: reasonFix(
            miss.length
              ? '高价、中价、低价须各有照片，还缺：' + miss.join('、') + '。'
              : '高价、中价、低价还没拍齐。',
            '打开「' + item.name + '」，按高、中、低三个框分别拍照或上传。不核验日期。'
          )
        })
        return
      }
      var need = item.minFiles || 1
      pushIssue(issues, {
        category: 'missing',
        level: 'error',
        itemId: item.id,
        itemName: item.name,
        title: '缺项：' + item.name,
        detail:
          fileCount(mat) === 0
            ? item.allowConfirm
              ? reasonFix(
                '这项还没传，也还没点确认。',
                '打开「' + item.name + '」点「扫一扫填数据」用摄像头认日期金额（图不保存），或上传照片；纸质件已备齐也可点「无需上传，确认已备齐」。'
              )
              : checklist.itemCanScanFill(item)
                ? reasonFix(
                  '这项还没传，也还没扫描填数。',
                  '打开「' + item.name + '」，点「扫一扫填数据」对准纸面认日期金额，图不保存也不必上传。'
                )
                : reasonFix(
                  '这项还没传，报账资料不齐。',
                  '打开「' + item.name + '」，把照片或扫描件补上后再核验。'
                )
            : reasonFix(
              '已传 ' + fileCount(mat) + ' 张，至少需要 ' + need + ' 张。',
              '打开「' + item.name + '」，再补 ' + (need - fileCount(mat)) + ' 张。'
            )
      })
      return
    }
    if (needsPairedReshoot(item, mat)) {
      pushIssue(issues, {
        category: 'missing',
        level: 'error',
        itemId: item.id,
        itemName: item.name,
        title: '需要重拍：' + item.name,
        detail: reasonFix(
          '原先分开拍的不算。财务要求决议公示和实施方案公示一张同框照，实施结果公示和实施方案公示一张同框照。',
          '打开「' + item.name + '」，把两份公示贴在墙上后重拍一张同框照。新传的会换掉旧图。'
        )
      })
      return
    }
    if (!fieldsFilled(item, mat, project)) {
      var gap = describeFieldGap(item, mat, project)
      pushIssue(issues, {
        category: 'missing',
        level: 'warn',
        itemId: item.id,
        itemName: item.name,
        title: gap.title,
        detail: gap.detail
      })
    }
  })
}

function checkNoticeDays(project, issues, itemId, titlePrefix, levelIfShort) {
  var org = orgTypeOf(project)
  var item = checklist.getItem(itemId, org)
  if (!item) return { item: null, mat: null, range: { start: '', end: '' } }
  var mat = materialOf(project, itemId)
  if (itemId === 'notice_plan') mat = withPlanDates(project, mat)
  var range = publicityRange(mat, item)
  if (range.start && range.end) {
    var days = dateUtil.inclusiveDayCount(range.start, range.end)
    if (days === null) {
      pushIssue(issues, {
        category: 'date',
        level: 'warn',
        itemId: itemId,
        itemName: item.name,
        title: titlePrefix + '日期无法识别',
        detail: reasonFix(
          '公示起止日期格式不对，无法计算公示天数。',
          '打开「' + item.name + '」，用日期框按年-月-日重新选择起始日和截止日。'
        )
      })
    } else if (days < 1) {
      pushIssue(issues, {
        category: 'date',
        level: 'error',
        itemId: itemId,
        itemName: item.name,
        title: titlePrefix + '起止颠倒',
        detail: reasonFix(
          '结束日期早于开始日期，公示天数算出来是负数。',
          '打开「' + item.name + '」，按墙上公示纸把起始日和截止日改对。截止日必须在起始日当天或之后。'
        )
      })
    } else if (days < (item.minDays || 7)) {
      pushIssue(issues, {
        category: 'date',
        level: levelIfShort || 'error',
        itemId: itemId,
        itemName: item.name,
        title: titlePrefix + '不足 7 天',
        detail: reasonFix(
          '公示期为 ' +
            range.start +
            ' 至 ' +
            range.end +
            '，含首尾共 ' +
            days +
            ' 天，少于规定的 7 天。',
          '打开「' +
            item.name +
            '」，把截止日改到 ' +
            dateUtil.noticeEnd(range.start, item.minDays || 7) +
            ' 或更晚（从 ' +
            range.start +
            ' 起含首尾满 ' +
            (item.minDays || 7) +
            ' 天）。'
        )
      })
    }
  }
  return { item: item, mat: mat, range: range }
}

function checkPublicityAndFraud(project, issues) {
  var org = orgTypeOf(project)
  var notice = checkNoticeDays(project, issues, 'notice_resolution', '决议公示', 'error')
  if (org !== 'small') {
    checkNoticeDays(
      project,
      issues,
      'result_public',
      org === 'township' ? '实施结果公开' : '实施结果公示',
      'error'
    )
    checkPublicityPaperRange(project, issues)
  }
  if (org !== 'township' && org !== 'small') {
    checkPairedPublicityPhoto(
      project,
      issues,
      'notice_resolution',
      '决议公示未见实施方案公示',
      '财务要求决议公示和实施方案公示用手机同框拍一张。请把两份公示贴在墙上一起拍。'
    )
    checkPairedPublicityPhoto(
      project,
      issues,
      'result_public',
      '实施结果公示未见实施方案公示',
      '财务要求实施结果公示也必须和实施方案公示同框拍一张。请把两份公示贴在墙上一起拍。'
    )
  }

  var award = materialOf(project, 'bid_notice')
  var contract = materialOf(project, 'contract')
  var invoice = materialOf(project, 'invoices')
  var awardDate = award.date || project.awardDate || project.bidDate || ''
  var contractDate = contract.date || ''
  var invoiceDate = invoice.date || ''

  flagIfInPublicity(issues, awardDate, '中标/成交日期', 'bid_notice', '中标/成交通知（彩打）', notice.range, '决议')
  flagIfInPublicity(issues, contractDate, '合同签订日期', 'contract', '施工/采购合同', notice.range, '决议')
  flagIfInPublicity(issues, invoiceDate, '开票日期', 'invoices', '合同对应清单发票', notice.range, '决议')
}

function uniqueDates(list) {
  var seen = Object.create(null)
  var out = []
  ;(list || []).forEach(function (item) {
    var iso = String(item || '')
    if (!iso || seen[iso]) return
    seen[iso] = true
    out.push(iso)
  })
  return out
}

function expectedDatesOf(item, mat, project) {
  var out = []
  var fields = (item && item.fields) || []
  if (fields.indexOf('date') >= 0 && mat && mat.date) out.push(mat.date)
  if (isPublicityItem(item)) {
    var range = publicityRange(mat, item)
    if (range.start) out.push(range.start)
    if (range.end) out.push(range.end)
  }
  if (item && item.extraRange) {
    var extra = extraRangeOf(item, mat, project)
    if (extra.start) out.push(extra.start)
    if (extra.end) out.push(extra.end)
  }
  return uniqueDates(out)
}

function dateRangesOf(item, mat, project) {
  var list = []
  if (isPublicityItem(item)) {
    var range = publicityRange(mat, item)
    if (range.start && range.end) list.push(range)
  }
  if (item && item.extraRange) {
    var extra = extraRangeOf(item, mat, project)
    if (extra.start && extra.end) list.push(extra)
  }
  return list
}

function dateAccounted(iso, expected, ranges) {
  if ((expected || []).indexOf(iso) >= 0) return true
  for (var i = 0; i < (ranges || []).length; i++) {
    if (dateUtil.inRangeInclusive(iso, ranges[i].start, ranges[i].end) === true) return true
  }
  return false
}

function ocrTextChunks(mat) {
  var chunks = []
  ;(mat && mat.files ? mat.files : []).forEach(function (file, i) {
    if (!file || !file.ocrText) return
    chunks.push({
      label: file.caption || file.name || ('第' + (i + 1) + '张'),
      text: String(file.ocrText)
    })
  })
  if (!chunks.length && mat && mat.ocrText) {
    chunks.push({ label: '识别原文', text: String(mat.ocrText) })
  }
  return chunks
}

function dateReviewFingerprint(ocrDates, expected) {
  return uniqueDates(ocrDates).slice().sort().join(',') + '#' + uniqueDates(expected).slice().sort().join(',')
}

function inspectOcrDates(project, itemId) {
  var org = orgTypeOf(project)
  var item = checklist.getItem(itemId, org)
  var empty = {
    conflict: false,
    key: '',
    ocrDates: [],
    expected: [],
    label: '',
    unmatched: [],
    reviewed: false
  }
  if (!item) return empty
  var fields = item.fields || []
  if (fields.indexOf('date') < 0 && fields.indexOf('startDate') < 0 && fields.indexOf('endDate') < 0) return empty
  var mat = materialOf(project, itemId)
  if (itemId === 'notice_plan') mat = withPlanDates(project, mat)
  var expected = expectedDatesOf(item, mat, project)
  var ranges = dateRangesOf(item, mat, project)
  var ocrDates = []
  var unmatched = []
  var labels = []
  ocrTextChunks(mat).forEach(function (chunk) {
    var found = documentDates(chunk.text)
    if (found.length < 2) return
    found.forEach(function (iso) {
      if (ocrDates.indexOf(iso) < 0) ocrDates.push(iso)
      if (!dateAccounted(iso, expected, ranges) && unmatched.indexOf(iso) < 0) {
        unmatched.push(iso)
        if (labels.indexOf(chunk.label) < 0) labels.push(chunk.label)
      }
    })
  })
  if (item.requirePairedPhoto && collectOcrText(mat).indexOf('实施方案公示') >= 0) {
    unmatched = []
  }
  var key = dateReviewFingerprint(ocrDates, expected)
  return {
    conflict: unmatched.length > 0,
    key: key,
    ocrDates: ocrDates,
    expected: expected,
    label: labels.join('、'),
    unmatched: unmatched,
    reviewed: !!(mat.dateReviewOk && mat.dateReviewKey === key)
  }
}

function checkOcrDateConflict(project, issues) {
  var org = orgTypeOf(project)
  checklist.getRequiredItems(org).forEach(function (item) {
    if (item.hidden) return
    var info = inspectOcrDates(project, item.id)
    if (!info.conflict || info.reviewed) return
    var seen = info.ocrDates.join('、')
    var filled = info.expected.length ? '填写的日期是 ' + info.expected.join('、') + '。' : '核验信息里还没填这些日期。'
    var extra = info.unmatched.length ? '对不上的是 ' + info.unmatched.join('、') + '。' : ''
    pushIssue(issues, {
      category: 'review',
      level: 'error',
      itemId: item.id,
      itemName: item.name,
      title: '图上多个日期需人工核对：' + item.name,
      detail: reasonFix(
        (info.label ? '「' + info.label + '」' : '这张图') +
          '认出多个日期：' +
          seen +
          '。' +
          filled +
          extra,
        '打开「' +
          item.name +
          '」对照原图。若页脚、印刷日期可忽略，点「核对无误，通过」；若落款认错或填错，改核验信息里的日期后再核验。'
      )
    })
  })
}

function collectOcrText(mat) {
  var parts = []
  if (mat && mat.ocrText) parts.push(String(mat.ocrText))
  ;(mat && mat.files ? mat.files : []).forEach(function (file) {
    if (file && file.ocrText) parts.push(String(file.ocrText))
  })
  return parts.join('\n').replace(/\s+/g, '')
}

function checkPairedPublicityPhoto(project, issues, itemId, title, detail) {
  var org = orgTypeOf(project)
  var item = checklist.getItem(itemId, org)
  if (!item) return
  var mat = materialOf(project, itemId)
  if (!hasMinFiles(item, mat, project)) return
  if (needsPairedReshoot(item, mat)) return
  var text = collectOcrText(mat)
  if (text.length < 20) return
  if (text.indexOf('实施方案公示') >= 0) return
  pushIssue(issues, {
    category: 'missing',
    level: 'error',
    itemId: itemId,
    itemName: item.name,
    title: title,
    detail: reasonFix(
      detail,
      '打开「' + item.name + '」，把两份公示贴墙上后同框重拍一张。新传的会换掉未配对的旧图。'
    )
  })
}

function flagIfInPublicity(issues, date, label, itemId, itemName, range, noticeName) {
  if (!date || !range || !range.start || !range.end) return
  if (!dateUtil.inRangeInclusive(date, range.start, range.end)) return
  pushIssue(issues, {
    category: 'fraud',
    level: 'error',
    itemId: itemId,
    itemName: itemName,
    title: '假账嫌疑：' + label + '落在' + noticeName + '公示期内',
    detail: reasonFix(
      noticeName +
        '公示为 ' +
        range.start +
        ' 至 ' +
        range.end +
        '，' +
        label +
        '为 ' +
        date +
        '。公示还没结束就定标、签合同或开票，存在做假账嫌疑。',
      '先核对「' +
        itemName +
        '」日期是否认错或填错。若纸质件日期属实，须等公示截止日 ' +
        range.end +
        ' 之后再定标/签约/开票，并把该项日期改到截止日之后。'
    )
  })
}

function checkSequence(project, issues) {
  var org = orgTypeOf(project)
  var stamps = []
  getDateChain(org).forEach(function (step) {
    var mat = materialOf(project, step.id)
    var value = itemStamp(step, mat, org, project)
    if (!value) return
    if (step.skipOrder) return
    var parsed = dateUtil.parseDate(value)
    if (!parsed) return
    stamps.push({
      id: step.id,
      label: step.label,
      date: value,
      time: parsed.getTime()
    })
  })
  for (var i = 1; i < stamps.length; i++) {
    var prev = stamps[i - 1]
    var cur = stamps[i]
    if (cur.time < prev.time) {
      var item = checklist.getItem(cur.id, org)
      pushIssue(issues, {
        category: 'date',
        level: 'error',
        itemId: cur.id,
        itemName: item ? item.name : cur.label,
        title: '日期顺序异常：' + prev.label + ' 晚于 ' + cur.label,
        detail: reasonFix(
          '按报账流程，「' +
            cur.label +
            '」不能早于「' +
            prev.label +
            '」。现在 ' +
            prev.label +
            ' 为 ' +
            prev.date +
            '，' +
            cur.label +
            ' 为 ' +
            cur.date +
            '。',
          '打开「' +
            (item ? item.name : cur.label) +
            '」，把日期改到 ' +
            prev.date +
            ' 当天或之后。若是前一项填错，打开「' +
            prev.label +
            '」按纸质件落款改。'
        )
      })
    }
  }
}

function checkPublicityPaperRange(project, issues) {
  var org = orgTypeOf(project)
  ;['notice_resolution', 'result_public'].forEach(function (itemId) {
    var item = checklist.getItem(itemId, org)
    if (!item || !item.minDays) return
    var mat = materialOf(project, itemId)
    var text = collectOcrText(mat)
    if (!text || text.replace(/\s+/g, '').length < 8) return
    if (!isDaysOnlyPublicity(text)) return
    pushIssue(issues, {
      category: 'date',
      level: 'error',
      itemId: itemId,
      itemName: item.name,
      title: '公示须写起止日期：' + item.name,
      detail: reasonFix(
        '文件上只写了公示天数，没有起始日和截止日。公示必须写成日期范围，不能只写「7 天」。',
        '打开「' +
          item.name +
          '」，把纸上改成「自×年×月×日至×年×月×日」（含首尾满 7 天）后重新拍照识别。'
      )
    })
  })
}

function flagUnlessAfter(project, issues, spec) {
  if (!spec.beforeDate || !spec.afterDate) return
  if (dateUtil.lt(spec.beforeDate, spec.afterDate)) return
  var org = orgTypeOf(project)
  var item = checklist.getItem(spec.afterId, org)
  var name = item ? item.name : spec.afterLabel
  var nextDay = dateUtil.addDays(spec.beforeDate, 1)
  pushIssue(issues, {
    category: 'date',
    level: 'error',
    itemId: spec.afterId,
    itemName: name,
    title: '日期顺序异常：' + spec.afterLabel + ' 须晚于 ' + spec.beforeLabel,
    detail: reasonFix(
      spec.reason ||
        ('「' +
          spec.afterLabel +
          '」为 ' +
          spec.afterDate +
          '，须晚于「' +
          spec.beforeLabel +
          '」' +
          spec.beforeDate +
          '。'),
      spec.fix ||
        ('打开「' + name + '」，把起始日改到 ' + nextDay + ' 或之后。')
    )
  })
}

function flagEarlierThan(project, issues, spec) {
  if (!spec.beforeDate || !spec.afterDate) return
  if (!dateUtil.lt(spec.afterDate, spec.beforeDate)) return
  var org = orgTypeOf(project)
  var item = checklist.getItem(spec.afterId, org)
  var name = item ? item.name : spec.afterLabel
  pushIssue(issues, {
    category: 'date',
    level: 'error',
    itemId: spec.afterId,
    itemName: name,
    title: '日期顺序异常：' + spec.afterLabel + ' 早于 ' + spec.beforeLabel,
    detail: reasonFix(
      spec.reason ||
        ('「' +
          spec.afterLabel +
          '」为 ' +
          spec.afterDate +
          '，早于「' +
          spec.beforeLabel +
          '」' +
          spec.beforeDate +
          '。'),
      spec.fix ||
        ('打开「' + name + '」，把日期改到 ' + spec.beforeDate + ' 当天或之后。')
    )
  })
}

function checkAnchoredDates(project, issues) {
  var org = orgTypeOf(project)
  if (org === 'small') return

  var acceptDate = itemDate(project, 'accept_sheet', 'date')
  var bidDate = itemDate(project, 'bid_notice', 'date') || project.awardDate || project.bidDate || ''

  if (org === 'village') {
    var meetingDate = dateUtil.maxDate([
      itemDate(project, 'minutes_villagers', 'date'),
      itemDate(project, 'fund_briefing', 'date'),
      itemDate(project, 'fund_record', 'date')
    ])
    flagEarlierThan(project, issues, {
      beforeDate: meetingDate,
      beforeLabel: '村民代表会议/专题会议',
      afterDate: itemDate(project, 'notice_resolution', 'start'),
      afterLabel: '决议公示起始',
      afterId: 'notice_resolution',
      reason:
        '决议公示起始日为 ' +
        itemDate(project, 'notice_resolution', 'start') +
        '，早于开会日期 ' +
        meetingDate +
        '。会议还没开完不能先公示。',
      fix:
        '打开「决议公示与实施方案公示」，把决议公示起始日改到 ' +
        meetingDate +
        ' 当天或之后。'
    })
    var planDate = itemDate(project, 'construction_plan', 'date')
    flagEarlierThan(project, issues, {
      beforeDate: bidDate,
      beforeLabel: '中标/成交通知',
      afterDate: planDate,
      afterLabel: '施工方案',
      afterId: 'construction_plan',
      reason: '施工方案日期为 ' + planDate + '，早于中标/成交 ' + bidDate + '。中标前不应先出施工方案落款。',
      fix: '打开「施工方案」，按编制/通过日期改到中标日 ' + bidDate + ' 当天或之后。'
    })
  }

  if (org === 'township') {
    var meetDate = dateUtil.maxDate([
      itemDate(project, 'meeting_signin', 'date'),
      itemDate(project, 'meeting_minutes', 'date')
    ])
    flagEarlierThan(project, issues, {
      beforeDate: meetDate,
      beforeLabel: '决议会议',
      afterDate: itemDate(project, 'notice_resolution', 'start'),
      afterLabel: '决议公示起始',
      afterId: 'notice_resolution',
      reason:
        '决议公示起始日为 ' +
        itemDate(project, 'notice_resolution', 'start') +
        '，早于会议签到/纪要 ' +
        meetDate +
        '。',
      fix: '打开「决议公示」，把起始日改到会议日 ' + meetDate + ' 当天或之后。'
    })
  }

  var resultStart = itemDate(project, 'result_public', 'start')
  var nextPublic = dateUtil.addDays(acceptDate, 1)
  var resultOpenName = org === 'township' ? '实施结果公开' : '实施结果公示与实施方案公示'
  flagUnlessAfter(project, issues, {
    beforeDate: acceptDate,
    beforeLabel: '验收单',
    afterDate: resultStart,
    afterLabel: org === 'township' ? '实施结果公开起始' : '实施结果公示起始',
    afterId: 'result_public',
    reason:
      (org === 'township' ? '实施结果公开起始日为 ' : '实施结果公示起始日为 ') +
      resultStart +
      '，须晚于验收单 ' +
      acceptDate +
      '。验收当天不能做实施结果公开，须从次日开始。',
    fix:
      '打开「' +
      resultOpenName +
      '」，把起始日改到验收次日 ' +
      nextPublic +
      ' 或之后，并按纸面填写截止日（含首尾满 7 天）。'
  })
}

function isJointBid(project) {
  if (orgTypeOf(project) !== 'village') return false
  if (project && project.jointBid) return true
  if (format.parseMoney(project && project.partnerAmount) !== null) return true
  return !!String((project && project.partnerVillage) || '').trim()
}

function packageAmountOf(awardAmt, contractAmt) {
  if (awardAmt !== null) return awardAmt
  return contractAmt
}

function checkJointInvoice(issues, invoiceAmt, thisShare, packageAmt) {
  var effective = invoiceAmt !== null ? invoiceAmt : thisShare
  if (effective === null) return
  if (thisShare !== null && format.moneyClose(effective, thisShare, 0)) return

  if (
    packageAmt !== null &&
    format.moneyClose(effective, packageAmt, 0) &&
    (thisShare === null || !format.moneyClose(thisShare, packageAmt, 0))
  ) {
    pushIssue(issues, {
      category: 'amount',
      level: 'error',
      itemId: 'invoices',
      itemName: '合同对应清单发票',
      title: '打包招标须按村分开开票',
      detail: reasonFix(
        '发票是整包总价 ' +
          format.formatMoney(effective) +
          ' 元。两村应各自按实施结果分开报账、分开开具，本村发票须等于本村实施结果金额' +
          (thisShare !== null ? ' ' + format.formatMoney(thisShare) + ' 元' : '') +
          '，不能开一整张整包票。',
        '打开「合同对应清单发票」，把金额改成本村实施结果' +
          (thisShare !== null ? ' ' + format.formatMoney(thisShare) + ' 元' : '') +
          '，并按村重新开票，不要用整包总价一张票。'
      )
    })
    return
  }

  if (thisShare !== null) {
    comparePair(issues, thisShare, effective, '本村实施结果', '本村发票', 'invoices', '合同对应清单发票', 0)
  }
}

function checkJointSplit(project, issues, packageAmt, thisShare, invoiceAmt) {
  var otherShare = format.parseMoney(project && project.partnerAmount)
  var otherName = String((project && project.partnerVillage) || '').trim() || '另一村'
  var thisName = String((project && project.village) || '').trim() || '本村'

  if (thisShare !== null && packageAmt !== null && thisShare > packageAmt && !format.moneyClose(thisShare, packageAmt, 1)) {
    pushIssue(issues, {
      category: 'amount',
      level: 'error',
      itemId: 'bid_notice',
      itemName: '中标/成交通知（彩打）',
      title: '本村申请额高于整包总价',
      detail:
        thisName +
        '申请 ' +
        format.formatMoney(thisShare) +
        ' 元，高于整包中标/合同 ' +
        format.formatMoney(packageAmt) +
        ' 元。请核对是否填错。'
    })
  }

  if (thisShare !== null && packageAmt !== null && format.moneyClose(thisShare, packageAmt, 1)) {
    pushIssue(issues, {
      category: 'amount',
      level: 'warn',
      itemId: '',
      itemName: '',
      title: '已勾选两村打包，但本村申请额等于整包总价',
      detail: reasonFix(
        '已勾选两村打包，但本村申请金额等于整包中标/合同总价，分摊关系对不上。',
        '到「编辑项目」把本村实施结果改成该村份额，并填另一村名称和申请金额，两村之和须等于整包总价。'
      )
    })
  }

  if (thisShare !== null && packageAmt !== null && !format.moneyClose(thisShare, packageAmt, 1)) {
    if (otherShare === null) {
      pushIssue(issues, {
        category: 'amount',
        level: 'error',
        itemId: '',
        itemName: '',
        title: '两村打包须填另一村申请金额',
        detail:
          thisName +
          '申请 ' +
          format.formatMoney(thisShare) +
          ' 元，整包总价 ' +
          format.formatMoney(packageAmt) +
          ' 元。请在编辑项目里填另一村名称和申请金额，两村之和须等于整包总价。'
      })
    } else if (!format.moneyClose(thisShare + otherShare, packageAmt, 0)) {
      pushIssue(issues, {
        category: 'amount',
        level: 'error',
        itemId: '',
        itemName: '',
        title: '两村申请额之和对不上整包总价',
        detail:
          thisName +
          ' ' +
          format.formatMoney(thisShare) +
          ' 元 + ' +
          otherName +
          ' ' +
          format.formatMoney(otherShare) +
          ' 元 = ' +
          format.formatMoney(thisShare + otherShare) +
          ' 元，整包中标/合同为 ' +
          format.formatMoney(packageAmt) +
          ' 元，须一分不差。'
      })
    }
  } else if (otherShare !== null && thisShare === null && packageAmt !== null) {
    pushIssue(issues, {
      category: 'amount',
      level: 'warn',
      itemId: '',
      itemName: '',
      title: '请填本村申请金额',
      detail: '已按两村打包。本村报账金额 + ' + otherName + '申请金额，应等于整包总价。'
    })
  }

  if (otherName !== '另一村' && thisName !== '本村' && otherName === thisName) {
    pushIssue(issues, {
      category: 'amount',
      level: 'warn',
      itemId: '',
      itemName: '',
      title: '另一村与本村同名',
      detail: '请确认是否填成了同一个村。'
    })
  }

  checkJointInvoice(issues, invoiceAmt, thisShare, packageAmt)
}

function comparePair(issues, a, b, aName, bName, itemId, itemName, tolerance) {
  if (a === null || b === null) return
  var limit = tolerance == null ? AMOUNT_TOLERANCE : tolerance
  if (!format.moneyClose(a, b, limit)) {
    var note = limit === 0
      ? '须完全一致，一分钱都不能差。'
      : '允许误差 ±' + limit + ' 元。'
    pushIssue(issues, {
      category: 'amount',
      level: 'error',
      itemId: itemId,
      itemName: itemName,
      title: '金额不符：' + aName + ' 与 ' + bName,
      detail: reasonFix(
        aName +
          ' ' +
          format.formatMoney(a) +
          ' 元，' +
          bName +
          ' ' +
          format.formatMoney(b) +
          ' 元，差额 ' +
          format.formatMoney(format.absDiff(a, b)) +
          ' 元。' +
          note,
        '打开「' + itemName + '」核验信息，按纸质件手改金额，使两边数字一致后再核验。若成交金额认错，先改「中标/成交通知」或「三家比价」低价金额。'
      )
    })
  }
}

function normalizeCompanyName(value) {
  return String(value || '')
    .replace(/\s+/g, '')
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/有限责任公司|股份有限公司|有限公司|集团|公司/g, '')
}

function companyNamesAlign(a, b) {
  var x = normalizeCompanyName(a)
  var y = normalizeCompanyName(b)
  if (!x || !y) return true
  if (x === y) return true
  return x.indexOf(y) >= 0 || y.indexOf(x) >= 0
}

function checkAmounts(project, issues) {
  var org = orgTypeOf(project)
  var budgetAmt = format.parseMoney(project.budgetAmount)

  if (org === 'small') {
    var quote = materialOf(project, 'budget_quote')
    var compare = materialOf(project, 'compare_sheet')
    var invoice = materialOf(project, 'invoices')
    var quoteAmt = format.parseMoney(quote.amount)
    var lowestAmt = format.parseMoney(compare.amount)
    var invoiceAmt = format.parseMoney(invoice.amount)
    if (invoiceAmt === null) invoiceAmt = lowestAmt
    comparePair(issues, quoteAmt, budgetAmt, '预算报价', '项目报账金额', 'budget_quote', '预算金额报价')
    comparePair(issues, lowestAmt, invoiceAmt, '比价低价', '发票合计', 'invoices', '开对应发票', 0)
    if (lowestAmt !== null && quoteAmt !== null && lowestAmt > quoteAmt) {
      pushIssue(issues, {
        category: 'amount',
        level: 'error',
        itemId: 'compare_sheet',
        itemName: '三家公司比价清单',
        title: '低价高于预算报价',
        detail: reasonFix(
          '比价低价 ' +
            format.formatMoney(lowestAmt) +
            ' 元，高于预算报价 ' +
            format.formatMoney(quoteAmt) +
            ' 元。成交价不能高于预算。',
          '打开「三家公司比价清单」核对低价金额；若预算填错，打开「预算金额报价」按报价单改。低价必须小于或等于预算报价。'
        )
      })
    }
    var compareName = String(compare.contractor || (project && project.contractor) || '').trim()
    var invoiceName = String(invoice.contractor || '').trim()
    if (!invoiceName && invoice.ocrText) {
      invoiceName = String((parseOcrText(invoice.ocrText, 'invoice').contractor) || '').trim()
    }
    if (compareName && invoiceName && !companyNamesAlign(compareName, invoiceName)) {
      pushIssue(issues, {
        category: 'amount',
        level: 'error',
        itemId: 'invoices',
        itemName: '开对应发票',
        title: '最低价公司与发票对不上',
        detail: reasonFix(
          '比价低价单位「' + compareName + '」，发票销售方「' + invoiceName + '」。',
          '打开「三家公司比价清单」核低价公司名称，打开「开对应发票」核销售方，改到一致后再核验。'
        )
      })
    }
    return
  }

  var award = materialOf(project, 'bid_notice')
  var contract = materialOf(project, 'contract')
  var invoice = materialOf(project, 'invoices')
  var awardAmt = format.parseMoney(award.amount || project.awardAmount || project.bidAmount)
  var contractAmt = format.parseMoney(contract.amount || project.contractAmount)
  var invoiceAmt = format.parseMoney(invoice.amount)
  if (contractAmt === null) contractAmt = awardAmt
  if (invoiceAmt === null) invoiceAmt = awardAmt

  if (org === 'township') {
    var quote = materialOf(project, 'quote_sheet')
    var quoteAmt = format.parseMoney(quote.amount)
    if (quoteAmt === null) quoteAmt = awardAmt
    comparePair(issues, quoteAmt, budgetAmt, '报价合计', '项目报账金额', 'quote_sheet', '报价表')
    comparePair(issues, quoteAmt, awardAmt, '报价合计', '中标/成交金额', 'bid_notice', '中标/成交通知（彩打）')
  }

  comparePair(issues, awardAmt, contractAmt, '中标/成交金额', '合同金额', 'contract', '施工/采购合同', 0)

  var accept = materialOf(project, 'accept_sheet')
  var acceptAmt = format.parseMoney(accept.amount)
  comparePair(issues, awardAmt, acceptAmt, '中标/成交金额', '验收单金额', 'accept_sheet', '验收单', 0)
  comparePair(issues, contractAmt, acceptAmt, '合同金额', '验收单金额', 'accept_sheet', '验收单', 0)

  if (isJointBid(project)) {
    var packAmt = packageAmountOf(awardAmt, contractAmt)
    var rawInvoice = format.parseMoney(invoice.amount)
    checkJointSplit(project, issues, packAmt, budgetAmt, rawInvoice)
    return
  }

  comparePair(issues, contractAmt, invoiceAmt, '合同金额', '发票合计', 'invoices', '合同对应清单发票', 0)
  comparePair(issues, awardAmt, invoiceAmt, '中标/成交金额', '发票合计', 'invoices', '合同对应清单发票', 0)
  if (budgetAmt !== null && contractAmt !== null && budgetAmt < contractAmt && !format.moneyClose(budgetAmt, contractAmt, 1)) {
    pushIssue(issues, {
      category: 'amount',
      level: 'error',
      itemId: 'contract',
      itemName: '施工/采购合同',
      title: '报账金额小于合同金额',
        detail: reasonFix(
          '本村报账 ' +
            format.formatMoney(budgetAmt) +
            ' 元，合同 ' +
            format.formatMoney(contractAmt) +
            ' 元。报账金额小于合同，常见于两村打包却没勾选。',
          '若两村打包成一个标：到「编辑项目」勾选「两村打包成一个标」，填另一村名称和实施结果金额，两村之和须等于中标/合同总价，本村发票须等于本村实施结果。若不是打包，把项目报账金额改成与合同一致，或核对合同金额是否填错。'
        )
    })
    return
  }
  comparePair(issues, budgetAmt, contractAmt, '项目报账金额', '合同金额', 'contract', '施工/采购合同')
}

function checkAcceptance(project, issues) {
  var org = orgTypeOf(project)
  var item = checklist.getItem('photo_accept', org)
  var mat = materialOf(project, 'photo_accept')
  if (!item || !isUploaded(item, mat, project)) return
  var result = peopleRulePass(mat, org)
  if (!result.ok) {
    pushIssue(issues, {
      category: 'people',
      level: 'error',
      itemId: 'photo_accept',
      itemName: item.name,
      title: '验收人员不足',
      detail: reasonFix(
        result.message,
        org === 'township'
          ? '打开「现场验收照片」，把到场总人数登记为至少 1 人即可，不必确认监督员。'
          : '打开「现场验收照片」，把到场人员登记清楚；没有监督人员时，照片须能看出至少三个人。'
      )
    })
  }
}

function computeProgress(project) {
  var org = orgTypeOf(project)
  var items = checklist.getRequiredItems(org)
  var uploaded = 0
  var complete = 0
  var groups = checklist.getGroups(org).map(function (g) {
    var visible = (g.items || []).filter(function (item) {
      return !item.hidden
    })
    var gTotal = visible.length
    var gUp = 0
    var gDone = 0
    visible.forEach(function (item) {
      var full = checklist.getItem(item.id, org)
      var mat = materialOf(project, item.id)
      if (isUploaded(full, mat, project)) {
        uploaded += 1
        gUp += 1
      }
      if (isComplete(full, mat, project)) {
        complete += 1
        gDone += 1
      }
    })
    return {
      id: g.id,
      name: g.name,
      hint: g.hint,
      total: gTotal,
      uploaded: gUp,
      complete: gDone,
      percent: util.clampPercent(gDone, gTotal)
    }
  })
  var total = items.length
  return {
    total: total,
    uploaded: uploaded,
    complete: complete,
    filePercent: util.clampPercent(uploaded, total),
    checkPercent: util.clampPercent(complete, total),
    groups: groups
  }
}

function runAudit(project) {
  var issues = []
  if (!project) {
    return {
      generatedAt: Date.now(),
      progress: {
        total: 0,
        uploaded: 0,
        complete: 0,
        filePercent: 0,
        checkPercent: 0,
        groups: []
      },
      issues: [],
      errorCount: 0,
      warnCount: 0,
      passed: false
    }
  }
  checkMissing(project, issues)
  checkPublicityAndFraud(project, issues)
  checkSequence(project, issues)
  checkAnchoredDates(project, issues)
  checkAmounts(project, issues)
  checkAcceptance(project, issues)
  checkOcrDateConflict(project, issues)

  var errorCount = 0
  var warnCount = 0
  issues.forEach(function (it) {
    if (it.level === 'error') errorCount += 1
    else warnCount += 1
  })
  var progress = computeProgress(project)
  return {
    generatedAt: Date.now(),
    progress: progress,
    issues: issues,
    errorCount: errorCount,
    warnCount: warnCount,
    passed: errorCount === 0 && progress.complete === progress.total && progress.total > 0
  }
}

function listAmount(project) {
  var award = canonicalAward(project)
  if (award.amount != null) return award.amount
  var budget = format.parseMoney(project && project.budgetAmount)
  if (budget != null) return budget
  var contract = materialOf(project, 'contract')
  return format.parseMoney((contract && contract.amount) || (project && project.contractAmount))
}

function listDateLabel(project) {
  return orgTypeOf(project) === 'small' ? '报价日期' : '中标日期'
}

function listBidDate(project) {
  if (orgTypeOf(project) === 'small') {
    return dateUtil.formatDate(materialOf(project, 'budget_quote').date) || ''
  }
  var award = canonicalAward(project)
  return dateUtil.formatDate(award.date) || ''
}

function summarizeListItem(project) {
  var result = runAudit(project)
  var p = result.progress
  var org = orgUtil.fromProject(project)
  var status = '进行中'
  var tone = 'info'
  if (result.passed) {
    status = '可报账'
    tone = 'ok'
  } else if (result.errorCount > 0) {
    status = '有风险'
    tone = 'risk'
  } else if (p.uploaded === 0) {
    status = '未上传'
    tone = 'miss'
  }
  var amount = listAmount(project)
  var bidDate = listBidDate(project)
  return {
    id: project.id,
    name: project.name,
    village: project.village,
    year: project.year,
    jointBid: isJointBid(project),
    contractor: project.contractor,
    budgetAmount: project.budgetAmount,
    amountText: amount == null ? '未填' : format.formatMoney(amount) + ' 元',
    hasAmount: amount != null,
    dateLabel: listDateLabel(project),
    bidDateText: bidDate || '未填',
    hasBidDate: !!bidDate,
    orgType: org.id,
    orgName: org.name,
    orgAccent: org.accent,
    updatedAt: project.updatedAt,
    filePercent: p.filePercent,
    checkPercent: p.checkPercent,
    uploaded: p.uploaded,
    complete: p.complete,
    total: p.total,
    errorCount: result.errorCount,
    warnCount: result.warnCount,
    status: status,
    tone: tone,
    done: !!result.passed
  }
}

function buildTimeline(project) {
  var org = orgTypeOf(project)
  var rows = []
  var prev = null
  getDateChain(org).forEach(function (step) {
    var mat = materialOf(project, step.id)
    var value = itemStamp(step, mat, org, project)
    var parsed = dateUtil.parseDate(value)
    var inverted = !!(parsed && prev && parsed.getTime() < prev.time && !step.skipOrder)
    rows.push({
      key: step.id,
      label: step.label,
      date: value || '',
      inverted: inverted,
      tone: !value ? 'muted' : (inverted ? 'risk' : 'ok')
    })
    if (parsed && !step.skipOrder) prev = { time: parsed.getTime(), label: step.label, date: value }
  })
  return rows
}

function adaptIssue(issue) {
  return {
    key: issue.itemId,
    title: issue.title,
    message: issue.detail,
    level: issue.level === 'error' ? 'risk' : 'warn'
  }
}

function auditProject(project) {
  var result = runAudit(project)
  var org = orgTypeOf(project)
  var notice = materialOf(project, 'notice_resolution')
  var noticeItem = checklist.getItem('notice_resolution', org)
  var noticeRange = publicityRange(notice, noticeItem)
  var resultPublic = materialOf(project, 'result_public')
  var resultItem = checklist.getItem('result_public', org)
  var resultRange = resultItem ? publicityRange(resultPublic, resultItem) : { start: '', end: '' }
  var bid = materialOf(project, 'bid_notice')
  var contract = materialOf(project, 'contract')
  var acceptSheet = materialOf(project, 'accept_sheet')
  var quote = materialOf(project, 'quote_sheet')
  var budgetQuote = materialOf(project, 'budget_quote')
  var compareSheet = materialOf(project, 'compare_sheet')
  var missing = []
  var fraudIssues = []
  var dateRisks = []
  var amountIssues = []
  var peopleIssues = []
  var reviewIssues = []
  var warnings = []
  result.issues.forEach(function (issue) {
    var row = adaptIssue(issue)
    if (issue.category === 'missing' && issue.level === 'error') missing.push(row)
    else if (issue.category === 'missing') warnings.push(row)
    else if (issue.category === 'fraud') fraudIssues.push(row)
    else if (issue.category === 'date') dateRisks.push(row)
    else if (issue.category === 'amount') amountIssues.push(row)
    else if (issue.category === 'people') peopleIssues.push(row)
    else if (issue.category === 'review') reviewIssues.push(row)
    else warnings.push(row)
  })
  var tone = 'ok'
  var label = '核验通过'
  var text = '必传材料已齐，日期与金额未见异常。'
  if (result.errorCount) {
    tone = 'risk'
    label = '未通过'
    var parts = []
    if (fraudIssues.length) parts.push(fraudIssues.length + ' 条假账嫌疑')
    if (dateRisks.filter(function (i) { return i.level === 'risk' }).length) parts.push('日期对不上')
    if (reviewIssues.length) parts.push(reviewIssues.length + ' 处需人工核日期')
    if (missing.length) parts.push('缺 ' + missing.length + ' 项')
    if (amountIssues.filter(function (i) { return i.level === 'risk' }).length) parts.push('金额不一致')
    if (peopleIssues.length) parts.push('验收人数不足')
    if (!parts.length && dateRisks.length) parts.push(dateRisks.length + ' 条日期对不上')
    text = (parts.join('，') || '存在必须处理的问题') + '。'
  } else if (result.warnCount || (result.progress && result.progress.complete < result.progress.total)) {
    tone = 'warn'
    label = '待补全'
    text = result.warnCount ? result.warnCount + ' 条待补信息。' : '材料还在收集中。'
  }
  var completeness = checklist.countAll(project)
  var stages = checklist.stageProgress(project)
  return {
    summary: { tone: tone, label: label, text: text },
    missing: missing,
    fraudIssues: fraudIssues,
    dateRisks: dateRisks,
    timeline: buildTimeline(project),
    amountIssues: amountIssues,
    peopleIssues: peopleIssues,
    reviewIssues: reviewIssues,
    warnings: warnings,
    completeness: completeness,
    stages: stages,
    orgType: org,
    isTownship: org === 'township',
    isSmall: org === 'small',
    dates: {
      noticeResStart: noticeRange.start,
      noticeResEnd: noticeRange.end,
      noticePlanStart: '',
      noticePlanEnd: '',
      resultPublicStart: resultRange.start,
      resultPublicEnd: resultRange.end,
      resultPublic: resultPublic.date || resultRange.end || '',
      bidDate: bid.date || (project && (project.awardDate || project.bidDate)) || '',
      awardAmount: bid.amount === 0 || bid.amount ? String(bid.amount) : ((project && (project.awardAmount || project.bidAmount)) || ''),
      contractDate: contract.date || '',
      acceptDate: acceptSheet.date || '',
      acceptAmount: acceptSheet.amount === 0 || acceptSheet.amount ? String(acceptSheet.amount) : '',
      quoteAmount: quote.amount === 0 || quote.amount ? String(quote.amount) : '',
      budgetQuote: budgetQuote.amount === 0 || budgetQuote.amount ? String(budgetQuote.amount) : '',
      compareAmount: compareSheet.amount === 0 || compareSheet.amount ? String(compareSheet.amount) : '',
      lowestAmount: compareSheet.amount === 0 || compareSheet.amount ? String(compareSheet.amount) : '',
      budgetAmount: project && (project.budgetAmount === 0 || project.budgetAmount) ? String(project.budgetAmount) : '',
      jointBid: isJointBid(project),
      partnerVillage: (project && project.partnerVillage) || '',
      partnerAmount: project && (project.partnerAmount === 0 || project.partnerAmount) ? String(project.partnerAmount) : ''
    },
    raw: result
  }
}

function takeTitles(rows, max) {
  return (rows || []).slice(0, max || 2).map(function (row) {
    return row.title || row.message || ''
  }).filter(Boolean)
}

function takeFix(rows) {
  var list = rows || []
  for (var i = 0; i < list.length; i++) {
    var msg = String((list[i] && list[i].message) || '')
    if (msg.indexOf('更正：') >= 0) return msg
  }
  return ''
}

function explainAudit(report) {
  if (!report || !report.summary) return ''
  var lines = []
  lines.push(report.summary.label + '：' + report.summary.text)
  var fraud = takeTitles(report.fraudIssues, 2)
  if (fraud.length) lines.push(fraud.join('；'))
  var dates = takeTitles(report.dateRisks, 2)
  if (dates.length) lines.push(dates.join('；'))
  var amounts = takeTitles(report.amountIssues, 2)
  if (amounts.length) lines.push(amounts.join('；'))
  var reviews = takeTitles(report.reviewIssues, 2)
  if (reviews.length) lines.push(reviews.join('；'))
  var missing = takeTitles(report.missing, 3)
  if (missing.length) lines.push(missing.join('；'))
  var how =
    takeFix(report.fraudIssues) ||
    takeFix(report.dateRisks) ||
    takeFix(report.reviewIssues) ||
    takeFix(report.amountIssues) ||
    takeFix(report.missing) ||
    takeFix(report.warnings)
  if (how) lines.push(how)
  if (report.summary.tone === 'ok') {
    if (report.dates && report.dates.jointBid) {
      lines.push('两村打包：中标/合同按整包总价；本村报账与发票按本村实施结果，须分开开具。')
    } else {
      lines.push('合同、发票金额空着时，按中标/成交通知核对。')
    }
  } else if (!fraud.length && !dates.length && !amounts.length && !reviews.length && !missing.length && report.warnings && report.warnings.length) {
    lines.push('点上面每条问题即可打开对应资料，按「更正」手填日期或金额后再核验。')
  }
  return lines.join('\n')
}

export {
  AMOUNT_TOLERANCE,
  DATE_CHAIN,
  VILLAGE_DATE_CHAIN,
  TOWNSHIP_DATE_CHAIN,
  SMALL_DATE_CHAIN,
  getDateChain,
  materialOf,
  publicityRange,
  isUploaded,
  isComplete,
  peopleRulePass,
  computeProgress,
  runAudit,
  summarizeListItem,
  auditProject,
  explainAudit,
  inspectOcrDates,
  canonicalAward,
  effectiveAmount,
  isJointBid
}
