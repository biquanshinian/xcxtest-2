export function isFileDrag(dt) {
  if (!dt || !dt.types) return false
  const types = Array.from(dt.types)
  return types.indexOf('Files') >= 0 || types.indexOf('application/x-moz-file') >= 0
}

export function isEditableTarget(el) {
  if (!el) return false
  const tag = String(el.tagName || '').toLowerCase()
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true
  if (el.isContentEditable) return true
  return !!(el.closest && el.closest('input, textarea, select, [contenteditable="true"]'))
}

export function clonePickedFile(file) {
  if (!file) return file
  if (typeof Blob === 'undefined' || !(file instanceof Blob)) return file
  try {
    if (typeof File === 'function' && file instanceof File) {
      return new File([file], file.name || 'image.jpg', {
        type: file.type || 'image/jpeg',
        lastModified: file.lastModified || Date.now()
      })
    }
    return file.slice(0, file.size, file.type || 'image/jpeg')
  } catch (e) {
    return file
  }
}

function namedShot(file) {
  if (!file) return file
  const raw = String(file.name || '')
  if (raw && raw !== 'image.png' && raw !== 'image.jpg' && raw !== 'blob') return file
  const ext = ((file.type || '').split('/')[1] || 'png').replace('jpeg', 'jpg')
  return new File([file], '截图-' + Date.now() + '.' + ext, { type: file.type || 'image/png' })
}

function fileKey(file) {
  return [file.size || 0, file.type || '', file.lastModified || 0].join(':')
}

function collectRaw(dt) {
  if (!dt) return []
  if (dt.files && dt.files.length) return Array.from(dt.files).filter(Boolean)
  const items = dt.items
  if (!items) return []
  const out = []
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (!item || item.kind !== 'file') continue
    const file = item.getAsFile()
    if (file) out.push(file)
  }
  return out
}

function uniqueFiles(list) {
  const seen = new Set()
  const out = []
  list.forEach((file) => {
    const key = fileKey(file)
    if (seen.has(key)) return
    seen.add(key)
    out.push(file)
  })
  return out
}

function pickPasteImages(list) {
  const images = list.filter((file) => (file.type && file.type.startsWith('image/')) || /\.(jpe?g|png|gif|webp|bmp)$/i.test(file.name || ''))
  if (!images.length) return list
  const png = images.find((file) => /png/i.test(file.type || file.name || ''))
  return [png || images[0]]
}

export function filesFromDataTransfer(dt, opts) {
  const raw = uniqueFiles(collectRaw(dt))
  const list = (opts && opts.paste) ? pickPasteImages(raw) : raw
  return list.map((file) => clonePickedFile(namedShot(file)))
}

/** Copy FileList before resetting input.value — the native list is live and goes empty. */
export function filesFromInput(input) {
  return Array.from((input && input.files) || []).filter(Boolean).map(clonePickedFile)
}
