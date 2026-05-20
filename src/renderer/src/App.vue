<script setup lang="ts">
import { computed } from 'vue'
import { theme } from 'ant-design-vue'
import AlarmView from './views/AlarmView.vue'
import MainView from './views/MainView.vue'
import OverlayView from './views/OverlayView.vue'
import StashHandleView from './views/StashHandleView.vue'
import StickerView from './views/StickerView.vue'
import StickyEditorView from './views/StickyEditorView.vue'
import TranslatorPopupView from './views/TranslatorPopupView.vue'
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
      <AlarmView v-else-if="mode === 'alarm'" />
      <StashHandleView v-else-if="mode === 'stash-handle'" />
      <StickerView v-else-if="mode === 'sticker'" />
      <StickyEditorView v-else-if="mode === 'note-editor'" />
      <TranslatorPopupView v-else-if="mode === 'translator-popup'" />
      <MainView v-else />
    </a-app>
  </a-config-provider>
</template>
