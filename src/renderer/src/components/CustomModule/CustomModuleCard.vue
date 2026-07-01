<script setup lang="ts">
import { computed, ref } from 'vue'
import { MdPreview } from 'md-editor-v3'
import 'md-editor-v3/lib/style.css'
import type {
  CustomModuleConfig,
  CustomModuleCachedContent,
  CustomModuleRankingItem,
  CustomModuleLinkItem,
  CustomModuleChartItem,
  CustomModuleSearchMeta
} from '@shared/custom-modules'
import {
  PencilLine,
  Sparkles,
  Trash2,
  ExternalLink,
  Search,
  Maximize2,
  Minimize2
} from 'lucide-vue-next'
import CustomModuleChartCard from './CustomModuleChartCard.vue'

const props = defineProps<{
  config: CustomModuleConfig
  content: CustomModuleCachedContent | null
  loading: boolean
  errorText: string
  searching?: boolean
  moduleId?: string
}>()

const emit = defineEmits<{
  refresh: []
  edit: []
  delete: []
  expandchange: [value: boolean]
}>()

const expanded = ref(false)
const closing = ref(false)
const cardEl = ref<HTMLElement | null>(null)
const expandPlaceholder = ref(false)
const placeholderSize = ref({ width: 0, height: 0 })

function toggleExpand(): void {
  if (closing.value) return
  if (expanded.value) {
    closing.value = true
    setTimeout(() => {
      expanded.value = false
      closing.value = false
      expandPlaceholder.value = false
      emit('expandchange', false)
    }, 250)
  } else {
    if (cardEl.value) {
      const rect = cardEl.value.getBoundingClientRect()
      placeholderSize.value = { width: rect.width, height: rect.height }
    }
    expandPlaceholder.value = true
    expanded.value = true
    emit('expandchange', true)
  }
}

const typeLabel = computed(() => {
  if (props.config.type === 'text') return '生成文字'
  if (props.config.type === 'ranking') return '数据排行'
  if (props.config.type === 'chart') return '数据图表'
  return '资讯简报'
})

const typeColor = computed(() => {
  if (props.config.type === 'text') return 'rgba(0, 220, 255, 0.85)'
  if (props.config.type === 'ranking') return 'rgba(255, 198, 0, 0.85)'
  if (props.config.type === 'chart') return 'rgba(180, 140, 255, 0.85)'
  return 'rgba(60, 180, 120, 0.85)'
})

const displayText = computed(() => {
  if (props.content?.text) return props.content.text
  if (props.content?.rawText) return props.content.rawText
  return ''
})

function resolveMaxHeight(): string | undefined {
  const mh = props.config.maxHeight
  if (mh === 0 || mh === 'auto') return undefined
  if (typeof mh === 'number' && mh > 0) return `${mh}px`
  return '300px'
}

const cardStyle = computed(() => {
  if (expanded.value) return {}
  const style: Record<string, string> = {}
  const minH = props.config.minHeight
  if (minH && minH > 0) {
    style.minHeight = `${minH}px`
  }
  const maxH = resolveMaxHeight()
  if (maxH) {
    style.maxHeight = maxH
  }
  return style
})

const rankings = computed<CustomModuleRankingItem[] | null>(() => {
  if (props.content?.rankings && props.content.rankings.length > 0) {
    return props.content.rankings
  }
  return null
})

const linkItems = computed<CustomModuleLinkItem[] | null>(() => {
  if (props.content?.links && props.content.links.length > 0) {
    return props.content.links
  }
  return null
})

const chartItems = computed<CustomModuleChartItem[] | null>(() => {
  if (props.content?.charts && props.content.charts.length > 0) {
    return props.content.charts
  }
  return null
})

const showPlaceholder = computed(() => {
  return (
    !props.loading &&
    !props.errorText &&
    !displayText.value &&
    !rankings.value &&
    !linkItems.value &&
    !chartItems.value
  )
})

const searchMeta = computed<CustomModuleSearchMeta | null>(() => {
  if (props.config.webSearch && props.content?.searchMeta) {
    return props.content.searchMeta
  }
  return null
})

const sourceTooltip = computed(() => {
  const meta = searchMeta.value
  if (!meta) return ''
  const count = meta.resultCount
  const sources = meta.sources
  if (sources.length === 0) return `共搜索到 ${count} 条结果`
  const domains = sources.slice(0, 3).join('、')
  if (sources.length > 3) {
    return `共搜索到 ${count} 条结果，来自 ${domains} 等 ${sources.length} 个来源`
  }
  return `共搜索到 ${count} 条结果，来自 ${domains}`
})

function openLink(url: string): void {
  if (url.startsWith('http://') || url.startsWith('https://')) {
    window.open(url, '_blank', 'noopener,noreferrer')
  }
}
</script>

<template>
  <div
    v-if="expandPlaceholder"
    class="card-placeholder"
    :style="{ width: placeholderSize.width + 'px', height: placeholderSize.height + 'px' }"
  />
  <section
    ref="cardEl"
    class="card custom-module-card"
    :style="cardStyle"
    :class="{
      loading,
      'has-error': !!errorText,
      expanded,
      closing
    }"
  >
    <div class="card-head">
      <div class="card-title-row">
        <span class="card-title">{{ config.name }}</span>
        <!-- <span class="type-badge" :style="{ color: typeColor, borderColor: typeColor }">{{
          typeLabel
        }}</span> -->
      </div>
      <div class="card-actions">
        <button
          class="icon-btn"
          type="button"
          :disabled="loading"
          title="刷新"
          @click="emit('refresh')"
        >
          <Sparkles v-if="!loading" :size="14" />
          <div v-else class="mini-spinner" />
        </button>
        <button
          class="icon-btn"
          type="button"
          :disabled="loading"
          title="编辑"
          @click="emit('edit')"
        >
          <PencilLine :size="14" />
        </button>
        <button
          class="icon-btn"
          type="button"
          :disabled="loading"
          title="删除"
          @click="emit('delete')"
        >
          <Trash2 :size="14" />
        </button>
      </div>
    </div>

    <div class="card-body">
      <div v-if="searching" class="state-content">
        <div class="searching-text">
          <Search :size="14" class="searching-icon" />
          联网搜索中...
        </div>
      </div>
      <div v-else-if="loading" class="state-content">
        <div class="streaming-text">生成中...</div>
      </div>
      <div v-else-if="errorText" class="state-content error-text">{{ errorText }}</div>
      <div v-else-if="showPlaceholder" class="state-content placeholder-text">
        点击刷新按钮生成内容
      </div>
      <template v-else-if="config.type === 'text' && displayText">
        <MdPreview
          :model-value="displayText"
          theme="dark"
          class="markdown-content"
          :no-mermaid="true"
          :no-katex="true"
          :no-highlight="false"
        />
      </template>
      <template v-else-if="config.type === 'ranking' && rankings">
        <div class="ranking-list">
          <div v-for="(ranking, ri) in rankings" :key="ri" class="ranking-group">
            <div class="ranking-title">{{ ranking.title }}</div>
            <div class="ranking-items">
              <div v-for="(item, ii) in ranking.items" :key="ii" class="ranking-item">
                <span class="ranking-index" :class="['ranking-color', `ranking-index-${ii + 1}`]">{{
                  ii + 1
                }}</span>
                <span class="ranking-name">{{ item }}</span>
              </div>
            </div>
          </div>
        </div>
      </template>
      <template v-else-if="config.type === 'link' && linkItems">
        <div class="link-list">
          <div
            v-for="(item, ii) in linkItems"
            :key="ii"
            class="link-item"
            role="button"
            tabindex="0"
            @click="openLink(item.link)"
            @keydown.enter.prevent="openLink(item.link)"
          >
            <div class="link-item-main">
              <span class="link-index">{{ ii + 1 }}</span>
              <div class="link-item-text">
                <span class="link-title">{{ item.title }}</span>
                <span v-if="item.description" class="link-desc">{{ item.description }}</span>
              </div>
            </div>
            <ExternalLink :size="14" class="link-icon" />
          </div>
        </div>
      </template>
      <template v-else-if="config.type === 'chart' && chartItems">
        <CustomModuleChartCard :charts="chartItems" />
      </template>
      <template v-else-if="displayText">
        <MdPreview :model-value="displayText" theme="dark" :no-mermaid="true" :no-katex="true" />
      </template>
    </div>

    <div class="card-footer">
      <span v-if="config.webSearch" class="websearch-badge" title="已开启联网搜索">
        <Search :size="11" />
      </span>
      <span v-if="searchMeta" class="source-badge" :title="sourceTooltip">
        {{
          searchMeta.sources.length > 0
            ? `${searchMeta.sources.length}个来源`
            : `${searchMeta.resultCount}条结果`
        }}
      </span>
      <span class="type-badge" :style="{ color: typeColor, borderColor: typeColor }">{{
        typeLabel
      }}</span>
      <button
        class="expand-btn"
        type="button"
        :title="expanded ? '收起' : '展开查看'"
        @click="toggleExpand"
      >
        <Maximize2 v-if="!expanded" :size="13" />
        <Minimize2 v-else :size="13" />
      </button>
    </div>
  </section>

  <div
    v-if="expanded || closing"
    class="expand-backdrop"
    :class="{ 'backdrop-closing': closing }"
    @click="toggleExpand"
  />
</template>

<style lang="scss" scoped>
.card {
  border-radius: 12px;
  background: rgb(39, 39, 39);
  // background: rgba(255, 255, 255, 0.04);
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  position: relative;
  z-index: 1;
  // width: min(360px, 100%);
  min-height: 180px;
  align-self: flex-start;
}

.card.loading {
  opacity: 0.7;
}

.card.has-error {
  border: 1px solid rgba(255, 100, 100, 0.3);
}

.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.card-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.card-title {
  font-size: 14px;
  font-weight: 800;
  color: rgba(235, 235, 245, 0.92);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.type-badge {
  font-size: 9px;
  font-weight: 700;
  padding: 1px 4px;
  border-radius: 4px;
  border: 1px solid;
  white-space: nowrap;
  flex-shrink: 0;
}

.websearch-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 4px;
  background: rgba(60, 130, 255, 0.15);
  color: rgba(60, 130, 255, 0.85);
  flex-shrink: 0;
}

.source-badge {
  font-size: 10px;
  font-weight: 600;
  padding: 1px 5px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.05);
  color: rgba(235, 235, 245, 0.5);
  cursor: help;
  white-space: nowrap;
  flex-shrink: 0;
  transition:
    color 0.12s ease,
    background 0.12s ease;
}

.source-badge:hover {
  color: rgba(235, 235, 245, 0.8);
  background: rgba(255, 255, 255, 0.1);
}

.card-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: none;
  background: transparent;
  color: rgba(235, 235, 245, 0.62);
  border-radius: 6px;
  cursor: pointer;
  padding: 0;
  transition: background 0.12s ease;
}

.icon-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(235, 235, 245, 0.92);
}

.icon-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.card-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
}

:deep(.md-editor-preview) {
  /* padding: 12px; */
  white-space: normal;
}

:deep(.md-editor) {
  background-color: none;
  background: none;

  .default-theme p {
    font-size: 13px !important;
  }
}

.state-content {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  color: rgba(235, 235, 245, 0.62);
}

.error-text {
  color: #ff8a8a;
  white-space: break-spaces;
}

.searching-text {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: rgba(60, 130, 255, 0.85);
}

.searching-icon {
  animation: search-pulse 1.2s ease-in-out infinite;
}

@keyframes search-pulse {
  0%,
  100% {
    opacity: 0.4;
  }
  50% {
    opacity: 1;
  }
}

.ranking-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto;
  /* max-height: 220px; */
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.ranking-list::-webkit-scrollbar {
  width: 0;
  height: 0;
}

.ranking-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ranking-title {
  font-size: 13px;
  font-weight: 700;
  color: rgba(235, 235, 245, 0.85);
  padding-bottom: 4px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.ranking-items {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ranking-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  line-height: 1.4;
}

.ranking-index {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 800;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(235, 235, 245, 0.62);
  flex-shrink: 0;

  &.ranking-index-1 {
    background: rgba(228, 217, 8, 0.736);
  }
  &.ranking-index-2 {
    background: rgba(228, 78, 8, 0.736);
  }
  &.ranking-index-3 {
    background: rgba(8, 206, 228, 0.736);
  }
  /* &.ranking-index-4 {
    background: rgba(8, 228, 37, 0.736);
  } */
}

.ranking-name {
  color: rgba(235, 235, 245, 0.88);
  font-weight: 600;
}

.link-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow-y: auto;
  /* max-height: 240px; */
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.link-list::-webkit-scrollbar {
  width: 0;
  height: 0;
}

.link-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.03);
  cursor: pointer;
  transition: background 0.12s ease;
}

.link-item:hover {
  background: rgba(255, 255, 255, 0.08);
}

.link-item-main {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  min-width: 0;
}

.link-index {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 800;
  background: rgba(60, 180, 120, 0.15);
  color: rgba(60, 180, 120, 0.9);
  flex-shrink: 0;
  margin-top: 1px;
}

.link-item-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.link-title {
  font-size: 13px;
  font-weight: 700;
  color: rgba(235, 235, 245, 0.92);
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.link-desc {
  font-size: 11px;
  font-weight: 500;
  color: rgba(235, 235, 245, 0.55);
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.link-icon {
  flex-shrink: 0;
  color: rgba(235, 235, 245, 0.45);
  transition: color 0.12s ease;
}

.link-item:hover .link-icon {
  color: rgba(235, 235, 245, 0.8);
}

.mini-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.25);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}

.streaming-text::after {
  content: '';
  display: inline-block;
  width: 2px;
  height: 14px;
  margin-left: 4px;
  background: rgba(235, 235, 245, 0.62);
  animation: blink 1s steps(2) infinite;
  vertical-align: text-bottom;
}

@keyframes blink {
  0% {
    opacity: 1;
  }
  50% {
    opacity: 0;
  }
}

.card-footer {
  display: flex;
  align-items: center;
  gap: 6px;
}

.expand-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  color: rgba(235, 235, 245, 0.4);
  border-radius: 6px;
  cursor: pointer;
  padding: 0;
  margin-left: auto;
  transition:
    background 0.15s ease,
    color 0.15s ease;
}

.expand-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(235, 235, 245, 0.85);
}

.expand-backdrop {
  position: fixed;
  inset: 0;
  z-index: 998;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  animation: expand-fade-in 0.2s ease;
}

@keyframes expand-fade-in {
  0% {
    opacity: 0;
  }
  100% {
    opacity: 1;
  }
}

.card.expanded {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 80vw;
  max-height: 80vh;
  height: 83vh;
  z-index: 999;
  background: #2b2b2b;
  // box-shadow: -2px 1px 20px 9px #026fa9;
  border-radius: 14px;
  padding: 20px;
  transition:
    position 0s 0s,
    top 0.3s ease,
    left 0.3s ease,
    transform 0.3s ease,
    width 0.3s ease,
    height 0.3s ease,
    max-height 0.3s ease,
    box-shadow 0.3s ease,
    background 0.3s ease,
    padding 0.3s ease;

  .card-body {
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.1) transparent;

    &::-webkit-scrollbar {
      width: 5px;
    }

    &::-webkit-scrollbar-track {
      background: transparent;
    }

    &::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.1);
      border-radius: 3px;
    }
  }

  .expand-btn {
    color: rgba(235, 235, 245, 0.7);
  }

  .expand-btn:hover {
    background: rgba(255, 255, 255, 0.12);
    color: rgba(235, 235, 245, 0.95);
  }
}

.card.expanded.closing {
  animation: card-collapse 0.25s ease forwards;
  pointer-events: none;
}

@keyframes card-collapse {
  0% {
    transform: translate(-50%, -50%) scale(1);
    opacity: 1;
  }
  100% {
    transform: translate(-50%, -50%) scale(0.88);
    opacity: 0;
  }
}

.expand-backdrop.backdrop-closing {
  animation: backdrop-fade-out 0.25s ease forwards;
}

@keyframes backdrop-fade-out {
  0% {
    opacity: 1;
  }
  100% {
    opacity: 0;
  }
}

.card-placeholder {
  visibility: hidden;
  pointer-events: none;
}
</style>
