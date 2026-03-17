<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { AppSettings } from '@shared/settings'

const params = new URLSearchParams(window.location.search)
const hwnd = params.get('hwnd') ?? ''
const edge = (params.get('edge') ?? 'right') as 'left' | 'right' | 'top' | 'bottom'
const title = params.get('title') ?? ''
const queryColor = params.get('color') ?? ''

const vertical = computed(() => edge === 'left' || edge === 'right')

const settings = ref<AppSettings | null>(null)

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
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v) ? v : null
}

const displayTitle = computed(() => {
  const t = title.trim()
  if (!t) return '收纳'
  return truncateByCodePoints(t, 10)
})

const bg = computed(() => {
  const cfg = settings.value?.windowStash
  const bySetting = cfg && cfg.handleColors ? normalizeHexColor(cfg.handleColors[edge]) : null
  if (bySetting) return bySetting
  const byQuery = normalizeHexColor(queryColor)
  if (byQuery) return byQuery
  if (edge === 'left') return '#22c55e'
  if (edge === 'top') return '#f59e0b'
  if (edge === 'bottom') return '#ef4444'
  return '#3b82f6'
})

const restoring = ref(false)

const onSettingsChanged = (_: unknown, payload: unknown): void => {
  settings.value = payload as AppSettings
}

onMounted(() => {
  window.electron.ipcRenderer
    .invoke('settings:get')
    .then((s) => {
      settings.value = s as AppSettings
    })
    .catch(() => null)
  window.electron.ipcRenderer.on('settings:changed', onSettingsChanged)
})

onBeforeUnmount(() => {
  window.electron.ipcRenderer.removeListener('settings:changed', onSettingsChanged)
})

function startPeek(): void {
  if (!hwnd.trim()) return
  window.electron.ipcRenderer.send('window-stash:hover', { hwnd, on: true })
}

function restore(): void {
  if (restoring.value) return
  if (!hwnd.trim()) return
  restoring.value = true
  window.electron.ipcRenderer.send('window-stash:toggle', { hwnd, activate: true })
  window.setTimeout(() => {
    restoring.value = false
  }, 250)
}
</script>

<template>
  <div
    class="handle"
    :class="{ vertical }"
    :style="{ background: bg }"
    @mouseenter="startPeek"
    @mousedown.prevent="restore"
  >
    <div class="text" :class="{ vertical }">
      {{ displayTitle }}
    </div>
  </div>
</template>

<style scoped>
.handle {
  width: 100%;
  height: 100%;
  border-radius: 2px;
  display: flex;
  align-items: center;
  justify-content: center;
  user-select: none;
  cursor: pointer;
  overflow: hidden;
}

.text {
  font-size: 12px;
  font-weight: 900;
  color: rgba(0, 0, 0, 0.86);
  padding: 2px 6px;
  white-space: nowrap;
  max-width: 100%;
  text-overflow: ellipsis;
  overflow: hidden;
}

.text.vertical {
  writing-mode: vertical-rl;
  text-orientation: mixed;
  padding: 6px 2px;
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
