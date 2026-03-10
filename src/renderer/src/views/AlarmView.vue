<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import type { AlarmReason } from '@shared/settings'

const reason = ref<AlarmReason>('alarm')
const title = ref('提醒')
const body = ref('')
const secondsLeft = ref<number | null>(null)
let timer: number | null = null

const showSnooze = computed(() => reason.value === 'alarm')

function clearTimer(): void {
  if (timer !== null) {
    window.clearInterval(timer)
    timer = null
  }
}

const onShow = (_: unknown, payload: unknown): void => {
  if (!payload || typeof payload !== 'object') return
  const p = payload as { reason?: unknown; title?: unknown; body?: unknown; timeoutSec?: unknown }
  if (p.reason === 'alarm' || p.reason === 'break') reason.value = p.reason
  if (typeof p.title === 'string') title.value = p.title
  if (typeof p.body === 'string') body.value = p.body
  const total = typeof p.timeoutSec === 'number' ? p.timeoutSec : undefined
  clearTimer()
  if (total && total > 0) {
    secondsLeft.value = Math.floor(total)
    timer = window.setInterval(() => {
      if (secondsLeft.value === null) return
      secondsLeft.value = Math.max(0, secondsLeft.value - 1)
      if (secondsLeft.value <= 0) {
        clearTimer()
        close()
      }
    }, 1000)
  } else {
    secondsLeft.value = null
  }
}

const onKeyDown = (e: KeyboardEvent): void => {
  if (e.key === 'Escape') close()
}

function close(): void {
  window.electron.ipcRenderer.send('alarm:action', { action: 'close' })
}

function snooze(): void {
  window.electron.ipcRenderer.send('alarm:action', { action: 'snooze', minutes: 5 })
}

window.electron.ipcRenderer.on('alarm:show', onShow)
window.addEventListener('keydown', onKeyDown)

onBeforeUnmount(() => {
  window.electron.ipcRenderer.removeListener('alarm:show', onShow)
  window.removeEventListener('keydown', onKeyDown)
  clearTimer()
})
</script>

<template>
  <div class="wrap">
    <div class="card">
      <div class="title">
        <span>{{ title }}</span>
        <span v-if="secondsLeft !== null" class="countdown">{{ secondsLeft }}s</span>
      </div>
      <div class="body">{{ body }}</div>
      <div class="actions">
        <button v-if="showSnooze" class="btn" type="button" @click="snooze">稍后 5 分钟</button>
        <button class="btn primary" type="button" @click="close">关闭</button>
      </div>
      <div class="hint">按 Esc 也可以关闭</div>
    </div>
  </div>
</template>

<style scoped>
.wrap {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  background:
    radial-gradient(circle at 30% 20%, rgba(59, 130, 246, 0.25), transparent 55%),
    radial-gradient(circle at 70% 80%, rgba(249, 115, 22, 0.22), transparent 55%),
    rgba(0, 0, 0, 0.92);
}

.card {
  width: min(720px, calc(100vw - 80px));
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 16px;
  padding: 28px;
  background: rgba(17, 24, 39, 0.75);
  backdrop-filter: blur(20px);
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.title {
  font-size: 34px;
  font-weight: 800;
  letter-spacing: 0.02em;
  display: flex;
  align-items: baseline;
  gap: 12px;
}

.body {
  font-size: 18px;
  color: rgba(235, 235, 245, 0.86);
}

.countdown {
  font-size: 16px;
  color: rgba(255, 255, 255, 0.7);
  border: 1px solid rgba(255, 255, 255, 0.25);
  padding: 2px 8px;
  border-radius: 999px;
}

.actions {
  display: flex;
  gap: 12px;
  margin-top: 10px;
}

.btn {
  cursor: pointer;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  padding: 12px 16px;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 245, 0.92);
  font-size: 14px;
  font-weight: 700;
}

.btn:hover {
  background: rgba(255, 255, 255, 0.1);
}

.primary {
  border-color: rgba(59, 130, 246, 0.55);
  background: rgba(59, 130, 246, 0.35);
}

.primary:hover {
  background: rgba(59, 130, 246, 0.45);
}

.hint {
  font-size: 12px;
  color: rgba(235, 235, 245, 0.48);
}
</style>

<style>
html,
body,
#app {
  width: 100%;
  height: 100%;
  margin: 0;
}
</style>
