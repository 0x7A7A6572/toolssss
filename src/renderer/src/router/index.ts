import { createRouter, createWebHashHistory } from 'vue-router'

const routes = [
  {
    path: '/',
    redirect: '/other-tools'
  },
  {
    path: '/landing',
    name: 'Landing',
    meta: { title: '关于' },
    component: () => import('../views/Landing/LandingView.vue')
  },
  {
    path: '/sticky-notes',
    name: 'StickyNotes',
    meta: { title: '快捷便签' },
    component: () => import('../views/StickyNotes/StickyNotes.vue')
  },
  {
    path: '/eye-protection',
    name: 'EyeProtection',
    meta: { title: '护眼模式' },
    component: () => import('../views/EyeProtection/EyeProtection.vue')
  },
  {
    path: '/other-tools',
    name: 'OtherTools',
    meta: { title: '其他工具' },
    component: () => import('../views/OtherTools/OtherTools.vue')
  },
  {
    path: '/snip-paste',
    name: 'SnipPaste',
    meta: { title: '截图贴图' },
    component: () => import('../views/SnipPaste/SnipPaste.vue')
  },
  {
    path: '/translator',
    name: 'Translator',
    meta: { title: '翻译' },
    component: () => import('../views/Translator/TranslatorView.vue')
  },
  {
    path: '/window-stash',
    name: 'WindowStash',
    meta: { title: '窗口收藏' },
    component: () => import('../views/WindowStash/WindowStashView.vue')
  },
  {
    path: '/scheduled-tasks',
    name: 'ScheduledTasks',
    meta: { title: '计划任务' },
    component: () => import('../views/ScheduledTasks/ScheduledTasks.vue')
  },
  {
    path: '/agents',
    name: 'AgentChat',
    title: '智能助手',
    component: () => import('../views/AgentChat/AgentChatView.vue'),
    meta: { pageClass: 'page-chat' }
  },
  {
    path: '/settings',
    name: 'Settings',
    meta: { title: '全局设置' },
    component: () => import('../views/Settings/SettingsView.vue')
  }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes
})

export default router
