<script setup lang="ts">
import { type Component, ref } from 'vue'
import GeneralSettings from './components/GeneralSettings.vue'
import ShortcutSettings from './components/ShortcutSettings.vue'
import AiSettings from './components/AiSettings.vue'
import TranslateSettings from './components/TranslateSettings.vue'
import EyeProtection from '../EyeProtection/EyeProtection.vue'
import WindowStashView from '../WindowStash/WindowStashView.vue'
import ScheduledTasks from '../ScheduledTasks/ScheduledTasks.vue'
import AgentSettings from './components/AgentSettings.vue'

type NavItem = {
  key: string
  label: string
  component: Component
}

const navItems: NavItem[] = [
  { key: 'general', label: '通用', component: GeneralSettings },
  { key: 'shortcuts', label: '快捷键', component: ShortcutSettings },
  { key: 'ai', label: 'AI 服务', component: AiSettings },
  { key: 'translate', label: '翻译服务', component: TranslateSettings },
  { key: 'eye', label: '护眼模式', component: EyeProtection },
  { key: 'stash', label: '窗口收纳', component: WindowStashView },
  { key: 'scheduledTasks', label: '定时任务', component: ScheduledTasks },
  { key: 'agents', label: 'Agent 设置', component: AgentSettings }
]

const activeKey = ref<string>('general')
const currentComponent = ref<Component>(GeneralSettings)

function switchTab(item: NavItem): void {
  activeKey.value = item.key
  currentComponent.value = item.component
}
</script>

<template>
  <div class="settings-layout">
    <!-- <header class="settings-header">
      <div class="settings-title">全局设置</div>
    </header> -->

    <div class="settings-body">
      <nav class="settings-nav">
        <button
          v-for="item in navItems"
          :key="item.key"
          class="nav-item"
          :class="{ 'nav-item--active': activeKey === item.key }"
          type="button"
          @click="switchTab(item)"
        >
          {{ item.label }}
        </button>
      </nav>

      <main class="settings-content">
        <component :is="currentComponent" />
      </main>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.settings-layout {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.settings-header {
  padding: 20px 24px 12px;
  flex-shrink: 0;
}

.settings-title {
  font-size: 24px;
  font-weight: 700;
  line-height: 28px;
}

.settings-body {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.settings-nav {
  width: 180px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 8px 16px;
  border-right: 1px solid rgba(255, 255, 255, 0.06);
  overflow-y: auto;
}

.nav-item {
  width: 100%;
  padding: 8px 12px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--ev-c-text-2);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  transition:
    background 0.15s ease,
    color 0.15s ease;
  line-height: 1.4;
}

.nav-item:hover {
  background: rgba(255, 255, 255, 0.04);
  color: var(--ev-c-text-1);
}

.nav-item--active {
  background: rgba(255, 255, 255, 0.08);
  color: var(--ev-c-theme);
  font-weight: 700;
}

.settings-content {
  flex: 1;
  overflow-y: auto;
  padding: 8px 24px 24px;
}
</style>

<style lang="scss">
.settings-content .text {
  padding: 6px 10px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(0, 0, 0, 0.2);
  color: var(--ev-c-text-1);
  outline: none;
  font-size: 13px;
  width: 200px;
  text-align: right;
}

.settings-content .text:focus {
  border-color: rgba(59, 130, 246, 0.5);
}

.settings-content .select {
  width: 200px;
}
</style>
