<script setup lang="ts">
import { computed } from 'vue'
import type {
  CustomModuleConfig,
  CustomModuleCachedContent,
  CustomModuleRankingItem,
  CustomModuleLinkItem
} from '@shared/custom-modules'
import { PencilLine, Sparkles, Trash2, ExternalLink } from 'lucide-vue-next'

const props = defineProps<{
  config: CustomModuleConfig
  content: CustomModuleCachedContent | null
  loading: boolean
  errorText: string
}>()

const emit = defineEmits<{
  refresh: []
  edit: []
  delete: []
}>()

const typeLabel = computed(() => {
  if (props.config.type === 'text') return '生成文字'
  if (props.config.type === 'ranking') return '数据排行'
  return '资讯简报'
})

const typeColor = computed(() => {
  if (props.config.type === 'text') return 'rgba(0, 220, 255, 0.85)'
  if (props.config.type === 'ranking') return 'rgba(255, 198, 0, 0.85)'
  return 'rgba(60, 180, 120, 0.85)'
})

function tryParseRankings(rawText: string): CustomModuleRankingItem[] | null {
  try {
    const cleaned = rawText
      .replace(/```json\s*/gi, '')
      .replace(/```\s*/g, '')
      .trim()
    const firstBrace = cleaned.indexOf('{')
    const lastBrace = cleaned.lastIndexOf('}')
    if (firstBrace < 0 || lastBrace <= firstBrace) return null
    const jsonStr = cleaned.slice(firstBrace, lastBrace + 1)
    const data = JSON.parse(jsonStr) as { rankings?: unknown }
    if (!data.rankings || !Array.isArray(data.rankings)) return null
    const rankings: CustomModuleRankingItem[] = []
    for (const item of data.rankings) {
      if (item && typeof item === 'object') {
        const r = item as Record<string, unknown>
        const title = typeof r.title === 'string' ? r.title.trim() : ''
        const items = Array.isArray(r.items)
          ? r.items.filter((i): i is string => typeof i === 'string')
          : []
        if (title && items.length > 0) {
          rankings.push({ title, items })
        }
      }
    }
    return rankings.length > 0 ? rankings : null
  } catch {
    return null
  }
}

function tryParseLinks(rawText: string): CustomModuleLinkItem[] | null {
  try {
    const cleaned = rawText
      .replace(/```json\s*/gi, '')
      .replace(/```\s*/g, '')
      .trim()
    const firstBrace = cleaned.indexOf('{')
    const lastBrace = cleaned.lastIndexOf('}')
    if (firstBrace < 0 || lastBrace <= firstBrace) return null
    const jsonStr = cleaned.slice(firstBrace, lastBrace + 1)
    const data = JSON.parse(jsonStr) as { items?: unknown }
    if (!data.items || !Array.isArray(data.items)) return null
    const items: CustomModuleLinkItem[] = []
    for (const item of data.items) {
      if (item && typeof item === 'object') {
        const r = item as Record<string, unknown>
        const title = typeof r.title === 'string' ? r.title.trim() : ''
        const link = typeof r.link === 'string' ? r.link.trim() : ''
        const description = typeof r.description === 'string' ? r.description.trim() : undefined
        if (title && link) {
          items.push({ title, link, description })
        }
      }
    }
    return items.length > 0 ? items : null
  } catch {
    return null
  }
}

const displayText = computed(() => {
  if (props.content?.text) return props.content.text
  if (props.content?.rawText) return props.content.rawText
  return ''
})

const rankings = computed<CustomModuleRankingItem[] | null>(() => {
  if (props.content?.rankings && props.content.rankings.length > 0) {
    return props.content.rankings
  }
  if (props.content?.rawText) {
    const parsed = tryParseRankings(props.content.rawText)
    if (parsed) return parsed
  }
  return null
})

const linkItems = computed<CustomModuleLinkItem[] | null>(() => {
  if (props.content?.links && props.content.links.length > 0) {
    return props.content.links
  }
  if (props.content?.rawText) {
    const parsed = tryParseLinks(props.content.rawText)
    if (parsed) return parsed
  }
  return null
})

const showPlaceholder = computed(() => {
  return (
    !props.loading && !props.errorText && !displayText.value && !rankings.value && !linkItems.value
  )
})

function openLink(url: string): void {
  if (url.startsWith('http://') || url.startsWith('https://')) {
    window.open(url, '_blank', 'noopener,noreferrer')
  }
}
</script>

<template>
  <section class="card custom-module-card" :class="{ loading, 'has-error': !!errorText }">
    <div class="card-head">
      <div class="card-title-row">
        <span class="card-title">{{ config.name }}</span>
        <span class="type-badge" :style="{ color: typeColor, borderColor: typeColor }">{{
          typeLabel
        }}</span>
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
      <div v-if="loading" class="state-content">
        <div class="streaming-text">生成中...</div>
      </div>
      <div v-else-if="errorText" class="state-content error-text">{{ errorText }}</div>
      <div v-else-if="showPlaceholder" class="state-content placeholder-text">
        点击刷新按钮生成内容
      </div>
      <template v-else-if="config.type === 'text' && displayText">
        <div class="text-content">{{ displayText }}</div>
      </template>
      <template v-else-if="config.type === 'ranking' && rankings">
        <div class="ranking-list">
          <div v-for="(ranking, ri) in rankings" :key="ri" class="ranking-group">
            <div class="ranking-title">{{ ranking.title }}</div>
            <div class="ranking-items">
              <div v-for="(item, ii) in ranking.items" :key="ii" class="ranking-item">
                <span class="ranking-index">{{ ii + 1 }}</span>
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
      <template v-else-if="displayText">
        <div class="text-content">{{ displayText }}</div>
      </template>
    </div>
  </section>
</template>

<style scoped>
.card {
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.04);
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  position: relative;
  z-index: 1;
  width: min(360px, 100%);
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
  font-size: 11px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 4px;
  border: 1px solid;
  white-space: nowrap;
  flex-shrink: 0;
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
}

.text-content {
  font-size: 14px;
  font-weight: 600;
  color: rgba(235, 235, 245, 0.92);
  white-space: pre-wrap;
  line-height: 1.4;
  max-height: 140px;
  overflow-y: auto;
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.text-content::-webkit-scrollbar {
  width: 0;
  height: 0;
}

.ranking-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto;
  max-height: 220px;
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
  max-height: 240px;
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
</style>
