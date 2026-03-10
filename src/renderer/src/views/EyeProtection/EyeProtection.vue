<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { DEFAULT_SETTINGS, type AppSettings, type SettingsPatch } from '@shared/settings'
import { Eye } from 'lucide-vue-next'

const settings = ref<AppSettings>(structuredClone(DEFAULT_SETTINGS))
const saving = ref(false)
const breakNextAt = ref<number | null>(null)
const nowMs = ref(Date.now())
let timer: number | null = null

function formatCountdown(targetAt: number | null, now: number): string {
  if (targetAt === null) return '—'
  const diff = targetAt - now
  if (diff <= 0) return '即将提醒'
  const totalSeconds = Math.ceil(diff / 1000)
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  if (h > 0) return `${h}小时${String(m).padStart(2, '0')}分${String(s).padStart(2, '0')}秒`
  return `${m}分${String(s).padStart(2, '0')}秒`
}

const breakCountdownText = computed(() => {
  if (!settings.value.break.enabled) return '未开启'
  return formatCountdown(breakNextAt.value, nowMs.value)
})

async function refreshBreakStatus(): Promise<void> {
  const result = await window.electron.ipcRenderer.invoke('break:status:get')
  if (result && typeof result === 'object') {
    const nextAt = (result as { nextAt?: unknown }).nextAt
    breakNextAt.value = typeof nextAt === 'number' ? nextAt : null
  }
}

async function refresh(): Promise<void> {
  const result = await window.electron.ipcRenderer.invoke('settings:get')
  settings.value = result as AppSettings
  refreshBreakStatus().catch(() => null)
}

async function update(patch: SettingsPatch): Promise<void> {
  saving.value = true
  try {
    const result = await window.electron.ipcRenderer.invoke('settings:update', patch)
    settings.value = result as AppSettings
    refreshBreakStatus().catch(() => null)
  } finally {
    saving.value = false
  }
}

async function previewBreak(): Promise<void> {
  await window.electron.ipcRenderer.invoke('alarm:preview', { reason: 'break' })
}

const onBreakStatus = (_: unknown, payload: unknown): void => {
  if (!payload || typeof payload !== 'object') return
  const nextAt = (payload as { nextAt?: unknown }).nextAt
  breakNextAt.value = typeof nextAt === 'number' ? nextAt : null
}

onMounted(() => {
  refresh().catch(() => null)
  timer = window.setInterval(() => {
    nowMs.value = Date.now()
  }, 1000)
  refreshBreakStatus().catch(() => null)
  window.electron.ipcRenderer.on('break:status', onBreakStatus)
})

onBeforeUnmount(() => {
  if (timer !== null) {
    window.clearInterval(timer)
    timer = null
  }
  window.electron.ipcRenderer.removeListener('break:status', onBreakStatus)
})
</script>

<template>
  <div class="page-content">
    <header class="header">
      <div class="title">护眼工具</div>
      <div class="subtitle">屏幕护眼遮罩 + 全屏提醒</div>
    </header>

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

    <!-- <section class="card">
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
    </section> -->

    <div class="row-group">
      <section class="card">
        <div class="card-head">
          <div class="card-title">
            <span>定时休息</span>
            <div class="preview-btn" type="button" title="预览" @click="previewBreak">
              <Eye :size="14" />
            </div>
          </div>
          <div class="card-actions">
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
        <div class="row">
          <div class="label">倒计时</div>
          <div class="countdown">{{ breakCountdownText }}</div>
        </div>
        <div class="row">
          <div class="label">全屏不提醒</div>
          <label class="switch">
            <input
              type="checkbox"
              :checked="settings.break.disableInFullscreen"
              @change="
                update({
                  break: { disableInFullscreen: ($event.target as HTMLInputElement).checked }
                })
              "
            />
            <span class="slider" />
          </label>
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

    <footer class="footer">
      <div class="status">{{ saving ? '保存中…' : '已保存' }}</div>
    </footer>
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

.preview-btn {
  padding: 3px 8px;
  border-radius: 3px;
  color: var(--ev-c-text-1);
  cursor: pointer;
  font-size: 12px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  line-height: 0;
}

.preview-btn:hover {
  background: rgba(255, 255, 255, 0.1);
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

.countdown {
  grid-column: 2 / span 2;
  font-size: 12px;
  color: var(--ev-c-text-2);
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
</style>
