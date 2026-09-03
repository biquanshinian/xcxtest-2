<template>
  <el-card class="oa-drafts">
    <template #header>
      <div class="hdr">
        <div class="hdr-left">
          <span class="hdr-title">内容中台 · 草稿箱</span>
          <el-text type="info" size="small">一文多端：微信长文 / 小红书竖版 · 预览后选择性发布</el-text>
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
          <el-button type="primary" plain @click="openImport">导入成品（不洗稿）</el-button>
          <el-button @click="load" :loading="loading">刷新</el-button>
        </div>
      </div>
    </template>

    <!-- 桌面：表格 -->
    <el-table
      v-if="!isMobile"
      :data="list"
      stripe
      v-loading="loading"
      class="draft-table"
      row-key="_id"
      @selection-change="onSelectionChange"
    >
      <el-table-column type="selection" width="46" />
      <el-table-column label="发稿号" width="120" class-name="col-desktop">
        <template #default="{ row }">
          <el-tag size="small" effect="plain">{{ row.brandName || row.brandKey || '—' }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="稿件" min-width="220">
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
                <el-tag
                  v-if="videosOf(row).length"
                  size="small"
                  type="warning"
                  effect="plain"
                  style="margin-left:4px;cursor:pointer;"
                  title="点击播放视频"
                  @click.stop="playDraftVideo(row)"
                >▶ 视频×{{ videosOf(row).length }}{{ hasLongVideos(row) ? '（长）' : '' }}</el-tag>
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

      <el-table-column label="平台" width="168" align="center" class-name="col-desktop">
        <template #default="{ row }">
          <div class="plat-badges">
            <el-tag size="small" effect="plain" type="primary">微信·{{ wechatBadge(row) }}</el-tag>
            <el-tag size="small" effect="plain" :type="xhsBadgeType(row)">小红书·{{ xhsBadge(row) }}</el-tag>
          </div>
        </template>
      </el-table-column>

      <el-table-column label="时间" width="158" class-name="col-desktop">
        <template #default="{ row }">
          <div class="time-cell">{{ fmt(row.createdAt) }}</div>
        </template>
      </el-table-column>

      <el-table-column label="操作" min-width="160" fixed="right" align="right" class-name="col-ops">
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

    <!-- 手机：卡片列表，操作按钮完整可见（避免 fixed 列被裁切） -->
    <div v-if="isMobile" class="draft-cards" v-loading="loading">
      <div v-if="!loading && !list.length" class="draft-cards-empty">暂无草稿</div>
      <div v-for="row in list" :key="row._id" class="draft-card">
        <div class="draft-card-top">
          <el-checkbox
            :model-value="selectedIds.includes(row._id)"
            @change="(v) => toggleSelect(row._id, v)"
          />
          <div class="draft-card-cover">
            <el-image
              v-if="imagesOf(row).length"
              :src="thumbSrc(imagesOf(row)[0])"
              :preview-src-list="imagesOf(row).map(thumbSrc)"
              fit="cover"
              class="draft-cover draft-cover--card"
              preview-teleported
              hide-on-click-modal
            />
            <div v-else class="draft-cover draft-cover--empty">无封面</div>
          </div>
          <div class="draft-card-meta">
            <div class="draft-title" :title="row.title">{{ row.title || '未命名' }}</div>
            <div class="draft-card-tags">
              <el-tag :type="statusType(row.status)" size="small" effect="plain">{{ statusLabel(row.status) }}</el-tag>
              <el-tag size="small" effect="plain" :type="prepTagType(row)">{{ prepLabel(row) }}</el-tag>
            </div>
            <div v-if="row.error" class="draft-err" :title="row.error">{{ errorLabel(row.error) }}</div>
          </div>
        </div>
        <div class="ops ops--card">
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
      </div>
    </div>

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
      title="编辑草稿 · 多平台"
      width="92%"
      top="3vh"
      append-to-body
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
        <el-form-item v-if="form.videos.length" label="视频素材">
          <div class="video-list">
            <div v-for="(v, i) in form.videos" :key="`vid-${i}`" class="video-item">
              <video
                v-if="playableVideoSrc(v)"
                :src="playableVideoSrc(v)"
                :poster="thumbSrc(v.posterUrl)"
                controls
                playsinline
                preload="metadata"
                class="draft-video"
              />
              <el-image
                v-else-if="v.posterUrl"
                :src="thumbSrc(v.posterUrl)"
                :preview-src-list="[thumbSrc(v.posterUrl)]"
                fit="cover"
                class="draft-cover draft-cover--lg"
                preview-teleported
                hide-on-click-modal
              />
              <div class="video-meta">
                <el-tag size="small" :type="v.isLong ? 'warning' : 'info'" effect="plain">
                  {{ v.isLong ? '长视频' : '视频' }}
                </el-tag>
                <el-link
                  v-if="videoLink(v)"
                  :href="videoLink(v)"
                  target="_blank"
                  type="primary"
                >打开原链</el-link>
              </div>
            </div>
          </div>
          <el-text size="small" type="info">
            公众号正文不能直接塞外链 mp4。成稿里封面可点进小程序该事件详情；「阅读原文」走微信打得开的中转页（不挂 X/Twitter）。过期约 3 天后读者会看到下架提示。
          </el-text>
        </el-form-item>
        <el-form-item v-if="readMoreUrl" label="阅读原文">
          <el-link :href="readMoreUrl" target="_blank" type="primary">{{ readMoreUrl }}</el-link>
        </el-form-item>
        <el-form-item label="小程序 path">
          <el-input v-model="form.miniprogramPath" placeholder="按选题自动落到事件/任务/文章详情" />
          <el-text size="small" type="info">
            事件稿进事件详情（绑定该事件 ID），发射稿进任务详情，新闻稿进文章详情。视频封面也进同一事件页。留空或填首页时推送会按选题自动改写。
          </el-text>
        </el-form-item>

        <el-tabs v-model="editTab" class="plat-tabs">
          <el-tab-pane label="源稿" name="source">
            <el-input v-model="form.markdown" type="textarea" :rows="20" placeholder="共用 Markdown 源稿" />
          </el-tab-pane>
          <el-tab-pane label="微信" name="wechat">
            <el-form-item label="排版主题">
              <div class="theme-board">
                <div v-for="cat in themeCategories" :key="`edit-${cat}`" class="theme-row">
                  <span class="theme-cat">{{ cat }}</span>
                  <div class="theme-chips">
                    <button
                      v-for="t in themesByCategory(cat)"
                      :key="t.id"
                      type="button"
                      class="theme-chip"
                      :class="{ 'is-active': form.themeId === t.id }"
                      @click="onPickTheme(t.id, 'edit')"
                    >
                      <i class="theme-dot" :style="{ background: t.accent || '#999' }" />
                      <span>{{ t.name }}</span>
                    </button>
                  </div>
                </div>
              </div>
            </el-form-item>
            <div class="split-pane">
              <el-input v-model="form.markdown" type="textarea" :rows="22" class="split-md" />
              <div class="split-preview">
                <div class="preview-bar">
                  <span>
                    微信预览 ·
                    <b class="preview-theme-name">{{ themeLabel(form.themeId) }}</b>
                    <i class="preview-theme-dot" :style="{ background: themeAccent(form.themeId) }" />
                  </span>
                  <el-text v-if="previewLoading" size="small" type="info">全主题渲染中…</el-text>
                  <el-text v-else-if="previewThemeCount" size="small" type="success">
                    已缓存 {{ previewThemeCount }} 套 · 切换瞬时
                  </el-text>
                </div>
                <div ref="editPreviewScrollEl" class="preview-scroll">
                  <div
                    v-for="tid in previewThemeIds"
                    :key="`edit-${tid}`"
                    class="theme-preview"
                    :data-theme="tid"
                    v-show="form.themeId === tid"
                    v-html="editThemeHtmlMap[tid] || ''"
                  ></div>
                  <div
                    v-if="!previewLoading && !editThemeHtmlMap[form.themeId]"
                    class="preview-empty"
                  >粘贴 Markdown 后自动预渲染全部主题，切换无等待</div>
                </div>
              </div>
            </div>
          </el-tab-pane>
          <el-tab-pane label="小红书" name="xhs">
            <div class="xhs-toolbar">
              <el-button size="small" :loading="xhsDeriving" @click="onDeriveXhs">从源稿生成变体</el-button>
              <el-button size="small" type="success" plain :loading="xhsExporting" @click="onExportXhs">导出发布包</el-button>
              <el-link
                v-if="xhsForm.exportPackageUrl"
                :href="xhsForm.exportPackageUrl"
                target="_blank"
                type="primary"
              >下载上次导出</el-link>
              <el-tag size="small" effect="plain">{{ xhsForm.status || 'draft' }}</el-tag>
            </div>
            <div class="xhs-pane">
              <div class="xhs-edit">
                <el-form-item label="笔记标题">
                  <el-input v-model="xhsForm.title" maxlength="20" show-word-limit placeholder="≤20 字" />
                </el-form-item>
                <el-form-item label="种草正文">
                  <el-input v-model="xhsForm.body" type="textarea" :rows="10" placeholder="口语短段，勿写站外导流" />
                </el-form-item>
                <el-form-item label="话题">
                  <el-input
                    v-model="xhsTopicsText"
                    type="textarea"
                    :rows="2"
                    placeholder="空格或逗号分隔，如：火箭发射 航天科普"
                  />
                </el-form-item>
                <el-form-item label="置顶评论">
                  <el-input v-model="xhsForm.pinnedComment" maxlength="200" show-word-limit />
                </el-form-item>
                <el-form-item label="竖图 URL">
                  <el-input
                    v-model="xhsImagesText"
                    type="textarea"
                    :rows="4"
                    placeholder="每行一个 https 图片（建议 3:4）"
                  />
                </el-form-item>
              </div>
              <div class="xhs-preview-wrap">
                <div class="preview-bar">
                  <span>小红书预览（亮色手机框）</span>
                  <el-text size="small" type="info">
                    3:4 · {{ xhsImageList.length || 0 }} 张
                    <template v-if="xhsImageList.length > 1"> · 左右切换</template>
                  </el-text>
                </div>
                <div class="xhs-phone">
                  <div class="xhs-phone-screen">
                    <div class="xhs-cover">
                      <template v-if="xhsImageList.length">
                        <img :src="thumbSrc(xhsImageList[xhsSlideIndex] || xhsImageList[0])" alt="" />
                        <button
                          v-if="xhsImageList.length > 1"
                          type="button"
                          class="xhs-nav xhs-nav-prev"
                          @click="xhsSlideIndex = (xhsSlideIndex - 1 + xhsImageList.length) % xhsImageList.length"
                        >‹</button>
                        <button
                          v-if="xhsImageList.length > 1"
                          type="button"
                          class="xhs-nav xhs-nav-next"
                          @click="xhsSlideIndex = (xhsSlideIndex + 1) % xhsImageList.length"
                        >›</button>
                        <div v-if="xhsImageList.length > 1" class="xhs-pager">
                          {{ xhsSlideIndex + 1 }}/{{ xhsImageList.length }}
                        </div>
                        <div v-if="xhsImageList.length > 1" class="xhs-dots">
                          <button
                            v-for="(u, i) in xhsImageList"
                            :key="`${i}-${u}`"
                            type="button"
                            class="xhs-dot"
                            :class="{ 'is-on': i === xhsSlideIndex, 'is-cover': i === xhsCoverIndex }"
                            :title="i === xhsCoverIndex ? '封面' : `第 ${i + 1} 张`"
                            @click="xhsSlideIndex = i"
                          />
                        </div>
                      </template>
                      <div v-else class="xhs-cover-empty">无封面</div>
                    </div>
                    <div v-if="xhsImageList.length > 1" class="xhs-strip">
                      <button
                        v-for="(u, i) in xhsImageList"
                        :key="`strip-${i}`"
                        type="button"
                        class="xhs-strip-item"
                        :class="{ 'is-on': i === xhsSlideIndex }"
                        @click="xhsSlideIndex = i; xhsForm.coverIndex = i"
                      >
                        <img :src="thumbSrc(u)" alt="" />
                        <span v-if="i === xhsCoverIndex" class="xhs-strip-cover">封面</span>
                      </button>
                    </div>
                    <div class="xhs-note">
                      <div class="xhs-note-title">{{ xhsForm.title || '未命名笔记' }}</div>
                      <div class="xhs-note-body">{{ xhsForm.body || '正文预览…' }}</div>
                      <div class="xhs-note-topics">
                        <span v-for="t in xhsTopicList" :key="t">#{{ t }}</span>
                      </div>
                      <div v-if="xhsForm.pinnedComment" class="xhs-pin">置顶：{{ xhsForm.pinnedComment }}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </el-tab-pane>
        </el-tabs>

        <el-form-item v-if="form.error" label="错误" style="margin-top:12px">
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

    <el-dialog
      v-model="importVisible"
      title="导入成品稿（不洗稿）"
      width="92%"
      top="3vh"
      append-to-body
      destroy-on-close
      class="draft-dialog"
    >
      <el-alert
        type="info"
        :closable="false"
        show-icon
        style="margin-bottom:12px"
        title="直接入库草稿箱，不走 AI 洗稿。配图请填可公网访问的 https 链接；保存后可转存再推微信。"
      />
      <el-form :model="importForm" label-width="96px">
        <el-form-item label="发稿号">
          <el-select v-model="importForm.brandKey" style="width:240px">
            <el-option v-for="b in brands" :key="b.key" :label="b.name" :value="b.key" />
          </el-select>
        </el-form-item>
        <el-form-item label="标题"><el-input v-model="importForm.title" placeholder="可空，默认取 Markdown 首行 # 标题" /></el-form-item>
        <el-form-item label="封面 URL"><el-input v-model="importForm.coverUrl" placeholder="https://..." /></el-form-item>
        <el-form-item label="配图 URL">
          <el-input
            v-model="importForm.imageUrlsText"
            type="textarea"
            :rows="2"
            placeholder="每行一个 https 图片地址（可选）"
          />
        </el-form-item>
        <el-form-item label="排版主题">
          <div class="theme-board">
            <div v-for="cat in themeCategories" :key="`imp-${cat}`" class="theme-row">
              <span class="theme-cat">{{ cat }}</span>
              <div class="theme-chips">
                <button
                  v-for="t in themesByCategory(cat)"
                  :key="t.id"
                  type="button"
                  class="theme-chip"
                  :class="{ 'is-active': importForm.themeId === t.id }"
                  @click="onPickTheme(t.id, 'import')"
                >
                  <i class="theme-dot" :style="{ background: t.accent || '#999' }" />
                  <span>{{ t.name }}</span>
                </button>
              </div>
            </div>
          </div>
        </el-form-item>
        <el-form-item label="正文 / 预览">
          <div class="split-pane">
            <el-input v-model="importForm.markdown" type="textarea" :rows="22" class="split-md" placeholder="粘贴成品 Markdown…" />
            <div class="split-preview">
              <div class="preview-bar">
                <span>
                  实时预览 ·
                  <b class="preview-theme-name">{{ themeLabel(importForm.themeId) }}</b>
                  <i class="preview-theme-dot" :style="{ background: themeAccent(importForm.themeId) }" />
                </span>
                <el-text v-if="importPreviewLoading" size="small" type="info">全主题渲染中…</el-text>
                <el-text v-else-if="importThemeCount" size="small" type="success">
                  已缓存 {{ importThemeCount }} 套 · 切换瞬时
                </el-text>
              </div>
              <div ref="importPreviewScrollEl" class="preview-scroll">
                <div
                  v-for="tid in previewThemeIds"
                  :key="`imp-${tid}`"
                  class="theme-preview"
                  :data-theme="tid"
                  v-show="importForm.themeId === tid"
                  v-html="importThemeHtmlMap[tid] || ''"
                ></div>
                <div
                  v-if="!importPreviewLoading && !importThemeHtmlMap[importForm.themeId]"
                  class="preview-empty"
                >粘贴 Markdown 后自动预渲染全部主题，切换无等待</div>
              </div>
            </div>
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <div class="dialog-footer">
          <el-button @click="importVisible = false">取消</el-button>
          <el-button type="primary" :loading="importing" @click="onImport">入库草稿箱</el-button>
        </div>
      </template>
    </el-dialog>
  </el-card>
</template>

<script setup>
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from '../../api/client'
import { displayOaImage, warmOaImageList } from '../../utils/oaImageProxy'
import { previewMedia } from '../../utils/mediaPreview'

const list = ref([])
const total = ref(0)
const loading = ref(false)
const saving = ref(false)
const visible = ref(false)
const importVisible = ref(false)
const importing = ref(false)
const status = ref('')
const brandKey = ref('')
const brands = ref([])
const themes = ref([])
const editingId = ref('')
const busyId = ref('')
const selectedIds = ref([])
const batchDeleting = ref(false)
const isMobile = ref(
  typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(max-width: 768px)').matches
    : false
)
let mobileMq = null
const onMobileMq = () => {
  isMobile.value = !!(mobileMq && mobileMq.matches)
}
const toggleSelect = (id, checked) => {
  const sid = String(id || '')
  if (!sid) return
  const set = new Set(selectedIds.value)
  if (checked) set.add(sid)
  else set.delete(sid)
  selectedIds.value = [...set]
}
const editTab = ref('wechat')
const xhsDeriving = ref(false)
const xhsExporting = ref(false)
const query = reactive({ page: 1, pageSize: 20 })
const form = reactive({
  title: '',
  digest: '',
  author: '',
  coverUrl: '',
  imageUrls: [],
  videos: [],
  sourceUrl: '',
  sourceId: '',
  sourceType: '',
  miniprogramPath: '',
  markdown: '',
  themeId: 'bytedance',
  error: '',
  brandKey: '',
  timeline: [],
  platforms: ['wechat']
})
const xhsForm = reactive({
  title: '',
  body: '',
  topics: [],
  pinnedComment: '',
  images: [],
  coverIndex: 0,
  status: 'draft',
  exportPackageUrl: ''
})
const xhsTopicsText = ref('')
const xhsImagesText = ref('')
const xhsSlideIndex = ref(0)
const xhsTopicList = computed(() =>
  String(xhsTopicsText.value || '')
    .split(/[\s,，#]+/)
    .map((s) => s.trim())
    .filter(Boolean)
)
const xhsImageList = computed(() =>
  String(xhsImagesText.value || '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => /^https?:\/\//i.test(s))
    .slice(0, 9)
)
const xhsCoverIndex = computed(() => {
  const n = xhsImageList.value.length
  if (!n) return 0
  return Math.min(Math.max(0, Number(xhsForm.coverIndex) || 0), n - 1)
})
const xhsCoverUrl = computed(() => xhsImageList.value[xhsCoverIndex.value] || '')
const importForm = reactive({
  brandKey: '',
  title: '',
  coverUrl: '',
  imageUrlsText: '',
  themeId: 'bytedance',
  markdown: ''
})
const previewLoading = ref(false)
const importPreviewLoading = ref(false)
/** themeId → HTML（画廊式预渲染；切主题只改 display） */
const editThemeHtmlMap = reactive({})
const importThemeHtmlMap = reactive({})
const previewThemeIds = computed(() => {
  const ids = (themes.value || []).map((t) => t.id).filter(Boolean)
  return ids.length ? ids : ['bytedance', 'clean']
})
const previewThemeCount = computed(() => Object.keys(editThemeHtmlMap).filter((k) => editThemeHtmlMap[k]).length)
const importThemeCount = computed(() =>
  Object.keys(importThemeHtmlMap).filter((k) => importThemeHtmlMap[k]).length
)
const editPreviewScrollEl = ref(null)
const importPreviewScrollEl = ref(null)
const themeLabel = (id) => {
  const hit = (themes.value || []).find((t) => t.id === id)
  return (hit && hit.name) || id || '—'
}
const themeAccent = (id) => {
  const hit = (themes.value || []).find((t) => t.id === id)
  return (hit && hit.accent) || '#2f6bff'
}
/** url → 代理后 dataURL，打破微信防盗链占位图 */
const proxyMap = reactive({})
const thumbSrc = (url) => displayOaImage(url, proxyMap)
let pushPollTimer = null
let previewTimer = null
let importPreviewTimer = null
/** Markdown 变更批量预渲染的序号；换主题不发请求 */
let editPreviewSeq = 0
let importPreviewSeq = 0

const clearThemeMap = (map) => {
  Object.keys(map).forEach((k) => {
    delete map[k]
  })
}
const fillThemeMap = (map, themesObj) => {
  clearThemeMap(map)
  const src = themesObj && typeof themesObj === 'object' ? themesObj : {}
  Object.keys(src).forEach((k) => {
    map[k] = src[k] || ''
  })
}

const themeCategories = computed(() => {
  const order = ['内置', '深度长文', '科技产品', '文艺随笔', '活力动态', '模板布局']
  const present = new Set((themes.value || []).map((t) => t.category || '其他'))
  return order.filter((c) => present.has(c)).concat(
    [...present].filter((c) => !order.includes(c))
  )
})
const themesByCategory = (cat) =>
  (themes.value || []).filter((t) => (t.category || '其他') === cat)

const fmt = (t) => (t ? new Date(t).toLocaleString() : '-')

const timelineLabel = (e) =>
  ({
    generated: '已生成',
    generated_fallback: '生成（兜底整理稿）',
    generate_failed: '生成失败',
    imported: '成品导入',
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
    manual: '手动',
    imported: '成品导入'
  }[t] || t || '—')

const wechatBadge = (row) => {
  const s = row?.status
  if (s === 'published') return '已发'
  if (s === 'pushed_to_wechat') return '已推'
  if (s === 'ready' || s === 'needs_review') return '草稿'
  return statusLabel(s).slice(0, 4)
}
const xhsBadge = (row) => {
  const st = row?.variants?.xhs?.status
  if (st === 'exported') return '可导出'
  if (st === 'ready' || st === 'draft') return '已生成'
  if (row?.variants?.xhs?.title || row?.variants?.xhs?.body) return '已生成'
  return '未生成'
}
const xhsBadgeType = (row) => {
  const st = row?.variants?.xhs?.status
  if (st === 'exported') return 'success'
  if (st === 'ready' || st === 'draft' || row?.variants?.xhs?.title) return 'warning'
  return 'info'
}

const syncXhsTextFields = () => {
  xhsTopicsText.value = (xhsForm.topics || []).join(' ')
  xhsImagesText.value = (xhsForm.images || []).join('\n')
}
const collectXhsFromUi = () => ({
  title: xhsForm.title,
  body: xhsForm.body,
  pinnedComment: xhsForm.pinnedComment,
  coverIndex: xhsCoverIndex.value,
  status: xhsForm.status || 'draft',
  exportPackageUrl: xhsForm.exportPackageUrl || '',
  topics: xhsTopicList.value,
  images: xhsImageList.value
})
const applyXhsVariant = (xhs) => {
  Object.assign(xhsForm, {
    title: xhs?.title || '',
    body: xhs?.body || '',
    topics: Array.isArray(xhs?.topics) ? xhs.topics : [],
    pinnedComment: xhs?.pinnedComment || '',
    images: Array.isArray(xhs?.images) ? xhs.images : [],
    coverIndex: Number(xhs?.coverIndex) || 0,
    status: xhs?.status || 'draft',
    exportPackageUrl: xhs?.exportPackageUrl || ''
  })
  xhsSlideIndex.value = Math.min(
    Math.max(0, Number(xhs?.coverIndex) || 0),
    Math.max(0, (Array.isArray(xhs?.images) ? xhs.images : []).length - 1)
  )
  syncXhsTextFields()
}

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

/** 视频素材（封面截图 + 观看链接；长视频只有截图与链接） */
const videosOf = (row) =>
  Array.isArray(row?.videos)
    ? row.videos.filter((v) => v && (v.posterUrl || v.url || v.pageUrl || v.watchUrl))
    : []

const hasLongVideos = (row) => videosOf(row).some((v) => v.isLong)

const videoLink = (v) => v?.watchUrl || v?.url || v?.pageUrl || ''

const playableVideoSrc = (v) => {
  const cands = [v?.previewUrl, v?.watchUrl, v?.url]
  for (const u of cands) {
    const s = String(u || '').trim()
    if (/\.(mp4|mov|webm|m4v)(\?|$)/i.test(s)) return s
  }
  return ''
}

const OA_WATCH_BASE = 'https://api.marsx.com.cn/oa-watch'
const readMoreUrl = computed(() => {
  const id = String(form.sourceId || '').replace(/[^a-zA-Z0-9_-]/g, '')
  if (id && form.videos.length) return `${OA_WATCH_BASE}?e=${encodeURIComponent(id)}&i=0`
  const u = String(form.sourceUrl || '').trim()
  if (!u || !/^https?:\/\//i.test(u)) return ''
  if (/\.(mp4|mov|m4v|webm)(\?|$)/i.test(u)) return ''
  try {
    const host = new URL(u).hostname.replace(/^www\./, '').toLowerCase()
    if (
      host === 'x.com' ||
      host === 'twitter.com' ||
      host === 't.co' ||
      host.endsWith('.x.com') ||
      host.endsWith('.twitter.com')
    ) {
      return ''
    }
  } catch (e) {
    return ''
  }
  return u
})

const playDraftVideo = (row) => {
  const v = videosOf(row)[0]
  if (!v) return
  const url = videoLink(v)
  if (!url) return
  if (/\.(mp4|mov|webm|m4v)(\?|$)/i.test(url)) {
    previewMedia(url, { type: 'video', poster: v.posterUrl || '', title: row.title })
  } else {
    window.open(url, '_blank')
  }
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

const loadThemes = async () => {
  try {
    const res = await api.listOaThemes()
    themes.value = res?.list || []
  } catch (e) {
    themes.value = []
  }
}

const parseImageUrlsText = (text) =>
  String(text || '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => /^https?:\/\//i.test(s))

/** Markdown 变更时批量预渲染全主题；切主题不走网络（对标 gallery.html） */
const runPreview = async (mode) => {
  const isImport = mode === 'import'
  const md = isImport ? importForm.markdown : form.markdown
  const themeId = isImport ? importForm.themeId : form.themeId
  const brand = isImport ? importForm.brandKey : form.brandKey
  const coverUrl = isImport ? importForm.coverUrl : form.coverUrl
  const imageUrls = isImport ? parseImageUrlsText(importForm.imageUrlsText) : form.imageUrls
  const seq = isImport ? ++importPreviewSeq : ++editPreviewSeq
  const map = isImport ? importThemeHtmlMap : editThemeHtmlMap
  if (!String(md || '').trim()) {
    if (isImport ? seq === importPreviewSeq : seq === editPreviewSeq) clearThemeMap(map)
    return
  }
  if (isImport) importPreviewLoading.value = true
  else previewLoading.value = true
  try {
    const res = await api.previewOaAllThemes({
      markdown: md,
      themeId,
      title: isImport ? importForm.title : form.title,
      brandKey: brand || undefined,
      coverUrl: coverUrl || undefined,
      imageUrls,
      sourceId: isImport ? undefined : form.sourceId || undefined,
      sourceType: isImport ? undefined : form.sourceType || undefined,
      miniprogramPath: isImport ? undefined : form.miniprogramPath || undefined,
      videos: isImport ? undefined : form.videos,
      // 与推送组装一致：lead + 主题正文 + 小程序 CTA
      includeChrome: true
    })
    if (isImport ? seq !== importPreviewSeq : seq !== editPreviewSeq) return
    const packed = res?.themes || {}
    if (!Object.keys(packed).length) {
      throw new Error('预览返回空主题包，请刷新后重试')
    }
    fillThemeMap(map, packed)
  } catch (e) {
    if (isImport ? seq !== importPreviewSeq : seq !== editPreviewSeq) return
    clearThemeMap(map)
    // 回退：至少当前主题可预览，避免整片空白
    try {
      const one = await api.previewOaContent({
        markdown: md,
        themeId,
        title: isImport ? importForm.title : form.title,
        brandKey: brand || undefined,
        coverUrl: coverUrl || undefined,
        imageUrls,
        sourceId: isImport ? undefined : form.sourceId || undefined,
        sourceType: isImport ? undefined : form.sourceType || undefined,
        miniprogramPath: isImport ? undefined : form.miniprogramPath || undefined,
        videos: isImport ? undefined : form.videos,
        includeChrome: true
      })
      map[themeId || 'bytedance'] = one?.html || `<p style="color:#c00">${e.message || '预览失败'}</p>`
    } catch (e2) {
      map[themeId || 'bytedance'] =
        `<p style="color:#c00">${(e2 && e2.message) || e.message || '预览失败'}</p>`
    }
  } finally {
    if (isImport) {
      if (seq === importPreviewSeq) importPreviewLoading.value = false
    } else if (seq === editPreviewSeq) {
      previewLoading.value = false
    }
  }
}

const schedulePreview = (mode) => {
  if (mode === 'import') {
    clearTimeout(importPreviewTimer)
    importPreviewTimer = setTimeout(() => runPreview('import'), 420)
  } else {
    clearTimeout(previewTimer)
    previewTimer = setTimeout(() => runPreview('edit'), 420)
  }
}

/** 无缝切主题：只改当前显示，不重请求（对标 gallery switchTheme） */
const onPickTheme = (id, mode) => {
  if (mode === 'import') importForm.themeId = id
  else form.themeId = id
  const el = mode === 'import' ? importPreviewScrollEl.value : editPreviewScrollEl.value
  if (el) el.scrollTop = 0
  // 若该主题尚未缓存（全量渲染失败过），点选时补渲一套
  const map = mode === 'import' ? importThemeHtmlMap : editThemeHtmlMap
  if (!map[id]) schedulePreview(mode)
}

const openImport = () => {
  importForm.brandKey = brands.value[0]?.key || ''
  importForm.title = ''
  importForm.coverUrl = ''
  importForm.imageUrlsText = ''
  importForm.themeId = 'bytedance'
  importForm.markdown = ''
  clearThemeMap(importThemeHtmlMap)
  importVisible.value = true
}

const onImport = async () => {
  const md = String(importForm.markdown || '').trim()
  if (!md) {
    ElMessage.warning('请粘贴 Markdown 正文')
    return
  }
  importing.value = true
  try {
    const res = await api.importOaDraft({
      brandKey: importForm.brandKey || undefined,
      title: importForm.title || undefined,
      coverUrl: importForm.coverUrl || undefined,
      imageUrls: parseImageUrlsText(importForm.imageUrlsText),
      themeId: importForm.themeId,
      markdown: md
    })
    ElMessage.success(`已入库：${res?.title || '草稿'}（主题 ${res?.themeId || ''}）`)
    importVisible.value = false
    query.page = 1
    load()
  } catch (e) {
    ElMessage.error(e.message || '导入失败')
  } finally {
    importing.value = false
  }
}

watch(
  xhsImageList,
  (list) => {
    if (xhsSlideIndex.value >= list.length) {
      xhsSlideIndex.value = Math.max(0, list.length - 1)
    }
    if (list.length) warmOaImageList(list, proxyMap).catch(() => null)
  },
  { immediate: true }
)

// 主题不进 watch：切主题瞬时；仅正文/品牌/封面变化才批量预渲染
watch(
  () => [form.markdown, form.brandKey, form.coverUrl, visible.value],
  () => {
    if (visible.value) schedulePreview('edit')
  }
)
watch(
  () => [
    importForm.markdown,
    importForm.brandKey,
    importForm.coverUrl,
    importForm.imageUrlsText,
    importVisible.value
  ],
  () => {
    if (importVisible.value) schedulePreview('import')
  }
)

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
    editTab.value = 'wechat'
    Object.assign(form, {
      title: d.title || '',
      digest: d.digest || '',
      author: d.author || '',
      coverUrl: d.coverUrl || '',
      imageUrls: imagesOf(d),
      videos: videosOf(d),
      sourceUrl: d.sourceUrl || '',
      sourceId: d.sourceId || '',
      sourceType: d.sourceType || '',
      miniprogramPath: d.miniprogramPath || '',
      markdown: ensureHeroImage(stripPromoFooter(d.markdown || ''), d.coverUrl || ''),
      themeId: d.themeId || 'clean',
      error: d.error || '',
      brandKey: d.brandKey || '',
      timeline: Array.isArray(d.pushTimeline) ? d.pushTimeline.slice().reverse() : [],
      platforms: Array.isArray(d.platforms) && d.platforms.length ? d.platforms : ['wechat']
    })
    applyXhsVariant(d.variants?.xhs || {})
    visible.value = true
    schedulePreview('edit')
    warmOaImageList(form.imageUrls, proxyMap).catch(() => null)
  } catch (e) {
    ElMessage.error(e.message || '读取失败')
  }
}

const onDeriveXhs = async () => {
  if (!editingId.value) return
  xhsDeriving.value = true
  try {
    const res = await api.deriveOaXhs(editingId.value, {
      title: form.title,
      markdown: form.markdown,
      images: form.imageUrls,
      imageUrls: form.imageUrls
    })
    applyXhsVariant(res?.xhs || res?.variants?.xhs || {})
    if (!form.platforms.includes('xhs')) form.platforms = [...form.platforms, 'xhs']
    ElMessage.success('已生成小红书变体，可继续编辑')
    editTab.value = 'xhs'
  } catch (e) {
    ElMessage.error(e.message || '生成失败')
  } finally {
    xhsDeriving.value = false
  }
}

const onExportXhs = async () => {
  if (!editingId.value) return
  xhsExporting.value = true
  try {
    const payload = collectXhsFromUi()
    const res = await api.exportOaXhs(editingId.value, payload)
    applyXhsVariant(res?.xhs || { ...payload, status: 'exported', exportPackageUrl: res?.exportPackageUrl })
    if (res?.exportPackageUrl) {
      window.open(res.exportPackageUrl, '_blank')
    }
    ElMessage.success('已导出发布包到 COS')
  } catch (e) {
    ElMessage.error(e.message || '导出失败')
  } finally {
    xhsExporting.value = false
  }
}

// 剥掉兜底稿引导语行（"> 自动生成暂不可用…请人工改写后保存再推送。"），
// 用户改写后常忘删这行，以前会被关键词判定永远打回「需改写」
const stripFallbackNotice = (md) =>
  String(md || '')
    .split('\n')
    .filter((line) => !/自动生成暂不可用|自动生成未完成汉化|以下为素材整理稿|请人工改写后|需人工改写后/.test(line))
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
    const xhs = collectXhsFromUi()
    const platforms = Array.isArray(form.platforms) ? [...form.platforms] : ['wechat']
    if ((xhs.title || xhs.body) && !platforms.includes('xhs')) platforms.push('xhs')
    await api.updateOaDraft(editingId.value, {
      title: form.title,
      digest: form.digest,
      author: form.author,
      coverUrl: form.coverUrl,
      miniprogramPath: form.miniprogramPath,
      markdown: cleaned,
      themeId: form.themeId,
      brandKey: form.brandKey,
      platforms,
      variants: { xhs },
      // 是否真的改写由后端与原素材比对判定；照搬会被后端打回并提示
      status: 'ready',
      error: ''
    })
    ElMessage.success('已保存（含平台变体）')
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
  if (typeof window !== 'undefined' && window.matchMedia) {
    mobileMq = window.matchMedia('(max-width: 768px)')
    onMobileMq()
    if (mobileMq.addEventListener) mobileMq.addEventListener('change', onMobileMq)
    else if (mobileMq.addListener) mobileMq.addListener(onMobileMq)
  }
  await Promise.all([loadBrands(), loadThemes()])
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
  clearTimeout(previewTimer)
  clearTimeout(importPreviewTimer)
  if (mobileMq) {
    if (mobileMq.removeEventListener) mobileMq.removeEventListener('change', onMobileMq)
    else if (mobileMq.removeListener) mobileMq.removeListener(onMobileMq)
    mobileMq = null
  }
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
.video-list {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}
.video-item {
  display: flex;
  align-items: center;
  gap: 8px;
}
.draft-video {
  width: 220px;
  max-width: 100%;
  height: 124px;
  background: #111;
  border-radius: 6px;
}
.video-meta {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
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
  background: #8B5CF6 !important;
  color: #fff !important;
}
.ops :deep(.ops-btn--primary:hover) {
  background: #7C3AED !important;
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

.theme-board {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
}
.theme-row {
  display: flex;
  gap: 10px;
  align-items: flex-start;
}
.theme-cat {
  flex: 0 0 72px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  padding-top: 8px;
}
.theme-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.theme-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(255, 255, 255, 0.04);
  color: var(--el-text-color-regular);
  border-radius: 999px;
  padding: 6px 12px;
  font-size: 13px;
  cursor: pointer;
}
.theme-chip.is-active {
  border-color: #07c160;
  color: #07c160;
  background: rgba(7, 193, 96, 0.12);
  box-shadow: 0 0 0 1px rgba(7, 193, 96, 0.35);
  font-weight: 600;
}
.theme-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  display: inline-block;
}
.split-pane {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  width: 100%;
  min-height: 420px;
}
.split-md {
  width: 100%;
}
.split-preview {
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  overflow: hidden;
  background: #fff;
  min-height: 420px;
  display: flex;
  flex-direction: column;
}
.preview-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: #f5f6f8;
  color: #333;
  font-size: 12px;
  border-bottom: 1px solid #e8e8e8;
}
.preview-scroll {
  flex: 1;
  overflow: auto;
  background: #f5f5f7;
  color-scheme: light;
  color: #222;
  min-height: 420px;
  padding: 12px;
}
.preview-theme-name {
  color: #07c160;
  font-weight: 700;
}
.preview-theme-dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  margin-left: 6px;
  vertical-align: middle;
}
.theme-preview {
  padding: 0;
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.08);
  overflow: hidden;
  font-size: 15px;
  line-height: 1.75;
  font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif;
}
.theme-preview :deep(img) {
  max-width: 100%;
  height: auto;
}
.preview-empty {
  padding: 48px 20px;
  text-align: center;
  color: #999;
  font-size: 13px;
  background: #fff;
  border-radius: 12px;
}
@media (max-width: 1100px) {
  .split-pane {
    grid-template-columns: 1fr;
  }
  .xhs-pane {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 768px) {
  .hdr {
    flex-direction: column;
    align-items: stretch;
  }
  .acts {
    width: 100%;
  }
  .acts :deep(.el-select),
  .acts :deep(.el-button) {
    width: 100%;
  }
  .acts :deep(.el-button) {
    margin-left: 0 !important;
  }

  .theme-board {
    max-height: 160px;
    overflow: auto;
    -webkit-overflow-scrolling: touch;
  }
  .theme-chips {
    flex-wrap: wrap;
  }
  .theme-chip {
    min-height: 36px;
    padding: 6px 10px;
  }

  .preview-scroll {
    max-height: 50vh;
  }
  .xhs-phone-screen {
    width: min(270px, 78vw);
  }
  .pager {
    justify-content: center;
  }
  .dialog-footer {
    width: 100%;
  }
  .dialog-footer :deep(.el-button) {
    flex: 1;
  }
}

.draft-cards {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 120px;
}
.draft-cards-empty {
  text-align: center;
  color: var(--el-text-color-secondary);
  padding: 36px 12px;
  font-size: 13px;
}
.draft-card {
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.04);
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.draft-card-top {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  min-width: 0;
}
.draft-card-cover {
  flex-shrink: 0;
}
.draft-cover--card {
  width: 64px;
  height: 48px;
  border-radius: 6px;
}
.draft-card-meta .draft-title {
  white-space: normal;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-overflow: ellipsis;
}
.draft-card-meta .draft-err {
  max-width: none;
  white-space: normal;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.draft-card-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
}
.ops--card {
  display: grid !important;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  width: 100%;
  max-width: none;
  justify-items: stretch;
}
.ops--card :deep(.el-button) {
  width: 100% !important;
  margin: 0 !important;
  min-height: 40px;
}

.plat-badges {
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: center;
}
.plat-tabs {
  margin-top: 4px;
}
.xhs-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin-bottom: 12px;
}
.xhs-pane {
  display: grid;
  grid-template-columns: 1.1fr 0.9fr;
  gap: 16px;
  width: 100%;
}
.xhs-edit :deep(.el-form-item) {
  margin-bottom: 12px;
}
.xhs-preview-wrap {
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  overflow: hidden;
  background: #f0f1f3;
  color-scheme: light;
  min-height: 480px;
  display: flex;
  flex-direction: column;
}
.xhs-phone {
  flex: 1;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding: 16px 12px 20px;
}
.xhs-phone-screen {
  width: 270px;
  background: #fff;
  color: #222;
  border-radius: 18px;
  overflow: hidden;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.12);
  border: 1px solid #e6e6e6;
}
.xhs-cover {
  position: relative;
  width: 100%;
  aspect-ratio: 3 / 4;
  background: #ececec;
  overflow: hidden;
}
.xhs-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.xhs-cover-empty {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #999;
  font-size: 13px;
}
.xhs-nav {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.45);
  color: #fff;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  z-index: 2;
}
.xhs-nav-prev { left: 6px; }
.xhs-nav-next { right: 6px; }
.xhs-pager {
  position: absolute;
  top: 8px;
  right: 8px;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.5);
  color: #fff;
  font-size: 11px;
  z-index: 2;
}
.xhs-dots {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 8px;
  display: flex;
  justify-content: center;
  gap: 5px;
  z-index: 2;
}
.xhs-dot {
  width: 6px;
  height: 6px;
  border: 0;
  border-radius: 50%;
  padding: 0;
  background: rgba(255, 255, 255, 0.55);
  cursor: pointer;
}
.xhs-dot.is-on { background: #fff; transform: scale(1.15); }
.xhs-dot.is-cover { box-shadow: 0 0 0 1.5px #ff2442; }
.xhs-strip {
  display: flex;
  gap: 6px;
  padding: 8px 8px 0;
  overflow-x: auto;
}
.xhs-strip-item {
  position: relative;
  flex: 0 0 44px;
  width: 44px;
  height: 58px;
  padding: 0;
  border: 2px solid transparent;
  border-radius: 6px;
  overflow: hidden;
  background: #eee;
  cursor: pointer;
}
.xhs-strip-item.is-on { border-color: #ff2442; }
.xhs-strip-item img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.xhs-strip-cover {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  font-size: 9px;
  line-height: 1.4;
  text-align: center;
  color: #fff;
  background: rgba(255, 36, 66, 0.85);
}
.xhs-note {
  padding: 12px 12px 16px;
}
.xhs-note-title {
  font-weight: 700;
  font-size: 15px;
  line-height: 1.35;
  margin-bottom: 8px;
}
.xhs-note-body {
  font-size: 13px;
  line-height: 1.55;
  white-space: pre-wrap;
  color: #333;
}
.xhs-note-topics {
  margin-top: 10px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  font-size: 12px;
  color: #3d7eff;
}
.xhs-pin {
  margin-top: 10px;
  padding: 8px;
  border-radius: 8px;
  background: #f7f7f8;
  font-size: 12px;
  color: #666;
}
</style>

<style>
/* 弹窗 teleport 到 body，必须非 scoped，否则底部保存栏被视口裁切 */
.draft-dialog.el-dialog {
  max-height: 92vh;
  display: flex;
  flex-direction: column;
  margin: 3vh auto 2vh !important;
}
.draft-dialog .el-dialog__header {
  flex-shrink: 0;
}
.draft-dialog .el-dialog__body {
  overflow-y: auto;
  flex: 1 1 auto;
  min-height: 0;
  max-height: calc(92vh - 128px);
}
.draft-dialog .el-dialog__footer {
  flex-shrink: 0;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  background: inherit;
}
.draft-dialog .split-pane {
  min-height: 240px;
}
.draft-dialog .preview-scroll {
  max-height: min(42vh, 460px);
}
</style>
