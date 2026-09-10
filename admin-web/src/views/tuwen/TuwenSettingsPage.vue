<template>
  <div class="tw-page" v-loading="loading">
    <div class="tw-hero">
      <div>
        <div class="tw-hero__kicker">打印抬头、分类、收款码与备份</div>
        <div class="tw-hero__title">设置</div>
      </div>
      <div class="tw-hero__actions">
        <el-button size="small" @click="colOpen = true">列与单位</el-button>
        <el-button type="primary" size="small" :loading="saving" @click="save">保存设置</el-button>
      </div>
    </div>

    <div v-if="importHint" class="tw-hero__hint">{{ importHint }}</div>

    <div class="tw-panel tw-settings-card">
      <div class="tw-panel__title">打印与开单</div>
      <div class="tw-settings-grid">
        <label class="tw-settings-field">
          <span>公司名</span>
          <el-input v-model="form.brandCompanyName" placeholder="空则打印不显示公司名" />
        </label>
        <label class="tw-settings-field">
          <span>打印标题</span>
          <el-input v-model="form.printCompanyTitle" placeholder="左上角抬头，如正大广告装饰业务单" />
        </label>
        <label class="tw-settings-field">
          <span>单据名称</span>
          <el-input v-model="form.printDocTitle" maxlength="20" placeholder="中间大标题，默认业务单" />
        </label>
        <label class="tw-settings-field">
          <span>默认税率 %</span>
          <el-input v-model.number="form.defaultTaxRate" type="number" />
        </label>
        <label class="tw-settings-field">
          <span>尺寸录入单位</span>
          <el-select v-model="form.dimensionUnit">
            <el-option v-for="u in DIMENSION_UNITS" :key="u.value" :label="u.label" :value="u.value" />
          </el-select>
        </label>
      </div>
    </div>

    <div class="tw-panel tw-settings-card">
      <div class="tw-panel__title">支出分类</div>
      <p class="tw-settings-lead">登记支出和报表汇总用的项目，可直接输入新名称。</p>
      <label class="tw-settings-field">
        <span>支出项目（报表分类）</span>
        <el-select v-model="form.reportExpenseLabels" multiple allow-create filterable default-first-option>
          <el-option v-for="item in form.reportExpenseLabels" :key="item" :label="item" :value="item" />
        </el-select>
      </label>
    </div>

    <div class="tw-settings-split">
      <div class="tw-panel tw-settings-card tw-settings-qr">
        <div class="tw-panel__title">收款码</div>
        <p class="tw-settings-lead">打印业务单时可贴在右下角，方便客户扫码付款。</p>
        <el-checkbox v-model="form.showPaymentQrOnPrint">打印时默认显示收款码</el-checkbox>
        <CosUpload
          class="tw-settings-upload"
          v-model="form.paymentQrDataUrl"
          path-prefix="图文智能业务/default/settings/"
          accept="image/*"
          :show-input="false"
        />
      </div>
      <div class="tw-panel tw-settings-card tw-settings-aside">
        <div class="tw-panel__title">数据备份</div>
        <p class="tw-settings-lead">整包导出当前工作区；导入会合并到现有数据，不会清空。</p>
        <ul class="tw-settings-cover">
          <li>订单</li>
          <li>客户</li>
          <li>支出</li>
          <li>供应商</li>
          <li>售后</li>
          <li>操作记录</li>
          <li>打印与分类设置</li>
        </ul>
        <div class="tw-settings-aside__ops">
          <el-button size="small" :loading="exporting" @click="onExport">导出备份</el-button>
          <el-button size="small" :loading="importing" @click="triggerImport">导入备份</el-button>
        </div>
      </div>
    </div>
    <input ref="importInput" type="file" accept="application/json,.json" class="tw-hidden" @change="onImportFile" />
    <TwColumnSettings v-model="colOpen" :settings="form" @save="onSaveColumns" />
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { api } from '../../api/client'
import CosUpload from '../../components/media/CosUpload.vue'
import TwColumnSettings from './TwColumnSettings.vue'
import {
  DEFAULT_APP_SETTINGS,
  DIMENSION_UNITS,
  SAMPLE_COS_PREFIX,
  chunkImportBatches,
  collectLineDataUrls,
  deepStripDataUrls,
  extractImportPayload,
  hasImportPayload,
  normalizeDimensionUnit,
  parseDataUrlMeta,
  withDimensionUnit,
  workspaceBackupOf,
  workspaceBackupSummary
} from '../../utils/tuwen-yewu.js'

const loading = ref(false)
const saving = ref(false)
const exporting = ref(false)
const importing = ref(false)
const importHint = ref('')
const importInput = ref(null)
const colOpen = ref(false)
const form = reactive({ ...DEFAULT_APP_SETTINGS, reportExpenseLabels: [...DEFAULT_APP_SETTINGS.reportExpenseLabels] })

async function load() {
  loading.value = true
  try {
    const data = await api.getTuwenSettings()
    Object.assign(form, DEFAULT_APP_SETTINGS, (data && data.settings) || {})
    if (!Array.isArray(form.reportExpenseLabels)) form.reportExpenseLabels = [...DEFAULT_APP_SETTINGS.reportExpenseLabels]
    form.dimensionUnit = normalizeDimensionUnit(form.dimensionUnit)
  } catch (e) {
    ElMessage.error((e && e.message) || '读取设置失败')
  } finally {
    loading.value = false
  }
}

async function save() {
  saving.value = true
  try {
    const data = await api.saveTuwenSettings(withDimensionUnit(form, form.dimensionUnit))
    Object.assign(form, data.settings || form)
    ElMessage.success('设置已保存')
  } catch (e) {
    ElMessage.error((e && e.message) || '保存失败')
  } finally {
    saving.value = false
  }
}

async function onSaveColumns(payload) {
  Object.assign(form, payload)
  await save()
}

function triggerImport() {
  importInput.value && importInput.value.click()
}

async function onExport() {
  exporting.value = true
  try {
    const data = await api.getTuwenWorkspace()
    const backup = workspaceBackupOf(data)
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `tuwen-workspace-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    ElMessage.success(`已导出 ${workspaceBackupSummary(backup)}`)
  } catch (e) {
    ElMessage.error((e && e.message) || '导出失败')
  } finally {
    exporting.value = false
  }
}

function putToPresign(uploadUrl, blob, mime) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', uploadUrl, true)
    xhr.setRequestHeader('Content-Type', mime || 'application/octet-stream')
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`HTTP ${xhr.status}`)))
    xhr.onerror = () => reject(new Error('上传失败'))
    xhr.send(blob)
  })
}

async function uploadDataUrlToCos(dataUrl, keyHint) {
  const meta = parseDataUrlMeta(dataUrl)
  if (!meta) return ''
  const res = await fetch(dataUrl)
  const blob = await res.blob()
  if (!blob || !blob.size) return ''
  const key = `${SAMPLE_COS_PREFIX}${keyHint}.${meta.ext}`
  const presign = await api.cosPresign({ key })
  await putToPresign(presign.uploadUrl, blob, meta.mime)
  return presign.cosUrl
}

async function uploadImportSamples(orders) {
  const items = collectLineDataUrls(orders)
  let done = 0
  let okCount = 0
  let cursor = 0
  async function worker() {
    while (cursor < items.length) {
      const idx = cursor
      cursor += 1
      const item = items[idx]
      importHint.value = `正在上传样图 ${idx + 1}/${items.length}`
      const lineId = String((item.line && item.line.id) || `l${idx}`)
      try {
        const url = await uploadDataUrlToCos(item.dataUrl, `${item.orderId}/${lineId}`)
        if (url) {
          item.line.sampleImageDataUrl = url
          if (item.line.sampleImageUrl) item.line.sampleImageUrl = url
          okCount += 1
        } else {
          delete item.line.sampleImageDataUrl
        }
      } catch {
        delete item.line.sampleImageDataUrl
      }
      done += 1
      importHint.value = `正在上传样图 ${done}/${items.length}`
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, worker))
  return { total: items.length, uploaded: okCount }
}

async function onImportFile(e) {
  const file = e.target.files && e.target.files[0]
  if (importInput.value) importInput.value.value = ''
  if (!file) return
  importing.value = true
  importHint.value = '正在读取备份…'
  try {
    const raw = JSON.parse(await file.text())
    const extracted = extractImportPayload(raw)
    if (!hasImportPayload(extracted)) {
      ElMessage.warning('文件里没有可导入的数据')
      return
    }
    const sampleStat = await uploadImportSamples(extracted.orders)
    importHint.value = '正在写入工作区…'
    const payload = deepStripDataUrls(extracted)
    const batches = chunkImportBatches(payload)
    let imported = 0
    let last = null
    for (const batch of batches) {
      last = await api.importTuwenWorkspace(batch)
      imported += Number(last && last.imported) || 0
    }
    const extra = sampleStat.total ? `，样图 ${sampleStat.uploaded}/${sampleStat.total}` : ''
    const summary = last
      ? `云端 订单 ${last.orderCount || 0}、支出 ${last.expenseCount || 0}、客户 ${last.customerCount || 0}`
      : ''
    ElMessage.success(`已导入 ${imported} 单${extra}${summary ? `，${summary}` : ''}`)
    await load()
  } catch (err) {
    const msg = String((err && err.message) || '导入失败')
    ElMessage.error(/payload size|EXCEED_MAX_PAYLOAD/i.test(msg) ? '备份仍太大，请稍后再试' : msg)
  } finally {
    importing.value = false
    importHint.value = ''
  }
}

onMounted(load)
</script>
