import '@mdi/font/css/materialdesignicons.css'
import './assets/main.css'
import 'ant-design-vue/dist/reset.css'

import { createApp } from 'vue'
import App from './App.vue'
import Antd from 'ant-design-vue'
import AntDesignX from 'ant-design-x-vue'
import { initSettingsStore } from '@renderer/state/settings'

async function bootstrap(): Promise<void> {
  const params = new URLSearchParams(window.location.search)
  const mode = params.get('mode') ?? 'main'

  const soundUrls = {
    confirm: new URL('./assets/wav/confirm.wav', import.meta.url).href,
    cancel: new URL('./assets/wav/cancel.wav', import.meta.url).href
  } as const
  let lastPlayedAtMs = 0
  const playSound = (kind: 'confirm' | 'cancel'): void => {
    const now = Date.now()
    if (now - lastPlayedAtMs < 80) return
    lastPlayedAtMs = now
    const url = soundUrls[kind]
    const audio = new Audio(url)
    audio.volume = 1
    audio.play().catch(() => null)
  }

  const app = createApp(App).use(Antd).use(AntDesignX)

  if (mode === 'main') {
    const m = await import('./router')
    app.use(m.default)
  }

  if (mode === 'main' || mode === 'stash-handle') {
    void initSettingsStore()
  }

  if (mode === 'main') {
    type TopmostAudioPayload = { kind?: unknown }
    type IpcRendererLike = {
      on: (channel: string, listener: (event: unknown, payload: unknown) => void) => void
    }
    type ElectronApiLike = { ipcRenderer: IpcRendererLike }
    const electron = (window as unknown as { electron?: ElectronApiLike }).electron
    electron?.ipcRenderer?.on('topmost:audio', (_event: unknown, payload: unknown) => {
      const kind =
        payload &&
        typeof payload === 'object' &&
        typeof (payload as TopmostAudioPayload).kind === 'string'
          ? ((payload as TopmostAudioPayload).kind as string)
          : typeof payload === 'string'
            ? payload
            : ''
      if (kind === 'confirm' || kind === 'cancel') playSound(kind)
    })
  }

  app.mount('#app')
}

void bootstrap()
