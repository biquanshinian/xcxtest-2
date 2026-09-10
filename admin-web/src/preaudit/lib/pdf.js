import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

const MAX_BYTES = 40 * 1024 * 1024
const MAX_PAGES = 80

let workerReady = false

function ensureWorker() {
  if (workerReady) return
  GlobalWorkerOptions.workerSrc = workerSrc
  workerReady = true
}

export function isPdfFile(file) {
  if (!file) return false
  if (file.type === 'application/pdf') return true
  return /\.pdf$/i.test(file.name || '')
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('页转图失败'))
    }, 'image/jpeg', 0.82)
  })
}

async function pageText(page) {
  const content = await page.getTextContent()
  return (content.items || []).map((item) => item.str || '').join('\n')
}

async function mapOutline(pdf) {
  const marks = {}
  let outline = null
  try {
    outline = await pdf.getOutline()
  } catch (e) {
    return marks
  }
  async function walk(items) {
    if (!items || !items.length) return
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      const title = String((item && item.title) || '').trim()
      let dest = item && item.dest
      try {
        if (typeof dest === 'string') dest = await pdf.getDestination(dest)
        if (dest && dest[0]) {
          const idx = await pdf.getPageIndex(dest[0])
          if (idx >= 0 && title) {
            const pageNo = idx + 1
            marks[pageNo] = marks[pageNo] ? marks[pageNo] + ' ' + title : title
          }
        }
      } catch (e) { /* 个别书签指不到页就跳过 */ }
      if (item && item.items && item.items.length) await walk(item.items)
    }
  }
  await walk(outline)
  return marks
}

export async function renderPdfFile(file, onProgress) {
  if (!file) throw new Error('没有文件')
  if (!isPdfFile(file)) throw new Error('请上传 PDF')
  if (file.size > MAX_BYTES) throw new Error('PDF 超过 40MB，请拆成更小的本')
  ensureWorker()
  const data = await file.arrayBuffer()
  let pdf
  try {
    pdf = await getDocument({ data, disableAutoFetch: true, disableStream: true }).promise
  } catch (e) {
    if (/password/i.test(String((e && e.name) || '') + String(e && e.message || ''))) {
      throw new Error('这份 PDF 有密码，请先解除密码再传')
    }
    throw new Error((e && e.message) || 'PDF 打不开')
  }
  const total = Math.min(pdf.numPages || 0, MAX_PAGES)
  if (!total) throw new Error('PDF 是空的')
  const bookmarks = await mapOutline(pdf)
  const pages = []
  for (let i = 1; i <= total; i++) {
    if (onProgress) onProgress({ phase: 'split', current: i, total, name: '拆第 ' + i + ' 页' })
    const page = await pdf.getPage(i)
    const base = page.getViewport({ scale: 1 })
    let scale = 1.55
    const longest = Math.max(base.width, base.height)
    if (longest * scale > 1800) scale = 1800 / longest
    const viewport = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.floor(viewport.width))
    canvas.height = Math.max(1, Math.floor(viewport.height))
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) throw new Error('页转图失败')
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvasContext: ctx, viewport }).promise
    const [blob, text] = await Promise.all([canvasToBlob(canvas), pageText(page)])
    canvas.width = 0
    canvas.height = 0
    pages.push({
      index: i,
      text: String(text || '').trim(),
      bookmark: bookmarks[i] || '',
      blob,
      name: (file.name || '资料').replace(/\.pdf$/i, '') + '-第' + i + '页.jpg'
    })
  }
  if (pdf.numPages > MAX_PAGES) {
    pages.truncated = pdf.numPages - MAX_PAGES
  }
  try { await pdf.destroy() } catch (e) { /* ignore */ }
  return pages
}
