<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { MasonryWall } from '@yeger/vue-masonry-wall'
import { RefreshCw, Trash2, X } from 'lucide-vue-next'
import confirm from '../../utils/confirm'

type SnipSavedItem = {
  name: string
  filePath: string
  thumbUrl: string | null
  mtimeMs: number
  size: number
}

const saved = ref<SnipSavedItem[]>([])
const loadingSaved = ref(false)
const helpOpen = ref(false)

async function refreshSaved(): Promise<void> {
  loadingSaved.value = true
  try {
    const result = await window.electron.ipcRenderer.invoke('snip:saved:list')
    saved.value = Array.isArray(result) ? (result as SnipSavedItem[]) : []
  } finally {
    loadingSaved.value = false
  }
}

async function clearSaved(): Promise<void> {
  const ok = await confirm(
    '将清理截图保存目录中由应用自动保存的截图文件（仅限时间戳命名的图片）。',
    {
      title: '一键清理'
    }
  )
  if (!ok) return
  loadingSaved.value = true
  try {
    await window.electron.ipcRenderer.invoke('snip:saved:clear')
    const result = await window.electron.ipcRenderer.invoke('snip:saved:list')
    saved.value = Array.isArray(result) ? (result as SnipSavedItem[]) : []
  } finally {
    loadingSaved.value = false
  }
}

function revealSaved(item: SnipSavedItem): void {
  window.electron.ipcRenderer.invoke('snip:saved:reveal', item.filePath).catch(() => null)
}

function stickSaved(item: SnipSavedItem): void {
  window.electron.ipcRenderer.invoke('snip:saved:stick', item.filePath).catch(() => null)
}

const onSavedChanged = (): void => {
  refreshSaved().catch(() => null)
}

onMounted(() => {
  refreshSaved().catch(() => null)
  window.electron.ipcRenderer.on('snip:saved:changed', onSavedChanged)
})

onBeforeUnmount(() => {
  window.electron.ipcRenderer.removeListener('snip:saved:changed', onSavedChanged)
})
</script>

<template>
  <div class="page-content">
    <header class="header">
      <div class="header-row">
        <div class="header-left">
          <div class="title">截屏贴图</div>
          <div class="subtitle">开始截图（应用截图） + 剪贴板贴图置顶</div>
        </div>
        <button class="btn help-btn" type="button" @click="helpOpen = true">说明</button>
      </div>
    </header>

    <section class="card">
      <div class="card-head">
        <div class="card-title">截图库</div>
        <div class="card-actions">
          <button
            class="btn icon-btn"
            type="button"
            title="一键清理"
            aria-label="一键清理"
            :disabled="loadingSaved || saved.length === 0"
            @click="clearSaved"
          >
            <Trash2 :size="16" />
          </button>
          <button
            class="btn icon-btn"
            type="button"
            title="刷新"
            aria-label="刷新"
            :disabled="loadingSaved"
            @click="refreshSaved"
          >
            <RefreshCw :size="16" />
          </button>
        </div>
      </div>

      <div v-if="loadingSaved" class="hint">加载中…</div>
      <div v-else-if="saved.length === 0" class="hint">
        暂无截图。点击截图工具条“保存”会自动保存到「截图保存目录」。
      </div>

      <MasonryWall v-else :items="saved" :ssr-columns="1" :column-width="240" :gap="12">
        <template #default="{ item }">
          <div class="shot" role="button" tabindex="0" @click="revealSaved(item)">
            <div v-if="!item.thumbUrl" class="shot-img missing">无法预览</div>
            <img v-else class="shot-img" :src="item.thumbUrl" :alt="item.name" loading="lazy" />
            <button class="pin-btn" type="button" @click.stop="stickSaved(item)">贴图</button>
            <div class="shot-name">{{ item.name }}</div>
          </div>
        </template>
      </MasonryWall>
    </section>

    <div v-if="helpOpen" class="modal-overlay" @click.self="helpOpen = false">
      <div class="modal">
        <div class="modal-head">
          <div class="modal-title">使用说明</div>
          <div
            class="icon-btn modal-close"
            type="button"
            title="关闭"
            aria-label="关闭"
            @click="helpOpen = false"
          >
            <X :size="16" />
          </div>
        </div>

        <div class="modal-body">
          <div class="modal-section">
            <div class="modal-section-title">截屏</div>
            <div class="modal-line">开始截图：快捷键（默认 F1）</div>
            <div class="modal-line">取消截图：任何时刻按 Esc；或点击工具条关闭</div>
            <div class="modal-line">
              使用应用截图（electron-screenshots）完成选区。截图结果在系统剪贴板中。
            </div>
            <div class="modal-line">应用截图中，按 C 复制 HEX；按 Shift + C 复制 RGB</div>
            <div class="modal-line">点击截图工具条“保存”会自动保存到「截图保存目录」</div>
          </div>

          <div class="modal-section">
            <div class="modal-section-title">贴图</div>
            <div class="modal-line">剪贴板贴图：快捷键（默认 F3）</div>
            <div class="modal-line">截图后复制到剪贴板，再按贴图键</div>
            <div class="modal-line">贴图操作：缩放（滚轮 / + -），透明度（Ctrl + 滚轮）</div>
            <div class="modal-line">贴图操作：旋转（1 2），翻转（3 4）</div>
            <div class="modal-line">关闭贴图：Esc / 左键双击</div>
            <div class="modal-line">隐藏/显示所有贴图：默认 Shift + F3</div>
          </div>
        </div>
      </div>
    </div>
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

.header-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.header-left {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.help-btn {
  flex-shrink: 0;
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

.card-actions {
  display: flex;
  align-items: center;
  gap: 8px;
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

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn:hover:enabled {
  background: rgba(255, 255, 255, 0.1);
}

.icon-btn {
  width: 34px;
  height: 34px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.icon-btn :deep(svg) {
  flex-shrink: 0;
}

.shot {
  position: relative;
  width: 100%;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(0, 0, 0, 0.2);
  border-radius: 10px;
  overflow: hidden;
  cursor: pointer;
  text-align: left;
}

.pin-btn {
  position: absolute;
  top: 8px;
  right: 8px;
  padding: 6px 10px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  background: rgba(0, 0, 0, 0.42);
  color: rgba(255, 255, 245, 0.92);
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  opacity: 0;
  transform: translateY(-2px);
  transition:
    opacity 0.12s ease,
    transform 0.12s ease,
    background 0.12s ease;
}

.shot:hover .pin-btn {
  opacity: 1;
  transform: translateY(0);
}

.pin-btn:hover {
  background: rgba(0, 0, 0, 0.58);
}

.shot:hover {
  border-color: rgba(59, 130, 246, 0.45);
}

.shot-img {
  width: 100%;
  height: auto;
  display: block;
}

.shot-img.missing {
  aspect-ratio: 4 / 3;
  display: grid;
  place-items: center;
  color: rgba(235, 235, 245, 0.55);
  font-size: 12px;
}

.shot-name {
  padding: 8px 10px;
  font-size: 12px;
  color: rgba(235, 235, 245, 0.72);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.kv {
  display: grid;
  grid-template-columns: 120px 1fr;
  gap: 10px;
  align-items: start;
}

.k {
  font-size: 13px;
  color: rgba(235, 235, 245, 0.7);
}

.v {
  font-size: 13px;
  color: rgba(235, 235, 245, 0.86);
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.paragraph {
  font-size: 13px;
  color: rgba(235, 235, 245, 0.86);
  line-height: 20px;
}

.hint {
  font-size: 12px;
  color: rgba(235, 235, 245, 0.62);
  line-height: 18px;
}

.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: grid;
  place-items: center;
  z-index: 1000;
}

.modal {
  width: min(760px, calc(100vw - 60px));
  max-height: min(80vh, 820px);
  overflow: hidden;
  border-radius: 14px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(18, 18, 20, 0.96);
  box-shadow: 0 18px 60px rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
}

.modal-head {
  padding: 14px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.modal-title {
  font-size: 14px;
  font-weight: 800;
  color: rgba(255, 255, 245, 0.92);
}

.modal-close {
  border-radius: 999px;
}

.modal-body {
  padding: 16px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.modal-section {
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  padding: 12px 12px;
  background: rgba(255, 255, 255, 0.03);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.modal-section-title {
  font-size: 13px;
  font-weight: 800;
  color: rgba(255, 255, 245, 0.9);
}

.modal-line {
  font-size: 13px;
  color: rgba(235, 235, 245, 0.78);
  line-height: 19px;
}
</style>
