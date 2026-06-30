import type { AgentConfig, KnowledgeBaseConfig } from './agents'

export type AlarmReason = 'alarm' | 'break'

/** AI 模型类型标识 */
export type AiModelType = 'llm' | 'vision' | 'multimodal' | 'speech' | 'embedding' | 'reasoning'

/** 模型类型中文标签 */
export const AI_MODEL_TYPE_LABELS: Record<AiModelType, string> = {
  llm: '大语言模型',
  vision: '视觉模型',
  multimodal: '全模态模型',
  speech: '语音模型',
  embedding: '向量模型',
  reasoning: '推理模型'
}

/** 模型类型主题色 */
export const AI_MODEL_TYPE_COLORS: Record<AiModelType, string> = {
  llm: '#3b82f6',
  vision: '#22c55e',
  multimodal: '#a855f7',
  speech: '#f59e0b',
  embedding: '#06b6d4',
  reasoning: '#ec4899'
}

export interface RagRuntimeConfig {
  topK: number
  chunkSize: number
  chunkOverlap: number
}

export interface AppSettings {
  general: {
    minimizeToTray: boolean
    autoStart: boolean
  }
  snip: {
    provider: 'app'
    saveDir: string
    suspendEyeOverlay: boolean
  }
  stickyNotes: {
    saveDir: string
  }
  shortcuts: Record<string, string>
  shortcutsEnabled: Record<string, boolean>
  translate: {
    provider: 'baidu' | 'bing' | 'ai'
    defaultSource: string
    defaultTarget: string
    baidu: {
      baseUrl: string
      appId: string
      secret: string
    }
    bing: {
      baseUrl: string
      key: string
      region: string
    }
  }
  ai: {
    enabled: boolean
    searchMcpCommand: string
  }
  funFact: {
    title: string
    prompt: string
  }
  eye: {
    enabled: boolean
    opacity: number
    color: string
  }
  reminderSeconds: number
  alarm: {
    enabled: boolean
    time: string
    label: string
  }
  break: {
    enabled: boolean
    intervalMinutes: number
    disableInFullscreen: boolean
    closeOnEnd: boolean
  }
  scheduledTasks: {
    shutdown: {
      enabled: boolean
      mode: 'once' | 'daily'
      time: string
      onceDayOffset: 0 | 1
    }
  }
  windowStash: {
    handleColors: Record<'left' | 'top' | 'right' | 'bottom', string>
    handleOpacity: number
    showHandleTitle: boolean
    showHandleDrag: boolean
    animate: boolean
    durationMs: number
    topmostHighlightEnabled: boolean
    topmostBorderColor: string
    topmostBorderWidth: number
  }
  agents: {
    configs: AgentConfig[]
    knowledgeBases: KnowledgeBaseConfig[]
    rag: RagRuntimeConfig
  }
}

export type SettingsPatch = Partial<{
  general: Partial<AppSettings['general']>
  snip: Partial<AppSettings['snip']>
  stickyNotes: Partial<AppSettings['stickyNotes']>
  shortcuts: Partial<AppSettings['shortcuts']>
  shortcutsEnabled: Partial<AppSettings['shortcutsEnabled']>
  translate: Partial<Omit<AppSettings['translate'], 'baidu' | 'bing'>> & {
    baidu?: Partial<AppSettings['translate']['baidu']>
    bing?: Partial<AppSettings['translate']['bing']>
  }
  ai: Partial<AppSettings['ai']>
  funFact: Partial<AppSettings['funFact']>
  eye: Partial<AppSettings['eye']>
  reminderSeconds: number
  alarm: Partial<AppSettings['alarm']>
  break: Partial<AppSettings['break']>
  scheduledTasks: Partial<AppSettings['scheduledTasks']>
  windowStash: Partial<AppSettings['windowStash']>
  agents: Partial<AppSettings['agents']>
}>

export const DEFAULT_SETTINGS: AppSettings = {
  general: {
    minimizeToTray: false,
    autoStart: false
  },
  snip: {
    provider: 'app',
    saveDir: '',
    suspendEyeOverlay: false
  },
  stickyNotes: {
    saveDir: ''
  },
  shortcuts: {
    toggleEye: 'Ctrl+Shift+E',
    translateSelection: 'Ctrl+Shift+T',
    snipStart: 'F1',
    stickerPaste: 'F3',
    stickersToggleHidden: 'Shift+F3',
    stickyNotesPopup: 'Ctrl+Shift+N',
    stashLeft: 'Ctrl+Shift+1',
    stashTop: 'Ctrl+Shift+2',
    stashRight: 'Ctrl+Shift+3',
    stashBottom: 'Ctrl+Shift+4',
    toggleTopmostWindow: 'Ctrl+Alt+T'
  },
  shortcutsEnabled: {
    toggleEye: false,
    translateSelection: true,
    snipStart: true,
    stickerPaste: true,
    stickersToggleHidden: true,
    stickyNotesPopup: false,
    stashLeft: true,
    stashTop: true,
    stashRight: true,
    stashBottom: true,
    toggleTopmostWindow: true
  },
  translate: {
    provider: 'baidu',
    defaultSource: 'auto',
    defaultTarget: 'zh',
    baidu: {
      baseUrl: 'https://fanyi-api.baidu.com',
      appId: '',
      secret: ''
    },
    bing: {
      baseUrl: 'https://api.cognitive.microsofttranslator.com',
      key: '',
      region: ''
    }
  },
  ai: {
    enabled: false,
    searchMcpCommand: 'npx -y mcp-remote https://search.parallel.ai/mcp'
  },
  funFact: {
    title: '每日冷知识',
    prompt:
      '给我一条“{title}”，日期：{ymd}。\n要求：1) 1-3 句；2) 不要列表；3) 不要标题符号；4) 不要输出多余解释。'
  },
  eye: {
    enabled: false,
    opacity: 0.18,
    color: '#FFA046'
  },
  reminderSeconds: 20,
  alarm: {
    enabled: false,
    time: '09:00',
    label: '闹钟'
  },
  break: {
    enabled: false,
    intervalMinutes: 45,
    disableInFullscreen: true,
    closeOnEnd: true
  },
  scheduledTasks: {
    shutdown: {
      enabled: false,
      mode: 'once',
      time: '23:30',
      onceDayOffset: 0
    }
  },
  windowStash: {
    handleColors: {
      left: '#22c55e',
      top: '#f59e0b',
      right: '#3b82f6',
      bottom: '#ef4444'
    },
    handleOpacity: 1,
    showHandleTitle: true,
    showHandleDrag: true,
    animate: true,
    durationMs: 180,
    topmostHighlightEnabled: true,
    topmostBorderColor: '#3b82f6',
    topmostBorderWidth: 3
  },
  agents: {
    configs: [],
    knowledgeBases: [],
    rag: {
      topK: 4,
      chunkSize: 700,
      chunkOverlap: 120
    }
  }
}
