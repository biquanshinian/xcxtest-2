import { COMPARE_TIERS, getItem, getOrgType, itemWritableFields } from './checklist.js'
import { parseOcrText } from './ocr-parse.js'
import { applyParsed, applyProjectMeta, isPlaceholderName, ocrKindForItem, recognizeImage } from './ocr.js'
import { assignPages, isSparseText, pickSparseOcrPages } from './pdf-classify.js'
import { isPdfFile, renderPdfFile } from './pdf.js'
import { fileFromBlob, getMaterial, getProject, replaceFiles, saveMaterial } from './store.js'

const MONEY_KIND = { invoices: 'invoice', bid_notice: 'doc', compare_sheet: 'doc', contract: 'contract' }
const MAX_CLASSIFY_OCR = 8
const MAX_MONEY_OCR = 4
const OCR_CONCURRENCY = 2

function compactText(pages) {
  const texts = (pages || []).map((p) => String(p.text || '').trim()).filter(Boolean)
  const full = texts.join('\n')
  if (full.length <= 4000) return full
  const hot = (pages || []).filter((p) => /价税合计|合同金额|中标|成交|公示|开票日期|总价|总金额|申请资金|含税合计/.test(p.text || ''))
  const pick = (hot.length ? hot : pages.slice(-2)).map((p) => p.text || '').join('\n')
  return (texts[0] + '\n' + pick).slice(0, 4000)
}

function assignPage(buckets, itemId, page) {
  if (!itemId) return
  if (!buckets[itemId]) buckets[itemId] = []
  buckets[itemId].push(page)
}

async function mapPool(items, limit, worker) {
  const list = items || []
  if (!list.length) return
  const n = Math.max(1, Math.min(limit || 1, list.length))
  let cursor = 0
  async function run() {
    while (cursor < list.length) {
      const i = cursor
      cursor += 1
      await worker(list[i], i)
    }
  }
  const workers = []
  for (let i = 0; i < n; i++) workers.push(run())
  await Promise.all(workers)
}

async function recognizePage(page, kind, onProgress, current, total, opts) {
  if (!page || !page.blob) return null
  if (onProgress) onProgress({ phase: 'ocr', current, total, name: '认第 ' + page.index + ' 页' })
  const url = URL.createObjectURL(page.blob)
  try {
    const result = await recognizeImage(url, kind || 'doc', opts)
    page.text = String(result.text || page.text || '').trim()
    page.engine = result.engine
    page.parsed = result.parsed
    page.ocrDone = true
    return result
  } catch (e) {
    page.ocrDone = true
    page.ocrError = (e && e.message) || '识别失败'
    return null
  } finally {
    URL.revokeObjectURL(url)
  }
}

function looksPairedPublicity(itemId, text) {
  const src = String(text || '').replace(/\s+/g, '')
  if (itemId === 'notice_resolution') {
    return src.indexOf('决议公示') >= 0 && src.indexOf('实施方案公示') >= 0
  }
  if (itemId === 'result_public') {
    return (src.indexOf('实施结果公示') >= 0 || src.indexOf('实施结果公开') >= 0) && src.indexOf('实施方案公示') >= 0
  }
  return true
}

function filesFromPages(pages) {
  return (pages || []).map((page) => {
    const file = fileFromBlob(page.blob, page.name)
    if (page.text) file.ocrText = String(page.text).slice(0, 4000)
    return file
  })
}

function compareSlotForIndex(i, total) {
  if (total <= 1) return 'compare_low'
  if (total === 2) return i === 0 ? 'compare_high' : 'compare_low'
  if (i === 0) return 'compare_high'
  if (i === total - 1) return 'compare_low'
  return 'compare_mid'
}

function saveItemFiles(projectId, item, pages) {
  if (item.special === 'compare') {
    return Promise.all(COMPARE_TIERS.map((tier) => {
      const group = []
      pages.forEach((page, i) => {
        if (compareSlotForIndex(i, pages.length) === tier.slot) group.push(page)
      })
      if (!group.length) return Promise.resolve()
      return replaceFiles(projectId, tier.slot, filesFromPages(group))
    }))
  }
  return replaceFiles(projectId, item.id, filesFromPages(pages))
}

function finalizeItem(projectId, itemId, pages) {
  const project = getProject(projectId)
  const item = getItem(itemId, getOrgType(project))
  if (!item || !pages.length) return Promise.resolve({ itemId, files: 0, filled: [] })
  return saveItemFiles(projectId, item, pages).then(() => {
    const mat = getMaterial(getProject(projectId), itemId)
    const text = compactText(pages)
    const parsed = parseOcrText(text, ocrKindForItem(item))
    const patch = applyParsed(mat, parsed, itemWritableFields(item), item.minDays)
    const engine = pages.some((p) => p.engine && p.engine !== 'pdf-text')
      ? (pages.find((p) => p.engine) || {}).engine || 'pdf'
      : 'pdf-text'
    const paired = item.requirePairedPhoto
      ? { pairedPhoto: looksPairedPublicity(item.id, text) }
      : {}
    saveMaterial(projectId, itemId, Object.assign({}, patch.next, paired, {
      ocrTried: true,
      ocrAt: Date.now(),
      ocrEngine: engine,
      ocrSummary: patch.summary,
      ocrText: text,
      dateReviewOk: false,
      dateReviewKey: ''
    }))
    if (item.id === 'bid_notice' || item.role === 'award' || item.id === 'compare_sheet' || item.id === 'contract') {
      applyProjectMeta(projectId, parsed)
    }
    return { itemId, name: item.name, files: pages.length, filled: patch.filled, summary: patch.summary }
  })
}

function pickAnchorPages(pages, maxCount) {
  const list = pages || []
  const out = []
  const seen = Object.create(null)
  function add(page) {
    if (!page || !page.blob || seen[page.index] || page.engine || !isSparseText(page.text)) return
    seen[page.index] = true
    out.push(page)
  }
  if (!list.length) return out
  add(list[0])
  add(list[Math.floor((list.length - 1) / 2)])
  add(list[list.length - 1])
  for (let i = list.length - 2; i >= 0 && out.length < maxCount; i--) add(list[i])
  return out.slice(0, maxCount)
}

function pickMoneyTargets(buckets) {
  const jobs = []
  Object.keys(buckets).forEach((itemId) => {
    const kind = MONEY_KIND[itemId]
    if (!kind) return
    const group = buckets[itemId]
    const parsed = parseOcrText(compactText(group), kind)
    if (parsed.amount != null && parsed.date) return
    const target = pickMoneyPage(group, itemId)
    if (!target || !target.blob) return
    jobs.push({ page: target, kind, itemId })
  })
  return jobs.slice(0, MAX_MONEY_OCR)
}

export async function ingestPackedPdf(projectId, file, onProgress) {
  const project = getProject(projectId)
  if (!project) throw new Error('找不到这个项目。')
  const org = getOrgType(project)
  const pages = await renderPdfFile(file, onProgress)

  const classifyTargets = pickSparseOcrPages(pages, MAX_CLASSIFY_OCR)
  if (classifyTargets.length) {
    if (onProgress) onProgress({ phase: 'ocr', current: 0, total: classifyTargets.length, name: '抽页识别扫描件' })
    await mapPool(classifyTargets, OCR_CONCURRENCY, async (page, i) => {
      await recognizePage(page, 'doc', onProgress, i + 1, classifyTargets.length, { allowLocal: false })
    })
  }

  if (classifyTargets.length && !classifyTargets.some((page) => String(page.text || '').replace(/\s+/g, '').length >= 8)) {
    const anchors = pickAnchorPages(pages, 3)
    if (anchors.length) {
      if (onProgress) onProgress({ phase: 'ocr', current: 0, total: anchors.length, name: '本机补认关键页' })
      await mapPool(anchors, 1, async (page, i) => {
        await recognizePage(page, 'doc', onProgress, i + 1, anchors.length, { allowLocal: true })
      })
    }
  }

  const buckets = {}
  let unknown = 0
  const mapped = assignPages(pages, org)
  mapped.forEach((hit, i) => {
    const page = pages[i]
    if (!hit.itemId) {
      unknown += 1
      return
    }
    assignPage(buckets, hit.itemId, page)
  })

  const moneyJobs = pickMoneyTargets(buckets)
  if (moneyJobs.length) {
    await mapPool(moneyJobs, OCR_CONCURRENCY, async (job, i) => {
      await recognizePage(job.page, job.kind, onProgress, i + 1, moneyJobs.length, { allowLocal: true })
    })
  }

  const assigned = []
  const itemIds = Object.keys(buckets)
  for (let i = 0; i < itemIds.length; i++) {
    assigned.push(await finalizeItem(projectId, itemIds[i], buckets[itemIds[i]]))
  }
  assigned.sort((a, b) => (b.files || 0) - (a.files || 0))

  const fileHint = String((file && file.name) || '')
    .replace(/\.pdf$/i, '')
    .replace(/[-_\s]/g, '')
    .replace(/全套|资料汇编|报账材料|扫描件|彩打|副本/g, '')
  if (isPlaceholderName((getProject(projectId) || {}).name) && /[\u4e00-\u9fff]{4,}/.test(fileHint) && /(工程|项目|路|硬化|维修|改造|建设)/.test(fileHint)) {
    applyProjectMeta(projectId, { name: fileHint.slice(0, 40) })
  }

  return {
    pages: pages.length,
    truncated: pages.truncated || 0,
    assigned,
    unknown,
    items: assigned.length
  }
}

function pickMoneyPage(group, itemId) {
  const list = group || []
  let best = list[list.length - 1] || null
  let bestScore = -1
  list.forEach((page) => {
    const t = String((page && page.text) || '')
    const parsed = t ? parseOcrText(t, MONEY_KIND[itemId] || 'doc') : null
    let score = 0
    if (parsed && parsed.amount != null) score += 50 + Math.log10(Number(parsed.amount) + 1) * 5
    if (/价税合计|含税合计|总价|总金额/.test(t)) score += 4
    if (/合同金额|本合同/.test(t)) score += 3
    if (/中标金额|成交价|成交金额/.test(t)) score += 3
    if (itemId === 'invoices' && /发票/.test(t)) score += 1
    if (score > bestScore) {
      bestScore = score
      best = page
    }
  })
  return best
}

function isImageFile(file) {
  if (!file) return false
  if (file.type && file.type.startsWith('image/')) return true
  return /\.(jpe?g|png|gif|webp|bmp)$/i.test(file.name || '')
}

export async function expandUploads(fileList, onProgress) {
  const list = Array.from(fileList || [])
  const out = []
  for (let i = 0; i < list.length; i++) {
    const file = list[i]
    if (!file) continue
    if (isPdfFile(file)) {
      const pages = await renderPdfFile(file, onProgress)
      pages.forEach((page) => out.push(fileFromBlob(page.blob, page.name)))
      continue
    }
    if (isImageFile(file)) out.push(fileFromBlob(file, file.name))
  }
  return out
}
