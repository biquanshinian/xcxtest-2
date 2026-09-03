<template>
  <div class="pa">
    <div v-if="!item" class="pa-card pa-empty">找不到这项资料</div>
    <template v-else>
      <div class="pa-card">
        <span class="pa-tag muted">{{ item.groupName }}</span>
        <p class="pa-title" style="margin-top: 10px;">{{ item.name }}</p>
        <div v-if="item.hint" class="pa-sub">{{ item.hint }}</div>
      </div>

      <div class="pa-card" style="margin-top: 12px;">
        <p class="pa-title">照片</p>
        <div v-if="isCompare" class="pa-sub">高价、中价、低价各拍一张或上传。不核验日期。低价公司名称和金额会跟发票对齐。</div>
        <div v-else-if="canScan" class="pa-sub">拍照或上传后会自动认日期金额。也可扫一扫，扫拍图不保存。</div>
        <div v-if="needReshoot" class="pa-sub">须同框重拍一张</div>
        <div v-if="needDateReview" class="pa-banner warn" style="margin-top: 12px;">
          <div>这张图认出多个日期：{{ dateReview.ocrDates.join('、') }}</div>
          <div class="pa-sub">
            {{ dateReview.expected.length ? ('填写的是 ' + dateReview.expected.join('、') + '。') : '核验信息里还没填日期。' }}
            对不上的是 {{ dateReview.unmatched.join('、') }}。对照原图后可手动通过。
          </div>
          <div class="pa-actions" style="margin-top: 8px;">
            <el-button type="primary" @click="passDateReview">核对无误，通过</el-button>
          </div>
        </div>
        <template v-if="isCompare">
          <div v-for="stage in compareStages" :key="stage.id" class="pa-stage">
            <div class="pa-row">
              <p class="pa-stage-title pa-grow">{{ stage.title }}</p>
              <span class="pa-count">{{ (stage.files || []).length }} 张</span>
              <span class="pa-tag" :class="stage.ready ? 'ok' : 'warn'">{{ stage.ready ? '已齐' : '至少 1 张' }}</span>
            </div>
            <PhotoStrip
              :files="stage.files"
              :on="dropKey === stage.id"
              :label-of="storeLabel"
              :class-of="thumbClass"
              @mark="mark(stage.id)"
              @dragenter="onDragEnter($event, stage.id)"
              @dragover="onDragOver($event, stage.id)"
              @dragleave="onDragLeave($event, stage.id)"
              @drop="onDrop($event, stage.id)"
              @reorder="(list) => onReorder(list, stage.id)"
              @preview="(file) => showPreview(file, stage.files, stage.id)"
              @remove="(file) => remove(file, stage.id)"
              @caption="(file, text) => onCaption(file, text, stage.id)"
              @retry="retryStore"
              @pick="onPick($event, stage.id)"
              @rotate="(file) => onRotate(file, stage.id)"
            />
          </div>
        </template>
        <PhotoStrip
          v-else
          :files="files"
          :on="dropKey === itemKey"
          :label-of="storeLabel"
          :class-of="thumbClass"
          @mark="mark(itemKey)"
          @dragenter="onDragEnter($event, itemKey)"
          @dragover="onDragOver($event, itemKey)"
          @dragleave="onDragLeave($event, itemKey)"
          @drop="onDrop($event, itemKey)"
          @reorder="onReorder"
          @preview="(file) => showPreview(file, files)"
          @remove="remove"
          @caption="onCaption"
          @retry="retryStore"
          @pick="onPick"
          @rotate="onRotate"
        />
        <div v-if="item.allowConfirm" class="pa-actions" style="margin-top: 12px;">
          <el-button :type="confirmed ? 'default' : 'primary'" @click="toggleConfirm">
            {{ confirmed ? '取消确认' : '无需上传，确认已备齐' }}
          </el-button>
        </div>
      </div>

      <div v-if="showDate || showRange || showAmount || showContractor" class="pa-card" style="margin-top: 12px;">
        <p class="pa-title">核验信息</p>
        <div v-if="showDate" class="pa-field">
          <label class="pa-label">{{ optionalDate ? '日期（选填）' : '日期' }}</label>
          <el-date-picker v-model="date" class="pa-date" popper-class="pa-date-popper" type="date" format="YYYY-MM-DD" value-format="YYYY-MM-DD" placeholder="选择日期" :editable="false" style="width: 100%;" @change="persist" />
        </div>
        <div v-if="showRange" class="pa-pair">
          <div class="pa-field">
            <label class="pa-label">{{ rangeStartLabel }}</label>
            <el-date-picker v-model="startDate" class="pa-date" popper-class="pa-date-popper" type="date" format="YYYY-MM-DD" value-format="YYYY-MM-DD" placeholder="纸上的起始日" :editable="false" style="width: 100%;" @change="onStart" />
          </div>
          <div class="pa-field">
            <label class="pa-label">{{ rangeEndLabel }}</label>
            <el-date-picker v-model="endDate" class="pa-date" popper-class="pa-date-popper" type="date" format="YYYY-MM-DD" value-format="YYYY-MM-DD" placeholder="纸上的截止日" :editable="false" style="width: 100%;" @change="persist" />
          </div>
        </div>
        <div v-if="showRange" class="pa-sub">须写起止，含首尾满 7 天{{ suggestedEnd ? '，满 7 天应到 ' + suggestedEnd : '' }}{{ resultAfterHint }}</div>
        <div v-if="showContractor" class="pa-field">
          <label class="pa-label">{{ contractorLabel }}</label>
          <el-input v-model="contractor" maxlength="40" :placeholder="contractorHint" @input="persist" @change="persist" />
        </div>
        <div v-if="showAmount" class="pa-field">
          <label class="pa-label">{{ optionalAmount ? '金额（元，选填）' : '金额（元）' }}</label>
          <el-input v-model="amount" inputmode="decimal" :placeholder="amountHint" @input="persist" @change="persist" />
        </div>
        <div v-if="projectNameHint" class="pa-ocr">{{ projectNameHint }}</div>
        <div v-if="ocrHint" class="pa-ocr">{{ ocrHint }}</div>
        <div class="pa-actions">
          <el-button v-if="canScan" class="is-main" type="primary" :disabled="ocrBusy" @click="openScan">扫一扫填数据</el-button>
          <el-button :disabled="!ocrFiles.length || ocrBusy" :loading="ocrBusy" @click="runOcr(false)">识别已上传的图</el-button>
        </div>
      </div>

      <div class="pa-card" style="margin-top: 12px;">
        <label class="pa-label">备注</label>
        <el-input v-model="remark" type="textarea" :rows="2" maxlength="200" placeholder="选填" @change="persist" />
      </div>

      <div class="pa-dock pa-actions pa-dock--back">
        <el-button @click="$router.back()">返回</el-button>
      </div>
      <PhotoLightbox :src="preview.src" :caption="preview.caption" :list="preview.files" @close="closePreview" @step="stepPreview" @rotate="onPreviewRotate" />
      <ScanFillOverlay
        v-if="scanOpen"
        :title="item.name"
        :kind="ocrKindForItem(item)"
        :fields="writableFields"
        @hit="onScanHit"
        @close="scanOpen = false"
      />
    </template>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
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
import { COMPARE_TIERS, getItem, getOrgType, isCompareSlot, itemCanScanFill, itemWritableFields } from '../lib/checklist.js'
import { noticeEnd } from '../lib/date.js'
import { inspectOcrDates } from '../lib/audit.js'
import { applyParsed, applyProjectMeta, isPlaceholderName, ocrEngineHint, ocrKindForItem, recognizeBestUpload } from '../lib/ocr.js'
import { shouldFinishScan, unlockScanFeedback } from '../lib/scan-fill.js'
import { typingInField } from '../lib/util.js'
import '../preaudit.css'

const route = useRoute()
const router = useRouter()
const itemKey = computed(() => String(route.params.key || ''))
const project = computed(() => getProject(route.params.id))
const item = computed(() => {
  const p = project.value
  if (!p) return null
  return getItem(route.params.key, getOrgType(p))
})

const mat = () => getMaterial(project.value, route.params.key)
const files = computed(() => {
  const p = project.value
  const key = itemKey.value
  const list = p && p.materials && p.materials[key] && p.materials[key].files
  return Array.isArray(list) ? list : []
})
const isCompare = computed(() => !!(item.value && item.value.special === 'compare'))
const compareStages = computed(() => {
  const p = project.value
  return COMPARE_TIERS.map((tier) => {
    const list = p && p.materials && p.materials[tier.slot] && p.materials[tier.slot].files
    const files = Array.isArray(list) ? list : []
    return {
      id: tier.slot,
      title: tier.name,
      files,
      ready: files.length >= 1
    }
  })
})
const ocrFiles = computed(() => {
  if (!isCompare.value) return files.value
  const low = compareStages.value.find((row) => row.id === 'compare_low')
  return (low && low.files) || []
})
const previewSlot = ref('')
const confirmed = computed(() => !!(project.value && mat().confirmed))
const storeLabel = photoStoreLabel
const thumbClass = (file) => ({
  busy: !!(file && file.storing),
  fail: !!(file && file.storeError),
  ok: !!(file && (file.cosKey || file.stored))
})

const writableFields = computed(() => itemWritableFields(item.value))
const showDate = computed(() => writableFields.value.includes('date'))
const showAmount = computed(() => writableFields.value.includes('amount'))
const showContractor = computed(() => writableFields.value.includes('contractor'))
const optionalDate = computed(() => ((item.value && item.value.optionalFields) || []).includes('date') && !((item.value && item.value.fields) || []).includes('date'))
const optionalAmount = computed(() => ((item.value && item.value.optionalFields) || []).includes('amount') && !((item.value && item.value.fields) || []).includes('amount'))
const showRange = computed(() => writableFields.value.includes('startDate') || writableFields.value.includes('endDate'))
const rangeStartLabel = computed(() => {
  const id = item.value && item.value.id
  if (id === 'notice_resolution') return '决议公示起始日'
  if (id === 'result_public') return '结果公示起始日'
  return '公示起始日'
})
const rangeEndLabel = computed(() => {
  const id = item.value && item.value.id
  if (id === 'notice_resolution') return '决议公示截止日'
  if (id === 'result_public') return '结果公示截止日'
  return '公示截止日'
})
const needOcr = computed(() => showDate.value || showRange.value || showAmount.value || showContractor.value)
const suggestedEnd = computed(() => (startDate.value ? noticeEnd(startDate.value, (item.value && item.value.minDays) || 7) : ''))
const resultAfterHint = computed(() => {
  if (!item.value || item.value.id !== 'result_public' || !project.value) return ''
  const accept = getMaterial(project.value, 'accept_sheet')
  if (!accept || !accept.date) return '。起始日须晚于验收单（验收次日或之后）'
  return '。起始日须晚于验收单 ' + accept.date + '（次日或之后）'
})
const canScan = computed(() => itemCanScanFill(item.value))
const scanOpen = ref(false)
const dateReview = computed(() => {
  if (!project.value || !itemKey.value) return null
  return inspectOcrDates(project.value, itemKey.value)
})
const needDateReview = computed(() => !!(dateReview.value && dateReview.value.conflict && !dateReview.value.reviewed))
const needReshoot = computed(() => {
  if (!item.value || !item.value.requirePairedPhoto) return false
  const current = mat()
  return !current.pairedPhoto && (current.files || []).length > 0
})

const date = ref('')
const startDate = ref('')
const endDate = ref('')
const amount = ref('')
const contractor = ref('')
const remark = ref('')
const ocrBusy = ref(false)
const ocrHint = ref('')

const syncFromStore = () => {
  if (!project.value) {
    date.value = ''
    startDate.value = ''
    endDate.value = ''
    amount.value = ''
    contractor.value = ''
    remark.value = ''
    ocrHint.value = ''
    return
  }
  const m = mat()
  date.value = m.date || ''
  startDate.value = m.startDate || ''
  endDate.value = m.endDate || ''
  amount.value = (m.amount === 0 || m.amount) ? String(m.amount) : ''
  contractor.value = m.contractor || ''
  remark.value = m.remark || m.notes || ''
  ocrHint.value = ''
}

watch(() => [route.params.id, route.params.key], syncFromStore, { immediate: true })
watch(() => {
  const p = project.value
  const m = p ? mat() : null
  const files = (m && m.files) || []
  return [
    p && p.updatedAt,
    m && m.date,
    m && m.startDate,
    m && m.endDate,
    m && m.amount,
    m && m.contractor,
    m && m.remark,
    m && m.confirmed,
    files.length,
    files.map((file) => file && file.id).join(',')
  ].join('|')
}, () => {
  if (typingInField()) return
  syncFromStore()
})
watch(item, (it) => {
  if (it && it.hidden && it.shareFilesFrom && project.value) {
    router.replace('/preaudit/' + project.value.id + '/item/' + it.shareFilesFrom)
  }
}, { immediate: true })

const isAward = computed(() => {
  const it = item.value
  return !!(it && (it.role === 'award' || it.id === 'bid_notice' || it.id === 'compare_sheet' || it.id === 'contract'))
})

const projectNameHint = computed(() => {
  const p = project.value
  if (!p || !isAward.value) return ''
  if (isPlaceholderName(p.name)) {
    return isCompare.value ? '项目名称还空着，认低价报价单后会自动填' : '项目名称还空着，认这张成交通知后会自动填'
  }
  return '项目：' + p.name + (p.contractor ? ' · ' + p.contractor : '')
})

const contractorLabel = computed(() => {
  const it = item.value
  if (it && it.id === 'invoices') return '销售方名称'
  if (it && it.special === 'compare') return '低价公司名称'
  return '单位名称'
})
const contractorHint = computed(() => {
  const it = item.value
  if (it && it.special === 'compare') return '须与发票销售方对齐'
  if (it && it.id === 'invoices') return '须与比价低价公司对齐'
  return '选填'
})
const amountHint = computed(() => {
  const it = item.value
  if (!it) return ''
  if (it.special === 'compare' || it.id === 'compare_sheet') return '低价金额，须与发票一致'
  if (it.role === 'award' || it.id === 'bid_notice') return '中标/成交金额'
  if (it.role === 'invoice' || it.id === 'invoices') {
    return getOrgType(project.value) === 'small' ? '不填则按比价低价' : '不填则按中标/成交通知'
  }
  if (it.role === 'contract' || it.id === 'contract') return '不填则按中标/成交通知'
  if (it.id === 'township_letter') return '请示申请金额'
  if (optionalAmount.value) return '选填'
  return ''
})

const persist = () => {
  if (!project.value) return
  const patch = {
    date: date.value,
    startDate: startDate.value,
    endDate: endDate.value,
    remark: remark.value,
    notes: remark.value
  }
  if (showAmount.value) patch.amount = amount.value
  if (showContractor.value) patch.contractor = contractor.value
  saveMaterial(project.value.id, route.params.key, patch)
}

const passDateReview = () => {
  if (!project.value || !itemKey.value) return
  const info = inspectOcrDates(project.value, itemKey.value)
  saveMaterial(project.value.id, itemKey.value, {
    dateReviewOk: true,
    dateReviewKey: info.key
  })
  ElMessage.success('已人工通过日期核对')
}

const toggleConfirm = () => {
  if (!project.value) return
  const next = !confirmed.value
  saveMaterial(project.value.id, route.params.key, { confirmed: next })
  ElMessage.success(next ? '已确认，可不传照片' : '已取消确认')
}

const onStart = () => {
  persist()
}

const applyOcrResult = (result, auto, extra) => {
  const fromScan = !!(extra && extra.fromScan)
  const fields = writableFields.value.slice()
  const patch = applyParsed({
    date: date.value,
    startDate: startDate.value,
    endDate: endDate.value,
    amount: amount.value,
    contractor: contractor.value
  }, result.parsed, fields, item.value && item.value.minDays)
  if (patch.next.date) date.value = patch.next.date
  if (patch.next.startDate) startDate.value = patch.next.startDate
  if (patch.next.endDate) endDate.value = patch.next.endDate
  if (patch.next.amount != null) amount.value = patch.next.amount
  if (patch.next.contractor) contractor.value = patch.next.contractor
  const before = project.value || {}
  const beforeName = before.name
  const beforeContractor = before.contractor
  if (project.value) applyProjectMeta(project.value.id, result.parsed)
  const after = project.value || {}
  const extraBits = []
  if (after.name && after.name !== beforeName) extraBits.push('项目名称')
  if (after.contractor && after.contractor !== beforeContractor) extraBits.push(isCompare.value ? '低价单位' : '中标单位')
  if (!project.value) return patch
  const file = ocrFiles.value[ocrFiles.value.length - 1]
  const done = patch.filled.concat(extraBits)
  saveOcrCapture(project.value.id, route.params.key, {
    fileId: file && file.id,
    text: result.text,
    patch: Object.assign({
      date: date.value,
      startDate: startDate.value,
      endDate: endDate.value,
      remark: remark.value,
      notes: remark.value,
      ocrTried: true,
      ocrAt: Date.now(),
      ocrEngine: result.engine,
      ocrSummary: patch.summary,
      scanFilled: fromScan ? !!(done.length || patch.summary || mat().scanFilled) : mat().scanFilled
    }, showAmount.value ? { amount: amount.value } : {}, showContractor.value ? { contractor: contractor.value } : {})
  })
  const missHint = optionalDate.value || optionalAmount.value
    ? '图上没认出日期或金额。没有也不用填'
    : (showAmount.value ? '这张图没认出日期或金额，请手填' : '这张图没认出日期，请手填')
  ocrHint.value = patch.summary
    ? (ocrEngineHint(result.engine) + '：' + patch.summary)
    : (extraBits.length ? (isCompare.value ? '已按比价低价写入' : '已按成交通知写入') + extraBits.join('、') : missHint)
  if (done.length) ElMessage.success((fromScan ? '扫描已填 ' : '已填 ') + done.join('、') + '，请核对')
  else if (auto && (optionalDate.value || optionalAmount.value)) ElMessage.info('没认出日期或金额，没有也不用填')
  else if (auto) ElMessage.warning(showAmount.value ? '没认出日期或金额，请手填或再点识别' : '没认出日期，请手填或再点识别')
  else if (!auto && patch.summary) ElMessage.info('识别到 ' + patch.summary + '，栏里已有数就没改')
  else if (!auto && (optionalDate.value || optionalAmount.value)) ElMessage.info('没认出日期或金额，没有也不用填')
  else if (!auto) ElMessage.warning(showAmount.value ? '没认出日期或金额' : '没认出日期')
  return patch
}

const runOcr = async (auto) => {
  if (!needOcr.value || !ocrFiles.value.length || ocrBusy.value) return
  ocrBusy.value = true
  ocrHint.value = '正在识别，请稍候…'
  try {
    const result = await recognizeBestUpload(ocrFiles.value, ocrKindForItem(item.value), writableFields.value)
    applyOcrResult(result, !!auto)
  } catch (e) {
    ocrHint.value = (e && e.message) || '识别失败'
    ElMessage.error(ocrHint.value)
  } finally {
    ocrBusy.value = false
  }
}

const openScan = () => {
  if (!canScan.value || ocrBusy.value) return
  unlockScanFeedback()
  scanOpen.value = true
}

const onScanHit = (result) => {
  const patch = applyOcrResult(result, false, { fromScan: true })
  const current = {
    date: date.value,
    startDate: startDate.value,
    endDate: endDate.value,
    amount: amount.value,
    contractor: contractor.value
  }
  if (shouldFinishScan(item.value, current, patch && patch.filled)) {
    scanOpen.value = false
  }
}

function slotOf(slot) {
  if (isCompare.value && isCompareSlot(slot)) return slot
  if (isCompare.value) return 'compare_low'
  return itemKey.value
}

const ingest = async (list, slot) => {
  const target = slotOf(slot)
  if (!list || !list.length || !project.value || !target || ocrBusy.value) return
  ocrBusy.value = true
  try {
    const picked = await expandUploads(list)
    if (!picked.length) {
      ElMessage.warning('没有可用的图片或 PDF')
      return
    }
    await addFiles(project.value.id, target, picked)
    const failed = (getMaterial(project.value, target).files || []).find((f) => f && f.storeError)
    if (failed) ElMessage.error(failed.storeError)
    const shouldOcr = needOcr.value && (!isCompare.value || target === 'compare_low')
    if (shouldOcr) {
      ocrHint.value = '正在识别，请稍候…'
      const batch = (getMaterial(project.value, target).files || []).slice(-picked.length)
      const result = await recognizeBestUpload(batch, ocrKindForItem(item.value), writableFields.value)
      applyOcrResult(result, true)
    } else {
      ElMessage.success(picked.length > 1 ? '已拆成 ' + picked.length + ' 页' : '已加入')
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
  ingest(list, key)
})
watch([itemKey, isCompare], () => {
  if (isCompare.value) mark('compare_low')
  else if (itemKey.value) mark(itemKey.value)
}, { immediate: true })

const onPick = (e, slot) => {
  const list = filesFromInput(e.target)
  e.target.value = ''
  ingest(list, slot)
}

const { preview, open: openPreview, close: closePreview, step: stepPreview, sync: syncPreview } = usePhotoPreview()
const showPreview = (file, list, slot) => {
  previewSlot.value = slot || itemKey.value
  openPreview(file, list)
}

const onReorder = (list, slot) => {
  if (!project.value) return
  const target = slot || itemKey.value
  if (!target) return
  reorderFiles(project.value.id, target, list)
}

const onCaption = (file, text, slot) => {
  if (!project.value || !file) return
  const target = slot || itemKey.value
  if (!target) return
  updateFileMeta(project.value.id, target, file.id, { caption: String(text || '').trim() })
}

const onRotate = async (file, slot) => {
  if (!project.value || !file) return
  const target = slot || previewSlot.value || itemKey.value
  if (!target) return
  try {
    await rotateStoredFile(project.value.id, target, file.id, 90)
    syncPreview()
  } catch (err) {
    ElMessage.error((err && err.message) || '旋转失败')
  }
}

const onPreviewRotate = () => onRotate(preview.files[preview.index], previewSlot.value)

const retryStore = async () => {
  if (!project.value || !itemKey.value) return
  await persistPendingPhotos(project.value.id)
  const slots = isCompare.value ? COMPARE_TIERS.map((tier) => tier.slot) : [itemKey.value]
  const failed = slots
    .map((slot) => (getMaterial(project.value, slot).files || []).find((f) => f && f.storeError))
    .find(Boolean)
  if (failed) ElMessage.error(failed.storeError)
  else ElMessage.success('已存到云端')
}

const remove = async (file, slot) => {
  try {
    const tip = (file && (file.cosKey || file.stored))
      ? '会从云端永久删掉这张照片，确定？'
      : '删除这张图？'
    await ElMessageBox.confirm(tip, '删除', { type: 'warning' })
    await removeFile(project.value.id, slot || route.params.key, file.id)
  } catch (e) {
    if (e === 'cancel' || e === 'close') return
    if (e && e.message) ElMessage.error(e.message)
  }
}
</script>
