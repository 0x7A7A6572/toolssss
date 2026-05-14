import type { AppSettings } from '@shared/settings'
import { ipcMain } from 'electron'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

let macShutdownTimer: NodeJS.Timeout | null = null

type ShutdownMode = AppSettings['scheduledTasks']['shutdown']['mode']

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

function computeTargetAtMs(args: {
  mode: ShutdownMode
  timeStr: string
  onceDayOffset: 0 | 1
  now?: Date
}): { ok: true; atMs: number } | { ok: false; message: string } {
  const now = args.now ?? new Date()
  const timeStr = normalizeTimeString(args.timeStr)
  if (!timeStr) return { ok: false, message: '时间格式无效' }
  const [hStr, mStr] = timeStr.split(':')
  const h = Number(hStr)
  const m = Number(mStr)
  const target = new Date(now)
  target.setSeconds(0, 0)
  target.setHours(h, m, 0, 0)

  if (args.mode === 'daily') {
    if (target.getTime() <= now.getTime()) target.setDate(target.getDate() + 1)
    return { ok: true, atMs: target.getTime() }
  }

  target.setDate(target.getDate() + args.onceDayOffset)
  if (target.getTime() <= now.getTime()) return { ok: false, message: '所选时间已过' }
  return { ok: true, atMs: target.getTime() }
}

async function cancelOsShutdown(): Promise<void> {
  if (macShutdownTimer) {
    clearTimeout(macShutdownTimer)
    macShutdownTimer = null
  }
  if (process.platform === 'win32') {
    await execAsync('shutdown /a').catch(() => null)
  } else if (process.platform === 'linux') {
    await execAsync('shutdown -c').catch(() => null)
  }
}

async function scheduleOsShutdown(delayMs: number): Promise<void> {
  const delaySec = Math.max(0, Math.floor(delayMs / 1000))
  await cancelOsShutdown()

  if (process.platform === 'win32') {
    await execAsync(`shutdown /s /t ${delaySec}`)
    return
  }
  if (process.platform === 'darwin') {
    macShutdownTimer = setTimeout(() => {
      execAsync(`osascript -e 'tell app "System Events" to shut down'`).catch(() => null)
    }, delayMs)
    return
  }
  const delayMin = Math.max(0, Math.ceil(delaySec / 60))
  await execAsync(`shutdown -P +${delayMin}`).catch(() => null)
}

export async function applyScheduledTasks(settings: AppSettings): Promise<{
  ok: boolean
  message: string
  nextAtMs: number | null
}> {
  const cfg = settings.scheduledTasks.shutdown
  if (!cfg.enabled) {
    await cancelOsShutdown()
    return { ok: true, message: '未启用', nextAtMs: null }
  }

  const next = computeTargetAtMs({
    mode: cfg.mode,
    timeStr: cfg.time,
    onceDayOffset: cfg.onceDayOffset
  })
  if (!next.ok) {
    await cancelOsShutdown()
    return { ok: false, message: next.message, nextAtMs: null }
  }

  const delayMs = Math.max(0, next.atMs - Date.now())
  await scheduleOsShutdown(delayMs)
  return { ok: true, message: '已生效', nextAtMs: next.atMs }
}

export function registerScheduledTasksHandlers(args: {
  getSettings: () => AppSettings
  setSettings: (next: AppSettings) => void
  saveSettingsToDisk: (next: AppSettings) => void
  broadcastSettingsChanged: (next: AppSettings) => void
}): void {
  ipcMain.handle('scheduled-task:shutdown:get', async () => {
    const s = args.getSettings()
    const cfg = s.scheduledTasks.shutdown
    const next =
      cfg.enabled &&
      computeTargetAtMs({ mode: cfg.mode, timeStr: cfg.time, onceDayOffset: cfg.onceDayOffset })
    return {
      config: cfg,
      nextAtMs: next && next.ok ? next.atMs : null
    }
  })

  ipcMain.handle('scheduled-task:shutdown:set', async (_event, payload: unknown) => {
    const raw = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
    const enabled = typeof raw['enabled'] === 'boolean' ? (raw['enabled'] as boolean) : true
    const mode = raw['mode'] === 'once' || raw['mode'] === 'daily' ? (raw['mode'] as ShutdownMode) : null
    const time = normalizeTimeString(raw['timeStr'] ?? raw['time']) ?? null
    const onceDayOffset = raw['onceDayOffset'] === 0 || raw['onceDayOffset'] === 1 ? (raw['onceDayOffset'] as 0 | 1) : null

    const nextSettings: AppSettings = structuredClone(args.getSettings())
    nextSettings.scheduledTasks.shutdown.enabled = enabled
    if (mode) nextSettings.scheduledTasks.shutdown.mode = mode
    if (time) nextSettings.scheduledTasks.shutdown.time = time
    if (onceDayOffset !== null) nextSettings.scheduledTasks.shutdown.onceDayOffset = onceDayOffset

    args.setSettings(nextSettings)
    args.saveSettingsToDisk(nextSettings)
    args.broadcastSettingsChanged(nextSettings)

    const applied = await applyScheduledTasks(nextSettings)
    return {
      success: applied.ok,
      message: applied.message,
      config: nextSettings.scheduledTasks.shutdown,
      nextAtMs: applied.nextAtMs
    }
  })

  ipcMain.handle('scheduled-task:shutdown:cancel', async () => {
    const nextSettings: AppSettings = structuredClone(args.getSettings())
    nextSettings.scheduledTasks.shutdown.enabled = false
    args.setSettings(nextSettings)
    args.saveSettingsToDisk(nextSettings)
    args.broadcastSettingsChanged(nextSettings)
    await cancelOsShutdown()
    return { success: true, message: '已取消', config: nextSettings.scheduledTasks.shutdown, nextAtMs: null }
  })
}
