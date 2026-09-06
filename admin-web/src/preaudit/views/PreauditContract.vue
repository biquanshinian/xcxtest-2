<template>
  <div class="pa">
    <div v-if="!project" class="pa-card pa-empty">找不到这个项目</div>
    <div v-else-if="isSmall" class="pa-card pa-empty">
      <p class="pa-title">小额不用合同水印</p>
      <div class="pa-actions">
        <el-button type="primary" @click="openOrgSwitch">换类型</el-button>
        <el-button @click="goProject">回项目</el-button>
      </div>
    </div>
    <template v-else>
      <div class="pa-card">
        <div class="pa-row pa-detail-head">
          <p class="pa-title pa-grow">合同原件</p>
          <el-button size="small" :type="contractConfirmed ? 'default' : 'primary'" @click="toggleConfirm('contract')">
            {{ contractConfirmed ? '取消确认' : '确认' }}
          </el-button>
        </div>
        <PhotoStrip
          :files="originals"
          :on="dropKey === 'contract'"
          add-text="拍照或上传原件"
          :label-of="storeLabel"
          :class-of="thumbClass"
          @reorder="(list) => onReorder('contract', list)"
          @preview="(file) => showPreview(file, originals, 'contract')"
          @remove="(file) => remove('contract', file)"
          @caption="(file, text) => onCaption('contract', file, text)"
          @retry="retryStore"
          @pick="onPick($event, 'contract')"
          @rotate="(file) => onRotate('contract', file)"
          @mark="mark('contract')"
          @dragenter="onDragEnter($event, 'contract')"
          @dragover="onDragOver($event, 'contract')"
          @dragleave="onDragLeave($event, 'contract')"
          @drop="onDrop($event, 'contract')"
        />
        <div class="pa-pair">
          <div class="pa-field">
            <label class="pa-label">签订日期</label>
            <el-date-picker v-model="contractDate" class="pa-date" popper-class="pa-date-popper" type="date" format="YYYY-MM-DD" value-format="YYYY-MM-DD" placeholder="选择日期" :editable="false" style="width: 100%;" @change="saveContract" />
          </div>
          <div class="pa-field">
            <label class="pa-label">金额（元）</label>
            <el-input v-model="contractAmount" inputmode="decimal" @input="saveContract" @change="saveContract" />
          </div>
        </div>
        <div v-if="needDateReview" class="pa-banner warn">
          <div class="pa-row">
            <div class="pa-grow">日期对不上：{{ dateReview.unmatched.join('、') }}</div>
            <el-button size="small" type="primary" @click="passDateReview">通过</el-button>
          </div>
        </div>
        <div class="pa-actions">
          <el-button type="primary" :disabled="ocrBusy" @click="openScan">扫一扫</el-button>
          <el-button :disabled="!originals.length || ocrBusy" :loading="ocrBusy" @click="runOcr(false)">识别图片</el-button>
        </div>
      </div>

      <div class="pa-card" style="margin-top: 10px;">
        <div class="pa-row pa-detail-head">
          <p class="pa-title pa-grow">彩打后扫描件</p>
          <el-button size="small" :type="printConfirmed ? 'default' : 'primary'" @click="toggleConfirm('contract_watermark')">
            {{ printConfirmed ? '取消确认' : '确认' }}
          </el-button>
        </div>
        <PhotoStrip
          :files="prints"
          :on="dropKey === 'contract_watermark'"
          add-text="拍照或上传扫描件"
          :label-of="storeLabel"
          :class-of="thumbClass"
          @reorder="(list) => onReorder('contract_watermark', list)"
          @preview="(file) => showPreview(file, prints, 'contract_watermark')"
          @remove="(file) => remove('contract_watermark', file)"
          @caption="(file, text) => onCaption('contract_watermark', file, text)"
          @retry="retryStore"
          @pick="onPick($event, 'contract_watermark')"
          @rotate="(file) => onRotate('contract_watermark', file)"
          @mark="mark('contract_watermark')"
          @dragenter="onDragEnter($event, 'contract_watermark')"
          @dragover="onDragOver($event, 'contract_watermark')"
          @dragleave="onDragLeave($event, 'contract_watermark')"
          @drop="onDrop($event, 'contract_watermark')"
        />
      </div>

      <div class="pa-dock pa-actions pa-dock--back">
        <el-button @click="$router.back()">返回</el-button>
      </div>
      <PhotoLightbox :src="preview.src" :caption="preview.caption" :list="preview.files" @close="closePreview" @step="stepPreview" @rotate="onPreviewRotate" />
      <ScanFillOverlay
        v-if="scanOpen"
        title="施工/采购合同"
        kind="contract"
        :fields="['date', 'amount']"
        @hit="onScanHit"
        @close="scanOpen = false"
      />
    </template>
    <OrgSwitchDialog
      :open="orgSwitchOpen"
      :current-org="project ? getOrgType(project) : ''"
      @close="closeOrgSwitch"
      @pick="pickOrg"
    />
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { getProject, getMaterial, saveMaterial, saveOcrCapture, addFiles, persistPendingPhotos, removeFile, reorderFiles, rotateStoredFile, updateFileMeta } from '../lib/store.js'
import { photoStoreLabel } from '../lib/photo-cloud.js'
import { expandUploads } from '../lib/pdf-ingest.js'
import { filesFromInput } from '../lib/upload.js'
import { usePhotoZone } from '../lib/use-photo-zone.js'
import { usePhotoPreview } from '../lib/use-photo-preview.js'
import PhotoLightbox from '../components/PhotoLightbox.vue'
import PhotoStrip from '../components/PhotoStrip.vue'
import ScanFillOverlay from '../components/ScanFillOverlay.vue'
import OrgSwitchDialog from '../components/OrgSwitchDialog.vue'
import { getOrgType } from '../lib/checklist.js'
import { useOrgSwitch } from '../lib/use-org-switch.js'
import { inspectOcrDates } from '../lib/audit.js'
import { applyParsed, applyProjectMeta, ocrEngineHint, recognizeBestUpload } from '../lib/ocr.js'
import { shouldFinishScan, unlockScanFeedback } from '../lib/scan-fill.js'
import { typingInField } from '../lib/util.js'
import '../preaudit.css'

const route = useRoute()
const router = useRouter()
const project = computed(() => getProject(route.params.id))
const { orgSwitchOpen, openOrgSwitch, closeOrgSwitch, pickOrg } = useOrgSwitch(() => project.value)
const isSmall = computed(() => getOrgType(project.value) === 'small')
const goProject = () => {
  if (!project.value) return
  router.replace('/preaudit/' + project.value.id)
}
function liveFiles(key) {
  const p = project.value
  const list = p && p.materials && p.materials[key] && p.materials[key].files
  return Array.isArray(list) ? list : []
}
const originals = computed(() => liveFiles('contract'))
const prints = computed(() => liveFiles('contract_watermark'))
const storeLabel = photoStoreLabel
const thumbClass = (file) => ({
  busy: !!(file && file.storing),
  fail: !!(file && file.storeError),
  ok: !!(file && (file.cosKey || file.stored))
})
const contractConfirmed = computed(() => !!(project.value && getMaterial(project.value, 'contract').confirmed))
const printConfirmed = computed(() => !!(project.value && getMaterial(project.value, 'contract_watermark').confirmed))
const contractDate = ref(project.value ? getMaterial(project.value, 'contract').date : '')
const contractAmount = ref(project.value && (getMaterial(project.value, 'contract').amount === 0 || getMaterial(project.value, 'contract').amount) ? String(getMaterial(project.value, 'contract').amount) : '')
const ocrBusy = ref(false)
const ocrHint = ref('')
const scanOpen = ref(false)
const dateReview = computed(() => project.value ? inspectOcrDates(project.value, 'contract') : null)
const needDateReview = computed(() => !!(dateReview.value && dateReview.value.conflict && !dateReview.value.reviewed))

const saveContract = () => {
  if (!project.value) return
  saveMaterial(project.value.id, 'contract', {
    date: contractDate.value,
    amount: contractAmount.value
  })
}

watch(() => {
  const p = project.value
  const m = p ? getMaterial(p, 'contract') : null
  return m ? [p.updatedAt, m.date, m.amount].join('|') : ''
}, () => {
  if (!project.value || typingInField()) return
  const m = getMaterial(project.value, 'contract')
  contractDate.value = m.date || ''
  contractAmount.value = (m.amount === 0 || m.amount) ? String(m.amount) : ''
})

const passDateReview = () => {
  if (!project.value) return
  const info = inspectOcrDates(project.value, 'contract')
  saveMaterial(project.value.id, 'contract', {
    dateReviewOk: true,
    dateReviewKey: info.key
  })
  ElMessage.success('已人工通过日期核对')
}

const toggleConfirm = (key) => {
  if (!project.value) return
  const current = getMaterial(project.value, key)
  const next = !current.confirmed
  saveMaterial(project.value.id, key, { confirmed: next })
  ElMessage.success(next ? '已确认，可不传照片' : '已取消确认')
}

const applyContractOcr = (result, auto, fromScan) => {
  const patch = applyParsed({
    date: contractDate.value,
    amount: contractAmount.value
  }, result.parsed, ['date', 'amount'])
  if (patch.next.date) contractDate.value = patch.next.date
  if (patch.next.amount != null) contractAmount.value = patch.next.amount
  applyProjectMeta(project.value.id, result.parsed)
  const file = originals.value[originals.value.length - 1]
  const already = !!(project.value && getMaterial(project.value, 'contract').scanFilled)
  saveOcrCapture(project.value.id, 'contract', {
    fileId: file && file.id,
    text: result.text,
    patch: {
      date: contractDate.value,
      amount: contractAmount.value,
      ocrTried: true,
      ocrAt: Date.now(),
      ocrEngine: result.engine,
      ocrSummary: patch.summary,
      scanFilled: fromScan ? !!(patch.filled.length || patch.summary || already) : already
    }
  })
  ocrHint.value = patch.summary
    ? (ocrEngineHint(result.engine) + '：' + patch.summary)
    : '没认出日期或金额，请手填'
  if (patch.filled.length) ElMessage.success((fromScan ? '扫描已填 ' : '已填 ') + patch.filled.join('、') + '，请核对')
  else if (auto && patch.summary) ElMessage.info('识别到 ' + patch.summary + '，栏里已有数就没改')
  else if (auto) ElMessage.warning('没认出日期或金额，请手填或再点识别')
  else if (!auto && patch.summary) ElMessage.info('识别到 ' + patch.summary + '，栏里已有数就没改')
  else if (!auto) ElMessage.warning('没认出日期或金额')
  return patch
}

const runOcr = async (auto) => {
  if (!project.value || !originals.value.length || ocrBusy.value) return
  ocrBusy.value = true
  ocrHint.value = '正在识别，请稍候…'
  try {
    const result = await recognizeBestUpload(originals.value, 'contract', ['date', 'amount'])
    applyContractOcr(result, !!auto, false)
  } catch (e) {
    ocrHint.value = (e && e.message) || '识别失败'
    ElMessage.error(ocrHint.value)
  } finally {
    ocrBusy.value = false
  }
}

const openScan = () => {
  if (ocrBusy.value) return
  unlockScanFeedback()
  scanOpen.value = true
}

const onScanHit = (result) => {
  if (!project.value) return
  const patch = applyContractOcr(result, false, true)
  if (shouldFinishScan({ fields: ['date', 'amount'] }, {
    date: contractDate.value,
    amount: contractAmount.value
  }, patch.filled)) {
    scanOpen.value = false
  }
}

const ingest = async (list, key) => {
  const target = key || 'contract'
  if (!list || !list.length || !project.value || ocrBusy.value) return
  ocrBusy.value = true
  try {
    const picked = await expandUploads(list)
    if (!picked.length) {
      ElMessage.warning('没有可用的图片或 PDF')
      return
    }
    await addFiles(project.value.id, target, picked)
    const failed = (liveFiles(target) || []).find((f) => f && f.storeError)
    if (failed) ElMessage.error(failed.storeError)
    if (target === 'contract') {
      ocrHint.value = '正在识别，请稍候…'
      const batch = liveFiles('contract').slice(-picked.length)
      const result = await recognizeBestUpload(batch, 'contract', ['date', 'amount'])
      applyContractOcr(result, true, false)
    }
  } catch (err) {
    const msg = (err && err.message) || '文件处理失败'
    ocrHint.value = msg
    ElMessage.error(msg)
  } finally {
    ocrBusy.value = false
  }
}

const { dropKey, mark, onDragEnter, onDragOver, onDragLeave, onDrop } = usePhotoZone((list, key) => {
  ingest(list, key || 'contract')
})
onMounted(() => mark('contract'))

const onPick = (e, key) => {
  const list = filesFromInput(e.target)
  e.target.value = ''
  ingest(list, key)
}

const { preview, open: openPreview, close: closePreview, step: stepPreview, sync: syncPreview } = usePhotoPreview()
const previewSlot = ref('')
const showPreview = (file, list, key) => {
  previewSlot.value = key || ''
  openPreview(file, list)
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

const onPreviewRotate = () => onRotate(previewSlot.value, preview.files[preview.index])

const retryStore = async () => {
  if (!project.value) return
  await persistPendingPhotos(project.value.id)
  const failed = ['contract', 'contract_watermark'].some((key) => {
    return liveFiles(key).some((f) => f && f.storeError)
  })
  if (failed) ElMessage.error('还是没存上，请再点一次「未存上」')
  else ElMessage.success('已存到云端')
}

const remove = async (key, file) => {
  try {
    const tip = (file && (file.cosKey || file.stored))
      ? '会从云端永久删掉这张照片，确定？'
      : '删除这张图？'
    await ElMessageBox.confirm(tip, '删除', { type: 'warning' })
    await removeFile(project.value.id, key, file.id)
  } catch (e) {
    if (e === 'cancel' || e === 'close') return
    if (e && e.message) ElMessage.error(e.message)
  }
}
</script>
