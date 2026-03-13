<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, toRaw } from 'vue'
import {
  clamp,
  computeDragBounds,
  getHandleAtPoint,
  isPointInBounds,
  type Bounds,
  type DragMode,
  type Point
} from './selection'

type Display = {
  id: number
  x: number
  y: number
  width: number
  height: number
  scaleFactor?: number
}

type Lang = {
  magnifier_position_label: string
  operation_ok_title: string
  operation_cancel_title: string
  operation_save_title: string
  operation_redo_title: string
  operation_undo_title: string
  operation_mosaic_title: string
  operation_text_title: string
  operation_brush_title: string
  operation_arrow_title: string
  operation_ellipse_title: string
  operation_rectangle_title: string
}

type ScreenshotsListener = (...args: unknown[]) => void

const defaultLang: Lang = {
  magnifier_position_label: 'Position',
  operation_ok_title: 'OK',
  operation_cancel_title: 'Cancel',
  operation_save_title: 'Save',
  operation_redo_title: 'Redo',
  operation_undo_title: 'Undo',
  operation_mosaic_title: 'Mosaic',
  operation_text_title: 'Text',
  operation_brush_title: 'Brush',
  operation_arrow_title: 'Arrow',
  operation_ellipse_title: 'Ellipse',
  operation_rectangle_title: 'Rectangle'
}

const url = ref<string | null>(null)
const display = ref<Display | null>(null)
const lang = ref<Lang>(defaultLang)

const canvasRef = ref<HTMLCanvasElement | null>(null)
const imageRef = ref<HTMLImageElement | null>(null)

const viewportWidth = ref(window.innerWidth)
const viewportHeight = ref(window.innerHeight)

const bounds = ref<Bounds | null>(null)
const imageReady = ref(false)
const submitting = ref(false)
let overlayCtx: CanvasRenderingContext2D | null = null
let overlayCanvasW = 0
let overlayCanvasH = 0
let overlayCanvasDpr = 0
let overlayDirty = true

let magnifierDirty = true
let lastMagnifierPointer: { x: number; y: number } | null = null
let lastUiUpdateAt = 0
let lastMagnifierDrawAt = 0
let lastColorSampleAt = 0
const uiUpdateIntervalMs = 33
const colorSampleIntervalMs = 66

const dragMode = ref<DragMode>(null)
const dragStart = ref<Point | null>(null)
const dragStartBounds = ref<Bounds | null>(null)
const lastPointer = ref<Point | null>(null)

const handleRadius = 6

// magnifier
const magnifierWidth = 150
const magnifierHeight = 80
const magnifierPos = ref<{ x: number; y: number } | null>(null)
const magnifierCanvasRef = ref<HTMLCanvasElement | null>(null)
const magnifierCtxRef = ref<CanvasRenderingContext2D | null>(null)
const colorMode = ref<'HEX' | 'RGB'>('HEX')
const hexColor = ref('000000')
const rgbText = ref('rgb(0, 0, 0)')

const perfEnabled =
  window.location.search.includes('perf=1') || window.localStorage.getItem('snipPerf') === '1'
const perfText = ref('')
let perfFrameCount = 0
let perfLastReportAt = 0
let perfOverlayMs = 0
let perfMagnifierMs = 0

const debugEnabled =
  window.location.search.includes('snipDebug=1') || window.localStorage.getItem('snipDebug') === '1'

function dbg(...args: unknown[]): void {
  if (!debugEnabled) return
  console.log('[snip]', ...args)
}

function setCursorByMode(mode: DragMode, inside: boolean): void {
  const canvas = canvasRef.value
  if (!canvas) return

  const cursor =
    mode === 'resize-nw' || mode === 'resize-se'
      ? 'nwse-resize'
      : mode === 'resize-ne' || mode === 'resize-sw'
        ? 'nesw-resize'
        : mode === 'resize-n' || mode === 'resize-s'
          ? 'ns-resize'
          : mode === 'resize-e' || mode === 'resize-w'
            ? 'ew-resize'
            : inside
              ? 'move'
              : 'crosshair'

  canvas.style.cursor = cursor
}

function updateViewport(): void {
  viewportWidth.value = window.innerWidth
  viewportHeight.value = window.innerHeight
  overlayDirty = true
  requestFrame()
}

function ensureOverlayContext(): { ctx: CanvasRenderingContext2D; dpr: number } | null {
  const canvas = canvasRef.value
  if (!canvas) return null
  if (!overlayCtx) overlayCtx = canvas.getContext('2d')
  const ctx = overlayCtx
  if (!ctx) return null

  const dpr = window.devicePixelRatio || 1
  const targetW = Math.floor(viewportWidth.value * dpr)
  const targetH = Math.floor(viewportHeight.value * dpr)
  if (overlayCanvasW !== targetW || overlayCanvasH !== targetH || overlayCanvasDpr !== dpr) {
    canvas.width = targetW
    canvas.height = targetH
    canvas.style.width = `${viewportWidth.value}px`
    canvas.style.height = `${viewportHeight.value}px`
    overlayCanvasW = targetW
    overlayCanvasH = targetH
    overlayCanvasDpr = dpr
    overlayDirty = true
  }

  return { ctx, dpr }
}

function drawOverlay(): void {
  if (!overlayDirty) return
  overlayDirty = false

  const r = ensureOverlayContext()
  if (!r) return
  const { ctx, dpr } = r

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, viewportWidth.value, viewportHeight.value)

  const b = bounds.value
  if (!b || b.width <= 0 || b.height <= 0) return

  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)'
  ctx.fillRect(0, 0, viewportWidth.value, viewportHeight.value)
  ctx.clearRect(b.x, b.y, b.width, b.height)

  ctx.strokeStyle = '#4f8cff'
  ctx.lineWidth = 2
  ctx.strokeRect(b.x + 0.5, b.y + 0.5, b.width - 1, b.height - 1)

  ctx.fillStyle = '#ffffff'
  ctx.strokeStyle = '#1b1b1b'
  ctx.lineWidth = 1
  ctx.beginPath()

  const x1 = b.x
  const y1 = b.y
  const x2 = b.x + b.width
  const y2 = b.y + b.height
  const xm = b.x + b.width / 2
  const ym = b.y + b.height / 2

  ctx.rect(x1 - handleRadius, y1 - handleRadius, handleRadius * 2, handleRadius * 2)
  ctx.rect(xm - handleRadius, y1 - handleRadius, handleRadius * 2, handleRadius * 2)
  ctx.rect(x2 - handleRadius, y1 - handleRadius, handleRadius * 2, handleRadius * 2)
  ctx.rect(x2 - handleRadius, ym - handleRadius, handleRadius * 2, handleRadius * 2)
  ctx.rect(x2 - handleRadius, y2 - handleRadius, handleRadius * 2, handleRadius * 2)
  ctx.rect(xm - handleRadius, y2 - handleRadius, handleRadius * 2, handleRadius * 2)
  ctx.rect(x1 - handleRadius, y2 - handleRadius, handleRadius * 2, handleRadius * 2)
  ctx.rect(x1 - handleRadius, ym - handleRadius, handleRadius * 2, handleRadius * 2)

  ctx.fill()
  ctx.stroke()
}

function drawMagnifier(p: { x: number; y: number }, nowMs: number): void {
  const img = imageRef.value
  const canvas = magnifierCanvasRef.value
  if (!img || !canvas || !imageReady.value) {
    magnifierCtxRef.value = null
    return
  }
  if (!magnifierCtxRef.value) {
    magnifierCtxRef.value = canvas.getContext('2d')
  }
  const ctx = magnifierCtxRef.value
  if (!ctx) return
  ctx.imageSmoothingEnabled = false

  ctx.clearRect(0, 0, magnifierWidth, magnifierHeight)
  const rx = img.naturalWidth / viewportWidth.value
  const ry = img.naturalHeight / viewportHeight.value
  ctx.drawImage(
    img,
    p.x * rx - magnifierWidth / 2,
    p.y * ry - magnifierHeight / 2,
    magnifierWidth,
    magnifierHeight,
    0,
    0,
    magnifierWidth,
    magnifierHeight
  )

  if (nowMs - lastColorSampleAt < colorSampleIntervalMs) return
  lastColorSampleAt = nowMs
  const { data } = ctx.getImageData((magnifierWidth / 2) | 0, (magnifierHeight / 2) | 0, 1, 1)
  const r = data[0] ?? 0
  const g = data[1] ?? 0
  const b = data[2] ?? 0
  const hex = [r, g, b]
    .map((v) => (v >= 16 ? v.toString(16) : `0${v.toString(16)}`))
    .join('')
    .toUpperCase()
  if (hexColor.value !== hex) hexColor.value = hex
  const rgb = `rgb(${r}, ${g}, ${b})`
  if (rgbText.value !== rgb) rgbText.value = rgb
}

async function cropToBlob(b: Bounds): Promise<Blob | null> {
  const img = imageRef.value
  if (!img || !imageReady.value) return null
  if (!Number.isFinite(img.naturalWidth) || !Number.isFinite(img.naturalHeight)) return null
  if (b.width < 1 || b.height < 1) return null

  const width = viewportWidth.value
  const height = viewportHeight.value
  if (width < 1 || height < 1) return null
  const rx = img.naturalWidth / width
  const ry = img.naturalHeight / height

  const dpr = window.devicePixelRatio || 1
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.floor(b.width * dpr))
  canvas.height = Math.max(1, Math.floor(b.height * dpr))
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'low'
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, b.width, b.height)
  ctx.drawImage(img, b.x * rx, b.y * ry, b.width * rx, b.height * ry, 0, 0, b.width, b.height)

  let blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/png')
  })
  if (blob) return blob

  try {
    const dataUrl = canvas.toDataURL('image/png')
    const res = await fetch(dataUrl)
    blob = await res.blob()
    return blob.size > 0 ? blob : null
  } catch {
    return null
  }
}

async function onOk(): Promise<void> {
  if (submitting.value) return
  dbg('click ok', {
    bounds: bounds.value,
    display: display.value,
    imageReady: imageReady.value,
    url: url.value
  })
  const b = bounds.value
  const d = display.value
  if (!b || !d) return
  submitting.value = true
  try {
    const blob = await cropToBlob(b)
    dbg('ok cropToBlob', { ok: Boolean(blob), size: blob?.size ?? 0 })
    if (!blob) return
    const data = { bounds: { ...toRaw(b) }, display: { ...toRaw(d) } }
    window.screenshots.ok(await blob.arrayBuffer(), data)
    dbg('ok ipc sent')
  } finally {
    submitting.value = false
  }
}

async function onSave(): Promise<void> {
  if (submitting.value) return
  dbg('click save', {
    bounds: bounds.value,
    display: display.value,
    imageReady: imageReady.value,
    url: url.value
  })
  const b = bounds.value
  const d = display.value
  if (!b || !d) return
  submitting.value = true
  try {
    const blob = await cropToBlob(b)
    dbg('save cropToBlob', { ok: Boolean(blob), size: blob?.size ?? 0 })
    if (!blob) return
    const data = { bounds: { ...toRaw(b) }, display: { ...toRaw(d) } }
    window.screenshots.save(await blob.arrayBuffer(), data)
    dbg('save ipc sent')
  } finally {
    submitting.value = false
  }
}

function onCancel(): void {
  window.screenshots.cancel()
}

function updateCursorFromPointer(p: { x: number; y: number }): void {
  const b = bounds.value
  if (!b) {
    setCursorByMode(null, false)
    return
  }
  const handle = getHandleAtPoint(p, b, handleRadius)
  setCursorByMode(handle, isPointInBounds(p, b))
}

function setBounds(next: Bounds): void {
  const prev = bounds.value
  if (next.width < 1 || next.height < 1) {
    if (bounds.value) {
      bounds.value = null
      overlayDirty = true
    }
    return
  }
  if (
    prev &&
    prev.x === next.x &&
    prev.y === next.y &&
    prev.width === next.width &&
    prev.height === next.height
  ) {
    return
  }
  bounds.value = next
  overlayDirty = true
}

function applyPointer(p: Point): void {
  const mode = dragMode.value
  const start = dragStart.value
  const startB = dragStartBounds.value

  if (!mode || !start) {
    updateCursorFromPointer(p)
    return
  }

  if (mode !== 'new' && !startB) return

  const next = computeDragBounds({
    mode,
    start,
    startBounds: mode === 'new' ? null : startB,
    pointer: p,
    viewportWidth: viewportWidth.value,
    viewportHeight: viewportHeight.value
  })
  setBounds(next)
}

function onPointerDown(e: PointerEvent): void {
  if (!url.value) return
  if (e.button !== 0) return
  const canvas = canvasRef.value
  if (canvas) {
    try {
      canvas.setPointerCapture(e.pointerId)
    } catch (err) {
      console.error(err)
    }
  }

  const p = {
    x: clamp(e.clientX, 0, viewportWidth.value),
    y: clamp(e.clientY, 0, viewportHeight.value)
  }
  pendingPointerX = p.x
  pendingPointerY = p.y
  hasPendingPointer = true
  magnifierDirty = true
  requestFrame()

  const b = bounds.value
  if (!b || b.width <= 0 || b.height <= 0) {
    dragMode.value = 'new'
    dragStart.value = p
    dragStartBounds.value = null
    setBounds({ x: p.x, y: p.y, width: 0, height: 0 })
    return
  }

  const handle = getHandleAtPoint(p, b, handleRadius)
  if (handle) {
    dragMode.value = handle
    dragStart.value = p
    dragStartBounds.value = { ...b }
    return
  }

  if (isPointInBounds(p, b)) {
    dragMode.value = 'move'
    dragStart.value = p
    dragStartBounds.value = { ...b }
    return
  }

  dragMode.value = 'new'
  dragStart.value = p
  dragStartBounds.value = null
  setBounds({ x: p.x, y: p.y, width: 0, height: 0 })
}

function onPointerMove(e: PointerEvent): void {
  if (!url.value) return
  pendingPointerX = clamp(e.clientX, 0, viewportWidth.value)
  pendingPointerY = clamp(e.clientY, 0, viewportHeight.value)
  hasPendingPointer = true
  magnifierDirty = true
  requestFrame()
}

function onPointerUp(e?: PointerEvent): void {
  const canvas = canvasRef.value
  if (canvas && e) {
    try {
      canvas.releasePointerCapture(e.pointerId)
    } catch (err) {
      console.error(err)
    }
  }
  dragMode.value = null
  dragStart.value = null
  dragStartBounds.value = null
  overlayDirty = true
  requestFrame()
}

function updateMagnifierPosition(p: { x: number; y: number }): void {
  const pad = 20
  let tx = p.x + pad
  let ty = p.y + pad
  const width = magnifierWidth + 12
  const height = magnifierHeight + 46
  if (tx + width > viewportWidth.value) {
    tx = p.x - width - pad
  }
  if (ty + height > viewportHeight.value) {
    ty = p.y - height - pad
  }
  magnifierPos.value = {
    x: clamp(tx, 0, viewportWidth.value - width),
    y: clamp(ty, 0, viewportHeight.value - height)
  }
}

function rgbToHex(r: number, g: number, b: number): string {
  const to = (n: number): string => n.toString(16).padStart(2, '0')
  return `#${to(r)}${to(g)}${to(b)}`
}

async function copyColor(mode: 'hex' | 'rgb'): Promise<void> {
  const img = imageRef.value
  if (!img || !imageReady.value) return
  const p = lastPointer.value
  if (!p) return

  const width = viewportWidth.value
  const height = viewportHeight.value
  const rx = img.naturalWidth / width
  const ry = img.naturalHeight / height
  const sx = Math.floor(p.x * rx)
  const sy = Math.floor(p.y * ry)
  if (sx < 0 || sy < 0 || sx >= img.naturalWidth || sy >= img.naturalHeight) return

  const sampler = document.createElement('canvas')
  sampler.width = img.naturalWidth
  sampler.height = img.naturalHeight
  const ctx = sampler.getContext('2d')
  if (!ctx) return
  ctx.drawImage(img, 0, 0)
  const data = ctx.getImageData(sx, sy, 1, 1).data
  const r = data[0] ?? 0
  const g = data[1] ?? 0
  const b = data[2] ?? 0

  const text = mode === 'rgb' ? `rgb(${r}, ${g}, ${b})` : rgbToHex(r, g, b)
  if (window.screenshots?.copyText) {
    window.screenshots.copyText(text)
    return
  }
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.style.position = 'fixed'
    textarea.style.left = '-9999px'
    textarea.style.top = '0'
    document.body.appendChild(textarea)
    textarea.focus()
    textarea.select()
    try {
      document.execCommand('copy')
    } finally {
      textarea.remove()
    }
  }
}

function onKeyDown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault()
    onCancel()
    return
  }
  if (e.key === 'Shift' && !e.repeat) {
    e.preventDefault()
    colorMode.value = colorMode.value === 'HEX' ? 'RGB' : 'HEX'
    return
  }
  if (e.key === 'Enter') {
    e.preventDefault()
    void onOk()
    return
  }
  if (e.key.toLowerCase() === 'c') {
    e.preventDefault()
    void copyColor(e.shiftKey ? 'rgb' : 'hex')
    bounds.value = null
    requestAnimationFrame(() => window.screenshots.reset())
    requestFrame()
    return
  }
  if (e.key.toLowerCase() === 's') {
    e.preventDefault()
    void onSave()
  }
}

const toolbarStyle = computed(() => {
  const b = bounds.value
  if (!b || !imageReady.value || b.width < 1 || b.height < 1) return { display: 'none' }
  const top = clamp(b.y + b.height + 10, 10, viewportHeight.value - 54)
  const left = clamp(b.x, 10, viewportWidth.value - 260)
  return { top: `${top}px`, left: `${left}px` }
})

function onImageLoad(): void {
  imageReady.value = true
  overlayDirty = true
  magnifierDirty = true
}

function onImageError(): void {
  imageReady.value = false
  overlayDirty = true
  magnifierDirty = true
}

const onCapture = (d: Display, dataURL: string): void => {
  display.value = d
  url.value = dataURL
  bounds.value = null
  imageReady.value = false
  magnifierPos.value = null
  lastPointer.value = null
  overlayDirty = true
  magnifierDirty = true
  requestFrame()
}

const onReset = (): void => {
  url.value = null
  display.value = null
  bounds.value = null
  imageReady.value = false
  magnifierPos.value = null
  lastPointer.value = null
  overlayDirty = true
  magnifierDirty = true
  requestAnimationFrame(() => window.screenshots.reset())
  requestFrame()
}

const onSetLang = (next: Partial<Lang>): void => {
  lang.value = { ...defaultLang, ...next }
  requestFrame()
}

let frameRaf = 0
let pendingPointerX = 0
let pendingPointerY = 0
let hasPendingPointer = false

function requestFrame(): void {
  if (frameRaf) return
  frameRaf = requestAnimationFrame((nowMs) => {
    frameRaf = 0
    const dragging = dragMode.value !== null
    if (hasPendingPointer) {
      hasPendingPointer = false
      const p = { x: pendingPointerX, y: pendingPointerY }
      applyPointer(p)
      lastMagnifierPointer = p
      if (nowMs - lastUiUpdateAt >= uiUpdateIntervalMs) {
        lastUiUpdateAt = nowMs
        lastPointer.value = p
        updateMagnifierPosition(p)
      }
    }
    const mp = lastMagnifierPointer
    if (magnifierDirty && mp) {
      if (lastMagnifierDrawAt === 0 || nowMs - lastMagnifierDrawAt >= uiUpdateIntervalMs) {
        lastMagnifierDrawAt = nowMs
        const t0 = perfEnabled ? performance.now() : 0
        magnifierDirty = false
        drawMagnifier(mp, nowMs)
        if (perfEnabled && dragging) perfMagnifierMs += performance.now() - t0
      } else {
        requestFrame()
      }
    }
    const t1 = perfEnabled ? performance.now() : 0
    drawOverlay()
    if (perfEnabled && dragging) perfOverlayMs += performance.now() - t1

    if (perfEnabled && dragging) {
      perfFrameCount += 1
      if (perfLastReportAt === 0) perfLastReportAt = nowMs
      const dt = nowMs - perfLastReportAt
      if (dt >= 1000) {
        const fps = (perfFrameCount * 1000) / dt
        const overlayAvg = perfOverlayMs / perfFrameCount
        const magnifierAvg = perfMagnifierMs / perfFrameCount
        perfText.value = `fps ${fps.toFixed(1)} | overlay ${overlayAvg.toFixed(2)}ms | magnifier ${magnifierAvg.toFixed(2)}ms`
        perfFrameCount = 0
        perfOverlayMs = 0
        perfMagnifierMs = 0
        perfLastReportAt = nowMs
      }
    }
  })
}

const captureListener: ScreenshotsListener = (...args: unknown[]): void => {
  onCapture(args[0] as Display, args[1] as string)
}
const setLangListener: ScreenshotsListener = (...args: unknown[]): void => {
  onSetLang(args[0] as Partial<Lang>)
}
const ipcAckListener: ScreenshotsListener = (...args: unknown[]): void => {
  dbg('ipc ack', args[0])
}

const docClickCapture = (e: MouseEvent): void => {
  const t = e.target
  if (!(t instanceof Element)) {
    dbg('doc click capture', { target: typeof t })
    return
  }
  dbg('doc click capture', {
    target: t.tagName,
    className: t.getAttribute('class') ?? '',
    toolbar: Boolean(t.closest('.toolbar')),
    overlay: Boolean(t.closest('.overlay')),
    pathLen: (e.composedPath?.() ?? []).length
  })
}

onMounted(() => {
  window.screenshots.on('capture', captureListener)
  window.screenshots.on('reset', onReset)
  window.screenshots.on('setLang', setLangListener)
  if (debugEnabled) {
    window.screenshots.on('ipcAck', ipcAckListener)
    document.addEventListener('click', docClickCapture, true)
  }

  window.addEventListener('resize', updateViewport)
  window.addEventListener('keydown', onKeyDown)

  const canvas = canvasRef.value
  if (canvas) {
    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('pointercancel', onPointerUp)
  }

  void nextTick()
  window.screenshots.ready()
  requestFrame()
})

onBeforeUnmount(() => {
  window.screenshots.off('capture', captureListener)
  window.screenshots.off('reset', onReset)
  window.screenshots.off('setLang', setLangListener)
  if (debugEnabled) {
    window.screenshots.off('ipcAck', ipcAckListener)
    document.removeEventListener('click', docClickCapture, true)
  }

  window.removeEventListener('resize', updateViewport)
  window.removeEventListener('keydown', onKeyDown)

  const c = canvasRef.value
  if (c) {
    c.removeEventListener('pointerdown', onPointerDown)
    c.removeEventListener('pointermove', onPointerMove)
    c.removeEventListener('pointerup', onPointerUp)
    c.removeEventListener('pointercancel', onPointerUp)
  }

  if (frameRaf) {
    cancelAnimationFrame(frameRaf)
    frameRaf = 0
  }
  overlayCtx = null
  magnifierCtxRef.value = null
})
</script>

<template>
  <div class="root">
    <img
      v-if="url"
      ref="imageRef"
      class="bg"
      :src="url"
      alt=""
      draggable="false"
      @load="onImageLoad"
      @error="onImageError"
    />
    <div v-else class="blank" />
    <canvas ref="canvasRef" class="overlay" />
    <div v-if="perfEnabled && perfText" class="perf">{{ perfText }}</div>

    <div
      v-if="magnifierPos"
      class="magnifier"
      :style="{ transform: `translate(${magnifierPos.x}px, ${magnifierPos.y}px)` }"
    >
      <div class="magnifier-body">
        <canvas
          ref="magnifierCanvasRef"
          class="magnifier-canvas"
          :width="magnifierWidth"
          :height="magnifierHeight"
        />
      </div>
      <div class="magnifier-footer">
        <div class="magnifier-item">
          {{ lang.magnifier_position_label }}: ({{ lastPointer?.x ?? 0 }},{{ lastPointer?.y ?? 0 }})
        </div>
        <div class="magnifier-item color">
          <span>{{ colorMode === 'HEX' ? 'HEX:' : 'RGB:' }}</span>
          <span
            class="color-dot"
            :style="{ backgroundColor: colorMode === 'HEX' ? `#${hexColor}` : rgbText }"
          />
          <span>{{ colorMode === 'HEX' ? `#${hexColor}` : rgbText }}</span>
        </div>
        <div class="magnifier-tips">
          <span class="tips-key">C</span> 复制 / <span class="tips-key">Shift</span> 切换
        </div>
      </div>
    </div>

    <div class="toolbar" :style="toolbarStyle">
      <button class="btn" type="button" :disabled="submitting" @click="onOk">
        {{ lang.operation_ok_title }}
      </button>
      <button class="btn" type="button" :disabled="submitting" @click="onSave">
        {{ lang.operation_save_title }}
      </button>
      <button class="btn danger" type="button" :disabled="submitting" @click="onCancel">
        {{ lang.operation_cancel_title }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.root {
  position: fixed;
  inset: 0;
  overflow: hidden;
  background: transparent;
}

.bg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: fill;
  z-index: 0;
}

.blank {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.3);
  z-index: 0;
}

.overlay {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  touch-action: none;
  z-index: 1;
}

.perf {
  position: absolute;
  top: 10px;
  left: 10px;
  padding: 6px 8px;
  border-radius: 8px;
  background: rgba(26, 26, 26, 0.85);
  color: rgba(255, 255, 255, 0.92);
  font-size: 12px;
  z-index: 4;
  user-select: none;
  pointer-events: none;
}

.toolbar {
  position: absolute;
  display: flex;
  gap: 8px;
  padding: 10px;
  border-radius: 10px;
  background: rgba(20, 20, 20, 0.6);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  z-index: 3;
  pointer-events: auto;
}

.magnifier {
  position: absolute;
  width: 150px;
  padding: 6px;
  border-radius: 8px;
  background: rgba(26, 26, 26, 0.85);
  color: rgba(255, 255, 255, 0.92);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.35);
  user-select: none;
  z-index: 2;
}
.magnifier-body {
  border-radius: 6px;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.2);
}
.magnifier-canvas {
  display: block;
  width: 150px;
  height: 80px;
}
.magnifier-footer {
  margin-top: 6px;
  display: grid;
  grid-template-columns: 1fr;
  gap: 4px;
  font-size: 12px;
}
.magnifier-item.color {
  display: flex;
  align-items: center;
  gap: 6px;
}
.color-dot {
  width: 10px;
  height: 10px;
  display: inline-block;
  border: 1px solid rgba(255, 255, 255, 0.6);
}
.magnifier-tips .tips-key {
  display: inline-block;
  min-width: 16px;
  padding: 0 4px;
  text-align: center;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.12);
}

.btn {
  height: 34px;
  padding: 0 12px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.92);
  font-size: 13px;
  cursor: pointer;
}

.btn:hover {
  background: rgba(255, 255, 255, 0.14);
}

.btn:active {
  transform: translateY(1px);
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn.danger {
  border-color: rgba(255, 80, 80, 0.35);
  background: rgba(255, 80, 80, 0.12);
}

.btn.danger:hover {
  background: rgba(255, 80, 80, 0.18);
}
</style>
