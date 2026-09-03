import { getMaterial } from './store.js'

const DEFAULT_API_BASE = 'https://cloud1-9gdqgdt5bfaa20fb-1397421562.ap-shanghai.app.tcloudbase.com/admin'
const API_BASE = import.meta.env.VITE_ADMIN_API_BASE || DEFAULT_API_BASE

function slimIssues(rows, category, max) {
  return (rows || []).slice(0, max || 8).map((row) => ({
    category,
    title: String((row && row.title) || '').slice(0, 40),
    message: String((row && row.message) || '').slice(0, 240)
  }))
}

export function buildAiPayload(project, report) {
  const awardKey = report && report.isSmall ? 'compare_sheet' : 'bid_notice'
  const award = project ? getMaterial(project, awardKey) : { ocrText: '' }
  return {
    orgType: (report && report.orgType) || '',
    name: (project && project.name) || '',
    village: (project && project.village) || '',
    contractor: (project && project.contractor) || '',
    jointBid: !!(report && report.dates && report.dates.jointBid),
    partnerVillage: (project && project.partnerVillage) || '',
    partnerAmount: (project && project.partnerAmount) || '',
    budgetAmount: (project && project.budgetAmount) || '',
    summary: (report && report.summary) || {},
    dates: (report && report.dates) || {},
    issues: []
      .concat(slimIssues(report && report.fraudIssues, 'fraud', 6))
      .concat(slimIssues(report && report.dateRisks, 'date', 6))
      .concat(slimIssues(report && report.reviewIssues, 'review', 6))
      .concat(slimIssues(report && report.amountIssues, 'amount', 6))
      .concat(slimIssues(report && report.missing, 'missing', 8))
      .slice(0, 24),
    awardExcerpt: String((award && award.ocrText) || '').slice(0, 800)
  }
}

export async function requestCloudAiAudit(payload) {
  const token = localStorage.getItem('admin_token')
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timer = ctrl ? setTimeout(() => ctrl.abort(), 25000) : null
  try {
    const res = await fetch(API_BASE, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {})
      },
      body: JSON.stringify({
        path: '/preaudit/ai-audit',
        method: 'POST',
        query: {},
        body: payload || {},
        headers: token ? { Authorization: 'Bearer ' + token } : {}
      }),
      signal: ctrl ? ctrl.signal : undefined
    })
    const data = await res.json()
    if (!data || data.code !== 0) {
      const err = new Error((data && data.message) || 'AI 审计不可用')
      err.code = data && data.code
      throw err
    }
    return data.data || {}
  } finally {
    if (timer) clearTimeout(timer)
  }
}
