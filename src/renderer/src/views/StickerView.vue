<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

type StickerPayload = { kind: 'image' | 'text' | 'color'; data: string }
type StickerOcrBBox = { x0: number; y0: number; x1: number; y1: number }
type StickerOcrLine = { text: string; bbox: StickerOcrBBox; confidence: number }
type StickerOcrResult = { width: number; height: number; text: string; lines: StickerOcrLine[] }

const payload = ref<StickerPayload | null>(null)
const baseOuter = ref<{ w: number; h: number } | null>(null)
const baseInner = ref<{ w: number; h: number } | null>(null)
const scale = ref(1)
const rotate = ref(0)
const flipX = ref(1)
const flipY = ref(1)
const opacity = ref(1)
const ocrLoading = ref(false)
const ocrError = ref<string | null>(null)
const ocr = ref<StickerOcrResult | null>(null)
const imageSize = ref<{ w: number; h: number } | null>(null)
const ocrProgress = ref<number | null>(null)
const ocrProgressStatus = ref<string>('')

const stageStyle = computed(() => {
  const s = Math.max(0.1, Math.min(8, scale.value))
  const o = Math.max(0.15, Math.min(1, opacity.value))
  const rx = Math.max(-1000000, Math.min(1000000, rotate.value))
  return {
    transform: `scale(${s}) rotate(${rx}deg) scaleX(${flipX.value}) scaleY(${flipY.value})`,
    opacity: String(o)
  }
})

const svgBase = computed(() => {
  const w = imageSize.value?.w ?? ocr.value?.width ?? 1
  const h = imageSize.value?.h ?? ocr.value?.height ?? 1
  return { w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)) }
})

const svgViewBox = computed(() => `0 0 ${svgBase.value.w} ${svgBase.value.h}`)

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

async function resolveImageSize(dataUrl: string): Promise<void> {
  imageSize.value = null
  if (!dataUrl) return
  await new Promise<void>((resolve) => {
    const img = new Image()
    img.onload = () => {
      const w = Number(img.naturalWidth || img.width || 0)
      const h = Number(img.naturalHeight || img.height || 0)
      imageSize.value = w > 0 && h > 0 ? { w, h } : null
      resolve()
    }
    img.onerror = () => resolve()
    img.src = dataUrl
  })
}

async function runOcr(): Promise<void> {
  if (payload.value?.kind !== 'image') return
  if (!payload.value.data) return
  if (ocrLoading.value) return

  ocrLoading.value = true
  ocrError.value = null
  ocrProgress.value = 0
  ocrProgressStatus.value = '准备识别…'
  try {
    await resolveImageSize(payload.value.data)
    const ret = (await window.electron.ipcRenderer.invoke(
      'sticker:ocr:recognize',
      payload.value.data
    )) as StickerOcrResult | null
    if (!ret) {
      ocr.value = null
      ocrError.value = '识别失败'
      return
    }
    ocr.value = ret
  } catch {
    ocr.value = null
    ocrError.value = '识别失败'
  } finally {
    ocrLoading.value = false
    ocrProgress.value = null
    ocrProgressStatus.value = ''
  }
}

function clearOcr(): void {
  ocrLoading.value = false
  ocrError.value = null
  ocr.value = null
  ocrProgress.value = null
  ocrProgressStatus.value = ''
}

let boundsRaf: number | null = null
let pendingBounds: { x: number; y: number; width: number; height: number } | null = null

function flushBounds(): void {
  boundsRaf = null
  if (!pendingBounds) return
  window.electron.ipcRenderer.send('sticker:set-bounds', pendingBounds)
  pendingBounds = null
}

function scheduleBounds(bounds: { x: number; y: number; width: number; height: number }): void {
  pendingBounds = bounds
  if (boundsRaf !== null) return
  boundsRaf = window.requestAnimationFrame(() => flushBounds())
}

function applyWindowScale(nextScale: number): void {
  const base = baseOuter.value
  if (!base) return

  const w = Math.round(clamp(base.w * nextScale, 120, 6000))
  const h = Math.round(clamp(base.h * nextScale, 90, 6000))

  const cx = window.screenX + window.outerWidth / 2
  const cy = window.screenY + window.outerHeight / 2
  scheduleBounds({
    x: Math.round(cx - w / 2),
    y: Math.round(cy - h / 2),
    width: w,
    height: h
  })
}

function setScale(next: number): void {
  const v = clamp(next, 0.1, 8)
  scale.value = v
  applyWindowScale(v)
}

function onInit(_e: unknown, p: unknown): void {
  if (!p || typeof p !== 'object') return
  const cand = p as Partial<StickerPayload>
  if (cand.kind !== 'image' && cand.kind !== 'text' && cand.kind !== 'color') return
  if (typeof cand.data !== 'string' || !cand.data) return
  payload.value = { kind: cand.kind, data: cand.data }
  clearOcr()
  if (cand.kind === 'image') {
    resolveImageSize(cand.data).catch(() => null)
  } else {
    imageSize.value = null
  }
  baseOuter.value = { w: window.outerWidth, h: window.outerHeight }
  baseInner.value = { w: window.innerWidth, h: window.innerHeight }
  setScale(1)
  rotate.value = 0
  flipX.value = 1
  flipY.value = 1
  opacity.value = 1
}

function close(): void {
  window.electron.ipcRenderer.invoke('sticker:close').catch(() => null)
}

const dragging = ref(false)
let pointerId: number | null = null
let startPointer: { x: number; y: number } | null = null
let startWindow: { x: number; y: number } | null = null
let raf: number | null = null
let pendingPos: { x: number; y: number } | null = null

function flushPosition(): void {
  raf = null
  if (!pendingPos) return
  window.electron.ipcRenderer.send('sticker:set-position', pendingPos)
  pendingPos = null
}

function schedulePosition(x: number, y: number): void {
  pendingPos = { x, y }
  if (raf !== null) return
  raf = window.requestAnimationFrame(() => flushPosition())
}

function shouldStartDrag(e: PointerEvent): boolean {
  if (e.button !== 0) return false
  if (payload.value?.kind === 'text' && !e.altKey) return false
  if (payload.value?.kind === 'image' && ocr.value) {
    const t = e.target
    const isOcrText =
      t instanceof Element &&
      (t.closest('.ocr-group') || t.closest('.ocr-text') || t.tagName === 'text')
    if (isOcrText && !e.altKey) return false
  }
  const t = e.target
  if (t instanceof HTMLElement && t.closest('.color-text')) return false
  return true
}

function onPointerDown(e: PointerEvent): void {
  if (!shouldStartDrag(e)) return
  pointerId = e.pointerId
  dragging.value = true
  startPointer = { x: e.screenX, y: e.screenY }
  startWindow = { x: window.screenX, y: window.screenY }
  try {
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  } catch {
    // ignore
  }
  e.preventDefault()
}

function onPointerMove(e: PointerEvent): void {
  if (!dragging.value) return
  if (pointerId !== e.pointerId) return
  if (!startPointer || !startWindow) return
  const dx = e.screenX - startPointer.x
  const dy = e.screenY - startPointer.y
  schedulePosition(Math.round(startWindow.x + dx), Math.round(startWindow.y + dy))
}

function stopDrag(e: PointerEvent): void {
  if (!dragging.value) return
  if (pointerId !== e.pointerId) return
  dragging.value = false
  pointerId = null
  startPointer = null
  startWindow = null
}

function onKeyDown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault()
    close()
    return
  }

  if (e.key === '1') rotate.value -= 90
  if (e.key === '2') rotate.value += 90
  if (e.key === '3') flipX.value = flipX.value * -1
  if (e.key === '4') flipY.value = flipY.value * -1

  if (e.key === '+' || e.key === '=') setScale(scale.value + 0.1)
  if (e.key === '-' || e.key === '_') setScale(scale.value - 0.1)
}

function onWheel(e: WheelEvent): void {
  const delta = e.deltaY
  if (e.ctrlKey) {
    const next = opacity.value + (delta < 0 ? 0.05 : -0.05)
    opacity.value = clamp(next, 0.15, 1)
    return
  }
  const next = scale.value + (delta < 0 ? 0.08 : -0.08)
  setScale(next)
}

function onDblClick(e: MouseEvent): void {
  if (e.shiftKey) return
  close()
}

function onOcrRun(): void {
  runOcr().catch(() => null)
}

function onOcrProgress(_e: unknown, p: unknown): void {
  if (!ocrLoading.value) return
  if (!p || typeof p !== 'object') return
  const m = p as { status?: unknown; progress?: unknown }
  const status = typeof m.status === 'string' ? m.status : ''
  const progress = Number(m.progress)
  if (status) ocrProgressStatus.value = status
  if (Number.isFinite(progress)) ocrProgress.value = Math.max(0, Math.min(1, progress))
}

function copyTextToClipboard(text: string): void {
  const v = text.trim()
  if (!v) return
  window.electron.ipcRenderer.invoke('sticker:clipboard:write-text', v).catch(() => null)
}

function onOcrCopySelection(): void {
  const s = window.getSelection()?.toString() ?? ''
  copyTextToClipboard(s)
}

onMounted(() => {
  window.electron.ipcRenderer.on('sticker:init', onInit)
  window.electron.ipcRenderer.on('sticker:ocr:run', onOcrRun)
  window.electron.ipcRenderer.on('sticker:ocr:clear', clearOcr)
  window.electron.ipcRenderer.on('sticker:ocr:progress', onOcrProgress)
  window.electron.ipcRenderer.on('sticker:ocr:copy-selection', onOcrCopySelection)
  window.addEventListener('keydown', onKeyDown)
})

onBeforeUnmount(() => {
  if (raf !== null) {
    window.cancelAnimationFrame(raf)
    raf = null
  }
  if (boundsRaf !== null) {
    window.cancelAnimationFrame(boundsRaf)
    boundsRaf = null
  }
})
</script>

<template>
  <div
    class="wrap"
    @dblclick="onDblClick"
    @wheel.prevent="onWheel"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="stopDrag"
    @pointercancel="stopDrag"
  >
    <div v-if="payload?.kind === 'image'" class="content">
      <div class="stage">
        <div class="img-wrap" :style="stageStyle">
          <svg class="img-svg" :viewBox="svgViewBox" preserveAspectRatio="xMidYMid meet">
            <image
              x="0"
              y="0"
              :width="svgBase.w"
              :height="svgBase.h"
              preserveAspectRatio="none"
              :href="payload.data"
            />
            <g v-if="ocr" class="ocr-group">
              <text
                v-for="(line, idx) in ocr.lines"
                :key="idx"
                class="ocr-text"
                :x="line.bbox.x0"
                :y="line.bbox.y1"
                :font-size="Math.max(10, line.bbox.y1 - line.bbox.y0)"
                dominant-baseline="text-after-edge"
              >
                {{ line.text }}
              </text>
            </g>
          </svg>
        </div>
        <div v-if="ocrLoading" class="ocr-overlay">
          <div class="ocr-overlay-card">
            <div class="ocr-overlay-title">文字识别中…</div>
            <div v-if="ocrProgressStatus" class="ocr-overlay-sub">{{ ocrProgressStatus }}</div>
            <div v-if="ocrProgress !== null" class="ocr-overlay-bar">
              <div
                class="ocr-overlay-bar-inner"
                :style="{ width: `${Math.round(ocrProgress * 100)}%` }"
              />
            </div>
            <div class="ocr-overlay-hint">提示：按住 Alt 可强制拖动窗口</div>
          </div>
        </div>
        <div v-else-if="ocrError" class="ocr-status error">{{ ocrError }}</div>
      </div>
    </div>

    <div v-else-if="payload?.kind === 'color'" class="content">
      <div class="stage">
        <div class="color" :style="{ ...stageStyle, backgroundColor: payload.data }">
          <div class="color-text">{{ payload.data }}</div>
        </div>
      </div>
    </div>

    <div v-else-if="payload?.kind === 'text'" class="content no-drag">
      <div class="stage">
        <div class="text" :style="stageStyle">
          {{ payload.data }}
        </div>
      </div>
    </div>

    <div v-else class="placeholder">贴图内容为空</div>
  </div>
</template>

<style scoped>
.wrap {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  background: transparent;
}

.no-drag {
  -webkit-app-region: no-drag;
}

.content {
  width: 100%;
  height: 100%;
  display: grid;
  place-items: stretch;
  padding: 12px;
  box-sizing: border-box;
}

.stage {
  position: relative;
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
}

.img-wrap {
  width: 100%;
  height: 100%;
  transform-origin: center;
  display: grid;
  place-items: center;
  border-radius: 14px;
  box-shadow:
    0 12px 32px rgba(0, 0, 0, 0.35),
    0 0 28px color-mix(in srgb, var(--ev-c-theme) 42%, transparent);
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.12);
}

.img-svg {
  width: 100%;
  height: 100%;
  display: block;
  user-select: none;
}

.img-svg image {
  pointer-events: none;
}

.ocr-group {
  user-select: text;
}

.ocr-text {
  fill: rgba(255, 255, 255, 0.9);
  stroke: rgba(0, 0, 0, 0.55);
  stroke-width: 2;
  paint-order: stroke fill;
  user-select: text;
  cursor: text;
  pointer-events: auto;
}

.ocr-overlay {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  pointer-events: none;
}

.ocr-overlay-card {
  width: min(320px, calc(100% - 36px));
  padding: 12px 12px;
  border-radius: 12px;
  background: rgba(0, 0, 0, 0.48);
  border: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.35);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ocr-overlay-title {
  font-size: 13px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.92);
}

.ocr-overlay-sub {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.78);
}

.ocr-overlay-bar {
  height: 8px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.12);
  overflow: hidden;
}

.ocr-overlay-bar-inner {
  height: 100%;
  border-radius: 999px;
  background: color-mix(in srgb, var(--ev-c-theme) 62%, rgba(255, 255, 255, 0.6));
  width: 0%;
}

.ocr-overlay-hint {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.65);
}

.ocr-status {
  position: absolute;
  left: 18px;
  bottom: 18px;
  font-size: 12px;
  padding: 6px 10px;
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.45);
  color: rgba(255, 255, 255, 0.88);
  border: 1px solid rgba(255, 255, 255, 0.12);
  -webkit-app-region: no-drag;
  user-select: none;
}

.ocr-status.error {
  background: rgba(125, 30, 30, 0.52);
}

.color {
  width: 100%;
  height: 100%;
  border-radius: 14px;
  box-shadow:
    0 12px 32px rgba(0, 0, 0, 0.35),
    0 0 28px color-mix(in srgb, var(--ev-c-theme) 42%, transparent);
  border: 1px solid rgba(255, 255, 255, 0.14);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding: 10px;
}

.color-text {
  font-size: 12px;
  letter-spacing: 0.02em;
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.35);
  color: rgba(255, 255, 255, 0.92);
  border: 1px solid rgba(255, 255, 255, 0.12);
  user-select: text;
}

.text {
  width: 100%;
  height: 100%;
  overflow: auto;
  padding: 14px 16px;
  border-radius: 14px;
  background: rgba(15, 15, 16, 0.78);
  color: rgba(255, 255, 255, 0.92);
  border: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow:
    0 12px 32px rgba(0, 0, 0, 0.35),
    0 0 28px color-mix(in srgb, var(--ev-c-theme) 42%, transparent);
  white-space: pre-wrap;
  word-break: break-word;
  user-select: text;
  transform-origin: center;
}

.placeholder {
  -webkit-app-region: no-drag;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.55);
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 12px;
  padding: 10px 12px;
}
</style>

<style>
html,
body,
#app {
  width: 100%;
  height: 100%;
  margin: 0;
  background: transparent !important;
}
</style>
