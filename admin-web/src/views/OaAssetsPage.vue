<template>
  <el-card>
    <template #header>
      <span>对标资产库（爆文 / 标题 / 账号 / 采集）</span>
    </template>

    <el-tabs v-model="tab" @tab-change="onTab">
      <el-tab-pane label="对标账号" name="accounts" />
      <el-tab-pane label="爆文库" name="viral" />
      <el-tab-pane label="低粉爆文" name="low" />
      <el-tab-pane label="标题库" name="titles" />
      <el-tab-pane label="采集入库" name="collected" />
    </el-tabs>

    <!-- accounts -->
    <template v-if="tab === 'accounts'">
      <el-alert
        type="info"
        :closable="false"
        style="margin-bottom:12px"
        title="插件半自动：微信打开对标号「历史消息」→ Chrome 打开该页 → 扩展点「采集最新 5 篇」→ 回到本页点「文章」洗稿进草稿箱。"
      />
      <div class="toolbar">
        <el-button type="primary" @click="openAccount()">新增账号</el-button>
      </div>
      <el-table :data="accounts" stripe v-loading="loading">
        <el-table-column prop="name" label="名称" min-width="140" />
        <el-table-column prop="biz" label="biz" min-width="140" show-overflow-tooltip />
        <el-table-column prop="fans" label="粉丝" width="100" />
        <el-table-column prop="notes" label="备注" min-width="160" show-overflow-tooltip />
        <el-table-column label="操作" width="260" align="right">
          <template #default="{ row }">
            <el-button size="small" type="primary" @click="openAccountArticles(row)">文章</el-button>
            <el-button size="small" @click="openAccount(row)">编辑</el-button>
            <el-button size="small" type="danger" @click="delAccount(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </template>

    <!-- viral / low -->
    <template v-else-if="tab === 'viral' || tab === 'low'">
      <div class="toolbar">
        <el-button type="primary" @click="openViral()">录入爆文</el-button>
      </div>
      <el-table :data="viral" stripe v-loading="loading">
        <el-table-column prop="title" label="标题" min-width="220" />
        <el-table-column prop="accountName" label="账号" width="120" />
        <el-table-column prop="fans" label="粉丝" width="90" />
        <el-table-column prop="reads" label="阅读" width="90" />
        <el-table-column label="低粉爆" width="90">
          <template #default="{ row }">
            <el-tag v-if="row.isLowFollower" type="warning" size="small">是</el-tag>
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="200">
          <template #default="{ row }">
            <el-button size="small" :loading="rewriteId === row._id" @click="rewriteFromViral(row)">洗稿生成</el-button>
            <el-button size="small" type="danger" @click="delViral(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </template>

    <!-- titles -->
    <template v-else-if="tab === 'titles'">
      <div class="toolbar">
        <el-input v-model="titleInput" placeholder="输入标题做 AI 拆解" style="width:320px" />
        <el-button type="primary" :loading="analyzing" @click="onAnalyze">AI 标题拆解</el-button>
        <el-input v-model="titleTopic" placeholder="主题批量生成标题" style="width:220px" />
        <el-button :loading="genTitles" @click="onGenTitles">批量生成</el-button>
      </div>
      <el-alert v-if="analysis" type="success" :closable="true" style="margin-bottom:12px" @close="analysis=null">
        <pre style="white-space:pre-wrap;margin:0;font-size:12px">{{ JSON.stringify(analysis, null, 2) }}</pre>
      </el-alert>
      <el-table :data="titles" stripe v-loading="loading">
        <el-table-column prop="title" label="标题" min-width="260" />
        <el-table-column prop="source" label="来源" width="100" />
        <el-table-column prop="reads" label="阅读" width="90" />
        <el-table-column label="操作" width="120">
          <template #default="{ row }">
            <el-button size="small" type="danger" @click="delTitle(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </template>

    <!-- collected -->
    <template v-else>
      <el-alert
        type="info"
        :closable="false"
        style="margin-bottom:12px"
        title="使用 tools/oa-collector-extension：历史消息页采最新 5 篇，或文章页采单篇。需配置 OA_COLLECTOR_TOKEN。"
      />
      <el-table :data="collected" stripe v-loading="loading">
        <el-table-column prop="title" label="标题" min-width="200" />
        <el-table-column label="配图" min-width="220">
          <template #default="{ row }">
            <div v-if="collectedImages(row).length" class="asset-thumbs">
              <el-image
                v-for="(url, i) in collectedImages(row)"
                :key="`${row._id}-${i}`"
                :src="thumbSrc(url)"
                :preview-src-list="collectedImages(row).map(thumbSrc)"
                :initial-index="i"
                fit="cover"
                class="asset-thumb"
                preview-teleported
                hide-on-click-modal
              />
            </div>
            <span v-else class="muted">无图</span>
          </template>
        </el-table-column>
        <el-table-column prop="accountName" label="账号" width="120" />
        <el-table-column prop="reads" label="阅读" width="90" />
        <el-table-column prop="sourceUrl" label="链接" min-width="160" show-overflow-tooltip />
        <el-table-column label="操作" width="200">
          <template #default="{ row }">
            <el-button size="small" :loading="rewriteId === row._id" @click="rewriteFromCollected(row)">洗稿生成</el-button>
            <el-button size="small" type="danger" @click="delCollected(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </template>

    <el-dialog v-model="accVisible" title="对标账号" width="480px">
      <el-form :model="accForm" label-width="80px">
        <el-form-item label="名称"><el-input v-model="accForm.name" placeholder="如 SpaceX时光机" /></el-form-item>
        <el-form-item label="biz"><el-input v-model="accForm.biz" placeholder="可选，插件采文后会自动回填" /></el-form-item>
        <el-form-item label="粉丝"><el-input-number v-model="accForm.fans" :min="0" /></el-form-item>
        <el-form-item label="备注"><el-input v-model="accForm.notes" type="textarea" :rows="2" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="accVisible=false">取消</el-button>
        <el-button type="primary" @click="saveAccount">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="viralVisible" title="录入爆文" width="560px">
      <el-form :model="viralForm" label-width="80px">
        <el-form-item label="标题"><el-input v-model="viralForm.title" /></el-form-item>
        <el-form-item label="链接"><el-input v-model="viralForm.url" /></el-form-item>
        <el-form-item label="账号"><el-input v-model="viralForm.accountName" /></el-form-item>
        <el-form-item label="粉丝"><el-input-number v-model="viralForm.fans" :min="0" /></el-form-item>
        <el-form-item label="阅读"><el-input-number v-model="viralForm.reads" :min="0" /></el-form-item>
        <el-form-item label="正文"><el-input v-model="viralForm.content" type="textarea" :rows="6" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="viralVisible=false">取消</el-button>
        <el-button type="primary" @click="saveViral">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="washVisible" title="选择发稿号" width="420px" append-to-body>
      <p style="margin:0 0 12px;color:var(--el-text-color-secondary);font-size:13px;">
        洗稿将按所选发稿号的人设与凭证槽生成草稿，请确认后再继续。
      </p>
      <el-radio-group v-model="washBrandKey" class="wash-brands">
        <el-radio
          v-for="b in washBrands"
          :key="b.key"
          :value="b.key"
          border
          style="margin:0 8px 8px 0"
        >
          {{ b.name }}
          <el-text size="small" type="info">（槽 {{ b.credentialSlot || '1' }}）</el-text>
        </el-radio>
      </el-radio-group>
      <template #footer>
        <el-button @click="washVisible = false">取消</el-button>
        <el-button type="primary" :loading="!!rewriteId" @click="confirmWash">开始洗稿</el-button>
      </template>
    </el-dialog>

    <el-drawer
      v-model="artVisible"
      :title="(artAccount?.name || '对标账号') + ' · 已采文章'"
      size="640px"
      destroy-on-close
    >
      <el-alert
        type="info"
        :closable="false"
        style="margin-bottom:12px"
        title="列表来自插件采集。点「洗稿」会生成草稿到草稿箱队列。"
      />
      <el-table :data="artList" stripe v-loading="artLoading" max-height="70vh">
        <el-table-column prop="title" label="标题" min-width="160" show-overflow-tooltip />
        <el-table-column label="配图" min-width="180">
          <template #default="{ row }">
            <div v-if="collectedImages(row).length" class="asset-thumbs">
              <el-image
                v-for="(url, i) in collectedImages(row)"
                :key="`${row._id}-d-${i}`"
                :src="thumbSrc(url)"
                :preview-src-list="collectedImages(row).map(thumbSrc)"
                :initial-index="i"
                fit="cover"
                class="asset-thumb"
                preview-teleported
                hide-on-click-modal
              />
            </div>
            <span v-else class="muted">无图</span>
          </template>
        </el-table-column>
        <el-table-column prop="reads" label="阅读" width="72" />
        <el-table-column label="正文" width="72" align="center">
          <template #default="{ row }">
            <el-tag v-if="row.content" size="small" type="success">有</el-tag>
            <el-tag v-else size="small" type="info">无</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="160" align="right">
          <template #default="{ row }">
            <el-button
              size="small"
              type="primary"
              :disabled="!row.content && !row.title"
              :loading="rewriteId === row._id"
              @click="rewriteFromCollected(row)"
            >洗稿</el-button>
            <el-button size="small" type="danger" text @click="onDelCollectedInDrawer(row)">删</el-button>
          </template>
        </el-table-column>
      </el-table>
      <div v-if="!artLoading && !artList.length" class="empty-tip">
        暂无文章。请用插件在该号「历史消息」页采集最新 5 篇。
      </div>
    </el-drawer>
  </el-card>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from '../api/client'
import { displayOaImage, warmOaImageList, hotlinkSafeImageUrl } from '../utils/oaImageProxy'

const tab = ref('accounts')
const loading = ref(false)
const proxyMap = reactive({})
const thumbSrc = (url) => displayOaImage(url, proxyMap)
const accounts = ref([])
const viral = ref([])
const titles = ref([])
const collected = ref([])
const titleInput = ref('')
const titleTopic = ref('')
const analysis = ref(null)
const analyzing = ref(false)
const genTitles = ref(false)
const rewriteId = ref('')
const washVisible = ref(false)
const washBrandKey = ref('')
const washBrands = ref([])
const washPending = ref(null) // { kind: 'viral'|'collected', row }

const accVisible = ref(false)
const accEditing = ref(null)
const accForm = reactive({ name: '', biz: '', fans: 0, notes: '' })

const viralVisible = ref(false)
const viralForm = reactive({ title: '', url: '', accountName: '', fans: 0, reads: 0, content: '' })

const artVisible = ref(false)
const artLoading = ref(false)
const artAccount = ref(null)
const artList = ref([])

const collectedImages = (row) => {
  const out = []
  const seen = new Set()
  const push = (u) => {
    const s = String(u || '').trim()
    if (!s || seen.has(s)) return
    seen.add(s)
    out.push(s)
  }
  push(row?.coverUrl)
  if (Array.isArray(row?.images)) row.images.forEach(push)
  if (Array.isArray(row?.imageUrls)) row.imageUrls.forEach(push)
  return out
}

const load = async () => {
  loading.value = true
  try {
    if (tab.value === 'accounts') {
      const res = await api.listOaAccounts({ pageSize: 100 })
      accounts.value = res?.list || []
    } else if (tab.value === 'viral') {
      const res = await api.listOaViral({ pageSize: 50 })
      viral.value = res?.list || []
    } else if (tab.value === 'low') {
      const res = await api.listOaViral({ pageSize: 50, lowFollower: 'true' })
      viral.value = res?.list || []
    } else if (tab.value === 'titles') {
      const res = await api.listOaTitles({ pageSize: 50 })
      titles.value = res?.list || []
    } else {
      const res = await api.listOaCollected({ pageSize: 50 })
      collected.value = res?.list || []
      const urls = []
      for (const row of collected.value) urls.push(...collectedImages(row))
      warmOaImageList(urls, proxyMap).catch(() => null)
    }
  } catch (e) {
    ElMessage.error(e.message || '加载失败')
  } finally {
    loading.value = false
  }
}

const onTab = () => load()

const openAccount = (row) => {
  accEditing.value = row || null
  Object.assign(accForm, {
    name: row?.name || '',
    biz: row?.biz || '',
    fans: row?.fans || 0,
    notes: row?.notes || ''
  })
  accVisible.value = true
}

const saveAccount = async () => {
  try {
    if (accEditing.value) await api.updateOaAccount(accEditing.value._id, { ...accForm })
    else await api.createOaAccount({ ...accForm })
    accVisible.value = false
    load()
  } catch (e) {
    ElMessage.error(e.message || '保存失败')
  }
}

const delAccount = async (row) => {
  try {
    await ElMessageBox.confirm('删除账号？', '提示', { type: 'warning' })
    await api.deleteOaAccount(row._id)
    load()
  } catch (e) {
    if (e !== 'cancel') ElMessage.error(e.message || '删除失败')
  }
}

const loadAccountArticles = async () => {
  if (!artAccount.value?._id) return
  artLoading.value = true
  try {
    const res = await api.listOaAccountArticles(artAccount.value._id, { pageSize: 50 })
    artAccount.value = res?.account || artAccount.value
    artList.value = res?.list || []
    const urls = []
    for (const row of artList.value) urls.push(...collectedImages(row))
    warmOaImageList(urls, proxyMap).catch(() => null)
  } catch (e) {
    ElMessage.error(e.message || '加载文章失败')
  } finally {
    artLoading.value = false
  }
}

const openAccountArticles = async (row) => {
  artAccount.value = row
  artVisible.value = true
  await loadAccountArticles()
}

const openViral = () => {
  Object.assign(viralForm, { title: '', url: '', accountName: '', fans: 0, reads: 0, content: '' })
  viralVisible.value = true
}

const saveViral = async () => {
  try {
    await api.upsertOaViral({ ...viralForm })
    viralVisible.value = false
    load()
  } catch (e) {
    ElMessage.error(e.message || '保存失败')
  }
}

const delViral = async (row) => {
  try {
    await ElMessageBox.confirm('删除？', '提示', { type: 'warning' })
    await api.deleteOaViral(row._id)
    load()
  } catch (e) {
    if (e !== 'cancel') ElMessage.error(e.message || '删除失败')
  }
}

const pickWashStrategy = (brandKey, fallback) => {
  if (brandKey === 'mars_space') return 'space_story'
  if (brandKey === 'mars_log') return fallback === 'news_digest' ? 'news_digest' : 'deep_recap'
  return fallback
}

const ensureWashBrands = async () => {
  if (washBrands.value.length) return washBrands.value
  try {
    const cfg = await api.getOaContentConfig()
    washBrands.value = (cfg?.brands || []).filter((b) => b && b.enabled !== false)
  } catch (e) {
    washBrands.value = [
      { key: 'mars_log', name: '火星探索日志', credentialSlot: '1' },
      { key: 'mars_space', name: '火星空间探索', credentialSlot: '2' }
    ]
  }
  return washBrands.value
}

const openWashPicker = async (kind, row) => {
  const brands = await ensureWashBrands()
  if (!brands.length) {
    ElMessage.warning('暂无启用的发稿号，请先到发稿设置配置')
    return
  }
  washPending.value = { kind, row }
  const last = localStorage.getItem('oa_content_brand_key') || ''
  washBrandKey.value = brands.some((b) => b.key === last) ? last : brands[0].key
  washVisible.value = true
}

const confirmWash = async () => {
  const pending = washPending.value
  const brandKey = washBrandKey.value
  if (!pending?.row || !brandKey) {
    ElMessage.warning('请选择发稿号')
    return
  }
  const row = pending.row
  const strategyFallback = pending.kind === 'viral' ? 'deep_recap' : 'news_digest'
  rewriteId.value = row._id
  try {
    localStorage.setItem('oa_content_brand_key', brandKey)
    const safeImgs = (row.images || row.imageUrls || [])
      .map((u) => hotlinkSafeImageUrl(u) || u)
      .filter(Boolean)
    const res = await api.generateOaContent({
      strategyKey: pickWashStrategy(brandKey, strategyFallback),
      brandKey,
      topic: {
        sourceType: pending.kind === 'viral' ? 'viral' : 'collected',
        sourceId: row._id,
        title: row.title,
        body: row.content || row.title,
        sourceUrl: row.url || row.sourceUrl,
        coverUrl: hotlinkSafeImageUrl(row.coverUrl) || row.coverUrl,
        imageUrls: safeImgs,
        images: safeImgs
      }
    })
    const name = washBrands.value.find((b) => b.key === brandKey)?.name || brandKey
    const first = Array.isArray(res?.results) ? res.results[0] : res
    if (first && first.status === 'needs_review') {
      // AI 生成失败走了素材整理稿：必须把原因亮出来，否则只看到「需改写」
      ElMessage({
        type: 'warning',
        duration: 12000,
        showClose: true,
        message: `AI 生成失败，已写入素材整理稿（需人工改写）。原因：${first.llmError || '未知'}`
      })
    } else {
      ElMessage.success(`已生成到草稿箱（${name}），配图可能仍在后台转存`)
    }
    washVisible.value = false
    washPending.value = null
  } catch (e) {
    const msg = String((e && e.message) || e || '')
    if (/Failed to fetch|NetworkError|network|fetch|timeout|超时/i.test(msg)) {
      ElMessage.warning(
        '请求超时（洗稿较慢）。请到「草稿箱」刷新查看：若已有新稿则实际已成功；否则请重试。'
      )
    } else {
      ElMessage.error(msg || '生成失败')
    }
  } finally {
    rewriteId.value = ''
  }
}

const rewriteFromViral = (row) => openWashPicker('viral', row)

const onAnalyze = async () => {
  if (!titleInput.value.trim()) return
  analyzing.value = true
  try {
    analysis.value = await api.analyzeOaTitle({ title: titleInput.value })
    load()
  } catch (e) {
    ElMessage.error(e.message || '拆解失败')
  } finally {
    analyzing.value = false
  }
}

const onGenTitles = async () => {
  genTitles.value = true
  try {
    const res = await api.generateOaTitles({ topic: titleTopic.value || '航天资讯' })
    ElMessage.success(`生成 ${(res?.titles || []).length} 条`)
    load()
  } catch (e) {
    ElMessage.error(e.message || '生成失败')
  } finally {
    genTitles.value = false
  }
}

const delTitle = async (row) => {
  try {
    await api.deleteOaTitle(row._id)
    load()
  } catch (e) {
    ElMessage.error(e.message || '删除失败')
  }
}

const rewriteFromCollected = (row) => openWashPicker('collected', row)

const delCollected = async (row) => {
  try {
    await ElMessageBox.confirm('删除该采集？', '提示', { type: 'warning' })
    await api.deleteOaCollected(row._id)
    if (tab.value === 'collected') load()
    return true
  } catch (e) {
    if (e !== 'cancel') ElMessage.error(e.message || '删除失败')
    return false
  }
}

const onDelCollectedInDrawer = async (row) => {
  if (await delCollected(row)) await loadAccountArticles()
}

onMounted(load)
</script>

<style scoped>
.toolbar { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:12px; align-items:center; }
.empty-tip { margin-top: 24px; text-align: center; color: var(--el-text-color-secondary); font-size: 13px; }
.asset-thumbs { display:flex; flex-wrap:wrap; gap:4px; max-width:220px; }
.asset-thumb {
  width: 48px;
  height: 36px;
  border-radius: 4px;
  background: rgba(255,255,255,0.04);
  cursor: zoom-in;
}
.muted { color: var(--el-text-color-placeholder); font-size: 12px; }
</style>
