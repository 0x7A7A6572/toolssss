<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { DEFAULT_SETTINGS, type AppSettings, type SettingsPatch } from '@shared/settings'
import ShortcutInput from '../../components/ShortcutInput.vue'

const settings = ref<AppSettings>(structuredClone(DEFAULT_SETTINGS))
const saving = ref(false)

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
  window.electron.ipcRenderer.on('settings:changed', (_: unknown, s: unknown) => {
    settings.value = s as AppSettings
  })
})
</script>

<template>
  <div class="page-content">
    <header class="header">
      <div class="title">全局设置</div>
      <div class="subtitle">应用行为与快捷键配置</div>
    </header>

    <section class="card">
      <div class="card-head">
        <div class="card-title">系统行为</div>
      </div>

      <div class="row">
        <div class="label">开机自启</div>
        <label class="switch">
          <input
            type="checkbox"
            :checked="settings.general.autoStart"
            @change="
              update({
                general: { autoStart: ($event.target as HTMLInputElement).checked }
              })
            "
          />
          <span class="slider" />
        </label>
      </div>

      <div class="row">
        <div class="label">关闭时最小化到托盘</div>
        <label class="switch">
          <input
            type="checkbox"
            :checked="settings.general.minimizeToTray"
            @change="
              update({
                general: { minimizeToTray: ($event.target as HTMLInputElement).checked }
              })
            "
          />
          <span class="slider" />
        </label>
      </div>
    </section>

    <section class="card">
      <div class="card-head">
        <div class="card-title">全局快捷键</div>
      </div>

      <div class="row">
        <div class="label">开启/关闭护眼模式</div>
        <ShortcutInput
          :model-value="settings.shortcuts.toggleEye"
          placeholder="未设置"
          @update:model-value="
            update({
              shortcuts: { toggleEye: $event }
            })
          "
        />
      </div>

      <div class="row">
        <div class="label">开启/关闭闹钟提醒</div>
        <ShortcutInput
          :model-value="settings.shortcuts.toggleAlarm"
          placeholder="未设置"
          @update:model-value="
            update({
              shortcuts: { toggleAlarm: $event }
            })
          "
        />
      </div>

      <div class="hint">点击上方快捷键进行录制，支持 Ctrl, Alt, Shift, Meta 组合</div>
    </section>

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
  height: 100%;
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
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 32px;
}

.label {
  font-size: 13px;
  color: var(--ev-c-text-2);
  flex: 1;
}

.switch {
  position: relative;
  display: inline-block;
  width: 46px;
  height: 26px;
  flex-shrink: 0;
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

.text {
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

.text:focus {
  border-color: rgba(59, 130, 246, 0.5);
}

.hint {
  font-size: 12px;
  color: var(--ev-c-text-3);
  margin-top: -4px;
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
