<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { DEFAULT_SETTINGS, type AppSettings } from '../../../shared/settings'

const opacity = ref(DEFAULT_SETTINGS.eye.opacity)

const onSettings = (_: unknown, eye: unknown): void => {
  const candidate = eye as Partial<AppSettings['eye']> | null
  if (!candidate) return
  if (typeof candidate.opacity === 'number') opacity.value = candidate.opacity
}

const style = computed(() => {
  const a = Math.max(0, Math.min(0.7, opacity.value))
  return {
    backgroundColor: `rgba(255, 160, 70, ${a})`
  }
})

onMounted(() => {
  window.electron.ipcRenderer.on('overlay:settings', onSettings)
  window.electron.ipcRenderer
    .invoke('settings:get')
    .then((s) => {
      const ss = s as AppSettings
      opacity.value = ss.eye.opacity
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
