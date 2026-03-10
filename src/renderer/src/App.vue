<script setup lang="ts">
import AlarmView from './views/AlarmView.vue'
import MainView from './views/MainView.vue'
import OverlayView from './views/OverlayView.vue'
import StickyEditorView from './views/StickyEditorView.vue'

const params = new URLSearchParams(window.location.search)
const mode = params.get('mode') ?? 'main'
</script>

<template>
  <MainView v-if="mode === 'main'" />
  <OverlayView v-else-if="mode === 'overlay'" />
  <AlarmView v-else-if="mode === 'alarm'" />
  <StickyEditorView v-else-if="mode === 'note-editor'" />
  <MainView v-else />
</template>
