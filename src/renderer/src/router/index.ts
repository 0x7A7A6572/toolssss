import { createRouter, createWebHashHistory } from 'vue-router'
import EyeProtection from '../views/EyeProtection/EyeProtection.vue'
import OtherTools from '../views/OtherTools/OtherTools.vue'
import SettingsView from '../views/Settings/SettingsView.vue'

const routes = [
  {
    path: '/',
    redirect: '/eye-protection'
  },
  {
    path: '/eye-protection',
    name: 'EyeProtection',
    component: EyeProtection
  },
  {
    path: '/other-tools',
    name: 'OtherTools',
    component: OtherTools
  },
  {
    path: '/settings',
    name: 'Settings',
    component: SettingsView
  }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes
})

export default router
