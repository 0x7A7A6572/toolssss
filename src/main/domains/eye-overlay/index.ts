import { BrowserWindow, screen } from 'electron'
import { join } from 'path'
import type { AppSettings } from '@shared/settings'

export function createEyeOverlayDomain(deps: {
  icon: string
  loadWindow: (win: BrowserWindow, query: Record<string, string>) => Promise<void>
  getSettings: () => AppSettings
}): {
  ensureWindows: () => void
  broadcastSettings: () => void
  suspendForSnip: () => void
  resumeAfterSnip: () => void
} {
  const overlayWindows = new Map<number, BrowserWindow>()
  let overlaySuspended = false

  function closeWindowMap(map: Map<number, BrowserWindow>): void {
    for (const win of map.values()) {
      if (!win.isDestroyed()) win.close()
    }
    map.clear()
  }

  function broadcastSettings(): void {
    const settings = deps.getSettings()
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
      ...(process.platform === 'linux' ? { icon: deps.icon } : {}),
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: true
      }
    })

    win.setAlwaysOnTop(true, 'screen-saver', 20)
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    win.setIgnoreMouseEvents(true, { forward: true })

    deps.loadWindow(win, { mode: 'overlay' }).catch(() => null)

    win.webContents.once('did-finish-load', () => {
      broadcastSettings()
      if (!overlaySuspended) win.showInactive()
    })

    return win
  }

  function ensureWindows(): void {
    const settings = deps.getSettings()
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

    broadcastSettings()
  }

  function suspendForSnip(): void {
    const settings = deps.getSettings()
    if (!settings.eye.enabled) return
    if (!settings.snip.suspendEyeOverlay) return
    if (overlaySuspended) return
    overlaySuspended = true
    for (const win of overlayWindows.values()) {
      if (win.isDestroyed()) continue
      win.hide()
    }
  }

  function resumeAfterSnip(): void {
    if (!overlaySuspended) return
    overlaySuspended = false
    ensureWindows()
    const settings = deps.getSettings()
    if (!settings.eye.enabled) return
    for (const win of overlayWindows.values()) {
      if (win.isDestroyed()) continue
      win.showInactive()
    }
  }

  return { ensureWindows, broadcastSettings, suspendForSnip, resumeAfterSnip }
}
