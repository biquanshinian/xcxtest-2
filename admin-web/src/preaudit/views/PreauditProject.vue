<template>
  <div class="pa">
    <div v-if="!project && loading" class="pa-card pa-empty">正在从云端找回项目…</div>
    <div v-else-if="!project" class="pa-card pa-empty">找不到这个项目</div>
    <template v-else>
      <div class="pa-card">
        <div class="pa-row">
          <div class="pa-grow">
            <p class="pa-title">{{ project.name }}</p>
            <div class="pa-sub">
              <span class="pa-tag" :class="org.accent">{{ org.name }}</span>
              {{ meta }}
            </div>
            <div v-if="namePending" class="pa-sub">名称待从中标/成交通知自动认，也可点编辑手填</div>
          </div>
          <span class="pa-tag" :class="passed ? 'pass' : (errorCount ? 'risk' : 'warn')">
            {{ passed ? '可报账' : (errorCount ? '有风险' : '进行中') }}
          </span>
        </div>
        <div class="pa-bar" :class="passed ? 'pass' : (progress.filePercent === 100 ? '' : 'warn')">
          <i :style="{ width: progress.filePercent + '%' }" />
        </div>
        <div class="pa-sub">已齐 {{ progress.uploaded }} / {{ progress.total }}</div>
      </div>

      <div v-if="next" class="pa-card tap" style="margin-top: 12px;" :data-pa-anchor="next.id" @click="go(next)">
        <div class="pa-row">
          <div class="pa-grow">
            <p class="pa-title">{{ next.name }}</p>
          </div>
          <span>›</span>
        </div>
      </div>

      <div v-if="errorCount || passed" class="pa-banner" :class="passed ? 'pass' : 'risk'" style="margin-top: 12px;">
        {{ passed ? '核验通过' : '发现 ' + errorCount + ' 条问题' }}
      </div>

      <div class="pa-tools">
        <button type="button" class="pa-tool" data-pa-anchor="pack" @click="goTool('pack', '/preaudit/' + project.id + '/pack')">上传整包 PDF</button>
        <button type="button" class="pa-tool" data-pa-anchor="photos" @click="goTool('photos', '/preaudit/' + project.id + '/photos')">施工照片</button>
        <button v-if="org.id !== 'small'" type="button" class="pa-tool" data-pa-anchor="contract" @click="goTool('contract', '/preaudit/' + project.id + '/contract')">合同水印</button>
        <button type="button" class="pa-tool" data-pa-anchor="edit" @click="goTool('edit', '/preaudit/' + project.id + '/edit')">编辑项目</button>
      </div>

      <div v-for="group in groups" :key="group.id" class="pa-card" style="margin-top: 12px;">
        <div class="pa-row pa-group-head">
          <div class="pa-step" :class="[org.accent, group.done ? 'on' : '']">{{ group.step }}</div>
          <p class="pa-title pa-grow">{{ group.name }}</p>
          <span class="pa-count">{{ group.complete }}/{{ group.total }}</span>
        </div>
        <div v-if="group.hint" class="pa-sub pa-group-hint">{{ group.hint }}</div>
        <div v-if="group.allowConfirm && !group.done" class="pa-group-confirm">
          <el-button size="small" @click.stop="confirmGroup(group)">本组全部确认</el-button>
        </div>
        <div v-for="row in group.items" :key="row.id" class="pa-item" :data-pa-anchor="row.id" @click="go(row)">
          <div class="pa-grow">
            <div>{{ row.name }}</div>
            <div class="pa-sub">{{ row.meta }}</div>
          </div>
          <div class="pa-item-side">
            <el-button
              v-if="row.allowConfirm && !row.complete"
              size="small"
              @click.stop="confirmRow(row)"
            >确认</el-button>
            <el-button
              v-else-if="row.allowConfirm && row.confirmed"
              size="small"
              @click.stop="unconfirmRow(row)"
            >取消确认</el-button>
            <span class="pa-tag" :class="row.tone">{{ row.statusText }}</span>
          </div>
        </div>
      </div>

      <div class="pa-dock pa-actions">
        <el-button class="is-main" type="primary" data-pa-anchor="audit" @click="goTool('audit', '/preaudit/' + project.id + '/audit')">一键核验</el-button>
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { ensureProjectReady, getMaterial, getProject, saveMaterial, updateProject } from '../lib/store.js'
import { COMPARE_TIERS, getGroups, getItem, itemUrl, itemWritableFields } from '../lib/checklist.js'
import { fromProject } from '../lib/org.js'
import { isComplete, runAudit } from '../lib/audit.js'
import { fillProjectFromCachedOcr, isPlaceholderName } from '../lib/ocr.js'
import { formatMoney } from '../lib/format.js'
import { markLeave, restoreIfPending } from '../lib/scroll-memory.js'
import '../preaudit.css'

const route = useRoute()
const router = useRouter()
const loading = ref(true)
const project = computed(() => getProject(route.params.id))

onMounted(async () => {
  try {
    await ensureProjectReady(route.params.id)
    if (project.value) fillProjectFromCachedOcr(project.value.id)
  } finally {
    loading.value = false
    nextTick(() => restoreIfPending(route.fullPath))
  }
})
const org = computed(() => fromProject(project.value))
if (project.value) fillProjectFromCachedOcr(project.value.id)
const namePending = computed(() => project.value && isPlaceholderName(project.value.name))

const result = computed(() => project.value ? runAudit(project.value) : null)
const progress = computed(() => (result.value && result.value.progress) || { uploaded: 0, total: 0, filePercent: 0 })
const passed = computed(() => !!(result.value && result.value.passed))
const errorCount = computed(() => (result.value && result.value.errorCount) || 0)

const meta = computed(() => {
  const p = project.value
  if (!p) return ''
  const bits = [p.year ? p.year + '年' : '', p.village, p.contractor]
  if (p.jointBid || p.partnerVillage || p.partnerAmount) {
    const share = (p.budgetAmount === 0 || p.budgetAmount)
      ? '本村 ' + formatMoney(p.budgetAmount) + ' 元'
      : '两村打包'
    const other = p.partnerVillage
      ? p.partnerVillage + (p.partnerAmount === 0 || p.partnerAmount ? ' ' + formatMoney(p.partnerAmount) + ' 元' : '')
      : ''
    bits.push([share, other].filter(Boolean).join(' + '))
  }
  return bits.filter(Boolean).join(' · ')
})

function rowView(p, item) {
  const mat = getMaterial(p, item.id)
  const uploaded = item.special === 'compare'
    ? COMPARE_TIERS.reduce((n, tier) => n + ((getMaterial(p, tier.slot).files || []).length), 0)
    : (mat.files || []).length
  const complete = isComplete(item, mat, p)
  const writable = itemWritableFields(item)
  const showDate = writable.includes('date') || writable.includes('startDate')
  const showAmount = writable.includes('amount')
  let tone = 'risk'
  let statusText = '还没传'
  if (complete) {
    tone = 'ok'
    statusText = '已齐'
  } else if (item.requirePairedPhoto && !mat.pairedPhoto) {
    tone = 'warn'
    statusText = uploaded > 0 ? '需重拍' : '还没传'
  } else if (item.allowConfirm && mat.confirmed) {
    tone = 'warn'
    statusText = showDate ? '差日期' : '未齐'
  } else if (uploaded > 0) {
    tone = 'warn'
    statusText = showDate ? '差日期' : (item.needsPeople ? '差人数' : '未齐')
  } else if (item.allowConfirm) {
    statusText = '待确认'
  }
  const bits = []
  if (mat.confirmed && !uploaded) bits.push('已确认')
  else if (mat.scanFilled && !uploaded) bits.push('已扫描')
  else bits.push(uploaded + ' 张')
  if (showDate) {
    if (mat.startDate) bits.push(mat.startDate + (mat.endDate ? ' 至 ' + mat.endDate : ''))
    else if (mat.date) bits.push(mat.date)
  }
  if (showAmount && (mat.amount === 0 || mat.amount)) bits.push(formatMoney(mat.amount) + ' 元')
  return {
    id: item.id,
    name: item.name,
    fileCount: uploaded,
    meta: bits.join(' · '),
    tone,
    statusText,
    allowConfirm: !!item.allowConfirm,
    confirmed: !!mat.confirmed,
    complete,
    url: itemUrl(p.id, item)
  }
}

const groups = computed(() => {
  const p = project.value
  if (!p) return []
  return getGroups(org.value.id).map((group, index) => {
    const items = group.items
      .filter((item) => !item.hidden)
      .map((item) => rowView(p, getItem(item.id, org.value.id)))
    const complete = items.filter((row) => row.tone === 'ok').length
    return {
      id: group.id,
      step: index + 1,
      name: group.name,
      hint: group.hint,
      allowConfirm: !!group.allowConfirm,
      complete,
      total: items.length,
      done: complete === items.length,
      items
    }
  })
})

const next = computed(() => {
  for (const group of groups.value) {
    const row = group.items.find((r) => r.tone !== 'ok')
    if (row) return row
  }
  return null
})

const go = (row) => {
  if (!row || !row.url) return
  markLeave(route.fullPath, row.id)
  router.push(row.url)
}

const goTool = (anchor, path) => {
  markLeave(route.fullPath, anchor)
  router.push(path)
}

function confirmRow(row) {
  if (!project.value || !row) return
  saveMaterial(project.value.id, row.id, { confirmed: true })
  ElMessage.success('已确认「' + row.name + '」，可不传照片')
}

function unconfirmRow(row) {
  if (!project.value || !row) return
  saveMaterial(project.value.id, row.id, { confirmed: false })
  ElMessage.info('已取消确认')
}

function confirmGroup(group) {
  if (!project.value || !group) return
  ;(group.items || []).forEach((row) => {
    if (row.allowConfirm) saveMaterial(project.value.id, row.id, { confirmed: true })
  })
  ElMessage.success('已确认「' + group.name + '」全部项，可不传照片')
}

if (project.value && result.value) {
  updateProject(project.value.id, {
    lastAudit: {
      passed: result.value.passed,
      errorCount: result.value.errorCount,
      warnCount: result.value.warnCount
    }
  })
}
</script>
