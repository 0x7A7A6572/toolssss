export type CustomModuleType = 'text' | 'ranking' | 'link' | 'chart'
export type UpdateFrequency = 'realtime' | 'daily' | 'weekly' | 'monthly'

export interface CustomModuleConfig {
  id: string
  name: string
  type: CustomModuleType
  prompt: string
  createdAt: number
  webSearch?: boolean
  minHeight?: number
  enableMarkdown?: boolean
  updateFrequency?: UpdateFrequency
}

export interface CustomModuleRankingItem {
  title: string
  items: string[]
}

export interface CustomModuleRankingData {
  rankings: CustomModuleRankingItem[]
}

export interface CustomModuleLinkItem {
  title: string
  link: string
  description?: string
}

export interface CustomModuleLinkData {
  items: CustomModuleLinkItem[]
}

export interface CustomModuleChartSeries {
  name: string
  type: 'bar' | 'line' | 'pie'
  data: number[]
  color?: string
}

export interface CustomModuleChartItem {
  title: string
  type: 'bar' | 'line' | 'pie'
  labels: string[]
  series: CustomModuleChartSeries[]
}

export interface CustomModuleChartData {
  charts: CustomModuleChartItem[]
}

export interface CustomModuleSearchMeta {
  resultCount: number
  sources: string[]
}

export interface CustomModuleCachedContent {
  text?: string
  rankings?: CustomModuleRankingItem[]
  links?: CustomModuleLinkItem[]
  charts?: CustomModuleChartItem[]
  rawText?: string
  updatedAt: number
  searchMeta?: CustomModuleSearchMeta
}

export const CUSTOM_MODULES_EVENTS = {
  STREAM: 'ai:custom-module:stream',
  CHUNK: 'ai:custom-module:chunk',
  DONE: 'ai:custom-module:done',
  ERROR: 'ai:custom-module:error',
  CANCEL: 'ai:custom-module:cancel',
  SEARCHING: 'ai:custom-module:searching',
  ENHANCE_PROMPT: 'ai:custom-module:enhance-prompt'
} as const

export const CUSTOM_MODULES_STORAGE_KEY = 'customModules.config'
export const CUSTOM_MODULES_CACHE_KEY = 'customModules.cache'
