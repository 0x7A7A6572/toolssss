<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { Infinity as InfinityIcon } from 'lucide-vue-next'

import OverlayRouter from './OverlayRouter.vue'
import OtherTools from '../OtherTools/OtherTools.vue'
import SizeBar from './components/SizeBar.vue'
import StickyNotes from '../StickyNotes/StickyNotes.vue'

const visible = ref(false)

function showOverlay(): void {
  visible.value = true
}

function closeOverlay(): void {
  visible.value = false
  window.electron.ipcRenderer.invoke('mouse-hook:overlay:close').catch(() => null)
}

let offShow = (): void => {}

const routePath = ref('')
const routeViewShow = ref(false)
function onSelect(e: { id: string; path: string }): void {
  if (!e.path) return
  routePath.value = e.path
  routeViewShow.value = true
}

onMounted(() => {
  // 注册全局快捷键后，直接显示（主进程已创建窗口并加载完毕）
  visible.value = true
  offShow = window.electron.ipcRenderer.on('mouse-hook:show', showOverlay)
})

onBeforeUnmount(() => {
  offShow()
})
</script>

<template>
  <Transition name="overlay-enter">
    <div v-show="visible" class="hook-overlay-root" @click.stop="closeOverlay">
      <div
        class="flex items-center tips absolute left-[50%] bottom-[10px] translate-x-[-50%] text-[#84848488]"
      >
        <InfinityIcon class="mr-[10px]" />
        <span>点击任意空位置或按Esc关闭</span>
      </div>

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

.hook-overlay-root {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: auto;
  cursor: default;
  z-index: 9;
  background: rgba(0, 0, 0, 0.904);
  /* 核心：背景模糊 */
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  padding: 40px;
  overflow: visible;
}

.overlay-concent {
  width: 100%;
  height: 100%;
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
