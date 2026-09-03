<template>
  <div class="pa">
    <div v-if="!orgLocked" class="pa-card">
      <p class="pa-title">哪边报账？</p>
      <div class="pa-item" :class="{ on: form.orgType === 'village' }" @click="pick('village')">
        <div class="pa-tile village">村</div>
        <div class="pa-grow">
          <div>村委会</div>
          <div class="pa-sub">开会、公示、招标、合同、发票</div>
        </div>
        <span v-if="form.orgType === 'village'" class="pa-tag village">已选</span>
      </div>
      <div class="pa-item" @click="pick('small')">
        <div class="pa-tile small">小</div>
        <div class="pa-grow">
          <div>村委会小额</div>
          <div class="pa-sub">报价、比价、施工照、发票</div>
        </div>
        <span v-if="form.orgType === 'small'" class="pa-tag small">已选</span>
      </div>
      <div class="pa-item" @click="pick('township')">
        <div class="pa-tile town">乡</div>
        <div class="pa-grow">
          <div>乡政府</div>
          <div class="pa-sub">审批、方案、请示、采购、合同、发票</div>
        </div>
        <span v-if="form.orgType === 'township'" class="pa-tag town">已选</span>
      </div>
    </div>

    <div v-if="form.orgType" class="pa-card" style="margin-top: 12px;">
      <div class="pa-row">
        <p class="pa-title pa-grow">{{ isEdit ? '编辑项目' : '登记项目' }}</p>
        <span class="pa-tag" :class="org.accent">{{ org.name }}</span>
      </div>
      <div class="pa-field">
        <label class="pa-label">项目名称</label>
        <el-input v-model="form.name" maxlength="40" placeholder="可不填" />
      </div>
      <div class="pa-field">
        <label class="pa-label">{{ org.placeLabel }}</label>
        <el-input v-model="form.village" maxlength="20" placeholder="选填" />
      </div>
      <div class="pa-field">
        <label class="pa-label">年度</label>
        <el-select v-model="form.year" style="width: 100%;">
          <el-option v-for="y in years" :key="y" :label="y" :value="y" />
        </el-select>
      </div>
      <div class="pa-field">
        <label class="pa-label">{{ org.contractorLabel }}</label>
          <el-input v-model="form.contractor" maxlength="40" placeholder="选填" />
      </div>
      <div class="pa-field">
        <label class="pa-label">{{ form.orgType === 'village' && form.jointBid ? '本村实施结果金额（元）' : '报账金额（元）' }}</label>
        <el-input v-model="form.budgetAmount" inputmode="decimal" placeholder="选填" />
      </div>
      <div v-if="form.orgType === 'village'" class="pa-field">
        <el-checkbox v-model="form.jointBid">两村打包成一个标</el-checkbox>
      </div>
      <template v-if="form.orgType === 'village' && form.jointBid">
        <div class="pa-field">
          <label class="pa-label">另一村名称</label>
          <el-input v-model="form.partnerVillage" maxlength="20" placeholder="选填" />
        </div>
        <div class="pa-field">
          <label class="pa-label">另一村实施结果金额（元）</label>
          <el-input v-model="form.partnerAmount" inputmode="decimal" placeholder="选填" />
        </div>
      </template>
      <div class="pa-field">
        <label class="pa-label">备注</label>
        <el-input v-model="form.notes" type="textarea" :rows="2" maxlength="200" placeholder="选填" />
      </div>
      <div v-if="!isEdit" class="pa-field">
        <el-button @click="goPack">改用整包 PDF 一键审核</el-button>
      </div>
    </div>

    <div class="pa-dock pa-actions">
      <el-button v-if="form.orgType" class="is-main" type="primary" @click="save">{{ isEdit ? '保存' : '开始预审' }}</el-button>
      <el-button class="pa-dock-back-btn" @click="$router.back()">返回</el-button>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { getOrg } from '../lib/org.js'
import { yearOptions } from '../lib/format.js'
import { ensureProjectReady, getProject, isBlankDraft, upsertProject } from '../lib/store.js'
import { typingInField } from '../lib/util.js'
import '../preaudit.css'

const route = useRoute()
const router = useRouter()
const years = yearOptions()
const isEdit = computed(() => !!route.params.id)
const existing = route.params.id ? getProject(route.params.id) : null
const preset = route.query.org || (existing && existing.orgType) || ''

const form = reactive({
  id: existing ? existing.id : '',
  orgType: preset || '',
  name: existing && existing.name && existing.name !== '待认项目' ? existing.name : '',
  village: existing ? existing.village : '',
  year: existing ? existing.year : String(new Date().getFullYear()),
  contractor: existing ? existing.contractor : '',
  budgetAmount: existing && (existing.budgetAmount === 0 || existing.budgetAmount) ? String(existing.budgetAmount) : '',
  jointBid: !!(existing && (existing.jointBid || existing.partnerVillage || existing.partnerAmount)),
  partnerVillage: existing ? existing.partnerVillage : '',
  partnerAmount: existing && (existing.partnerAmount === 0 || existing.partnerAmount) ? String(existing.partnerAmount) : '',
  notes: existing ? existing.notes : ''
})

const orgLocked = computed(() => !!form.orgType && (!!route.params.id || !!route.query.org))
const org = computed(() => getOrg(form.orgType))

watch(
  () => route.query.org,
  (org) => {
    if (org && !form.orgType) form.orgType = String(org)
  },
  { immediate: true }
)

function fillForm(project) {
  if (!project) return
  form.id = project.id
  form.orgType = project.orgType || form.orgType
  form.name = project.name && project.name !== '待认项目' ? project.name : form.name
  form.village = project.village || form.village
  form.year = project.year || form.year
  form.contractor = project.contractor || form.contractor
  form.budgetAmount = (project.budgetAmount === 0 || project.budgetAmount) ? String(project.budgetAmount) : form.budgetAmount
  form.jointBid = !!(project.jointBid || project.partnerVillage || project.partnerAmount)
  form.partnerVillage = project.partnerVillage || form.partnerVillage
  form.partnerAmount = (project.partnerAmount === 0 || project.partnerAmount) ? String(project.partnerAmount) : form.partnerAmount
  form.notes = project.notes || form.notes
}

onMounted(async () => {
  if (!route.params.id) return
  const project = await ensureProjectReady(route.params.id)
  fillForm(project || getProject(route.params.id))
})

watch(() => {
  const p = route.params.id ? getProject(route.params.id) : null
  return p ? [p.updatedAt, p.name, p.village, p.contractor, p.budgetAmount, p.notes, p.jointBid, p.partnerVillage].join('|') : ''
}, () => {
  if (typingInField()) return
  fillForm(getProject(route.params.id))
})

const pick = (orgType) => {
  if (orgLocked.value) return
  form.orgType = orgType
}

const goPack = () => {
  if (!form.orgType) {
    ElMessage.warning('请先选类型')
    return
  }
  router.push('/preaudit/pack?org=' + form.orgType)
}

const save = () => {
  if (!form.orgType) {
    ElMessage.warning('请先选类型')
    return
  }
  if (form.orgType !== 'village') {
    form.jointBid = false
    form.partnerVillage = ''
    form.partnerAmount = ''
  }
  if (!isEdit.value && isBlankDraft(form)) {
    ElMessage.warning('请先填一项')
    return
  }
  const saved = upsertProject(form)
  ElMessage.success(saved.name === '待认项目' ? '已建立，传到成交通知后会认名称' : '已保存')
  router.replace('/preaudit/' + saved.id)
}
</script>
