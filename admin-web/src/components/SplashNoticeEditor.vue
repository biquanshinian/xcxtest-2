<template>
  <div class="splash-notice-editor">
    <div class="sne-toolbar">
      <div class="sne-toolbar-row">
        <span class="sne-group-title">文字</span>
        <el-button size="small" :type="boldActive ? 'primary' : 'default'" @mousedown.prevent="onBoldMouseDown">加粗</el-button>
        <el-button-group>
          <el-button
            v-for="opt in SIZE_OPTS"
            :key="opt.value"
            size="small"
            :type="sizeValue === opt.value ? 'primary' : 'default'"
            @mousedown.prevent="onSizeMouseDown(opt.value)"
          >{{ opt.label }}</el-button>
        </el-button-group>
        <div class="sne-field">
          <span class="sne-label">字号</span>
          <el-input-number
            :model-value="sizeValue"
            size="small"
            :min="SIZE_MIN"
            :max="SIZE_MAX"
            :step="1"
            controls-position="right"
            style="width:110px;"
            @mousedown.prevent="captureLiveSelection"
            @change="onSizeMouseDown"
          />
        </div>
      </div>
      <div class="sne-toolbar-row">
        <span class="sne-group-title">段落</span>
        <el-button-group>
          <el-button size="small" :type="align === 'left' ? 'primary' : 'default'" @mousedown.prevent="setAlign('left')">左对齐</el-button>
          <el-button size="small" :type="align === 'center' ? 'primary' : 'default'" @mousedown.prevent="setAlign('center')">居中</el-button>
          <el-button size="small" :type="align === 'right' ? 'primary' : 'default'" @mousedown.prevent="setAlign('right')">右对齐</el-button>
        </el-button-group>
        <div class="sne-field">
          <span class="sne-label">行距</span>
          <el-input-number
            :model-value="localLineHeight"
            size="small"
            :min="1"
            :max="2.5"
            :step="0.1"
            :precision="1"
            controls-position="right"
            style="width:100px;"
            @mousedown.prevent
            @change="applyLineHeight"
          />
        </div>
        <div class="sne-field">
          <span class="sne-label">段间距</span>
          <el-input-number
            :model-value="lineGap"
            size="small"
            :min="0"
            :max="24"
            :step="1"
            controls-position="right"
            style="width:100px;"
            @change="(v) => emit('update:lineGap', clampLineGap(v))"
          />
        </div>
        <div class="sne-field">
          <span class="sne-label">字距</span>
          <el-input-number
            :model-value="letterSpacing"
            size="small"
            :min="0"
            :max="8"
            :step="1"
            controls-position="right"
            style="width:100px;"
            @change="(v) => emit('update:letterSpacing', clampLetterSpacing(v))"
          />
        </div>
      </div>
      <span class="sne-hint">用法同 Word/便签：直接回车换行；选中文字调加粗/字号；行距写到整段各行（与小程序一致）；段间距/字距为全局</span>
    </div>
    <div
      ref="editorRef"
      class="sne-body"
      :style="editorBodyStyle"
      contenteditable="true"
      data-placeholder="显示在倒计时组件上方；不填则不显示"
      @focus="onEditorFocus"
      @input="onInput"
      @keyup="onEditorSelChange"
      @mouseup="onEditorSelChange"
      @blur="onBlur"
    ></div>
    <div class="sne-footer">
      <span :class="{ 'sne-over': plainLen > maxLen }">{{ plainLen }} / {{ maxLen }}</span>
    </div>
    <div class="sne-preview-label">开屏预览（与小程序排版参数一致）</div>
    <div class="sne-preview" :style="previewBoxStyle">
      <div
        v-for="(line, idx) in previewLines"
        :key="idx"
        class="sne-preview-line"
        :class="{ 'sne-preview-line--empty': line.empty }"
        :style="{
          lineHeight: String(line.lineHeight || clampLineHeight(localLineHeight)),
          textAlign: line.align || 'center',
          minHeight:
            Math.round(
              (line.segs && line.segs.length
                ? Math.max.apply(
                    null,
                    line.segs.map((s) => Number(s.fontSize) || 16)
                  )
                : 16) * Number(line.lineHeight || clampLineHeight(localLineHeight))
            ) + 'px'
        }"
      >
        <template v-if="!line.empty">
          <span
            v-for="(seg, si) in line.segs"
            :key="si"
            :style="{
              fontSize: (seg.fontSize || 16) + 'px',
              fontWeight: seg.bold ? 700 : 500
            }"
          >{{ seg.text }}</span>
        </template>
      </div>
      <div v-if="!previewLines.length" class="sne-preview-empty">无文案</div>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const SIZE_MIN = 12
const SIZE_MAX = 36
const SIZE_OPTS = [
  { label: '小', value: 14 },
  { label: '默认', value: 16 },
  { label: '大', value: 22 },
  { label: '更大', value: 28 }
]
const MAX_LINES = 6

function clampNoticeSize(px) {
  const n = Math.round(Number(px) || 16)
  return Math.max(SIZE_MIN, Math.min(SIZE_MAX, n))
}

function isAllowedNoticeSize(px) {
  const n = Number(px)
  return Number.isFinite(n) && n >= SIZE_MIN && n <= SIZE_MAX
}

function clampLineHeight(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return 1.4
  return Math.min(2.5, Math.max(1, Math.round(n * 10) / 10))
}

function clampLetterSpacing(v) {
  const n = Math.round(Number(v) || 0)
  return Math.min(8, Math.max(0, n))
}

function clampLineGap(v) {
  const n = Math.round(Number(v) || 0)
  return Math.min(24, Math.max(0, n))
}

const props = defineProps({
  modelValue: { type: String, default: '' },
  maxLen: { type: Number, default: 80 },
  noticeFont: { type: String, default: 'default' },
  lineHeight: { type: Number, default: 1.4 },
  letterSpacing: { type: Number, default: 0 },
  lineGap: { type: Number, default: 4 }
})
const emit = defineEmits(['update:modelValue', 'update:lineHeight', 'update:letterSpacing', 'update:lineGap'])

const editorRef = ref(null)
const align = ref('center')
const boldActive = ref(false)
const sizeValue = ref(16)
const localLineHeight = ref(clampLineHeight(props.lineHeight))
const plainLen = ref(0)
const draftHtml = ref(props.modelValue || '')
const editorFocused = ref(false)

let suppressInput = false
let savedRange = null
let emitTimer = null
let previewTimer = null
let lastEmittedHtml = props.modelValue || ''
const previewHtml = ref(props.modelValue || '')

const fontFamilyCss = computed(() => {
  if (props.noticeFont === 'yahei' || props.noticeFont === 'yahei-bold') {
    return '"Microsoft YaHei", "微软雅黑", "PingFang SC", sans-serif'
  }
  return 'inherit'
})

const editorBodyStyle = computed(() => ({
  fontFamily: fontFamilyCss.value,
  letterSpacing: `${clampLetterSpacing(props.letterSpacing)}px`
}))

const previewBoxStyle = computed(() => ({
  fontFamily: fontFamilyCss.value,
  letterSpacing: `${clampLetterSpacing(props.letterSpacing)}px`,
  gap: `${clampLineGap(props.lineGap)}px`
}))

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function stripTags(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(div|p)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .replace(/\n+$/g, '')
}

function countPlain(html) {
  return stripTags(html).replace(/\n/g, '').length
}

function isInsideEditor(node) {
  const el = editorRef.value
  if (!el || !node) return false
  return el === node || el.contains(node.nodeType === 3 ? node.parentNode : node)
}

function saveSelection() {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return
  const range = sel.getRangeAt(0)
  if (!isInsideEditor(range.commonAncestorContainer)) return
  savedRange = range.cloneRange()
}

function restoreSelection() {
  if (!savedRange || !editorRef.value) return false
  const sel = window.getSelection()
  sel.removeAllRanges()
  sel.addRange(savedRange)
  return true
}

function readLineHeightFromEl(el) {
  const n = parseFloat(el?.style?.lineHeight || '')
  if (Number.isFinite(n) && n >= 1 && n <= 2.5) return clampLineHeight(n)
  return null
}

function readAlignFromEl(el) {
  const ta = String(el?.style?.textAlign || '').toLowerCase()
  return ta === 'left' || ta === 'center' || ta === 'right' ? ta : null
}

function currentBlockEl() {
  const root = editorRef.value
  if (!root) return null
  const sel = window.getSelection()
  let node = sel?.anchorNode || null
  if (!node) return root.firstElementChild
  if (node.nodeType === 3) node = node.parentElement
  while (node && node !== root) {
    if (node.parentElement === root && /^(DIV|P)$/i.test(node.tagName || '')) return node
    node = node.parentElement
  }
  return root.firstElementChild
}

/** 轻量预览解析：纯字符串，不走 DOM，避免卡死 */
function buildPreviewLines(html) {
  let src = String(html || '').trim()
  if (!src) return []
  const defaultLh = clampLineHeight(props.lineHeight)
  const lines = []

  function pushFrag(frag, lh, ta) {
    const segs = parsePreviewSegs(frag)
    if (!segs.length) {
      if (lines.length) lines.push({ empty: true, segs: [], lineHeight: lh, align: ta })
      return
    }
    lines.push({ empty: false, segs, lineHeight: lh, align: ta })
  }

  const divRe = /<div\b([^>]*)>([\s\S]*?)<\/div>/gi
  let m
  let matched = false
  while ((m = divRe.exec(src))) {
    matched = true
    if (lines.length >= MAX_LINES) break
    const attrs = m[1] || ''
    const styleM = attrs.match(/style\s*=\s*"([^"]*)"/i) || attrs.match(/style\s*=\s*'([^']*)'/i)
    let lh = defaultLh
    let ta = 'center'
    if (styleM) {
      const lhM = styleM[1].match(/line-height\s*:\s*([\d.]+)/i)
      if (lhM) lh = clampLineHeight(lhM[1])
      const taM = styleM[1].match(/text-align\s*:\s*(left|center|right)/i)
      if (taM) ta = taM[1].toLowerCase()
    }
    const inner = String(m[2] || '')
    if (!inner.replace(/<br\s*\/?>/gi, '').replace(/&nbsp;/gi, '').trim()) {
      pushFrag('', lh, ta)
      continue
    }
    const parts = inner.split(/<br\s*\/?>/i)
    while (parts.length && !String(parts[parts.length - 1] || '').replace(/&nbsp;/gi, '').trim()) parts.pop()
    for (let i = 0; i < parts.length && lines.length < MAX_LINES; i++) pushFrag(parts[i], lh, ta)
  }

  if (!matched) {
    const flat = src.replace(/<br\s*\/?>/gi, '\n').replace(/<\/?div\b[^>]*>/gi, '')
    const raw = flat.split('\n')
    while (raw.length && !String(raw[raw.length - 1] || '').trim()) raw.pop()
    for (let i = 0; i < raw.length && lines.length < MAX_LINES; i++) pushFrag(raw[i], defaultLh, 'center')
  }

  while (lines.length && lines[lines.length - 1].empty) lines.pop()
  return lines.slice(0, MAX_LINES)
}

function parsePreviewSegs(fragment) {
  const segs = []
  let src = String(fragment || '')
  src = src.replace(/<span(\s+[^>]*?=\s*"[^"]*")([^\s>])/gi, '<span$1>$2')
  const stack = [{ bold: false, fontSize: 16 }]
  let i = 0
  while (i < src.length) {
    if (src[i] === '<') {
      const close = src.slice(i).match(/^<\/\s*span\s*>/i)
      if (close) {
        if (stack.length > 1) stack.pop()
        i += close[0].length
        continue
      }
      const open = src.slice(i).match(/^<span\b([^>]*)>/i)
      if (open) {
        const attrs = open[1] || ''
        const cur = stack[stack.length - 1]
        const next = { bold: cur.bold, fontSize: cur.fontSize }
        if (/font-weight\s*:\s*(bold|700)/i.test(attrs)) next.bold = true
        const sizeM = attrs.match(/font-size\s*:\s*(\d+)\s*px/i)
        if (sizeM && isAllowedNoticeSize(Number(sizeM[1]))) next.fontSize = clampNoticeSize(Number(sizeM[1]))
        stack.push(next)
        i += open[0].length
        continue
      }
      const skip = src.slice(i).match(/^<[^>]+>/)
      if (skip) {
        i += skip[0].length
        continue
      }
      i += 1
      continue
    }
    const nextLt = src.indexOf('<', i)
    const rawText = nextLt === -1 ? src.slice(i) : src.slice(i, nextLt)
    i = nextLt === -1 ? src.length : nextLt
    const text = String(rawText || '')
      .replace(/<\/?[a-zA-Z][^>]*>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&amp;/gi, '&')
      .trim()
    if (!text) continue
    const cur = stack[stack.length - 1]
    segs.push({ text, bold: !!cur.bold, fontSize: cur.fontSize })
  }
  return segs
}

const previewLines = computed(() => buildPreviewLines(previewHtml.value))

function sanitizeNoticeHtmlLocal(raw) {
  const src = String(raw || '').trim()
  if (!src) return ''
  if (!/<[a-z][\s\S]*>/i.test(src)) {
    return `<div style="text-align:center;line-height:${clampLineHeight(props.lineHeight)}">${escapeHtml(src)}</div>`
  }
  const wrap = document.createElement('div')
  wrap.innerHTML = src
  const out = document.createElement('div')
  const ALLOWED_ALIGN = new Set(['left', 'center', 'right'])

  function takeStyle(el) {
    const style = {}
    const fs = parseInt(el.style?.fontSize || '', 10)
    if (isAllowedNoticeSize(fs)) style.fontSize = `${clampNoticeSize(fs)}px`
    const fw = String(el.style?.fontWeight || '').toLowerCase()
    if (fw === 'bold' || fw === '700' || el.tagName === 'STRONG' || el.tagName === 'B') {
      style.fontWeight = '700'
    }
    const ta = String(el.style?.textAlign || '').toLowerCase()
    if (ALLOWED_ALIGN.has(ta)) style.textAlign = ta
    const lh = readLineHeightFromEl(el)
    if (lh != null) style.lineHeight = String(lh)
    return style
  }

  function applyStyle(el, style) {
    if (style.fontSize) el.style.fontSize = style.fontSize
    if (style.fontWeight) el.style.fontWeight = style.fontWeight
    if (style.textAlign) el.style.textAlign = style.textAlign
    if (style.lineHeight) el.style.lineHeight = style.lineHeight
  }

  function walk(node, parent) {
    if (node.nodeType === Node.TEXT_NODE) {
      parent.appendChild(document.createTextNode(node.textContent || ''))
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return
    const tag = node.tagName.toUpperCase()
    if (tag === 'BR') {
      parent.appendChild(document.createElement('br'))
      return
    }
    if (tag === 'DIV' || tag === 'P') {
      const block = document.createElement('div')
      applyStyle(block, takeStyle(node))
      Array.from(node.childNodes).forEach((c) => walk(c, block))
      parent.appendChild(block)
      return
    }
    if (tag === 'SPAN' || tag === 'STRONG' || tag === 'B' || tag === 'FONT') {
      const span = document.createElement('span')
      applyStyle(span, takeStyle(node))
      Array.from(node.childNodes).forEach((c) => walk(c, span))
      parent.appendChild(span)
      return
    }
    Array.from(node.childNodes).forEach((c) => walk(c, parent))
  }

  Array.from(wrap.childNodes).forEach((c) => walk(c, out))
  return out.innerHTML
    .replace(/\r\n|\r|\n/g, '<br/>')
    .replace(/^(<br\s*\/?>)+/i, '')
    .replace(/(<br\s*\/?>)+$/i, '')
    .trim()
}

/**
 * 安全规范化：最多 MAX_LINES 行；单独 <br> 不计成两行，避免指数膨胀卡死页面。
 * 只在失焦 / 调段落格式时调用一次。
 */
function normalizeEditorOnce() {
  const root = editorRef.value
  if (!root) return
  const defaultLh = clampLineHeight(localLineHeight.value || props.lineHeight)
  const defaultAlign = ['left', 'center', 'right'].includes(align.value) ? align.value : 'center'
  const collected = []

  function isBlankHtml(html) {
    return !String(html || '')
      .replace(/<br\s*\/?>/gi, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/<[^>]+>/g, '')
      .trim()
  }

  function pushLine(innerHtml, lh, ta) {
    if (collected.length >= MAX_LINES) return
    collected.push({
      html: isBlankHtml(innerHtml) ? '' : String(innerHtml || ''),
      lineHeight: clampLineHeight(lh),
      align: ta === 'left' || ta === 'right' || ta === 'center' ? ta : defaultAlign
    })
  }

  function splitBlock(innerHtml, lh, ta) {
    let cleaned = String(innerHtml || '')
      .replace(/<\/div>\s*<div\b[^>]*>/gi, '<br/>')
      .replace(/<\/?div\b[^>]*>/gi, '')
      .replace(/\r\n|\r|\n/g, '<br/>')
    if (isBlankHtml(cleaned)) {
      pushLine('', lh, ta)
      return
    }
    const parts = cleaned.split(/<br\s*\/?>/i)
    while (parts.length > 1 && isBlankHtml(parts[parts.length - 1])) parts.pop()
    for (let i = 0; i < parts.length && collected.length < MAX_LINES; i++) {
      pushLine(parts[i], lh, ta)
    }
  }

  Array.from(root.childNodes).forEach((node) => {
    if (collected.length >= MAX_LINES) return
    if (node.nodeType === Node.TEXT_NODE) {
      const t = node.textContent || ''
      if (t.replace(/\u00a0/g, ' ').trim()) pushLine(escapeHtml(t), defaultLh, defaultAlign)
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return
    const tag = String(node.tagName || '').toUpperCase()
    if (tag === 'BR') {
      pushLine('', defaultLh, defaultAlign)
      return
    }
    if (tag === 'DIV' || tag === 'P') {
      splitBlock(node.innerHTML, readLineHeightFromEl(node) || defaultLh, readAlignFromEl(node) || defaultAlign)
      return
    }
    pushLine(node.outerHTML || '', defaultLh, defaultAlign)
  })

  if (!collected.length) {
    root.innerHTML = `<div style="text-align:${defaultAlign};line-height:${defaultLh}"><br></div>`
    return
  }

  root.innerHTML = collected
    .map((l) => {
      const content = l.html ? l.html : '<br>'
      return `<div style="text-align:${l.align};line-height:${l.lineHeight}">${content}</div>`
    })
    .join('')
}

function detectAlignFromHtml(html) {
  const m = String(html || '').match(/text-align\s*:\s*(left|center|right)/i)
  return m ? m[1].toLowerCase() : 'center'
}

function setEditorHtml(html) {
  if (!editorRef.value) return
  suppressInput = true
  editorFocused.value = false
  const safe = sanitizeNoticeHtmlLocal(html)
  editorRef.value.innerHTML = safe || ''
  normalizeEditorOnce()
  const out = sanitizeNoticeHtmlLocal(editorRef.value.innerHTML)
  align.value = detectAlignFromHtml(out)
  plainLen.value = countPlain(out)
  draftHtml.value = out
  previewHtml.value = out
  lastEmittedHtml = out
  savedRange = null
  nextTick(() => {
    suppressInput = false
  })
}

function emitHtmlValue(html) {
  const next = String(html || '')
  draftHtml.value = next
  lastEmittedHtml = next
  if (next !== props.modelValue) emit('update:modelValue', next)
}

function flushEmit(normalize) {
  if (!editorRef.value || suppressInput) return
  if (emitTimer) {
    clearTimeout(emitTimer)
    emitTimer = null
  }
  if (normalize) {
    suppressInput = true
    normalizeEditorOnce()
    nextTick(() => {
      suppressInput = false
    })
  }
  let html = sanitizeNoticeHtmlLocal(editorRef.value.innerHTML)
  if (countPlain(html) > props.maxLen) {
    const plain = stripTags(html).replace(/\n/g, '').slice(0, props.maxLen)
    html = `<div style="text-align:${align.value};line-height:${clampLineHeight(localLineHeight.value)}">${escapeHtml(plain)}</div>`
    suppressInput = true
    editorRef.value.innerHTML = html
    nextTick(() => {
      suppressInput = false
    })
  }
  plainLen.value = countPlain(html)
  previewHtml.value = html
  emitHtmlValue(html)
}

function scheduleEmit() {
  if (emitTimer) clearTimeout(emitTimer)
  emitTimer = setTimeout(() => flushEmit(false), 400)
}

function schedulePreview(raw) {
  if (previewTimer) clearTimeout(previewTimer)
  previewTimer = setTimeout(() => {
    previewHtml.value = raw
  }, 160)
}

function onInput() {
  if (suppressInput) return
  const raw = editorRef.value?.innerHTML || ''
  plainLen.value = countPlain(raw)
  draftHtml.value = raw
  schedulePreview(raw)
  saveSelection()
  scheduleEmit()
}

function onBlur() {
  editorFocused.value = false
  flushEmit(true)
}

function onEditorSelChange() {
  saveSelection()
  syncToolbar()
}

function captureLiveSelection() {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return false
  const range = sel.getRangeAt(0)
  if (!isInsideEditor(range.commonAncestorContainer)) return false
  savedRange = range.cloneRange()
  return !range.collapsed
}

function restoreLiveSelection() {
  const el = editorRef.value
  if (!el) return false
  el.focus()
  editorFocused.value = true
  if (!savedRange) return false
  try {
    const sel = window.getSelection()
    sel.removeAllRanges()
    sel.addRange(savedRange)
    return !sel.isCollapsed
  } catch (e) {
    return false
  }
}

function onEditorFocus() {
  editorFocused.value = true
  try {
    document.execCommand('defaultParagraphSeparator', false, 'div')
    document.execCommand('styleWithCSS', false, true)
  } catch (e) {}
}

function onBoldMouseDown() {
  captureLiveSelection()
  restoreLiveSelection()
  try {
    document.execCommand('bold', false)
  } catch (e) {}
  saveSelection()
  syncToolbar()
  // 延迟序列化，避免打断刚写入的 DOM
  scheduleEmit()
  schedulePreview(editorRef.value?.innerHTML || '')
}

function onSizeMouseDown(px) {
  const next = clampNoticeSize(px)
  sizeValue.value = next
  const hadSel = captureLiveSelection()
  restoreLiveSelection()
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
    if (!hadSel || !savedRange || savedRange.collapsed) return
    try {
      sel.removeAllRanges()
      sel.addRange(savedRange)
    } catch (e) {
      return
    }
  }
  if (!sel.rangeCount || sel.isCollapsed) return
  const range = sel.getRangeAt(0)
  if (!isInsideEditor(range.commonAncestorContainer)) return

  const span = document.createElement('span')
  span.style.fontSize = `${next}px`
  try {
    range.surroundContents(span)
  } catch (e) {
    try {
      const frag = range.extractContents()
      frag.querySelectorAll?.('span[style*="font-size"], font').forEach((node) => {
        if (node.style) node.style.fontSize = ''
      })
      span.appendChild(frag)
      range.insertNode(span)
    } catch (err) {
      return
    }
  }
  try {
    const after = document.createRange()
    after.selectNodeContents(span)
    sel.removeAllRanges()
    sel.addRange(after)
    savedRange = after.cloneRange()
  } catch (e) {
    saveSelection()
  }
  scheduleEmit()
  schedulePreview(editorRef.value?.innerHTML || '')
}

function focusEditorWithSelection() {
  return restoreLiveSelection() || !!editorRef.value
}

function toggleBold() {
  onBoldMouseDown()
}

function applySize(px) {
  onSizeMouseDown(px)
}

function setAlign(next) {
  align.value = next
  const el = editorRef.value
  if (!el) return
  el.focus()
  restoreSelection()
  const block = currentBlockEl()
  if (block) block.style.textAlign = next
  else {
    suppressInput = true
    normalizeEditorOnce()
    Array.from(el.querySelectorAll(':scope > div')).forEach((div) => {
      div.style.textAlign = next
    })
    nextTick(() => {
      suppressInput = false
    })
  }
  flushEmit(true)
}

function applyLineHeight(v) {
  const next = clampLineHeight(v)
  localLineHeight.value = next
  emit('update:lineHeight', next)
  const el = editorRef.value
  if (!el) return
  el.focus()
  restoreSelection()
  // 开屏通知很短：行距默认写到整段每一行，保证保存后小程序与后台一致
  suppressInput = true
  normalizeEditorOnce()
  Array.from(el.querySelectorAll(':scope > div')).forEach((div) => {
    div.style.lineHeight = String(next)
  })
  nextTick(() => {
    suppressInput = false
  })
  flushEmit(true)
}

function syncToolbar() {
  try {
    boldActive.value = !!document.queryCommandState('bold')
  } catch (e) {
    boldActive.value = false
  }
  try {
    const sel = window.getSelection()
    if (!sel || !sel.anchorNode) return
    let node = sel.anchorNode.nodeType === 3 ? sel.anchorNode.parentElement : sel.anchorNode
    while (node && node !== editorRef.value) {
      const fs = parseInt(node.style?.fontSize || '', 10)
      if (isAllowedNoticeSize(fs)) {
        sizeValue.value = clampNoticeSize(fs)
        break
      }
      node = node.parentElement
    }
    const block = currentBlockEl()
    if (block) {
      const lh = readLineHeightFromEl(block)
      if (lh != null) localLineHeight.value = lh
      const ta = readAlignFromEl(block)
      if (ta) align.value = ta
    }
  } catch (e) {}
}

watch(
  () => props.modelValue,
  (v) => {
    if (!editorRef.value) return
    if (editorFocused.value) return
    const next = String(v || '')
    if (next === lastEmittedHtml) return
    setEditorHtml(next)
  }
)

watch(
  () => props.lineHeight,
  (v) => {
    if (editorFocused.value) return
    localLineHeight.value = clampLineHeight(v)
  }
)

onMounted(() => {
  localLineHeight.value = clampLineHeight(props.lineHeight)
  setEditorHtml(props.modelValue || '')
})

onBeforeUnmount(() => {
  if (emitTimer) clearTimeout(emitTimer)
  if (previewTimer) clearTimeout(previewTimer)
})
</script>

<style scoped>
.splash-notice-editor {
  width: 100%;
  max-width: 680px;
}
.sne-toolbar {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 8px;
}
.sne-toolbar-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.sne-group-title {
  flex: 0 0 auto;
  min-width: 32px;
  color: var(--t-text-muted, #909399);
  font-size: 12px;
  font-weight: 600;
}
.sne-field {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
  white-space: nowrap;
}
.sne-hint {
  color: var(--t-text-muted, #909399);
  font-size: 12px;
  width: 100%;
  line-height: 1.4;
}
.sne-label {
  color: var(--t-text-muted, #909399);
  font-size: 12px;
  flex: 0 0 auto;
}
.sne-body {
  min-height: 72px;
  max-height: 200px;
  overflow-y: auto;
  padding: 10px 12px;
  border: 1px solid var(--el-border-color, #dcdfe6);
  border-radius: 6px;
  background: #111827;
  color: rgba(255, 255, 255, 0.92);
  font-size: 16px;
  line-height: 1.4;
  outline: none;
  white-space: pre-wrap;
  word-break: break-word;
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.35);
}
.sne-body:empty::before {
  content: attr(data-placeholder);
  color: rgba(255, 255, 255, 0.35);
  pointer-events: none;
}
.sne-footer {
  margin-top: 4px;
  text-align: right;
  font-size: 12px;
  color: var(--t-text-muted, #909399);
}
.sne-over {
  color: var(--el-color-danger, #f56c6c);
  font-weight: 600;
}
.sne-preview-label {
  margin-top: 10px;
  font-size: 12px;
  color: var(--t-text-muted, #909399);
}
.sne-preview {
  margin-top: 6px;
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 336px;
  padding: 14px 18px;
  border-radius: 14px;
  background: linear-gradient(165deg, rgba(255, 255, 255, 0.08) 0%, rgba(0, 0, 0, 0.35) 100%);
  border: 1px solid rgba(255, 255, 255, 0.14);
  color: rgba(255, 255, 255, 0.92);
  word-break: break-word;
  box-sizing: border-box;
}
.sne-preview-line {
  width: 100%;
  white-space: pre-wrap;
}
.sne-preview-line--empty {
  min-height: 1.2em;
}
.sne-preview-empty {
  opacity: 0.45;
  font-size: 13px;
}
</style>
