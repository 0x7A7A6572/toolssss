<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { DEFAULT_SETTINGS, type AppSettings, type SettingsPatch } from '../../../shared/settings'

const settings = ref<AppSettings>(structuredClone(DEFAULT_SETTINGS))
const saving = ref(false)
const activeTab = ref<'eye' | 'other'>('eye')

const headerTitle = computed(() => (activeTab.value === 'eye' ? '护眼工具' : '其他工具'))
const headerSubtitle = computed(() =>
  activeTab.value === 'eye' ? '屏幕护眼遮罩 + 全屏提醒' : '预留入口，后续扩展'
)

async function refresh(): Promise<void> {
  const result = await window.electron.ipcRenderer.invoke('settings:get')
  settings.value = result as AppSettings
}

async function update(patch: SettingsPatch): Promise<void> {
  saving.value = true
  try {
    const result = await window.electron.ipcRenderer.invoke('settings:update', patch)
    settings.value = result as AppSettings
  } finally {
    saving.value = false
  }
}

onMounted(() => {
  refresh().catch(() => null)
})
</script>

<template>
  <div class="layout">
    <aside class="sidebar">
      <div class="sidebar-title">工具箱</div>
      <button
        class="tab"
        :class="{ active: activeTab === 'eye' }"
        type="button"
        @click="activeTab = 'eye'"
      >
        护眼工具
      </button>
      <button
        class="tab"
        :class="{ active: activeTab === 'other' }"
        type="button"
        @click="activeTab = 'other'"
      >
        其他工具（预留）
      </button>
    </aside>

    <div class="page">
      <header class="header">
        <div class="title">{{ headerTitle }}</div>
        <div class="subtitle">{{ headerSubtitle }}</div>
      </header>

      <template v-if="activeTab === 'eye'">
        <section class="card">
          <div class="card-head">
            <div class="card-title">护眼遮罩</div>
            <label class="switch">
              <input
                type="checkbox"
                :checked="settings.eye.enabled"
                @change="
                  update({
                    eye: { enabled: ($event.target as HTMLInputElement).checked }
                  })
                "
              />
              <span class="slider" />
            </label>
          </div>
          <div class="row">
            <div class="label">强度</div>
            <input
              class="range"
              type="range"
              min="0"
              max="0.7"
              step="0.01"
              :value="settings.eye.opacity"
              @input="
                update({
                  eye: { opacity: Number(($event.target as HTMLInputElement).value) }
                })
              "
            />
            <div class="value">{{ Math.round(settings.eye.opacity * 100) }}%</div>
          </div>
          <div class="row colors">
            <div class="label">颜色</div>
            <div class="palette">
              <button
                v-for="c in [
                  '#FFA046',
                  '#F59E0B',
                  '#EF4444',
                  '#F43F5E',
                  '#FB7185',
                  '#22C55E',
                  '#10B981',
                  '#14B8A6',
                  '#0EA5E9',
                  '#3B82F6',
                  '#8B5CF6',
                  '#A855F7',
                  '#94A3B8'
                ]"
                :key="c"
                class="swatch"
                :class="{ active: settings.eye.color === c }"
                :style="{ backgroundColor: c }"
                type="button"
                title="选择颜色"
                @click="update({ eye: { color: c } })"
              />
            </div>
          </div>
        </section>

        <section class="card">
          <div class="card-head">
            <div class="card-title">闹钟（全屏提示）</div>
            <label class="switch">
              <input
                type="checkbox"
                :checked="settings.alarm.enabled"
                @change="
                  update({
                    alarm: { enabled: ($event.target as HTMLInputElement).checked }
                  })
                "
              />
              <span class="slider" />
            </label>
          </div>
          <div class="row">
            <div class="label">时间</div>
            <input
              class="time"
              type="time"
              :value="settings.alarm.time"
              @change="
                update({
                  alarm: { time: ($event.target as HTMLInputElement).value }
                })
              "
            />
          </div>
          <div class="row">
            <div class="label">标题</div>
            <input
              class="text"
              type="text"
              :value="settings.alarm.label"
              @change="
                update({
                  alarm: { label: ($event.target as HTMLInputElement).value }
                })
              "
            />
          </div>
        </section>

        <div class="row-group">
          <section class="card">
            <div class="card-head">
              <div class="card-title">定时休息（全屏提示）</div>
              <label class="switch">
                <input
                  type="checkbox"
                  :checked="settings.break.enabled"
                  @change="
                    update({
                      break: { enabled: ($event.target as HTMLInputElement).checked }
                    })
                  "
                />
                <span class="slider" />
              </label>
            </div>
            <div class="row">
              <div class="label">间隔</div>
              <select
                class="select"
                :value="String(settings.break.intervalMinutes)"
                @change="
                  update({
                    break: { intervalMinutes: Number(($event.target as HTMLSelectElement).value) }
                  })
                "
              >
                <option value="15">15 分钟</option>
                <option value="30">30 分钟</option>
                <option value="45">45 分钟</option>
                <option value="60">1 小时</option>
                <option value="90">1.5 小时</option>
                <option value="120">2 小时</option>
              </select>
            </div>
          </section>

          <section class="card">
            <div class="card-title">提醒时长</div>
            <div class="row">
              <div class="label">时长</div>
              <select
                class="select"
                :value="String(settings.reminderSeconds)"
                @change="
                  update({ reminderSeconds: Number(($event.target as HTMLSelectElement).value) })
                "
              >
                <option value="10">10 秒</option>
                <option value="20">20 秒</option>
                <option value="30">30 秒</option>
                <option value="45">45 秒</option>
                <option value="60">60 秒</option>
              </select>
            </div>
          </section>
        </div>
      </template>

      <template v-else>
        <section class="card placeholder">
          <div class="card-title">其他工具</div>
          <div class="placeholder-text">这里先预留，后面再往里塞东西。</div>
        </section>
      </template>

      <footer class="footer">
        <div class="status">{{ saving ? '保存中…' : '已保存' }}</div>
      </footer>
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
  /* overflow-y: scroll; */
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
  scrollbar-width: none; /* Firefox */
}

.sidebar::-webkit-scrollbar {
  display: none; /* Chrome, Safari, Edge */
}

.sidebar-title {
  font-size: 12px;
  color: var(--ev-c-text-3);
  padding: 6px 8px;
  letter-spacing: 0.04em;
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
  height: 100%;
  width: 100%;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: 100vh;
  overflow-y: scroll;
}

.header {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.title {
  font-size: 24px;
  font-weight: 700;
  line-height: 28px;
}

.subtitle {
  font-size: 13px;
  color: var(--ev-c-text-2);
}

.card {
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.04);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.card-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--ev-c-text-1);
}

.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.row {
  display: grid;
  grid-template-columns: 84px 1fr auto;
  align-items: center;
  gap: 12px;
}

.label {
  font-size: 13px;
  color: var(--ev-c-text-2);
}

.value {
  font-size: 12px;
  color: var(--ev-c-text-2);
  min-width: 44px;
  text-align: right;
}

.range {
  width: 100%;
}

.row-group {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.colors {
  align-items: center;
}

.palette {
  display: grid;
  grid-template-columns: repeat(8, 28px);
  gap: 8px;
}

.swatch {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  padding: 0;
  cursor: pointer;
}

.swatch.active {
  outline: 2px solid rgba(255, 255, 255, 0.9);
  outline-offset: 2px;
}

.time,
.text,
.select {
  width: 100%;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(0, 0, 0, 0.2);
  color: var(--ev-c-text-1);
  outline: none;
}

.text {
  grid-column: 2 / span 2;
}

.switch {
  position: relative;
  display: inline-block;
  width: 46px;
  height: 26px;
  justify-self: end;
}

.switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.slider {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(255, 255, 255, 0.12);
  transition: 0.2s;
  border-radius: 999px;
}

.slider:before {
  position: absolute;
  content: '';
  height: 20px;
  width: 20px;
  left: 3px;
  bottom: 3px;
  background-color: rgba(255, 255, 255, 0.9);
  transition: 0.2s;
  border-radius: 50%;
}

.switch input:checked + .slider {
  background-color: rgba(59, 130, 246, 0.65);
}

.switch input:checked + .slider:before {
  transform: translateX(20px);
}

.footer {
  margin-top: auto;
  padding-top: 8px;
  display: flex;
  justify-content: flex-end;
}

.status {
  font-size: 12px;
  color: var(--ev-c-text-3);
}

.placeholder {
  flex: 1;
}

.placeholder-text {
  font-size: 13px;
  color: rgba(235, 235, 245, 0.62);
}
</style>
