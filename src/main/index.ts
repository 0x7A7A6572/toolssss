import { app, shell, BrowserWindow, ipcMain, screen } from 'electron'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import {
  DEFAULT_SETTINGS,
  type AlarmReason,
  type AppSettings,
  type SettingsPatch
} from '../shared/settings'

let mainWindow: BrowserWindow | null = null

let settings: AppSettings = DEFAULT_SETTINGS
const overlayWindows = new Map<number, BrowserWindow>()
const alarmWindows = new Map<number, BrowserWindow>()

let dailyAlarmTimer: NodeJS.Timeout | undefined
let breakTimer: NodeJS.Timeout | undefined
let snoozeTimer: NodeJS.Timeout | undefined
let lastAlarmPayload: { reason: AlarmReason; title: string; body: string } | null = null

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

  base.eye.enabled = Boolean(obj.eye?.enabled)
  base.eye.opacity = clampNumber(Number(obj.eye?.opacity), 0, 0.7)

  base.alarm.enabled = Boolean(obj.alarm?.enabled)
  base.alarm.time = normalizeTimeString(obj.alarm?.time) ?? base.alarm.time
  base.alarm.label =
    typeof obj.alarm?.label === 'string' && obj.alarm.label.trim()
      ? obj.alarm.label.trim()
      : base.alarm.label

  base.break.enabled = Boolean(obj.break?.enabled)
  base.break.intervalMinutes = clampNumber(Number(obj.break?.intervalMinutes), 5, 240)

  return base
}

function applySettingsPatch(patch: unknown): AppSettings {
  if (!patch || typeof patch !== 'object') return settings
  const p = patch as SettingsPatch
  const next: AppSettings = structuredClone(settings)

  if (p.eye) {
    if (typeof p.eye.enabled === 'boolean') next.eye.enabled = p.eye.enabled
    if (typeof p.eye.opacity === 'number') next.eye.opacity = p.eye.opacity
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

  if (!settings.break.enabled) return
  const intervalMs = settings.break.intervalMinutes * 60 * 1000
  breakTimer = setInterval(() => {
    triggerAlarm('break')
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

  showAlarmWindows(reason, title, body)
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
    if (!win.webContents.isLoading()) win.webContents.send('alarm:show', { reason, title, body })
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
    if (lastAlarmPayload) win.webContents.send('alarm:show', lastAlarmPayload)
    win.show()
    win.focus()
  })

  win.on('closed', () => {
    alarmWindows.delete(display.id)
  })

  return win
}

function dismissAlarmWindows(): void {
  closeWindowMap(alarmWindows)
}

function snoozeAlarm(minutes: number): void {
  dismissAlarmWindows()
  const ms = clampNumber(minutes, 1, 120) * 60 * 1000
  snoozeTimer = setTimeout(() => triggerAlarm('alarm'), ms)
}

function applySettingsToRuntime(): void {
  ensureOverlayWindows()
  ensureDailyAlarmTimer()
  ensureBreakTimer()
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

  ipcMain.handle('settings:get', () => settings)
  ipcMain.handle('settings:update', (_, patch: SettingsPatch) => {
    settings = applySettingsPatch(patch)
    saveSettingsToDisk(settings)
    applySettingsToRuntime()
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
