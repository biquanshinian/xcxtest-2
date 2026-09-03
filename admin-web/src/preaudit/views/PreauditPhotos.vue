<template>
  <div class="pa pa-photos">
    <div v-if="!project && loading" class="pa-card pa-empty">正在从云端找回照片…</div>
    <div v-else-if="!project" class="pa-card pa-empty">找不到这个项目</div>
    <template v-else>
      <div class="pa-card">
        <div class="pa-row">
          <p class="pa-title pa-grow">施工现场</p>
          <span class="pa-tag" :class="canExportWork ? 'ok' : 'warn'">{{ canExportWork ? '可出表' : '还差照片' }}</span>
        </div>
        <div class="pa-sub">每阶段每页最多 3 张，多的自动下一页。编号随拖动变化，财务可按编号对照。</div>
        <div v-for="stage in workStages" :key="stage.id" class="pa-stage">
          <div class="pa-row">
            <p class="pa-stage-title pa-grow">{{ stage.title }}</p>
            <span class="pa-count">{{ stageCountText(stage.files) }}</span>
            <span class="pa-tag" :class="stage.ready ? 'ok' : 'warn'">{{ stage.ready ? '已齐' : '至少 1 张' }}</span>
          </div>
          <PhotoStrip
            :files="stage.files"
            :on="dropKey === stage.id"
            :label-of="storeLabel"
            :class-of="thumbClass"
            :index-prefix="stage.prefix"
            caption-placeholder="工程名称"
            @mark="mark(stage.id)"
            @dragenter="onDragEnter($event, stage.id)"
            @dragover="onDragOver($event, stage.id)"
            @dragleave="onDragLeave($event, stage.id)"
            @drop="onDrop($event, stage.id)"
            @reorder="(list) => onReorder(stage.id, list)"
            @preview="(file) => showPreview(file, stage.files, stage.id)"
            @remove="(file) => remove(stage.id, file)"
            @caption="(file, text) => onCaption(stage.id, file, text)"
            @retry="retryStore"
            @pick="onPick($event, stage.id)"
            @rotate="(file) => onRotate(stage.id, file)"
          />
        </div>
      </div>

      <div class="pa-card" style="margin-top: 12px;" v-if="accept">
        <div class="pa-row">
          <p class="pa-title pa-grow">现场验收</p>
          <span class="pa-count">{{ (accept.files || []).length }} 张</span>
          <span class="pa-tag" :class="accept.ready ? 'ok' : 'warn'">{{ accept.ready ? '可出表' : '至少 1 张' }}</span>
        </div>
        <PhotoStrip
          :files="accept.files"
          :on="dropKey === accept.id"
          :label-of="storeLabel"
          :class-of="thumbClass"
          index-prefix="验"
          caption-placeholder="备注"
          @mark="mark(accept.id)"
          @dragenter="onDragEnter($event, accept.id)"
          @dragover="onDragOver($event, accept.id)"
          @dragleave="onDragLeave($event, accept.id)"
          @drop="onDrop($event, accept.id)"
          @reorder="(list) => onReorder(accept.id, list)"
          @preview="(file) => showPreview(file, accept.files, accept.id)"
          @remove="(file) => remove(accept.id, file)"
          @caption="(file, text) => onCaption(accept.id, file, text)"
          @retry="retryStore"
          @pick="onPick($event, accept.id)"
          @rotate="(file) => onRotate(accept.id, file)"
        />
        <p class="pa-stage-title" style="margin-top: 16px;">到场情况</p>
        <div class="pa-pair">
          <div class="pa-field">
            <label class="pa-label">到场总人数</label>
            <el-input v-model="peopleCount" inputmode="numeric" :placeholder="isTownship ? '至少 1 人' : ''" @change="savePeople" />
          </div>
          <div v-if="!isTownship" class="pa-field">
            <label class="pa-label">其中工作人员人数</label>
            <el-input v-model="committeeCount" inputmode="numeric" @change="savePeople" />
          </div>
        </div>
        <div v-if="!isTownship" class="pa-field pa-row">
          <span class="pa-grow pa-label" style="margin-bottom: 0;">是否有监督人员到场</span>
          <el-switch v-model="hasSupervisor" @change="savePeople" />
        </div>
        <div v-if="isTownship" class="pa-sub">乡政府验收至少登记 1 人即可，不必确认监督员是否到场。</div>
        <div class="pa-field">
          <label class="pa-label">到场人员备注</label>
          <el-input v-model="peopleNote" type="textarea" :rows="2" placeholder="选填" @change="savePeople" />
        </div>
      </div>

      <div class="pa-dock pa-actions">
        <el-button v-if="!isSmall" class="is-main" type="primary" :disabled="!canExportAccept || working" :loading="working" @click="exportAccept">
          生成验收 A4
        </el-button>
        <el-button :class="{ 'is-main': isSmall }" :disabled="!canExportWork || working" :loading="working" @click="exportWork">
          生成施工 A4
        </el-button>
      </div>
      <PhotoLightbox :src="preview.src" :caption="preview.caption" :list="preview.files" @close="closePreview" @step="stepPreview" @rotate="onPreviewRotate" />
      <SheetPreview
        :open="sheet.open"
        :title="sheet.title"
        :mode="sheet.mode"
        :jpg-urls="sheet.jpgUrls"
        :pdf-url="sheet.pdfUrl"
        @close="closeSheet"
        @mode="setSheetMode"
        @download="downloadSheet"
      />
    </template>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { photoStoreLabel } from '../lib/photo-cloud.js'
import { addFiles, getMaterial, getProject, hydrateProject, persistPendingPhotos, removeFile, reorderFiles, rotateStoredFile, saveMaterial, updateFileMeta } from '../lib/store.js'
import { expandUploads } from '../lib/pdf-ingest.js'
import { filesFromInput } from '../lib/upload.js'
import { usePhotoZone } from '../lib/use-photo-zone.js'
import { usePhotoPreview } from '../lib/use-photo-preview.js'
import PhotoLightbox from '../components/PhotoLightbox.vue'
import PhotoStrip from '../components/PhotoStrip.vue'
import SheetPreview from '../components/SheetPreview.vue'
import { downloadUrl, packSheetPages, renderAcceptPages, renderWorkPages, revokeSheetPack, WORK_PHOTOS_PER_PAGE } from '../lib/sheet.js'
import { getOrgType } from '../lib/checklist.js'
import { typingInField } from '../lib/util.js'
import '../preaudit.css'

const WORK = [
  { id: 'photo_before', title: '施工前', prefix: '前', color: '#1b7a4e' },
  { id: 'photo_during', title: '施工中', prefix: '中', color: '#c4841a' },
  { id: 'photo_after', title: '施工后', prefix: '后', color: '#0f6e7a' }
]

const route = useRoute()
const working = ref(false)
const loading = ref(true)
const project = computed(() => getProject(route.params.id))

function liveFiles(itemId) {
  const p = project.value
  const files = p && p.materials && p.materials[itemId] && p.materials[itemId].files
  return Array.isArray(files) ? files : []
}

function stageOf(spec) {
  const files = liveFiles(spec.id)
  return {
    id: spec.id,
    title: spec.title,
    prefix: spec.prefix || '',
    color: spec.color,
    files,
    ready: files.length >= 1
  }
}

function stageCountText(files) {
  const n = (files || []).length
  if (n <= WORK_PHOTOS_PER_PAGE) return n + ' 张'
  return n + ' 张 · ' + Math.ceil(n / WORK_PHOTOS_PER_PAGE) + ' 页'
}

const workStages = computed(() => WORK.map(stageOf))
const isTownship = computed(() => getOrgType(project.value) === 'township')
const isSmall = computed(() => getOrgType(project.value) === 'small')
const accept = computed(() => isSmall.value ? null : stageOf({ id: 'photo_accept', title: '现场验收', color: '#c4841a' }))
const canExportWork = computed(() => workStages.value.every((s) => s.ready))
const canExportAccept = computed(() => !!(accept.value && accept.value.ready))
const storeLabel = photoStoreLabel
const thumbClass = (file) => ({
  busy: !!(file && file.storing),
  fail: !!(file && file.storeError),
  ok: !!(file && (file.cosKey || file.stored))
})

const peopleCount = ref('')
const committeeCount = ref('')
const hasSupervisor = ref(false)
const peopleNote = ref('')

function syncPeople() {
  if (!project.value) return
  const row = getMaterial(project.value, 'photo_accept')
  peopleCount.value = row.peopleCount || ''
  committeeCount.value = row.committeeCount || ''
  hasSupervisor.value = !!row.hasSupervisor
  peopleNote.value = row.peopleNote || ''
}

onMounted(async () => {
  const id = route.params.id
  try {
    await hydrateProject(id)
    syncPeople()
    await persistPendingPhotos(id)
  } finally {
    loading.value = false
    syncPeople()
  }
})

watch(() => {
  const p = project.value
  const row = p ? getMaterial(p, 'photo_accept') : null
  return row ? [p.updatedAt, row.peopleCount, row.committeeCount, row.hasSupervisor, row.peopleNote].join('|') : ''
}, () => {
  if (typingInField()) return
  syncPeople()
})

const savePeople = () => {
  if (!project.value) return
  saveMaterial(project.value.id, 'photo_accept', {
    peopleCount: peopleCount.value,
    committeeCount: committeeCount.value,
    hasSupervisor: hasSupervisor.value,
    peopleNote: peopleNote.value
  })
}

const firstNeedKey = () => {
  const empty = workStages.value.find((s) => !s.ready)
  if (empty) return empty.id
  if (accept.value && !accept.value.ready) return accept.value.id
  return 'photo_before'
}

const ingest = async (list, key) => {
  const target = key || firstNeedKey()
  if (!list || !list.length || !project.value) return
  try {
    const picked = await expandUploads(list)
    if (!picked.length) {
      ElMessage.warning('没有可用的图片或 PDF')
      return
    }
    await addFiles(project.value.id, target, picked)
    const failed = (getMaterial(project.value, target).files || []).find((f) => f && f.storeError)
    if (failed) ElMessage.error(failed.storeError)
  } catch (err) {
    ElMessage.error((err && err.message) || '文件处理失败')
  }
}

const { dropKey, mark, onDragEnter, onDragOver, onDragLeave, onDrop } = usePhotoZone((list, key) => {
  ingest(list, key || firstNeedKey())
})

const onPick = (e, key) => {
  const list = filesFromInput(e.target)
  e.target.value = ''
  ingest(list, key)
}

const { preview, open: openPreview, close: closePreview, step: stepPreview, sync: syncPreview } = usePhotoPreview()
const previewSlot = ref('')
const showPreview = (file, files, key) => {
  previewSlot.value = key || ''
  openPreview(file, files)
}

const onReorder = (key, list) => {
  if (!project.value) return
  reorderFiles(project.value.id, key, list)
}

const onCaption = (key, file, text) => {
  if (!project.value || !file) return
  updateFileMeta(project.value.id, key, file.id, { caption: String(text || '').trim() })
}

const onRotate = async (key, file) => {
  if (!project.value || !file || !key) return
  try {
    await rotateStoredFile(project.value.id, key, file.id, 90)
    syncPreview()
  } catch (err) {
    ElMessage.error((err && err.message) || '旋转失败')
  }
}

const onPreviewRotate = () => {
  const file = preview.files[preview.index]
  return onRotate(previewSlot.value, file)
}

const retryStore = async () => {
  if (!project.value) return
  await persistPendingPhotos(project.value.id)
  const failed = WORK.concat([{ id: 'photo_accept' }]).map((row) => {
    return (getMaterial(project.value, row.id).files || []).find((f) => f && f.storeError)
  }).find(Boolean)
  if (failed) ElMessage.error(failed.storeError || '还是没存上')
  else ElMessage.success('已存到云端')
}

const remove = async (key, file) => {
  try {
    const tip = (file && (file.cosKey || file.stored))
      ? '会从云端永久删掉这张照片，确定？'
      : '删除这张照片？'
    await ElMessageBox.confirm(tip, '删除', { type: 'warning' })
    await removeFile(project.value.id, key, file.id)
  } catch (e) {
    if (e === 'cancel' || (e && e === 'close')) return
    if (e && e.message) ElMessage.error(e.message)
  }
}

const sheet = ref({
  open: false,
  title: '',
  filename: '',
  mode: '',
  pack: null,
  jpgUrls: [],
  pdfUrl: ''
})

const closeSheet = () => {
  revokeSheetPack(sheet.value.pack)
  sheet.value = {
    open: false,
    title: '',
    filename: '',
    mode: '',
    pack: null,
    jpgUrls: [],
    pdfUrl: ''
  }
}

let sheetGen = 0
onUnmounted(() => {
  sheetGen += 1
  closeSheet()
})

const setSheetMode = (mode) => {
  sheet.value = Object.assign({}, sheet.value, { mode })
}

const downloadSheet = () => {
  const cur = sheet.value
  const pack = cur.pack
  if (!pack) return
  if (cur.mode === 'pdf') {
    downloadUrl(pack.pdfUrl, cur.filename + '.pdf')
    ElMessage.success('已开始下载 PDF')
    return
  }
  const urls = pack.jpgUrls || []
  urls.forEach((url, i) => {
    const extra = urls.length > 1 ? '-' + (i + 1) : ''
    downloadUrl(url, cur.filename + extra + '.jpg')
  })
  ElMessage.success('已开始下载 JPG')
}

const openSheet = async (title, filename, canvases) => {
  closeSheet()
  const gen = ++sheetGen
  const pack = await packSheetPages(canvases)
  if (gen !== sheetGen) {
    revokeSheetPack(pack)
    return
  }
  sheet.value = {
    open: true,
    title,
    filename,
    mode: '',
    pack,
    jpgUrls: pack.jpgUrls,
    pdfUrl: pack.pdfUrl
  }
}

const exportWork = async () => {
  if (!canExportWork.value) return
  working.value = true
  try {
    const p = project.value
    const pages = await renderWorkPages({
      name: p.name,
      meta: [p.year, p.village].filter(Boolean).join(' '),
      sections: workStages.value.map((s) => ({
        title: s.title,
        color: s.color,
        items: s.files.map((f, i) => ({ path: f.path, caption: f.caption, no: i + 1 }))
      }))
    })
    await openSheet('施工现场 A4', (p.name || '施工照片') + '-施工A4', pages)
  } catch (e) {
    ElMessage.error(e.message || '导出失败')
  } finally {
    working.value = false
  }
}

const exportAccept = async () => {
  if (!canExportAccept.value) return
  working.value = true
  try {
    const p = project.value
    const peopleText = [
      peopleCount.value ? '到场 ' + peopleCount.value + ' 人' : '',
      !isTownship.value && committeeCount.value ? '工作人员 ' + committeeCount.value : '',
      !isTownship.value && hasSupervisor.value ? '有监督人员' : '',
      peopleNote.value
    ].filter(Boolean).join(' · ')
    const pages = await renderAcceptPages({
      name: p.name,
      meta: [p.year, p.village].filter(Boolean).join(' '),
      peopleText,
      items: accept.value.files.map((f, i) => ({ path: f.path, caption: f.caption, no: i + 1 }))
    })
    await openSheet('现场验收 A4', (p.name || '验收照片') + '-验收A4', pages)
  } catch (e) {
    ElMessage.error(e.message || '导出失败')
  } finally {
    working.value = false
  }
}

</script>
