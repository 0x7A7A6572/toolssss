<script setup lang="ts">
import { computed, defineAsyncComponent } from 'vue'
import { theme } from 'ant-design-vue'
const AlarmView = defineAsyncComponent(() => import('./views/AlarmView.vue'))
const MainView = defineAsyncComponent(() => import('./views/MainView.vue'))
const OverlayHome = defineAsyncComponent(() => import('./views/OverlayHome/OverlayHome.vue'))
const OverlayView = defineAsyncComponent(() => import('./views/OverlayView.vue'))
const StashHandleView = defineAsyncComponent(() => import('./views/StashHandleView.vue'))
const StickerView = defineAsyncComponent(() => import('./views/StickerView.vue'))
const StickyEditorView = defineAsyncComponent(() => import('./views/StickyEditorView.vue'))
const TranslatorPopupView = defineAsyncComponent(() => import('./views/TranslatorPopupView.vue'))
const params = new URLSearchParams(window.location.search)
const mode = params.get('mode') ?? 'main'

const antdTheme = computed(() => ({
  algorithm: theme.darkAlgorithm
}))
</script>

<template>
  <a-config-provider :theme="antdTheme">
    <a-app>
      <MainView v-if="mode === 'main'" />
      <OverlayView v-else-if="mode === 'overlay'" />
      <OverlayHome v-else-if="mode === 'mouse-hook-overlay'" />
      <AlarmView v-else-if="mode === 'alarm'" />
      <StashHandleView v-else-if="mode === 'stash-handle'" />
      <StickerView v-else-if="mode === 'sticker'" />
      <StickyEditorView v-else-if="mode === 'note-editor'" />
      <TranslatorPopupView v-else-if="mode === 'translator-popup'" />
      <MainView v-else />
    </a-app>
  </a-config-provider>
</template>
