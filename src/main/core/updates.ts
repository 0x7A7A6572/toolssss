import { app, type BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'

export type UpdateState = {
  status:
    | 'idle'
    | 'checking'
    | 'available'
    | 'not-available'
    | 'downloading'
    | 'downloaded'
    | 'error'
    | 'unsupported'
  hasUpdate: boolean
  version: string | null
  percent: number | null
  message: string | null
}

type Deps = {
  getMainWindow: () => BrowserWindow | null
}

export function createUpdateService(deps: Deps): {
  getState: () => UpdateState
  isCloseLocked: () => boolean
  broadcast: () => void
  init: () => void
  requestCheck: () => Promise<UpdateState>
  download: () => Promise<UpdateState>
  install: () => boolean
} {
  let state: UpdateState = {
    status: 'idle',
    hasUpdate: false,
    version: null,
    percent: null,
    message: null
  }

  let initialized = false
  let checkInFlight: Promise<UpdateState> | null = null
  let closeLocked = false

  const broadcast = (): void => {
    const win = deps.getMainWindow()
    if (!win || win.isDestroyed()) return
    if (win.webContents.isLoading()) return
    win.webContents.send('update:status', state)
  }

  const init = (): void => {
    if (initialized) return
    initialized = true

    if (!app.isPackaged) {
      state = {
        status: 'unsupported',
        hasUpdate: false,
        version: null,
        percent: null,
        message: 'dev'
      }
      return
    }

    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = false

    autoUpdater.on('checking-for-update', () => {
      state = {
        status: 'checking',
        hasUpdate: false,
        version: null,
        percent: null,
        message: null
      }
      broadcast()
    })
    autoUpdater.on('update-available', (info) => {
      const version = typeof info?.version === 'string' ? info.version : null
      state = { status: 'available', hasUpdate: true, version, percent: null, message: null }
      broadcast()
    })
    autoUpdater.on('update-not-available', () => {
      state = {
        status: 'not-available',
        hasUpdate: false,
        version: null,
        percent: null,
        message: null
      }
      broadcast()
    })
    autoUpdater.on('download-progress', (p) => {
      const percent =
        typeof p?.percent === 'number' && Number.isFinite(p.percent) ? p.percent : null
      closeLocked = true
      state = { ...state, status: 'downloading', percent }
      broadcast()
    })
    autoUpdater.on('update-downloaded', (info) => {
      const version = typeof info?.version === 'string' ? info.version : state.version
      closeLocked = false
      state = { status: 'downloaded', hasUpdate: true, version, percent: 100, message: null }
      broadcast()
    })
    autoUpdater.on('error', (err) => {
      const message = err instanceof Error ? err.message : String(err)
      closeLocked = false
      state = { status: 'error', hasUpdate: false, version: null, percent: null, message }
      broadcast()
    })
  }

  const requestCheck = async (): Promise<UpdateState> => {
    init()
    if (state.status === 'unsupported') return state
    if (checkInFlight) return checkInFlight
    checkInFlight = (async () => {
      try {
        await autoUpdater.checkForUpdates()
        return state
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        state = { status: 'error', hasUpdate: false, version: null, percent: null, message }
        broadcast()
        return state
      } finally {
        checkInFlight = null
      }
    })()
    return checkInFlight
  }

  const download = async (): Promise<UpdateState> => {
    init()
    if (state.status === 'unsupported') return state
    if (state.status === 'downloaded' || state.status === 'downloading') return state
    try {
      if (state.status !== 'available') await requestCheck()
      if (state.status !== 'available') return state

      closeLocked = true
      state = { ...state, status: 'downloading', percent: null }
      broadcast()
      await autoUpdater.downloadUpdate()
      return state
    } catch (e) {
      closeLocked = false
      const message = e instanceof Error ? e.message : String(e)
      state = { status: 'error', hasUpdate: false, version: null, percent: null, message }
      broadcast()
      return state
    }
  }

  const install = (): boolean => {
    init()
    if (state.status !== 'downloaded') return false
    try {
      autoUpdater.quitAndInstall()
      return true
    } catch {
      return false
    }
  }

  return {
    getState: () => state,
    isCloseLocked: () => closeLocked,
    broadcast,
    init,
    requestCheck,
    download,
    install
  }
}
