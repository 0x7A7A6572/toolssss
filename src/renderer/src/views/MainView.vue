<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router'

const router = useRouter()
const route = useRoute()

const tabs = [
  { id: 'EyeProtection', label: '护眼工具', path: '/eye-protection' },
  { id: 'OtherTools', label: '其他工具（预留）', path: '/other-tools' }
]

function selectTab(path: string): void {
  router.push(path)
}
</script>

<template>
  <div class="layout">
    <aside class="sidebar">
      <div class="sidebar-title">工具箱</div>
      <button
        v-for="tab in tabs"
        :key="tab.id"
        class="tab"
        :class="{ active: route.path === tab.path }"
        type="button"
        @click="selectTab(tab.path)"
      >
        {{ tab.label }}
      </button>

      <div class="spacer"></div>

      <button
        class="tab"
        :class="{ active: route.path === '/settings' }"
        type="button"
        @click="selectTab('/settings')"
      >
        全局设置
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
}
</style>
