import { reactive } from 'vue'

function captionOf(file) {
  if (!file) return ''
  return String(file.caption || file.name || '').trim()
}

export function usePhotoPreview() {
  const preview = reactive({ src: '', caption: '', files: [], index: 0 })

  const sync = () => {
    const file = preview.files[preview.index]
    preview.src = (file && file.path) || ''
    preview.caption = captionOf(file)
  }

  const open = (file, files) => {
    preview.files = (files || []).filter((item) => item && item.path)
    const src = file && file.path
    const idx = preview.files.findIndex((item) => item === file || item.id === (file && file.id) || item.path === src)
    preview.index = idx >= 0 ? idx : 0
    if (!preview.files.length && src) preview.files = [file]
    sync()
  }

  const close = () => {
    preview.src = ''
    preview.caption = ''
  }

  const step = (delta) => {
    if (preview.files.length < 2) return
    preview.index = (preview.index + Number(delta || 0) + preview.files.length) % preview.files.length
    sync()
  }

  return { preview, open, close, step, sync }
}
