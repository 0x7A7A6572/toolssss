<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

const params = new URLSearchParams(window.location.search)
const color = ref((params.get('color') ?? '#3b83f6db').trim() || '#3b83f6db')
const widthPx = ref(Math.max(1, Math.min(16, Math.round(Number(params.get('width') ?? 3) || 3))))

function cssColor(input: string): string {
  const v = typeof input === 'string' ? input.trim() : ''
  if (/^#([0-9a-f]{6})$/i.test(v)) return v
  const m = /^#([0-9a-f]{8})$/i.exec(v)
  if (m) {
    const hex = m[1]
    const r = parseInt(hex.slice(0, 2), 16)
    const g = parseInt(hex.slice(2, 4), 16)
    const b = parseInt(hex.slice(4, 6), 16)
    const a = parseInt(hex.slice(6, 8), 16) / 255
    const af = Number.isFinite(a) ? Math.max(0, Math.min(1, a)) : 1
    return `rgba(${r}, ${g}, ${b}, ${af})`
  }
  if (/^#([0-9a-f]{3})$/i.test(v)) return v
  return v || '#3b83f6db'
}

const style = computed(() => {
  return {
    borderColor: cssColor(color.value),
    borderWidth: `${widthPx.value}px`
  }
})

const onSettings = (_: unknown, payload: unknown): void => {
  if (!payload || typeof payload !== 'object') return
  const p = payload as { color?: unknown; width?: unknown }
  const c = typeof p.color === 'string' ? p.color.trim() : ''
  if (c) color.value = c
  const w = typeof p.width === 'number' ? p.width : Number(p.width)
  if (Number.isFinite(w) && w > 0) widthPx.value = Math.max(1, Math.min(16, Math.round(w)))
}

onMounted(() => {
  window.electron.ipcRenderer.on('pin-border:settings', onSettings)
})

onBeforeUnmount(() => {
  window.electron.ipcRenderer.removeListener('pin-border:settings', onSettings)
})
</script>

<template>
  <div class="border" :style="style" />
</template>

<style scoped>
.border {
  position: fixed;
  inset: 0;
  border-style: solid;
  border-width: 3px;
  border-radius: 8px;
  box-sizing: border-box;
  pointer-events: none;
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
