<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { DEFAULT_SETTINGS, type AppSettings, type SettingsPatch } from '@shared/settings'

type Edge = 'left' | 'right' | 'top' | 'bottom'
type StashedItem = { hwnd: string; title: string; edge: Edge }

const items = ref<StashedItem[]>([])
const stashSettings = ref<AppSettings['windowStash']>(structuredClone(DEFAULT_SETTINGS.windowStash))

function edgeLabel(e: Edge): string {
  if (e === 'left') return '左'
  if (e === 'top') return '上'
  if (e === 'bottom') return '下'
  return '右'
}

async function refresh(): Promise<void> {
  try {
    const ret = (await window.electron.ipcRenderer.invoke('window-stash:list')) as unknown
    items.value = Array.isArray(ret) ? (ret as StashedItem[]) : []
  } catch {
    items.value = []
  }
}

async function refreshSettings(): Promise<void> {
  try {
    const ret = (await window.electron.ipcRenderer.invoke('settings:get')) as AppSettings
    stashSettings.value = ret.windowStash
  } catch {
    stashSettings.value = structuredClone(DEFAULT_SETTINGS.windowStash)
  }
}

async function update(patch: SettingsPatch): Promise<void> {
  try {
    const ret = (await window.electron.ipcRenderer.invoke('settings:update', patch)) as AppSettings
    stashSettings.value = ret.windowStash
  } catch {
    void 0
  }
}

function setColor(edge: Edge, color: string): void {
  const next = { ...stashSettings.value.handleColors, [edge]: color }
  stashSettings.value = { ...stashSettings.value, handleColors: next }
  update({ windowStash: { handleColors: next } }).catch(() => null)
}

function setAnimate(v: boolean): void {
  stashSettings.value = { ...stashSettings.value, animate: v }
  update({ windowStash: { animate: v } }).catch(() => null)
}

function setDurationMs(v: number): void {
  stashSettings.value = { ...stashSettings.value, durationMs: v }
  update({ windowStash: { durationMs: v } }).catch(() => null)
}

function restore(hwnd: string): void {
  if (!hwnd.trim()) return
  window.electron.ipcRenderer.send('window-stash:toggle', { hwnd, activate: true })
}

const onChanged = (_: unknown, payload: unknown): void => {
  items.value = Array.isArray(payload) ? (payload as StashedItem[]) : []
}

onMounted(() => {
  void refresh()
  void refreshSettings()
  window.electron.ipcRenderer.on('window-stash:changed', onChanged)
})

onBeforeUnmount(() => {
  window.electron.ipcRenderer.removeListener('window-stash:changed', onChanged)
})
</script>

<template>
  <div class="page-content">
    <header class="header">
      <div class="title">窗口收纳</div>
      <div class="subtitle">Ctrl + Shift + 1/2/3/4：左/上/右/下贴边收纳</div>
    </header>

    <section class="card">
      <div class="card-head">
        <div class="card-title">外露标签样式</div>
      </div>

      <div class="row setting-row">
        <div class="label">左</div>
        <input
          class="color"
          type="color"
          :value="stashSettings.handleColors.left"
          @change="setColor('left', ($event.target as HTMLInputElement).value)"
        />
      </div>
      <div class="row setting-row">
        <div class="label">上</div>
        <input
          class="color"
          type="color"
          :value="stashSettings.handleColors.top"
          @change="setColor('top', ($event.target as HTMLInputElement).value)"
        />
      </div>
      <div class="row setting-row">
        <div class="label">右</div>
        <input
          class="color"
          type="color"
          :value="stashSettings.handleColors.right"
          @change="setColor('right', ($event.target as HTMLInputElement).value)"
        />
      </div>
      <div class="row setting-row">
        <div class="label">下</div>
        <input
          class="color"
          type="color"
          :value="stashSettings.handleColors.bottom"
          @change="setColor('bottom', ($event.target as HTMLInputElement).value)"
        />
      </div>

      <div class="row setting-row">
        <div class="label">动画</div>
        <label class="switch">
          <input
            type="checkbox"
            :checked="stashSettings.animate"
            @change="setAnimate(($event.target as HTMLInputElement).checked)"
          />
          <span class="slider" />
        </label>
      </div>

      <div class="row setting-row">
        <div class="label">动画时长</div>
        <input
          class="range"
          type="range"
          min="60"
          max="600"
          step="10"
          :value="stashSettings.durationMs"
          @change="setDurationMs(Number(($event.target as HTMLInputElement).value))"
        />
        <div class="value">{{ stashSettings.durationMs }}ms</div>
      </div>
    </section>

    <section class="card">
      <div class="card-head">
        <div class="card-title">已收纳窗口</div>
      </div>

      <div v-if="!items.length" class="empty">暂无收纳窗口</div>

      <button
        v-for="it in items"
        :key="it.hwnd"
        class="row btn-row"
        type="button"
        @click="restore(it.hwnd)"
      >
        <div class="left">
          <div class="name">{{ it.title || it.hwnd }}</div>
          <div class="meta">贴边：{{ edgeLabel(it.edge) }}</div>
        </div>
        <div class="right">恢复</div>
      </button>
    </section>
  </div>
</template>

<style scoped>
.page-content {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.header {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.title {
  font-weight: 900;
  font-size: 16px;
  color: rgba(255, 255, 245, 0.92);
}

.subtitle {
  font-size: 12px;
  color: rgba(235, 235, 245, 0.6);
}

.empty {
  padding: 12px 0;
  color: rgba(235, 235, 245, 0.58);
  font-size: 13px;
}

.setting-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.label {
  width: 56px;
  color: rgba(235, 235, 245, 0.78);
  font-size: 13px;
  font-weight: 800;
}

.color {
  width: 44px;
  height: 28px;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.04);
  border-radius: 8px;
}

.range {
  flex: 1;
}

.value {
  width: 64px;
  text-align: right;
  color: rgba(235, 235, 245, 0.6);
  font-size: 12px;
}

.switch {
  position: relative;
  display: inline-block;
  width: 44px;
  height: 24px;
}

.switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.slider {
  position: absolute;
  cursor: pointer;
  inset: 0;
  background-color: rgba(255, 255, 255, 0.16);
  transition: 0.2s;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.slider:before {
  position: absolute;
  content: '';
  height: 18px;
  width: 18px;
  left: 2px;
  bottom: 2px;
  background-color: rgba(255, 255, 255, 0.9);
  transition: 0.2s;
  border-radius: 999px;
}

input:checked + .slider {
  background-color: rgba(59, 130, 246, 0.42);
}

input:checked + .slider:before {
  transform: translateX(20px);
}

.btn-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  cursor: pointer;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.02);
  padding: 10px 12px;
  color: rgba(235, 235, 245, 0.78);
}

.btn-row:hover {
  background: rgba(255, 255, 255, 0.04);
}

.left {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.name {
  font-weight: 800;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 680px;
}

.meta {
  font-size: 12px;
  color: rgba(235, 235, 245, 0.55);
}

.right {
  flex: 0 0 auto;
  font-weight: 900;
  font-size: 12px;
  color: rgba(59, 130, 246, 0.95);
}
</style>
