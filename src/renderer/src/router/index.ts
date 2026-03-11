import { createRouter, createWebHashHistory } from 'vue-router'
import EyeProtection from '../views/EyeProtection/EyeProtection.vue'
import OtherTools from '../views/OtherTools/OtherTools.vue'
import SettingsView from '../views/Settings/SettingsView.vue'
import SnipPaste from '../views/SnipPaste/SnipPaste.vue'
import StickyNotes from '../views/StickyNotes/StickyNotes.vue'
import TranslatorView from '../views/Translator/TranslatorView.vue'

const routes = [
  {
    path: '/',
    redirect: '/other-tools'
  },
  {
    path: '/sticky-notes',
    name: 'StickyNotes',
    component: StickyNotes
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
    path: '/snip-paste',
    name: 'SnipPaste',
    component: SnipPaste
  },
  {
    path: '/translator',
    name: 'Translator',
    component: TranslatorView
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
