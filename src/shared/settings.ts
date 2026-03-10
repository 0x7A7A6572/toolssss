export type AlarmReason = 'alarm' | 'break'

export interface AppSettings {
  eye: {
    enabled: boolean
    opacity: number
  }
  alarm: {
    enabled: boolean
    time: string
    label: string
  }
  break: {
    enabled: boolean
    intervalMinutes: number
  }
}

export type SettingsPatch = Partial<{
  eye: Partial<AppSettings['eye']>
  alarm: Partial<AppSettings['alarm']>
  break: Partial<AppSettings['break']>
}>

export const DEFAULT_SETTINGS: AppSettings = {
  eye: {
    enabled: false,
    opacity: 0.18
  },
  alarm: {
    enabled: false,
    time: '09:00',
    label: '闹钟'
  },
  break: {
    enabled: false,
    intervalMinutes: 45
  }
}
