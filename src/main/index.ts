import { exec } from 'child_process'
import { promisify } from 'util'
import { app, shell, BrowserWindow, ipcMain, screen, Tray, Menu, globalShortcut } from 'electron'

const execAsync = promisify(exec)
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import {
  DEFAULT_SETTINGS,
  type AlarmReason,
  type AppSettings,
  type SettingsPatch
} from '@shared/settings'
import { registerStickyNotesHandlers } from './sticky-notes'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false

let settings: AppSettings = DEFAULT_SETTINGS
const overlayWindows = new Map<number, BrowserWindow>()
const alarmWindows = new Map<number, BrowserWindow>()

let dailyAlarmTimer: NodeJS.Timeout | undefined
let breakTimer: NodeJS.Timeout | undefined
let snoozeTimer: NodeJS.Timeout | undefined
let lastAlarmPayload: { reason: AlarmReason; title: string; body: string } | null = null
let breakNextAt: number | null = null

function getBreakStatus(): { enabled: boolean; intervalMinutes: number; nextAt: number | null } {
  return {
    enabled: settings.break.enabled,
    intervalMinutes: settings.break.intervalMinutes,
    nextAt: breakNextAt
  }
}

function broadcastBreakStatus(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.webContents.isLoading()) return
  mainWindow.webContents.send('break:status', getBreakStatus())
}

function clampNumber(value: number, min: number, max: number): number {
  if (Number.isNaN(value) || !Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

function normalizeTimeString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const m = value.match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return null
  const h = Number(m[1])
  const mm = Number(m[2])
  if (!Number.isInteger(h) || !Number.isInteger(mm)) return null
  if (h < 0 || h > 23 || mm < 0 || mm > 59) return null
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

function normalizeSettings(input: unknown): AppSettings {
  const base = structuredClone(DEFAULT_SETTINGS)
  if (!input || typeof input !== 'object') return base
  const obj = input as Partial<AppSettings>

  if (obj.general) {
    base.general.minimizeToTray = Boolean(obj.general.minimizeToTray)
    base.general.autoStart = Boolean(obj.general.autoStart)
  }

  if (obj.shortcuts) {
    if (typeof obj.shortcuts.toggleEye === 'string')
      base.shortcuts.toggleEye = obj.shortcuts.toggleEye
    if (typeof obj.shortcuts.toggleAlarm === 'string')
      base.shortcuts.toggleAlarm = obj.shortcuts.toggleAlarm
  }

  base.eye.enabled = Boolean(obj.eye?.enabled)
  base.eye.opacity = clampNumber(Number(obj.eye?.opacity), 0, 0.7)
  if (typeof obj.eye?.color === 'string' && obj.eye.color.trim()) {
    base.eye.color = obj.eye.color.trim()
  }

  const rs = (obj as { reminderSeconds?: unknown }).reminderSeconds
  if (typeof rs === 'number') {
    base.reminderSeconds = clampNumber(rs, 5, 600)
  }

  base.alarm.enabled = Boolean(obj.alarm?.enabled)
  base.alarm.time = normalizeTimeString(obj.alarm?.time) ?? base.alarm.time
  base.alarm.label =
    typeof obj.alarm?.label === 'string' && obj.alarm.label.trim()
      ? obj.alarm.label.trim()
      : base.alarm.label

  base.break.enabled = Boolean(obj.break?.enabled)
  base.break.intervalMinutes = clampNumber(Number(obj.break?.intervalMinutes), 5, 240)
  base.break.disableInFullscreen =
    typeof obj.break?.disableInFullscreen === 'boolean'
      ? obj.break.disableInFullscreen
      : base.break.disableInFullscreen

  return base
}

function applySettingsPatch(patch: unknown): AppSettings {
  if (!patch || typeof patch !== 'object') return settings
  const p = patch as SettingsPatch
  const next: AppSettings = structuredClone(settings)

  if (p.general) {
    if (typeof p.general.minimizeToTray === 'boolean')
      next.general.minimizeToTray = p.general.minimizeToTray
    if (typeof p.general.autoStart === 'boolean') next.general.autoStart = p.general.autoStart
  }

  if (p.shortcuts) {
    if (typeof p.shortcuts.toggleEye === 'string') next.shortcuts.toggleEye = p.shortcuts.toggleEye
    if (typeof p.shortcuts.toggleAlarm === 'string')
      next.shortcuts.toggleAlarm = p.shortcuts.toggleAlarm
  }

  if (p.eye) {
    if (typeof p.eye.enabled === 'boolean') next.eye.enabled = p.eye.enabled
    if (typeof p.eye.opacity === 'number') next.eye.opacity = p.eye.opacity
    if (typeof p.eye.color === 'string') next.eye.color = p.eye.color
  }

  if (p.alarm) {
    if (typeof p.alarm.enabled === 'boolean') next.alarm.enabled = p.alarm.enabled
    if (typeof p.alarm.time === 'string') next.alarm.time = p.alarm.time
    if (typeof p.alarm.label === 'string') next.alarm.label = p.alarm.label
  }

  if (p.break) {
    if (typeof p.break.enabled === 'boolean') next.break.enabled = p.break.enabled
    if (typeof p.break.intervalMinutes === 'number')
      next.break.intervalMinutes = p.break.intervalMinutes
    if (typeof p.break.disableInFullscreen === 'boolean')
      next.break.disableInFullscreen = p.break.disableInFullscreen
  }
  {
    const rsv = (p as { reminderSeconds?: unknown }).reminderSeconds
    if (typeof rsv === 'number') {
      next.reminderSeconds = clampNumber(rsv, 5, 600)
    }
  }

  return normalizeSettings(next)
}

function settingsFilePath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

function loadSettingsFromDisk(): AppSettings {
  try {
    const raw = readFileSync(settingsFilePath(), 'utf-8')
    return normalizeSettings(JSON.parse(raw))
  } catch {
    return DEFAULT_SETTINGS
  }
}

function saveSettingsToDisk(next: AppSettings): void {
  try {
    writeFileSync(settingsFilePath(), JSON.stringify(next), 'utf-8')
  } catch {
    return
  }
}

async function loadWindow(win: BrowserWindow, query: Record<string, string>): Promise<void> {
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    const params = new URLSearchParams(query)
    await win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}?${params.toString()}`)
    return
  }

  await win.loadFile(join(__dirname, '../renderer/index.html'), { query })
}

function closeWindowMap(map: Map<number, BrowserWindow>): void {
  for (const win of map.values()) {
    if (!win.isDestroyed()) win.close()
  }
  map.clear()
}

function ensureOverlayWindows(): void {
  if (!settings.eye.enabled) {
    closeWindowMap(overlayWindows)
    return
  }

  const displays = screen.getAllDisplays()
  const displayIds = new Set(displays.map((d) => d.id))
  for (const [id, win] of overlayWindows) {
    if (!displayIds.has(id)) {
      if (!win.isDestroyed()) win.close()
      overlayWindows.delete(id)
    }
  }

  for (const display of displays) {
    const existing = overlayWindows.get(display.id)
    if (existing && !existing.isDestroyed()) {
      existing.setBounds(display.bounds, false)
      continue
    }
    overlayWindows.set(display.id, createOverlayWindow(display))
  }

  broadcastOverlaySettings()
}

function broadcastOverlaySettings(): void {
  for (const win of overlayWindows.values()) {
    if (win.isDestroyed()) continue
    win.webContents.send('overlay:settings', settings.eye)
  }
}

function createOverlayWindow(display: Electron.Display): BrowserWindow {
  const win = new BrowserWindow({
    x: display.bounds.x,
    y: display.bounds.y,
    width: display.bounds.width,
    height: display.bounds.height,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  win.setIgnoreMouseEvents(true, { forward: true })

  loadWindow(win, { mode: 'overlay' }).catch(() => null)

  win.webContents.once('did-finish-load', () => {
    win.webContents.send('overlay:settings', settings.eye)
    win.showInactive()
  })

  return win
}

function nextDailyAlarmDelayMs(time: string, now = new Date()): number | null {
  const normalized = normalizeTimeString(time)
  if (!normalized) return null
  const [hStr, mStr] = normalized.split(':')
  const h = Number(hStr)
  const m = Number(mStr)

  const next = new Date(now)
  next.setSeconds(0, 0)
  next.setHours(h, m, 0, 0)
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1)
  return next.getTime() - now.getTime()
}

function ensureDailyAlarmTimer(): void {
  if (dailyAlarmTimer) clearTimeout(dailyAlarmTimer)
  dailyAlarmTimer = undefined

  if (!settings.alarm.enabled) return
  const delay = nextDailyAlarmDelayMs(settings.alarm.time)
  if (delay === null) return

  dailyAlarmTimer = setTimeout(() => {
    triggerAlarm('alarm')
    ensureDailyAlarmTimer()
  }, delay)
}

function ensureBreakTimer(): void {
  if (breakTimer) clearInterval(breakTimer)
  breakTimer = undefined

  if (!settings.break.enabled) {
    breakNextAt = null
    broadcastBreakStatus()
    return
  }
  const intervalMs = settings.break.intervalMinutes * 60 * 1000
  breakNextAt = Date.now() + intervalMs
  broadcastBreakStatus()
  breakTimer = setInterval(() => {
    triggerAlarm('break')
    breakNextAt = Date.now() + intervalMs
    broadcastBreakStatus()
  }, intervalMs)
}

function triggerAlarm(reason: AlarmReason): void {
  if (snoozeTimer) {
    clearTimeout(snoozeTimer)
    snoozeTimer = undefined
  }

  const title = reason === 'alarm' ? settings.alarm.label : '休息提醒'
  const body =
    reason === 'alarm' ? `现在时间：${settings.alarm.time}` : `休息一下，看看远处 20 秒，眨眨眼。`

  if (reason === 'break' && settings.break.disableInFullscreen) {
    // Simple check: if the last active window is fullscreen.
    // Since we can't easily check other apps, we'll skip this check for now or use a heuristic.
    // Actually, let's implement a PowerShell check for Windows.
    checkFullscreenWindows().then((isFullscreen) => {
      if (isFullscreen) {
        console.log('User is in fullscreen mode, skipping break reminder.')
        // Snooze for 5 minutes instead of skipping entirely? Or just skip this cycle?
        // Let's snooze for 5 minutes to try again.
        snoozeAlarm(5)
      } else {
        showAlarmWindows(reason, title, body)
      }
    })
    return
  }

  showAlarmWindows(reason, title, body)
}

async function checkFullscreenWindows(): Promise<boolean> {
  if (process.platform !== 'win32') return false
  try {
    // PowerShell script to check if the foreground window covers the screen
    const script = `
      Add-Type @"
        using System;
        using System.Runtime.InteropServices;
        public class User32 {
          [DllImport("user32.dll")]
          public static extern IntPtr GetForegroundWindow();
          [DllImport("user32.dll")]
          public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
          [DllImport("user32.dll")]
          public static extern int GetSystemMetrics(int nIndex);
          
          [StructLayout(LayoutKind.Sequential)]
          public struct RECT {
            public int Left;
            public int Top;
            public int Right;
            public int Bottom;
          }
        }
"@
      $hwnd = [User32]::GetForegroundWindow()
      $rect = New-Object User32+RECT
      [User32]::GetWindowRect($hwnd, [ref]$rect)
      $width = $rect.Right - $rect.Left
      $height = $rect.Bottom - $rect.Top
      $screenWidth = [User32]::GetSystemMetrics(0)
      $screenHeight = [User32]::GetSystemMetrics(1)
      
      if ($width -eq $screenWidth -and $height -eq $screenHeight) {
        Write-Output "True"
      } else {
        Write-Output "False"
      }
    `
    // Use encoded command to avoid escaping issues
    const encoded = Buffer.from(script, 'utf16le').toString('base64')
    const { stdout } = await execAsync(`powershell -EncodedCommand ${encoded}`)
    return stdout.trim() === 'True'
  } catch (e) {
    console.error('Failed to check fullscreen:', e)
    return false
  }
}

function showAlarmWindows(reason: AlarmReason, title: string, body: string): void {
  lastAlarmPayload = { reason, title, body }

  if (alarmWindows.size === 0) {
    for (const display of screen.getAllDisplays()) {
      alarmWindows.set(display.id, createAlarmWindow(display))
    }
  }

  for (const win of alarmWindows.values()) {
    if (win.isDestroyed()) continue
    if (!win.webContents.isLoading())
      win.webContents.send('alarm:show', {
        reason,
        title,
        body,
        timeoutSec: settings.reminderSeconds
      })
    if (!win.isVisible()) win.show()
  }
}

function createAlarmWindow(display: Electron.Display): BrowserWindow {
  const win = new BrowserWindow({
    x: display.bounds.x,
    y: display.bounds.y,
    width: display.bounds.width,
    height: display.bounds.height,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    fullscreen: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: '#111827',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  loadWindow(win, { mode: 'alarm' }).catch(() => null)

  win.webContents.once('did-finish-load', () => {
    if (lastAlarmPayload)
      win.webContents.send('alarm:show', {
        ...lastAlarmPayload,
        timeoutSec: settings.reminderSeconds
      })
    win.show()
    win.focus()
    win.setFullScreen(true)
    win.setKiosk(true)
  })

  win.on('closed', () => {
    alarmWindows.delete(display.id)
  })

  return win
}

function previewAlarm(reason: AlarmReason): void {
  const title = reason === 'alarm' ? `预览：${settings.alarm.label}` : '预览：休息提醒'
  const body =
    reason === 'alarm' ? `现在时间：${settings.alarm.time}` : `休息一下，看看远处 20 秒，眨眨眼。`
  showAlarmWindows(reason, title, body)
}

function dismissAlarmWindows(): void {
  closeWindowMap(alarmWindows)
}

function snoozeAlarm(minutes: number): void {
  dismissAlarmWindows()
  const ms = clampNumber(minutes, 1, 120) * 60 * 1000
  snoozeTimer = setTimeout(() => triggerAlarm('alarm'), ms)
}

function ensureTray(): void {
  if (settings.general.minimizeToTray) {
    if (tray) return
    tray = new Tray(icon)

    const showApp = (): void => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) mainWindow.restore()
        mainWindow.show()
        mainWindow.focus()
      } else {
        createWindow()
      }
    }

    const contextMenu = Menu.buildFromTemplate([
      {
        label: '显示主界面',
        click: showApp
      },
      { type: 'separator' },
      {
        label: '退出',
        click: (): void => {
          isQuitting = true
          app.quit()
        }
      }
    ])
    tray.setToolTip('FreamX')
    tray.setContextMenu(contextMenu)
    tray.on('click', showApp)
    tray.on('double-click', showApp)
  } else {
    if (tray) {
      tray.destroy()
      tray = null
    }
  }
}

function ensureAutoStart(): void {
  app.setLoginItemSettings({
    openAtLogin: settings.general.autoStart,
    path: app.getPath('exe')
  })
}

function ensureShortcuts(): void {
  globalShortcut.unregisterAll()

  if (settings.shortcuts.toggleEye) {
    try {
      globalShortcut.register(settings.shortcuts.toggleEye, () => {
        settings.eye.enabled = !settings.eye.enabled
        saveSettingsToDisk(settings)
        // Only update relevant runtime parts, avoid full re-apply to prevent recursion
        ensureOverlayWindows()
        // Notify renderer to update UI
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('settings:changed', settings)
        }
      })
    } catch (e) {
      console.error('Failed to register shortcut:', settings.shortcuts.toggleEye, e)
    }
  }
}

function applySettingsToRuntime(): void {
  ensureOverlayWindows()
  ensureDailyAlarmTimer()
  ensureBreakTimer()
  ensureTray()
  ensureAutoStart()
  ensureShortcuts()
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('close', (event) => {
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
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  settings = loadSettingsFromDisk()
  applySettingsToRuntime()
  registerStickyNotesHandlers()

  ipcMain.handle('settings:get', () => settings)
  ipcMain.handle('break:status:get', () => getBreakStatus())
  ipcMain.handle('alarm:preview', (_, payload: unknown) => {
    const p = payload && typeof payload === 'object' ? (payload as { reason?: unknown }) : {}
    const reason: AlarmReason = p.reason === 'alarm' ? 'alarm' : 'break'
    previewAlarm(reason)
  })
  ipcMain.handle('settings:update', (_, patch: SettingsPatch) => {
    settings = applySettingsPatch(patch)
    saveSettingsToDisk(settings)
    applySettingsToRuntime()
    broadcastBreakStatus()
    return settings
  })

  ipcMain.on('alarm:action', (_, payload: unknown) => {
    if (!payload || typeof payload !== 'object') return
    const p = payload as { action?: unknown; minutes?: unknown }
    if (p.action === 'close') dismissAlarmWindows()
    if (p.action === 'snooze') snoozeAlarm(Number(p.minutes))
  })

  screen.on('display-added', () => ensureOverlayWindows())
  screen.on('display-removed', () => ensureOverlayWindows())
  screen.on('display-metrics-changed', () => ensureOverlayWindows())

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
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
