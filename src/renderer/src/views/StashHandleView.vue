<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { AppSettings } from '@shared/settings'
import { GripHorizontal, GripVertical } from 'lucide-vue-next'

const params = new URLSearchParams(window.location.search)
const hwnd = params.get('hwnd') ?? ''
const edge = (params.get('edge') ?? 'right') as 'left' | 'right' | 'top' | 'bottom'
const initialTitle = params.get('title') ?? ''
const initialColor = params.get('color') ?? ''

const vertical = computed(() => edge === 'left' || edge === 'right')

const settings = ref<AppSettings | null>(null)
const handleTitle = ref(initialTitle)
const handleColor = ref(initialColor)

const showHandleTitle = computed(() => settings.value?.windowStash?.showHandleTitle !== false)
const showHandleDrag = computed(() => settings.value?.windowStash?.showHandleDrag !== false)

function truncateByCodePoints(value: string, maxChars: number): string {
  const s = typeof value === 'string' ? value : ''
  const max = Number.isFinite(maxChars) ? Math.max(0, Math.floor(maxChars)) : 0
  if (!s || max <= 0) return ''
  const chars = Array.from(s)
  if (chars.length <= max) return s
  return chars.slice(0, max).join('')
}

function normalizeHexColor(s: string): string | null {
  const v = typeof s === 'string' ? s.trim() : ''
  if (!v) return null
  return /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v) ? v : null
}

function clampNumber(value: number, min: number, max: number): number {
  if (Number.isNaN(value) || !Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

function hexToRgba(hex: string): { r: number; g: number; b: number; a: number } | null {
  const s = hex.trim()
  const m = s.match(/^#?([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i)
  if (!m) return null
  let v = m[1].toLowerCase()
  let a = 1
  if (v.length === 3) {
    v = v
      .split('')
      .map((c) => c + c)
      .join('')
  } else if (v.length === 8) {
    a = parseInt(v.slice(6, 8), 16) / 255
    v = v.slice(0, 6)
  }
  const num = parseInt(v, 16)
  return { r: (num >> 16) & 0xff, g: (num >> 8) & 0xff, b: num & 0xff, a }
}

const displayTitle = computed(() => {
  const t = handleTitle.value.trim()
  if (!t) return '收纳'
  return truncateByCodePoints(t, 10)
})

const rawBg = computed(() => {
  const byHandle = normalizeHexColor(handleColor.value)
  if (byHandle) return byHandle
  const cfg = settings.value?.windowStash
  const bySetting = cfg && cfg.handleColors ? normalizeHexColor(cfg.handleColors[edge]) : null
  if (bySetting) return bySetting
  if (edge === 'left') return '#22c55e88'
  if (edge === 'top') return '#f59e0b88'
  if (edge === 'bottom') return '#ef444488'
  return '#3b82f688'
})

const bgStyle = computed(() => {
  const rgba = hexToRgba(rawBg.value) ?? { r: 59, g: 130, b: 246, a: 0.55 }
  const cfg = settings.value?.windowStash
  const opacity = clampNumber(Number(cfg?.handleOpacity ?? 1), 0, 1)
  const a = clampNumber(rgba.a * opacity, 0, 1)

  const degMap = {
    left: '90deg',
    top: '180deg',
    bottom: '0deg',
    right: '270deg'
  }

  return {
    // backgroundColor: `rgba(${rgba.r}, ${rgba.g}, ${rgba.b}, ${a})`,
    backgroundImage: `linear-gradient(${degMap[edge]}, rgba(${rgba.r}, ${rgba.g}, ${rgba.b}, ${a}), transparent)`
  }
})

const dragging = ref(false)
let dragPointerId: number | null = null
let dragCaptureEl: HTMLElement | null = null
let lastClientX = 0
let lastClientY = 0
let pendingDx = 0
let pendingDy = 0
let rafId: number | null = null

function flushNudge(): void {
  rafId = null
  if (!hwnd.trim()) return
  if (!pendingDx && !pendingDy) return
  const verticalAxis = vertical.value
  window.electron.ipcRenderer.send('window-stash:handle:nudge', {
    hwnd,
    dx: verticalAxis ? 0 : pendingDx,
    dy: verticalAxis ? pendingDy : 0
  })
  pendingDx = 0
  pendingDy = 0
}

function onDragMove(ev: PointerEvent): void {
  if (!dragging.value) return
  if (dragPointerId !== null && ev.pointerId !== dragPointerId) return
  const dx = ev.clientX - lastClientX
  const dy = ev.clientY - lastClientY
  lastClientX = ev.clientX
  lastClientY = ev.clientY
  pendingDx += dx
  pendingDy += dy
  if (rafId === null) rafId = window.requestAnimationFrame(flushNudge)
}

function stopDragging(ev?: PointerEvent): void {
  if (!dragging.value) return
  if (ev && dragPointerId !== null && ev.pointerId !== dragPointerId) return
  dragging.value = false
  if (dragCaptureEl && dragPointerId !== null) {
    try {
      dragCaptureEl.releasePointerCapture(dragPointerId)
    } catch {
      void 0
    }
  }
  dragCaptureEl = null
  dragPointerId = null
  window.removeEventListener('pointermove', onDragMove, true)
  window.removeEventListener('pointerup', stopDragging, true)
  window.removeEventListener('pointercancel', stopDragging, true)
  if (rafId !== null) {
    window.cancelAnimationFrame(rafId)
    rafId = null
  }
  flushNudge()
}

const onSettingsChanged = (_: unknown, payload: unknown): void => {
  settings.value = payload as AppSettings
}

const onHandleUpdate = (_: unknown, payload: unknown): void => {
  if (!payload || typeof payload !== 'object') return
  const p = payload as { title?: unknown; color?: unknown }
  const t = typeof p.title === 'string' ? p.title : ''
  const c = typeof p.color === 'string' ? p.color : ''
  if (t.trim()) handleTitle.value = t
  else handleTitle.value = initialTitle
  handleColor.value = c
}

onMounted(() => {
  window.electron.ipcRenderer
    .invoke('settings:get')
    .then((s) => {
      settings.value = s as AppSettings
    })
    .catch(() => null)
  window.electron.ipcRenderer.on('settings:changed', onSettingsChanged)
  window.electron.ipcRenderer.on('window-stash:handle:update', onHandleUpdate)
})

onBeforeUnmount(() => {
  window.electron.ipcRenderer.removeListener('settings:changed', onSettingsChanged)
  window.electron.ipcRenderer.removeListener('window-stash:handle:update', onHandleUpdate)
  stopDragging()
})

function startPeek(): void {
  if (!hwnd.trim()) return
  window.electron.ipcRenderer.send('window-stash:hover', { hwnd, on: true })
}

function startDragging(ev: PointerEvent): void {
  if (!hwnd.trim()) return
  if (dragPointerId !== null) return
  dragging.value = true
  dragPointerId = ev.pointerId
  dragCaptureEl = ev.currentTarget instanceof HTMLElement ? ev.currentTarget : null
  if (dragCaptureEl) {
    try {
      dragCaptureEl.setPointerCapture(ev.pointerId)
    } catch {
      void 0
    }
  }
  lastClientX = ev.clientX
  lastClientY = ev.clientY
  pendingDx = 0
  pendingDy = 0
  window.electron.ipcRenderer.send('window-stash:handle:nudge', { hwnd, dx: 0, dy: 0, reset: true })
  window.addEventListener('pointermove', onDragMove, true)
  window.addEventListener('pointerup', stopDragging, true)
  window.addEventListener('pointercancel', stopDragging, true)
}

function restore(): void {
  // TODO 有bug
  // if (!hwnd.trim()) return
  // window.electron.ipcRenderer.send('window-stash:toggle', { hwnd, activate: true })
}
</script>

<template>
  <div
    class="handle"
    :class="{ vertical, edge }"
    :style="bgStyle"
    @mouseenter="startPeek"
    @dblclick.stop.prevent="restore"
  >
    <div class="content" :class="{ vertical }">
      <button
        v-if="showHandleDrag"
        class="drag"
        type="button"
        @pointerdown.stop.prevent="startDragging"
      >
        <component :is="vertical ? GripVertical : GripHorizontal" :size="14" />
      </button>
      <div v-if="showHandleTitle" class="text" :class="{ vertical }">
        {{ displayTitle }}
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.handle {
  box-sizing: border-box;
  width: fit-content;
  height: 100%;
  padding: 6px;
  border-radius: 2px;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  user-select: none;
  cursor: pointer;
  overflow: hidden;
  /* 隐藏滑动条 */
  scrollbar-width: none;

  &::-webkit-scrollbar {
    display: none;
  }
}

.handle.vertical {
  flex-direction: column;
  height: fit-content;
  width: 100%;
}

.content {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.content.vertical {
  flex-direction: column;
  gap: 4px;
  justify-content: flex-start;
}

.drag {
  width: 18px;
  height: 18px;
  padding: 0;
  border: none;
  background: transparent;
  color: /* rgba(0, 0, 0, 0.8) */ white;
  border-radius: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: grab;
  flex: 0 0 auto;
}

.drag:active {
  cursor: grabbing;
}

.text {
  font-size: 12px;
  line-height: 16px;
  color: rgba(255, 255, 255, 0.719);
  white-space: nowrap;
  max-width: 100%;
  text-overflow: ellipsis;
  overflow: hidden;
  max-width: 4rem;
}

.text.vertical {
  writing-mode: vertical-rl;
  text-orientation: mixed;
  max-height: 4rem;
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
  overflow: hidden;
}
</style>
