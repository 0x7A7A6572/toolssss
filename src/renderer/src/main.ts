import '@mdi/font/css/materialdesignicons.css'
import './assets/main.css'
import 'ant-design-vue/dist/reset.css'

import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import Antd from 'ant-design-vue'
import { initSettingsStore } from '@renderer/state/settings'

void initSettingsStore()
createApp(App).use(router).use(Antd).mount('#app')
