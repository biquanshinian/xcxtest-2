<template>
  <Teleport to="body">
    <div v-if="open" class="pa-lightbox pa-lightbox--dialog pa-sheet-overlay" @click="onMask">
      <div class="pa-sheet-dialog" @click.stop>
        <div class="pa-row">
          <div class="pa-grow">
            <p class="pa-title pa-sheet-heading">{{ title || 'A4 预览' }}</p>
          </div>
          <el-button text @click="emit('close')">关闭</el-button>
        </div>

        <div v-if="!mode" class="pa-sheet-choice">
          <button type="button" class="pa-sheet-pick" @click="emit('mode', 'jpg')">
            <strong>JPG</strong>
          </button>
          <button type="button" class="pa-sheet-pick" @click="emit('mode', 'pdf')">
            <strong>PDF</strong>
          </button>
        </div>

        <template v-else>
          <div class="pa-sheet-switch">
            <el-button size="small" :type="mode === 'jpg' ? 'primary' : 'default'" @click="emit('mode', 'jpg')">JPG</el-button>
            <el-button size="small" :type="mode === 'pdf' ? 'primary' : 'default'" @click="emit('mode', 'pdf')">PDF</el-button>
          </div>
          <div class="pa-sheet-preview">
            <template v-if="mode === 'jpg'">
              <img v-for="(url, i) in jpgUrls" :key="url" :src="url" :alt="'第 ' + (i + 1) + ' 页'" />
            </template>
            <iframe v-else-if="pdfUrl" class="pa-sheet-frame" :src="pdfUrl + '#view=FitH'" title="A4 PDF 预览" />
          </div>
          <div class="pa-lightbox-bar pa-sheet-bar">
            <el-button type="primary" @click="emit('download')">下载{{ mode === 'pdf' ? ' PDF' : ' JPG' }}</el-button>
            <el-button @click="emit('close')">关闭</el-button>
          </div>
        </template>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { onMounted, onUnmounted } from 'vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, default: '' },
  mode: { type: String, default: '' },
  jpgUrls: { type: Array, default: () => [] },
  pdfUrl: { type: String, default: '' }
})

const emit = defineEmits(['close', 'mode', 'download'])

const onMask = () => emit('close')

const onKey = (e) => {
  if (!props.open) return
  if (e.key === 'Escape') emit('close')
}

onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))
</script>
