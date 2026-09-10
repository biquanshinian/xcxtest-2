import { pickPhotoSrc } from './photo-slots.js'

export function fileOcrSource(file) {
  if (!file) return ''
  return pickPhotoSrc(file) || file.path || ''
}

export function ocrUploadBatch(files) {
  const list = (files || []).filter((f) => fileOcrSource(f))
  if (list.length <= 4) return list
  const pick = [list[0], list[1], list[list.length - 2], list[list.length - 1]]
  const seen = new Set()
  return pick.filter((file) => {
    const id = file.id || file.path
    if (!id || seen.has(id)) return false
    seen.add(id)
    return true
  })
}
