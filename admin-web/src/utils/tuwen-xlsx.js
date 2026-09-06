const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
    t[i] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function concatBytes(chunks) {
  let n = 0
  for (const c of chunks) n += c.length
  const out = new Uint8Array(n)
  let off = 0
  for (const c of chunks) {
    out.set(c, off)
    off += c.length
  }
  return out
}

function u16(n) {
  const b = new Uint8Array(2)
  new DataView(b.buffer).setUint16(0, n, true)
  return b
}

function u32(n) {
  const b = new Uint8Array(4)
  new DataView(b.buffer).setUint32(0, n, true)
  return b
}

export function zipStore(entries) {
  const enc = new TextEncoder()
  const locals = []
  const centrals = []
  let offset = 0
  for (const entry of entries) {
    const name = enc.encode(entry.name)
    const data = entry.data instanceof Uint8Array ? entry.data : new Uint8Array(entry.data)
    const crc = crc32(data)
    const local = concatBytes([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(name.length),
      u16(0),
      name,
      data
    ])
    const central = concatBytes([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(name.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      name
    ])
    locals.push(local)
    centrals.push(central)
    offset += local.length
  }
  const centralStart = offset
  const centralSize = centrals.reduce((n, c) => n + c.length, 0)
  const eocd = concatBytes([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(centralSize),
    u32(centralStart),
    u16(0)
  ])
  return concatBytes([...locals, ...centrals, eocd])
}

function xml(raw) {
  return String(raw == null ? '' : raw)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function inlineCell(ref, text, style) {
  const s = style ? ` s="${style}"` : ''
  return `<c r="${ref}" t="inlineStr"${s}><is><t xml:space="preserve">${xml(text)}</t></is></c>`
}

function colLetter(i) {
  let n = i + 1
  let s = ''
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

function sniffExt(bytes) {
  if (bytes && bytes.length >= 4) {
    if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'png'
    if (bytes[0] === 0x47 && bytes[1] === 0x49) return 'gif'
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpeg'
  }
  return 'jpeg'
}

const COL_WIDTHS = [12, 16, 16, 16, 12, 8, 8, 8, 10, 12, 14, 14]
const EMU_PER_PX = 9525
const PIC_MAX_W = 80
const PIC_MAX_H = 54

function pictureSize(img) {
  const w = Number(img && img.width) || 0
  const h = Number(img && img.height) || 0
  if (w > 0 && h > 0) {
    const scale = Math.min(PIC_MAX_W / w, PIC_MAX_H / h, 1)
    return {
      cx: Math.max(1, Math.round(w * scale * EMU_PER_PX)),
      cy: Math.max(1, Math.round(h * scale * EMU_PER_PX))
    }
  }
  return { cx: PIC_MAX_W * EMU_PER_PX, cy: PIC_MAX_H * EMU_PER_PX }
}

export function buildStatementXlsx(model, images) {
  const headers = (model && model.headers) || []
  const rows = (model && model.rows) || []
  const pics = Array.isArray(images) ? images.filter((img) => img && img.bytes && img.bytes.length) : []
  const colCount = Math.max(headers.length, 12)
  const lastCol = colLetter(colCount - 1)
  const dataStart = 4
  const sumRow = dataStart + rows.length + 1
  const lastRow = model && model.company ? sumRow + 1 : sumRow

  const sheetRows = []
  sheetRows.push(`<row r="1" ht="24" customHeight="1">${inlineCell('A1', model.title || '对账单', 1)}</row>`)
  sheetRows.push(`<row r="2">${inlineCell('A2', `期间 ${model.period || '全部期间'}`)}</row>`)
  sheetRows.push(`<row r="3" ht="18" customHeight="1">${headers.map((h, i) => inlineCell(`${colLetter(i)}3`, h, 2)).join('')}</row>`)
  rows.forEach((cells, idx) => {
    const r = dataStart + idx
    const hasPic = pics.some((p) => p.row === idx)
    const ht = hasPic ? ' ht="48" customHeight="1"' : ''
    const tds = (cells || []).map((c, i) => inlineCell(`${colLetter(i)}${r}`, i === 10 ? '' : c, 3)).join('')
    sheetRows.push(`<row r="${r}"${ht}>${tds}</row>`)
  })
  const sums = (model && model.sums) || {}
  sheetRows.push(`<row r="${sumRow}">${inlineCell(`A${sumRow}`, `总金额 ${sums.subtotalText || ''}　优惠金额 ${sums.discountText || ''}　已收款 ${sums.paidText || ''}　欠款 ${sums.unpaidText || ''}`, 2)}</row>`)
  if (model && model.company) {
    sheetRows.push(`<row r="${sumRow + 1}">${inlineCell(`A${sumRow + 1}`, `公司名称 ${model.company}`)}</row>`)
  }

  const cols = COL_WIDTHS.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')
  const drawing = pics.length ? '<drawing r:id="rId1"/>' : ''
  const sheet1 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <dimension ref="A1:${lastCol}${lastRow}"/>
  <sheetViews><sheetView workbookViewId="0"/></sheetViews>
  <sheetFormatPr defaultRowHeight="16"/>
  <cols>${cols}</cols>
  <sheetData>${sheetRows.join('')}</sheetData>
  <mergeCells count="3">
    <mergeCell ref="A1:${lastCol}1"/>
    <mergeCell ref="A2:${lastCol}2"/>
    <mergeCell ref="A${sumRow}:${lastCol}${sumRow}"/>
  </mergeCells>
  ${drawing}
</worksheet>`

  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="3">
    <font><sz val="11"/><name val="宋体"/></font>
    <font><b/><sz val="16"/><name val="宋体"/></font>
    <font><b/><sz val="11"/><name val="宋体"/></font>
  </fonts>
  <fills count="2">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"/><right style="thin"/><top style="thin"/><bottom style="thin"/><diagonal/>
    </border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="4">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
  </cellXfs>
</styleSheet>`

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="对账单" sheetId="1" r:id="rId1"/></sheets>
</workbook>`

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`

  const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`

  const defaults = [
    { name: '[Content_Types].xml', data: null },
    { name: '_rels/.rels', data: new TextEncoder().encode(rootRels) },
    { name: 'xl/workbook.xml', data: new TextEncoder().encode(workbook) },
    { name: 'xl/_rels/workbook.xml.rels', data: new TextEncoder().encode(wbRels) },
    { name: 'xl/styles.xml', data: new TextEncoder().encode(styles) },
    { name: 'xl/worksheets/sheet1.xml', data: new TextEncoder().encode(sheet1) }
  ]

  const media = []
  const drawingAnchors = []
  const drawingRels = []
  pics.forEach((img, i) => {
    const ext = img.ext || sniffExt(img.bytes)
    const file = `image${i + 1}.${ext === 'jpg' ? 'jpeg' : ext}`
    media.push({ name: `xl/media/${file}`, data: img.bytes instanceof Uint8Array ? img.bytes : new Uint8Array(img.bytes) })
    const rid = `rId${i + 1}`
    drawingRels.push(`<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${file}"/>`)
    const excelRow = dataStart + Number(img.row || 0) - 1
    const size = pictureSize(img)
    drawingAnchors.push(`<xdr:oneCellAnchor>
      <xdr:from><xdr:col>10</xdr:col><xdr:colOff>47625</xdr:colOff><xdr:row>${excelRow}</xdr:row><xdr:rowOff>47625</xdr:rowOff></xdr:from>
      <xdr:ext cx="${size.cx}" cy="${size.cy}"/>
      <xdr:pic>
        <xdr:nvPicPr><xdr:cNvPr id="${i + 2}" name="样图${i + 1}"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>
        <xdr:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>
        <xdr:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr>
      </xdr:pic>
      <xdr:clientData/>
    </xdr:oneCellAnchor>`)
  })

  if (pics.length) {
    const drawingXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
${drawingAnchors.join('\n')}
</xdr:wsDr>`
    const drawingRelXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${drawingRels.join('\n')}
</Relationships>`
    defaults.push({ name: 'xl/worksheets/_rels/sheet1.xml.rels', data: new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>
</Relationships>`) })
    defaults.push({ name: 'xl/drawings/drawing1.xml', data: new TextEncoder().encode(drawingXml) })
    defaults.push({ name: 'xl/drawings/_rels/drawing1.xml.rels', data: new TextEncoder().encode(drawingRelXml) })
  }

  const imageDefaults = pics.length
    ? `<Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="jpg" ContentType="image/jpeg"/><Default Extension="png" ContentType="image/png"/><Default Extension="gif" ContentType="image/gif"/>`
    : ''
  const drawingOverride = pics.length
    ? '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>'
    : ''
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  ${imageDefaults}
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  ${drawingOverride}
</Types>`
  defaults[0].data = new TextEncoder().encode(contentTypes)

  return zipStore([...defaults, ...media])
}

export function sniffImageExt(bytes) {
  return sniffExt(bytes)
}
