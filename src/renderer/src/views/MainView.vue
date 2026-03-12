<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router'
// import logo from '../assets/electron.svg'
import { House, Settings2 } from 'lucide-vue-next'

const router = useRouter()
const route = useRoute()

const tabs = [
  { id: 'OtherTools', label: House, type: 'icon', path: '/other-tools' },
  { id: 'StickyNotes', label: '便签工具', path: '/sticky-notes' },
  { id: 'EyeProtection', label: '护眼工具', path: '/eye-protection' },
  { id: 'Translator', label: '快捷翻译', path: '/translator' },
  { id: 'SnipPaste', label: '截屏贴图', path: '/snip-paste' },
  { id: 'ScriptLibrary', label: '脚本库', path: '/script-library' }
]

function selectTab(path: string): void {
  router.push(path)
}
</script>

<template>
  <div class="layout">
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

.sidebar {
  height: 100vh;
  border-right: 1px solid rgba(255, 255, 255, 0.08);
  padding: 18px 12px;
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
  padding: 24px;
  display: flex;
  flex-direction: column;
  overflow-y: scroll;
  /* 隐藏滚动条 */
  scrollbar-width: none; /* Firefox */
  -ms-overflow-style: none; /* IE/Edge */
}
</style>
