<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { House, Settings2 } from 'lucide-vue-next'
import { Minus, Square, X } from 'lucide-vue-next'

const router = useRouter()
const route = useRoute()

const tabs = [
  { id: 'OtherTools', label: House, type: 'icon', path: '/other-tools' },
  { id: 'StickyNotes', label: '便签', path: '/sticky-notes' },
  { id: 'EyeProtection', label: '护眼', path: '/eye-protection' },
  { id: 'Translator', label: '快捷翻译', path: '/translator' },
  { id: 'SnipPaste', label: '截屏贴图', path: '/snip-paste' },
  { id: 'WindowStash', label: '窗口收纳', path: '/window-stash' },
  // { id: 'ScriptLibrary', label: '脚本库', path: '/script-library' },
  { id: 'Landing', label: '关于', path: '/landing' }
]

const hasUpdate = ref(false)
const maximized = ref(false)
const onUpdateStatus = (_: unknown, payload: unknown): void => {
  if (!payload || typeof payload !== 'object') return
  const p = payload as { hasUpdate?: unknown }
  hasUpdate.value = Boolean(p.hasUpdate)
}

function selectTab(path: string): void {
  router.push(path)
}

function minimize(): void {
  window.electron.ipcRenderer.send('window:control', { action: 'minimize' })
}
function toggleMaximize(): void {
  window.electron.ipcRenderer.send('window:control', { action: 'toggleMaximize' })
}
function closeWindow(): void {
  window.electron.ipcRenderer.send('window:control', { action: 'close' })
}

onMounted(() => {
  window.electron.ipcRenderer
    .invoke('update:status:get')
    .then((v: unknown) => onUpdateStatus(null, v))
    .catch(() => null)
  window.electron.ipcRenderer.on('update:status', onUpdateStatus)
  window.electron.ipcRenderer
    .invoke('window:state:get')
    .then((v: unknown) => {
      const p = v && typeof v === 'object' ? (v as { maximized?: unknown }) : {}
      maximized.value = Boolean(p.maximized)
    })
    .catch(() => null)
  window.electron.ipcRenderer.on('window:state', (_: unknown, payload: unknown) => {
    const p = payload && typeof payload === 'object' ? (payload as { maximized?: unknown }) : {}
    maximized.value = Boolean(p.maximized)
  })
})

onBeforeUnmount(() => {
  window.electron.ipcRenderer.removeListener('update:status', onUpdateStatus)
  window.electron.ipcRenderer.removeAllListeners('window:state')
})
</script>

<template>
  <div class="layout">
    <div class="window-titlebar">
      <div class="titlebar-drag"></div>
      <div class="titlebar-actions">
        <button
          class="titlebar-btn"
          type="button"
          aria-label="最小化"
          title="最小化"
          @click="minimize"
        >
          <Minus :size="16" />
        </button>
        <button
          class="titlebar-btn"
          type="button"
          :aria-label="maximized ? '还原' : '最大化'"
          :title="maximized ? '还原' : '最大化'"
          @click="toggleMaximize"
        >
          <Square :size="14" />
        </button>
        <button
          class="titlebar-btn danger"
          type="button"
          aria-label="关闭"
          title="关闭"
          @click="closeWindow"
        >
          <X :size="16" />
        </button>
      </div>
    </div>
    <aside class="sidebar">
      <!-- <div class="brand">
        <img class="brand-icon" :src="logo" alt="icon" />
        <div class="sidebar-title">工具箱</div>
      </div> -->

      <button
        v-for="tab in tabs"
        :key="tab.id"
        class="tab"
        :class="{
          active: route.path === tab.path,
          'settings-tab': tab.type === 'icon'
        }"
        type="button"
        @click="selectTab(tab.path)"
      >
        <component :is="tab.type === 'icon' ? tab.label : 'div'" />
        <div v-if="tab.type !== 'icon'" style="display: flex; align-items: center">
          <div class="pre-icon" :class="{ active: route.path === tab.path }"></div>
          <span>{{ tab.label }}</span>
          <span v-if="tab.id === 'Landing' && hasUpdate" class="dot" />
        </div>
      </button>

      <div class="spacer"></div>

      <button
        class="tab settings-tab"
        :class="{ active: route.path === '/settings' }"
        type="button"
        @click="selectTab('/settings')"
      >
        <Settings2 class="brand-icon" />
      </button>
    </aside>

    <div class="page">
      <router-view />
    </div>
  </div>
</template>

<style scoped>
.layout {
  height: 100vh;
  width: 100%;
  display: grid;
  grid-template-columns: 170px 1fr;
  background-color: black;
}

.window-titlebar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  -webkit-app-region: drag;
  z-index: 1000;
  background: linear-gradient(
    270deg,
    /* black 100px, */ #3370d32e 50px,
    #5957dc4a 100px,
    black 250px,
    transparent 50%
  );
}
.titlebar-drag {
  flex: 1;
}
.titlebar-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px 8px 0;
  -webkit-app-region: no-drag;
}
.titlebar-btn {
  width: 28px;
  height: 22px;
  display: flex;
  border: none;
  align-items: center;
  justify-content: center;
  background: none;
  color: rgba(235, 235, 245, 0.82);
  cursor: pointer;
}
.titlebar-btn:hover {
  background: rgba(255, 255, 255, 0.1);
}
.titlebar-btn.danger:hover {
  background: rgba(239, 68, 68, 0.18);
  border-color: rgba(239, 68, 68, 0.26);
}

.sidebar {
  height: 100vh;
  border-right: 1px solid rgba(255, 255, 255, 0.08);
  padding: 18px 12px 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  background: rgba(255, 255, 255, 0.02);
  overflow-y: scroll;
  scrollbar-width: none;
}

.sidebar::-webkit-scrollbar {
  display: none;
}

.sidebar-title {
  font-size: 12px;
  color: var(--ev-c-text-3);
  padding: 6px 8px;
  letter-spacing: 0.04em;
}

.brand {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px 2px;
}
.brand-icon {
  width: 22px;
  height: 22px;
  opacity: 0.9;
}

.spacer {
  flex: 1;
}

.tab {
  cursor: pointer;
  width: 100%;
  text-align: left;
  border-radius: 10px;
  padding: 10px 10px;
  border: 1px solid transparent;
  background: transparent;
  color: rgba(235, 235, 245, 0.78);
  font-size: 13px;
  font-weight: 700;
}

.tab .pre-icon {
  width: 16px;
  height: 16px;
  margin-right: 6px;
  background-color: rgba(235, 235, 245, 0.24);
  border-radius: 4px;
}

.tab .pre-icon.active {
  background-color: rgba(35, 145, 255, 0.616);
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: rgba(239, 68, 68, 0.95);
  box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.25);
  margin-left: 8px;
}

.settings-tab {
  width: 50px;
  height: 50px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.tab:hover {
  background: rgba(255, 255, 255, 0.04);
}

.tab.active {
  border-color: rgba(59, 130, 246, 0.5);
  background: rgba(59, 130, 246, 0.12);
  color: rgba(255, 255, 245, 0.92);
}

.page {
  height: 100vh;
  width: 100%;
  padding: 60px 24px 24px;
  display: flex;
  flex-direction: column;
  overflow-y: scroll;
  /* 隐藏滚动条 */
  scrollbar-width: none; /* Firefox */
  -ms-overflow-style: none; /* IE/Edge */
}
</style>
