<template>
  <div class="size-bar" @click.stop>
    <div class="p-[4px]">
      <img class="w-[30px] h-[30px]" src="../../../assets/images/icon.png" mode="scaleToFill" />
    </div>
    <div
      v-for="tab in tabs"
      :key="tab.id"
      class="size-bar-item"
      :class="{ active: activeId === tab.id }"
      @click="onSelect(tab)"
    >
      <a-tooltip :title="tab.label" placement="right" :mouse-enter-delay="0.3">
        <div class="size-bar-item-inner">
          <component :is="tab.icon" :size="20" />
        </div>
      </a-tooltip>
    </div>
  </div>
</template>
<script lang="ts" setup>
import { ref } from 'vue'
import {
  MessageSquareMore,
  Eye,
  Languages,
  Scissors,
  PanelRightOpen,
  Clock,
  Info,
  Settings
} from 'lucide-vue-next'

interface TabItem {
  id: string
  label: string
  path: string
  icon: unknown
}

const emits = defineEmits<{
  select: [payload: { id: string; path: string }]
}>()

const activeId = ref<string>('')

const tabs: TabItem[] = [
  { id: 'AgentChat', label: '智能体', path: '/agents', icon: MessageSquareMore },
  // { id: 'StickyNotes', label: '便签', path: '/sticky-notes', icon: StickyNote },
  { id: 'EyeProtection', label: '护眼', path: '/eye-protection', icon: Eye },
  { id: 'Translator', label: '快捷翻译', path: '/translator', icon: Languages },
  { id: 'SnipPaste', label: '截屏贴图', path: '/snip-paste', icon: Scissors },
  { id: 'WindowStash', label: '窗口收纳', path: '/window-stash', icon: PanelRightOpen },
  { id: 'ScheduledTasks', label: '定时任务', path: '/scheduled-tasks', icon: Clock },
  { id: 'Landing', label: '关于', path: '/landing', icon: Info },
  { id: 'Settings', label: '设置', path: '/settings', icon: Settings }
]

function onSelect(tab: TabItem): void {
  activeId.value = tab.id
  emits('select', { id: tab.id, path: tab.path })
}
</script>
<style lang="scss" scoped>
/* ================================================================== */
/* 根容器 — 竖排图标栏                                                   */
/* ================================================================== */

.size-bar {
  padding-top: 20px;
  padding-bottom: 40px;
  display: flex;
  justify-content: center;
  align-items: center;
  flex-direction: column;
  width: 56px;
  background: linear-gradient(145deg, #3b3b3b 0%, #0a1225d0 80%, transparent);
}

/* ================================================================== */
/* 单项                                                                */
/* ================================================================== */

.size-bar-item {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 52px;
  width: 70px;

  cursor: pointer;

  /* 选中态伪元素：圆角矩形，右侧突出 */
  &::after {
    content: '';
    position: absolute;
    inset: 4px 0 4px 4px;
    /* 右侧突出 6px */
    right: -6px;
    background: linear-gradient(135deg, #5a82e2 0%, #3159b8 100%);
    border-radius: 10px;
    border-top-left-radius: 0;
    border-bottom-left-radius: 0;
    opacity: 0;
    transform: scaleX(0.9);
    transform-origin: left center;
    transition:
      opacity 0.25s cubic-bezier(0.4, 0, 0.2, 1),
      transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
    z-index: 0;
  }

  &.active::after {
    opacity: 1;
    transform: scaleX(1);
  }

  /* 悬停态微亮提示（非选中项） */
  &:not(.active):hover {
    width: 70px;

    &::after {
      opacity: 0.15;
      transform: scaleX(1);
    }
  }
}

/* ================================================================== */
/* 图标容器 — 置于伪元素之上                                              */
/* ================================================================== */

.size-bar-item-inner {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.55);
  transition: color 0.25s ease;

  .size-bar-item.active & {
    color: #fff;
  }

  .size-bar-item:not(.active):hover & {
    color: rgba(255, 255, 255, 0.8);
  }
}
</style>
