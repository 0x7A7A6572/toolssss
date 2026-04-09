export type AlarmReason = 'alarm' | 'break'

export interface AppSettings {
  general: {
    minimizeToTray: boolean
    autoStart: boolean
  }
  snip: {
    enabled: boolean
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
    provider: 'openai' | 'gmini' | 'kimi' | 'qwen' | 'custom'
    baseUrl: string
    model: string
    apiKeySet: boolean
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
  windowStash: {
    handleColors: Record<'left' | 'top' | 'right' | 'bottom', string>
    handleOpacity: number
    showHandleTitle: boolean
    showHandleDrag: boolean
    animate: boolean
    durationMs: number
    pinnedBorderColor: string
    pinnedBorderWidth: number
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
  eye: Partial<AppSettings['eye']>
  reminderSeconds: number
  alarm: Partial<AppSettings['alarm']>
  break: Partial<AppSettings['break']>
  windowStash: Partial<AppSettings['windowStash']>
}>

export const DEFAULT_SETTINGS: AppSettings = {
  general: {
    minimizeToTray: false,
    autoStart: false
  },
  snip: {
    enabled: true,
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
    toggleTopmost: 'Ctrl+Alt+T',
    snipStart: 'F1',
    stickerPaste: 'F3',
    stickersToggleHidden: 'Shift+F3',
    stickyNotesPopup: 'Ctrl+Shift+N',
    stashLeft: 'Ctrl+Shift+1',
    stashTop: 'Ctrl+Shift+2',
    stashRight: 'Ctrl+Shift+3',
    stashBottom: 'Ctrl+Shift+4'
  },
  shortcutsEnabled: {
    toggleEye: false,
    translateSelection: true,
    toggleTopmost: true,
    snipStart: true,
    stickerPaste: true,
    stickersToggleHidden: true,
    stickyNotesPopup: false,
    stashLeft: true,
    stashTop: true,
    stashRight: true,
    stashBottom: true
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
    provider: 'openai',
    baseUrl: 'https://api.openai.com',
    model: 'gpt-4o-mini',
    apiKeySet: false
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
    pinnedBorderColor: '#3b83f6db',
    pinnedBorderWidth: 3
  }
}
