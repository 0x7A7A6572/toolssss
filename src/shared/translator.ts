export type TranslateProvider = 'baidu' | 'bing' | 'ai'

export interface TranslateConfig {
  provider: TranslateProvider
  defaultSource: string
  defaultTarget: string
}

export interface TranslatePayload {
  text: string
  source?: string
  target: string
}

export interface TranslateResult {
  text: string
}

export const TRANSLATOR_EVENTS = {
  TRANSLATE: 'translator:translate',
  OPEN_POPUP: 'translator:open-popup'
} as const
