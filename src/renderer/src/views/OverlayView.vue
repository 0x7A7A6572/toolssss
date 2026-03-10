<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { DEFAULT_SETTINGS, type AppSettings } from '@shared/settings'

const opacity = ref(DEFAULT_SETTINGS.eye.opacity)
const color = ref(DEFAULT_SETTINGS.eye.color)

const onSettings = (_: unknown, eye: unknown): void => {
  const candidate = eye as Partial<AppSettings['eye']> | null
  if (!candidate) return
  if (typeof candidate.opacity === 'number') opacity.value = candidate.opacity
  if (typeof candidate.color === 'string') color.value = candidate.color
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const s = hex.trim()
  const m = s.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (!m) return null
  let v = m[1].toLowerCase()
  if (v.length === 3)
    v = v
      .split('')
      .map((c) => c + c)
      .join('')
  const num = parseInt(v, 16)
  return { r: (num >> 16) & 0xff, g: (num >> 8) & 0xff, b: num & 0xff }
}

const style = computed(() => {
  const a = Math.max(0, Math.min(0.7, opacity.value))
  const rgb = hexToRgb(color.value) ?? { r: 255, g: 160, b: 70 }
  return { backgroundColor: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${a})` }
})

onMounted(() => {
  window.electron.ipcRenderer.on('overlay:settings', onSettings)
  window.electron.ipcRenderer
    .invoke('settings:get')
    .then((s) => {
      const ss = s as AppSettings
      opacity.value = ss.eye.opacity
      color.value = ss.eye.color
    })
    .catch(() => null)
})

onBeforeUnmount(() => {
  window.electron.ipcRenderer.removeListener('overlay:settings', onSettings)
})
</script>

<template>
  <div class="overlay" :style="style" />
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
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
