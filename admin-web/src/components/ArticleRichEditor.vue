<template>
  <div class="article-rich-editor">
    <div class="editor-toolbar">
      <el-button size="small" type="primary" @click="triggerPickImage">插入图片</el-button>
      <span class="toolbar-hint">
        正文支持输入文字；拖拽、粘贴或插入图片排版，插图至多 {{ maxImages }} 张；保存时<strong>首张插图</strong>将作为小程序详情页头图。
      </span>
    </div>
    <div
      ref="editorRef"
      class="editor-area"
      contenteditable="true"
      spellcheck="false"
      data-placeholder="输入正文，可直接粘贴文字或图片…"
      @input="emitHtml"
      @paste="onPaste"
      @drop.prevent="onDrop"
      @dragover.prevent
    ></div>
    <input ref="fileInputRef" type="file" accept="image/jpeg,image/png,image/gif,image/webp" multiple style="display:none" @change="onFileInputChange" />
  </div>
</template>

<script setup>
import { nextTick, onMounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { api } from '../api/client'

const props = defineProps({
  modelValue: { type: String, default: '' },
  maxImages: { type: Number, default: 5 }
})

const emit = defineEmits(['update:modelValue'])

const editorRef = ref(null)
const fileInputRef = ref(null)

function countImgTags(html) {
  if (!html) return 0
  return (String(html).match(/<img\b/gi) || []).length
}

function getExt(name) {
  const parts = (name || '').split('.')
  return (parts.length > 1 ? parts.pop() : 'jpg').toLowerCase()
}

async function xhrPut(url, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url, true)
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream')
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100))
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve()
      else reject(new Error(`HTTP ${xhr.status}`))
    }
    xhr.onerror = () => reject(new Error('网络错误'))
    xhr.send(file)
  })
}

async function uploadOneImage(file) {
  const ext = getExt(file.name) || 'jpg'
  const key = `admin-uploads/news/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`
  const presignData = await api.cosPresign({ key })
  await xhrPut(presignData.uploadUrl, file)
  return presignData.cosUrl
}

function insertHtmlAtCaret(html) {
  const el = editorRef.value
  if (!el) return
  el.focus()
  const sel = window.getSelection()
  if (!sel || !sel.rangeCount) {
    el.insertAdjacentHTML('beforeend', html)
    emitHtml()
    return
  }
  const range = sel.getRangeAt(0)
  if (!el.contains(range.commonAncestorContainer)) {
    el.insertAdjacentHTML('beforeend', html)
    emitHtml()
    return
  }
  range.deleteContents()
  const tpl = document.createElement('template')
  tpl.innerHTML = html.trim()
  const frag = document.createDocumentFragment()
  while (tpl.content.firstChild) frag.appendChild(tpl.content.firstChild)
  range.insertNode(frag)
  range.collapse(false)
  sel.removeAllRanges()
  sel.addRange(range)
  emitHtml()
}

const IMG_WRAP =
  '<p><img src="__SRC__" style="max-width:100%;height:auto;display:block;border-radius:8px;margin:12px 0;" /></p>'

async function insertImageFromFile(file) {
  const htmlNow = editorRef.value ? editorRef.value.innerHTML : ''
  if (countImgTags(htmlNow) >= props.maxImages) {
    ElMessage.warning(`正文插图最多 ${props.maxImages} 张`)
    return
  }
  if (!file || !file.type || !file.type.startsWith('image/')) {
    ElMessage.warning('请上传图片文件')
    return
  }
  const maxBytes = 10 * 1024 * 1024
  if (file.size > maxBytes) {
    ElMessage.warning('单张图片请勿超过 10MB')
    return
  }
  try {
    const url = await uploadOneImage(file)
    insertHtmlAtCaret(IMG_WRAP.replace('__SRC__', url))
    ElMessage.success('图片已插入')
  } catch (e) {
    ElMessage.error((e && e.message) || '上传失败，请检查 COS 跨域或稍后重试')
  }
}

function emitHtml() {
  const el = editorRef.value
  emit('update:modelValue', el ? el.innerHTML : '')
}

function onPaste(e) {
  const items = e.clipboardData?.items
  if (!items) return
  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    if (it.kind === 'file' && it.type && it.type.startsWith('image/')) {
      e.preventDefault()
      const f = it.getAsFile()
      if (f) insertImageFromFile(f)
      return
    }
  }
}

function onDrop(e) {
  const files = Array.from(e.dataTransfer?.files || []).filter((f) => f.type && f.type.startsWith('image/'))
  if (!files.length) return
  files.forEach((f) => insertImageFromFile(f))
}

function triggerPickImage() {
  fileInputRef.value?.click()
}

function onFileInputChange(ev) {
  const files = Array.from(ev.target?.files || [])
  files.forEach((f) => insertImageFromFile(f))
  ev.target.value = ''
}

function applyExternalValue(html) {
  const el = editorRef.value
  if (!el) return
  const next = html || ''
  if (el.innerHTML !== next) el.innerHTML = next
}

watch(
  () => props.modelValue,
  (v) => {
    const el = editorRef.value
    if (!el || document.activeElement === el) return
    applyExternalValue(v)
  }
)

onMounted(() => {
  nextTick(() => applyExternalValue(props.modelValue))
})
</script>

<style scoped>
.article-rich-editor {
  width: 100%;
}

.editor-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}

.toolbar-hint {
  font-size: 12px;
  color: var(--el-text-color-secondary, #909399);
  line-height: 1.5;
  flex: 1;
  min-width: 200px;
}

.toolbar-hint strong {
  color: var(--el-color-primary, #409eff);
}

.editor-area {
  min-height: 280px;
  padding: 12px 14px;
  border: 1px solid var(--el-border-color, #dcdfe6);
  border-radius: 8px;
  background: var(--el-fill-color-blank, #fff);
  font-size: 14px;
  line-height: 1.65;
  color: var(--el-text-color-primary, #303133);
  outline: none;
}

.editor-area:focus {
  border-color: var(--el-color-primary, #409eff);
  box-shadow: 0 0 0 1px rgba(64, 158, 255, 0.12);
}

.editor-area:empty::before {
  content: attr(data-placeholder);
  color: var(--el-text-color-placeholder, #a8abb2);
  pointer-events: none;
}

.editor-area :deep(img) {
  max-width: 100%;
  height: auto;
  vertical-align: middle;
}
</style>
