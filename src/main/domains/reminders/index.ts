import { exec } from 'child_process'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { promisify } from 'util'
import { app, BrowserWindow, ipcMain, screen } from 'electron'
import type { AlarmReason, AppSettings } from '@shared/settings'
import { clampNumber, normalizeTimeString } from '@main-shared/primitives'

const execAsync = promisify(exec)

export function createRemindersDomain(deps: {
  icon: string
  loadWindow: (win: BrowserWindow, query: Record<string, string>) => Promise<void>
  getSettings: () => AppSettings
  getMainWindow: () => BrowserWindow | null
}): {
  applySettingsToRuntime: () => void
  getBreakStatus: () => { enabled: boolean; intervalMinutes: number; nextAt: number | null }
  broadcastBreakStatus: () => void
  registerIpcHandlers: () => void
} {
  const alarmWindows = new Map<number, BrowserWindow>()
  let dailyAlarmTimer: NodeJS.Timeout | undefined
  let breakTimer: NodeJS.Timeout | undefined
  let snoozeTimer: NodeJS.Timeout | undefined
  let lastAlarmPayload: {
    reason: AlarmReason
    title: string
    body: string
    closeOnEnd: boolean
  } | null = null
  let breakNextAt: number | null = null
  let restTipsCache: string[] | null = null

  function closeWindowMap(map: Map<number, BrowserWindow>): void {
    for (const win of map.values()) {
      if (!win.isDestroyed()) win.close()
    }
    map.clear()
  }

  function getBreakStatus(): { enabled: boolean; intervalMinutes: number; nextAt: number | null } {
    const settings = deps.getSettings()
    return {
      enabled: settings.break.enabled,
      intervalMinutes: settings.break.intervalMinutes,
      nextAt: breakNextAt
    }
  }

  function broadcastBreakStatus(): void {
    const mainWindow = deps.getMainWindow()
    if (!mainWindow || mainWindow.isDestroyed()) return
    if (mainWindow.webContents.isLoading()) return
    mainWindow.webContents.send('break:status', getBreakStatus())
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

    const settings = deps.getSettings()
    if (!settings.alarm.enabled) return
    const delay = nextDailyAlarmDelayMs(settings.alarm.time)
    if (delay === null) return

    dailyAlarmTimer = setTimeout(() => {
      triggerAlarm('alarm')
      ensureDailyAlarmTimer()
    }, delay)
  }

  function ensureBreakTimer(): void {
    if (breakTimer) clearTimeout(breakTimer)
    breakTimer = undefined

    const settings = deps.getSettings()
    if (!settings.break.enabled) {
      breakNextAt = null
      broadcastBreakStatus()
      return
    }
    const intervalMs = settings.break.intervalMinutes * 60 * 1000
    scheduleBreak(intervalMs, intervalMs)
  }

  function scheduleBreak(delayMs: number, intervalMs: number): void {
    if (breakTimer) clearTimeout(breakTimer)
    breakTimer = undefined
    breakNextAt = Date.now() + delayMs
    broadcastBreakStatus()
    breakTimer = setTimeout(() => {
      void triggerBreakFromTimer(intervalMs)
    }, delayMs)
  }

  async function triggerBreakFromTimer(intervalMs: number): Promise<void> {
    const settings = deps.getSettings()
    if (!settings.break.enabled) return

    if (settings.break.disableInFullscreen) {
      const fullscreen = await isForegroundFullscreenWindows()
      if (fullscreen) {
        scheduleBreak(5 * 60 * 1000, intervalMs)
        return
      }
    }

    showAlarmWindows('break', '休息提醒', pickRestTip())
    scheduleBreak(intervalMs, intervalMs)
  }

  function resolveRestTipsFilePath(): string | null {
    const candidates: string[] = []
    if (process.env['ELECTRON_RENDERER_URL']) {
      candidates.push(join(process.cwd(), 'src', 'libs', 'rest-tips.json'))
      candidates.push(join(app.getAppPath(), 'src', 'libs', 'rest-tips.json'))
    } else {
      candidates.push(join(process.resourcesPath, 'rest-tips.json'))
      candidates.push(join(app.getAppPath(), 'rest-tips.json'))
    }

    for (const p of candidates) {
      try {
        if (existsSync(p)) return p
      } catch {
        void 0
      }
    }
    return null
  }

  function loadRestTips(): string[] {
    if (restTipsCache) return restTipsCache
    const p = resolveRestTipsFilePath()
    if (!p) return []
    try {
      const raw = readFileSync(p, 'utf-8')
      const parsed = JSON.parse(raw) as unknown
      if (!Array.isArray(parsed)) return []
      const out = parsed.filter((v) => typeof v === 'string' && v.trim()) as string[]
      restTipsCache = out
      return out
    } catch {
      return []
    }
  }

  function pickRestTip(): string {
    const tips = loadRestTips()
    if (!tips.length) return '休息一下，看看远处 20 秒，眨眨眼。'
    const idx = Math.floor(Math.random() * tips.length)
    const v = tips[idx]?.trim() ?? ''
    return v || '休息一下，看看远处 20 秒，眨眨眼。'
  }

  function triggerAlarm(reason: AlarmReason): void {
    if (snoozeTimer) {
      clearTimeout(snoozeTimer)
      snoozeTimer = undefined
    }

    const settings = deps.getSettings()
    const title = reason === 'alarm' ? settings.alarm.label : '休息提醒'
    const body = reason === 'alarm' ? `现在时间：${settings.alarm.time}` : pickRestTip()

    showAlarmWindows(reason, title, body)
  }

  async function isForegroundFullscreenWindows(): Promise<boolean> {
    if (process.platform !== 'win32') return false
    try {
      const script = `
      Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class WinApi {
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")]
  public static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint dwFlags);
  [DllImport("user32.dll", CharSet = CharSet.Auto)]
  public static extern bool GetMonitorInfo(IntPtr hMonitor, ref MONITORINFO lpmi);

  [StructLayout(LayoutKind.Sequential)]
  public struct RECT {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
  }

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
  public struct MONITORINFO {
    public int cbSize;
    public RECT rcMonitor;
    public RECT rcWork;
    public uint dwFlags;
  }
}
'@
      $hwnd = [WinApi]::GetForegroundWindow()
      $rect = New-Object WinApi+RECT
      [WinApi]::GetWindowRect($hwnd, [ref]$rect) | Out-Null
      $mon = [WinApi]::MonitorFromWindow($hwnd, 2)
      $mi = New-Object WinApi+MONITORINFO
      $mi.cbSize = [System.Runtime.InteropServices.Marshal]::SizeOf($mi)
      [WinApi]::GetMonitorInfo($mon, [ref]$mi) | Out-Null
      $obj = [pscustomobject]@{
        left = $rect.Left
        top = $rect.Top
        right = $rect.Right
        bottom = $rect.Bottom
        monLeft = $mi.rcMonitor.Left
        monTop = $mi.rcMonitor.Top
        monRight = $mi.rcMonitor.Right
        monBottom = $mi.rcMonitor.Bottom
      }
      $obj | ConvertTo-Json -Compress
    `
      const encoded = Buffer.from(script, 'utf16le').toString('base64')
      const { stdout } = await execAsync(`powershell -EncodedCommand ${encoded}`)
      const raw = stdout.trim()
      if (!raw) return false
      const p = JSON.parse(raw) as Record<string, unknown>
      const left = Number(p['left'])
      const top = Number(p['top'])
      const right = Number(p['right'])
      const bottom = Number(p['bottom'])
      const monLeft = Number(p['monLeft'])
      const monTop = Number(p['monTop'])
      const monRight = Number(p['monRight'])
      const monBottom = Number(p['monBottom'])
      if (![left, top, right, bottom, monLeft, monTop, monRight, monBottom].every(Number.isFinite))
        return false

      const tol = 4
      const w = Math.max(0, right - left)
      const h = Math.max(0, bottom - top)
      const mw = Math.max(0, monRight - monLeft)
      const mh = Math.max(0, monBottom - monTop)
      if (mw <= 0 || mh <= 0 || w <= 0 || h <= 0) return false

      const covers =
        left <= monLeft + tol &&
        top <= monTop + tol &&
        right >= monRight - tol &&
        bottom >= monBottom - tol
      if (covers) return true

      const areaRatio = (w * h) / (mw * mh)
      const sizeOk = w >= mw * 0.98 && h >= mh * 0.98
      return areaRatio >= 0.98 && sizeOk
    } catch (e) {
      console.error('Failed to check fullscreen:', e)
      return false
    }
  }

  function showAlarmWindows(reason: AlarmReason, title: string, body: string): void {
    const settings = deps.getSettings()
    const closeOnEnd = reason === 'break' ? settings.break.closeOnEnd : true
    lastAlarmPayload = { reason, title, body, closeOnEnd }

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
          closeOnEnd,
          timeoutSec: settings.reminderSeconds
        })
      if (!win.isVisible()) win.show()
      try {
        win.setAlwaysOnTop(true, 'screen-saver')
        win.moveTop()
        win.setKiosk(true)
        win.setFullScreen(true)
      } catch {
        void 0
      }
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
      fullscreen: false,
      kiosk: true,
      skipTaskbar: true,
      alwaysOnTop: true,
      backgroundColor: '#111827',
      ...(process.platform === 'linux' ? { icon: deps.icon } : {}),
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: true
      }
    })

    win.setAlwaysOnTop(true, 'screen-saver')
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

    deps.loadWindow(win, { mode: 'alarm' }).catch(() => null)

    win.webContents.once('did-finish-load', () => {
      const settings = deps.getSettings()
      if (lastAlarmPayload)
        win.webContents.send('alarm:show', {
          ...lastAlarmPayload,
          timeoutSec: settings.reminderSeconds
        })
      try {
        win.setBounds(display.bounds, false)
      } catch {
        void 0
      }
      win.show()
      try {
        app.focus()
      } catch {
        void 0
      }
      win.setAlwaysOnTop(true, 'screen-saver')
      win.moveTop()
      win.focus()
      win.setKiosk(true)
      win.setFullScreen(true)
      try {
        win.webContents.focus()
      } catch {
        void 0
      }
    })

    win.on('closed', () => {
      alarmWindows.delete(display.id)
    })

    return win
  }

  function previewAlarm(reason: AlarmReason): void {
    const settings = deps.getSettings()
    const title = reason === 'alarm' ? settings.alarm.label : '休息提醒'
    const body = reason === 'alarm' ? `现在时间：${settings.alarm.time}` : pickRestTip()
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

  function applySettingsToRuntime(): void {
    ensureDailyAlarmTimer()
    ensureBreakTimer()
  }

  function registerIpcHandlers(): void {
    ipcMain.handle('break:status:get', () => getBreakStatus())
    ipcMain.handle('alarm:preview', (_event, payload: unknown) => {
      const p = payload && typeof payload === 'object' ? (payload as { reason?: unknown }) : {}
      const reason: AlarmReason = p.reason === 'alarm' ? 'alarm' : 'break'
      previewAlarm(reason)
    })

    ipcMain.on('alarm:action', (_event, payload: unknown) => {
      if (!payload || typeof payload !== 'object') return
      const p = payload as { action?: unknown; minutes?: unknown }
      if (p.action === 'close') dismissAlarmWindows()
      if (p.action === 'snooze') snoozeAlarm(Number(p.minutes))
    })
  }

  return { applySettingsToRuntime, getBreakStatus, broadcastBreakStatus, registerIpcHandlers }
}
