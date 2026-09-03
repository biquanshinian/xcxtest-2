/**
 * 合并抓取快照（latest.statuses）与后台覆盖（admin_overrides.itemOverrides）
 * 供小程序展示：title 为中文，done 综合网页与手动覆盖。
 */
const { pickDisplayTitle, translateCategory } = require('./nsf-checklist-i18n.js')

function mergeNsfChecklistDisplay(statuses, itemOverrides) {
  const ovRoot = itemOverrides && typeof itemOverrides === 'object' ? itemOverrides : {}
  const list = Array.isArray(statuses) ? statuses : []

  return list
    .map((raw, i) => {
      if (!raw || typeof raw !== 'object') return null
      const id = String(raw.id != null ? raw.id : `nsf_${i}`)
      const titleEn = String(raw.titleEn || raw.title || '').trim()
      const titleZhMachine = pickDisplayTitle(titleEn, raw.titleZh)
      const baseZh = titleZhMachine
      const ov = ovRoot[id] || {}
      const ovZh = typeof ov.titleZh === 'string' ? ov.titleZh.trim() : ''
      const title = ovZh || baseZh || titleEn

      const doneWeb = raw.doneWeb !== undefined ? !!raw.doneWeb : !!raw.done

      let done = doneWeb
      if (ov.manualDone === true) done = true
      else if (ov.manualDone === false) done = false

      const detailUrl = typeof raw.detailUrl === 'string' ? raw.detailUrl.trim() : ''
      const categoryRaw = typeof raw.category === 'string' ? raw.category.trim() : ''
      const category = translateCategory(categoryRaw) || categoryRaw

      if (!title && !titleEn) return null

      return {
        id,
        title,
        titleEn,
        titleZhAuto: baseZh,
        done,
        detailUrl,
        category
      }
    })
    .filter(Boolean)
}

module.exports = {
  mergeNsfChecklistDisplay
}
