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
  const p = payload as {
    reason?: unknown
    title?: unknown
    body?: unknown
    timeoutSec?: unknown
    closeOnEnd?: unknown
  }
  if (p.reason === 'alarm' || p.reason === 'break') reason.value = p.reason
  if (typeof p.title === 'string') title.value = p.title
  if (typeof p.body === 'string') body.value = p.body
  const closeOnEnd = typeof p.closeOnEnd === 'boolean' ? p.closeOnEnd : true
  const total = typeof p.timeoutSec === 'number' ? p.timeoutSec : undefined
  clearTimer()
  if (total && total > 0) {
    secondsLeft.value = Math.floor(total)
    timer = window.setInterval(() => {
      if (secondsLeft.value === null) return
      secondsLeft.value = Math.max(0, secondsLeft.value - 1)
      if (secondsLeft.value <= 0) {
        clearTimer()
        if (closeOnEnd) close()
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
    <div class="night">
      <div class="shooting_star"></div>
      <div class="shooting_star"></div>
      <div class="shooting_star"></div>
      <div class="shooting_star"></div>
      <div class="shooting_star"></div>
      <div class="shooting_star"></div>
      <div class="shooting_star"></div>
      <div class="shooting_star"></div>
      <div class="shooting_star"></div>
      <div class="shooting_star"></div>
      <div class="shooting_star"></div>
      <div class="shooting_star"></div>
      <div class="shooting_star"></div>
      <div class="shooting_star"></div>
      <div class="shooting_star"></div>
      <div class="shooting_star"></div>
      <div class="shooting_star"></div>
      <div class="shooting_star"></div>
      <div class="shooting_star"></div>
      <div class="shooting_star"></div>
    </div>

    <div class="card">
      <div class="title">
        <span>{{ title }}</span>
        <span v-if="secondsLeft !== null" class="countdown">{{ secondsLeft }}s</span>
      </div>
      <div class="body">{{ body }}</div>
      <div class="actions">
        <button v-if="showSnooze" class="btn" type="button" @click="snooze">稍后 5 分钟</button>
        <!-- <button class="btn" type="button" @click="close">关闭</button> -->
      </div>
      <div class="hint">按 Esc 关闭</div>
    </div>
  </div>
</template>

<style scoped lang="scss">
@use 'sass:math';
body {
  background: radial-gradient(ellipse at bottom, #1b2735 0%, #090a0f 100%);
  height: 100vh;
  overflow: hidden;
  display: flex;
  font-family: 'Anton', sans-serif;
  justify-content: center;
  align-items: center;
}

$shooting-time: 3000ms;

.night {
  position: absolute;
  width: 100%;
  height: 100%;
  transform: rotateZ(45deg);
  z-index: -1;
  // animation: sky 200000ms linear infinite;
}

.shooting_star {
  position: absolute;
  left: 50%;
  top: 50%;
  // width: 100px;
  height: 2px;
  background: linear-gradient(-45deg, rgba(95, 145, 255, 1), rgba(0, 0, 255, 0));
  border-radius: 999px;
  filter: drop-shadow(0 0 6px rgba(105, 155, 255, 1));
  animation:
    tail $shooting-time ease-in-out infinite,
    shooting $shooting-time ease-in-out infinite;

  &::before {
    content: '';
    position: absolute;
    top: calc(50% - 1px);
    right: 0;
    // width: 30px;
    height: 2px;
    background: linear-gradient(
      -45deg,
      rgba(0, 0, 255, 0),
      rgba(95, 145, 255, 1),
      rgba(0, 0, 255, 0)
    );
    transform: translateX(50%) rotateZ(45deg);
    border-radius: 100%;
    animation: shining $shooting-time ease-in-out infinite;
  }

  &::after {
    // CodePen Error
    // @extend .shooting_star::before;

    content: '';
    position: absolute;
    top: calc(50% - 1px);
    right: 0;
    // width: 30px;
    height: 2px;
    background: linear-gradient(
      -45deg,
      rgba(0, 0, 255, 0),
      rgba(95, 145, 255, 1),
      rgba(0, 0, 255, 0)
    );
    transform: translateX(50%) rotateZ(45deg);
    border-radius: 100%;
    animation: shining $shooting-time ease-in-out infinite;
    transform: translateX(50%) rotateZ(-45deg);
  }

  @for $i from 1 through 20 {
    &:nth-child(#{$i}) {
      $delay: math.random(9999) + 0ms;
      top: calc(50% - #{math.random(400) - 200px});
      left: calc(50% - #{math.random(300) + 0px});
      animation-delay: $delay;
      // opacity: random(50) / 100 + 0.5;

      &::before,
      &::after {
        animation-delay: $delay;
      }
    }
  }
}

@keyframes tail {
  0% {
    width: 0;
  }

  30% {
    width: 100px;
  }

  100% {
    width: 0;
  }
}

@keyframes shining {
  0% {
    width: 0;
  }

  50% {
    width: 30px;
  }

  100% {
    width: 0;
  }
}

@keyframes shooting {
  0% {
    transform: translateX(0);
  }

  100% {
    transform: translateX(300px);
  }
}

@keyframes sky {
  0% {
    transform: rotate(45deg);
  }

  100% {
    transform: rotate(45 + 360deg);
  }
}

.wrap {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  // background:
  //   radial-gradient(circle at 30% 20%, rgba(227, 246, 59, 0.25), transparent 55%),
  //   radial-gradient(circle at 70% 80%, rgba(249, 115, 22, 0.22), transparent 55%),
  //   rgba(13, 34, 26, 0.373);
}

.card {
  width: min(720px, calc(100vw - 80px));
  /* border: 1px solid rgba(255, 255, 255, 0.12); */
  border-radius: 16px;
  padding: 28px;
  /* background: rgba(17, 24, 39, 0.75); */
  // backdrop-filter: blur(20px);
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.title {
  font-size: 34px;
  font-weight: 800;
  letter-spacing: 0.02em;
  display: flex;
  align-items: center;
  gap: 12px;
}

.body {
  font-size: 18px;
  color: rgba(235, 235, 245, 0.86);
}

.countdown {
  font-size: 16px;
  color: rgba(255, 255, 255, 0.7);
  /* border: 1px solid rgba(255, 255, 255, 0.25); */
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
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  padding: 8px 10px;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 245, 0.92);
  font-size: 14px;
  font-weight: 700;
}

.btn:hover {
  background: rgba(255, 255, 255, 0.1);
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
