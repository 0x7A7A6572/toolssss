<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { /*  X,  */ Infinity as InfinityIcon } from 'lucide-vue-next'

import OverlayRouter from './OverlayRouter.vue'
import OtherTools from '../OtherTools/OtherTools.vue'
import SizeBar from './components/SizeBar.vue'
import StickyNotes from '../StickyNotes/StickyNotes.vue'

type HookEvent = { action: string; deltaY: number; startX: number; startY: number }

const deltaY = ref(0)
const triggerX = ref(0)
const triggerY = ref(0)
const phase = ref<'idle' | 'entering' | 'active' | 'ended'>('idle')
const visible = ref(false)

function onHookEvent(_event: unknown, payload: unknown): void {
  const ev = payload as HookEvent | null
  if (!ev) return

  switch (ev.action) {
    case 'start':
      visible.value = true
      // 中键松开后才触发，直接进入可点击状态
      phase.value = 'ended'
      deltaY.value = ev.deltaY
      triggerX.value = ev.startX
      triggerY.value = ev.startY

      break
    case 'move':
      deltaY.value = ev.deltaY
      break
    case 'end':
      phase.value = 'ended'
      deltaY.value = ev.deltaY
      break
  }
}

function closeOverlay(): void {
  if (phase.value !== 'ended') return
  visible.value = false
  phase.value = 'idle'
  window.electron.ipcRenderer.invoke('mouse-hook:overlay:close').catch(() => null)
}

let offEvent = (): void => {}

const routePath = ref('')
const routeViewShow = ref(false)
function onSelect(e: { id: string; path: string }): void {
  if (!e.path) return
  routePath.value = e.path
  routeViewShow.value = true
}

onMounted(() => {
  offEvent = window.electron.ipcRenderer.on('mouse-hook:event', onHookEvent)
})

onBeforeUnmount(() => {
  offEvent()
})
</script>

<template>
  <Transition name="overlay-enter">
    <div v-show="visible" class="hook-overlay-root" :class="phase" @click.stop="closeOverlay">
      <!-- <X :size="30" /> -->
      <div
        class="flex items-center tips absolute left-[50%] bottom-[10px] translate-x-[-50%] text-[#84848488]"
      >
        <InfinityIcon class="mr-[10px]" />
        <span>点击任意空位置或按Esc关闭</span>
      </div>
      <!-- <div class="hook-indicator">
        <div class="hook-ring">
          <div class="hook-chevron"></div>
        </div>
        <span class="hook-delta">{{ Math.round(deltaY) }}px</span>
      </div> -->

      <!-- 主功能显示 -->
      <div class="overlay-concent">
        <a-row class="h-full" :gutter="20">
          <a-col :span="1">
            <div class="h-full">
              <SizeBar @select="onSelect" @click.stop />
            </div>
          </a-col>

          <a-col :span="14" gutter="20" class="box-zing w-full h-full">
            <div class="h-[80%] overflow-y-auto no-scrollbar" @click.stop>
              <OtherTools />
            </div>
            <div class="bg-[#bbff001f] h-[20%]" @click.stop>333</div>
          </a-col>
          <a-col :span="5">
            <div class="bg-[#ff00001f] h-full" @click.stop></div>
          </a-col>
          <a-col :span="4">
            <StickyNotes @click.stop />
          </a-col>
        </a-row>
      </div>

      <OverlayRouter v-model:open="routeViewShow" :router-path="routePath" @click.stop />
    </div>
  </Transition>
</template>

<style scoped>
/* ================================================================== */
/* 根容器                                                        */
/* ================================================================== */

.concent-box {
}

.hook-overlay-root {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  z-index: 9;
  background: rgba(0, 0, 0, 0.904);
  /* 核心：背景模糊 */
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  padding: 40px;
  overflow: visible;
}

.hook-overlay-root.ended {
  pointer-events: auto;
  cursor: default;
}

.overlay-concent {
  width: 100%;
  height: 100%;
  /* width: calc(100% - 80px);
  height: calc(100% - 80px); */
}

/* ================================================================== */
/* Vue <Transition> 入场动画                                          */
/* ================================================================== */

.overlay-enter-enter-active {
  transition: opacity 0.35s ease;
}

.overlay-enter-leave-active {
  transition: opacity 0.25s ease;
}

.overlay-enter-enter-from,
.overlay-enter-leave-to {
  opacity: 0;
}

/* ================================================================== */
/* 指示器                                                             */
/* ================================================================== */

.hook-indicator {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}

/* .entering 阶段的额外动画 —— 环从 0.6 → 1 放大 */
.hook-ring {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  border: 2px solid rgba(160, 197, 243, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  transition:
    transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1),
    border-color 0.35s ease;
}

.hook-overlay-root.entering .hook-ring {
  transform: scale(0.6);
  border-color: rgba(160, 197, 243, 0.15);
}

.hook-overlay-root.active .hook-ring {
  transform: scale(1);
  border-color: rgba(160, 197, 243, 0.4);
}

/* ================================================================== */
/* 箭头                                                               */
/* ================================================================== */

.hook-chevron {
  width: 16px;
  height: 16px;
  border-right: 3px solid rgba(160, 197, 243, 0.9);
  border-bottom: 3px solid rgba(160, 197, 243, 0.9);
  transform: rotate(45deg) translate(-2px, 2px);
}

/* ================================================================== */
/* 距离文字                                                           */
/* ================================================================== */

.hook-delta {
  font-size: 13px;
  font-weight: 700;
  color: rgba(235, 235, 245, 0.82);
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);
  font-feature-settings: 'tnum';
}

/* ended 阶段淡出指示器 */
.hook-overlay-root.ended .hook-indicator {
  opacity: 0;
  transition: opacity 0.25s ease;
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
