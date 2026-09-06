<template>
    <div
      class="tw-sample-cell"
      :class="{ 'is-disabled': disabled, 'is-busy': busy }"
      tabindex="0"
      @dragover.prevent
      @drop.prevent="onDrop"
      @paste="onPaste"
    >
    <input ref="fileInput" type="file" accept="image/*" class="tw-hidden" tabindex="-1" :disabled="disabled" @change="onFile" />
    <div v-if="modelValue" class="tw-sample-cell__preview" tabindex="0" @paste="onPaste" @click.stop="openPreview">
      <img :src="modelValue" alt="样图" />
      <div v-if="busy" class="tw-sample-cell__mask">处理中…</div>
    </div>
    <div
      v-else
      class="tw-sample-cell__empty"
      contenteditable="true"
      tabindex="0"
      @paste.prevent="onPaste"
      @click="focusPaste"
      @keydown="onEmptyKeydown"
    >
      <span>{{ busy ? '处理中…' : '点此粘贴 / 拖入' }}</span>
      <small>Ctrl+V 截图</small>
    </div>
    <div class="tw-sample-cell__ops">
      <button type="button" class="tw-mini-btn" :disabled="disabled || busy" @click.stop="pick">上传</button>
      <button v-if="modelValue" type="button" class="tw-mini-btn is-danger" :disabled="disabled || busy" @click.stop="clear">清除</button>
    </div>
    <div v-if="err" class="tw-sample-cell__err">{{ err }}</div>
    <Teleport to="body">
      <div v-if="previewOpen" class="tw-sample-lightbox" @click="closePreview">
        <img :src="modelValue" alt="样图预览" />
      </div>
    </Teleport>
  </div>
</template>

<script setup>
import { onBeforeUnmount, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { fileFromClipboard, fileFromDrop, uploadTuwenImage } from '../../utils/tuwen-upload.js'

const props = defineProps({
  modelValue: { type: String, default: '' },
  disabled: { type: Boolean, default: false }
})
const emit = defineEmits(['update:modelValue'])

const fileInput = ref(null)
const busy = ref(false)
const err = ref('')
const previewOpen = ref(false)

function pick() {
  if (props.disabled) return
  fileInput.value && fileInput.value.click()
}

function focusPaste(e) {
  if (props.disabled) return
  const el = e.currentTarget
  if (el && typeof el.focus === 'function') el.focus()
}

function onEmptyKeydown(e) {
  if ((e.ctrlKey || e.metaKey) && String(e.key).toLowerCase() === 'v') return
  if (e.key === 'Tab' || e.key === 'Escape') return
  e.preventDefault()
}

function clear() {
  emit('update:modelValue', '')
  err.value = ''
}

function closePreview() {
  previewOpen.value = false
}

function onPreviewKey(e) {
  if (e.key === 'Escape') closePreview()
}

function openPreview() {
  if (!props.modelValue) return
  previewOpen.value = true
}

watch(previewOpen, (open) => {
  if (open) window.addEventListener('keydown', onPreviewKey)
  else window.removeEventListener('keydown', onPreviewKey)
})

onBeforeUnmount(() => window.removeEventListener('keydown', onPreviewKey))

async function handleFile(file) {
  if (!file || props.disabled) return
  busy.value = true
  err.value = ''
  try {
    const res = await uploadTuwenImage(file)
    emit('update:modelValue', res.url)
    ElMessage.success(res.fallback ? '样图已附在订单里，保存时写入 COS' : '样图已上传')
  } catch (e) {
    err.value = (e && e.message) || '无法处理该图片'
  } finally {
    busy.value = false
  }
}

function onFile(e) {
  const file = e.target.files && e.target.files[0]
  if (fileInput.value) fileInput.value.value = ''
  handleFile(file)
}

function onPaste(e) {
  const file = fileFromClipboard(e)
  if (!file) return
  e.preventDefault()
  handleFile(file)
}

function onDrop(e) {
  const file = fileFromDrop(e)
  if (file) handleFile(file)
}
</script>
