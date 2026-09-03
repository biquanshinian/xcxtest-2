import { onMounted, onUnmounted, ref } from 'vue'
import { filesFromDataTransfer, isEditableTarget, isFileDrag } from './upload.js'

export function usePhotoZone(onFiles) {
  const dropKey = ref('')
  const focusKey = ref('')
  const depth = Object.create(null)

  const mark = (key) => {
    if (key) focusKey.value = key
  }

  const onDragEnter = (e, key) => {
    if (!isFileDrag(e.dataTransfer)) return
    e.preventDefault()
    depth[key] = (depth[key] || 0) + 1
    dropKey.value = key
    mark(key)
  }

  const onDragOver = (e, key) => {
    if (!isFileDrag(e.dataTransfer)) return
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    dropKey.value = key
    mark(key)
  }

  const onDragLeave = (e, key) => {
    e.preventDefault()
    depth[key] = Math.max(0, (depth[key] || 0) - 1)
    if (!depth[key] && dropKey.value === key) dropKey.value = ''
  }

  const onDrop = (e, key) => {
    if (!isFileDrag(e.dataTransfer)) return
    e.preventDefault()
    depth[key] = 0
    dropKey.value = ''
    mark(key)
    const list = filesFromDataTransfer(e.dataTransfer)
    if (list.length) onFiles(list, key)
  }

  let lastPaste = 0
  const onPaste = (e) => {
    if (isEditableTarget(e.target)) return
    const list = filesFromDataTransfer(e.clipboardData, { paste: true })
    if (!list.length) return
    const now = Date.now()
    if (now - lastPaste < 400) return
    lastPaste = now
    e.preventDefault()
    onFiles(list, focusKey.value)
  }

  onMounted(() => window.addEventListener('paste', onPaste))
  onUnmounted(() => window.removeEventListener('paste', onPaste))

  return { dropKey, focusKey, mark, onDragEnter, onDragOver, onDragLeave, onDrop }
}
