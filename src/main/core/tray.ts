import { app, BrowserWindow, Menu, Tray } from 'electron'
import type { AppSettings } from '@shared/settings'

type Deps = {
  icon: string
  tray: Tray | null
  getMainWindow: () => BrowserWindow | null
  createMainWindow: () => void
  setIsQuitting: (next: boolean) => void
}

export function syncTray(deps: Deps, settings: AppSettings): Tray | null {
  if (settings.general.minimizeToTray) {
    if (deps.tray) return deps.tray
    const tray = new Tray(deps.icon)

    const showApp = (): void => {
      const win = deps.getMainWindow()
      if (win && !win.isDestroyed()) {
        if (win.isMinimized()) win.restore()
        win.show()
        win.focus()
      } else {
        deps.createMainWindow()
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
          deps.setIsQuitting(true)
          app.quit()
        }
      }
    ])
    tray.setToolTip('Forge Studio')
    tray.setContextMenu(contextMenu)
    tray.on('click', showApp)
    tray.on('double-click', showApp)
    return tray
  }

  if (deps.tray) {
    deps.tray.destroy()
  }
  return null
}
