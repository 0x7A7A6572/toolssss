import { createRouter, createWebHashHistory } from 'vue-router'
import EyeProtection from '../views/EyeProtection/EyeProtection.vue'
import OtherTools from '../views/OtherTools/OtherTools.vue'

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
  }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes
})

export default router
