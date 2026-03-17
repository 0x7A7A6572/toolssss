<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { DEFAULT_SETTINGS, type AppSettings, type SettingsPatch } from '@shared/settings'

type Edge = 'left' | 'right' | 'top' | 'bottom'
type StashedItem = { hwnd: string; title: string; edge: Edge }

const items = ref<StashedItem[]>([])
const stashSettings = ref<AppSettings['windowStash']>(structuredClone(DEFAULT_SETTINGS.windowStash))
const HANDLE_EDGES: Edge[] = ['left', 'top', 'right', 'bottom']
const durationMsDraft = ref(stashSettings.value.durationMs)
const opacityDraft = ref(stashSettings.value.handleOpacity)
const colorDrafts = ref<Record<Edge, string>>({ ...stashSettings.value.handleColors })
const colorMenus = ref<Record<Edge, boolean>>({
  left: false,
  top: false,
  right: false,
  bottom: false
})

watch(
  () => stashSettings.value.durationMs,
  (v) => {
    durationMsDraft.value = v
  }
)

watch(
  () => stashSettings.value.handleOpacity,
  (v) => {
    opacityDraft.value = v
  }
)

watch(
  () => stashSettings.value.handleColors,
  (v) => {
    colorDrafts.value = { ...v }
  }
)

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

function onColorMenuChange(edge: Edge, open: boolean): void {
  if (open) colorDrafts.value[edge] = stashSettings.value.handleColors[edge]
}

function cancelColor(edge: Edge): void {
  colorDrafts.value[edge] = stashSettings.value.handleColors[edge]
  colorMenus.value[edge] = false
}

function applyColor(edge: Edge): void {
  setColor(edge, colorDrafts.value[edge])
  colorMenus.value[edge] = false
}

function setAnimate(v: boolean | null): void {
  const next = Boolean(v)
  stashSettings.value = { ...stashSettings.value, animate: next }
  update({ windowStash: { animate: next } }).catch(() => null)
}

function setDurationMs(v: number): void {
  stashSettings.value = { ...stashSettings.value, durationMs: v }
  update({ windowStash: { durationMs: v } }).catch(() => null)
}

function setHandleOpacity(v: number): void {
  stashSettings.value = { ...stashSettings.value, handleOpacity: v }
  update({ windowStash: { handleOpacity: v } }).catch(() => null)
}

function setShowHandleTitle(v: boolean): void {
  stashSettings.value = { ...stashSettings.value, showHandleTitle: v }
  update({ windowStash: { showHandleTitle: v } }).catch(() => null)
}

function setShowHandleDrag(v: boolean): void {
  stashSettings.value = { ...stashSettings.value, showHandleDrag: v }
  update({ windowStash: { showHandleDrag: v } }).catch(() => null)
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

    <div class="card-container-flex">
      <section class="card">
        <div class="card-head">
          <div class="card-title">外露标签样式</div>
          <div class="card-actions">
            <div class="head-action-label">动画</div>
            <label class="switch">
              <input
                type="checkbox"
                :checked="stashSettings.animate"
                @change="setAnimate(($event.target as HTMLInputElement).checked)"
              />
              <span class="slider" />
            </label>
          </div>
        </div>

        <div class="row colors">
          <div class="label">颜色</div>
          <div class="handle-grid">
            <div v-for="e in HANDLE_EDGES" :key="e" class="handle-item">
              <div class="handle-label">{{ edgeLabel(e) }}</div>
              <v-menu
                v-model="colorMenus[e]"
                :close-on-content-click="false"
                :offset="8"
                location="bottom"
                @update:model-value="(open) => onColorMenuChange(e, open)"
              >
                <template #activator="{ props }">
                  <button
                    v-bind="props"
                    class="color-btn"
                    type="button"
                    :style="{ backgroundColor: stashSettings.handleColors[e] }"
                    :title="stashSettings.handleColors[e]"
                    :aria-label="`选择${edgeLabel(e)}侧颜色`"
                  />
                </template>

                <v-card class="color-pop">
                  <v-color-picker
                    v-model="colorDrafts[e]"
                    :modes="['rgba']"
                    show-swatches
                    hide-inputs
                  />
                  <div class="color-actions">
                    <v-btn variant="text" density="compact" @click="cancelColor(e)">取消</v-btn>
                    <v-btn color="primary" variant="flat" density="compact" @click="applyColor(e)">
                      应用
                    </v-btn>
                  </div>
                </v-card>
              </v-menu>
            </div>
          </div>
        </div>

        <div class="row">
          <div class="label">动画时长</div>
          <div class="slider-wrap">
            <v-slider
              v-model="durationMsDraft"
              min="60"
              max="500"
              step="10"
              hide-details
              density="compact"
              @end="setDurationMs(durationMsDraft)"
            />
          </div>
          <div class="value">{{ durationMsDraft }}ms</div>
        </div>

        <div class="row">
          <div class="label">透明度</div>
          <div class="slider-wrap">
            <v-slider
              v-model="opacityDraft"
              min="0"
              max="1"
              step="0.05"
              hide-details
              density="compact"
              @end="setHandleOpacity(opacityDraft)"
            />
          </div>
          <div class="value">{{ Math.round(opacityDraft * 100) }}%</div>
        </div>
      </section>
      <section class="card">
        <div class="card-head">
          <div class="card-title">外露标签内容</div>
        </div>

        <div class="row">
          <div class="label">显示标题</div>
          <div />
          <label class="switch">
            <input
              type="checkbox"
              :checked="stashSettings.showHandleTitle"
              @change="setShowHandleTitle(($event.target as HTMLInputElement).checked)"
            />
            <span class="slider" />
          </label>
        </div>

        <div class="row">
          <div class="label">显示拖拽</div>
          <div />
          <label class="switch">
            <input
              type="checkbox"
              :checked="stashSettings.showHandleDrag"
              @change="setShowHandleDrag(($event.target as HTMLInputElement).checked)"
            />
            <span class="slider" />
          </label>
        </div>
      </section>
    </div>

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
  gap: 16px;
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

.card-container-flex {
  display: flex;
  gap: 16px;
}

.card-container-flex > .card {
  flex: 1;
  min-width: 0;
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
  display: flex;
  align-items: center;
  gap: 4px;
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

.card-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.head-action-label {
  font-size: 13px;
  color: var(--ev-c-text-2);
  font-weight: 700;
}

.empty {
  padding: 12px 0;
  color: var(--ev-c-text-2);
  font-size: 13px;
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

.color {
  width: 44px;
  height: 28px;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(0, 0, 0, 0.2);
  border-radius: 8px;
}

.slider-wrap {
  width: 100%;
  min-width: 0;
}

.color-btn {
  width: 44px;
  height: 28px;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  cursor: pointer;
}

.color-pop {
  padding: 10px;
}

.color-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 8px;
}

.range {
  width: 100%;
}

.value {
  font-size: 12px;
  color: var(--ev-c-text-2);
  min-width: 64px;
  text-align: right;
}

.colors {
  align-items: center;
}

.handle-grid {
  grid-column: 2 / span 2;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.handle-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(0, 0, 0, 0.12);
  padding: 8px 10px;
}

.handle-label {
  font-size: 12px;
  color: var(--ev-c-text-2);
  font-weight: 700;
}

.switch {
  position: relative;
  display: inline-block;
  width: 46px;
  height: 26px;
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
  text-align: left;
  font-weight: 800;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 680px;
}

.meta {
  text-align: left;
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
