import { app } from 'electron'
import type { AppSettings } from '@shared/settings'

export function ensureAutoStart(settings: AppSettings): void {
  if (process.platform === 'linux') return

  const desired = Boolean(settings.general.autoStart)
  const openAsHidden = Boolean(settings.general.minimizeToTray)

  try {
    const args = process.argv.slice(1).filter((v) => v !== '--autostart')
    if (desired) args.unshift('--autostart')
    app.setLoginItemSettings({
      openAtLogin: desired,
      openAsHidden,
      path: process.execPath,
      args: desired ? args : []
    })
  } catch {
    return
  }
}
