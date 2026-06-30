import {
  app,
  shell,
  BrowserWindow,
  ipcMain,
  dialog,
  screen,
  type Tray,
  type OpenDialogOptions
} from 'electron'

import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { DEFAULT_SETTINGS, type AppSettings, type SettingsPatch } from '@shared/settings'
import { applySettingsPatch, loadSettingsFromDisk, saveSettingsToDisk } from './core/settings-store'
import { createUpdateService } from './core/updates'
import { ensureAutoStart as applyAutoStart } from './core/autostart'
import { registerShortcuts } from './core/shortcuts'
import { syncTray } from './core/tray'
import {
  openQuickStickyNoteEditor,
  registerStickyNotesHandlers,
  setStickyNotesSaveDir
} from './domains/sticky-notes'
import { createStickersDomain } from './domains/stickers'
import { createSnipDomain } from './domains/snip'
import { createTranslatorDomain } from './domains/translator'
import { registerWeatherHandlers } from './domains/weather'
import { applyScheduledTasks, registerScheduledTasksHandlers } from './domains/scheduled-tasks'
import { registerFunFactHandlers } from './domains/fun-fact'
import { registerCustomModuleHandlers } from './domains/custom-modules'
import {
  disposeExternalWindowPowerShell,
  warmupExternalWindowPowerShell
} from './domains/external-window'
import {
  applyTopmostWindowSettingsToRuntime,
  clearAllTopmostWindows,
  disposeAllWindowStash,
  getWindowStashPreviousExitClean,
  initWindowStash,
  markWindowStashSessionClean,
  markWindowStashSessionRunning,
  restoreAndClearPersistedWindowStash,
  restoreAllWindowStash,
  rehydrateWindowStashFromDisk,
  stashForegroundToEdge,
  toggleTopmostWindowAtCursor
} from './domains/window-stash'
import { createEyeOverlayDomain } from './domains/eye-overlay'
import { createMouseHookDomain } from './domains/mouse-hook'
import { createRemindersDomain } from './domains/reminders'
import {
  startPythonServer,
  stopPythonServer,
  getPythonPort,
  pushConfigToPython
} from './core/python-server'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false
let snipCapturing = false
let windowStashRestoredOnQuit = false

let settings: AppSettings = DEFAULT_SETTINGS
const updates = createUpdateService({ getMainWindow: () => mainWindow })
const stickers = createStickersDomain({ icon, loadWindow })
const overlay = createEyeOverlayDomain({ icon, loadWindow, getSettings: () => settings })
const mouseHook = createMouseHookDomain({ icon, loadWindow })
const reminders = createRemindersDomain({
  icon,
  loadWindow,
  getSettings: () => settings,
  getMainWindow: () => mainWindow
})
const snip = createSnipDomain({
  getMainWindow: () => mainWindow,
  getSnipSaveDirSetting: () => settings.snip.saveDir,
  setCapturing: setSnipCapturing,
  suspendOverlayForSnip: () => overlay.suspendForSnip(),
  resumeOverlayAfterSnip: () => overlay.resumeAfterSnip(),
  stickFromClipboard: () => stickers.pasteFromClipboard(),
  openStickerFromImageDataUrl: (dataUrl) => stickers.openImageDataUrl(dataUrl)
})
const translator = createTranslatorDomain({
  getSettings: () => settings,
  loadWindowForPopup
})

const snipShortcutDebug = Boolean(is.dev) || process.env.SNIP_SHORTCUT_DEBUG === '1'

function snipDbg(...args: unknown[]): void {
  if (!snipShortcutDebug) return
  console.log('[snip-shortcut]', ...args)
}

function setSnipCapturing(next: boolean): void {
  if (snipCapturing === next) return
  snipCapturing = next
  snipDbg('snipCapturing', snipCapturing)
  ensureShortcuts()
}

function broadcastSettingsChanged(next: AppSettings): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    if (win.webContents.isLoading()) continue
    try {
      win.webContents.send('settings:changed', next)
    } catch {
      void 0
    }
  }
}

function commitSettings(next: AppSettings, opts?: { applyRuntime?: boolean }): void {
  settings = next
  saveSettingsToDisk(settings)
  if (opts?.applyRuntime) applySettingsToRuntime()
  broadcastSettingsChanged(settings)
  // 同步配置到 Python 后端（异步推送，不阻塞设置流程）
  pushConfigToPython().catch(() => null)
}

async function loadWindow(win: BrowserWindow, query: Record<string, string>): Promise<void> {
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    const params = new URLSearchParams(query)
    await win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}?${params.toString()}`)
    return
  }

  await win.loadFile(join(__dirname, '../renderer/index.html'), { query })
}

function loadWindowForPopup(win: BrowserWindow, query: Record<string, string>): Promise<void> {
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    const params = new URLSearchParams(query)
    return win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}?${params.toString()}`)
  }
  return win.loadFile(join(__dirname, '../renderer/index.html'), { query })
}

function ensureTray(): void {
  tray = syncTray(
    {
      icon,
      tray,
      getMainWindow: () => mainWindow,
      createMainWindow: createWindow,
      setIsQuitting: (v) => {
        isQuitting = v
      }
    },
    settings
  )
}

function ensureAutoStart(): void {
  applyAutoStart(settings)
}

function ensureShortcuts(): void {
  registerShortcuts({
    getSettings: () => settings,
    commitSettings: (next) => commitSettings(next),
    ensureOverlayWindows: () => overlay.ensureWindows(),
    openTranslatorPopupFromSelection: () => translator.openPopupFromSelection(),
    openQuickStickyNoteEditor,
    startSnipCapture: () => snip.startCapture(),
    pasteStickerFromClipboard: () => stickers.pasteFromClipboard(),
    toggleStickersHidden: () => stickers.toggleHidden(),
    isSnipCapturing: () => snipCapturing,
    snipDbg,
    stashForegroundToEdge,
    toggleTopmostWindowAtCursor
  })
}

function applySettingsToRuntime(): void {
  setStickyNotesSaveDir(settings.stickyNotes?.saveDir ?? '')
  overlay.ensureWindows()
  reminders.applySettingsToRuntime()
  applyScheduledTasks(settings, { startup: true }).catch(() => null)
  applyTopmostWindowSettingsToRuntime()
  ensureTray()
  ensureAutoStart()
  ensureShortcuts()
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 670,
    show: false,
    frame: false,
    resizable: true,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  const sendWindowState = (): void => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    const payload = {
      maximized: mainWindow.isMaximized(),
      minimized: mainWindow.isMinimized(),
      focused: mainWindow.isFocused()
    }
    mainWindow.webContents.send('window:state', payload)
  }
  mainWindow.on('maximize', sendWindowState)
  mainWindow.on('unmaximize', sendWindowState)
  mainWindow.on('minimize', sendWindowState)
  mainWindow.on('restore', sendWindowState)
  mainWindow.on('focus', sendWindowState)
  mainWindow.on('blur', sendWindowState)

  mainWindow.on('close', (event) => {
    if (updates.isCloseLocked()) {
      event.preventDefault()
      try {
        mainWindow?.show()
        mainWindow?.focus()
      } catch {
        void 0
      }
      return
    }
    if (settings.general.minimizeToTray && !isQuitting) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  loadWindow(mainWindow, {}).catch(() => null)

  mainWindow.webContents.once('did-finish-load', () => {
    updates.broadcast()
  })

  ipcMain.handle('window:state:get', () => {
    if (!mainWindow || mainWindow.isDestroyed())
      return { maximized: false, minimized: false, focused: false }
    return {
      maximized: mainWindow.isMaximized(),
      minimized: mainWindow.isMinimized(),
      focused: mainWindow.isFocused()
    }
  })
  ipcMain.on('window:control', (event, payload: unknown) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win.isDestroyed()) return
    const action =
      typeof payload === 'string'
        ? payload
        : payload && typeof payload === 'object'
          ? (payload as { action?: unknown }).action
          : ''
    const act = typeof action === 'string' ? action : ''
    if (!act) return
    if (act === 'minimize') {
      try {
        win.minimize()
      } catch {
        void 0
      }
      return
    }
    if (act === 'toggleMaximize') {
      try {
        if (win.isMaximized()) win.unmaximize()
        else win.maximize()
      } catch {
        void 0
      }
      return
    }
    if (act === 'close') {
      try {
        win.close()
      } catch {
        void 0
      }
      return
    }
  })
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  const windowStashPreviousExitClean = await getWindowStashPreviousExitClean().catch(() => true)
  await markWindowStashSessionRunning().catch(() => null)

  initWindowStash({
    loadWindow,
    getMainWindow: () => mainWindow,
    getSettings: () => settings
  })

  app.on('will-quit', (e) => {
    if (windowStashRestoredOnQuit) return
    windowStashRestoredOnQuit = true
    e.preventDefault()
    restoreAllWindowStash()
      .then(() => clearAllTopmostWindows())
      .catch(() => null)
      .finally(() => {
        disposeAllWindowStash()
        disposeExternalWindowPowerShell()
        mouseHook.dispose()
        stopPythonServer().catch(() => null)
        markWindowStashSessionClean()
          .catch(() => null)
          .finally(() => {
            app.exit(0)
          })
      })
  })

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  settings = loadSettingsFromDisk()
  applySettingsToRuntime()

  // 启动 Python 后端服务（异步，不阻塞 UI）
  startPythonServer(
    { getSettings: () => settings, getUserDataPath: () => app.getPath('userData') },
    (next) => commitSettings(next)
  )
    .then((port) => {
      if (port) {
        console.log('[Main] Python 服务已启动，端口:', port)
        // Python 就绪后自动启动全局鼠标钩子
        mouseHook.start().catch(() => null)
      } else {
        console.log('[Main] Python 服务未启动（环境不满足或启动失败）')
      }
    })
    .catch((e) => {
      console.error('[Main] Python 服务启动异常:', e)
    })

  setTimeout(() => {
    warmupExternalWindowPowerShell().catch(() => null)
  }, 800)
  setTimeout(() => {
    if (!windowStashPreviousExitClean) {
      restoreAndClearPersistedWindowStash().catch(() => null)
      return
    }
    rehydrateWindowStashFromDisk().catch(() => null)
    setTimeout(() => {
      rehydrateWindowStashFromDisk().catch(() => null)
    }, 1800)
    setTimeout(() => {
      rehydrateWindowStashFromDisk().catch(() => null)
    }, 5200)
  }, 1100)
  registerStickyNotesHandlers()
  registerWeatherHandlers()
  stickers.registerIpcHandlers()
  snip.registerIpcHandlers()
  translator.registerIpcHandlers()
  registerScheduledTasksHandlers({
    getSettings: () => settings,
    setSettings: (next) => {
      settings = next
    },
    saveSettingsToDisk,
    broadcastSettingsChanged
  })

  ipcMain.handle('app:paths', () => {
    return {
      userData: app.getPath('userData'),
      pictures: app.getPath('pictures')
    }
  })
  ipcMain.handle('app:version', () => {
    return app.getVersion()
  })
  // Python 服务端口查询（渲染进程用此端口直接 HTTP 请求 Python）
  ipcMain.handle('python:port', () => {
    return getPythonPort()
  })
  ipcMain.handle('update:status:get', () => updates.getState())
  ipcMain.handle('update:check', async () => {
    return await updates.requestCheck()
  })
  ipcMain.handle('update:download', async () => {
    return await updates.download()
  })
  ipcMain.handle('update:install', () => updates.install())
  ipcMain.handle('settings:get', () => settings)
  registerFunFactHandlers()
  registerCustomModuleHandlers()
  ipcMain.handle('mouse-hook:start', async () => {
    await mouseHook.start()
    return mouseHook.isRunning()
  })
  ipcMain.handle('mouse-hook:stop', async () => {
    await mouseHook.stop()
    return mouseHook.isRunning()
  })
  ipcMain.handle('mouse-hook:status', () => mouseHook.isRunning())
  ipcMain.handle('mouse-hook:overlay:close', () => {
    mouseHook.hideOverlay()
    return true
  })
  ipcMain.on('console:log', (_event, ...args: unknown[]) => {
    console.log('[renderer]', ...args)
  })
  ipcMain.handle('sticky-notes:saveDir:choose', async () => {
    const parent = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
    const options: OpenDialogOptions = { properties: ['openDirectory', 'createDirectory'] }
    const result = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled) return null
    const p = result.filePaths?.[0]
    return typeof p === 'string' && p.trim() ? p : null
  })
  reminders.registerIpcHandlers()
  ipcMain.handle('settings:update', (_, patch: SettingsPatch) => {
    const next = applySettingsPatch(settings, patch)
    commitSettings(next, { applyRuntime: true })
    reminders.broadcastBreakStatus()
    return next
  })

  screen.on('display-added', () => overlay.ensureWindows())
  screen.on('display-removed', () => overlay.ensureWindows())
  screen.on('display-metrics-changed', () => overlay.ensureWindows())

  // createWindow()
  updates.init()
  setTimeout(() => {
    void updates.requestCheck()
  }, 3500)

  // app.on('activate', function () {
  //   // On macOS it's common to re-create a window in the app when the
  //   // dock icon is clicked and there are no other windows open.
  //   if (BrowserWindow.getAllWindows().length === 0) createWindow()
  // })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
