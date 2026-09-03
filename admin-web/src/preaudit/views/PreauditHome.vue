<template>
  <div class="pa">
    <div class="pa-grid orgs">
      <div class="pa-card tap" @click="goNew('village')">
        <div class="pa-row">
          <div class="pa-tile village">村</div>
          <div class="pa-grow">
            <p class="pa-title">村委会报账</p>
            <div class="pa-sub">7 步 · 开会 公示 招标 合同 发票</div>
          </div>
        </div>
      </div>
      <div class="pa-card tap" @click="goNew('small')">
        <div class="pa-row">
          <div class="pa-tile small">小</div>
          <div class="pa-grow">
            <p class="pa-title">村委会小额</p>
            <div class="pa-sub">4 步 · 报价 比价 施工照 发票</div>
          </div>
        </div>
      </div>
      <div class="pa-card tap" @click="goNew('township')">
        <div class="pa-row">
          <div class="pa-tile town">乡</div>
          <div class="pa-grow">
            <p class="pa-title">乡政府报账</p>
            <div class="pa-sub">8 步 · 审批 方案 采购 合同 发票</div>
          </div>
        </div>
      </div>
    </div>

    <div class="pa-actions pa-home-bar">
      <el-button class="is-main" type="primary" @click="goNew('')">新建预审</el-button>
      <el-button @click="$router.push('/preaudit/pack')">整包 PDF 一键审核</el-button>
      <el-button @click="$router.push('/preaudit/guide')">指南</el-button>
    </div>

    <div v-if="loading && !rows.length" class="pa-card pa-empty" style="margin-top: 16px;">正在同步…</div>
    <div v-else-if="!rows.length" class="pa-card pa-empty" style="margin-top: 16px;">没有项目</div>
    <div v-else>
      <section v-for="section in homeSections" :key="section.key" class="pa-home-section">
        <div class="pa-row pa-home-section-head">
          <p class="pa-title pa-grow">{{ section.title }}</p>
          <span class="pa-count">{{ section.items.length }}</span>
        </div>
        <div v-if="!section.items.length" class="pa-card pa-empty pa-home-section-empty">暂无</div>
        <div
          v-for="item in section.items"
          :key="item.id"
          class="pa-card tap pa-home-card"
          :data-pa-anchor="item.id"
          @click="openProject(item)"
          @contextmenu.prevent="remove(item)"
        >
          <div class="pa-row">
            <div class="pa-grow">
              <p class="pa-title">{{ item.name }}</p>
              <div class="pa-sub">
                <span class="pa-tag" :class="item.orgAccent">{{ item.orgName }}</span>
                <span v-if="item.jointBid" class="pa-tag muted">两村打包</span>
                {{ item.year }} {{ item.village }}
              </div>
              <div class="pa-list-facts">
                <div>
                  <span class="pa-list-k">项目金额</span>
                  <span class="pa-list-v" :class="{ mute: !item.hasAmount }">{{ item.amountText }}</span>
                </div>
                <div>
                  <span class="pa-list-k">{{ item.dateLabel }}</span>
                  <span class="pa-list-v" :class="{ mute: !item.hasBidDate }">{{ item.bidDateText }}</span>
                </div>
              </div>
            </div>
            <div class="pa-list-side">
              <span class="pa-tag" :class="item.tone === 'ok' ? 'pass' : (item.tone === 'risk' ? 'risk' : 'warn')">{{ item.status }}</span>
              <el-button size="small" text type="danger" @click.stop="remove(item)">删除</el-button>
            </div>
          </div>
          <div class="pa-bar" :class="item.tone === 'ok' ? 'pass' : (item.errorCount ? 'risk' : (item.filePercent === 100 ? '' : 'warn'))">
            <i :style="{ width: item.filePercent + '%' }" />
          </div>
        </div>
      </section>
    </div>

    <div v-if="victim" class="pa-lightbox pa-lightbox--dialog" @click.self="closeDelete">
      <div class="pa-card pa-delete-dialog" @click.stop>
        <p class="pa-title">删除项目</p>
        <div class="pa-sub">将永久删除「{{ victim.name }}」以及云端全部照片，无法恢复。</div>
        <el-input
          v-model="password"
          type="password"
          show-password
          autocomplete="current-password"
          placeholder="当前账号登录密码"
          :disabled="deleting"
          @keyup.enter="confirmDelete"
        />
        <div class="pa-lightbox-bar">
          <el-button :disabled="deleting" @click="closeDelete">取消</el-button>
          <el-button type="danger" :loading="deleting" @click="confirmDelete">确认删除</el-button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { auth } from '../../api/client.js'
import { deleteProject, hydrateFromCloud, listProjects } from '../lib/store.js'
import { summarizeListItem } from '../lib/audit.js'
import { markLeave, restoreIfPending } from '../lib/scroll-memory.js'
import '../preaudit.css'

const route = useRoute()
const router = useRouter()
const loading = ref(true)
const victim = ref(null)
const password = ref('')
const deleting = ref(false)
const rows = computed(() => listProjects().map((p) => summarizeListItem(p)))
const homeSections = computed(() => [
  { key: 'active', title: '进行中', items: rows.value.filter((item) => !item.done) },
  { key: 'done', title: '已完成', items: rows.value.filter((item) => item.done) }
])

onMounted(async () => {
  try {
    await hydrateFromCloud()
  } finally {
    loading.value = false
    nextTick(() => restoreIfPending(route.fullPath))
  }
})

const goNew = (org) => {
  router.push('/preaudit/new' + (org ? '?org=' + org : ''))
}

const openProject = (item) => {
  if (!item || !item.id) return
  markLeave(route.fullPath, item.id)
  router.push('/preaudit/' + item.id)
}

const remove = (item) => {
  if (!item || !item.id) return
  const user = auth.getUser()
  if (!user || !localStorage.getItem('admin_token')) {
    ElMessage.warning('删除整个项目需要先登录，再输入登录密码')
    return
  }
  victim.value = item
  password.value = ''
}

const closeDelete = () => {
  if (deleting.value) return
  victim.value = null
  password.value = ''
}

const confirmDelete = async () => {
  if (deleting.value || !victim.value) return
  const pwd = String(password.value || '').trim()
  if (!pwd) {
    ElMessage.warning('请输入密码')
    return
  }
  const id = victim.value.id
  deleting.value = true
  try {
    await deleteProject(id, pwd)
    ElMessage.success('项目已删除')
    victim.value = null
    password.value = ''
  } catch (e) {
    ElMessage.error((e && e.message) || '删除失败')
  } finally {
    deleting.value = false
  }
}
</script>
