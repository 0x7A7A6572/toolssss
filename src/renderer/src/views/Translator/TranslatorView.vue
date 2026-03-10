<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ArrowLeftRight, Copy, Wand2 } from 'lucide-vue-next'
import { TRANSLATOR_EVENTS } from '@shared/translator'
import type { AppSettings } from '@shared/settings'
import confirm from '@renderer/utils/confirm'
import {
  appendTranslationHistory,
  clearTranslationHistory,
  getTranslationHistory,
  removeTranslationHistoryItem,
  type TranslationHistoryItem
} from '@renderer/utils/translationHistory'

const inputText = ref('')
const outputText = ref('')
const loading = ref(false)
const errorText = ref('')

const settings = ref<AppSettings | null>(null)

const source = ref('auto')
const target = ref('zh')

const historyItems = ref<TranslationHistoryItem[]>([])

const canTranslate = computed(() => inputText.value.trim().length > 0 && !loading.value)
const missingConfigHint = computed(() => {
  const s = settings.value
  if (!s) return ''
  if (s.translate.provider === 'bing') {
    if (!s.translate.bing.baseUrl.trim()) return '未配置必应翻译 baseUrl，请到「全局设置」完善。'
    if (!s.translate.bing.key) return '未配置必应翻译 key，请到「全局设置」完善。'
    if (!s.translate.bing.region.trim()) return '未配置必应翻译 region，请到「全局设置」完善。'
    return ''
  }
  if (!s.translate.baidu.baseUrl.trim()) return '未配置百度翻译 baseUrl，请到「全局设置」完善。'
  if (!s.translate.baidu.appId.trim()) return '未配置百度翻译 appId，请到「全局设置」完善。'
  if (!s.translate.baidu.secret) return '未配置百度翻译 secret，请到「全局设置」完善。'
  return ''
})

function refreshHistory(): void {
  historyItems.value = getTranslationHistory()
}

function formatTime(ts: number): string {
  try {
    return new Date(ts).toLocaleString()
  } catch {
    return ''
  }
}

function applyHistoryItem(item: TranslationHistoryItem): void {
  inputText.value = item.input
  outputText.value = item.output
  errorText.value = ''
  source.value = item.source || 'auto'
  target.value = item.target || 'zh'
}

async function copyText(text: string): Promise<void> {
  const t = text.trim()
  if (!t) return
  try {
    await navigator.clipboard.writeText(t)
  } catch {
    return
  }
}

async function deleteHistoryItem(id: string): Promise<void> {
  historyItems.value = removeTranslationHistoryItem(id)
}

async function clearHistory(): Promise<void> {
  const ok = await confirm('确定清空翻译历史吗？', { title: '清空历史', confirmText: '清空' })
  if (!ok) return
  clearTranslationHistory()
  refreshHistory()
}

async function refreshSettings(): Promise<void> {
  const s = (await window.electron.ipcRenderer.invoke('settings:get')) as AppSettings
  settings.value = s
  source.value = s.translate?.defaultSource || 'auto'
  target.value = s.translate?.defaultTarget || 'zh'
}

function swapLanguages(): void {
  const a = source.value
  source.value = target.value
  target.value = a
}

async function translate(): Promise<void> {
  const text = inputText.value.trim()
  if (!text) return
  loading.value = true
  errorText.value = ''
  try {
    const result = (await window.electron.ipcRenderer.invoke(TRANSLATOR_EVENTS.TRANSLATE, {
      text,
      source: source.value,
      target: target.value
    })) as { text?: unknown }
    outputText.value = typeof result?.text === 'string' ? result.text : ''
    if (outputText.value.trim()) {
      historyItems.value = appendTranslationHistory({
        input: text,
        output: outputText.value,
        source: source.value,
        target: target.value
      })
    }
  } catch (e) {
    outputText.value = ''
    errorText.value = e instanceof Error ? e.message : '翻译失败'
  } finally {
    loading.value = false
  }
}

async function copyResult(): Promise<void> {
  const text = outputText.value
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    return
  }
}

onMounted(() => {
  refreshSettings().catch(() => null)
  refreshHistory()
  window.electron.ipcRenderer.on('settings:changed', (_: unknown, s: unknown) => {
    settings.value = s as AppSettings
  })
})
</script>

<template>
  <div class="page-content">
    <header class="header">
      <div class="title">快捷翻译</div>
      <div class="subtitle">手动输入翻译 + 全局划词快捷键</div>
    </header>

    <section class="card">
      <div class="row">
        <div class="label">源语言</div>
        <select v-model="source" class="select">
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

        <button class="swap" type="button" @click="swapLanguages">
          <ArrowLeftRight :size="16" />
        </button>

        <div class="label">目标语言</div>
        <select v-model="target" class="select">
          <option value="zh">中文（简体）</option>
          <option value="en">英语</option>
          <option value="ja">日语</option>
          <option value="ko">韩语</option>
          <option value="fr">法语</option>
          <option value="de">德语</option>
          <option value="es">西班牙语</option>
          <option value="ru">俄语</option>
        </select>

        <div class="spacer" />

        <button class="btn primary" type="button" :disabled="!canTranslate" @click="translate">
          <Wand2 :size="16" />
          {{ loading ? '翻译中...' : '翻译' }}
        </button>
      </div>
    </section>

    <section class="grid">
      <div class="panel">
        <div class="panel-head">
          <div class="panel-title">输入文本</div>
        </div>
        <textarea v-model="inputText" class="textarea" placeholder="输入要翻译的文本..." />
      </div>

      <div class="panel">
        <div class="panel-head">
          <div class="panel-title">翻译结果</div>
          <button class="icon-btn" type="button" :disabled="!outputText" @click="copyResult">
            <Copy :size="16" />
          </button>
        </div>
        <textarea :value="outputText" class="textarea" readonly placeholder="这里显示翻译结果" />
        <div v-if="errorText" class="error">{{ errorText }}</div>
        <div v-else-if="missingConfigHint" class="hint">{{ missingConfigHint }}</div>
      </div>
    </section>

    <section class="history">
      <div class="history-head">
        <div class="history-title">历史记录</div>
        <div class="history-actions">
          <button
            class="btn"
            type="button"
            :disabled="historyItems.length === 0"
            @click="clearHistory"
          >
            清空
          </button>
        </div>
      </div>

      <div v-if="historyItems.length === 0" class="hint">暂无历史记录</div>
      <div v-else class="history-list">
        <div v-for="item in historyItems" :key="item.id" class="history-item">
          <div class="history-meta">
            <div class="history-time">{{ formatTime(item.createdAt) }}</div>
            <div class="history-lang">{{ item.source || 'auto' }} → {{ item.target }}</div>
            <div class="spacer" />
            <button class="mini-btn" type="button" @click="applyHistoryItem(item)">应用</button>
            <button class="mini-btn" type="button" @click="copyText(item.output)">复制</button>
            <button class="mini-btn danger" type="button" @click="deleteHistoryItem(item.id)">
              删除
            </button>
          </div>
          <div class="history-text">
            <div class="history-label">原文</div>
            <div class="history-content">{{ item.input }}</div>
            <div class="history-label">译文</div>
            <div class="history-content">{{ item.output }}</div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.page-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
  /* height: 100%; */
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
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.label {
  font-size: 13px;
  color: rgba(235, 235, 245, 0.62);
}

.select {
  height: 34px;
  padding: 0 10px;
}

.swap {
  height: 34px;
  width: 34px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.03);
  color: rgba(235, 235, 245, 0.88);
  cursor: pointer;
}

.swap:hover {
  background: rgba(255, 255, 255, 0.06);
}

.spacer {
  flex: 1;
}

.btn {
  height: 34px;
  padding: 0 12px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.03);
  color: rgba(235, 235, 245, 0.88);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-weight: 700;
  font-size: 13px;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn.primary {
  border-color: rgba(59, 130, 246, 0.5);
  background: rgba(59, 130, 246, 0.12);
}

.grid {
  flex: 1;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  min-height: 0;
}

.panel {
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.04);
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 300px;
}

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.panel-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--ev-c-text-1);
}

.icon-btn {
  height: 30px;
  width: 30px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.03);
  color: rgba(235, 235, 245, 0.88);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.icon-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.textarea {
  flex: 1;
  min-height: 0;
  resize: none;
  width: 100%;
  border-radius: 12px;
  padding: 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(0, 0, 0, 0.2);
  color: rgba(235, 235, 245, 0.88);
  outline: none;
  font-size: 23px;
  /* line-height: 18px; */
  font-weight: bold;
  font-family: 'Noto Sans SC', sans-serif;
}

.textarea:focus {
  border-color: rgba(59, 130, 246, 0.45);
}

.error {
  font-size: 12px;
  color: rgba(239, 68, 68, 0.92);
}

.hint {
  font-size: 12px;
  color: rgba(235, 235, 245, 0.62);
}

.history {
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.04);
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  user-select: text;
}

.history-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.history-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--ev-c-text-1);
}

.history-actions {
  display: flex;
  gap: 8px;
}

.history-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.history-item {
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  background: rgba(0, 0, 0, 0.15);
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.history-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.history-time {
  font-size: 12px;
  color: rgba(235, 235, 245, 0.62);
}

.history-lang {
  font-size: 12px;
  color: rgba(235, 235, 245, 0.72);
  font-weight: 700;
}

.mini-btn {
  height: 28px;
  padding: 0 10px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.03);
  color: rgba(235, 235, 245, 0.88);
  cursor: pointer;
  font-weight: 700;
  font-size: 12px;
}

.mini-btn:hover {
  background: rgba(255, 255, 255, 0.06);
}

.mini-btn.danger {
  border-color: rgba(239, 68, 68, 0.35);
  background: rgba(239, 68, 68, 0.08);
}

.history-text {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.history-label {
  font-size: 12px;
  color: rgba(235, 235, 245, 0.62);
}

.history-content {
  white-space: pre-wrap;
  word-break: break-word;
  padding: 10px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(0, 0, 0, 0.18);
  color: rgba(235, 235, 245, 0.9);
  font-size: 13px;
  line-height: 18px;
}
</style>
