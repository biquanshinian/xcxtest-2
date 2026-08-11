<template>
  <el-card>
    <template #header>
      <div class="hdr">
        <span>发稿设置</span>
        <el-button type="primary" :loading="saving" @click="onSave">保存</el-button>
      </div>
    </template>

    <el-alert
      :type="slotWarnType"
      :closable="false"
      style="margin-bottom:16px"
      :title="slotWarnText"
    />

    <el-divider content-position="left">共用</el-divider>
    <el-form :model="form" label-width="160px" style="max-width:760px">
      <el-form-item label="启用日更">
        <el-switch v-model="form.enabled" />
      </el-form-item>
      <el-form-item label="每日生成篇数">
        <el-input-number v-model="form.dailyMax" :min="1" :max="8" />
      </el-form-item>
      <el-form-item label="默认发稿号">
        <el-select v-model="form.defaultBrandKey" style="width:240px">
          <el-option
            v-for="b in form.brands"
            :key="b.key"
            :label="b.name"
            :value="b.key"
          />
        </el-select>
        <el-text type="info" size="small" style="margin-left:12px;">日更未指定时用此号</el-text>
      </el-form-item>
      <el-form-item label="小程序 path">
        <el-input v-model="form.miniprogramPath" placeholder="pages/index/index" />
      </el-form-item>
      <el-form-item label="引流展示">
        <el-radio-group v-model="form.miniprogramCtaMode">
          <el-radio value="none">不附加文末（推荐，仅配图跳）</el-radio>
          <el-radio value="image">文末图片跳转</el-radio>
          <el-radio value="link">文末文字链接</el-radio>
          <el-radio value="card">官方卡片（易失败）</el-radio>
        </el-radio-group>
        <el-text type="info" size="small" style="display:block;margin-top:6px;">
          避营销推广/导流限流：默认不附加文末引流，只靠正文配图点击进小程序
        </el-text>
      </el-form-item>
      <el-form-item label="配图全跳小程序">
        <el-switch v-model="form.linkAllImagesToMiniprogram" />
        <el-text type="info" size="small" style="margin-left:12px;">
          正文每张图点击都进小程序（须各发稿号已关联同一小程序；配图会按凭证槽本号转存）
        </el-text>
      </el-form-item>
      <el-form-item label="文首提示语">
        <el-switch v-model="form.leadDisclaimerEnabled" />
        <el-text type="info" size="small" style="margin-left:12px;">
          发射/新闻/洗稿稿件统一在文章开头插入；纯文展示，不挂文字小程序链
        </el-text>
      </el-form-item>
      <el-form-item v-if="form.leadDisclaimerEnabled" label="提示语文案">
        <el-input
          v-model="form.leadDisclaimerText"
          type="textarea"
          :rows="3"
          maxlength="300"
          show-word-limit
          style="max-width:720px"
          placeholder="例：本文详情信息仅供参考，有关火箭发射预报小程序【火星探索日志】可以查看…"
        />
      </el-form-item>
      <el-form-item label="开启留言">
        <el-switch v-model="form.openComment" />
      </el-form-item>
      <el-form-item label="仅粉丝可留言">
        <el-switch v-model="form.onlyFansCanComment" :disabled="!form.openComment" />
      </el-form-item>
      <el-form-item label="草稿保留天数">
        <el-input-number v-model="form.draftRetainDays" :min="0" :max="365" />
      </el-form-item>
      <el-form-item label="任务日志保留天">
        <el-input-number v-model="form.jobRetainDays" :min="0" :max="365" />
      </el-form-item>
      <el-form-item label="日更后自动推微信草稿">
        <el-switch v-model="form.autoPushToWechatDraft" />
      </el-form-item>
      <el-form-item label="自动 freepublish">
        <el-switch v-model="form.autoFreepublish" disabled />
        <el-text type="info" size="small" style="margin-left:12px">仅支持人工确认发稿</el-text>
      </el-form-item>
      <el-form-item label="关联小程序 AppID">
        <el-text>{{ form.miniAppId || '-' }}</el-text>
      </el-form-item>
      <el-form-item label="上次日更">
        <el-text>{{ form.lastDailyAt ? new Date(form.lastDailyAt).toLocaleString() : '尚未执行' }}</el-text>
      </el-form-item>
    </el-form>

    <el-divider content-position="left">外链追踪（RSS 作者 / 栏目）</el-divider>
    <div class="track-toolbar">
      <el-button type="primary" plain :loading="tracking" @click="onTrackNow">立即拉取</el-button>
      <el-button
        v-for="p in trackPresets"
        :key="p.key"
        plain
        :disabled="hasTrackSource(p.key)"
        @click="addTrackPreset(p)"
      >{{ hasTrackSource(p.key) ? `已添加 ${p.name}` : `+ ${p.name}` }}</el-button>
      <el-text type="info" size="small" style="margin-left:12px">
        上次：{{ form.lastTrackAt ? new Date(form.lastTrackAt).toLocaleString() : '尚未执行' }}
        <span v-if="form.lastTrackResult"> · {{ form.lastTrackResult }}</span>
      </el-text>
    </div>
    <el-table :data="form.trackSources" border size="small" style="margin:12px 0 20px;max-width:960px">
      <el-table-column label="启用" width="70">
        <template #default="{ row }">
          <el-switch v-model="row.enabled" />
        </template>
      </el-table-column>
      <el-table-column prop="name" label="名称" min-width="140" />
      <el-table-column label="作者匹配" min-width="100">
        <template #default="{ row }">
          <el-input v-model="row.authorMatch" size="small" />
        </template>
      </el-table-column>
      <el-table-column label="RSS" min-width="200">
        <template #default="{ row }">
          <el-input v-model="row.rssUrl" size="small" />
        </template>
      </el-table-column>
      <el-table-column label="自动洗稿" width="90">
        <template #default="{ row }">
          <el-switch v-model="row.autoWash" />
        </template>
      </el-table-column>
      <el-table-column label="发稿号" width="130">
        <template #default="{ row }">
          <el-select v-model="row.brandKey" size="small" style="width:110px">
            <el-option
              v-for="b in form.brands"
              :key="b.key"
              :label="b.name"
              :value="b.key"
            />
          </el-select>
        </template>
      </el-table-column>
      <el-table-column label="策略" width="120">
        <template #default="{ row }">
          <el-input v-model="row.strategyKey" size="small" placeholder="auto" />
        </template>
      </el-table-column>
      <el-table-column label="每轮" width="80">
        <template #default="{ row }">
          <el-input-number v-model="row.maxPerRun" :min="1" :max="10" size="small" controls-position="right" />
        </template>
      </el-table-column>
      <el-table-column label="" width="60">
        <template #default="{ $index }">
          <el-button link type="danger" size="small" @click="removeTrackSource($index)">删</el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-text type="info" size="small" style="display:block;margin-bottom:16px;max-width:960px">
      「作者匹配」留空 = 该 feed 全部文章。默认只入库到「对标资产 → 采集」（同名对标账号自动建档）；
      开启自动洗稿才会进草稿箱。策略填 auto（或留空）= 按正文自动匹配。定时由云函数 oaAuthorTrack 每 6 小时触发。
      NSF 等站若直连被 Cloudflare 403，会自动经 RSS 中转（rss2json）拉取。修改后记得点顶部「保存配置」。
    </el-text>

    <el-divider content-position="left">发稿号（人设 / 策略 / 凭证槽）</el-divider>
    <el-tabs v-model="brandTab" type="border-card" class="brand-tabs">
      <el-tab-pane
        v-for="(b, idx) in form.brands"
        :key="b.key"
        :label="b.name || b.key"
        :name="b.key"
      >
        <el-form label-width="120px" style="max-width:720px">
          <el-form-item label="名称">
            <el-input v-model="b.name" maxlength="32" />
          </el-form-item>
          <el-form-item label="作者署名">
            <el-input v-model="b.author" maxlength="16" />
          </el-form-item>
          <el-form-item label="人设（文风）">
            <el-input v-model="b.persona" type="textarea" :rows="4" />
            <el-text type="info" size="small">两号人设拉开即可降低同质化；洗稿会严格贴合人设。</el-text>
          </el-form-item>
          <el-form-item label="文末 footer">
            <el-input v-model="b.footer" type="textarea" :rows="3" placeholder="建议留空：文末直接结束，避免广告宣传语限流" />
          </el-form-item>
          <el-form-item label="默认策略 Key">
            <el-input v-model="b.defaultStrategyKey" placeholder="launch_brief / space_story" />
          </el-form-item>
          <el-form-item label="小程序 CTA">
            <el-input
              v-model="b.miniprogramCta"
              maxlength="20"
              show-word-limit
              placeholder="建议留空；仅文末引流开启时使用"
            />
          </el-form-item>
          <el-form-item label="默认封面 URL">
            <el-input v-model="b.defaultCoverUrl" placeholder="可空，沿用全局或草稿封面" />
          </el-form-item>
          <el-form-item label="凭证槽">
            <el-radio-group v-model="b.credentialSlot">
              <el-radio v-for="s in slotOptions" :key="s" :value="s">
                槽 {{ s }} · {{ s === '1' ? 'WECHAT_OA_APPID' : `WECHAT_OA_APPID_${s}` }}
              </el-radio>
            </el-radio-group>
            <div class="slot-status">
              <el-tag
                size="small"
                :type="slotReady(b.credentialSlot) ? 'success' : 'danger'"
                effect="plain"
              >
                {{ slotReady(b.credentialSlot) ? '已配置' : '未配置' }}
                {{ slotAppid(b.credentialSlot) }}
              </el-tag>
            </div>
          </el-form-item>
          <el-form-item label="启用">
            <el-switch v-model="b.enabled" />
          </el-form-item>
          <el-form-item v-if="form.brands.length > 1">
            <el-button type="danger" text @click="removeBrand(idx)">移除此发稿号</el-button>
          </el-form-item>
        </el-form>
      </el-tab-pane>
    </el-tabs>
    <div class="brand-add">
      <el-button @click="addBrand">新增发稿号</el-button>
      <el-text type="info" size="small" style="margin-left:10px;">
        策略可到「策略引擎」种子：space_story（平实解说，槽2）与 launch_brief（硬核短讯，槽1）搭配两号使用。
      </el-text>
    </div>
  </el-card>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { api } from '../api/client'

const saving = ref(false)
const tracking = ref(false)
const brandTab = ref('mars_log')
const form = reactive({
  enabled: false,
  dailyMax: 3,
  defaultBrandKey: 'mars_log',
  brands: [],
  trackSources: [],
  miniprogramPath: 'pages/index/index',
  miniprogramCtaMode: 'none',
  linkAllImagesToMiniprogram: true,
  leadDisclaimerEnabled: true,
  leadDisclaimerText:
    '本文详情信息仅供参考，有关火箭发射预报小程序【火星探索日志】可以查看火箭发射信息及相关资讯，感谢阅读，记得点赞支持',
  openComment: true,
  onlyFansCanComment: false,
  draftRetainDays: 14,
  jobRetainDays: 30,
  autoPushToWechatDraft: false,
  autoFreepublish: false,
  wechatReady: false,
  wechatReadyBySlot: { '1': { ready: false }, '2': { ready: false } },
  miniAppId: '',
  lastDailyAt: 0,
  lastTrackAt: 0,
  lastTrackResult: ''
})

const slotReady = (slot) => !!form.wechatReadyBySlot?.[String(slot || '1')]?.ready
const slotAppid = (slot) => form.wechatReadyBySlot?.[String(slot || '1')]?.appid || ''

/** 槽位配置化：后端返回已配置的槽（1/2 恒在，3–9 配了才显示） */
const slotOptions = computed(() => {
  const keys = Object.keys(form.wechatReadyBySlot || {}).filter((k) => /^[1-9]$/.test(k))
  const set = new Set(['1', '2', ...keys])
  return [...set].sort()
})

const slotWarnType = computed(() => {
  const readiness = slotOptions.value.map((s) => slotReady(s))
  if (readiness.every(Boolean)) return 'success'
  return 'warning'
})
const slotWarnText = computed(() => {
  const readyList = slotOptions.value.filter((s) => slotReady(s))
  const missList = slotOptions.value.filter((s) => !slotReady(s))
  if (!readyList.length) {
    return '未检测到微信凭证。槽1=WECHAT_OA_APPID/SECRET，槽N=WECHAT_OA_APPID_N/SECRET_N（N=2–9）。'
  }
  if (!missList.length) {
    return `凭证槽 ${readyList.join(' / ')} 均已配置，可分别推送到对应公众号。`
  }
  return `槽 ${readyList.join('/')} 已就绪；槽 ${missList.join('/')} 未配置（WECHAT_OA_APPID_N / WECHAT_OA_SECRET_N）。新增第 3+ 个公众号只需配置对应环境变量。`
})

const load = async () => {
  try {
    const res = await api.getOaContentConfig()
    Object.assign(form, res || {})
    if (!Array.isArray(form.brands) || !form.brands.length) {
      form.brands = [
        {
          key: 'mars_log',
          name: '火星探索日志',
          author: '火星探索日志',
          persona: '',
          footer: '',
          defaultStrategyKey: 'launch_brief',
          credentialSlot: '1',
          miniprogramCta: '',
          defaultCoverUrl: '',
          enabled: true
        }
      ]
    }
    if (!Array.isArray(form.trackSources) || !form.trackSources.length) {
      form.trackSources = [
        {
          key: 'proxima_jack',
          name: 'Proxima · Jack C.',
          site: 'proxima',
          authorPage: 'https://proximareport.com/author/jack/',
          rssUrl: 'https://proximareport.com/rss/',
          authorMatch: 'Jack C.',
          enabled: true,
          autoWash: false,
          brandKey: 'mars_log',
          strategyKey: 'auto',
          maxPerRun: 3
        }
      ]
    }
    brandTab.value = form.defaultBrandKey || form.brands[0].key
    // 客户端兜底：清掉旧硬广结语/CTA，避免未部署云函数时保存又写回
    for (const b of form.brands || []) {
      const foot = String(b.footer || '')
      if (/小程序|想追火箭|打开小程序/.test(foot)) b.footer = ''
      if (/打开小程序/.test(String(b.miniprogramCta || ''))) b.miniprogramCta = ''
    }
    for (const s of form.trackSources || []) {
      if (!String(s.strategyKey || '').trim()) s.strategyKey = 'auto'
    }
    form.miniprogramCtaMode = form.miniprogramCtaMode || 'none'
    if (form.miniprogramCtaMode === 'image' && !(form.brands || []).some((b) => String(b.miniprogramCta || '').trim())) {
      form.miniprogramCtaMode = 'none'
    }
    if (/发射时间为预测/.test(String(form.leadDisclaimerText || ''))) {
      form.leadDisclaimerText =
        '本文详情信息仅供参考，有关火箭发射预报小程序【火星探索日志】可以查看火箭发射信息及相关资讯，感谢阅读，记得点赞支持'
    }
  } catch (e) {
    ElMessage.error(e.message || '加载配置失败')
  }
}

/** 预设追踪源：NSF 栏目 feed（HTML 页被 Cloudflare 拦，RSS 通道开放且含全文+配图） */
const trackPresets = [
  {
    key: 'nsf_spacex',
    name: 'NSF · SpaceX',
    site: 'nasaspaceflight',
    authorPage: 'https://www.nasaspaceflight.com/news/spacex/',
    rssUrl: 'https://www.nasaspaceflight.com/news/spacex/feed/',
    authorMatch: '',
    enabled: true,
    autoWash: true,
    brandKey: 'mars_log',
    strategyKey: 'auto',
    maxPerRun: 2
  },
  {
    key: 'nsf_chinese',
    name: 'NSF · 中国航天',
    site: 'nasaspaceflight',
    authorPage: 'https://www.nasaspaceflight.com/news/international/chinese/',
    rssUrl: 'https://www.nasaspaceflight.com/news/international/chinese/feed/',
    authorMatch: '',
    enabled: true,
    autoWash: true,
    brandKey: 'mars_space',
    strategyKey: 'auto',
    maxPerRun: 2
  }
]

const hasTrackSource = (key) =>
  (form.trackSources || []).some(
    (s) => s.key === key || (s.rssUrl && trackPresets.some((p) => p.key === key && p.rssUrl === s.rssUrl))
  )

const addTrackPreset = (p) => {
  if (hasTrackSource(p.key)) return
  if (!Array.isArray(form.trackSources)) form.trackSources = []
  // 发稿号兜底：预设的 brandKey 不存在时退到默认发稿号
  const brandKey = form.brands.some((b) => b.key === p.brandKey)
    ? p.brandKey
    : form.defaultBrandKey || form.brands[0]?.key || ''
  form.trackSources.push({ ...p, brandKey })
  ElMessage.success(`已添加「${p.name}」，保存配置后生效（自动洗稿已开）`)
}

const removeTrackSource = (idx) => {
  form.trackSources.splice(idx, 1)
}

const addBrand = () => {
  const key = `brand_${Date.now().toString(36)}`
  form.brands.push({
    key,
    name: '新发稿号',
    author: '',
    persona: '',
    footer: '',
    defaultStrategyKey: 'space_story',
    credentialSlot: '2',
    miniprogramCta: '',
    defaultCoverUrl: '',
    enabled: true
  })
  brandTab.value = key
}

const removeBrand = (idx) => {
  const removed = form.brands[idx]
  form.brands.splice(idx, 1)
  if (form.defaultBrandKey === removed.key) {
    form.defaultBrandKey = form.brands[0]?.key || ''
  }
  brandTab.value = form.defaultBrandKey || form.brands[0]?.key
}

const onSave = async () => {
  saving.value = true
  try {
    const {
      enabled,
      dailyMax,
      defaultBrandKey,
      brands,
      trackSources,
      miniprogramPath,
      miniprogramCtaMode,
      linkAllImagesToMiniprogram,
      leadDisclaimerEnabled,
      leadDisclaimerText,
      openComment,
      onlyFansCanComment,
      draftRetainDays,
      jobRetainDays,
      autoPushToWechatDraft
    } = form
    await api.updateOaContentConfig({
      enabled,
      dailyMax,
      defaultBrandKey,
      brands,
      trackSources,
      miniprogramPath,
      miniprogramCtaMode,
      linkAllImagesToMiniprogram,
      leadDisclaimerEnabled,
      leadDisclaimerText,
      openComment,
      onlyFansCanComment,
      draftRetainDays,
      jobRetainDays,
      autoPushToWechatDraft
    })
    ElMessage.success('已保存')
    load()
  } catch (e) {
    ElMessage.error(e.message || '保存失败')
  } finally {
    saving.value = false
  }
}

const onTrackNow = async () => {
  tracking.value = true
  try {
    // 先保存当前追踪配置，避免未保存就拉取
    await api.updateOaContentConfig({ trackSources: form.trackSources })
    const res = await api.runOaTrackSources({})
    const rows = res?.results || []
    // 必须暴露 error 和 fetched：拉到 0 篇通常是源拉取失败而非「没有新文章」
    const msg = rows
      .map((r) => {
        const base = `${r.name || r.key}: 拉到${r.fetched || 0} 新${r.created || 0}/跳过${r.skipped || 0}${
          r.washed ? `/洗稿${r.washed}` : ''
        }`
        return r.error ? `${base} ❌ ${r.error}` : base
      })
      .join('；')
    const hasErr = rows.some((r) => r.error)
    ElMessage({
      type: hasErr ? 'warning' : 'success',
      message: msg || '拉取完成',
      duration: hasErr ? 12000 : 5000,
      showClose: true
    })
    load()
  } catch (e) {
    ElMessage.error(e.message || '拉取失败')
  } finally {
    tracking.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.hdr { display:flex; justify-content:space-between; align-items:center; }
.brand-tabs { margin-bottom: 12px; }
.brand-add { margin-top: 8px; }
.slot-status { margin-top: 8px; }
.track-toolbar { display:flex; align-items:center; flex-wrap:wrap; gap:4px; }
</style>
