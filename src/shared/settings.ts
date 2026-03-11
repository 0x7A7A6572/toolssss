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
  }
  stickyNotes: {
    saveDir: string
  }
  shortcuts: Record<string, string>
  translate: {
    provider: 'baidu' | 'bing'
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
  }
}

export type SettingsPatch = Partial<{
  general: Partial<AppSettings['general']>
  snip: Partial<AppSettings['snip']>
  stickyNotes: Partial<AppSettings['stickyNotes']>
  shortcuts: Partial<AppSettings['shortcuts']>
  translate: Partial<Omit<AppSettings['translate'], 'baidu' | 'bing'>> & {
    baidu?: Partial<AppSettings['translate']['baidu']>
    bing?: Partial<AppSettings['translate']['bing']>
  }
  eye: Partial<AppSettings['eye']>
  reminderSeconds: number
  alarm: Partial<AppSettings['alarm']>
  break: Partial<AppSettings['break']>
}>

export const DEFAULT_SETTINGS: AppSettings = {
  general: {
    minimizeToTray: false,
    autoStart: false
  },
  snip: {
    enabled: true,
    provider: 'app',
    saveDir: ''
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
    stickyNotesPopup: 'Ctrl+Shift+N'
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
    disableInFullscreen: true
  }
}
