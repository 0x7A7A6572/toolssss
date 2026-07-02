import {
  app,
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
  restoreAllWindowStash,
  restoreAndClearPersistedWindowStash,
  rehydrateWindowStashFromDisk,
  stashForegroundToEdge,
  toggleTopmostWindowAtCursor
} from './domains/window-stash'
import { createEyeOverlayDomain } from './domains/eye-overlay'
import { createMouseHookDomain } from './domains/mouse-hook'
import { createRemindersDomain } from './domains/reminders'
import { startPythonServer, stopPythonServer, getPythonPort } from './core/python-server'

const mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let snipCapturing = false
let windowStashRestoredOnQuit = false

let settings: AppSettings = DEFAULT_SETTINGS
const updates = createUpdateService({ getMainWindow: () => mainWindow })
const stickers = createStickersDomain({ icon, loadWindow })
const overlay = createEyeOverlayDomain({ icon, loadWindow, getSettings: () => settings })
const mouseHook = createMouseHookDomain({ icon, loadWindow, getSettings: () => settings })
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
      getMainWindow: () => mouseHook.getOverlayWindow(),
      createMainWindow: () => {
        mouseHook.showOverlay()
      },
      setIsQuitting: () => {
        // 覆盖窗口没有最小化到托盘的关闭拦截，直接退出即可
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

/**
 * 应用启动后延迟执行的初始化任务。
 *
 * 所有任务都 fire-and-forget 不阻塞主流程：
 *   1. 800ms   — 预热 PowerShell 进程（减少后续外部窗口操作延迟）
 *   2. 1100ms  — 恢复窗口收纳状态：
 *       - 上次异常退出 → 暴力恢复并清空持久化备份
 *       - 上次正常退出 → 从磁盘恢复，最多重试 3 次（间隔 1.8s / 5.2s），
 *         因为被收纳的目标窗口可能尚未完成初始化
 */
function scheduleStartupTasks(previousExitClean: boolean): void {
  setTimeout(() => {
    warmupExternalWindowPowerShell().catch(() => null)
  }, 800)

  setTimeout(() => {
    if (!previousExitClean) {
      restoreAndClearPersistedWindowStash().catch(() => null)
      return
    }
    // 正常退出恢复：多次重试以适应目标窗口异步就绪
    const scheduleRetry = (delayMs: number): void => {
      setTimeout(() => {
        rehydrateWindowStashFromDisk().catch(() => null)
      }, delayMs)
    }
    rehydrateWindowStashFromDisk().catch(() => null) // T+0（相对于外层 1100ms）
    scheduleRetry(1800) // T+1800ms = 2900ms 总延迟
    scheduleRetry(5200) // T+5200ms = 6300ms 总延迟
  }, 1100)
}

/**
 * 启动完成后在屏幕右下角弹出通知 Toast，3 秒后自动消失。
 */
function showReadyToast(version: string, shortcut: string): void {
  console.log('[Main] showReadyToast', { version, shortcut })
  try {
    const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize
    const winW = 280
    const winH = 64
    const gap = 20

    const win = new BrowserWindow({
      width: winW,
      height: winH,
      x: screenW - winW - gap,
      y: screenH - winH - gap,
      frame: false,
      transparent: true,
      resizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      focusable: false,
      hasShadow: false,
      backgroundColor: '#00000000'
    })

    const html = [
      '<!DOCTYPE html>',
      '<html><head><meta charset="utf-8"><style>',
      '*{margin:0;padding:0;box-sizing:border-box}',
      'body{font-family:-apple-system,"Microsoft YaHei",sans-serif;height:100vh;background:transparent;overflow:hidden}',
      '.toast{background:rgba(30,30,30,0.9);border-radius:10px;padding:12px 18px;color:#e0e0e0;font-size:12px;border:1px solid rgba(255,255,255,0.08)}',
      '.row{display:flex;align-items:center;gap:10px}',
      '.icon{font-size:18px}',
      '.main{font-weight:600;font-size:13px;color:#fff}',
      '.sub{color:#888;margin-top:4px}',
      'kbd{background:rgba(255,255,255,0.12);border-radius:3px;padding:1px 5px;font-size:11px;border:1px solid rgba(255,255,255,0.15)}',
      '</style></head>',
      '<body>',
      '<div class="toast">',
      '<div class="row">',
      // '<span class="icon">✅</span>',
      '<div>',
      '<div class="main">Forge Studio v' + version + '</div>',
      '<div class="sub">已就绪，按 <kbd>' + shortcut + '</kbd> 唤起主面板</div>',
      '</div></div></div>',
      '</body></html>'
    ].join('')

    void win.loadURL(
      'data:text/html;charset=utf-8;base64,' + Buffer.from(html, 'utf-8').toString('base64')
    )

    setTimeout(() => {
      if (!win.isDestroyed()) win.close()
    }, 3000)
  } catch (err) {
    console.error('[Main] showReadyToast 失败:', err)
  }
}

/**
 * 创建启动闪屏窗口，显示 Python 后端启动进度。
 * 使用内联 HTML，无需加载渲染进程。
 */
function createSplashWindow(toggleShortcut: string): BrowserWindow {
  const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize
  const winW = 320
  const winH = 100

  const win = new BrowserWindow({
    width: winW,
    height: winH,
    x: Math.round((screenW - winW) / 2),
    y: Math.round((screenH - winH) / 2),
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: false,
    hasShadow: false,
    backgroundColor: '#00000000'
  })

  win.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(`
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    font-family: -apple-system, "Microsoft YaHei", sans-serif;
    display:flex; align-items:center; justify-content:center;
    height:100vh; background:transparent; overflow:hidden;
  }
  .card {
    background: rgba(30,30,30,0.92); border-radius:12px;
    padding:18px 28px; text-align:center;
    color:#e0e0e0; font-size:14px;
    backdrop-filter: blur(8px);
    -webkit-app-region: drag;
  }
  .title { font-size:15px; font-weight:600; margin-bottom:8px; color:#fff; }
  .hint { font-size:11px; color:#888; margin-top:6px; }
  .bar-wrap { width:100%; height:4px; background:rgba(255,255,255,0.1); border-radius:2px; margin-top:10px; overflow:hidden; }
  .bar-fill { height:100%; width:0%; background:#4da3ff; border-radius:2px; transition:width 0.3s; }
</style></head>
<body>
  <div class="card">
    <div class="title">Forge Studio 正在启动...</div>
    <div id="status" class="hint">检查 Python 服务</div>
    <div class="bar-wrap"><div id="bar" class="bar-fill"></div></div>
    <div class="hint">启动后可通过 <b>${toggleShortcut}</b> 唤起</div>
  </div>
</body>
</html>
    `)}`
  )

  return win
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app
  .whenReady()
  .then(async () => {
    // Set app user model id for windows
    electronApp.setAppUserModelId('com.electron')

    // 预加载设置（后续 domain 初始化需要通过 getSettings() 闭包读取）
    settings = loadSettingsFromDisk()

    // 读取唤出快捷键，启动闪屏和就绪 Toast 都用到
    const toggleShortcut = settings.shortcuts?.toggleOverlay ?? 'Alt+`'
    const splash = createSplashWindow(toggleShortcut)

    // 启动 Python 后端服务（阻塞等待健康检查通过，失败则退出）
    const port = await startPythonServer({
      getSettings: () => settings,
      onHealthCheckAttempt: (attempt, max) => {
        splash.webContents.executeJavaScript(`
        document.getElementById('bar').style.width = '${Math.round((attempt / max) * 100)}%';
        document.getElementById('status').textContent = '检查 Python 服务 (${attempt}/${max})';
      `)
      }
    })
    // 闪屏稍后再关（现在仍是唯一窗口，立即关会触发 window-all-closed → quit）

    if (!port) {
      try {
        splash.close()
      } catch {
        /* 忽略 */
      }
      dialog.showErrorBox('启动失败', 'Python 后端服务启动失败，应用无法继续运行。')
      app.quit()
      return
    }
    console.log('[Main] Python 服务已启动，端口:', port)

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

    applySettingsToRuntime()

    // 注册全局快捷键（不依赖 Python）。preloadOverlay 会创建一个隐藏窗口，
    // 防止 splash 关闭后触发 window-all-closed → app.quit()
    const shortcutOk = mouseHook.start()
    console.log(
      '[Main] mouseHook.start() 结果:',
      shortcutOk,
      'overlay窗口:',
      mouseHook.getOverlayWindow()
    )

    // 现在已有 overlay 窗口兜底，安全关闭闪屏
    try {
      splash.close()
    } catch {
      /* 忽略 */
    }

    // 启动时延迟执行的初始化任务：
    //   - 预热 PowerShell（减少后续外部窗口操作延迟）
    //   - 恢复窗口收纳状态（异常退出走暴力恢复，正常退出多次重试）
    scheduleStartupTasks(windowStashPreviousExitClean)
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

    registerCustomModuleHandlers()
    ipcMain.handle('mouse-hook:start', () => {
      return mouseHook.start()
    })
    ipcMain.handle('mouse-hook:stop', () => {
      mouseHook.stop()
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
      const options: OpenDialogOptions = { properties: ['openDirectory', 'createDirectory'] }
      // 覆盖窗口是透明/无框窗口，不适合作为文件对话框的父窗口
      const result = await dialog.showOpenDialog(options)
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

    // 启动完成，右下角 toast 通知
    showReadyToast(app.getVersion(), toggleShortcut)

    // app.on('activate', function () {
    //   // On macOS it's common to re-create a window in the app when the
    //   // dock icon is clicked and there are no other windows open.
    //   if (BrowserWindow.getAllWindows().length === 0) createWindow()
    // })
  })
  .catch((err) => {
    console.error('[Main] app.whenReady 启动失败:', err)
    dialog.showErrorBox('启动失败', `应用启动异常: ${err?.message ?? err}`)
    app.quit()
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
