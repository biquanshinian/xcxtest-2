/**
 * 报账资料清单
 * 村委会：决策会议 / 公示 / 乡镇文件 / 采购 / 合同 / 施工验收 / 发票
 * 乡政府：审批表 / 实施方案 / 请示 / 方案说明 / 采购 / 合同证照 / 现场 / 发票
 * 村委会小额：预算报价 / 三家比价（高中低） / 施工前中后 / 发票
 */

import * as orgUtil from './org.js'

var VILLAGE_GROUPS = [
  {
    id: 'meeting',
    name: '开会定项目',
    hint: '',
    items: [
      { id: 'approval_form', name: '项目审批表', required: true, fields: ['date'], hint: '' },
      { id: 'minutes_party', name: '党支部提议纪要', required: true, fields: ['date'], hint: '' },
      { id: 'minutes_two_committees', name: '村两委商议纪要', required: true, fields: ['date'], hint: '' },
      { id: 'minutes_party_members', name: '党员大会审议纪要', required: true, fields: ['date'], hint: '' },
      { id: 'minutes_villagers', name: '村民代表会议决议纪要', required: true, fields: ['date'], hint: '' },
      { id: 'fund_briefing', name: '经费使用专题会议简报', required: true, fields: ['date'], hint: '' },
      { id: 'fund_record', name: '上会专题会议记录', required: true, fields: ['date'], hint: '' }
    ]
  },
  {
    id: 'publicity',
    name: '墙上贴公示',
    hint: '',
    items: [
      {
        id: 'notice_resolution',
        name: '决议公示与实施方案公示',
        required: true,
        fields: ['startDate', 'endDate'],
        minDays: 7,
        requirePairedPhoto: true,
        role: 'publicity',
        hint: ''
      },
      {
        id: 'notice_plan',
        name: '实施方案公示',
        required: false,
        hidden: true,
        shareFilesFrom: 'notice_resolution',
        fields: [],
        hint: ''
      },
      {
        id: 'result_public',
        name: '实施结果公示与实施方案公示',
        required: true,
        fields: ['startDate', 'endDate'],
        minDays: 7,
        requirePairedPhoto: true,
        role: 'publicity',
        hint: ''
      }
    ]
  },
  {
    id: 'township',
    name: '乡镇批文件',
    hint: '',
    items: [
      { id: 'township_request', name: '乡政府请示批复文件及方案', required: true, fields: ['date'], hint: '' },
      { id: 'zbj_request', name: '八戒网发布招标信息请示', required: true, fields: ['date'], hint: '' },
      { id: 'township_approval', name: '乡政府同意发布批复', required: true, fields: ['date'], hint: '' }
    ]
  },
  {
    id: 'procurement',
    name: '网上采购',
    allowConfirm: true,
    hint: '',
    items: [
      { id: 'zbj_procurement', name: '八戒网采购文件', required: true, fields: [], hint: '' },
      {
        id: 'responses',
        name: '三家响应文件（双面彩打）',
        required: true,
        fields: [],
        minFiles: 3,
        hint: ''
      },
      { id: 'review_report', name: '评审报告', required: true, fields: ['date'], hint: '' },
      {
        id: 'bid_notice',
        name: '中标/成交通知（彩打）',
        required: true,
        fields: ['date', 'amount'],
        role: 'award',
        hint: ''
      }
    ]
  },
  {
    id: 'contract_party',
    name: '合同和证照',
    allowConfirm: true,
    hint: '',
    items: [
      {
        id: 'construction_plan',
        name: '施工方案',
        required: true,
        fields: ['date'],
        hint: ''
      },
      {
        id: 'contract',
        name: '施工/采购合同',
        required: true,
        fields: ['date', 'amount'],
        role: 'contract',
        special: 'contract',
        hint: ''
      },
      {
        id: 'contract_watermark',
        name: '水印合同彩打扫描件',
        required: true,
        fields: [],
        special: 'contract',
        hint: ''
      },
      { id: 'license', name: '营业执照', required: true, fields: [], hint: '' },
      { id: 'bank_account', name: '对公账户资料', required: true, fields: [], hint: '' },
      { id: 'legal_id', name: '法人身份证', required: true, fields: [], minFiles: 2, hint: '' }
    ]
  },
  {
    id: 'implementation',
    name: '现场照片与验收单',
    hint: '',
    items: [
      {
        id: 'photo_before',
        name: '施工前现场照片',
        required: true,
        fields: [],
        minFiles: 1,
        special: 'photos',
        stage: 'before',
        hint: ''
      },
      {
        id: 'photo_during',
        name: '施工中现场照片',
        required: true,
        fields: [],
        minFiles: 1,
        special: 'photos',
        stage: 'during',
        hint: ''
      },
      {
        id: 'photo_after',
        name: '施工后现场照片',
        required: true,
        fields: [],
        minFiles: 1,
        special: 'photos',
        stage: 'after',
        hint: ''
      },
      {
        id: 'photo_accept',
        name: '现场验收照片',
        required: true,
        fields: ['people'],
        minFiles: 1,
        special: 'photos',
        stage: 'accept',
        needsPeople: true,
        hint: ''
      },
      {
        id: 'accept_sheet',
        name: '验收单',
        required: true,
        fields: ['date', 'amount'],
        hint: ''
      }
    ]
  },
  {
    id: 'finance',
    name: '发票清单',
    allowConfirm: true,
    hint: '',
    items: [
      {
        id: 'invoices',
        name: '合同对应清单发票',
        required: true,
        fields: ['date', 'amount'],
        role: 'invoice',
        hint: ''
      }
    ]
  }
]

var TOWNSHIP_GROUPS = [
  {
    id: 'tw_approval',
    name: '审批表',
    hint: '',
    items: [
      { id: 'approval_form', name: '项目审批表', required: true, fields: ['date'], hint: '' }
    ]
  },
  {
    id: 'tw_plan',
    name: '使用实施方案',
    hint: '',
    items: [
      { id: 'impl_plan', name: '使用实施方案', required: true, optionalFields: ['date', 'amount'], hint: '' }
    ]
  },
  {
    id: 'tw_request',
    name: '乡政府请示',
    hint: '',
    items: [
      { id: 'township_letter', name: '关于乡政府的请示', required: true, fields: ['date', 'amount'], hint: '' }
    ]
  },
  {
    id: 'tw_pack',
    name: '方案说明',
    hint: '',
    items: [
      { id: 'quote_sheet', name: '报价表', required: true, fields: ['amount'], hint: '' },
      { id: 'meeting_signin', name: '会议签到表', required: true, fields: ['date'], hint: '' },
      { id: 'meeting_minutes', name: '会议纪要', required: true, fields: ['date'], hint: '' },
      {
        id: 'notice_resolution',
        name: '决议公示',
        required: true,
        fields: ['startDate', 'endDate'],
        minDays: 7,
        role: 'publicity',
        hint: ''
      },
      {
        id: 'result_public',
        name: '实施结果公开',
        required: true,
        fields: ['startDate', 'endDate'],
        minDays: 7,
        role: 'publicity',
        hint: ''
      }
    ]
  },
  {
    id: 'tw_procurement',
    name: '网上采购',
    allowConfirm: true,
    hint: '',
    items: [
      { id: 'zbj_procurement', name: '采购文件', required: true, fields: [], hint: '' },
      {
        id: 'responses',
        name: '三家响应文件（双面彩打）',
        required: true,
        fields: [],
        minFiles: 3,
        hint: ''
      },
      { id: 'review_report', name: '评审报告', required: true, fields: ['date'], hint: '' },
      {
        id: 'bid_notice',
        name: '中标/成交通知（彩打）',
        required: true,
        fields: ['date', 'amount'],
        role: 'award',
        hint: ''
      }
    ]
  },
  {
    id: 'tw_contract',
    name: '合同和证照',
    allowConfirm: true,
    hint: '',
    items: [
      {
        id: 'contract',
        name: '施工/采购合同',
        required: true,
        fields: ['date', 'amount'],
        role: 'contract',
        special: 'contract',
        hint: ''
      },
      {
        id: 'contract_watermark',
        name: '水印合同彩打扫描件',
        required: true,
        fields: [],
        special: 'contract',
        hint: ''
      },
      { id: 'license', name: '营业执照', required: true, fields: [], hint: '' },
      { id: 'bank_account', name: '对公账户资料', required: true, fields: [], hint: '' },
      { id: 'legal_id', name: '法人身份证', required: true, fields: [], minFiles: 2, hint: '' }
    ]
  },
  {
    id: 'tw_photos',
    name: '现场照片与验收单',
    hint: '',
    items: [
      {
        id: 'photo_before',
        name: '施工前现场照片',
        required: true,
        fields: [],
        minFiles: 1,
        special: 'photos',
        stage: 'before',
        hint: ''
      },
      {
        id: 'photo_during',
        name: '施工中现场照片',
        required: true,
        fields: [],
        minFiles: 1,
        special: 'photos',
        stage: 'during',
        hint: ''
      },
      {
        id: 'photo_after',
        name: '施工后现场照片',
        required: true,
        fields: [],
        minFiles: 1,
        special: 'photos',
        stage: 'after',
        hint: ''
      },
      {
        id: 'photo_accept',
        name: '现场验收照片',
        required: true,
        fields: ['people'],
        minFiles: 1,
        special: 'photos',
        stage: 'accept',
        needsPeople: true,
        hint: ''
      },
      {
        id: 'accept_sheet',
        name: '验收单',
        required: true,
        fields: ['date', 'amount'],
        hint: ''
      }
    ]
  },
  {
    id: 'tw_finance',
    name: '发票清单',
    allowConfirm: true,
    hint: '',
    items: [
      {
        id: 'invoices',
        name: '合同对应清单发票',
        required: true,
        fields: ['date', 'amount'],
        role: 'invoice',
        hint: ''
      }
    ]
  }
]

var COMPARE_TIERS = [
  { id: 'high', slot: 'compare_high', name: '高价' },
  { id: 'mid', slot: 'compare_mid', name: '中价' },
  { id: 'low', slot: 'compare_low', name: '低价' }
]

var SMALL_GROUPS = [
  {
    id: 'sm_quote',
    name: '预算金额报价',
    hint: '',
    items: [
      {
        id: 'budget_quote',
        name: '预算金额报价',
        required: true,
        fields: ['date', 'amount'],
        role: 'quote',
        hint: ''
      }
    ]
  },
  {
    id: 'sm_compare',
    name: '三家公司比价',
    hint: '',
    items: [
      {
        id: 'compare_sheet',
        name: '三家公司比价清单',
        required: true,
        fields: ['amount'],
        optionalFields: ['contractor'],
        minFiles: 3,
        special: 'compare',
        role: 'award',
        hint: '高价、中价、低价各至少一张，按框拍照或上传。不核验日期。低价公司名称和金额须能和发票对齐。'
      }
    ]
  },
  {
    id: 'sm_photos',
    name: '施工现场照片',
    hint: '',
    items: [
      {
        id: 'photo_before',
        name: '施工前现场照片',
        required: true,
        fields: [],
        minFiles: 1,
        special: 'photos',
        stage: 'before',
        hint: ''
      },
      {
        id: 'photo_during',
        name: '施工中现场照片',
        required: true,
        fields: [],
        minFiles: 1,
        special: 'photos',
        stage: 'during',
        hint: ''
      },
      {
        id: 'photo_after',
        name: '施工后现场照片',
        required: true,
        fields: [],
        minFiles: 1,
        special: 'photos',
        stage: 'after',
        hint: ''
      }
    ]
  },
  {
    id: 'sm_invoice',
    name: '对应发票',
    hint: '',
    items: [
      {
        id: 'invoices',
        name: '开对应发票',
        required: true,
        fields: ['date', 'amount'],
        optionalFields: ['contractor'],
        role: 'invoice',
        hint: '金额须与比价低价一致；销售方名称须与低价公司对齐。'
      }
    ]
  }
]

var GROUPS = VILLAGE_GROUPS

function catalogs() {
  return [VILLAGE_GROUPS, TOWNSHIP_GROUPS, SMALL_GROUPS]
}

function itemWritableFields(item) {
  var req = (item && item.fields) || []
  var opt = (item && item.optionalFields) || []
  var out = []
  var seen = Object.create(null)
  req.concat(opt).forEach(function (f) {
    if (!f || f === 'people' || seen[f]) return
    seen[f] = true
    out.push(f)
  })
  return out
}

function itemCanScanFill(item) {
  if (!item || item.special === 'photos') return false
  var fields = itemWritableFields(item)
  return fields.indexOf('date') >= 0 || fields.indexOf('amount') >= 0 || fields.indexOf('startDate') >= 0 || fields.indexOf('contractor') >= 0
}

function itemCanSkipFilesAfterScan(item) {
  if (!itemCanScanFill(item)) return false
  if (item.requirePairedPhoto || item.needsPeople || item.special === 'photos' || item.special === 'compare') return false
  return true
}

function isCompareSlot(id) {
  var key = String(id || '')
  return key === 'compare_high' || key === 'compare_mid' || key === 'compare_low'
}

function compareSlotFiles(project, slot) {
  return ((getMaterial(project, slot).files) || []).length
}

function missingCompareNames(project) {
  var names = []
  COMPARE_TIERS.forEach(function (tier) {
    if (compareSlotFiles(project, tier.slot) < 1) names.push(tier.name)
  })
  return names
}

function compareSlotsReady(project) {
  return missingCompareNames(project).length === 0
}

function decorate(item, group, orgType) {
  return Object.assign({}, item, {
    key: item.id,
    groupId: group.id,
    groupName: group.name,
    tip: item.hint,
    desc: group.hint,
    orgType: orgUtil.normalize(orgType),
    allowConfirm: !!(item.allowConfirm || (group && group.allowConfirm))
  })
}

function findInGroups(groups, id, orgType) {
  for (var i = 0; i < groups.length; i++) {
    var group = groups[i]
    for (var j = 0; j < group.items.length; j++) {
      if (group.items[j].id === id) return decorate(group.items[j], group, orgType)
    }
  }
  return null
}

function getOrgType(projectOrType) {
  if (!projectOrType) return 'village'
  if (typeof projectOrType === 'string') return orgUtil.normalize(projectOrType)
  return orgUtil.normalize(projectOrType.orgType)
}

function getGroups(orgType) {
  var type = getOrgType(orgType)
  if (type === 'township') return TOWNSHIP_GROUPS
  if (type === 'small') return SMALL_GROUPS
  return VILLAGE_GROUPS
}

function getItems(orgType) {
  var list = []
  var type = getOrgType(orgType)
  getGroups(type).forEach(function (group) {
    group.items.forEach(function (item) {
      list.push(decorate(item, group, type))
    })
  })
  return list
}

function getRequiredItems(orgType) {
  return getItems(orgType).filter(function (item) {
    return item.required !== false && !item.hidden
  })
}

function getItem(id, orgType) {
  if (orgType) {
    var type = getOrgType(orgType)
    return findInGroups(getGroups(type), id, type)
  }
  return (
    findInGroups(VILLAGE_GROUPS, id, 'village') ||
    findInGroups(TOWNSHIP_GROUPS, id, 'township') ||
    findInGroups(SMALL_GROUPS, id, 'small')
  )
}

function getGroup(id, orgType) {
  var groups = orgType ? getGroups(orgType) : null
  if (groups) {
    for (var i = 0; i < groups.length; i++) {
      if (groups[i].id === id) return groups[i]
    }
    return null
  }
  var all = catalogs()
  for (var c = 0; c < all.length; c++) {
    for (var j = 0; j < all[c].length; j++) {
      if (all[c][j].id === id) return all[c][j]
    }
  }
  return null
}

function getMaterial(project, key) {
  return Object.assign({}, emptyMaterial(), (project && project.materials && project.materials[key]) || {})
}

function fileCountOf(project, itemId) {
  return ((getMaterial(project, itemId).files) || []).length
}

function isItemComplete(project, item) {
  var id = item && (item.id || item.key || item)
  var full = getItem(id, getOrgType(project))
  if (!full) return false
  var material = getMaterial(project, full.id)
  if (full.requirePairedPhoto && !material.pairedPhoto) return false
  if (full.allowConfirm && material.confirmed) return true
  if (material.scanFilled && itemCanSkipFilesAfterScan(full)) return true
  if (full.special === 'compare') return compareSlotsReady(project)
  var min = full.minFiles || 1
  if (fileCountOf(project, full.id) >= min) return true
  if (full.shareFilesFrom && fileCountOf(project, full.shareFilesFrom) >= min) return true
  return false
}

function visibleGroupItems(group) {
  return ((group && group.items) || []).filter(function (item) {
    return !item.hidden
  })
}

function countGroup(project, group) {
  var items = visibleGroupItems(group)
  var uploaded = 0
  items.forEach(function (item) {
    if (isItemComplete(project, item)) uploaded += 1
  })
  return { uploaded: uploaded, total: items.length }
}

function countAll(project) {
  var uploaded = 0
  var total = 0
  getGroups(getOrgType(project)).forEach(function (group) {
    var stat = countGroup(project, group)
    uploaded += stat.uploaded
    total += stat.total
  })
  return {
    uploaded: uploaded,
    total: total,
    percent: total ? Math.round((uploaded / total) * 100) : 0
  }
}

function stageProgress(project) {
  var stages = getGroups(getOrgType(project)).map(function (group, index) {
    var stat = countGroup(project, group)
    return {
      id: group.id,
      name: group.name,
      stage: index + 1,
      uploaded: stat.uploaded,
      total: stat.total,
      done: stat.uploaded === stat.total && stat.total > 0
    }
  })
  var done = stages.filter(function (s) { return s.done }).length
  return {
    stages: stages,
    done: done,
    total: stages.length,
    percent: stages.length ? Math.round((done / stages.length) * 100) : 0
  }
}

function allItems(orgType) {
  return getItems(orgType).map(function (item) {
    return { item: item, group: getGroup(item.groupId, item.orgType) }
  })
}

function emptyMaterial() {
  return {
    files: [],
    date: '',
    startDate: '',
    endDate: '',
    extraRangeStart: '',
    extraRangeEnd: '',
    amount: '',
    peopleCount: '',
    committeeCount: '',
    hasSupervisor: false,
    peopleNote: '',
    remark: '',
    notes: '',
    people: [],
    watermarkPath: '',
    pairedPhoto: false,
    confirmed: false,
    scanFilled: false,
    dateReviewOk: false,
    dateReviewKey: '',
    contractor: ''
  }
}

function itemUrl(projectId, item) {
  if (!item) return ''
  if (item.special === 'photos') return '/preaudit/' + projectId + '/photos'
  if (item.special === 'contract') return '/preaudit/' + projectId + '/contract'
  return '/preaudit/' + projectId + '/item/' + item.id
}

function firstIncomplete(project, isCompleteFn) {
  var items = getRequiredItems(getOrgType(project))
  for (var i = 0; i < items.length; i++) {
    if (typeof isCompleteFn === 'function') {
      if (!isCompleteFn(items[i], getMaterial(project, items[i].id))) return items[i]
    } else if (!isItemComplete(project, items[i])) {
      return items[i]
    }
  }
  return null
}

export {
  GROUPS,
  VILLAGE_GROUPS,
  TOWNSHIP_GROUPS,
  SMALL_GROUPS,
  COMPARE_TIERS,
  isCompareSlot,
  compareSlotsReady,
  missingCompareNames,
  getOrgType,
  getGroups,
  getItems,
  getRequiredItems,
  getItem,
  getGroup,
  emptyMaterial,
  itemWritableFields,
  itemCanScanFill,
  itemCanSkipFilesAfterScan,
  getMaterial,
  isItemComplete,
  countGroup,
  countAll,
  stageProgress,
  allItems,
  itemUrl,
  firstIncomplete,
  visibleGroupItems
}
