<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, toRaw, watch } from 'vue'
import {
  Brush,
  Check,
  Circle,
  Grid3X3,
  X,
  MousePointer2,
  PaintBucket,
  Palette,
  Slash,
  Save,
  Redo2,
  Square,
  Undo2,
  Type as TypeIcon
} from 'lucide-vue-next'
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
const windowRects = ref<Array<{ x: number; y: number; width: number; height: number; z?: number }>>(
  []
)
const autoBounds = ref(false)
const autoBoundsEnabled = ref(true)

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
const uiUpdateIntervalMs = 16
const colorSampleIntervalMs = 66

const dragMode = ref<DragMode>(null)
const dragStart = ref<Point | null>(null)
const dragStartBounds = ref<Bounds | null>(null)
const lastPointer = ref<Point | null>(null)
let pointerAltKey = false

const handleRadius = 6

type Tool = 'select' | 'line' | 'rect' | 'ellipse' | 'brush' | 'mosaic' | 'text'
type ToolMode = 'stroke' | 'fill'

const iconSize = 14

type DrawLine = {
  id: number
  kind: 'line'
  from: Point
  to: Point
  color: string
  width: number
}

type DrawRect = {
  id: number
  kind: 'rect'
  from: Point
  to: Point
  color: string
  width: number
  mode: ToolMode
}

type DrawEllipse = {
  id: number
  kind: 'ellipse'
  from: Point
  to: Point
  color: string
  width: number
  mode: ToolMode
}

type DrawBrush = {
  id: number
  kind: 'brush'
  points: Point[]
  color: string
  width: number
}

type DrawMosaic = {
  id: number
  kind: 'mosaic'
  from: Point
  to: Point
  pixelSize: number
}

type DrawText = {
  id: number
  kind: 'text'
  at: Point
  text: string
  color: string
  fontSize: number
}

type DrawOp = DrawLine | DrawRect | DrawEllipse | DrawBrush | DrawMosaic | DrawText

const tool = ref<Tool>('select')
const toolMode = ref<ToolMode>('stroke')
const toolColor = ref('#FF3B30')
const toolWidth = ref(4)
const toolPalette = ['#FF3B30', '#FF9500', '#FFCC00', '#34C759', '#0A84FF', '#AF52DE', '#FFFFFF']
const showColorPicker = ref(false)
const colorInputRef = ref<HTMLInputElement | null>(null)

const strokeRangeStyle = computed(() => {
  const min = 1
  const max = 32
  const v = clamp(toolWidth.value, min, max)
  const p = ((v - min) / (max - min)) * 100
  return { ['--p' as string]: `${p.toFixed(2)}%` }
})

const strokeDotStyle = computed(() => {
  const size = Math.round(clamp(6 + toolWidth.value * 0.5, 6, 22))
  return {
    width: `${size}px`,
    height: `${size}px`,
    backgroundColor: toolColor.value
  }
})

const ops = ref<DrawOp[]>([])
const redoOps = ref<DrawOp[]>([])
let nextOpId = 1

let drawingPointerId: number | null = null
const drawingOp = ref<DrawOp | null>(null)
let mosaicSamplerCanvas: HTMLCanvasElement | null = null
let mosaicSamplerCtx: CanvasRenderingContext2D | null = null

const textEditorOpen = ref(false)
const textEditorPos = ref<Point | null>(null)
const textEditorValue = ref('')
const textEditorColor = ref('#ffffff')
const textEditorFontSize = ref(16)
const textEditorRef = ref<HTMLTextAreaElement | null>(null)

const textEditorStyle = computed(() => {
  const p = textEditorPos.value
  if (!p) return { display: 'none' }
  return {
    transform: `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)`,
    color: textEditorColor.value,
    fontSize: `${textEditorFontSize.value}px`
  }
})

function fontSizeFromToolWidth(w: number): number {
  return Math.round(clamp(10 + w * 1.2, 10, 52))
}

function openTextEditor(at: Point): void {
  const b = bounds.value
  if (!b) return
  textEditorOpen.value = true
  textEditorValue.value = ''
  textEditorColor.value = toolColor.value
  textEditorFontSize.value = fontSizeFromToolWidth(toolWidth.value)
  const x = clamp(at.x, b.x, b.x + b.width - 10)
  const y = clamp(at.y, b.y, b.y + b.height - 10)
  textEditorPos.value = { x, y }
  requestAnimationFrame(() => {
    textEditorRef.value?.focus()
  })
}

function closeTextEditor(): void {
  textEditorOpen.value = false
  textEditorPos.value = null
  textEditorValue.value = ''
}

function commitTextEditor(): void {
  if (!textEditorOpen.value) return
  const p = textEditorPos.value
  const raw = textEditorValue.value
  const text = raw.replace(/\r\n/g, '\n').trim()
  const color = textEditorColor.value
  const fontSize = textEditorFontSize.value
  closeTextEditor()
  if (!p || !text) return
  pushOp({
    id: nextOpId++,
    kind: 'text',
    at: p,
    text,
    color,
    fontSize
  })
}

function onTextEditorKeyDown(e: KeyboardEvent): void {
  e.stopPropagation()
  if (e.key === 'F3' || e.code === 'F3') {
    e.preventDefault()
    commitTextEditor()
    void onSaveAndStick()
    return
  }
  if (e.key === 'Escape') {
    e.preventDefault()
    closeTextEditor()
    return
  }
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    commitTextEditor()
  }
}

function normalizeRect(
  a: Point,
  b: Point
): { x: number; y: number; width: number; height: number } {
  const x1 = Math.min(a.x, b.x)
  const y1 = Math.min(a.y, b.y)
  const x2 = Math.max(a.x, b.x)
  const y2 = Math.max(a.y, b.y)
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 }
}

function clampPointToBounds(p: Point, b: Bounds): Point {
  return { x: clamp(p.x, b.x, b.x + b.width), y: clamp(p.y, b.y, b.y + b.height) }
}

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '').trim()
  if (h.length !== 6) return `rgba(255, 255, 255, ${alpha})`
  const r = Number.parseInt(h.slice(0, 2), 16)
  const g = Number.parseInt(h.slice(2, 4), 16)
  const b = Number.parseInt(h.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function canAnnotate(): boolean {
  const b = bounds.value
  return Boolean(b && imageReady.value && b.width >= 1 && b.height >= 1)
}

const canUndo = computed(() => ops.value.length > 0)
const canRedo = computed(() => redoOps.value.length > 0)

function pushOp(op: DrawOp): void {
  ops.value = [...ops.value, op]
  redoOps.value = []
  overlayDirty = true
  requestFrame()
}

function undo(): void {
  const cur = ops.value
  if (cur.length === 0) return
  const last = cur[cur.length - 1]
  ops.value = cur.slice(0, -1)
  redoOps.value = [...redoOps.value, last]
  overlayDirty = true
  requestFrame()
}

function redo(): void {
  const r = redoOps.value
  if (r.length === 0) return
  const last = r[r.length - 1]
  redoOps.value = r.slice(0, -1)
  ops.value = [...ops.value, last]
  overlayDirty = true
  requestFrame()
}

function pickColor(next: string): void {
  toolColor.value = next
  showColorPicker.value = false
}

function openColorPicker(): void {
  showColorPicker.value = true
  requestAnimationFrame(() => {
    colorInputRef.value?.click()
  })
}

function setTool(next: Tool): void {
  tool.value = next
  drawingOp.value = null
  drawingPointerId = null
  if (next !== 'text') closeTextEditor()
  overlayDirty = true
  requestFrame()
}

function drawEllipsePath(ctx: CanvasRenderingContext2D, a: Point, b: Point): void {
  const r = normalizeRect(a, b)
  const rx = r.width / 2
  const ry = r.height / 2
  const cx = r.x + rx
  const cy = r.y + ry
  if (rx <= 0 || ry <= 0) return
  if (typeof ctx.ellipse === 'function') {
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
    return
  }
  const kappa = 0.5522848
  const ox = rx * kappa
  const oy = ry * kappa
  ctx.moveTo(cx + rx, cy)
  ctx.bezierCurveTo(cx + rx, cy + oy, cx + ox, cy + ry, cx, cy + ry)
  ctx.bezierCurveTo(cx - ox, cy + ry, cx - rx, cy + oy, cx - rx, cy)
  ctx.bezierCurveTo(cx - rx, cy - oy, cx - ox, cy - ry, cx, cy - ry)
  ctx.bezierCurveTo(cx + ox, cy - ry, cx + rx, cy - oy, cx + rx, cy)
}

function ensureMosaicSampler(): CanvasRenderingContext2D | null {
  if (!mosaicSamplerCanvas) {
    mosaicSamplerCanvas = document.createElement('canvas')
  }
  if (!mosaicSamplerCtx) {
    mosaicSamplerCtx = mosaicSamplerCanvas.getContext('2d')
  }
  return mosaicSamplerCtx
}

function drawMosaic(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  rx: number,
  ry: number,
  from: Point,
  to: Point,
  offsetX: number,
  offsetY: number,
  pixelSize: number
): void {
  const r = normalizeRect(from, to)
  if (r.width < 1 || r.height < 1) return
  const sampler = ensureMosaicSampler()
  if (!sampler || !mosaicSamplerCanvas) return

  const sx = Math.floor(r.x * rx)
  const sy = Math.floor(r.y * ry)
  const sw = Math.max(1, Math.floor(r.width * rx))
  const sh = Math.max(1, Math.floor(r.height * ry))

  const px = Math.max(1, Math.round(pixelSize * Math.max(rx, ry)))
  const dw = Math.max(1, Math.floor(sw / px))
  const dh = Math.max(1, Math.floor(sh / px))

  mosaicSamplerCanvas.width = dw
  mosaicSamplerCanvas.height = dh
  sampler.imageSmoothingEnabled = true
  sampler.clearRect(0, 0, dw, dh)
  sampler.drawImage(img, sx, sy, sw, sh, 0, 0, dw, dh)

  ctx.save()
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(mosaicSamplerCanvas, 0, 0, dw, dh, r.x - offsetX, r.y - offsetY, r.width, r.height)
  ctx.restore()
}

function renderOp(
  ctx: CanvasRenderingContext2D,
  op: DrawOp,
  img: HTMLImageElement | null,
  rx: number,
  ry: number,
  offsetX: number,
  offsetY: number
): void {
  if (op.kind === 'mosaic') {
    if (!img) return
    drawMosaic(ctx, img, rx, ry, op.from, op.to, offsetX, offsetY, op.pixelSize)
    return
  }

  ctx.save()
  ctx.translate(-offsetX, -offsetY)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  if (op.kind === 'line') {
    ctx.strokeStyle = op.color
    ctx.lineWidth = op.width
    ctx.beginPath()
    ctx.moveTo(op.from.x, op.from.y)
    ctx.lineTo(op.to.x, op.to.y)
    ctx.stroke()
    ctx.restore()
    return
  }

  if (op.kind === 'brush') {
    if (op.points.length < 2) {
      ctx.restore()
      return
    }
    ctx.strokeStyle = op.color
    ctx.lineWidth = op.width
    ctx.beginPath()
    ctx.moveTo(op.points[0].x, op.points[0].y)
    for (let i = 1; i < op.points.length; i += 1) {
      const p = op.points[i]
      ctx.lineTo(p.x, p.y)
    }
    ctx.stroke()
    ctx.restore()
    return
  }

  if (op.kind === 'rect') {
    const r = normalizeRect(op.from, op.to)
    if (r.width < 1 || r.height < 1) {
      ctx.restore()
      return
    }
    ctx.beginPath()
    ctx.rect(r.x, r.y, r.width, r.height)
    if (op.mode === 'fill') {
      ctx.fillStyle = hexToRgba(op.color, 0.22)
      ctx.fill()
    }
    ctx.strokeStyle = op.color
    ctx.lineWidth = op.width
    ctx.stroke()
    ctx.restore()
    return
  }

  if (op.kind === 'ellipse') {
    const r = normalizeRect(op.from, op.to)
    if (r.width < 1 || r.height < 1) {
      ctx.restore()
      return
    }
    ctx.beginPath()
    drawEllipsePath(ctx, op.from, op.to)
    if (op.mode === 'fill') {
      ctx.fillStyle = hexToRgba(op.color, 0.22)
      ctx.fill()
    }
    ctx.strokeStyle = op.color
    ctx.lineWidth = op.width
    ctx.stroke()
    ctx.restore()
    return
  }

  if (op.kind === 'text') {
    const lines = op.text.split('\n')
    if (lines.length === 0) {
      ctx.restore()
      return
    }
    ctx.fillStyle = op.color
    ctx.textBaseline = 'top'
    ctx.font = `${op.fontSize}px system-ui, -apple-system, Segoe UI, sans-serif`
    const lineHeight = op.fontSize * 1.25
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i]
      if (!line) continue
      ctx.fillText(line, op.at.x, op.at.y + i * lineHeight)
    }
    ctx.restore()
    return
  }

  ctx.restore()
}

function renderAllOps(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement | null,
  rx: number,
  ry: number,
  offsetX: number,
  offsetY: number
): void {
  for (const op of ops.value) renderOp(ctx, op, img, rx, ry, offsetX, offsetY)
  const draft = drawingOp.value
  if (draft) renderOp(ctx, draft, img, rx, ry, offsetX, offsetY)
}

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

  const dpr = 1
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

  const img = imageRef.value
  if (img && imageReady.value) {
    const rx = img.naturalWidth / viewportWidth.value
    const ry = img.naturalHeight / viewportHeight.value
    ctx.save()
    ctx.beginPath()
    ctx.rect(b.x, b.y, b.width, b.height)
    ctx.clip()
    renderAllOps(ctx, img, rx, ry, 0, 0)
    ctx.restore()
  }

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

  const cx = (magnifierWidth / 2) | 0
  const cy = (magnifierHeight / 2) | 0
  const size = 10
  ctx.save()
  ctx.globalAlpha = 0.95
  ctx.lineCap = 'butt'
  ctx.lineWidth = 3
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)'
  ctx.beginPath()
  ctx.moveTo(cx - size, cy + 0.5)
  ctx.lineTo(cx + size, cy + 0.5)
  ctx.moveTo(cx + 0.5, cy - size)
  ctx.lineTo(cx + 0.5, cy + size)
  ctx.stroke()
  ctx.lineWidth = 1
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)'
  ctx.beginPath()
  ctx.moveTo(cx - size, cy + 0.5)
  ctx.lineTo(cx + size, cy + 0.5)
  ctx.moveTo(cx + 0.5, cy - size)
  ctx.lineTo(cx + 0.5, cy + size)
  ctx.stroke()
  ctx.restore()
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
  renderAllOps(ctx, img, rx, ry, b.x, b.y)

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

async function onSaveAndStick(): Promise<void> {
  if (submitting.value) return
  const b = bounds.value
  const d = display.value
  if (!b || !d) return
  if (!imageReady.value) {
    const img = imageRef.value
    if (img) {
      const handler = (): void => {
        img.removeEventListener('load', handler)
        void onSaveAndStick()
      }
      img.addEventListener('load', handler, { once: true })
    }
    return
  }
  submitting.value = true
  try {
    const blob = await cropToBlob(b)
    if (!blob) return
    const data = {
      bounds: { ...toRaw(b) },
      display: { ...toRaw(d) },
      stickAfterSave: true
    } as unknown as { bounds: Bounds; display: Display }
    window.screenshots.save(await blob.arrayBuffer(), data)
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
  const inside = isPointInBounds(p, b)
  if (!handle && inside && tool.value !== 'select') {
    const canvas = canvasRef.value
    if (canvas) canvas.style.cursor = 'crosshair'
    return
  }
  if (!handle && inside && tool.value === 'select' && !pointerAltKey) {
    const canvas = canvasRef.value
    if (canvas) canvas.style.cursor = 'crosshair'
    return
  }
  setCursorByMode(handle, inside)
}

function setBounds(next: Bounds): void {
  const prev = bounds.value
  if (next.width < 1 || next.height < 1) {
    if (bounds.value) {
      bounds.value = null
      ops.value = []
      redoOps.value = []
      drawingOp.value = null
      drawingPointerId = null
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
  autoBounds.value = false
  pointerAltKey = e.altKey
  if (e.button === 2) {
    if (!bounds.value) {
      e.preventDefault()
      onCancel()
    }
    return
  }
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
    if (tool.value === 'select') {
      if (e.altKey) {
        dragMode.value = 'move'
        dragStart.value = p
        dragStartBounds.value = { ...b }
        return
      }
      dragMode.value = 'new'
      dragStart.value = p
      dragStartBounds.value = null
      setBounds({ x: p.x, y: p.y, width: 0, height: 0 })
      return
    }

    const start = clampPointToBounds(p, b)
    if (tool.value === 'text') {
      openTextEditor(start)
      overlayDirty = true
      requestFrame()
      return
    }
    drawingPointerId = e.pointerId
    if (tool.value === 'line') {
      drawingOp.value = {
        id: nextOpId++,
        kind: 'line',
        from: start,
        to: start,
        color: toolColor.value,
        width: toolWidth.value
      }
    } else if (tool.value === 'rect') {
      drawingOp.value = {
        id: nextOpId++,
        kind: 'rect',
        from: start,
        to: start,
        color: toolColor.value,
        width: toolWidth.value,
        mode: toolMode.value
      }
    } else if (tool.value === 'ellipse') {
      drawingOp.value = {
        id: nextOpId++,
        kind: 'ellipse',
        from: start,
        to: start,
        color: toolColor.value,
        width: toolWidth.value,
        mode: toolMode.value
      }
    } else if (tool.value === 'brush') {
      drawingOp.value = {
        id: nextOpId++,
        kind: 'brush',
        points: [start],
        color: toolColor.value,
        width: toolWidth.value
      }
    } else if (tool.value === 'mosaic') {
      drawingOp.value = {
        id: nextOpId++,
        kind: 'mosaic',
        from: start,
        to: start,
        pixelSize: clamp(toolWidth.value * 2, 4, 80)
      }
    } else {
      drawingOp.value = null
      drawingPointerId = null
    }
    overlayDirty = true
    requestFrame()
    return
  }

  dragMode.value = 'new'
  dragStart.value = p
  dragStartBounds.value = null
  setBounds({ x: p.x, y: p.y, width: 0, height: 0 })
}

function onContextMenu(e: MouseEvent): void {
  e.preventDefault()
  if (!bounds.value) onCancel()
}

function onDblClick(e: MouseEvent): void {
  if (!autoBoundsEnabled.value) return
  if (!autoBounds.value) return
  if (!bounds.value) return
  e.preventDefault()
  autoBounds.value = false
  autoBoundsEnabled.value = false
  overlayDirty = true
  requestFrame()
}

function onPointerMove(e: PointerEvent): void {
  if (!url.value) return
  pointerAltKey = e.altKey
  pendingPointerX = clamp(e.clientX, 0, viewportWidth.value)
  pendingPointerY = clamp(e.clientY, 0, viewportHeight.value)
  hasPendingPointer = true
  magnifierDirty = true
  if (dragMode.value === null && drawingPointerId === null) {
    const p = { x: pendingPointerX, y: pendingPointerY }
    if (autoBoundsEnabled.value && (!bounds.value || autoBounds.value)) {
      let hit: { x: number; y: number; width: number; height: number } | null = null
      for (const r of windowRects.value) {
        if (
          p.x >= r.x - (display.value?.x ?? 0) &&
          p.x <= r.x - (display.value?.x ?? 0) + r.width &&
          p.y >= r.y - (display.value?.y ?? 0) &&
          p.y <= r.y - (display.value?.y ?? 0) + r.height
        ) {
          hit = {
            x: r.x - (display.value?.x ?? 0),
            y: r.y - (display.value?.y ?? 0),
            width: r.width,
            height: r.height
          }
          break
        }
      }
      if (hit) {
        autoBounds.value = true
        setBounds(hit)
      } else if (autoBounds.value) {
        autoBounds.value = false
        bounds.value = null
        overlayDirty = true
      }
    }
  }
  const b = bounds.value
  const pid = drawingPointerId
  const draft = drawingOp.value
  if (b && pid !== null && draft && e.pointerId === pid) {
    const p = clampPointToBounds({ x: pendingPointerX, y: pendingPointerY }, b)
    if (draft.kind === 'brush') {
      const last = draft.points[draft.points.length - 1]
      const dx = p.x - last.x
      const dy = p.y - last.y
      if (dx * dx + dy * dy >= 1.5) {
        draft.points.push(p)
      }
    } else {
      ;(draft as DrawLine | DrawRect | DrawEllipse | DrawMosaic).to = p
    }
    overlayDirty = true
  }
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
  if (e && drawingPointerId !== null && e.pointerId === drawingPointerId) {
    drawingPointerId = null
    const op = drawingOp.value
    drawingOp.value = null
    if (op) {
      if (op.kind === 'brush') {
        if (op.points.length >= 2) pushOp(op)
      } else if (op.kind === 'mosaic') {
        const r = normalizeRect(op.from, op.to)
        if (r.width >= 2 && r.height >= 2) pushOp(op)
      } else if (op.kind === 'text') {
        if (op.text.trim()) pushOp(op)
      } else {
        const r = normalizeRect(op.from, op.to)
        if (r.width >= 1 && r.height >= 1) pushOp(op)
      }
    }
    overlayDirty = true
    requestFrame()
    return
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
  const t = e.target
  if (t instanceof HTMLTextAreaElement && t.classList.contains('text-editor')) return
  if (textEditorOpen.value) return
  const key = e.key.toLowerCase()
  const mod = e.ctrlKey || e.metaKey
  if (mod && key === 'z') {
    e.preventDefault()
    if (e.shiftKey) redo()
    else undo()
    return
  }
  if (mod && key === 'y') {
    e.preventDefault()
    redo()
    return
  }

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
  if (key === 'c') {
    e.preventDefault()
    void (async () => {
      await copyColor(e.shiftKey ? 'rgb' : 'hex')
      autoBounds.value = false
      onCancel()
    })()
    return
  }
  if (e.key === 'F3' || e.code === 'F3') {
    if (!bounds.value) return
    e.preventDefault()
    void onSaveAndStick()
    return
  }
  if (key === 's') {
    e.preventDefault()
    void onSave()
  }
}

const toolbarStyle = computed(() => {
  const b = bounds.value
  if (!b || !imageReady.value || b.width < 1 || b.height < 1) return { display: 'none' }
  const top = clamp(b.y + b.height + 10, 10, viewportHeight.value - 80)
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
  windowRects.value = []
  bounds.value = null
  imageReady.value = false
  autoBounds.value = false
  autoBoundsEnabled.value = true
  magnifierPos.value = null
  lastPointer.value = null
  ops.value = []
  redoOps.value = []
  drawingOp.value = null
  drawingPointerId = null
  tool.value = 'select'
  overlayDirty = true
  magnifierDirty = true
  requestFrame()
  void nextTick().then(() => {
    const img = imageRef.value
    if (img && img.complete && img.naturalWidth > 0) onImageLoad()
  })
}

const onReset = (): void => {
  url.value = null
  display.value = null
  windowRects.value = []
  bounds.value = null
  imageReady.value = false
  autoBounds.value = false
  autoBoundsEnabled.value = true
  magnifierPos.value = null
  lastPointer.value = null
  ops.value = []
  redoOps.value = []
  drawingOp.value = null
  drawingPointerId = null
  tool.value = 'select'
  overlayDirty = true
  magnifierDirty = true
  requestAnimationFrame(() => window.screenshots.reset())
  requestFrame()
}

watch(url, () => {
  imageReady.value = false
})

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
  const rects = Array.isArray(args[2]) ? (args[2] as Array<Record<string, unknown>>) : []
  windowRects.value = rects
    .map((r) => {
      const x = Number((r as { x?: unknown }).x)
      const y = Number((r as { y?: unknown }).y)
      const width = Number((r as { width?: unknown }).width)
      const height = Number((r as { height?: unknown }).height)
      const z = Number((r as { z?: unknown }).z)
      return { x, y, width, height, z }
    })
    .filter((r) => Number.isFinite(r.x) && Number.isFinite(r.y) && r.width > 0 && r.height > 0)
    .sort(
      (a, b) =>
        (Number.isFinite(b.z ?? 0) ? (b.z ?? 0) : 0) - (Number.isFinite(a.z ?? 0) ? (a.z ?? 0) : 0)
    )
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
  const api = window.screenshots
  if (api?.off) {
    api.off('capture', captureListener)
    api.off('reset', onReset)
    api.off('setLang', setLangListener)
  }
  if (debugEnabled) {
    api?.off?.('ipcAck', ipcAckListener)
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
    <canvas ref="canvasRef" class="overlay" @contextmenu="onContextMenu" @dblclick="onDblClick" />
    <textarea
      v-if="textEditorOpen"
      ref="textEditorRef"
      v-model="textEditorValue"
      class="text-editor"
      placeholder="输入文字…"
      :style="textEditorStyle"
      @keydown.stop="onTextEditorKeyDown"
      @blur="commitTextEditor"
    />
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
          <span class="tips-key">C</span> 复制并退出 / <span class="tips-key">Shift</span> 切换
        </div>
      </div>
    </div>

    <div class="toolbar" :style="toolbarStyle">
      <div v-if="canAnnotate()" class="tools">
        <div class="tools-row">
          <button
            class="icon-btn"
            type="button"
            :class="{ active: tool === 'select' }"
            title="选择/移动"
            aria-label="选择/移动"
            @click="setTool('select')"
          >
            <MousePointer2 :size="iconSize" />
          </button>
          <button
            class="icon-btn"
            type="button"
            :class="{ active: tool === 'line' }"
            title="直线"
            aria-label="直线"
            @click="setTool('line')"
          >
            <Slash :size="iconSize" />
          </button>
          <button
            class="icon-btn"
            type="button"
            :class="{ active: tool === 'rect' }"
            title="矩形"
            aria-label="矩形"
            @click="setTool('rect')"
          >
            <Square :size="iconSize" />
          </button>
          <button
            class="icon-btn"
            type="button"
            :class="{ active: tool === 'ellipse' }"
            title="圆形"
            aria-label="圆形"
            @click="setTool('ellipse')"
          >
            <Circle :size="iconSize" />
          </button>
          <button
            class="icon-btn"
            type="button"
            :class="{ active: tool === 'brush' }"
            title="笔刷"
            aria-label="笔刷"
            @click="setTool('brush')"
          >
            <Brush :size="iconSize" />
          </button>
          <button
            class="icon-btn"
            type="button"
            :class="{ active: tool === 'mosaic' }"
            title="打码"
            aria-label="打码"
            @click="setTool('mosaic')"
          >
            <Grid3X3 :size="iconSize" />
          </button>
          <button
            class="icon-btn"
            type="button"
            :class="{ active: tool === 'text' }"
            title="文字"
            aria-label="文字"
            @click="setTool('text')"
          >
            <TypeIcon :size="iconSize" />
          </button>
          <div class="divider"></div>
          <button
            class="icon-btn action-btn"
            type="button"
            :disabled="submitting"
            title="完成"
            aria-label="完成"
            @click="onOk"
          >
            <Check :size="iconSize" />
          </button>
          <button
            class="icon-btn action-btn"
            type="button"
            :disabled="submitting"
            title="保存"
            aria-label="保存"
            @click="onSave"
          >
            <Save :size="iconSize" />
          </button>
          <button
            class="icon-btn action-btn danger"
            type="button"
            :disabled="submitting"
            title="取消"
            aria-label="取消"
            @click="onCancel"
          >
            <X :size="iconSize" />
          </button>
        </div>

        <div class="tools-row">
          <button
            class="icon-btn"
            type="button"
            :class="{ active: toolMode === 'fill' }"
            title="填充"
            aria-label="填充"
            :disabled="tool !== 'rect' && tool !== 'ellipse'"
            @click="toolMode = toolMode === 'fill' ? 'stroke' : 'fill'"
          >
            <PaintBucket :size="iconSize" />
          </button>

          <button
            class="icon-btn color-btn"
            type="button"
            title="颜色"
            aria-label="颜色"
            @click="openColorPicker"
          >
            <span class="color-dot" :style="{ backgroundColor: toolColor }" />
            <Palette :size="iconSize" />
          </button>
          <input
            ref="colorInputRef"
            class="color-input"
            type="color"
            :value="toolColor"
            @input="pickColor(($event.target as HTMLInputElement).value)"
          />

          <div v-if="showColorPicker" class="palette">
            <button
              v-for="c in toolPalette"
              :key="c"
              class="swatch"
              type="button"
              :class="{ active: c.toLowerCase() === toolColor.toLowerCase() }"
              :style="{ backgroundColor: c }"
              @click="pickColor(c)"
            />
          </div>

          <div class="stroke">
            <input
              class="stroke-range"
              type="range"
              min="1"
              max="32"
              step="1"
              :value="toolWidth"
              :style="strokeRangeStyle"
              aria-label="大小"
              @input="toolWidth = Number(($event.target as HTMLInputElement).value)"
            />
            <div class="stroke-dot-wrap" :title="`大小 ${toolWidth}`">
              <span class="stroke-dot" :style="strokeDotStyle" />
            </div>
          </div>

          <div class="divider"></div>

          <button
            class="icon-btn"
            type="button"
            title="撤销"
            aria-label="撤销"
            :disabled="!canUndo"
            @click="undo"
          >
            <Undo2 :size="iconSize" />
          </button>
          <button
            class="icon-btn"
            type="button"
            title="重做"
            aria-label="重做"
            :disabled="!canRedo"
            @click="redo"
          >
            <Redo2 :size="iconSize" />
          </button>
        </div>
      </div>
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
  align-items: center;
  gap: 8px;
  padding: 10px;
  border-radius: 10px;
  background: rgba(20, 20, 20, 0.6);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  z-index: 3;
  pointer-events: auto;
}

.tools {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  margin-right: 6px;
}

.tools-row {
  display: flex;
  align-items: flex-start;
  gap: 6px;
}

.divider {
  width: 1px;
  height: 22px;
  background: rgba(255, 255, 255, 0.12);
  margin: 0 4px;
}

.icon-btn {
  width: 30px;
  height: 30px;
  padding: 0;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 245, 0.92);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  position: relative;
}

.action-btn {
  border: none;
}

.icon-btn.danger {
  border-color: rgba(239, 68, 68, 0.28);
  background: rgba(239, 68, 68, 0.08);
}

.icon-btn.danger:hover:enabled {
  background: rgba(239, 68, 68, 0.14);
}

.icon-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.icon-btn:hover:enabled {
  background: rgba(255, 255, 255, 0.1);
}

.icon-btn.active {
  border-color: #3b83f6db;
  color: #3b83f6db;
  background: rgba(59, 130, 246, 0.14);
}

.color-btn .color-dot {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  border-radius: 6px;
  border: 1px solid rgba(0, 0, 0, 0.35);
  z-index: -1;
}

.color-input {
  position: fixed;
  left: -9999px;
  top: 0;
  opacity: 0;
  pointer-events: none;
}

.palette {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(17, 17, 17, 0.92);
}

.swatch {
  width: 18px;
  height: 18px;
  border-radius: 5px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  padding: 0;
  cursor: pointer;
}

.swatch.active {
  outline: 2px solid rgba(255, 255, 255, 0.9);
  outline-offset: 2px;
}

.stroke {
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(255, 255, 255, 0.06);
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 2px;
}

.stroke-range {
  width: 92px;
  -webkit-appearance: none;
  appearance: none;
  height: 6px;
  border-radius: 999px;
  background: linear-gradient(
    90deg,
    rgba(59, 130, 246, 0.9) var(--p),
    rgba(255, 255, 255, 0.14) var(--p)
  );
  outline: none;
}

.stroke-range::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.92);
  border: 1px solid rgba(0, 0, 0, 0.35);
  box-shadow: 0 1px 6px rgba(0, 0, 0, 0.35);
  margin-top: -4px;
}

.stroke-range::-webkit-slider-runnable-track {
  height: 6px;
  border-radius: 999px;
  background: transparent;
}

.stroke-range:focus-visible::-webkit-slider-thumb {
  outline: 2px solid rgba(255, 255, 255, 0.85);
  outline-offset: 2px;
}

.stroke-dot-wrap {
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  border-radius: 8px;
}

.stroke-dot {
  border-radius: 999px;
  border: 1px solid rgba(0, 0, 0, 0.35);
}

.text-editor {
  position: absolute;
  left: 0;
  top: 0;
  width: 240px;
  min-height: 34px;
  max-width: 420px;
  padding: 6px 8px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  background: rgba(0, 0, 0, 0.35);
  color: rgba(255, 255, 255, 0.95);
  resize: both;
  outline: none;
  z-index: 5;
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
