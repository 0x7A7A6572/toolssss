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

async function chooseSnipSaveDir(): Promise<void> {
  const p = await window.electron.ipcRenderer.invoke('snip:saveDir:choose')
  if (typeof p !== 'string' || !p.trim()) return
  update({ snip: { saveDir: p } }).catch(() => null)
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

      <div class="row">
        <div class="label">截图保存目录</div>
        <div class="path-row">
          <input
            class="text path"
            type="text"
            :value="settings.snip.saveDir"
            placeholder="默认：系统图片目录/freamx/screenshots"
            @change="
              update({
                snip: { saveDir: ($event.target as HTMLInputElement).value }
              })
            "
          />
          <button class="btn" type="button" @click="chooseSnipSaveDir">选择…</button>
        </div>
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

      <div class="row">
        <div class="label">划词翻译弹窗</div>
        <ShortcutInput
          :model-value="settings.shortcuts.translateSelection"
          placeholder="未设置"
          @update:model-value="
            update({
              shortcuts: { translateSelection: $event }
            })
          "
        />
      </div>

      <div class="row">
        <div class="label">开始截图</div>
        <ShortcutInput
          :model-value="settings.shortcuts.snipStart"
          placeholder="未设置"
          @update:model-value="
            update({
              shortcuts: { snipStart: $event }
            })
          "
        />
      </div>

      <div class="row">
        <div class="label">剪贴板贴图</div>
        <ShortcutInput
          :model-value="settings.shortcuts.stickerPaste"
          placeholder="未设置"
          @update:model-value="
            update({
              shortcuts: { stickerPaste: $event }
            })
          "
        />
      </div>

      <div class="row">
        <div class="label">隐藏/显示所有贴图</div>
        <ShortcutInput
          :model-value="settings.shortcuts.stickersToggleHidden"
          placeholder="未设置"
          @update:model-value="
            update({
              shortcuts: { stickersToggleHidden: $event }
            })
          "
        />
      </div>

      <div class="hint">点击上方快捷键进行录制，支持 Ctrl, Alt, Shift, Meta 组合</div>
    </section>

    <section class="card">
      <div class="card-head">
        <div class="card-title">翻译服务</div>
      </div>

      <div class="row">
        <div class="label">Provider</div>
        <select
          class="select"
          :value="settings.translate.provider"
          @change="
            update({
              translate: {
                provider: ($event.target as HTMLSelectElement).value as 'baidu' | 'bing'
              }
            })
          "
        >
          <option value="baidu">百度翻译</option>
          <option value="bing">必应翻译（Microsoft Translator）</option>
        </select>
      </div>

      <template v-if="settings.translate.provider === 'baidu'">
        <div class="row">
          <div class="label">Base URL</div>
          <input
            class="text"
            type="text"
            :value="settings.translate.baidu.baseUrl"
            placeholder="默认：https://fanyi-api.baidu.com"
            @change="
              update({
                translate: { baidu: { baseUrl: ($event.target as HTMLInputElement).value } }
              })
            "
          />
        </div>

        <div class="row">
          <div class="label">App ID</div>
          <input
            class="text"
            type="text"
            :value="settings.translate.baidu.appId"
            placeholder="百度翻译开放平台 appid"
            @change="
              update({
                translate: { baidu: { appId: ($event.target as HTMLInputElement).value } }
              })
            "
          />
        </div>

        <div class="row">
          <div class="label">Secret</div>
          <input
            class="text"
            type="password"
            :value="settings.translate.baidu.secret"
            placeholder="百度翻译开放平台 secret"
            @change="
              update({
                translate: { baidu: { secret: ($event.target as HTMLInputElement).value } }
              })
            "
          />
        </div>
      </template>

      <template v-else>
        <div class="row">
          <div class="label">Base URL</div>
          <input
            class="text"
            type="text"
            :value="settings.translate.bing.baseUrl"
            placeholder="默认：https://api.cognitive.microsofttranslator.com"
            @change="
              update({
                translate: { bing: { baseUrl: ($event.target as HTMLInputElement).value } }
              })
            "
          />
        </div>

        <div class="row">
          <div class="label">Key</div>
          <input
            class="text"
            type="password"
            :value="settings.translate.bing.key"
            placeholder="Microsoft Translator key"
            @change="
              update({
                translate: { bing: { key: ($event.target as HTMLInputElement).value } }
              })
            "
          />
        </div>

        <div class="row">
          <div class="label">Region</div>
          <input
            class="text"
            type="text"
            :value="settings.translate.bing.region"
            placeholder="例如：eastasia / westeurope"
            @change="
              update({
                translate: { bing: { region: ($event.target as HTMLInputElement).value } }
              })
            "
          />
        </div>
      </template>

      <div class="row">
        <div class="label">默认源语言</div>
        <select
          class="select"
          :value="settings.translate.defaultSource"
          @change="
            update({
              translate: { defaultSource: ($event.target as HTMLSelectElement).value }
            })
          "
        >
          <option value="auto">自动识别</option>
          <option value="en">英语</option>
          <option value="zh">中文</option>
          <option value="ja">日语</option>
          <option value="ko">韩语</option>
          <option value="fr">法语</option>
          <option value="de">德语</option>
          <option value="es">西班牙语</option>
          <option value="ru">俄语</option>
        </select>
      </div>

      <div class="row">
        <div class="label">默认目标语言</div>
        <select
          class="select"
          :value="settings.translate.defaultTarget"
          @change="
            update({
              translate: { defaultTarget: ($event.target as HTMLSelectElement).value }
            })
          "
        >
          <option value="zh">中文（简体）</option>
          <option value="en">英语</option>
          <option value="ja">日语</option>
          <option value="ko">韩语</option>
          <option value="fr">法语</option>
          <option value="de">德语</option>
          <option value="es">西班牙语</option>
          <option value="ru">俄语</option>
        </select>
      </div>

      <div class="hint">
        百度翻译接口：/api/trans/vip/translate；必应翻译接口：/translate?api-version=3.0
      </div>
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

.path-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.path {
  width: 360px;
  text-align: left;
}

.btn {
  padding: 7px 10px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 245, 0.92);
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}

.btn:hover {
  background: rgba(255, 255, 255, 0.1);
}

.select {
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
