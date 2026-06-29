<template>
  <div @click.stop>
    <div v-show="visible" ref="menuRef" class="overlay-menu-wrapper" :style="menuStyle">
      <div class="p-[4px]">
        <img class="w-[30px] h-[30px]" src="../../assets/images/icon.png" mode="scaleToFill" />
      </div>
      <a-menu mode="vertical" :overflowed-indicator="null" @select="onSelect" @click="handleClick">
        <MenuItemRenderer v-for="tab in tabs" :key="tab.id" :item="tab" />
      </a-menu>
    </div>
    <div v-if="visible" class="menu-overlay" @click.stop="close"></div>
  </div>
</template>
<script lang="ts" setup>
import { nextTick, onMounted, reactive, ref, watch } from 'vue'
import {
  MessageSquareMore,
  StickyNote,
  Eye,
  Languages,
  Scissors,
  PanelRightOpen,
  Clock,
  Info
} from 'lucide-vue-next'
import MenuItemRenderer from './MenuItemRenderer.vue'

defineOptions({ name: 'OverlayMenu' })

interface TabItem {
  id: string
  label: string
  showTitle?: boolean
  path: string
  icon: unknown
  children?: TabItem[]
}

const props = defineProps<{
  triggerX: number
  triggerY: number
  show: boolean
}>()

const emits = defineEmits(['update:show', 'select'])

const visible = ref(props.show)

watch(
  () => props.show,
  (newVal) => {
    visible.value = newVal
  }
)

function close(): void {
  emits('update:show', false)
}

const tabs: TabItem[] = [
  {
    id: 'AgentChat',
    label: '智能体',
    showTitle: false,
    path: '/agents',
    icon: MessageSquareMore
    // children: [
    //   { id: 'AgentChat-Dialog阿萨, label: '对话', path: '/agents/dialog', icon: MessageSquareMore },
    //   {
    //     id: 'AgentChat-Knowle阿萨ge',
    //     label: '知识库',
    //     path: '/agents/knowle阿萨ge',
    //     icon: MessageSquareMo阿萨e,
    //     children: [
    //       {
    //         id: 'AgentChat-Dialog',
    //         label: '对话',
    //         path: '/agents/dialog',
    //         icon: MessageSquareMore
    //       },
    //       { id: 'AgentChat-Dialog', label: '对话', path: '/agents/dialog', icon: MessageSquareMore }
    //     ]
    //   }
    // ]
  },

  { id: 'StickyNotes', showTitle: false, label: '便签', path: '/sticky-notes', icon: StickyNote },
  { id: 'EyeProtection', showTitle: false, label: '护眼', path: '/eye-protection', icon: Eye },
  { id: 'Translator', showTitle: false, label: '快捷翻译', path: '/translator', icon: Languages },
  {
    id: 'SnipPaste',
    showTitle: false,
    label: '截屏贴图',
    path: '/snip-paste',
    icon: Scissors,
    children: [
      { id: 'SnipPaste-Snip', label: '截屏', path: '/snip-paste/snip', icon: Scissors },
      { id: 'SnipPaste-Paste', label: '贴图', path: '/snip-paste/paste', icon: Scissors }
    ]
  },
  {
    id: 'WindowStash',
    showTitle: false,
    label: '窗口收纳',
    path: '/window-stash',
    icon: PanelRightOpen
  },
  {
    id: 'ScheduledTasks',
    label: '定时任务',
    showTitle: false,
    path: '/scheduled-tasks',
    icon: Clock,
    children: [
      {
        id: 'ScheduledTasks-Shutdown',
        label: '定时关机',
        path: '/scheduled-tasks/shutdown',
        icon: Clock
      },
      {
        id: 'ScheduledTasks-Reminder',
        label: '定时提醒',
        path: '/scheduled-tasks/reminder',
        icon: Clock
      }
    ]
  },
  { id: 'Landing', label: '关于', showTitle: false, path: '/landing', icon: Info }
]

const menuRef = ref<HTMLElement>()
const menuStyle = reactive<Record<string, string>>({
  position: 'fixed',
  left: '-9999px',
  top: '-9999px',
  visibility: 'hidden'
})

/** 递归查找菜单项 */
function findTabById(items: TabItem[], id: string): TabItem | null {
  for (const item of items) {
    if (item.id === id) return item
    if (item.children) {
      const found = findTabById(item.children, id)
      if (found) return found
    }
  }
  return null
}

function onSelect({ item, key, selectedKeys }): void {
  console.log('select', item, key, selectedKeys)
  const tab = findTabById(tabs, key as string)
  emits('select', { item, key, selectedKeys, path: tab?.path ?? '' })
}

const PADDING = 8

function computePosition(): void {
  const el = menuRef.value
  if (!el) return

  const rect = el.getBoundingClientRect()
  const { innerWidth: vw, innerHeight: vh } = window
  // Python 钩子传来的是物理屏幕坐标，需转换为 CSS 像素
  const scale = window.devicePixelRatio || 1

  // 以触发点为中心
  let left = props.triggerX / scale - rect.width / 2
  let top = props.triggerY / scale - rect.height / 2

  // 边界约束
  left = Math.max(PADDING, Math.min(left, vw - rect.width - PADDING))
  top = Math.max(PADDING, Math.min(top, vh - rect.height - PADDING))

  Object.assign(menuStyle, {
    left: `${left}px`,
    top: `${top}px`,
    visibility: 'visible'
  })
}

onMounted(() => {
  nextTick(computePosition)
})

function handleClick(e: { key: string }): void {
  console.log('click', e.key)
  emits('update:show', false)
}
</script>
<style lang="scss" scoped>
.overlay-menu-wrapper {
  z-index: 11;
  position: relative;
  background: #141414;
}

.ant-menu {
  border-radius: 10px;
  overflow: hidden;
  border-right: none;
}

.menu-overlay {
  position: absolute;
  z-index: 10;
  width: 100%;
  height: 100%;
  left: 0;
  top: 0;
}
</style>
