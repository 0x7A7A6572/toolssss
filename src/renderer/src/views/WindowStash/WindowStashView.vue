<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch, toRaw } from 'vue'
import { DEFAULT_SETTINGS, type AppSettings, type SettingsPatch } from '@shared/settings'
import { PencilLine, X } from 'lucide-vue-next'
import AppSwitch from '../../components/AppSwitch.vue'
import { useSettingsStore } from '@renderer/state/settings'

type Edge = 'left' | 'right' | 'top' | 'bottom'
type StashedItem = {
  hwnd: string
  title: string
  edge: Edge
  handleAlias?: string
  handleColor?: string
}

const items = ref<StashedItem[]>([])
function cloneWindowStashSettings(v: AppSettings['windowStash']): AppSettings['windowStash'] {
  return { ...v, handleColors: { ...v.handleColors } }
}

const stashSettings = ref<AppSettings['windowStash']>(
  cloneWindowStashSettings(DEFAULT_SETTINGS.windowStash)
)
const settingsStore = useSettingsStore()
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

const itemAliasDrafts = ref<Record<string, string>>({})
const itemColorDrafts = ref<Record<string, string>>({})
const itemColorMenus = ref<Record<string, boolean>>({})

const PRESET_COLORS: string[] = [
  '#22c55e88',
  '#3b82f688',
  '#f59e0b88',
  '#ef444488',
  '#a855f788',
  '#14b8a688',
  '#94a3b888',
  '#00000088',
  '#ffffff88'
]

function normalizeHexColorInput(s: string): string | null {
  const raw = typeof s === 'string' ? s.trim() : ''
  if (!raw) return null
  const v = raw.startsWith('#') ? raw : `#${raw}`
  return /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v) ? v : null
}

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
watch(
  () => settingsStore.settings.value.windowStash,
  (v) => {
    stashSettings.value = cloneWindowStashSettings(toRaw(v))
  },
  { deep: true, immediate: true }
)

watch(
  items,
  (next) => {
    const nextHwnds = new Set(next.map((it) => it.hwnd))
    for (const it of next) {
      if (itemAliasDrafts.value[it.hwnd] === undefined) {
        itemAliasDrafts.value[it.hwnd] = it.handleAlias ?? ''
      }
      if (itemColorDrafts.value[it.hwnd] === undefined) {
        itemColorDrafts.value[it.hwnd] = it.handleColor ?? ''
      }
      if (itemColorMenus.value[it.hwnd] === undefined) {
        itemColorMenus.value[it.hwnd] = false
      }
    }
    for (const k of Object.keys(itemAliasDrafts.value)) {
      if (!nextHwnds.has(k)) delete itemAliasDrafts.value[k]
    }
    for (const k of Object.keys(itemColorDrafts.value)) {
      if (!nextHwnds.has(k)) delete itemColorDrafts.value[k]
    }
    for (const k of Object.keys(itemColorMenus.value)) {
      if (!nextHwnds.has(k)) delete itemColorMenus.value[k]
    }
  },
  { deep: false }
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

async function update(patch: SettingsPatch): Promise<void> {
  try {
    await settingsStore.update(patch)
    stashSettings.value = cloneWindowStashSettings(toRaw(settingsStore.settings.value.windowStash))
  } catch {
    void 0
  }
}

function setColor(edge: Edge, color: string): void {
  const normalized = normalizeHexColorInput(color)
  if (!normalized) return
  const next = { ...stashSettings.value.handleColors, [edge]: normalized }
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

async function updateItemMeta(
  hwnd: string,
  patch: { handleAlias?: string; handleColor?: string }
): Promise<void> {
  const id = hwnd.trim()
  if (!id) return
  try {
    const ret = (await window.electron.ipcRenderer.invoke('window-stash:update-meta', {
      hwnd: id,
      ...patch
    })) as unknown
    items.value = Array.isArray(ret) ? (ret as StashedItem[]) : items.value
  } catch {
    void 0
  }
}

function onAliasInput(hwnd: string, v: string): void {
  itemAliasDrafts.value[hwnd] = v
}

function applyAlias(hwnd: string): void {
  void updateItemMeta(hwnd, { handleAlias: itemAliasDrafts.value[hwnd] ?? '' })
}

function onItemColorMenuChange(it: StashedItem, open: boolean): void {
  if (open) {
    itemColorDrafts.value[it.hwnd] = it.handleColor ?? stashSettings.value.handleColors[it.edge]
  }
}

function cancelItemColor(hwnd: string): void {
  const it = items.value.find((x) => x.hwnd === hwnd)
  if (!it) return
  itemColorDrafts.value[hwnd] = it.handleColor ?? stashSettings.value.handleColors[it.edge]
  itemColorMenus.value[hwnd] = false
}

function applyItemColor(hwnd: string): void {
  const normalized = normalizeHexColorInput(itemColorDrafts.value[hwnd] ?? '')
  if (!normalized) return
  void updateItemMeta(hwnd, { handleColor: normalized })
  itemColorMenus.value[hwnd] = false
}

function clearItemColor(hwnd: string): void {
  void updateItemMeta(hwnd, { handleColor: '' })
  itemColorMenus.value[hwnd] = false
}

const onChanged = (_: unknown, payload: unknown): void => {
  items.value = Array.isArray(payload) ? (payload as StashedItem[]) : []
}

onMounted(() => {
  void refresh()
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
        </div>

        <div class="row colors">
          <div class="label">颜色</div>
          <div class="handle-grid">
            <div v-for="e in HANDLE_EDGES" :key="e" class="handle-item">
              <div class="handle-label">{{ edgeLabel(e) }}</div>
              <a-popover
                trigger="click"
                placement="bottom"
                :open="colorMenus[e]"
                @update:open="
                  (open) => {
                    colorMenus[e] = open
                    onColorMenuChange(e, open)
                  }
                "
              >
                <template #content>
                  <div class="color-pop">
                    <div class="color-palette">
                      <button
                        v-for="c in PRESET_COLORS"
                        :key="c"
                        class="palette-swatch"
                        type="button"
                        :style="{ backgroundColor: c }"
                        :title="c"
                        @click="colorDrafts[e] = c"
                      />
                    </div>
                    <a-input v-model:value="colorDrafts[e]" placeholder="#RRGGBB / #RRGGBBAA" />
                    <div class="color-actions">
                      <a-button size="small" @click="cancelColor(e)">取消</a-button>
                      <a-button size="small" type="primary" @click="applyColor(e)">应用</a-button>
                    </div>
                  </div>
                </template>
                <button
                  class="color-btn"
                  type="button"
                  :style="{ backgroundColor: stashSettings.handleColors[e] }"
                  :title="stashSettings.handleColors[e]"
                  :aria-label="`选择${edgeLabel(e)}侧颜色`"
                />
              </a-popover>
            </div>
          </div>
        </div>

        <div class="flex justify-between">
          <div class="label">动画</div>
          <AppSwitch
            :model-value="stashSettings.animate"
            @update:model-value="setAnimate($event)"
          />
        </div>

        <div class="row">
          <div class="label">动画时长</div>
          <div class="slider-wrap">
            <a-slider
              v-model:value="durationMsDraft"
              :min="30"
              :max="200"
              :step="30"
              show-label
              @after-change="(v) => setDurationMs(Array.isArray(v) ? v[0] : v)"
            />
          </div>
          <div class="value">{{ durationMsDraft }}ms</div>
        </div>

        <div class="row">
          <div class="label">透明度</div>
          <div class="slider-wrap">
            <a-slider
              v-model:value="opacityDraft"
              :min="0"
              :max="1"
              :step="0.05"
              @after-change="(v) => setHandleOpacity(Array.isArray(v) ? v[0] : v)"
            />
          </div>
          <div class="value">{{ Math.round(opacityDraft * 100) }}%</div>
        </div>
        <div class="row">
          <div class="label">显示标题</div>
          <div />
          <AppSwitch
            :model-value="stashSettings.showHandleTitle"
            @update:model-value="setShowHandleTitle($event)"
          />
        </div>

        <div class="row">
          <div class="label">显示拖拽</div>
          <div />
          <AppSwitch
            :model-value="stashSettings.showHandleDrag"
            @update:model-value="setShowHandleDrag($event)"
          />
        </div>

        <div class="row">
          <div class="label">双击标签关闭收纳</div>
          <div />
          <AppSwitch :model-value="true" :disabled="true" />
        </div>
      </section>
      <section class="card">
        <div class="card-head">
          <div class="card-title">已收纳窗口</div>
        </div>

        <div v-if="!items.length" class="empty">暂无收纳窗口</div>

        <div v-for="it in items" :key="it.hwnd" class="stash-item">
          <div class="stash-left">
            <div class="name">
              <PencilLine :size="13"></PencilLine>
              <input
                class="text alias"
                type="text"
                :value="itemAliasDrafts[it.hwnd] ?? ''"
                :placeholder="it.title"
                @input="onAliasInput(it.hwnd, ($event.target as HTMLInputElement).value)"
                @change="applyAlias(it.hwnd)"
                @keydown.enter.prevent="($event.target as HTMLInputElement).blur()"
              />
              <!-- {{ it.handleAlias?.trim() ? it.handleAlias : it.title || it.hwnd }} -->
            </div>
            <div class="meta">
              <span>贴边：{{ edgeLabel(it.edge) }}</span>
              <span v-if="it.handleAlias?.trim() && it.title?.trim()">
                · 原标题：{{ it.title }}</span
              >
            </div>
          </div>

          <div class="stash-controls">
            <a-popover
              trigger="click"
              placement="bottom"
              :open="itemColorMenus[it.hwnd]"
              @update:open="
                (open) => {
                  itemColorMenus[it.hwnd] = open
                  onItemColorMenuChange(it, open)
                }
              "
            >
              <template #content>
                <div class="color-pop">
                  <div class="color-palette">
                    <button
                      v-for="c in PRESET_COLORS"
                      :key="c"
                      class="palette-swatch"
                      type="button"
                      :style="{ backgroundColor: c }"
                      :title="c"
                      @click="itemColorDrafts[it.hwnd] = c"
                    />
                  </div>
                  <a-input
                    v-model:value="itemColorDrafts[it.hwnd]"
                    size="small"
                    placeholder="#RRGGBB / #RRGGBBAA"
                  />
                  <div class="color-actions">
                    <a-button type="text" size="small" @click="clearItemColor(it.hwnd)"
                      >跟随</a-button
                    >
                    <a-button type="text" size="small" @click="cancelItemColor(it.hwnd)"
                      >取消</a-button
                    >
                    <a-button type="primary" size="small" @click="applyItemColor(it.hwnd)"
                      >应用</a-button
                    >
                  </div>
                </div>
              </template>
              <button
                class="color-btn only"
                type="button"
                :style="{
                  backgroundColor: it.handleColor?.trim()
                    ? it.handleColor
                    : stashSettings.handleColors[it.edge]
                }"
                :title="it.handleColor?.trim() ? `独立颜色：${it.handleColor}` : '跟随贴边颜色'"
                aria-label="设置外露标签颜色"
              />
            </a-popover>

            <X :size="18" @click="restore(it.hwnd)"></X>
          </div>
        </div>
      </section>
    </div>

    <!-- <section class="card"></section> -->
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
  /* border: 1px solid rgba(255, 255, 255, 0.08); */
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

.color-btn.only {
  height: 20px;
  width: 20px;
  border-radius: 50%;
}

.color-pop {
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 220px;
}

.color-palette {
  display: grid;
  grid-template-columns: repeat(9, 1fr);
  gap: 6px;
}

.palette-swatch {
  width: 18px;
  height: 18px;
  border-radius: 6px;
  border: 1px solid rgba(0, 0, 0, 0.25);
  cursor: pointer;
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
  /* text-overflow: ellipsis; */
  white-space: nowrap;
  max-width: 180px;
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

.stash-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.02);
  padding: 10px 12px;
}

.stash-item:hover {
  background: rgba(255, 255, 255, 0.04);
}

.stash-left {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1 1 auto;
}

.stash-controls {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 0 0 auto;
}

.text.alias {
  width: 160px;
  max-width: 160px;
  margin-left: 10px;
}

.btn.restore-btn {
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(0, 0, 0, 0.12);
  color: rgba(59, 130, 246, 0.95);
  border-radius: 10px;
  padding: 8px 12px;
  font-size: 12px;
  font-weight: 900;
  cursor: pointer;
}

.btn.restore-btn:hover {
  background: rgba(255, 255, 255, 0.06);
}
</style>
