<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { ArrowLeftRight, Copy, X } from 'lucide-vue-next'
import { TRANSLATOR_EVENTS } from '@shared/translator'
import { appendTranslationHistory } from '@renderer/utils/translationHistory'

import { Languages } from '@renderer/utils/bean'

const sourceItems: Array<{ title: string; value: string }> = [
  { title: '自动', value: 'auto' },
  ...Languages
]

const targetItems: Array<{ title: string; value: string }> = [...Languages]

const inputText = ref('')
const outputText = ref('')
const loading = ref(false)
const errorText = ref('')
const source = ref('auto')
const target = ref('zh')
const selectionPending = ref(false)

async function close(): Promise<void> {
  await window.electron.ipcRenderer.invoke('translator-popup:close')
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
      appendTranslationHistory({
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

async function swapAndTranslate(): Promise<void> {
  if (loading.value) return

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
  await translate()
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
    translate().catch(() => null)
  }
}

function onOpen(_: unknown, payload: unknown): void {
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
  if (inputText.value.trim()) translate().catch(() => null)
}

onMounted(() => {
  window.addEventListener('keydown', onKeyDown)
  window.electron.ipcRenderer.on('translator-popup:open', onOpen)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown)
  window.electron.ipcRenderer.removeListener('translator-popup:open', onOpen)
})
</script>

<template>
  <div class="wrap">
    <header class="header">
      <div class="title">快捷翻译</div>
      <div class="title-toolbar">
        <v-select
          v-model="source"
          class="select"
          :items="sourceItems"
          item-title="title"
          item-value="value"
        />
        <button
          class="swap"
          type="button"
          :disabled="loading || (!inputText.trim() && !outputText.trim())"
          @click="swapAndTranslate"
        >
          <ArrowLeftRight :size="12" />
        </button>
        <v-select
          v-model="target"
          class="select"
          :items="targetItems"
          item-title="title"
          item-value="value"
        />
        <button
          class="btn"
          type="button"
          :disabled="loading || !inputText.trim()"
          @click="translate"
        >
          {{ loading ? '翻译中...' : '翻译' }}
        </button>
      </div>
      <div class="actions">
        <button class="icon" type="button" :disabled="!outputText" @click="copyResult">
          <Copy :size="12" />
        </button>
        <button class="icon" type="button" @click="close">
          <X :size="12" />
        </button>
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
        />
        <!-- <div class="panel-foot">
          <div class="spacer" />
        </div> -->
      </div>

      <div class="panel">
        <div class="panel-title">译文</div>
        <textarea :value="outputText" class="textarea" readonly placeholder="这里显示翻译结果" />
        <div v-if="errorText" class="error">{{ errorText }}</div>
      </div>
    </div>
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

.v-list-item--density-default.v-list-item--one-line {
  min-height: auto !important;
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
  font-size: 12px;
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

.icon {
  /* height: 20; */
  width: 20px;
  /* border-radius: 10px; */
  /* border: 1px solid rgba(255, 255, 255, 0.1); */
  /* background: rgba(255, 255, 255, 0.03); */
  color: rgba(235, 235, 245, 0.9);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.icon:disabled {
  opacity: 0.5;
  cursor: not-allowed;
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

.select {
  width: 70px;
  flex: none;
}

.swap {
  height: 20px;
  width: 20px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.03);
  color: rgba(235, 235, 245, 0.9);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  opacity: 0.7;
}

.swap:hover {
  background: rgba(255, 255, 255, 0.06);
}

.swap:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.spacer {
  flex: 1;
}

.btn {
  /* height: 32px; */
  white-space: nowrap;
  padding: 0 6px;
  border-radius: 4px;
  /* border: 1px solid rgba(59, 130, 246, 0.45); */
  background: rgba(59, 131, 246, 0.534);
  color: rgba(97, 158, 255, 0.877);
  cursor: pointer;
  font-weight: 800;
  font-size: 12px;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.error {
  font-size: 12px;
  color: rgba(239, 68, 68, 0.92);
}
</style>
