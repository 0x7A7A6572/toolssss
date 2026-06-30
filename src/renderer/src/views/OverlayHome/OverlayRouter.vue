<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import type { UpdateFrequency } from '@shared/custom-modules'
import { X } from 'lucide-vue-next'
import { useRouter } from 'vue-router'
export interface ModuleDialogData {
  name: string
  type: 'text' | 'ranking' | 'link' | 'chart'
  prompt: string
  webSearch: boolean
  minHeight: number
  maxHeight: number | 'auto'
  enableMarkdown: boolean
  updateFrequency: UpdateFrequency
}

const props = withDefaults(
  defineProps<{
    open: boolean
    routerPath: string
  }>(),
  {}
)

const emit = defineEmits<{
  'update:open': [value: boolean]
  saved: [data: ModuleDialogData]
}>()

const router = useRouter()

watch(
  () => props.open,
  (v) => {
    if (v) {
      router.push(props.routerPath)
    }
  }
)

const draftError = ref<string | null>(null)

const currentRoute = computed(() => {
  return router.currentRoute.value
})

function close(): void {
  emit('update:open', false)
}

/** 点击遮罩层关闭 */
function onOverlayClick(e: MouseEvent): void {
  if (e.target === e.currentTarget) {
    close()
  }
}

/** Escape 键关闭 */
function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    close()
  }
}

onMounted(() => {
  document.addEventListener('keydown', onKeydown)
})

onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div v-if="open" class="module-dialog-overlay" @click="onOverlayClick">
        <div class="modal-header mb-[20px] pt-[10vh]">
          <div class="flex items-start gap-[10px]">
            <!-- <div class="bg-[#a0c5f3] w-[4px] h-[15px]"></div> -->
            <div class="modal-title">
              <span class="title-text"> {{ currentRoute?.meta?.title }}</span>
              <div class="sub-title">
                {{ currentRoute.name }}
              </div>
            </div>
          </div>

          <div class="modal-header-actions">
            <div class="btn-style" @click="close">
              <X :size="35" />
            </div>
          </div>
        </div>
        <div class="module-dialog-content overflow-y-auto no-scrollbar-none">
          <div v-if="draftError" class="error">{{ draftError }}</div>
          <router-view v-slot="{ Component }">
            <!-- <keep-alive> -->
            <component :is="Component" />
            <!-- </keep-alive> -->
          </router-view>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style lang="scss" scoped>
.picker-title {
  font-size: 14px;
  font-weight: 700;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 80vw;
  position: sticky;
  top: 0;
  /* 半透明背景是 backdrop-filter 毛玻璃效果的关键 —— 它提供了可见的"玻璃"表面 */
  z-index: 1;
  border-bottom: 1px solid rgba(235, 235, 245, 0.12);
  padding-bottom: 10px;
  padding: 0 15vw;
  padding-top: 10vh;
}

.module-dialog-overlay {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  backdrop-filter: blur(20px);
  background: rgba(0, 0, 0, 0.45);
}

.modal-title {
  font-size: 30px;
  font-weight: 700;
  line-height: 30px;

  .title-text {
    font-size: 30px;
    font-weight: 700;
    line-height: 30px;
    position: relative;

    /** 底部渐变横线 */
    &::after {
      content: '';
      position: absolute;
      left: 0;
      bottom: -4px;
      width: 100%;
      height: 4px;
      background: linear-gradient(to right, #a0c5f3 80%, transparent 100%);
    }
  }

  .sub-title {
    font-size: 26px;
    line-height: 20px;
    font-weight: 700;
    /** 大写 */
    text-transform: uppercase;
    color: rgba(235, 235, 245, 0.123);
  }
}

.modal-header-actions {
  display: flex;
  gap: 8px;
  font-size: 14px;
}

.module-dialog-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin-top: 10px;
  height: 500px;
  display: flex;
  flex-direction: column;
  height: 500px;
  overflow-y: auto;

  /* Chrome / Safari / Edge */
  &::-webkit-scrollbar {
    display: none;
  }

  /* Firefox */
  scrollbar-width: none;
  /* IE / 旧 Edge */
  -ms-overflow-style: none;
}

.module-dialog-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.module-dialog-label {
  font-size: 13px;
  color: rgba(235, 235, 245, 0.72);
  font-weight: 700;
}

.module-dialog-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.module-dialog-textarea {
  min-height: 140px;
  resize: vertical;
  line-height: 18px;
}

.module-dialog-hint {
  font-size: 12px;
  color: rgba(235, 235, 245, 0.45);
  line-height: 1.4;
  margin-top: 2px;
}

.max-height-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.max-height-unit {
  font-size: 12px;
  color: rgba(235, 235, 245, 0.45);
}

.max-height-label {
  font-size: 12px;
  color: rgba(235, 235, 245, 0.55);
}

.module-dialog-advanced {
  display: flex;
  flex-direction: column;
}

.advanced-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 6px 0 0 0;
}

.ai-enhance-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: rgba(99, 102, 241, 0.85);
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.15s ease;
  z-index: 1;
}

.ai-enhance-btn:hover:not(:disabled) {
  background: rgba(99, 102, 241, 0.2);
  border-color: rgba(99, 102, 241, 0.6);
  color: rgba(99, 102, 241, 1);
}

.ai-enhance-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.ai-enhance-spinner {
  width: 12px;
  height: 12px;
  border: 2px solid rgba(99, 102, 241, 0.3);
  border-top-color: rgba(99, 102, 241, 0.85);
  border-radius: 50%;
  animation: ai-enhance-spin 0.6s linear infinite;
}

.error {
  font-size: 13px;
  color: #ff8a8a;
}

@keyframes ai-enhance-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>

<style lang="scss" scoped>
/* 进入/离开过渡动画 */
.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity 0.2s ease;
}

.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}

.module-dialog-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(7, 7, 7, 0.596);
}

.module-dialog-content {
  padding: 0 15vh 15vh 15vh;
  box-sizing: border-box;
  width: 70vw;
  height: 100vh;
}
</style>
