<template>
  <el-card>
    <template #header>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">
        <span>弹窗广告</span>
        <el-button type="primary" :loading="saving" @click="onSave">保存配置</el-button>
      </div>
    </template>

    <el-form label-width="140px" style="max-width:720px">
      <el-form-item label="启用">
        <el-switch v-model="form.enabled" />
      </el-form-item>
      <el-form-item label="触发页面">
        <el-checkbox-group v-model="form.triggerPages">
          <el-checkbox :label="1">监控中心</el-checkbox>
          <el-checkbox :label="2">星舰进度</el-checkbox>
          <el-checkbox :label="3">事件/新闻</el-checkbox>
          <el-checkbox :label="4">我的</el-checkbox>
        </el-checkbox-group>
      </el-form-item>
      <el-form-item label="每日上限（每台设备）">
        <el-input-number v-model="form.dailyLimit" :min="1" :max="10" />
      </el-form-item>
      <el-form-item label="展示延迟(ms)">
        <el-input-number v-model="form.delayMs" :min="0" :max="10000" :step="100" />
      </el-form-item>
      <el-form-item label="展示模式">
        <el-radio-group v-model="form.displayMode">
          <el-radio label="random">随机</el-radio>
          <el-radio label="sequential">顺序</el-radio>
        </el-radio-group>
      </el-form-item>
      <el-form-item label="新用户保护(天)">
        <el-input-number v-model="form.newUserProtectDays" :min="0" :max="30" />
        <el-text type="info" style="margin-left:8px">0 不限制；N≥1 时：安装当日可弹，之后连续 N−1 个日历日不再弹</el-text>
      </el-form-item>
    </el-form>

    <el-divider />
    <div style="margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
      <span style="font-weight:600">选择小店商品（多选）</span>
      <el-button size="small" :loading="shopLoading" @click="loadShopList">刷新小店列表</el-button>
    </div>
    <el-alert
      type="info"
      :closable="false"
      show-icon
      style="margin-bottom:12px"
      title="仅展示已加载的 shop_feed；请先在「小店数据」中维护商品与 productId"
    />
    <div class="shop-grid" v-loading="shopLoading">
      <div
        v-for="row in shopList"
        :key="row._id"
        class="shop-tile"
        :class="{ selected: form.shopItemIds.includes(row._id) }"
        @click="toggleId(row._id)"
      >
        <el-image :src="row.coverFileID || ''" fit="cover" class="shop-img" />
        <div class="shop-meta">
          <div class="shop-title">{{ row.title || row._id }}</div>
          <el-tag size="small" :type="row.productId ? 'success' : 'warning'">
            {{ row.productId ? '已配 ID' : '缺 ID' }}
          </el-tag>
        </div>
      </div>
    </div>
    <el-empty v-if="!shopLoading && !shopList.length" description="暂无小店数据" />
  </el-card>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { api } from '../api/client'

const saving = ref(false)
const shopLoading = ref(false)
const shopList = ref([])

const form = reactive({
  enabled: false,
  triggerPages: [],
  dailyLimit: 1,
  delayMs: 1500,
  displayMode: 'random',
  newUserProtectDays: 0,
  shopItemIds: []
})

function normalizeConfig(c) {
  const src = c && typeof c === 'object' ? c : {}
  form.enabled = src.enabled !== false
  form.triggerPages = Array.isArray(src.triggerPages) ? src.triggerPages.map(Number) : []
  form.dailyLimit = Math.max(1, Math.min(10, Number(src.dailyLimit) || 1))
  form.delayMs = Math.max(0, Math.min(10000, Number(src.delayMs) || 1500))
  form.displayMode = src.displayMode === 'sequential' ? 'sequential' : 'random'
  form.newUserProtectDays = Math.max(0, Math.min(30, Number(src.newUserProtectDays) || 0))
  form.shopItemIds = Array.isArray(src.shopItemIds) ? [...src.shopItemIds] : []
}

async function load() {
  try {
    const res = await api.getPopupAdConfig()
    const cfg = (res && res.config) || res || {}
    normalizeConfig(cfg)
  } catch (e) {
    ElMessage.error(e.message || '加载失败')
  }
}

async function loadShopList() {
  shopLoading.value = true
  try {
    const res = await api.listShopFeed({ page: 1, pageSize: 100 })
    shopList.value = res.list || []
  } catch (e) {
    shopList.value = []
    ElMessage.error(e.message || '加载小店失败')
  } finally {
    shopLoading.value = false
  }
}

function toggleId(id) {
  if (!id) return
  const i = form.shopItemIds.indexOf(id)
  if (i >= 0) form.shopItemIds.splice(i, 1)
  else form.shopItemIds.push(id)
}

async function onSave() {
  saving.value = true
  try {
    await api.updatePopupAdConfig({
      enabled: form.enabled,
      triggerPages: form.triggerPages,
      dailyLimit: form.dailyLimit,
      delayMs: form.delayMs,
      displayMode: form.displayMode,
      newUserProtectDays: form.newUserProtectDays,
      shopItemIds: form.shopItemIds
    })
    ElMessage.success('已保存')
  } catch (e) {
    ElMessage.error(e.message || '保存失败')
  } finally {
    saving.value = false
  }
}

onMounted(() => {
  load()
  loadShopList()
})
</script>

<style scoped>
.shop-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 12px;
}
.shop-tile {
  border: 1px solid var(--el-border-color);
  border-radius: 8px;
  overflow: hidden;
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.shop-tile.selected {
  border-color: var(--el-color-primary);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--el-color-primary) 35%, transparent);
}
.shop-img {
  width: 100%;
  height: 120px;
  display: block;
  background: var(--el-fill-color-light);
}
.shop-meta {
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.shop-title {
  font-size: 13px;
  line-height: 1.35;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
</style>
