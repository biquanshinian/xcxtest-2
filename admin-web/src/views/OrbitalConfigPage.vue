<template>
  <div class="orbital-config">
    <div class="page-header">
      <div>
        <div class="page-title">太空轨道数据中心</div>
        <div class="page-subtitle">管理小程序「监控中心 → 太空轨道数据中心」入口卡片与详情页全部内容</div>
      </div>
      <div class="page-actions">
        <el-button :loading="loading" @click="load">刷新</el-button>
        <el-button @click="resetToDefaults" :disabled="loading || saving">恢复默认</el-button>
        <el-button type="primary" :loading="saving" size="large" @click="onSave">保存配置</el-button>
      </div>
    </div>

    <el-tabs v-model="activeTab" class="orbital-tabs">
      <!-- =================== Tab 1: 卡片入口 =================== -->
      <el-tab-pane label="入口卡片" name="card">
        <el-card class="section-card" shadow="never">
          <template #header>
            <div class="section-header">
              <span class="section-title">监控页入口卡片</span>
              <span class="section-hint">小程序「监控中心」分组里的卡片，点击进入详情页</span>
            </div>
          </template>

          <el-form :model="form.card" label-width="120px" label-position="left">
            <el-form-item label="是否启用">
              <el-switch v-model="form.card.enabled" inline-prompt active-text="显示" inactive-text="隐藏" />
              <span class="form-hint">关闭后小程序里整个卡片消失</span>
            </el-form-item>

            <el-form-item label="顶部小标签">
              <el-input v-model="form.card.badge" placeholder="例如：FUTURE TECH · BETA" maxlength="40" show-word-limit />
            </el-form-item>

            <el-form-item label="版本号（隐藏）">
              <el-input v-model="form.card.version" placeholder="v0.1.0（目前不展示，但保留以备后用）" />
            </el-form-item>

            <el-form-item label="英文标题">
              <el-input v-model="form.card.titleEn" placeholder="Orbital Data Center System" maxlength="60" show-word-limit />
            </el-form-item>

            <el-form-item label="中文标题">
              <el-input v-model="form.card.titleCn" placeholder="太空轨道数据中心系统" maxlength="40" show-word-limit />
            </el-form-item>

            <el-form-item label="副标题描述">
              <el-input v-model="form.card.desc" placeholder="超前部署 · 应对 SpaceX 下一代轨道战略" maxlength="80" show-word-limit />
            </el-form-item>

            <el-form-item label="CTA 按钮文字">
              <el-input v-model="form.card.ctaText" placeholder="进入指挥控制台" maxlength="20" show-word-limit />
            </el-form-item>

            <el-form-item label="背景图片 / 视频">
              <div class="bg-uploader">
                <div v-if="form.card.bgImage" class="bg-preview">
                  <video v-if="isVideoUrl(form.card.bgImage)" :src="form.card.bgImage" class="bg-preview-media" muted playsinline loop autoplay />
                  <img v-else :src="form.card.bgImage" alt="背景图" @error="onBgPreviewError" />
                  <div class="bg-preview-overlay">
                    <el-button size="small" @click="form.card.bgImage = ''">移除</el-button>
                  </div>
                </div>
                <el-upload
                  class="bg-upload-trigger"
                  :show-file-list="false"
                  :before-upload="handleCardBgUpload"
                  accept="image/jpeg,image/png,image/webp,video/mp4,.mp4"
                >
                  <el-button :loading="bgUploading" type="primary" plain>
                    {{ form.card.bgImage ? '更换背景' : '上传背景图或 MP4' }}
                  </el-button>
                </el-upload>
                <div class="form-hint" style="margin-top: 8px;">
                  建议尺寸 750×320 以上；支持 jpg / png / webp / mp4（mp4 ≤24MB），自动上传到 COS。<br/>
                  也可直接粘贴 URL：
                </div>
                <el-input v-model="form.card.bgImage" placeholder="https://...（图片或 .mp4）" style="margin-top: 6px;" clearable />
              </div>
            </el-form-item>

            <el-form-item label="指标 1：在轨节点">
              <el-input v-model="form.card.metrics.activeNodes" placeholder="128" />
            </el-form-item>
            <el-form-item label="指标 2：数据吞吐">
              <el-input v-model="form.card.metrics.bandwidth" placeholder="4.8 Tbps" />
            </el-form-item>
            <el-form-item label="指标 3：系统在线">
              <el-input v-model="form.card.metrics.uptime" placeholder="99.97%" />
            </el-form-item>
          </el-form>
        </el-card>
      </el-tab-pane>

      <!-- =================== Tab 2: 详情页 HUD =================== -->
      <el-tab-pane label="详情页 HUD" name="hud">
        <el-card class="section-card" shadow="never">
          <template #header>
            <div class="section-header">
              <span class="section-title">详情页顶部 HUD</span>
              <span class="section-hint">导航栏下方的品牌区与状态指示</span>
            </div>
          </template>

          <el-form :model="form.detail" label-width="120px" label-position="left">
            <el-form-item label="详情页背景视频">
              <div class="bg-uploader">
                <div v-if="form.detail.bgVideo" class="bg-preview">
                  <video v-if="isVideoUrl(form.detail.bgVideo)" :src="form.detail.bgVideo" class="bg-preview-media" muted playsinline loop autoplay />
                  <div v-else class="bg-preview-fallback">请使用 .mp4 地址</div>
                  <div class="bg-preview-overlay">
                    <el-button size="small" @click="form.detail.bgVideo = ''">移除</el-button>
                  </div>
                </div>
                <el-upload
                  class="bg-upload-trigger"
                  :show-file-list="false"
                  :before-upload="handleDetailBgUpload"
                  accept="video/mp4,.mp4"
                >
                  <el-button :loading="detailBgUploading" type="primary" plain>
                    {{ form.detail.bgVideo ? '更换背景视频' : '上传 MP4 到 COS' }}
                  </el-button>
                </el-upload>
                <div class="form-hint" style="margin-top: 8px;">
                  详情页全屏循环背景，仅建议 mp4（H.264，≤24MB）；留空则小程序使用内置默认素材。<br/>
                  也可直接粘贴 COS / CDN 的 https 地址：
                </div>
                <el-input v-model="form.detail.bgVideo" placeholder="https://...*.mp4" style="margin-top: 6px;" clearable />
              </div>
            </el-form-item>

            <el-form-item label="HUD 主标题">
              <el-input v-model="form.detail.hudTitle" placeholder="SYS-ODC // CONSOLE" />
            </el-form-item>
            <el-form-item label="HUD 副标题">
              <el-input v-model="form.detail.hudSub" placeholder="v0.1.0 · UNCLASSIFIED" />
            </el-form-item>
            <el-form-item label="状态文字">
              <el-input v-model="form.detail.statusText" placeholder="ONLINE" maxlength="16" show-word-limit />
            </el-form-item>
          </el-form>
        </el-card>

        <el-card class="section-card" shadow="never">
          <template #header>
            <div class="section-header">
              <span class="section-title">滚动 Ticker</span>
              <span class="section-hint">HUD 下方滚动展示的命令行风格文字（每条 2.4 秒切换）</span>
            </div>
          </template>

          <div v-for="(line, i) in form.detail.tickerLines" :key="i" class="row-item">
            <el-input v-model="form.detail.tickerLines[i]" placeholder="> 例如：SYS_INIT // 接入 Starlink" />
            <el-button type="danger" plain :icon="DeleteIcon" @click="form.detail.tickerLines.splice(i, 1)" />
          </div>
          <el-button @click="form.detail.tickerLines.push('> ')" :icon="PlusIcon" plain>添加一行</el-button>
        </el-card>
      </el-tab-pane>

      <!-- =================== Tab 3: 核心指标 =================== -->
      <el-tab-pane label="核心指标矩阵" name="metrics">
        <el-card class="section-card" shadow="never">
          <template #header>
            <div class="section-header">
              <span class="section-title">CORE METRICS · 6 卡片</span>
              <span class="section-hint">详情页第一屏指标网格</span>
            </div>
          </template>

          <el-table :data="form.detail.coreMetrics" border stripe>
            <el-table-column label="标签" min-width="140">
              <template #default="{ row }">
                <el-input v-model="row.label" placeholder="ACTIVE NODES" />
              </template>
            </el-table-column>
            <el-table-column label="数值" min-width="100">
              <template #default="{ row }">
                <el-input v-model="row.value" placeholder="128" />
              </template>
            </el-table-column>
            <el-table-column label="单位" min-width="100">
              <template #default="{ row }">
                <el-input v-model="row.unit" placeholder="satellites" />
              </template>
            </el-table-column>
            <el-table-column label="百分比 0-100" width="120">
              <template #default="{ row }">
                <el-input-number v-model="row.percent" :min="0" :max="100" :precision="2" controls-position="right" style="width: 100%" />
              </template>
            </el-table-column>
            <el-table-column label="趋势" width="120">
              <template #default="{ row }">
                <el-select v-model="row.trend" style="width: 100%">
                  <el-option label="上升 ↑" value="up" />
                  <el-option label="下降 ↓" value="down" />
                  <el-option label="持平 ~" value="flat" />
                </el-select>
              </template>
            </el-table-column>
            <el-table-column label="变化值" width="100">
              <template #default="{ row }">
                <el-input v-model="row.delta" placeholder="+12" />
              </template>
            </el-table-column>
            <el-table-column label="操作" width="80" align="center">
              <template #default="{ $index }">
                <el-button type="danger" plain size="small" :icon="DeleteIcon" @click="form.detail.coreMetrics.splice($index, 1)" />
              </template>
            </el-table-column>
          </el-table>
          <el-button @click="addCoreMetric" :icon="PlusIcon" plain style="margin-top: 12px;">添加一个指标</el-button>
        </el-card>
      </el-tab-pane>

      <!-- =================== Tab 4: 在轨节点 =================== -->
      <el-tab-pane label="在轨节点" name="nodes">
        <el-card class="section-card" shadow="never">
          <template #header>
            <div class="section-header">
              <span class="section-title">ORBITAL NODES · 节点列表</span>
              <span class="section-hint">详情页第二屏节点遥测列表</span>
            </div>
          </template>

          <el-table :data="form.detail.nodeList" border stripe>
            <el-table-column label="节点编号" min-width="180">
              <template #default="{ row }">
                <el-input v-model="row.code" placeholder="STARLINK-V2 #4421" />
              </template>
            </el-table-column>
            <el-table-column label="类型" min-width="140">
              <template #default="{ row }">
                <el-input v-model="row.type" placeholder="LEO RELAY" />
              </template>
            </el-table-column>
            <el-table-column label="轨道" min-width="140">
              <template #default="{ row }">
                <el-input v-model="row.orbit" placeholder="550 km · 53°" />
              </template>
            </el-table-column>
            <el-table-column label="上行" width="120">
              <template #default="{ row }">
                <el-input v-model="row.uplink" placeholder="92.4 Gbps" />
              </template>
            </el-table-column>
            <el-table-column label="延迟" width="100">
              <template #default="{ row }">
                <el-input v-model="row.latency" placeholder="18 ms" />
              </template>
            </el-table-column>
            <el-table-column label="状态" width="120">
              <template #default="{ row }">
                <el-select v-model="row.status" style="width: 100%">
                  <el-option label="在线" value="online" />
                  <el-option label="警告" value="warn" />
                  <el-option label="离线" value="offline" />
                </el-select>
              </template>
            </el-table-column>
            <el-table-column label="状态文字" min-width="160">
              <template #default="{ row }">
                <el-input v-model="row.statusText" placeholder="NOMINAL" />
              </template>
            </el-table-column>
            <el-table-column label="操作" width="80" align="center" fixed="right">
              <template #default="{ $index }">
                <el-button type="danger" plain size="small" :icon="DeleteIcon" @click="form.detail.nodeList.splice($index, 1)" />
              </template>
            </el-table-column>
          </el-table>
          <el-button @click="addNode" :icon="PlusIcon" plain style="margin-top: 12px;">添加一个节点</el-button>
        </el-card>
      </el-tab-pane>

      <!-- =================== Tab 5: 任务时间线 =================== -->
      <el-tab-pane label="任务时间线" name="missions">
        <el-card class="section-card" shadow="never">
          <template #header>
            <div class="section-header">
              <span class="section-title">MISSION TIMELINE · 任务清单</span>
              <span class="section-hint">详情页第四屏的项目阶段时间线</span>
            </div>
          </template>

          <el-table :data="form.detail.missionList" border stripe>
            <el-table-column label="标题" min-width="220">
              <template #default="{ row }">
                <el-input v-model="row.title" placeholder="Phase I · 全球地面网格接入" />
              </template>
            </el-table-column>
            <el-table-column label="日期" width="120">
              <template #default="{ row }">
                <el-input v-model="row.date" placeholder="2026 Q2" />
              </template>
            </el-table-column>
            <el-table-column label="状态" width="120">
              <template #default="{ row }">
                <el-select v-model="row.status" style="width: 100%">
                  <el-option label="已完成 done" value="done" />
                  <el-option label="进行中 active" value="active" />
                  <el-option label="待启动 pending" value="pending" />
                  <el-option label="预测 forecast" value="forecast" />
                </el-select>
              </template>
            </el-table-column>
            <el-table-column label="状态文字" width="140">
              <template #default="{ row }">
                <el-input v-model="row.statusText" placeholder="IN PROGRESS" />
              </template>
            </el-table-column>
            <el-table-column label="描述" min-width="280">
              <template #default="{ row }">
                <el-input v-model="row.desc" type="textarea" :rows="2" placeholder="对接全球 36 处 Starlink 网关地面站..." />
              </template>
            </el-table-column>
            <el-table-column label="操作" width="80" align="center" fixed="right">
              <template #default="{ $index }">
                <el-button type="danger" plain size="small" :icon="DeleteIcon" @click="form.detail.missionList.splice($index, 1)" />
              </template>
            </el-table-column>
          </el-table>
          <el-button @click="addMission" :icon="PlusIcon" plain style="margin-top: 12px;">添加一个阶段</el-button>
        </el-card>
      </el-tab-pane>

      <!-- =================== Tab 6: 项目简报 =================== -->
      <el-tab-pane label="项目简报" name="brief">
        <el-card class="section-card" shadow="never">
          <template #header>
            <div class="section-header">
              <span class="section-title">PROJECT BRIEF · 文案段落</span>
              <span class="section-hint">详情页底部说明，每行作为独立段落显示。以 // 开头的行会显示成等宽蓝色高亮。</span>
            </div>
          </template>

          <div v-for="(line, i) in form.detail.briefLines" :key="i" class="row-item">
            <el-input v-model="form.detail.briefLines[i]" type="textarea" :rows="2" placeholder="一段简报文字..." />
            <el-button type="danger" plain :icon="DeleteIcon" @click="form.detail.briefLines.splice(i, 1)" />
          </div>
          <el-button @click="form.detail.briefLines.push('')" :icon="PlusIcon" plain>添加一段</el-button>
        </el-card>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Delete as DeleteIcon, Plus as PlusIcon } from '@element-plus/icons-vue'
import { api } from '../api/client'

const activeTab = ref('card')
const loading = ref(false)
const saving = ref(false)
const bgUploading = ref(false)
const detailBgUploading = ref(false)

function isVideoUrl(u) {
  if (!u || typeof u !== 'string') return false
  return /\.(mp4|mov|m4v|webm|mkv)(\?|#|$)/i.test(u.trim().split('#')[0])
}

// 表单默认值（与云函数 ORBITAL_DEFAULT 保持一致）
const buildDefault = () => ({
  card: {
    enabled: true,
    badge: 'FUTURE TECH · BETA',
    version: 'v0.1.0',
    titleEn: 'Orbital Data Center System',
    titleCn: '太空轨道数据中心系统',
    desc: '超前部署 · 应对 SpaceX 下一代轨道战略',
    bgImage: 'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/%E8%83%8C%E6%99%AF%E8%A7%86%E9%A2%91/1784884993160_b2tlgu.mp4',
    ctaText: '进入指挥控制台',
    metrics: { activeNodes: '128', bandwidth: '4.8 Tbps', uptime: '99.97%' }
  },
  detail: {
    bgVideo: 'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/%E8%83%8C%E6%99%AF%E8%A7%86%E9%A2%91/1784888337241_ma680s.mp4',
    hudTitle: 'SYS-ODC // CONSOLE',
    hudSub: 'v0.1.0 · UNCLASSIFIED',
    statusText: 'ONLINE',
    tickerLines: [],
    coreMetrics: [],
    nodeList: [],
    missionList: [],
    briefLines: []
  }
})

const form = reactive(buildDefault())

const onBgPreviewError = () => {
  ElMessage.warning('背景图加载失败，请检查 URL 是否可访问')
}

const load = async () => {
  loading.value = true
  try {
    const data = await api.getOrbitalConfig()
    if (data && data.card) {
      Object.assign(form.card, data.card)
      if (data.card.metrics) Object.assign(form.card.metrics, data.card.metrics)
    }
    if (data && data.detail) {
      Object.assign(form.detail, data.detail)
    }
  } catch (e) {
    ElMessage.error('加载失败：' + (e && e.message ? e.message : e))
  } finally {
    loading.value = false
  }
}

const onSave = async () => {
  saving.value = true
  try {
    await api.updateOrbitalConfig({
      card: form.card,
      detail: form.detail
    })
    ElMessage.success('已保存，小程序刷新即可看到最新内容')
  } catch (e) {
    ElMessage.error('保存失败：' + (e && e.message ? e.message : e))
  } finally {
    saving.value = false
  }
}

const resetToDefaults = async () => {
  try {
    await ElMessageBox.confirm('恢复默认会清空当前所有自定义内容（不会立即保存，需点保存配置才生效），确认继续？', '确认操作', { type: 'warning' })
    Object.assign(form, buildDefault())
    ElMessage.success('已恢复默认值，记得点「保存配置」')
  } catch (e) { /* user cancel */ }
}

const addCoreMetric = () => {
  form.detail.coreMetrics.push({ label: 'NEW METRIC', value: '0', unit: '', percent: 50, trend: 'flat', delta: '0' })
}

const addNode = () => {
  form.detail.nodeList.push({ code: 'NEW NODE', type: 'LEO RELAY', orbit: '550 km · 53°', uplink: '0 Gbps', latency: '0 ms', status: 'online', statusText: 'NOMINAL' })
}

const addMission = () => {
  form.detail.missionList.push({ title: '新阶段', date: '2026 Q4', status: 'pending', statusText: 'QUEUED', desc: '阶段说明...' })
}

// ========= 入口卡片：背景图或 mp4 =========
const handleCardBgUpload = async (file) => {
  const isImage = /^image\//.test(file.type)
  const isMp4 = file.type === 'video/mp4' || /\.mp4$/i.test(file.name || '')
  if (!isImage && !isMp4) {
    ElMessage.error('仅支持图片（jpg/png/webp）或 mp4 视频')
    return false
  }
  if (isImage && file.size > 6 * 1024 * 1024) {
    ElMessage.error('图片不能超过 6MB（与 COS 代理上限一致）')
    return false
  }
  if (isMp4 && file.size > 24 * 1024 * 1024) {
    ElMessage.error('mp4 不能超过 24MB，请压缩后重试')
    return false
  }
  bgUploading.value = true
  try {
    const base64Data = await fileToBase64(file)
    const safeName = file.name.replace(/[^\w.\-]/g, '_')
    const result = await api.cosProxyUpload({
      key: `orbital-data-center/${Date.now()}_${safeName}`,
      base64Data,
      contentType: file.type || (isMp4 ? 'video/mp4' : 'application/octet-stream')
    })
    const url = result && (result.cosUrl || result.url || result.publicUrl || result.cdnUrl)
    if (url) {
      form.card.bgImage = url
      ElMessage.success('上传成功')
    } else {
      ElMessage.error('上传成功但未返回 URL，请联系管理员')
    }
  } catch (e) {
    ElMessage.error('上传失败：' + (e && e.message ? e.message : e))
  } finally {
    bgUploading.value = false
  }
  return false
}

// ========= 详情页：背景 mp4 =========
const handleDetailBgUpload = async (file) => {
  const isMp4 = file.type === 'video/mp4' || /\.mp4$/i.test(file.name || '')
  if (!isMp4) {
    ElMessage.error('详情页背景请上传 mp4')
    return false
  }
  if (file.size > 24 * 1024 * 1024) {
    ElMessage.error('mp4 不能超过 24MB，请压缩后重试')
    return false
  }
  detailBgUploading.value = true
  try {
    const base64Data = await fileToBase64(file)
    const safeName = file.name.replace(/[^\w.\-]/g, '_')
    const result = await api.cosProxyUpload({
      key: `orbital-data-center/detail-bg/${Date.now()}_${safeName}`,
      base64Data,
      contentType: 'video/mp4'
    })
    const url = result && (result.cosUrl || result.url || result.publicUrl || result.cdnUrl)
    if (url) {
      form.detail.bgVideo = url
      ElMessage.success('上传成功')
    } else {
      ElMessage.error('上传成功但未返回 URL，请联系管理员')
    }
  } catch (e) {
    ElMessage.error('上传失败：' + (e && e.message ? e.message : e))
  } finally {
    detailBgUploading.value = false
  }
  return false
}

const fileToBase64 = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = e => {
    const data = String(e.target.result || '')
    const idx = data.indexOf(',')
    resolve(idx >= 0 ? data.slice(idx + 1) : data)
  }
  reader.onerror = reject
  reader.readAsDataURL(file)
})

onMounted(load)
</script>

<style scoped>
.orbital-config {
  padding: 0;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 20px;
  gap: 16px;
  flex-wrap: wrap;
}

.page-title {
  font-size: 22px;
  font-weight: 700;
  color: #fff;
  letter-spacing: 0.6px;
  margin-bottom: 4px;
}

.page-subtitle {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.55);
  letter-spacing: 0.3px;
}

.page-actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.orbital-tabs {
  margin-top: 8px;
}

.section-card {
  margin-bottom: 16px;
  background: rgba(255, 255, 255, 0.02) !important;
  border: 1px solid rgba(255, 255, 255, 0.08) !important;
}

.section-header {
  display: flex;
  align-items: baseline;
  gap: 12px;
}

.section-title {
  font-size: 15px;
  font-weight: 600;
  color: #fff;
  letter-spacing: 0.4px;
}

.section-hint {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.5);
  letter-spacing: 0.3px;
}

.form-hint {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.5);
  margin-left: 12px;
  letter-spacing: 0.3px;
}

.row-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-bottom: 10px;
}

.row-item .el-input,
.row-item .el-textarea {
  flex: 1;
}

/* 背景图预览 */
.bg-uploader {
  width: 100%;
  max-width: 480px;
}

.bg-preview {
  position: relative;
  width: 100%;
  aspect-ratio: 750 / 320;
  border-radius: 12px;
  overflow: hidden;
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid rgba(255, 255, 255, 0.08);
  margin-bottom: 10px;
}

.bg-preview img,
.bg-preview-media {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.bg-preview-fallback {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.5);
}

.bg-preview-overlay {
  position: absolute;
  top: 8px;
  right: 8px;
}

.bg-upload-trigger {
  display: inline-block;
}
</style>
