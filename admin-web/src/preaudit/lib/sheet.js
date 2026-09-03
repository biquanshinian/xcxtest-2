const A4_W = 1100
const A4_H = 1556
const PAGE_MARGIN = 72
const FOOTER_H = PAGE_MARGIN + 36
const A4_PT_W = 595.28
const A4_PT_H = 841.89

export const SHEET_SLOGAN = '先核后报，一次过关'
export const SHEET_FOOTER = SHEET_SLOGAN + '  ·  仅供报账彩打'

const API_BASE = 'https://cloud1-9gdqgdt5bfaa20fb-1397421562.ap-shanghai.app.tcloudbase.com/admin'

function isRemoteUrl(src) {
  return /^https?:/i.test(String(src || ''))
}

function loadHtmlImage(src, cors) {
  return new Promise((resolve) => {
    const img = new Image()
    if (cors) img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
}

async function blobToDrawable(blob) {
  if (!blob || !blob.size) return null
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob, { imageOrientation: 'from-image' })
    } catch (e) {
      try {
        return await createImageBitmap(blob)
      } catch (e2) { /* 回退 Image */ }
    }
  }
  const url = URL.createObjectURL(blob)
  try {
    return await loadHtmlImage(url, false)
  } finally {
    URL.revokeObjectURL(url)
  }
}

function bytesFromBase64(raw) {
  const bin = atob(String(raw || ''))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

async function loadViaGateway(src) {
  if (typeof fetch !== 'function') return null
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('admin_token') : ''
  const res = await fetch(API_BASE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {})
    },
    body: JSON.stringify({
      path: '/preaudit/photos/file',
      method: 'POST',
      query: {},
      body: { url: src },
      headers: token ? { Authorization: 'Bearer ' + token } : {}
    })
  })
  const data = await res.json().catch(() => null)
  if (!data || data.code !== 0 || !data.data || !data.data.base64) return null
  return blobToDrawable(new Blob([bytesFromBase64(data.data.base64)], { type: 'image/jpeg' }))
}

async function loadImage(src) {
  const url = String(src || '')
  if (!url) return null
  if (!isRemoteUrl(url)) {
    if (/^(blob:|data:)/i.test(url)) {
      try {
        const res = await fetch(url)
        if (res.ok) {
          const drawable = await blobToDrawable(await res.blob())
          if (drawable) return drawable
        }
      } catch (e) { /* 回退本地 Image */ }
    }
    return loadHtmlImage(url, false)
  }
  try {
    const res = await fetch(url, { mode: 'cors', cache: 'no-cache' })
    if (res.ok) {
      const drawable = await blobToDrawable(await res.blob())
      if (drawable) return drawable
    }
  } catch (e) { /* 缩略图缓存可能没有 CORS，改走带标记的图或云函数 */ }
  const bust = url + (url.indexOf('?') >= 0 ? '&' : '?') + 'x-preaudit=1'
  const corsImg = await loadHtmlImage(bust, true)
  if (corsImg) return corsImg
  try {
    return await loadViaGateway(url)
  } catch (e) {
    return null
  }
}

function fitContain(iw, ih, cw, ch) {
  const s = Math.min(cw / iw, ch / ih)
  const dw = Math.max(1, iw * s)
  const dh = Math.max(1, ih * s)
  return { x: (cw - dw) / 2, y: (ch - dh) / 2, w: dw, h: dh }
}

function gridOf(n) {
  if (n <= 1) return { cols: 1, rows: 1 }
  if (n === 2) return { cols: 2, rows: 1 }
  if (n === 3) return { cols: 3, rows: 1 }
  if (n <= 6) return { cols: 3, rows: 2 }
  return { cols: 3, rows: 3 }
}

function clip(text, max) {
  const s = String(text || '')
  if (s.length <= max) return s
  return s.slice(0, max - 1) + '…'
}

export function sheetPageLabel(page, pages) {
  const cur = Math.max(1, Number(page) || 1)
  const total = Math.max(1, Number(pages) || 1)
  return '第 ' + cur + ' 页 / 共 ' + total + ' 页'
}

function makeA4() {
  const canvas = document.createElement('canvas')
  canvas.width = A4_W
  canvas.height = A4_H
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, A4_W, A4_H)
  return { canvas, ctx }
}

export function sheetMainTitle(kind) {
  return kind === 'accept' ? '现场验收照片' : '施工现场照片'
}

function innerBox() {
  return { x: PAGE_MARGIN, w: A4_W - PAGE_MARGIN * 2 }
}

function fillRound(ctx, x, y, w, h, r) {
  if (typeof ctx.roundRect === 'function') {
    ctx.beginPath()
    ctx.roundRect(x, y, w, h, r)
    ctx.fill()
    return
  }
  ctx.fillRect(x, y, w, h)
}

function headerBottom() {
  return PAGE_MARGIN + 88
}

function drawHeader(ctx, title, spec) {
  const cx = A4_W / 2
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = '#1b7a4e'
  ctx.font = '600 34px sans-serif'
  ctx.fillText(title, cx, PAGE_MARGIN + 34)
  const meta = clip(((spec.name || '') + '  ' + (spec.meta || '')).replace(/\s+/g, ' ').trim(), 46)
  ctx.fillStyle = '#5d7168'
  ctx.font = '18px sans-serif'
  if (meta) ctx.fillText(meta, cx, PAGE_MARGIN + 62)
  ctx.fillStyle = '#1b7a4e'
  ctx.fillRect(cx - 36, PAGE_MARGIN + 74, 72, 3)
}

function drawSheetFooter(ctx, page, pages) {
  const base = A4_H - PAGE_MARGIN
  ctx.save()
  ctx.strokeStyle = '#d5ddd8'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(PAGE_MARGIN, base - 28)
  ctx.lineTo(A4_W - PAGE_MARGIN, base - 28)
  ctx.stroke()
  ctx.fillStyle = '#5d7168'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.font = '16px sans-serif'
  ctx.fillText(sheetPageLabel(page, pages), A4_W / 2, base - 6)
  ctx.restore()
}

export function sheetWorkName(caption) {
  return String(caption || '').replace(/\s+/g, ' ').trim()
}

export const WORK_PHOTOS_PER_PAGE = 3

const STAGE_CODE = {
  '施工前': '前',
  '施工中': '中',
  '施工后': '后',
  '现场验收': '验'
}

export function stagePhotoCode(title, no) {
  const prefix = STAGE_CODE[String(title || '')] || String(title || '图').slice(0, 2) || '图'
  return prefix + '-' + Math.max(1, Number(no) || 1)
}

export function photoSheetCaption(title, no, caption) {
  const code = stagePhotoCode(title, no)
  const name = sheetWorkName(caption)
  return name ? code + '  ' + name : code
}

function sectionCount(sec) {
  if (typeof sec === 'number') return Math.max(0, sec)
  if (Array.isArray(sec)) return sec.length
  if (sec && Array.isArray(sec.images)) return sec.images.length
  if (sec && Array.isArray(sec.items)) return sec.items.length
  if (sec && Array.isArray(sec.paths)) return sec.paths.length
  return 0
}

export function workSheetPageCount(sections) {
  let pages = 1
  ;(sections || []).forEach((sec) => {
    pages = Math.max(pages, Math.ceil(sectionCount(sec) / WORK_PHOTOS_PER_PAGE) || 1)
  })
  return pages
}

export function workPageSlice(items, pageIndex) {
  const start = Math.max(0, Number(pageIndex) || 0) * WORK_PHOTOS_PER_PAGE
  return (items || []).slice(start, start + WORK_PHOTOS_PER_PAGE)
}

function stageRangeLabel(title, images) {
  const list = images || []
  if (!list.length) return title
  const first = stagePhotoCode(title, list[0].no != null ? list[0].no : 1)
  const lastItem = list[list.length - 1]
  const last = stagePhotoCode(title, lastItem.no != null ? lastItem.no : list.length)
  if (first === last) return title + '  ' + first
  return title + '  ' + first + '～' + last
}

function fitLabel(ctx, text, maxWidth) {
  const src = sheetWorkName(text)
  if (!src) return ''
  if (ctx.measureText(src).width <= maxWidth) return src
  let s = src
  while (s.length && ctx.measureText(s + '…').width > maxWidth) s = s.slice(0, -1)
  return s ? s + '…' : ''
}

function gridOptions(fallbackLabel) {
  if (fallbackLabel && typeof fallbackLabel === 'object') return fallbackLabel
  const title = String(fallbackLabel || '')
  return {
    codeTitle: title,
    color: '',
    emptyText: '暂无照片'
  }
}

function drawIndexBadge(ctx, x, y, text, color) {
  const label = String(text || '')
  if (!label) return
  ctx.save()
  ctx.font = '700 22px sans-serif'
  const padX = 10
  const h = 34
  const w = Math.max(52, Math.ceil(ctx.measureText(label).width) + padX * 2)
  ctx.fillStyle = color || '#1b7a4e'
  if (typeof ctx.roundRect === 'function') {
    ctx.beginPath()
    ctx.roundRect(x, y, w, h, 6)
    ctx.fill()
  } else {
    ctx.fillRect(x, y, w, h)
  }
  ctx.fillStyle = '#fff'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(label, x + w / 2, y + h / 2 + 0.5)
  ctx.restore()
}

function drawPhotoGrid(ctx, photos, box, fallbackLabel) {
  const opt = gridOptions(fallbackLabel)
  const list = (photos || []).map((item, i) => {
    if (item && item.img) {
      return {
        img: item.img,
        caption: sheetWorkName(item.caption),
        no: item.no != null ? item.no : i + 1,
        code: item.code || ''
      }
    }
    return { img: item, caption: '', no: i + 1, code: '' }
  }).filter((item) => item.img)
  const n = list.length
  if (!n) {
    ctx.fillStyle = '#f3f6f4'
    ctx.fillRect(box.x, box.y, box.w, box.h)
    ctx.fillStyle = '#7a8d84'
    ctx.font = '20px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(opt.emptyText || '暂无照片', box.x + box.w / 2, box.y + box.h / 2)
    return
  }
  const grid = gridOf(n)
  const gap = 10
  const cellW = (box.w - gap * (grid.cols - 1)) / grid.cols
  const cellH = (box.h - gap * (grid.rows - 1)) / grid.rows
  list.forEach((item, i) => {
    if (i >= grid.cols * grid.rows) return
    const col = i % grid.cols
    const row = Math.floor(i / grid.cols)
    const x = box.x + col * (cellW + gap)
    const y = box.y + row * (cellH + gap)
    ctx.fillStyle = '#eef1ef'
    ctx.fillRect(x, y, cellW, cellH)
    const pad = 6
    ctx.font = '14px sans-serif'
    const code = item.code || (opt.codeTitle ? stagePhotoCode(opt.codeTitle, item.no) : '')
    const name = fitLabel(ctx, item.caption, cellW - 16)
    const text = name || code
    const labelH = text ? 26 : 0
    const innerW = cellW - pad * 2
    const innerH = Math.max(1, cellH - pad * 2 - labelH)
    const img = item.img
    const fit = fitContain(img.width, img.height, innerW, innerH)
    ctx.drawImage(img, x + pad + fit.x, y + pad + fit.y, fit.w, fit.h)
    if (code) drawIndexBadge(ctx, x + pad, y + pad, code, opt.color)
    if (text) {
      ctx.fillStyle = '#1c2b24'
      ctx.font = '14px sans-serif'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'alphabetic'
      ctx.fillText(text, x + 8, y + cellH - 8)
    }
  })
}

async function loadPhotoEntries(entries, max) {
  const list = Array.isArray(entries) ? entries : []
  const end = Number.isFinite(max) ? Math.min(list.length, Math.max(0, max)) : list.length
  const images = []
  for (let i = 0; i < end; i++) {
    const entry = list[i]
    const src = typeof entry === 'string' ? entry : (entry && entry.path)
    if (!src) continue
    const img = await loadImage(src)
    if (!img) continue
    const caption = typeof entry === 'string' ? '' : sheetWorkName(entry && entry.caption)
    const no = typeof entry === 'object' && entry && Number(entry.no) > 0 ? Number(entry.no) : i + 1
    images.push({ img, caption, no })
  }
  return images
}

function drawWorkCanvas(spec, ready, pageIndex, pageCount) {
  const { canvas, ctx } = makeA4()
  drawHeader(ctx, sheetMainTitle('work'), spec)
  const top = headerBottom()
  const gap = 18
  const sectionH = (A4_H - top - FOOTER_H - gap * 2) / 3
  const box = innerBox()
  ready.forEach((sec, i) => {
    const y = top + i * (sectionH + gap)
    const slice = workPageSlice(sec.images, pageIndex)
    ctx.fillStyle = sec.color || '#1b7a4e'
    fillRound(ctx, box.x, y, box.w, 40, 6)
    ctx.fillStyle = '#fff'
    ctx.font = '22px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'alphabetic'
    ctx.fillText(stageRangeLabel(sec.title, slice), A4_W / 2, y + 28)
    drawPhotoGrid(ctx, slice, { x: box.x, y: y + 48, w: box.w, h: sectionH - 48 }, {
      codeTitle: sec.title,
      color: sec.color,
      emptyText: pageIndex ? '本页无' : '暂无照片'
    })
  })
  drawSheetFooter(ctx, pageIndex + 1, pageCount)
  return canvas
}

export async function renderWorkPages(spec) {
  const ready = []
  for (const sec of spec.sections || []) {
    ready.push({
      title: sec.title,
      color: sec.color,
      images: await loadPhotoEntries(sec.items || sec.paths)
    })
  }
  const pageCount = workSheetPageCount(ready)
  const pages = []
  for (let p = 0; p < pageCount; p++) pages.push(drawWorkCanvas(spec, ready, p, pageCount))
  return pages
}

export async function renderAcceptPages(spec) {
  const { canvas, ctx } = makeA4()
  drawHeader(ctx, sheetMainTitle('accept'), spec)
  const box = innerBox()
  const top = headerBottom()
  ctx.fillStyle = '#c4841a'
  fillRound(ctx, box.x, top, box.w, 40, 6)
  ctx.fillStyle = '#fff'
  ctx.font = '22px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.fillText('现场验收', A4_W / 2, top + 28)
  ctx.fillStyle = '#1c2b24'
  ctx.font = '18px sans-serif'
  ctx.fillText(clip(spec.peopleText || '未登记到场人员', 48), A4_W / 2, top + 64)
  const images = await loadPhotoEntries(spec.items || spec.paths, 9)
  drawPhotoGrid(ctx, images, { x: box.x, y: top + 80, w: box.w, h: A4_H - top - 80 - FOOTER_H }, {
    codeTitle: '现场验收',
    color: '#c4841a',
    emptyText: '暂无照片'
  })
  drawSheetFooter(ctx, 1, 1)
  return [canvas]
}

function asciiBytes(text) {
  const src = String(text)
  const out = new Uint8Array(src.length)
  for (let i = 0; i < src.length; i++) out[i] = src.charCodeAt(i) & 0xff
  return out
}

export function buildJpegPdf(pages) {
  const list = Array.isArray(pages) ? pages.filter((p) => p && p.bytes && p.bytes.length) : []
  if (!list.length) throw new Error('没有可导出的页面')
  const n = list.length
  const pageId = (i) => 3 + i
  const imageId = (i) => 3 + n + i
  const contentId = (i) => 3 + 2 * n + i
  const totalObjs = 2 + 3 * n
  const chunks = []
  const offsets = new Array(totalObjs + 1)
  let pos = 0

  function write(data) {
    const bytes = typeof data === 'string' ? asciiBytes(data) : data
    chunks.push(bytes)
    pos += bytes.length
  }

  function startObj(id) {
    offsets[id] = pos
    write(id + ' 0 obj\n')
  }

  function endObj() {
    write('\nendobj\n')
  }

  write('%PDF-1.4\n%')
  write(Uint8Array.from([0x80, 0x80, 0x80, 0x80, 0x0a]))

  startObj(1)
  write('<< /Type /Catalog /Pages 2 0 R >>')
  endObj()

  startObj(2)
  write('<< /Type /Pages /Count ' + n + ' /Kids [' + list.map((_, i) => pageId(i) + ' 0 R').join(' ') + '] >>')
  endObj()

  list.forEach((_, i) => {
    startObj(pageId(i))
    write(
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' +
        A4_PT_W +
        ' ' +
        A4_PT_H +
        '] /Resources << /XObject << /Im' +
        i +
        ' ' +
        imageId(i) +
        ' 0 R >> >> /Contents ' +
        contentId(i) +
        ' 0 R >>'
    )
    endObj()
  })

  list.forEach((page, i) => {
    const jpg = page.bytes instanceof Uint8Array ? page.bytes : Uint8Array.from(page.bytes)
    startObj(imageId(i))
    write(
      '<< /Type /XObject /Subtype /Image /Width ' +
        Math.max(1, page.width || A4_W) +
        ' /Height ' +
        Math.max(1, page.height || A4_H) +
        ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' +
        jpg.length +
        ' >>\nstream\n'
    )
    write(jpg)
    write('\nendstream')
    endObj()
  })

  list.forEach((_, i) => {
    const content = 'q ' + A4_PT_W + ' 0 0 ' + A4_PT_H + ' 0 0 cm /Im' + i + ' Do Q\n'
    startObj(contentId(i))
    write('<< /Length ' + content.length + ' >>\nstream\n' + content + 'endstream')
    endObj()
  })

  const xrefPos = pos
  write('xref\r\n0 ' + (totalObjs + 1) + '\r\n')
  write('0000000000 65535 f \r\n')
  for (let i = 1; i <= totalObjs; i++) {
    write(String(offsets[i] || 0).padStart(10, '0') + ' 00000 n \r\n')
  }
  write('trailer\r\n<< /Size ' + (totalObjs + 1) + ' /Root 1 0 R >>\r\nstartxref\r\n' + xrefPos + '\r\n%%EOF')

  const out = new Uint8Array(pos)
  let offset = 0
  chunks.forEach((chunk) => {
    out.set(chunk, offset)
    offset += chunk.length
  })
  return out
}

export function canvasToJpegBlob(canvas) {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => {
        if (!blob) reject(new Error('导出失败'))
        else resolve(blob)
      }, 'image/jpeg', 0.92)
    } catch (e) {
      if (/tainted|Tainted|SecurityError/i.test(String((e && e.message) || e || ''))) {
        reject(new Error('云端照片跨域，刷新后再生成一次'))
      } else {
        reject(e)
      }
    }
  })
}

export async function packSheetPages(canvases) {
  const list = (canvases || []).filter(Boolean)
  if (!list.length) throw new Error('没有可预览的页面')
  const jpgBlobs = []
  for (let i = 0; i < list.length; i++) jpgBlobs.push(await canvasToJpegBlob(list[i]))
  const pages = []
  for (let i = 0; i < list.length; i++) {
    pages.push({
      width: list[i].width,
      height: list[i].height,
      bytes: new Uint8Array(await jpgBlobs[i].arrayBuffer())
    })
  }
  const pdfBlob = new Blob([buildJpegPdf(pages)], { type: 'application/pdf' })
  return {
    pageCount: list.length,
    jpgBlobs,
    jpgUrls: jpgBlobs.map((blob) => URL.createObjectURL(blob)),
    pdfBlob,
    pdfUrl: URL.createObjectURL(pdfBlob)
  }
}

export function revokeSheetPack(pack) {
  if (!pack) return
  ;(pack.jpgUrls || []).forEach((url) => {
    try { URL.revokeObjectURL(url) } catch (e) { /* ignore */ }
  })
  if (pack.pdfUrl) {
    try { URL.revokeObjectURL(pack.pdfUrl) } catch (e) { /* ignore */ }
  }
}

function downloadCanvas(canvas, filename) {
  return canvasToJpegBlob(canvas).then((blob) => {
    const url = URL.createObjectURL(blob)
    downloadUrl(url, filename)
    setTimeout(() => URL.revokeObjectURL(url), 800)
    return true
  })
}

export async function exportWorkSheet(spec) {
  const pages = await renderWorkPages(spec)
  const base = (spec.name || '施工照片') + '-施工A4'
  if (pages.length === 1) return downloadCanvas(pages[0], base + '.jpg')
  for (let i = 0; i < pages.length; i++) {
    await downloadCanvas(pages[i], base + '-' + (i + 1) + '.jpg')
  }
  return true
}

export async function exportAcceptSheet(spec) {
  const pages = await renderAcceptPages(spec)
  return downloadCanvas(pages[0], (spec.name || '验收照片') + '-验收A4.jpg')
}

export async function makeWatermark(src, projectName, stampDate) {
  const img = await loadImage(src)
  if (!img) throw new Error('读取合同图片失败')
  let w = img.width
  let h = img.height
  const max = 1200
  if (w > max || h > max) {
    const scale = Math.min(max / w, max / h)
    w = Math.round(w * scale)
    h = Math.round(h * scale)
  }
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0, w, h)
  const mark = '仅供报账彩打 / ' + (projectName || '未命名项目') + ' / ' + (stampDate || '')
  ctx.save()
  ctx.rotate(-Math.PI / 7)
  ctx.fillStyle = 'rgba(183, 28, 28, 0.2)'
  ctx.font = '22px sans-serif'
  for (let y = -h; y < h * 2; y += 90) {
    for (let x = -w; x < w * 2; x += Math.max(320, mark.length * 12)) {
      ctx.fillText(mark, x, y)
    }
  }
  ctx.restore()
  ctx.fillStyle = 'rgba(255, 255, 255, 0.82)'
  ctx.fillRect(0, 0, w, 72)
  ctx.fillStyle = '#1b6b4a'
  ctx.font = '18px sans-serif'
  ctx.fillText('仅供报账彩打', 16, 28)
  ctx.font = '15px sans-serif'
  ctx.fillText((projectName || '未命名项目') + '  ' + (stampDate || ''), 16, 54)
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('导出水印失败'))), 'image/jpeg', 0.92)
  })
  return URL.createObjectURL(blob)
}

export function downloadUrl(url, filename) {
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
}
