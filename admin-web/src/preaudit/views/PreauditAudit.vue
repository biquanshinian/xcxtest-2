<template>
  <div class="pa">
    <div v-if="booting && !project" class="pa-card pa-empty">正在找回项目并核验…</div>
    <div v-else-if="!project" class="pa-card pa-empty">找不到这个项目</div>
    <template v-else>
      <div v-if="scanning" class="pa-card">
        <p class="pa-title">正在认图</p>
        <div class="pa-sub">{{ scanText }}</div>
      </div>

      <template v-else-if="report">
        <div class="pa-card pa-banner" :class="report.summary.tone === 'ok' ? 'pass' : (report.summary.tone === 'risk' ? 'risk' : 'warn')" style="margin-bottom: 0;">
          <div class="pa-title">{{ report.summary.label }}</div>
          <div style="margin-top: 6px;">{{ report.summary.text }}</div>
          <div class="pa-sub">材料 {{ report.completeness.uploaded }}/{{ report.completeness.total }} · 阶段 {{ report.stages.done }}/{{ report.stages.total }}。点下面每条可打开对应资料，按「更正」改日期或金额。</div>
        </div>
        <div v-if="ocrNote" class="pa-ocr" style="margin-top: 8px;">{{ ocrNote }}</div>

        <div v-if="localNote" class="pa-card" style="margin-top: 12px;">
          <p class="pa-title">核验说明</p>
          <div class="pa-ai">{{ localNote }}</div>
        </div>
        <div class="pa-card" style="margin-top: 12px;">
          <div class="pa-row">
            <p class="pa-title pa-grow">AI 审计</p>
            <span class="pa-tag muted">不存档</span>
          </div>
          <div v-if="aiText" class="pa-ai">{{ aiText }}</div>
          <div v-else class="pa-ocr">{{ aiHint || '根据上面的规则核验再写一句人话，图和原文不落库' }}</div>
          <div class="pa-actions">
            <el-button :disabled="aiBusy || scanning" :loading="aiBusy" @click="runAi">{{ aiText ? '再请 AI 看' : '请 AI 看一眼' }}</el-button>
          </div>
        </div>

        <div v-if="report.timeline.length" class="pa-card" style="margin-top: 12px;">
          <p class="pa-title">流程日期</p>
          <div
            v-for="row in report.timeline"
            :key="row.key"
            class="pa-item"
            :data-pa-anchor="row.key"
            @click="open(row)"
          >
            <div class="pa-grow">
              <div>{{ row.label }}</div>
              <div class="pa-sub">{{ row.date || '未认到' }}</div>
            </div>
            <span class="pa-tag" :class="row.tone">{{ row.inverted ? '倒签' : (row.date ? '顺' : '缺') }}</span>
          </div>
        </div>

        <div v-if="report.dates.noticeResStart || report.dates.bidDate || report.dates.awardAmount || report.dates.budgetQuote || report.dates.compareAmount || report.dates.lowestAmount || report.dates.acceptDate || report.dates.acceptAmount" class="pa-card" style="margin-top: 12px;">
          <p class="pa-title">关键信息</p>
          <div class="pa-sub" v-if="report.dates.noticeResStart">决议公示：{{ report.dates.noticeResStart }} 至 {{ report.dates.noticeResEnd }}</div>
          <div class="pa-sub" v-if="!report.isTownship && !report.isSmall && report.dates.noticePlanStart">方案公示：{{ report.dates.noticePlanStart }} 至 {{ report.dates.noticePlanEnd }}</div>
          <div class="pa-sub" v-if="report.dates.resultPublicStart">{{ report.isTownship ? '实施结果公开' : '实施结果公示' }}：{{ report.dates.resultPublicStart }} 至 {{ report.dates.resultPublicEnd }}</div>
          <div class="pa-sub" v-if="report.dates.bidDate">中标日期：{{ report.dates.bidDate }}</div>
          <div class="pa-sub" v-if="report.dates.awardAmount">中标/成交金额：{{ report.dates.awardAmount }} 元</div>
          <div class="pa-sub" v-if="report.dates.jointBid">
            两村打包：本村{{ report.dates.budgetAmount ? '实施 ' + report.dates.budgetAmount + ' 元' : '实施结果未填' }}
            <template v-if="report.dates.partnerVillage || report.dates.partnerAmount">
              ，{{ report.dates.partnerVillage || '另一村' }}{{ report.dates.partnerAmount ? '申请 ' + report.dates.partnerAmount + ' 元' : '' }}
            </template>
          </div>
          <div class="pa-sub" v-if="report.dates.contractDate">合同日期：{{ report.dates.contractDate }}</div>
          <div class="pa-sub" v-if="report.dates.acceptDate">验收单日期：{{ report.dates.acceptDate }}</div>
          <div class="pa-sub" v-if="report.dates.acceptAmount">验收单金额：{{ report.dates.acceptAmount }} 元</div>
          <div class="pa-sub" v-if="report.isTownship && report.dates.quoteAmount">报价合计：{{ report.dates.quoteAmount }} 元</div>
          <div class="pa-sub" v-if="report.isSmall && report.dates.budgetQuote">预算报价：{{ report.dates.budgetQuote }} 元</div>
          <div class="pa-sub" v-if="report.isSmall && (report.dates.compareAmount || report.dates.lowestAmount)">比价低价：{{ report.dates.compareAmount || report.dates.lowestAmount }} 元</div>
        </div>

        <div v-if="report.fraudIssues.length" class="pa-card" style="margin-top: 12px;">
          <p class="pa-title">假账嫌疑</p>
          <div v-for="(row, i) in report.fraudIssues" :key="'f' + i" class="pa-issue" :data-pa-anchor="row.key || row.id" @click="open(row)">
            <div>{{ row.title }}</div>
            <div class="pa-sub">{{ row.message }}</div>
          </div>
        </div>
        <div v-if="report.dateRisks.length" class="pa-card" style="margin-top: 12px;">
          <p class="pa-title">日期对不上</p>
          <div v-for="(row, i) in report.dateRisks" :key="'d' + i" class="pa-issue" :data-pa-anchor="row.key || row.id" @click="open(row)">
            <div>{{ row.title }}</div>
            <div class="pa-sub">{{ row.message }}</div>
          </div>
        </div>
        <div v-if="report.amountIssues.length" class="pa-card" style="margin-top: 12px;">
          <p class="pa-title">金额核验</p>
          <div v-for="(row, i) in report.amountIssues" :key="'a' + i" class="pa-issue" :data-pa-anchor="row.key || row.id" @click="open(row)">
            <div>{{ row.title }}</div>
            <div class="pa-sub">{{ row.message }}</div>
          </div>
        </div>
        <div v-if="report.missing.length" class="pa-card" style="margin-top: 12px;">
          <p class="pa-title">缺项</p>
          <div v-for="(row, i) in report.missing" :key="'m' + i" class="pa-issue" :data-pa-anchor="row.key || row.id" @click="open(row)">
            <div>{{ row.title }}</div>
            <div class="pa-sub">{{ row.message }}</div>
          </div>
        </div>
        <div v-if="report.peopleIssues.length" class="pa-card" style="margin-top: 12px;">
          <p class="pa-title">验收人数</p>
          <div v-for="(row, i) in report.peopleIssues" :key="'p' + i" class="pa-issue" :data-pa-anchor="row.key || row.id" @click="open(row)">
            <div>{{ row.title }}</div>
            <div class="pa-sub">{{ row.message }}</div>
          </div>
        </div>
        <div v-if="report.reviewIssues.length" class="pa-card" style="margin-top: 12px;">
          <p class="pa-title">需人工核日期</p>
          <div class="pa-sub">同一张图认出多个日期，且和填写的对不上。对照原图后可手动通过。</div>
          <div v-for="(row, i) in report.reviewIssues" :key="'r' + i" class="pa-issue" :data-pa-anchor="row.key || row.id">
            <div @click="open(row)">{{ row.title }}</div>
            <div class="pa-sub" @click="open(row)">{{ row.message }}</div>
            <div class="pa-issue-actions pa-actions">
              <el-button @click="open(row)">去看图</el-button>
              <el-button class="is-main" type="primary" @click="passReview(row)">核对无误，通过</el-button>
            </div>
          </div>
        </div>
        <div v-if="report.warnings.length" class="pa-card" style="margin-top: 12px;">
          <p class="pa-title">待补日期或金额</p>
          <div v-for="(row, i) in report.warnings" :key="'w' + i" class="pa-issue" :data-pa-anchor="row.key || row.id" @click="open(row)">
            <div>{{ row.title }}</div>
            <div class="pa-sub">{{ row.message }}</div>
          </div>
        </div>
        <div v-if="allClear" class="pa-card pa-empty pass" style="margin-top: 12px;">可以报账</div>
      </template>

      <div class="pa-dock pa-actions">
        <el-button class="is-main" type="primary" :disabled="scanning" :loading="scanning" @click="runScan(true)">{{ scanning ? '正在认图' : '再认一遍再核验' }}</el-button>
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { ensureProjectReady, getProject, saveMaterial, updateProject } from '../lib/store.js'
import { getItem, getOrgType } from '../lib/checklist.js'
import { auditProject, explainAudit, inspectOcrDates } from '../lib/audit.js'
import { fillProjectFromCachedOcr, listOcrJobs, recognizeProject } from '../lib/ocr.js'
import { buildAiPayload, requestCloudAiAudit } from '../lib/ai-audit.js'
import { markLeave, restoreIfPending } from '../lib/scroll-memory.js'
import '../preaudit.css'

const route = useRoute()
const router = useRouter()
const project = computed(() => getProject(route.params.id))
const report = computed(() => project.value ? auditProject(project.value) : null)
const allClear = computed(() => report.value && report.value.summary.tone === 'ok')
const booting = ref(true)
const scanning = ref(false)
const scanText = ref('')
const ocrNote = ref('')
const localNote = computed(() => report.value ? explainAudit(report.value) : '')
const aiText = ref('')
const aiBusy = ref(false)
const aiHint = ref('')

const open = (row) => {
  const p = project.value
  if (!p || !row || !(row.key || row.id)) return
  const key = row.key || row.id
  markLeave(route.fullPath, key)
  const item = getItem(key, getOrgType(p))
  if (item && item.special === 'photos') {
    router.push('/preaudit/' + p.id + '/photos')
    return
  }
  if (item && item.special === 'contract') {
    router.push('/preaudit/' + p.id + '/contract')
    return
  }
  router.push('/preaudit/' + p.id + '/item/' + key)
}

const passReview = (row) => {
  const p = project.value
  if (!p || !row || !(row.key || row.id)) return
  const key = row.key || row.id
  const info = inspectOcrDates(p, key)
  saveMaterial(p.id, key, {
    dateReviewOk: true,
    dateReviewKey: info.key
  })
  rememberAudit()
  ElMessage.success('已人工通过日期核对')
}

const runAi = async () => {
  const p = project.value
  const r = report.value
  if (!p || !r || aiBusy.value) return
  aiBusy.value = true
  aiHint.value = '正在按核验事实写说明…'
  try {
    const data = await requestCloudAiAudit(buildAiPayload(p, r))
    aiText.value = (data && data.text) || ''
    aiHint.value = aiText.value
      ? (data.engine === 'hunyuan' ? '混元根据核验事实写的说明，不存档' : '已生成')
      : '云端审计未开通，先看上面的核验说明'
  } catch (e) {
    const msg = (e && e.message) || ''
    if (!aiText.value) {
      aiHint.value = /未授权|4010|过期/.test(msg)
        ? '云端审计还没部署，先看上面的核验说明'
        : (msg || '云端审计暂时不可用，先看上面的核验说明')
    }
  } finally {
    aiBusy.value = false
  }
}

const runScan = async (force) => {
  const p = project.value
  if (!p || scanning.value) return
  fillProjectFromCachedOcr(p.id)
  const jobs = listOcrJobs(getProject(p.id) || p, { force })
  if (!jobs.length) {
    ocrNote.value = force ? '栏里已有日期金额，按现有数核验' : ''
    return
  }
  scanning.value = true
  scanText.value = '先认照片上的日期、金额和项目名…'
  try {
    const result = await recognizeProject(p.id, (step) => {
      scanText.value = '正在认「' + step.name + '」(' + step.current + '/' + step.total + ')'
    }, { force })
    if (result.filled.length) {
      ocrNote.value = '已从图上填了 ' + result.filled.length + ' 项，请核对后再看结论'
      ElMessage.success(ocrNote.value)
    } else if (result.failed.length) {
      ocrNote.value = result.failed.length + ' 张没认出，请点进去手填'
    } else if (result.total) {
      ocrNote.value = '图上没认出新的日期、金额或项目名'
    } else {
      ocrNote.value = ''
    }
  } catch (e) {
    ocrNote.value = (e && e.message) || '识别失败'
    ElMessage.error(ocrNote.value)
  } finally {
    scanning.value = false
  }
}

function rememberAudit() {
  const p = project.value
  const r = report.value
  if (!p || !r || !r.raw) return
  updateProject(p.id, {
    lastAudit: {
      passed: r.raw.passed,
      errorCount: r.raw.errorCount,
      warnCount: r.raw.warnCount
    }
  })
}

onMounted(async () => {
  try {
    await ensureProjectReady(route.params.id)
    await runScan(false)
    rememberAudit()
  } finally {
    booting.value = false
    nextTick(() => restoreIfPending(route.fullPath))
  }
})
</script>
