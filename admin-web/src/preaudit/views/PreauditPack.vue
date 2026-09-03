<template>
  <div class="pa">
    <div v-if="!orgLocked" class="pa-card">
      <p class="pa-title">哪边报账？</p>
      <div class="pa-item" :class="{ on: orgType === 'village' }" @click="orgType = 'village'">
        <div class="pa-tile village">村</div>
        <div class="pa-grow">
          <div>村委会</div>
          <div class="pa-sub">开会、公示、招标、合同、发票</div>
        </div>
      </div>
      <div class="pa-item" :class="{ on: orgType === 'small' }" @click="orgType = 'small'">
        <div class="pa-tile small">小</div>
        <div class="pa-grow">
          <div>村委会小额</div>
          <div class="pa-sub">报价、比价、施工照、发票</div>
        </div>
      </div>
      <div class="pa-item" :class="{ on: orgType === 'township' }" @click="orgType = 'township'">
        <div class="pa-tile town">乡</div>
        <div class="pa-grow">
          <div>乡政府</div>
          <div class="pa-sub">审批到发票整包拆页</div>
        </div>
      </div>
    </div>

    <div v-if="orgType" class="pa-card" :style="orgLocked ? '' : 'margin-top: 12px;'">
      <p class="pa-title">整包 PDF 一键审核</p>
      <div class="pa-sub">按每页内容归类，只在本机拆页。超过 80 页只看前 80 页。</div>
      <label
        class="pa-drop"
        :class="{ on: dragging, busy: busy }"
        @dragover.prevent="dragging = true"
        @dragleave.prevent="dragging = false"
        @drop.prevent="onDrop"
      >
        <input type="file" accept="application/pdf,.pdf" hidden :disabled="busy" @change="onPick" />
        <div>{{ busy ? progressText : '点击或拖入 PDF' }}</div>
        <div class="pa-sub">{{ fileName || '可含扫描件' }}</div>
      </label>
      <div v-if="busy" class="pa-ocr">{{ progressText }}</div>
      <div v-if="error" class="pa-ocr">{{ error }}</div>
    </div>

    <div class="pa-dock pa-actions pa-dock--back">
      <el-button :disabled="busy" @click="$router.back()">返回</el-button>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { getProject, upsertProject } from '../lib/store.js'
import { isPdfFile } from '../lib/pdf.js'
import { ingestPackedPdf } from '../lib/pdf-ingest.js'
import { filesFromInput } from '../lib/upload.js'
import '../preaudit.css'

const route = useRoute()
const router = useRouter()
const existing = route.params.id ? getProject(route.params.id) : null
const orgType = ref((existing && existing.orgType) || route.query.org || '')
const orgLocked = computed(() => !!existing || !!route.query.org)
const busy = ref(false)
const dragging = ref(false)
const progressText = ref('')
const fileName = ref('')
const error = ref('')

const runFile = async (file) => {
  if (!file || busy.value) return
  if (!isPdfFile(file)) {
    ElMessage.warning('请上传 PDF')
    return
  }
  if (!orgType.value && !existing) {
    ElMessage.warning('请先选类型')
    return
  }
  busy.value = true
  error.value = ''
  fileName.value = file.name
  progressText.value = '正在打开 PDF…'
  try {
    const project = existing || upsertProject({ orgType: orgType.value })
    const result = await ingestPackedPdf(project.id, file, (step) => {
      progressText.value = step.name + (step.total ? '（' + step.current + '/' + step.total + '）' : '')
    })
    const bits = [result.pages + ' 页', '归入 ' + result.items + ' 项']
    if (result.truncated) bits.push('另有 ' + result.truncated + ' 页未看')
    ElMessage.success(bits.join(' · ') + '。请核对归类后再看结论')
    router.replace('/preaudit/' + project.id + '/audit')
  } catch (err) {
    error.value = (err && err.message) || '这份 PDF 处理不了'
    ElMessage.error(error.value)
  } finally {
    busy.value = false
  }
}

const onPick = (e) => {
  const file = filesFromInput(e.target)[0]
  e.target.value = ''
  runFile(file)
}

const onDrop = (e) => {
  dragging.value = false
  runFile(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0])
}
</script>
