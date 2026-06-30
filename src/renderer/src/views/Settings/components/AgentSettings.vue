<script setup lang="ts">
import AgentSettingsPanel from '@renderer/components/AgentSettingsPanel.vue'
</script>

<template>
  <div class="settings-section">
    <AgentSettingsPanel />
  </div>
</template>

<style lang="scss" scoped>
.settings-section {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
</style>
