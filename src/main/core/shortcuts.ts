import { globalShortcut } from 'electron'
import type { AppSettings } from '@shared/settings'

type RegisterArgs = {
  getSettings: () => AppSettings
  commitSettings: (next: AppSettings) => void
  ensureOverlayWindows: () => void
  openTranslatorPopupFromSelection: () => Promise<void>
  openQuickStickyNoteEditor: () => void
  startSnipCapture: () => void
  pasteStickerFromClipboard: () => void
  toggleStickersHidden: () => void
  isSnipCapturing: () => boolean
  snipDbg: (...args: unknown[]) => void
  stashForegroundToEdge: (edge: 'left' | 'top' | 'right' | 'bottom') => Promise<void>
  toggleTopmostWindowAtCursor: () => Promise<void>
}

function isEnabled(settings: AppSettings, name: string): boolean {
  const se = (settings as { shortcutsEnabled?: unknown }).shortcutsEnabled
  if (!se || typeof se !== 'object') return true
  const v = (se as Record<string, unknown>)[name]
  return typeof v === 'boolean' ? v : true
}

export function registerShortcuts(args: RegisterArgs): void {
  globalShortcut.unregisterAll()

  const settings = args.getSettings()

  const conflicts: Record<string, string[]> = {}
  const entries: Array<{ name: string; acc: string }> = []
  for (const [name, raw] of Object.entries(settings.shortcuts ?? ({} as Record<string, unknown>))) {
    if (!isEnabled(settings, name)) continue
    if (typeof raw !== 'string') continue
    const acc = raw.trim()
    if (!acc) continue
    entries.push({ name, acc })
  }
  for (const { name, acc } of entries) {
    const k = acc.toLowerCase()
    const arr = conflicts[k] ?? (conflicts[k] = [])
    arr.push(name)
  }
  const dup = Object.entries(conflicts).filter(([, names]) => names.length > 1)
  if (dup.length) {
    console.warn(
      'Shortcut conflicts detected:',
      dup.map(([acc, names]) => ({ acc, keys: names }))
    )
  }

  if (isEnabled(settings, 'toggleEye') && settings.shortcuts.toggleEye) {
    try {
      globalShortcut.register(settings.shortcuts.toggleEye, () => {
        const next: AppSettings = structuredClone(args.getSettings())
        next.eye.enabled = !next.eye.enabled
        args.commitSettings(next)
        args.ensureOverlayWindows()
      })
    } catch (e) {
      console.error('Failed to register shortcut:', settings.shortcuts.toggleEye, e)
    }
  }

  if (
    isEnabled(settings, 'translateSelection') &&
    (settings.shortcuts as Record<string, unknown>).translateSelection
  ) {
    const acc = (settings.shortcuts as Record<string, string>).translateSelection
    if (acc) {
      try {
        globalShortcut.register(acc, async () => {
          await args.openTranslatorPopupFromSelection()
        })
      } catch (e) {
        console.error('Failed to register shortcut:', acc, e)
      }
    }
  }

  if (
    isEnabled(settings, 'stickyNotesPopup') &&
    (settings.shortcuts as Record<string, unknown>).stickyNotesPopup
  ) {
    const acc = (settings.shortcuts as Record<string, string>).stickyNotesPopup
    if (acc) {
      try {
        globalShortcut.register(acc, () => args.openQuickStickyNoteEditor())
      } catch (e) {
        console.error('Failed to register shortcut:', acc, e)
      }
    }
  }

  if (isEnabled(settings, 'snipStart') && (settings.shortcuts as Record<string, unknown>).snipStart) {
    const acc = (settings.shortcuts as Record<string, string>).snipStart
    if (acc) {
      try {
        globalShortcut.register(acc, () => args.startSnipCapture())
      } catch (e) {
        console.error('Failed to register shortcut:', acc, e)
      }
    }
  }

  if (isEnabled(settings, 'stickerPaste') && (settings.shortcuts as Record<string, unknown>).stickerPaste) {
    const acc = (settings.shortcuts as Record<string, string>).stickerPaste
    if (acc) {
      try {
        if (!args.isSnipCapturing()) {
          globalShortcut.register(acc, () => args.pasteStickerFromClipboard())
        } else {
          args.snipDbg('skip register stickerPaste during snip', acc)
        }
      } catch (e) {
        console.error('Failed to register shortcut:', acc, e)
      }
    }
  }

  if (
    isEnabled(settings, 'stickersToggleHidden') &&
    (settings.shortcuts as Record<string, unknown>).stickersToggleHidden
  ) {
    const acc = (settings.shortcuts as Record<string, string>).stickersToggleHidden
    if (acc) {
      try {
        if (!args.isSnipCapturing()) {
          globalShortcut.register(acc, () => args.toggleStickersHidden())
        } else {
          args.snipDbg('skip register stickersToggleHidden during snip', acc)
        }
      } catch (e) {
        console.error('Failed to register shortcut:', acc, e)
      }
    }
  }

  const stashShortcuts = [
    {
      name: 'stashLeft',
      acc: (settings.shortcuts as Record<string, string>).stashLeft,
      edge: 'left' as const
    },
    {
      name: 'stashTop',
      acc: (settings.shortcuts as Record<string, string>).stashTop,
      edge: 'top' as const
    },
    {
      name: 'stashRight',
      acc: (settings.shortcuts as Record<string, string>).stashRight,
      edge: 'right' as const
    },
    {
      name: 'stashBottom',
      acc: (settings.shortcuts as Record<string, string>).stashBottom,
      edge: 'bottom' as const
    }
  ]
  for (const it of stashShortcuts) {
    if (!isEnabled(settings, it.name)) continue
    const acc = typeof it.acc === 'string' ? it.acc.trim() : ''
    if (!acc) continue
    try {
      globalShortcut.register(acc, async () => {
        await args.stashForegroundToEdge(it.edge)
      })
    } catch (e) {
      console.error('Failed to register shortcut:', acc, e)
    }
  }

  if (
    isEnabled(settings, 'toggleTopmostWindow') &&
    (settings.shortcuts as Record<string, unknown>).toggleTopmostWindow
  ) {
    const acc = (settings.shortcuts as Record<string, string>).toggleTopmostWindow
    if (acc) {
      try {
        globalShortcut.register(acc, async () => {
          await args.toggleTopmostWindowAtCursor()
        })
      } catch (e) {
        console.error('Failed to register shortcut:', acc, e)
      }
    }
  }
}
