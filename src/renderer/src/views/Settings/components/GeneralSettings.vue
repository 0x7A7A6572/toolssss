<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import AppSwitch from '@renderer/components/AppSwitch.vue'
import { FolderOpen } from 'lucide-vue-next'
import { useSettingsForm } from '../composables/useSettingsForm'

const { settings, update } = useSettingsForm()
const appPaths = ref<{ userData: string; pictures: string } | null>(null)
const isDev = import.meta.env.DEV

const snipPlaceholder = computed(() => {
  const pictures = appPaths.value?.pictures
  if (typeof pictures === 'string' && pictures.trim()) {
    return `默认：${joinPath(joinPath(pictures, 'forge-studio'), 'screenshots')}`
  }
  return '默认：系统图片目录/forge-studio/screenshots'
})

const stickyNotesPlaceholder = computed(() => {
  const userData = appPaths.value?.userData
  if (typeof userData === 'string' && userData.trim()) {
    return `默认：${userData.trim()}`
  }
  return '默认：应用数据目录'
})

function joinPath(base: string, tail: string): string {
  const b = base.trim().replace(/[\\/]+$/, '')
  const t = tail.trim().replace(/^[\\/]+/, '')
  const sep = b.includes('\\') ? '\\' : '/'
  return `${b}${sep}${t}`
}

async function chooseSnipSaveDir(): Promise<void> {
  const p = await window.electron.ipcRenderer.invoke('snip:saveDir:choose')
  if (typeof p !== 'string' || !p.trim()) return
  update({ snip: { saveDir: p } }).catch(() => null)
}

async function chooseStickyNotesSaveDir(): Promise<void> {
  const p = await window.electron.ipcRenderer.invoke('sticky-notes:saveDir:choose')
  if (typeof p !== 'string' || !p.trim()) return
  update({ stickyNotes: { saveDir: p } }).catch(() => null)
}

onMounted(() => {
  window.electron.ipcRenderer
    .invoke('app:paths')
    .then((v: unknown) => {
      if (!v || typeof v !== 'object') return
      const p = v as { userData?: unknown; pictures?: unknown }
      if (typeof p.userData !== 'string' || typeof p.pictures !== 'string') return
      appPaths.value = { userData: p.userData, pictures: p.pictures }
    })
    .catch(() => null)
})
</script>

<template>
  <div class="settings-section">
    <div class="section-card">
      <div class="card-head">
        <div class="card-title">系统行为</div>
      </div>

      <div class="row">
        <div class="label">开机自启</div>
        <AppSwitch
          :model-value="settings.general.autoStart"
          @update:model-value="update({ general: { autoStart: $event } })"
        />
      </div>

      <div class="row">
        <div class="label">关闭时最小化到托盘</div>
        <AppSwitch
          :model-value="settings.general.minimizeToTray"
          @update:model-value="update({ general: { minimizeToTray: $event } })"
        />
      </div>
    </div>

    <div class="section-card">
      <div class="card-head">
        <div class="card-title">文件路径</div>
      </div>

      <div class="row">
        <div class="label">截图保存目录</div>
        <div class="path-row">
          <input
            class="text path"
            type="text"
            :value="settings.snip.saveDir"
            :placeholder="snipPlaceholder"
            @change="
              update({
                snip: { saveDir: ($event.target as HTMLInputElement).value }
              })
            "
          />
          <button
            class="flex px-[6px] py-[4px] rounded-[4px] bg-[#99999933] border-none"
            type="button"
            title="选择目录"
            aria-label="选择目录"
            @click="chooseSnipSaveDir"
          >
            <FolderOpen :size="16" />
          </button>
        </div>
      </div>

      <div class="row">
        <div class="label">便签保存目录</div>
        <div class="path-row">
          <input
            class="text path"
            type="text"
            :value="settings.stickyNotes.saveDir"
            :placeholder="stickyNotesPlaceholder"
            @change="
              update({
                stickyNotes: { saveDir: ($event.target as HTMLInputElement).value }
              })
            "
          />
          <button
            class="flex px-[6px] py-[4px] rounded-[4px] bg-[#99999933] border-none"
            type="button"
            title="选择目录"
            aria-label="选择目录"
            @click="chooseStickyNotesSaveDir"
          >
            <FolderOpen :size="16" />
          </button>
        </div>
      </div>
    </div>

    <div v-if="isDev" class="section-card">
      <div class="card-head">
        <div class="card-title">覆盖窗口</div>
      </div>

      <div class="row">
        <div class="label">
          <div>
            <div>沉浸模式</div>
            <div class="desc">开启后，中键唤出工具面板时以全屏透明覆盖层展示；关闭后以标准窗口展示</div>
          </div>
        </div>
        <AppSwitch
          :model-value="settings.general.immersiveMode"
          @update:model-value="update({ general: { immersiveMode: $event } })"
        />
      </div>
    </div>

    <div class="section-card">
      <div class="card-head">
        <div class="card-title">截图</div>
      </div>

      <div class="row">
        <div class="label">截图时隐藏护眼遮罩</div>
        <AppSwitch
          :model-value="settings.snip.suspendEyeOverlay"
          @update:model-value="update({ snip: { suspendEyeOverlay: $event } })"
        />
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.settings-section {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.section-card {
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.04);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.card-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--ev-c-text-1);
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

  .desc {
    font-size: 11px;
    color: var(--ev-c-text-3, #999);
    margin-top: 2px;
    line-height: 1.5;
  }
}

.path-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.path {
  width: 360px;
  text-align: left;
}
</style>
