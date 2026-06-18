<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ArrowLeftRight, Copy, X } from 'lucide-vue-next'
import { TRANSLATOR_EVENTS } from '@shared/translator'
import { appendTranslationHistory } from '@renderer/utils/translationHistory'
import { useSettingsStore } from '@renderer/state/settings'

import { Languages } from '@renderer/utils/bean'

const sourceItems: Array<{ title: string; value: string }> = [
  { title: '自动', value: 'auto' },
  ...Languages
]

const targetItems: Array<{ title: string; value: string }> = [...Languages]

function toSelectOptions(
  items: Array<{ title: string; value: string }>
): Array<{ label: string; value: string }> {
  return items.map((i) => ({ label: i.title, value: i.value }))
}

const inputText = ref('')
const outputText = ref('')
const loading = ref(false)
const loadingHint = ref(false)
const errorText = ref('')
const source = ref('auto')
const target = ref('zh')
const selectionPending = ref(false)

const settingsStore = useSettingsStore()

let desiredToken = 0
let inFlight = false
let pendingRerun = false
let lastRequest: { text: string; source: string; target: string; recordHistory: boolean } | null =
  null
let autoTranslateTimer: ReturnType<typeof setTimeout> | null = null
let slowHintTimer: ReturnType<typeof setTimeout> | null = null
let ignoreAutoTranslate = false

const outputPlaceholder = computed(() => {
  if (loading.value) return loadingHint.value ? '翻译中…（有点慢）' : '翻译中…'
  return '这里显示翻译结果'
})

async function close(): Promise<void> {
  await window.electron.ipcRenderer.invoke('translator-popup:close')
}

function scheduleTranslate(ms: number, opts: { recordHistory: boolean }): void {
  if (autoTranslateTimer) clearTimeout(autoTranslateTimer)
  autoTranslateTimer = setTimeout(() => {
    requestTranslate(opts).catch(() => null)
  }, ms)
}

async function requestTranslate(opts: { recordHistory: boolean }): Promise<void> {
  const text = inputText.value.trim()
  if (!text) return
  if (selectionPending.value) return

  desiredToken += 1
  lastRequest = {
    text,
    source: source.value,
    target: target.value,
    recordHistory: opts.recordHistory
  }
  if (inFlight) {
    pendingRerun = true
    return
  }
  await runTranslate(desiredToken)
}

async function runTranslate(token: number): Promise<void> {
  const req = lastRequest
  if (!req) return

  inFlight = true
  loading.value = true
  loadingHint.value = false
  errorText.value = ''

  if (slowHintTimer) clearTimeout(slowHintTimer)
  slowHintTimer = setTimeout(() => {
    if (loading.value && token === desiredToken) loadingHint.value = true
  }, 800)

  try {
    const result = (await window.electron.ipcRenderer.invoke(TRANSLATOR_EVENTS.TRANSLATE, {
      text: req.text,
      source: req.source,
      target: req.target
    })) as { text?: unknown }
    if (token !== desiredToken) return
    outputText.value = typeof result?.text === 'string' ? result.text : ''
    if (req.recordHistory && outputText.value.trim()) {
      appendTranslationHistory({
        input: req.text,
        output: outputText.value,
        source: req.source,
        target: req.target
      })
    }
  } catch (e) {
    if (token !== desiredToken) return
    outputText.value = ''
    errorText.value = e instanceof Error ? e.message : '翻译失败'
  } finally {
    if (slowHintTimer) clearTimeout(slowHintTimer)
    slowHintTimer = null
    if (token === desiredToken) loading.value = false
    inFlight = false
  }

  if (pendingRerun && desiredToken !== token) {
    pendingRerun = false
    await runTranslate(desiredToken)
    return
  }
  pendingRerun = false
}

async function swapAndTranslate(): Promise<void> {
  if (loading.value) return
  ignoreAutoTranslate = true
  setTimeout(() => {
    ignoreAutoTranslate = false
  }, 0)

  const a = source.value
  source.value = target.value
  target.value = a

  const out = outputText.value.trim()
  if (out) {
    const oldInput = inputText.value
    inputText.value = outputText.value
    outputText.value = oldInput
  } else {
    outputText.value = ''
  }

  errorText.value = ''
  if (autoTranslateTimer) clearTimeout(autoTranslateTimer)
  await requestTranslate({ recordHistory: true })
}

async function copyResult(): Promise<void> {
  const text = outputText.value
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
    close()
  } catch {
    return
  }
}

function onKeyDown(e: KeyboardEvent): void {
  if (e.key === 'Escape') close().catch(() => null)
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
    if (outputText.value) {
      e.preventDefault()
      copyResult().catch(() => null)
    }
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'enter') {
    e.preventDefault()
    requestTranslate({ recordHistory: true }).catch(() => null)
  }
}

function onOpen(_: unknown, payload: unknown): void {
  ignoreAutoTranslate = true
  setTimeout(() => {
    ignoreAutoTranslate = false
  }, 0)

  const p =
    payload && typeof payload === 'object'
      ? (payload as {
          text?: unknown
          source?: unknown
          target?: unknown
          pendingSelection?: unknown
        })
      : {}
  inputText.value = typeof p.text === 'string' ? p.text : ''
  outputText.value = ''
  errorText.value = ''
  source.value = typeof p.source === 'string' && p.source ? p.source : 'auto'
  target.value = typeof p.target === 'string' && p.target ? p.target : 'zh'
  selectionPending.value = Boolean(p.pendingSelection)
  if (autoTranslateTimer) clearTimeout(autoTranslateTimer)
  if (inputText.value.trim()) requestTranslate({ recordHistory: true }).catch(() => null)
}

let offPopupOpen = (): void => {}

onMounted(() => {
  settingsStore.init().catch(() => null)
  window.addEventListener('keydown', onKeyDown)
  offPopupOpen = window.electron.ipcRenderer.on('translator-popup:open', onOpen)
})

onBeforeUnmount(() => {
  if (autoTranslateTimer) clearTimeout(autoTranslateTimer)
  if (slowHintTimer) clearTimeout(slowHintTimer)
  window.removeEventListener('keydown', onKeyDown)
  offPopupOpen()
})

watch(
  () => inputText.value,
  () => {
    if (ignoreAutoTranslate) return
    if (selectionPending.value) return
    if (!inputText.value.trim()) {
      outputText.value = ''
      errorText.value = ''
      return
    }
    scheduleTranslate(350, { recordHistory: false })
  }
)

watch(
  () => [source.value, target.value] as const,
  () => {
    if (ignoreAutoTranslate) return
    if (selectionPending.value) return
    if (!inputText.value.trim()) return
    requestTranslate({ recordHistory: false }).catch(() => null)
  }
)

watch(
  () => settingsStore.settings.value.translate.provider,
  () => {
    if (selectionPending.value) return
    if (!inputText.value.trim()) return
    requestTranslate({ recordHistory: false }).catch(() => null)
  }
)
</script>

<template>
  <div class="wrap">
    <header class="header">
      <div class="title">快捷翻译</div>
      <div class="title-toolbar">
        <a-select
          v-model:value="source"
          custom-class="text-[12px]"
          :options="toSelectOptions(sourceItems)"
          size="small"
        />
        <!-- <button
          class="swap"
          type="button"
          :disabled="loading || (!inputText.trim() && !outputText.trim())"
          @click="swapAndTranslate"
        > -->
        <ArrowLeftRight :size="12" @click="swapAndTranslate" />
        <!-- </button> -->
        <a-select
          v-model:value="target"
          custom-class="text-[12px]"
          :options="toSelectOptions(targetItems)"
          size="small"
        />
        <!-- <a-button
          size="small"
          type="primary"
          :disabled="loading || !inputText.trim()"
          @click="translate"
        >
          {{ loading ? '翻译中...' : '翻译' }}
        </a-button> -->
      </div>
      <div class="actions">
        <!-- <button class="icon" type="button" :disabled="!outputText" @click="copyResult"> -->
        <Copy :size="12" @click="copyResult" />
        <!-- </button> -->
        <!-- <a-button class="icon" type="button" > -->
        <X :size="12" @click="close" />
        <!-- </a-button> -->
      </div>
    </header>

    <div class="content">
      <div class="panel">
        <div class="panel-title">原文</div>
        <textarea
          v-model="inputText"
          class="textarea"
          :placeholder="
            selectionPending ? '正在获取选中文本…' : '选中文本后按快捷键，或手动粘贴...'
          "
          @keyup.ctrl.enter="requestTranslate({ recordHistory: true })"
        />
        <!-- <div class="panel-foot">
          <div class="spacer" />
        </div> -->
      </div>

      <div class="panel">
        <div class="panel-title">译文</div>
        <textarea :value="outputText" class="textarea" readonly :placeholder="outputPlaceholder" />
      </div>
    </div>
    <div v-if="errorText" class="error">{{ errorText }}</div>
  </div>
</template>

<style lang="scss" scoped>
.wrap {
  width: 100%;
  height: 100vh;
  background: rgba(0, 0, 0, 0.86);
  // border: 1px solid rgba(255, 255, 255, 0.1);
  color: rgba(235, 235, 245, 0.9);
  display: flex;
  flex-direction: column;
}

.header {
  padding: 4px 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  /* -webkit-app-region: drag; */
}

.title {
  flex: auto;
  white-space: nowrap;
  // font-size: 14px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  opacity: 0.9;
  -webkit-app-region: drag;
}

.title-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
}

.actions {
  display: flex;
  gap: 8px;
  -webkit-app-region: no-drag;
}

.content {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  background-color: #1a1a19;
  /* padding: 12px; */
}

.panel {
  position: relative;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  /* border: 1px solid rgba(255, 255, 255, 0.08); */
  // border-radius: 12px;
  background: rgba(255, 255, 255, 0.03);
  padding: 10px;
}

.panel-title {
  position: absolute;
  bottom: 20px;
  left: 20px;
  font-size: 20px;
  font-weight: 800;
  opacity: 0.3;
  color: rgba(126, 126, 132, 0.92);
}

.textarea {
  flex: 1;
  min-height: 0;
  resize: none;
  width: 100%;
  border-radius: 12px;
  padding: 10px 10px;
  // border: 1px solid rgba(255, 255, 255, 0.08);
  // background: rgba(0, 0, 0, 0.35);
  background: transparent;
  color: rgba(235, 235, 245, 0.92);
  outline: none;
  font-size: 13px;
  line-height: 18px;
}

.panel-foot {
  display: flex;
  align-items: center;
  gap: 8px;
}

.error {
  font-size: 12px;
  color: rgba(239, 68, 68, 0.92);
  background-color: rgba(133, 0, 0, 0.548);
  padding: 4px 8px;
  border-radius: 4px;
  position: absolute;
  bottom: 0;
}
</style>
