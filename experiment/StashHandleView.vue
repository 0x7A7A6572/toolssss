<script setup lang="ts">
import { computed, ref } from 'vue'

const params = new URLSearchParams(window.location.search)
const hwnd = params.get('hwnd') ?? ''
const edge = params.get('edge') ?? 'right'

const bg = computed(() => {
  if (edge === 'left') return '#22c55e'
  if (edge === 'top') return '#f59e0b'
  if (edge === 'bottom') return '#ef4444'
  return '#3b82f6'
})

const restoring = ref(false)

function restore(): void {
  if (restoring.value) return
  if (!hwnd.trim()) return
  restoring.value = true
  window.electron.ipcRenderer.send('window-stash:toggle', { hwnd })
  window.setTimeout(() => {
    restoring.value = false
  }, 200)
}
</script>

<template>
  <div class="btn" :style="{ background: bg }" :disabled="restoring" @click="restore" />
</template>

<style scoped>
.btn {
  width: 25px;
  height: 25px;
  border: 0;
  padding: 0;
  margin: 0;
  outline: none;
  cursor: pointer;
  overflow: hidden;
}
</style>
