<script setup lang="ts">
import type { AppSettings } from '@shared/settings'
import { Languages } from '@renderer/utils/bean'
import { useSettingsForm } from '../composables/useSettingsForm'

const { settings, update } = useSettingsForm()

const translateProviderItems: Array<{
  title: string
  value: AppSettings['translate']['provider']
}> = [
  { title: '百度翻译', value: 'baidu' },
  { title: '必应翻译（Microsoft Translator）', value: 'bing' },
  { title: 'AI 翻译（OpenAI Compatible）', value: 'ai' }
]

const translateSourceItems: Array<{ title: string; value: string }> = [
  { title: '自动识别', value: 'auto' },
  ...Languages
]

const translateTargetItems: Array<{ title: string; value: string }> = [...Languages]

function toSelectOptions<T extends string>(
  items: Array<{ title: string; value: T }>
): Array<{ label: string; value: T }> {
  return items.map((i) => ({ label: i.title, value: i.value }))
}

function onTranslateProviderChange(value: AppSettings['translate']['provider']): void {
  update({ translate: { provider: value } }).catch(() => null)
}

function onTranslateSourceChange(value: string): void {
  update({ translate: { defaultSource: value } }).catch(() => null)
}

function onTranslateTargetChange(value: string): void {
  update({ translate: { defaultTarget: value } }).catch(() => null)
}
</script>

<template>
  <div class="settings-section">
    <div class="section-card">
      <div class="card-head">
        <div class="card-title">翻译服务</div>
      </div>

      <div class="row">
        <div class="label">Provider</div>
        <a-select
          class="select"
          :value="settings.translate.provider"
          :options="toSelectOptions(translateProviderItems)"
          @change="onTranslateProviderChange"
        />
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

      <template v-else-if="settings.translate.provider === 'bing'">
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

      <template v-else>
        <a-alert
          message="使用「AI 服务」配置的 Base URL / Model / API Key 进行翻译。"
          type="info"
          show-icon
        />
      </template>

      <div class="row">
        <div class="label">默认源语言</div>
        <a-select
          class="select"
          :value="settings.translate.defaultSource"
          :options="toSelectOptions(translateSourceItems)"
          @change="onTranslateSourceChange"
        />
      </div>

      <div class="row">
        <div class="label">默认目标语言</div>
        <a-select
          class="select"
          :value="settings.translate.defaultTarget"
          :options="toSelectOptions(translateTargetItems)"
          @change="onTranslateTargetChange"
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
}
</style>
