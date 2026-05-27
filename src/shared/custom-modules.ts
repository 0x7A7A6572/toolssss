export type CustomModuleType = 'text' | 'ranking' | 'link'

export interface CustomModuleConfig {
  id: string
  name: string
  type: CustomModuleType
  prompt: string
  createdAt: number
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

export interface CustomModuleCachedContent {
  text?: string
  rankings?: CustomModuleRankingItem[]
  links?: CustomModuleLinkItem[]
  rawText?: string
  updatedAt: number
}

export const CUSTOM_MODULES_EVENTS = {
  STREAM: 'ai:custom-module:stream',
  CHUNK: 'ai:custom-module:chunk',
  DONE: 'ai:custom-module:done',
  ERROR: 'ai:custom-module:error',
  CANCEL: 'ai:custom-module:cancel'
} as const

export const CUSTOM_MODULES_STORAGE_KEY = 'customModules.config'
export const CUSTOM_MODULES_CACHE_KEY = 'customModules.cache'
