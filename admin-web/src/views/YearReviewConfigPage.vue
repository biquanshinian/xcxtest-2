<template>
  <div class="year-review-page">
    <el-card shadow="never">
      <template #header>
        <div class="card-head">
          <span>年度报告（Year in Review）</span>
          <el-button type="primary" :loading="saving" @click="onSave">保存配置</el-button>
        </div>
      </template>

      <el-alert
        title="展示时间窗内，小程序「我的太空」在「太空简报」上方显示入口。个人数据为自然年（北京时）；「同行数据」需在下方开启并前往快照区生成对应年度快照。年鉴签到天数按云端保留的最近约 90 条签到日期计算该年条数。"
        type="info"
        :closable="false"
        show-icon
        style="margin-bottom: 20px"
      />

      <el-form :model="form" label-width="160px" style="max-width: 900px">
        <el-form-item label="启用年度报告">
          <el-switch v-model="form.enabled" />
        </el-form-item>
        <el-form-item label="报告年度">
          <el-input-number v-model="form.year" :min="2000" :max="2100" />
        </el-form-item>
        <el-form-item label="展示开始日期">
          <el-date-picker
            v-model="form.visibleFromYmd"
            type="date"
            format="YYYY-MM-DD"
            value-format="YYYY-MM-DD"
            placeholder="选择日期（北京时间自然日）"
            style="width: 240px"
          />
        </el-form-item>
        <el-form-item label="展示结束日期">
          <el-date-picker
            v-model="form.visibleToYmd"
            type="date"
            format="YYYY-MM-DD"
            value-format="YYYY-MM-DD"
            placeholder="选择日期（北京时间自然日）"
            style="width: 240px"
          />
        </el-form-item>
        <el-form-item label="入口标题">
          <el-input v-model="form.title" placeholder="显示在「我的太空」卡片主标题" />
        </el-form-item>
        <el-form-item label="入口副标题">
          <el-input v-model="form.subtitle" placeholder="副标题一句话" />
        </el-form-item>
        <el-form-item label="年度导语模板">
          <el-input v-model="form.introTemplate" type="textarea" :rows="4" placeholder="支持占位符" />
        </el-form-item>
        <el-form-item label="年度结语模板">
          <el-input v-model="form.outroTemplate" type="textarea" :rows="4" />
        </el-form-item>
        <el-form-item label="报告中展示同行数据">
          <el-switch v-model="form.showPlatformStats" />
          <el-text type="info" style="margin-left: 12px">需先点击下方生成快照（全站汇总为近似值）</el-text>
        </el-form-item>
      </el-form>

      <el-divider content-position="left">占位符说明</el-divider>
      <el-descriptions :column="2" border size="small" style="max-width: 900px">
        <el-descriptions-item v-for="row in placeholderRows" :key="row.key" :label="row.key">{{ row.desc }}</el-descriptions-item>
      </el-descriptions>

      <el-divider content-position="left">全站快照（可选）</el-divider>
      <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap">
        <el-input-number v-model="snapshotYear" :min="2000" :max="2100" />
        <el-button type="warning" :loading="snapshotting" @click="rebuildSnapshot">生成 / 刷新该年度快照</el-button>
      </div>
      <pre v-if="lastSnapshot" class="snapshot-pre">{{ JSON.stringify(lastSnapshot, null, 2) }}</pre>
    </el-card>
  </div>
</template>

<script setup>
import { onMounted, ref, reactive } from 'vue'
import { ElMessage } from 'element-plus'
import { api } from '../api/client'

const saving = ref(false)
const snapshotting = ref(false)
const snapshotYear = ref(new Date().getFullYear())
const lastSnapshot = ref(null)

const form = reactive({
  enabled: false,
  year: new Date().getFullYear(),
  visibleFromYmd: '',
  visibleToYmd: '',
  title: '',
  subtitle: '',
  introTemplate: '',
  outroTemplate: '',
  showPlatformStats: false
})

const placeholderRows = [
  { key: '{{year}}', desc: '报告年度数字' },
  { key: '{{checkinDaysInYear}}', desc: '该年内在云端「签到日期列表」中仍可查的签到天数（列表约保留最近 90 条日期）' },
  { key: '{{timelineEventCount}}', desc: '该年时间线事件条数' },
  { key: '{{milestoneSummary}}', desc: '该年里程碑类型摘要（中文）' },
  { key: '{{quizAnswered}} / {{quizCorrect}}', desc: '档案内累计答题数与答对（非严格按年切分）' },
  { key: '{{aiChatYear}} / {{aiImageYear}}', desc: 'AI 对话/生图在该年的使用次数（按日 key 汇总）' },
  { key: '{{achievementsUnlockedInYear}}', desc: '该年解锁成就数' },
  { key: '{{platformTotalUsers}}', desc: '需开启「同行数据」且已生成快照（全站用户档案数）' },
  { key: '{{platformGlobalLaunches}} / {{platformSpacexLaunches}}', desc: '全球与 SpaceX 全年已完成发射（来自 launch_stats，依赖同步）' },
  { key: '{{platformStarshipMissions}}', desc: 'SpaceX 星舰体系任务次数（快照按缓存识别，仅供参考）' },
  { key: '{{platformNewsArticles}}', desc: '新闻资讯该年已发布文章篇数' },
  { key: '{{platformNewsEvents}}', desc: '事件流（news_events）该年已发布条数' },
  { key: '{{platformTweetPosts}}', desc: '星舰基地推文该年已发布条数' },
  { key: '{{platformMaxBoosterFlights}} / {{platformMaxBoosterSerial}} / {{platformMaxBoosterRocketModel}}', desc: '族谱中飞行次数最高的助推器及火箭型号' }
]

const load = async () => {
  try {
    const data = await api.getYearReviewConfig()
    if (data) {
      Object.assign(form, {
        enabled: !!data.enabled,
        year: Number(data.year) || new Date().getFullYear(),
        visibleFromYmd: data.visibleFromYmd || '',
        visibleToYmd: data.visibleToYmd || '',
        title: data.title || '',
        subtitle: data.subtitle || '',
        introTemplate: data.introTemplate || '',
        outroTemplate: data.outroTemplate || '',
        showPlatformStats: !!data.showPlatformStats
      })
    }
  } catch (e) {
    ElMessage.error(e.message || '加载失败')
  }
}

const onSave = async () => {
  saving.value = true
  try {
    await api.updateYearReviewConfig({ ...form })
    ElMessage.success('已保存')
  } catch (e) {
    ElMessage.error(e.message || '保存失败')
  } finally {
    saving.value = false
  }
}

const rebuildSnapshot = async () => {
  snapshotting.value = true
  try {
    const data = await api.rebuildYearReviewSnapshot({ year: snapshotYear.value })
    lastSnapshot.value = data
    ElMessage.success('快照已生成')
  } catch (e) {
    ElMessage.error(e.message || '生成失败')
  } finally {
    snapshotting.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.year-review-page {
  padding: 4px;
}
.card-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.snapshot-pre {
  margin-top: 16px;
  padding: 12px;
  background: var(--el-fill-color-light);
  border-radius: 8px;
  font-size: 12px;
  overflow: auto;
  max-width: 900px;
  max-height: 240px;
}
</style>
