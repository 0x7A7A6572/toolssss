import { isProxy, ref, toRaw } from 'vue'
import { DEFAULT_SETTINGS, type AppSettings, type SettingsPatch } from '@shared/settings'

const settings = ref<AppSettings>(structuredClone(DEFAULT_SETTINGS))
const ready = ref(false)
const syncing = ref(false)

let initialized = false
let initPromise: Promise<void> | null = null

function apply(next: unknown): void {
  if (!next || typeof next !== 'object') return
  settings.value = next as AppSettings
  ready.value = true
}

async function refresh(): Promise<void> {
  const ret = (await window.electron.ipcRenderer.invoke('settings:get')) as unknown
  apply(ret)
}

function toPlainValue<T>(value: T): T {
  const raw = isProxy(value) ? toRaw(value) : value
  if (Array.isArray(raw)) {
    return raw.map((item) => toPlainValue(item)) as T
  }
  if (raw && typeof raw === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(raw as Record<string, unknown>)) {
      out[key] = toPlainValue(item)
    }
    return out as T
  }
  return raw
}

async function update(patch: SettingsPatch): Promise<void> {
  const plainPatch = toPlainValue(patch)
  const ret = (await window.electron.ipcRenderer.invoke('settings:update', plainPatch)) as unknown
  apply(ret)
}

function replace(next: AppSettings): void {
  apply(next)
}

function init(): Promise<void> {
  if (initialized) return initPromise ?? Promise.resolve()
  initialized = true
  initPromise = (async () => {
    if (syncing.value) return
    syncing.value = true
    try {
      await refresh()
    } finally {
      syncing.value = false
    }
  })()

  window.electron.ipcRenderer.on('settings:changed', (_event: unknown, payload: unknown) => {
    apply(payload)
  })

  return initPromise
}

export function useSettingsStore(): {
  settings: typeof settings
  ready: typeof ready
  syncing: typeof syncing
  init: typeof init
  refresh: typeof refresh
  update: typeof update
  replace: typeof replace
} {
  return { settings, ready, syncing, init, refresh, update, replace }
}

export function initSettingsStore(): Promise<void> {
  return init()
}
