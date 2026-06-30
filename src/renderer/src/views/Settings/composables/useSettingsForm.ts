import { ref } from 'vue'
import type { SettingsPatch } from '@shared/settings'
import { useSettingsStore } from '@renderer/state/settings'

export function useSettingsForm() {
  const settingsStore = useSettingsStore()
  const saving = ref(false)

  async function update(patch: SettingsPatch): Promise<void> {
    saving.value = true
    try {
      await settingsStore.update(patch)
    } finally {
      saving.value = false
    }
  }

  return {
    settings: settingsStore.settings,
    update,
    saving
  }
}
