import '@mdi/font/css/materialdesignicons.css'
import './assets/main.css'
import 'ant-design-vue/dist/reset.css'

import { createApp } from 'vue'
import App from './App.vue'
import Antd from 'ant-design-vue'
import { initSettingsStore } from '@renderer/state/settings'

async function bootstrap(): Promise<void> {
  const params = new URLSearchParams(window.location.search)
  const mode = params.get('mode') ?? 'main'

  const app = createApp(App).use(Antd)

  if (mode === 'main') {
    const m = await import('./router')
    app.use(m.default)
  }

  if (mode === 'main' || mode === 'stash-handle') {
    void initSettingsStore()
  }

  app.mount('#app')
}

void bootstrap()
