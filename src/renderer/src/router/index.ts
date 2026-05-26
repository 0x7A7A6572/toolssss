import { createRouter, createWebHashHistory } from 'vue-router'

const routes = [
  {
    path: '/',
    redirect: '/other-tools'
  },
  {
    path: '/landing',
    name: 'Landing',
    component: () => import('../views/Landing/LandingView.vue')
  },
  {
    path: '/sticky-notes',
    name: 'StickyNotes',
    component: () => import('../views/StickyNotes/StickyNotes.vue')
  },
  {
    path: '/eye-protection',
    name: 'EyeProtection',
    component: () => import('../views/EyeProtection/EyeProtection.vue')
  },
  {
    path: '/other-tools',
    name: 'OtherTools',
    component: () => import('../views/OtherTools/OtherTools.vue')
  },
  {
    path: '/snip-paste',
    name: 'SnipPaste',
    component: () => import('../views/SnipPaste/SnipPaste.vue')
  },
  {
    path: '/translator',
    name: 'Translator',
    component: () => import('../views/Translator/TranslatorView.vue')
  },
  {
    path: '/window-stash',
    name: 'WindowStash',
    component: () => import('../views/WindowStash/WindowStashView.vue')
  },
  {
    path: '/scheduled-tasks',
    name: 'ScheduledTasks',
    component: () => import('../views/ScheduledTasks/ScheduledTasks.vue')
  },
  {
    path: '/settings',
    name: 'Settings',
    component: () => import('../views/Settings/SettingsView.vue')
  }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes
})

export default router
