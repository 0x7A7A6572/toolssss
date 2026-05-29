<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Check } from 'lucide-vue-next'
import AppSwitch from '../../components/AppSwitch.vue'
import dayjs from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat'

dayjs.extend(customParseFormat)

type ShutdownMode = 'once' | 'daily'
type ShutdownConfig = {
  enabled: boolean
  mode: ShutdownMode
  time: string
  onceDayOffset: 0 | 1
}

const enabled = ref(false)
const mode = ref<ShutdownMode>('once')
const onceDayOffset = ref<0 | 1>(0)
const timeStr = ref('00:00')
const statusMsg = ref('')
const nextAtMs = ref<number | null>(null)

const isLoading = ref(false)
let isSyncing = false

const statusIsError = computed(
  () => statusMsg.value.includes('失败') || statusMsg.value.includes('出错')
)

const isBusy = computed(() => isLoading.value || isSyncing)

const modeItems: Array<{ title: string; value: ShutdownMode }> = [
  { title: '一次性', value: 'once' },
  { title: '每天', value: 'daily' }
]

const dayItems: Array<{ title: string; value: 0 | 1 }> = [
  { title: '今天', value: 0 },
  { title: '明天', value: 1 }
]

function toSelectOptions<T extends string | number>(
  items: Array<{ title: string; value: T }>
): Array<{ label: string; value: T }> {
  return items.map((i) => ({ label: i.title, value: i.value }))
}

const timePickerValue = computed(() => {
  const t = dayjs(timeStr.value, 'HH:mm', true)
  return t.isValid() ? t : null
})

function onTimeChange(v: dayjs.Dayjs | null): void {
  if (!v) return
  timeStr.value = v.format('HH:mm')
}

function formatNextAt(ms: number | null): string {
  if (ms === null) return '—'
  const d = new Date(ms)
  return d.toLocaleString()
}

const nextAtText = computed(() => {
  if (!enabled.value) return '未启用'
  if (nextAtMs.value === null) return '—'
  return formatNextAt(nextAtMs.value)
})

function getErrorMessage(err: unknown): string {
  if (err instanceof Error && typeof err.message === 'string') return err.message
  if (typeof err === 'string') return err
  try {
    return JSON.stringify(err)
  } catch {
    return String(err)
  }
}

async function getState(): Promise<{ config: ShutdownConfig | null; nextAtMs: number | null }> {
  const res = (await window.electron.ipcRenderer.invoke('scheduled-task:shutdown:get')) as {
    config?: unknown
    nextAtMs?: unknown
  }
  const cfg = (res?.config ?? null) as ShutdownConfig | null
  const next = typeof res?.nextAtMs === 'number' ? res.nextAtMs : null
  return { config: cfg, nextAtMs: next }
}

function applyState(state: { config: ShutdownConfig | null; nextAtMs: number | null }): void {
  const cfg = state.config
  if (cfg) {
    enabled.value = Boolean(cfg.enabled)
    mode.value = cfg.mode === 'daily' ? 'daily' : 'once'
    onceDayOffset.value = cfg.onceDayOffset === 1 ? 1 : 0
    timeStr.value = typeof cfg.time === 'string' ? cfg.time : timeStr.value
  }
  nextAtMs.value = state.nextAtMs
}

async function refresh(): Promise<void> {
  if (isLoading.value) return
  isLoading.value = true
  try {
    const state = await getState()
    applyState(state)
  } catch {
    nextAtMs.value = null
  } finally {
    isLoading.value = false
  }
}

async function scheduleShutdown(): Promise<void> {
  if (isSyncing) return
  isSyncing = true
  statusMsg.value = '正在应用...'
  try {
    const res = (await window.electron.ipcRenderer.invoke('scheduled-task:shutdown:set', {
      enabled: enabled.value,
      mode: mode.value,
      onceDayOffset: onceDayOffset.value,
      timeStr: timeStr.value
    })) as { success?: unknown; message?: unknown; config?: unknown; nextAtMs?: unknown }
    const ok = Boolean(res?.success)
    statusMsg.value = ok ? '已生效' : `设置失败：${String(res?.message ?? '未知错误')}`
    const cfg = (res?.config ?? null) as ShutdownConfig | null
    if (cfg) {
      enabled.value = Boolean(cfg.enabled)
      mode.value = cfg.mode === 'daily' ? 'daily' : 'once'
      onceDayOffset.value = cfg.onceDayOffset === 1 ? 1 : 0
      timeStr.value = typeof cfg.time === 'string' ? cfg.time : timeStr.value
    }
    nextAtMs.value = typeof res?.nextAtMs === 'number' ? res.nextAtMs : null
    if (!ok) {
      await refresh()
    }
  } catch (err: unknown) {
    statusMsg.value = `请求出错：${getErrorMessage(err)}`
    await refresh()
  } finally {
    isSyncing = false
  }
}

async function cancelShutdown(): Promise<void> {
  if (isSyncing) return
  isSyncing = true
  statusMsg.value = '正在取消...'
  try {
    const res = (await window.electron.ipcRenderer.invoke('scheduled-task:shutdown:cancel')) as {
      success?: unknown
      message?: unknown
      config?: unknown
      nextAtMs?: unknown
    }
    const ok = Boolean(res?.success)
    statusMsg.value = ok ? '已取消' : `取消失败：${String(res?.message ?? '未知错误')}`
    const cfg = (res?.config ?? null) as ShutdownConfig | null
    if (cfg) {
      enabled.value = Boolean(cfg.enabled)
      mode.value = cfg.mode === 'daily' ? 'daily' : 'once'
      onceDayOffset.value = cfg.onceDayOffset === 1 ? 1 : 0
      timeStr.value = typeof cfg.time === 'string' ? cfg.time : timeStr.value
    }
    nextAtMs.value = typeof res?.nextAtMs === 'number' ? res.nextAtMs : null
    if (!ok) {
      await refresh()
    }
  } catch (err: unknown) {
    statusMsg.value = `请求出错：${getErrorMessage(err)}`
    await refresh()
  } finally {
    isSyncing = false
  }
}

function isSameConfig(a: ShutdownConfig | null, b: ShutdownConfig): boolean {
  if (!a) return false
  return (
    Boolean(a.enabled) === Boolean(b.enabled) &&
    (a.mode === 'daily' ? 'daily' : 'once') === b.mode &&
    (a.onceDayOffset === 1 ? 1 : 0) === b.onceDayOffset &&
    a.time === b.time
  )
}

async function onEnabledChange(checked: boolean): Promise<void> {
  if (isBusy.value) return
  isLoading.value = true
  try {
    const state = await getState()
    const desired: ShutdownConfig = {
      enabled: checked,
      mode: mode.value,
      onceDayOffset: onceDayOffset.value,
      time: timeStr.value
    }

    if (checked) {
      if (isSameConfig(state.config, desired) && typeof state.nextAtMs === 'number') {
        enabled.value = true
        nextAtMs.value = state.nextAtMs
        statusMsg.value = '已启用'
        return
      }
      enabled.value = true
      await scheduleShutdown()
      return
    }

    if (!state.config?.enabled && state.nextAtMs === null) {
      enabled.value = false
      nextAtMs.value = null
      statusMsg.value = '已取消'
      return
    }
    enabled.value = false
    await cancelShutdown()
  } catch {
    await refresh()
  } finally {
    isLoading.value = false
  }
}

onMounted(async () => {
  await refresh().catch(() => null)
})
</script>

<template>
  <div class="page-content">
    <header class="header">
      <div class="flex flex-col">
        <div class="title">定时任务</div>
        <div class="subtitle">管理系统定时任务，例如定时关机等</div>
      </div>
    </header>

    <section class="card">
      <div class="block-title" style="margin-bottom: 16px">
        <span>定时关机</span>
        <AppSwitch
          :model-value="enabled"
          :disabled="isBusy"
          @update:model-value="onEnabledChange"
        />
      </div>
      <div class="task-row">
        <div class="task-label">类型：</div>
        <a-select
          v-model:value="mode"
          :options="toSelectOptions(modeItems)"
          style="max-width: 160px"
        />

        <template v-if="mode === 'once'">
          <div class="task-label">日期：</div>
          <a-select
            v-model:value="onceDayOffset"
            class="select"
            :options="toSelectOptions(dayItems)"
            style="max-width: 120px"
          />
        </template>

        <div class="task-label">时间：</div>
        <a-time-picker
          :value="timePickerValue"
          format="HH:mm"
          :show-now="false"
          style="max-width: 150px"
          @change="onTimeChange"
        />
      </div>
      <div class="hint">下次执行：{{ nextAtText }}</div>
      <div
        v-if="statusMsg"
        class="status-msg"
        :class="{ success: !statusIsError, error: statusIsError }"
      >
        <Check v-if="!statusIsError" :size="14" style="margin-right: 4px" />
        {{ statusMsg }}
      </div>
    </section>
  </div>
</template>

<style scoped>
.page-content {
  display: flex;
  flex-direction: column;
  gap: 20px;
  height: 100%;
  width: 100%;
  max-width: 800px;
  margin: 0 auto;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.title {
  font-size: 24px;
  font-weight: 700;
  color: rgba(255, 255, 245, 0.92);
}

.subtitle {
  font-size: 13px;
  color: var(--ev-c-text-3);
  margin-top: 4px;
}

.card {
  background: rgba(255, 255, 255, 0.03);
  /* border: 1px solid rgba(255, 255, 255, 0.08); */
  border-radius: 12px;
  padding: 20px;
}

.block-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 16px;
  font-weight: 700;
  color: rgba(255, 255, 245, 0.92);
}

.task-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.task-label {
  font-size: 14px;
  color: rgba(235, 235, 245, 0.82);
}

.hint {
  margin-top: 10px;
  font-size: 12px;
  color: var(--ev-c-text-3);
}

.status-msg {
  margin-top: 16px;
  font-size: 13px;
  color: rgba(235, 235, 245, 0.6);
  display: flex;
  align-items: center;
}

.status-msg.success {
  color: rgba(34, 197, 94, 0.9);
}

.status-msg.error {
  color: rgba(239, 68, 68, 0.9);
}
</style>
