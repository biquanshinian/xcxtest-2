<template>
  <el-card class="oa-drafts">
    <template #header>
      <div class="hdr">
        <div class="hdr-left">
          <span class="hdr-title">公众号草稿箱</span>
          <el-text type="info" size="small">审核 → 推微信草稿 → 确认发稿</el-text>
        </div>
        <div class="acts">
          <el-select v-model="brandKey" clearable placeholder="全部发稿号" style="width:160px" @change="onFilter">
            <el-option v-for="b in brands" :key="b.key" :label="b.name" :value="b.key" />
          </el-select>
          <el-select v-model="status" clearable placeholder="全部状态" style="width:150px" @change="onFilter">
            <el-option label="生成中" value="generating" />
            <el-option label="生成失败" value="generate_failed" />
            <el-option label="待审核" value="ready" />
            <el-option label="推送中" value="pushing" />
            <el-option label="推送失败" value="push_failed" />
            <el-option label="需人工改写" value="needs_review" />
            <el-option label="已推微信草稿" value="pushed_to_wechat" />
            <el-option label="已发布" value="published" />
            <el-option label="已拒绝" value="rejected" />
          </el-select>
          <el-button
            class="batch-del-btn"
            :disabled="!selectedIds.length"
            :loading="batchDeleting"
            @click="onBatchDelete"
          >批量删除{{ selectedIds.length ? ` (${selectedIds.length})` : '' }}</el-button>
          <el-button @click="load" :loading="loading">刷新</el-button>
        </div>
      </div>
    </template>

    <el-table
      :data="list"
      stripe
      v-loading="loading"
      class="draft-table"
      row-key="_id"
      @selection-change="onSelectionChange"
    >
      <el-table-column type="selection" width="46" />
      <el-table-column label="发稿号" width="120">
        <template #default="{ row }">
          <el-tag size="small" effect="plain">{{ row.brandName || row.brandKey || '—' }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="稿件" min-width="360">
        <template #default="{ row }">
          <div class="draft-main">
            <div v-if="imagesOf(row).length" class="draft-thumbs">
              <el-image
                v-for="(url, i) in imagesOf(row)"
                :key="`${row._id}-${i}`"
                :src="thumbSrc(url)"
                :preview-src-list="imagesOf(row).map(thumbSrc)"
                :initial-index="i"
                fit="cover"
                class="draft-cover"
                preview-teleported
                hide-on-click-modal
              />
            </div>
            <div v-else class="draft-cover draft-cover--empty">无封面</div>
            <div class="draft-meta">
              <div class="draft-title" :title="row.title">{{ row.title || '未命名' }}</div>
              <div class="draft-sub">
                <span>{{ row.strategyName || row.strategyKey || '—' }}</span>
                <el-tag v-if="row.strategyAuto" size="small" type="info" effect="plain" style="margin-left:4px">自动</el-tag>
                <span class="dot">·</span>
                <span>{{ sourceLabel(row.sourceType) }}</span>
                <span class="dot">·</span>
                <el-tag
                  size="small"
                  effect="plain"
                  :type="prepTagType(row)"
                >{{ prepLabel(row) }}</el-tag>
              </div>
              <div v-if="row.error" class="draft-err" :title="row.error">{{ errorLabel(row.error) }}</div>
              <div v-else-if="row.imagePrepNote" class="draft-note" :title="row.imagePrepNote">{{ row.imagePrepNote }}</div>
            </div>
          </div>
        </template>
      </el-table-column>

      <el-table-column label="状态" width="118" align="center">
        <template #default="{ row }">
          <el-tag :type="statusType(row.status)" size="small" effect="plain">{{ statusLabel(row.status) }}</el-tag>
        </template>
      </el-table-column>

      <el-table-column label="时间" width="158">
        <template #default="{ row }">
          <div class="time-cell">{{ fmt(row.createdAt) }}</div>
        </template>
      </el-table-column>

      <el-table-column label="操作" width="500" fixed="right" align="right">
        <template #default="{ row }">
          <div class="ops">
            <el-button class="ops-btn ops-btn--muted" size="small" @click="openEdit(row)">编辑</el-button>
            <el-button
              class="ops-btn ops-btn--muted"
              size="small"
              :disabled="['published', 'rejected', 'generate_failed', 'generating'].includes(row.status)"
              :loading="busyId === row._id + ':prep'"
              @click="onPrepare(row)"
            >转存配图</el-button>
            <el-button
              class="ops-btn ops-btn--primary"
              size="small"
              :disabled="!canPush(row)"
              :loading="busyId === row._id + ':push'"
              @click="onPush(row)"
            >推微信</el-button>
            <el-button
              class="ops-btn ops-btn--success"
              size="small"
              :disabled="!canPublish(row)"
              :loading="busyId === row._id + ':publish'"
              @click="onPublish(row)"
            >发稿</el-button>
            <el-button
              class="ops-btn ops-btn--warn"
              size="small"
              :disabled="row.status === 'rejected' || row.status === 'published'"
              @click="onReject(row)"
            >拒绝</el-button>
            <el-button class="ops-btn ops-btn--danger" size="small" @click="onDelete(row)">删除</el-button>
          </div>
        </template>
      </el-table-column>
    </el-table>

    <div class="pager">
      <el-pagination
        background
        layout="total, prev, pager, next"
        :total="total"
        :page-size="query.pageSize"
        :current-page="query.page"
        @current-change="onPage"
      />
    </div>

    <el-dialog
      v-model="visible"
      title="编辑草稿"
      width="80%"
      top="4vh"
      destroy-on-close
      class="draft-dialog"
    >
      <el-form :model="form" label-width="96px">
        <el-form-item label="发稿号">
          <el-select v-model="form.brandKey" style="width:100%">
            <el-option v-for="b in brands" :key="b.key" :label="b.name" :value="b.key" />
          </el-select>
        </el-form-item>
        <el-form-item label="标题"><el-input v-model="form.title" /></el-form-item>
        <el-form-item label="摘要"><el-input v-model="form.digest" /></el-form-item>
        <el-form-item label="作者"><el-input v-model="form.author" /></el-form-item>
        <el-form-item label="封面 URL"><el-input v-model="form.coverUrl" /></el-form-item>
        <el-form-item v-if="form.imageUrls.length" label="配图">
          <div class="draft-thumbs draft-thumbs--edit">
            <el-image
              v-for="(url, i) in form.imageUrls"
              :key="`edit-${i}`"
              :src="thumbSrc(url)"
              :preview-src-list="form.imageUrls.map(thumbSrc)"
              :initial-index="i"
              fit="cover"
              class="draft-cover draft-cover--lg"
              preview-teleported
              hide-on-click-modal
            />
          </div>
          <el-text size="small" type="info">
            微信图床防盗链：预览经服务端代理；推送时仍走转存，不影响发稿。
          </el-text>
        </el-form-item>
        <el-form-item label="小程序 path"><el-input v-model="form.miniprogramPath" placeholder="pages/index/index" /></el-form-item>
        <el-form-item label="Markdown">
          <el-input v-model="form.markdown" type="textarea" :rows="16" />
        </el-form-item>
        <el-form-item v-if="form.error" label="错误">
          <el-text type="danger">{{ form.error }}</el-text>
        </el-form-item>
        <el-form-item v-if="form.timeline.length" label="时间线">
          <el-timeline class="draft-timeline">
            <el-timeline-item
              v-for="(ev, i) in form.timeline"
              :key="`tl-${i}`"
              :timestamp="fmt(ev.t)"
              :type="timelineType(ev.e)"
              size="small"
            >
              {{ timelineLabel(ev.e) }}<span v-if="ev.d" class="tl-detail">（{{ ev.d }}）</span>
            </el-timeline-item>
          </el-timeline>
        </el-form-item>
      </el-form>
      <template #footer>
        <div class="dialog-footer">
          <el-button @click="visible = false">取消</el-button>
          <el-button type="primary" :loading="saving" @click="onSave">保存</el-button>
        </div>
      </template>
    </el-dialog>
  </el-card>
</template>

<script setup>
import { onMounted, onUnmounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from '../api/client'
import { displayOaImage, warmOaImageList } from '../utils/oaImageProxy'

const list = ref([])
const total = ref(0)
const loading = ref(false)
const saving = ref(false)
const visible = ref(false)
const status = ref('')
const brandKey = ref('')
const brands = ref([])
const editingId = ref('')
const busyId = ref('')
const selectedIds = ref([])
const batchDeleting = ref(false)
const query = reactive({ page: 1, pageSize: 20 })
const form = reactive({
  title: '',
  digest: '',
  author: '',
  coverUrl: '',
  imageUrls: [],
  miniprogramPath: '',
  markdown: '',
  error: '',
  brandKey: '',
  timeline: []
})
/** url → 代理后 dataURL，打破微信防盗链占位图 */
const proxyMap = reactive({})
const thumbSrc = (url) => displayOaImage(url, proxyMap)
let pushPollTimer = null

const fmt = (t) => (t ? new Date(t).toLocaleString() : '-')

const timelineLabel = (e) =>
  ({
    generated: '已生成',
    generated_fallback: '生成（兜底整理稿）',
    generate_failed: '生成失败',
    prep_ready: '配图就绪',
    prep_partial: '配图部分就绪',
    push_queued: '推送入队',
    push_ok: '已写入微信草稿箱',
    push_fail: '推送失败'
  }[e] || e || '事件')

const timelineType = (e) =>
  /fail/.test(String(e || ''))
    ? 'danger'
    : /ok|ready|generated$/.test(String(e || ''))
      ? 'success'
      : 'info'
const statusLabel = (s) =>
  ({
    generating: '生成中',
    generate_failed: '生成失败',
    ready: '待审核',
    pushing: '推送中',
    push_failed: '推送失败',
    needs_review: '需改写',
    pushed_to_wechat: '微信草稿',
    published: '已发布',
    rejected: '已拒绝'
  }[s] || s || '-')

const statusType = (s) =>
  ({
    generating: 'info',
    generate_failed: 'danger',
    ready: 'warning',
    pushing: 'info',
    push_failed: 'danger',
    needs_review: 'danger',
    pushed_to_wechat: 'primary',
    published: 'success',
    rejected: 'danger'
  }[s] || 'info')

const sourceLabel = (t) =>
  ({
    launch: '发射',
    starship_event: '星舰事件',
    news_article: '手写稿',
    collected: '采集',
    viral: '爆文',
    manual: '手动'
  }[t] || t || '—')

/** 把技术向失败文案改成可操作提示（不能当成功忽略） */
const errorLabel = (err) => {
  const s = String(err || '').trim()
  if (!s) return ''
  if (/配图转存中|配图尚未就绪/i.test(s)) {
    return `${s} → 点「转存配图」或稍候，就绪后再推微信`
  }
  if (/推送未完成|推送超时未完成|推送超时/i.test(s)) {
    return '上次推送中断，微信草稿箱里还没有这篇 → 请确认「配图就绪」后再推'
  }
  if (/配图上传未完成/i.test(s)) {
    return `${s} → 先点「转存配图」，完成后再推微信`
  }
  if (/配图已就绪|已跳过.*无法转存|成功.*跳过/i.test(s)) {
    return s
  }
  if (/HTTP 403|防盗链/i.test(s)) {
    return '图片源防盗链拒绝下载(403)。可换公开图、配置发稿号默认封面后再推'
  }
  if (/续传/i.test(s)) {
    return s.includes('推送') ? s : `${s} → 请再点「推微信」`
  }
  return s
}

const prepLabel = (row) => {
  const bodyN = bodyImagesOf(row).length
  if (!bodyN) {
    if (row.coverUrl) return '仅封面'
    return '无配图'
  }
  if (row.imagePrepStatus === 'partial') {
    const s = row.imagePrepStats || {}
    if (s.dropped) return `配图部分就绪（跳过 ${s.dropped}）`
    return '配图部分就绪（有跳过）'
  }
  if (row.imagesReady || row.imagePrepStatus === 'ready') return '配图就绪'
  if (row.imagePrepStatus === 'preparing') {
    const s = row.imagePrepStats || {}
    if (s.total) return `转存中 ${s.ready || 0}/${s.total}`
    return '配图转存中'
  }
  return '配图未转存'
}

const prepTagType = (row) => {
  if (!bodyImagesOf(row).length) return 'info'
  if (row.imagesReady || row.imagePrepStatus === 'ready') return 'success'
  if (row.imagePrepStatus === 'partial') return 'warning'
  if (row.imagePrepStatus === 'preparing') return 'info'
  return 'danger'
}

/** 采集/洗稿配图：有几张显示几张（去重；封面优先） */
const imagesOf = (row) => {
  const out = []
  const seen = new Set()
  const push = (u) => {
    const s = String(u || '').trim()
    if (!s || seen.has(s)) return
    seen.add(s)
    out.push(s)
  }
  push(row?.coverUrl)
  if (Array.isArray(row?.imageUrls)) row.imageUrls.forEach(push)
  if (Array.isArray(row?.images)) row.images.forEach(push)
  return out
}

/** 正文配图（不含与封面相同的默认封面链） */
const bodyImagesOf = (row) => {
  const cover = String(row?.coverUrl || '').trim()
  const out = []
  const seen = new Set()
  const push = (u) => {
    const s = String(u || '').trim()
    if (!s || seen.has(s)) return
    if (cover && s === cover) return
    seen.add(s)
    out.push(s)
  }
  if (Array.isArray(row?.imageUrls)) row.imageUrls.forEach(push)
  if (Array.isArray(row?.images)) row.images.forEach(push)
  // markdown 里的图
  const md = String(row?.markdown || '')
  const re = /!\[[^\]]*\]\((https?:\/\/[^)\s]+)/gi
  let m
  while ((m = re.exec(md))) {
    push(m[1])
  }
  return out
}

const canPush = (row) => {
  if (['ready', 'pushed_to_wechat', 'push_failed'].includes(row.status)) return true
  // 卡住的推送中允许强制重试
  if (row.status === 'pushing') return true
  if (row.error && /推送未完成|推送超时|推送失败|callFunction/i.test(row.error)) return true
  return false
}
/** 发稿必须已推微信且有 media_id，禁止 ready 一键群发 */
const canPublish = (row) => row.status === 'pushed_to_wechat' && !!row.wxMediaId

const stopPushPoll = () => {
  if (pushPollTimer) {
    clearInterval(pushPollTimer)
    pushPollTimer = null
  }
}

const ensurePushPoll = () => {
  const busy = (list.value || []).some(
    (r) => r.status === 'pushing' || r.imagePrepStatus === 'preparing'
  )
  if (!busy) {
    stopPushPoll()
    return
  }
  if (pushPollTimer) return
  pushPollTimer = setInterval(() => {
    if (visible.value || busyId.value) return
    load({ silent: true })
  }, 3000)
}

const load = async (opts = {}) => {
  if (!opts.silent) loading.value = true
  try {
    const res = await api.listOaDrafts({
      page: query.page,
      pageSize: query.pageSize,
      status: status.value || undefined,
      brandKey: brandKey.value || undefined
    })
    list.value = res?.list || []
    total.value = res?.total || 0
    if (!opts.silent) selectedIds.value = []
    ensurePushPoll()
    const urls = []
    for (const row of list.value) urls.push(...imagesOf(row))
    warmOaImageList(urls, proxyMap).catch(() => null)
  } catch (e) {
    if (!opts.silent) ElMessage.error(e.message || '加载失败')
  } finally {
    if (!opts.silent) loading.value = false
  }
}

const loadBrands = async () => {
  try {
    const cfg = await api.getOaContentConfig()
    brands.value = (cfg?.brands || []).filter((b) => b.enabled !== false)
  } catch (e) {
    brands.value = []
  }
}

const onSelectionChange = (rows) => {
  selectedIds.value = (rows || []).map((r) => r._id).filter(Boolean)
}

const onFilter = () => {
  query.page = 1
  load()
}

const onPage = (p) => {
  query.page = p
  load()
}

const openEdit = async (row) => {
  try {
    const d = await api.getOaDraft(row._id)
    editingId.value = row._id
    Object.assign(form, {
      title: d.title || '',
      digest: d.digest || '',
      author: d.author || '',
      coverUrl: d.coverUrl || '',
      imageUrls: imagesOf(d),
      miniprogramPath: d.miniprogramPath || '',
      markdown: ensureHeroImage(stripPromoFooter(d.markdown || ''), d.coverUrl || ''),
      error: d.error || '',
      brandKey: d.brandKey || '',
      timeline: Array.isArray(d.pushTimeline) ? d.pushTimeline.slice().reverse() : []
    })
    visible.value = true
    warmOaImageList(form.imageUrls, proxyMap).catch(() => null)
  } catch (e) {
    ElMessage.error(e.message || '读取失败')
  }
}

// 剥掉兜底稿引导语行（"> 自动生成暂不可用…请人工改写后保存再推送。"），
// 用户改写后常忘删这行，以前会被关键词判定永远打回「需改写」
const stripFallbackNotice = (md) =>
  String(md || '')
    .split('\n')
    .filter((line) => !/自动生成暂不可用|以下为素材整理稿|请人工改写后|需人工改写后/.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

/** 剥掉旧硬广结语（—— 火星… / 打开小程序…），避营销推广限流 */
const stripPromoFooter = (md) => {
  let s = String(md || '')
  for (let i = 0; i < 3; i++) {
    const next = s
      .replace(
        /\n*(?:---|\*\*\*|___)\s*\n+(?:——\s*)?火星(?:探索日志|空间探索)[^\n]*(?:\n+[^\n]*){0,3}\s*$/u,
        ''
      )
      .replace(/\n*(?:——\s*)?火星(?:探索日志|空间探索)\s*\n+[^#\n]*(?:小程序|打开小程序)[^\n]*\s*$/u, '')
      .replace(/\n+想追火箭和深空任务[^\n]*\s*$/u, '')
      .replace(/\n+小程序里能看发射[^\n]*\s*$/u, '')
    if (next === s) break
    s = next
  }
  return s.replace(/\n{3,}$/g, '\n\n').replace(/\s+$/u, '')
}

/** 单图 / 无图仅封面 → 头图置顶 */
const ensureHeroImage = (md, coverUrl = '') => {
  let body = String(md || '').replace(/\n{3,}/g, '\n\n').trim()
  const imgRe = /!\[([^\]]*)\]\((https?:\/\/[^)\s]+)(?:\s+"[^"]*")?\)/gi
  const images = []
  let m
  while ((m = imgRe.exec(body))) {
    images.push({ full: m[0], index: m.index, len: m[0].length })
  }
  if (images.length > 1) return body
  if (images.length === 1) {
    const img = images[0]
    if (!body.slice(0, img.index).trim()) return body
    const without = (body.slice(0, img.index) + body.slice(img.index + img.len))
      .replace(/\n{3,}/g, '\n\n')
      .trim()
    const hero = img.full.replace(/^!\[([^\]]*)\]/, '![头图]')
    return `${hero}\n\n${without}`.replace(/\n{3,}/g, '\n\n').trim()
  }
  const cover = String(coverUrl || '').trim()
  if (/^https?:\/\//i.test(cover)) {
    return `![头图](${cover})\n\n${body}`.replace(/\n{3,}/g, '\n\n').trim()
  }
  return body
}
const onSave = async () => {
  saving.value = true
  try {
    const cleaned = ensureHeroImage(
      stripPromoFooter(stripFallbackNotice(form.markdown)),
      form.coverUrl || ''
    )
    form.markdown = cleaned
    await api.updateOaDraft(editingId.value, {
      title: form.title,
      digest: form.digest,
      author: form.author,
      coverUrl: form.coverUrl,
      miniprogramPath: form.miniprogramPath,
      markdown: cleaned,
      brandKey: form.brandKey,
      // 是否真的改写由后端与原素材比对判定；照搬会被后端打回并提示
      status: 'ready',
      error: ''
    })
    ElMessage.success('已保存，可推送微信草稿')
    visible.value = false
    load()
  } catch (e) {
    const msg = String((e && e.message) || e || '')
    if (/仍与原素材基本相同|实质改写/.test(msg)) {
      ElMessage({
        type: 'warning',
        duration: 8000,
        showClose: true,
        message: '正文仍与原素材基本相同，需实质改写后才能标为待审核（当前修改未保存）'
      })
    } else {
      ElMessage.error(msg || '保存失败')
    }
  } finally {
    saving.value = false
  }
}

const waitPushSettle = async (id, { seconds = 120 } = {}) => {
  const deadline = Date.now() + seconds * 1000
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000))
    try {
      await load({ silent: true })
    } catch (e) {}
    const row = (list.value || []).find((r) => r._id === id)
    if (!row) continue
    if (row.status === 'pushed_to_wechat' && row.wxMediaId) return { ok: true, row }
    if (row.status !== 'pushing' && row.error) return { ok: false, row }
  }
  return { ok: false, row: (list.value || []).find((r) => r._id === id) }
}

const onPrepare = async (row) => {
  busyId.value = row._id + ':prep'
  try {
    // 已卡在 3/5 一类状态：强制跳过坏图，完成就绪
    const stuck =
      Number(row.imagePrepAttempts || 0) >= 1 ||
      /转存中|尚未就绪|3\/5|未转存成功/i.test(String(row.error || '')) ||
      (row.imagePrepStats &&
        row.imagePrepStats.pending > 0 &&
        row.imagePrepStats.ready > 0)
    const res = await api.prepareOaDraftImages(row._id, stuck ? { forceSkip: true } : {})
    if (res && res.imagesReady) {
      ElMessage.success(
        res.dropped
          ? `配图已就绪（成功 ${res.ready || 0} 张，跳过 ${res.dropped} 张坏图），可以推微信`
          : '配图已全部转存就绪，可以推微信'
      )
    } else {
      ElMessage.warning(
        res && res.pending != null
          ? `仍有 ${res.pending} 张未成功。再点一次「转存配图」将跳过坏图并就绪`
          : '配图转存未完成，请再点一次「转存配图」'
      )
      ensurePushPoll()
    }
    await load()
  } catch (e) {
    ElMessage.error(e.message || '转存失败')
    await load()
  } finally {
    busyId.value = ''
  }
}

const doPush = async (row, force = false) => {
  busyId.value = row._id + ':push'
  try {
    const res = await api.pushOaDraft(row._id, force ? { force: true } : {})
    if (res && res.preparing) {
      ElMessage.warning(res.message || '正在转存配图，就绪后再推送')
      ensurePushPoll()
      await load()
      return
    }
    if (res && res.async) {
      ElMessage.info(res.message || '正在写入微信草稿箱…')
      ensurePushPoll()
      const settled = await waitPushSettle(row._id)
      if (settled.ok) {
        ElMessage.success('已推送微信草稿箱')
      } else if (settled.row && settled.row.error) {
        ElMessage.error(errorLabel(settled.row.error))
      } else {
        ElMessage.warning('仍在处理，请稍后刷新')
      }
      await load()
      return
    }
    ElMessage.success('已推送微信草稿箱')
    await load()
  } catch (e) {
    if (e && e.code === 4090) {
      try {
        await ElMessageBox.confirm(
          (e.message || '该草稿正在推送中') + '\n确认强制重试？',
          '推送中',
          { type: 'warning', confirmButtonText: '强制重试', cancelButtonText: '取消' }
        )
        await doPush(row, true)
      } catch (e2) {
        if (e2 !== 'cancel') ElMessage.error(e2.message || '推送失败')
      }
      return
    }
    const msg = String((e && e.message) || e || '')
    if (/Failed to fetch|NetworkError|network|fetch/i.test(msg)) {
      ElMessage.warning(
        '请求已发出。正在后台上传配图，请稍候看列表状态；失败后再点推送可续传。'
      )
      ensurePushPoll()
      await waitPushSettle(row._id, { seconds: 90 })
      await load()
      return
    }
    ElMessage.error(msg || '推送失败')
    await load()
  } finally {
    busyId.value = ''
  }
}

const onPush = async (row) => {
  try {
    const stuck =
      row.status === 'pushing' ||
      row.status === 'push_failed' ||
      (row.error && /推送未完成|推送超时|推送失败/i.test(row.error))
    await ElMessageBox.confirm(
      stuck
        ? '该稿上次推送未成功，确认重新推送到微信草稿箱？'
        : row.imagesReady || row.imagePrepStatus === 'ready' || row.imagePrepStatus === 'partial'
          ? '配图已就绪，确认写入微信公众号草稿箱？（不会直接群发）'
          : '配图尚未转存完成。将先尝试转存；若未就绪请先点「转存配图」，就绪后再推。',
      '推微信草稿',
      {
        type: stuck ? 'warning' : 'info',
        confirmButtonText: stuck ? '重新推送' : '推送',
        cancelButtonText: '取消'
      }
    )
    await doPush(row, stuck)
  } catch (e) {
    if (e !== 'cancel') ElMessage.error(e.message || '推送失败')
  }
}

const onPublish = async (row) => {
  try {
    await ElMessageBox.confirm(
      '确认发布到公众号？仅对已推送到微信草稿箱的稿件生效。',
      '确认发稿',
      {
      type: 'warning',
      confirmButtonText: '发稿',
      cancelButtonText: '取消'
    })
    busyId.value = row._id + ':publish'
    await api.publishOaDraft(row._id)
    ElMessage.success('已提交发布')
    load()
  } catch (e) {
    if (e !== 'cancel') ElMessage.error(e.message || '发布失败')
  } finally {
    busyId.value = ''
  }
}

const onReject = async (row) => {
  try {
    await ElMessageBox.confirm('将该稿标记为拒绝？', '拒绝', { type: 'warning' })
    await api.rejectOaDraft(row._id, { reason: '人工拒绝' })
    ElMessage.success('已拒绝')
    load()
  } catch (e) {
    if (e !== 'cancel') ElMessage.error(e.message || '操作失败')
  }
}

const onDelete = async (row) => {
  try {
    await ElMessageBox.confirm('删除该草稿？此操作不可恢复。', '删除', { type: 'warning' })
    await api.deleteOaDraft(row._id)
    ElMessage.success('已删除')
    load()
  } catch (e) {
    if (e !== 'cancel') ElMessage.error(e.message || '删除失败')
  }
}

const onBatchDelete = async () => {
  if (!selectedIds.value.length) return
  try {
    await ElMessageBox.confirm(
      `确认删除选中的 ${selectedIds.value.length} 条草稿？此操作不可恢复。`,
      '批量删除',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
    )
    batchDeleting.value = true
    const res = await api.batchDeleteOaDrafts(selectedIds.value)
    const deleted = res?.deleted ?? 0
    const failed = res?.failed ?? 0
    if (failed) ElMessage.warning(`删除完成：成功 ${deleted}，失败 ${failed}`)
    else ElMessage.success(`已删除 ${deleted} 条`)
    await load()
  } catch (e) {
    if (e !== 'cancel') ElMessage.error(e.message || '批量删除失败')
  } finally {
    batchDeleting.value = false
  }
}

const route = useRoute()
const router = useRouter()

onMounted(async () => {
  await loadBrands()
  await load()
  // 深链：/oa-content/drafts?id=xxx 直接打开该稿编辑
  const deepId = String(route.query.id || '').trim()
  if (deepId) {
    router.replace({ query: { ...route.query, id: undefined } }).catch(() => null)
    openEdit({ _id: deepId })
  }
})

onUnmounted(() => {
  stopPushPoll()
})
</script>

<style scoped>
.hdr {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.hdr-left {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.hdr-title {
  font-weight: 600;
}
.acts {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}
.acts :deep(.batch-del-btn) {
  border: 0 !important;
  border-radius: 8px !important;
  background: rgba(255, 69, 58, 0.18) !important;
  color: #ff6961 !important;
  font-weight: 500;
}
.acts :deep(.batch-del-btn:hover) {
  background: rgba(255, 69, 58, 0.3) !important;
  color: #ff8a84 !important;
}
.acts :deep(.batch-del-btn.is-disabled) {
  opacity: 0.38;
  color: #ff6961 !important;
}

.draft-main {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  min-width: 0;
}
.draft-thumbs {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  max-width: 220px;
  flex-shrink: 0;
}
.draft-cover {
  width: 52px;
  height: 40px;
  border-radius: 5px;
  flex-shrink: 0;
  background: rgba(255, 255, 255, 0.04);
  cursor: zoom-in;
}
.draft-cover--empty {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  color: var(--el-text-color-placeholder);
  border: 1px dashed rgba(255, 255, 255, 0.12);
  width: 64px;
  height: 48px;
}
.draft-thumbs--edit {
  max-width: 100%;
  gap: 8px;
}
.draft-cover--lg {
  width: 96px;
  height: 72px;
}
.draft-meta {
  min-width: 0;
  flex: 1;
}
.draft-title {
  font-weight: 600;
  line-height: 1.35;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.draft-sub {
  margin-top: 4px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  display: flex;
  flex-wrap: wrap;
  gap: 2px 0;
  align-items: center;
}
.draft-sub .dot {
  margin: 0 6px;
  opacity: 0.5;
}
.draft-err {
  margin-top: 4px;
  font-size: 12px;
  color: var(--el-color-danger);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 360px;
}
.draft-note {
  margin-top: 4px;
  font-size: 12px;
  color: var(--el-color-warning);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 360px;
}
.time-cell {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.4;
}

.ops {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 6px;
  max-width: 400px;
}

/* 深色主题下 EP 把 --el-color-white 映射成深色，彩色实心钮会「同色字」；此处强制反色对比 */
.ops :deep(.ops-btn) {
  margin: 0 !important;
  border: 0 !important;
  border-radius: 8px !important;
  font-weight: 500;
  box-shadow: none !important;
  background-image: none !important;
}
.ops :deep(.ops-btn span) {
  color: inherit !important;
}
.ops :deep(.ops-btn.is-disabled),
.ops :deep(.ops-btn.is-disabled:hover) {
  opacity: 0.38;
  cursor: not-allowed;
}

.ops :deep(.ops-btn--muted) {
  background: rgba(255, 255, 255, 0.1) !important;
  color: rgba(255, 255, 255, 0.88) !important;
}
.ops :deep(.ops-btn--muted:hover) {
  background: rgba(255, 255, 255, 0.16) !important;
  color: #fff !important;
}

.ops :deep(.ops-btn--primary) {
  background: #0a84ff !important;
  color: #fff !important;
}
.ops :deep(.ops-btn--primary:hover) {
  background: #409cff !important;
  color: #fff !important;
}

.ops :deep(.ops-btn--success) {
  background: #1f9d55 !important;
  color: #fff !important;
}
.ops :deep(.ops-btn--success:hover) {
  background: #28b463 !important;
  color: #fff !important;
}

.ops :deep(.ops-btn--warn) {
  background: rgba(255, 159, 10, 0.18) !important;
  color: #ffb340 !important;
}
.ops :deep(.ops-btn--warn:hover) {
  background: rgba(255, 159, 10, 0.28) !important;
  color: #ffd08a !important;
}

.ops :deep(.ops-btn--danger) {
  background: rgba(255, 69, 58, 0.18) !important;
  color: #ff6961 !important;
}
.ops :deep(.ops-btn--danger:hover) {
  background: rgba(255, 69, 58, 0.3) !important;
  color: #ff8a84 !important;
}

.pager {
  display: flex;
  justify-content: flex-end;
  margin-top: 14px;
}
.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.draft-timeline {
  padding-left: 4px;
  width: 100%;
}
.tl-detail {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  word-break: break-all;
}
</style>
