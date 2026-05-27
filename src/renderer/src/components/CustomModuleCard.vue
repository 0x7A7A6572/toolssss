<script setup lang="ts">
import { computed, ref } from 'vue'
import { marked } from 'marked'
import type {
  CustomModuleConfig,
  CustomModuleCachedContent,
  CustomModuleRankingItem,
  CustomModuleLinkItem,
  CustomModuleSearchMeta
} from '@shared/custom-modules'
import { PencilLine, Sparkles, Trash2, ExternalLink, Search, Maximize2, X } from 'lucide-vue-next'

const props = defineProps<{
  config: CustomModuleConfig
  content: CustomModuleCachedContent | null
  loading: boolean
  errorText: string
  searching?: boolean
}>()

const emit = defineEmits<{
  refresh: []
  edit: []
  delete: []
}>()

const expanded = ref(false)

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
  const cleaned = rawText
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim()

  try {
    const firstBrace = cleaned.indexOf('{')
    const lastBrace = cleaned.lastIndexOf('}')
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      const jsonStr = cleaned.slice(firstBrace, lastBrace + 1)
      const data = JSON.parse(jsonStr) as { rankings?: unknown }
      if (data.rankings && Array.isArray(data.rankings)) {
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
        if (rankings.length > 0) return rankings
      }
    }
  } catch {
    // full parse failed — fall through
  }

  const extracted: CustomModuleRankingItem[] = []
  let idx = 0
  while (idx < cleaned.length) {
    const objStart = cleaned.indexOf('{', idx)
    if (objStart < 0) break
    let depth = 0
    let objEnd = -1
    for (let i = objStart; i < cleaned.length; i++) {
      if (cleaned[i] === '{') depth++
      else if (cleaned[i] === '}') {
        depth--
        if (depth === 0) {
          objEnd = i
          break
        }
      }
    }
    if (objEnd < 0) break
    try {
      const obj = JSON.parse(cleaned.slice(objStart, objEnd + 1)) as Record<string, unknown>
      const title = typeof obj.title === 'string' ? obj.title.trim() : ''
      const items = Array.isArray(obj.items)
        ? obj.items.filter((i): i is string => typeof i === 'string')
        : []
      if (title && items.length > 0) extracted.push({ title, items })
    } catch {
      /* skip */
    }
    idx = objEnd + 1
  }
  return extracted.length > 0 ? extracted : null
}

function tryParseLinks(rawText: string): CustomModuleLinkItem[] | null {
  const cleaned = rawText
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim()

  try {
    const firstBrace = cleaned.indexOf('{')
    const lastBrace = cleaned.lastIndexOf('}')
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      const jsonStr = cleaned.slice(firstBrace, lastBrace + 1)
      const data = JSON.parse(jsonStr) as { items?: unknown }
      if (data.items && Array.isArray(data.items)) {
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
        if (items.length > 0) return items
      }
    }
  } catch {
    // full parse failed — fall through
  }

  const extracted: CustomModuleLinkItem[] = []
  let idx = 0
  while (idx < cleaned.length) {
    const objStart = cleaned.indexOf('{', idx)
    if (objStart < 0) break
    let depth = 0
    let objEnd = -1
    for (let i = objStart; i < cleaned.length; i++) {
      if (cleaned[i] === '{') depth++
      else if (cleaned[i] === '}') {
        depth--
        if (depth === 0) {
          objEnd = i
          break
        }
      }
    }
    if (objEnd < 0) break
    try {
      const obj = JSON.parse(cleaned.slice(objStart, objEnd + 1)) as Record<string, unknown>
      const title = typeof obj.title === 'string' ? obj.title.trim() : ''
      const link = typeof obj.link === 'string' ? obj.link.trim() : ''
      const description = typeof obj.description === 'string' ? obj.description.trim() : undefined
      if (title && link) extracted.push({ title, link, description })
    } catch {
      /* skip */
    }
    idx = objEnd + 1
  }
  return extracted.length > 0 ? extracted : null
}

const displayText = computed(() => {
  if (props.content?.text) return props.content.text
  if (props.content?.rawText) return props.content.rawText
  return ''
})

const cardStyle = computed(() => {
  const h = props.config.minHeight
  if (h && h > 0) {
    return { minHeight: `${h}px` }
  }
  return {}
})

const renderedMarkdown = computed(() => {
  if (props.config.enableMarkdown && displayText.value) {
    return marked.parse(displayText.value, { breaks: true })
  }
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
  <section
    class="card custom-module-card"
    :style="cardStyle"
    :class="{ loading, 'has-error': !!errorText }"
  >
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
        <div v-if="config.enableMarkdown" class="markdown-content" v-html="renderedMarkdown" />
        <div v-else class="text-content">{{ displayText }}</div>
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
        <pre class="text-content">{{ displayText }}</pre>
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
      <button class="expand-btn" type="button" title="展开查看" @click="expanded = true">
        <Maximize2 :size="13" />
      </button>
    </div>
  </section>

  <Teleport to="body">
    <div v-if="expanded" class="expand-overlay" @click.self="expanded = false">
      <div class="expand-container">
        <div class="expand-header">
          <div class="expand-title-row">
            <span class="expand-title">{{ config.name }}</span>
            <span class="type-badge" :style="{ color: typeColor, borderColor: typeColor }">{{
              typeLabel
            }}</span>
          </div>
          <button class="expand-close-btn" type="button" title="关闭" @click="expanded = false">
            <X :size="18" />
          </button>
        </div>
        <div class="expand-body">
          <div v-if="loading" class="state-content">
            <div class="streaming-text">生成中...</div>
          </div>
          <div v-else-if="errorText" class="state-content error-text">{{ errorText }}</div>
          <div v-else-if="showPlaceholder" class="state-content placeholder-text">
            点击刷新按钮生成内容
          </div>
          <template v-else-if="config.type === 'text' && displayText">
            <div v-if="config.enableMarkdown" class="expand-markdown" v-html="renderedMarkdown" />
            <div v-else class="expand-text">{{ displayText }}</div>
          </template>
          <template v-else-if="config.type === 'ranking' && rankings">
            <div class="expand-ranking-list">
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
            <div class="expand-link-list">
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
            <pre class="expand-text">{{ displayText }}</pre>
          </template>
        </div>
        <div class="expand-footer">
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
        </div>
      </div>
    </div>
  </Teleport>
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

.markdown-content {
  font-size: 14px;
  color: rgba(235, 235, 245, 0.92);
  line-height: 1.5;
  max-height: 220px;
  overflow-y: auto;
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.markdown-content::-webkit-scrollbar {
  width: 0;
  height: 0;
}

.markdown-content h1,
.markdown-content h2,
.markdown-content h3,
.markdown-content h4 {
  font-size: 15px;
  font-weight: 800;
  margin: 8px 0 4px;
  color: rgba(235, 235, 245, 0.96);
}

.markdown-content h1 {
  font-size: 16px;
}
.markdown-content h2 {
  font-size: 15px;
}
.markdown-content h3 {
  font-size: 14px;
}

.markdown-content p {
  margin: 4px 0;
}

.markdown-content ul,
.markdown-content ol {
  margin: 4px 0;
  padding-left: 20px;
}

.markdown-content li {
  margin: 2px 0;
}

.markdown-content code {
  font-size: 13px;
  padding: 1px 5px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.08);
  color: rgba(200, 200, 220, 0.95);
}

.markdown-content pre {
  margin: 6px 0;
  padding: 8px 10px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.25);
  overflow-x: auto;
}

.markdown-content pre code {
  background: transparent;
  padding: 0;
}

.markdown-content strong {
  font-weight: 800;
  color: rgba(235, 235, 245, 0.96);
}

.markdown-content a {
  color: rgba(60, 160, 255, 0.9);
  text-decoration: none;
}

.markdown-content a:hover {
  text-decoration: underline;
}

.markdown-content blockquote {
  margin: 6px 0;
  padding: 4px 10px;
  border-left: 3px solid rgba(100, 100, 130, 0.4);
  color: rgba(235, 235, 245, 0.7);
}

.markdown-content hr {
  margin: 8px 0;
  border: none;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
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

.expand-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  animation: expand-fade-in 0.18s ease;
}

@keyframes expand-fade-in {
  0% {
    opacity: 0;
  }
  100% {
    opacity: 1;
  }
}

.expand-container {
  width: min(700px, 90vw);
  max-height: 85vh;
  background: #1c1c24;
  border-radius: 14px;
  display: flex;
  flex-direction: column;
  box-shadow:
    0 24px 80px rgba(0, 0, 0, 0.5),
    0 0 0 1px rgba(255, 255, 255, 0.06);
  animation: expand-scale-in 0.2s cubic-bezier(0.18, 0.89, 0.32, 1.1);
}

@keyframes expand-scale-in {
  0% {
    opacity: 0;
    transform: scale(0.92);
  }
  100% {
    opacity: 1;
    transform: scale(1);
  }
}

.expand-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  flex-shrink: 0;
}

.expand-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.expand-title {
  font-size: 16px;
  font-weight: 800;
  color: rgba(235, 235, 245, 0.95);
}

.expand-close-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  background: rgba(255, 255, 255, 0.05);
  color: rgba(235, 235, 245, 0.62);
  border-radius: 8px;
  cursor: pointer;
  padding: 0;
  transition:
    background 0.15s ease,
    color 0.15s ease;
  flex-shrink: 0;
}

.expand-close-btn:hover {
  background: rgba(255, 255, 255, 0.12);
  color: rgba(235, 235, 245, 0.92);
}

.expand-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px 20px;
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.1) transparent;
}

.expand-body::-webkit-scrollbar {
  width: 5px;
}

.expand-body::-webkit-scrollbar-track {
  background: transparent;
}

.expand-body::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 3px;
}

.expand-text {
  font-size: 15px;
  font-weight: 600;
  color: rgba(235, 235, 245, 0.92);
  white-space: pre-wrap;
  line-height: 1.5;
}

.expand-markdown {
  font-size: 15px;
  color: rgba(235, 235, 245, 0.92);
  line-height: 1.6;
}

.expand-markdown h1,
.expand-markdown h2,
.expand-markdown h3,
.expand-markdown h4 {
  font-size: 16px;
  font-weight: 800;
  margin: 12px 0 6px;
  color: rgba(235, 235, 245, 0.96);
}

.expand-markdown h1 {
  font-size: 18px;
}
.expand-markdown h2 {
  font-size: 17px;
}
.expand-markdown h3 {
  font-size: 16px;
}

.expand-markdown p {
  margin: 6px 0;
}

.expand-markdown ul,
.expand-markdown ol {
  margin: 6px 0;
  padding-left: 22px;
}

.expand-markdown li {
  margin: 3px 0;
}

.expand-markdown code {
  font-size: 14px;
  padding: 2px 6px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.08);
  color: rgba(200, 200, 220, 0.95);
}

.expand-markdown pre {
  margin: 8px 0;
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.3);
  overflow-x: auto;
}

.expand-markdown pre code {
  background: transparent;
  padding: 0;
}

.expand-markdown strong {
  font-weight: 800;
  color: rgba(235, 235, 245, 0.96);
}

.expand-markdown a {
  color: rgba(60, 160, 255, 0.9);
  text-decoration: none;
}

.expand-markdown a:hover {
  text-decoration: underline;
}

.expand-markdown blockquote {
  margin: 8px 0;
  padding: 6px 12px;
  border-left: 3px solid rgba(100, 100, 130, 0.4);
  color: rgba(235, 235, 245, 0.7);
}

.expand-markdown hr {
  margin: 10px 0;
  border: none;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.expand-ranking-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.expand-link-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.expand-footer {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 20px 14px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  flex-shrink: 0;
}
</style>
