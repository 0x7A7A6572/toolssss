import { app } from 'electron'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import {
  DEFAULT_SETTINGS,
  type AppSettings,
  type RagRuntimeConfig,
  type SettingsPatch
} from '@shared/settings'
import { clampNumber, normalizeTimeString } from '@main-shared/primitives'
import type { AgentConfig, KnowledgeBaseConfig } from '@shared/agents'
import { migrateLegacyKnowledgeBases } from './legacy-agent-kb-migration'

function settingsFilePath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

function normalizeKnowledgeBase(input: unknown): KnowledgeBaseConfig | null {
  if (!input || typeof input !== 'object') return null
  const raw = input as Record<string, unknown>
  const id = typeof raw['id'] === 'string' ? raw['id'].trim() : ''
  const name = typeof raw['name'] === 'string' ? raw['name'].trim() : ''
  if (!id || !name) return null
  return {
    id,
    name,
    docCount:
      typeof raw['docCount'] === 'number'
        ? raw['docCount']
        : Array.isArray(raw['docs'])
          ? raw['docs'].length
          : 0,
    indexedAt: typeof raw['indexedAt'] === 'number' ? raw['indexedAt'] : null
  }
}

function normalizeRagRuntimeConfig(input: unknown): Partial<RagRuntimeConfig> {
  if (!input || typeof input !== 'object') return {}
  const raw = input as Record<string, unknown>
  return {
    topK: typeof raw['topK'] === 'number' ? clampNumber(raw['topK'], 1, 20) : undefined,
    chunkSize:
      typeof raw['chunkSize'] === 'number' ? clampNumber(raw['chunkSize'], 100, 4000) : undefined,
    chunkOverlap:
      typeof raw['chunkOverlap'] === 'number'
        ? clampNumber(raw['chunkOverlap'], 0, 1000)
        : undefined
  }
}

function extractLegacyKnowledgeBases(input: unknown): unknown[] {
  if (!input || typeof input !== 'object') return []
  const agents = (input as { agents?: unknown }).agents
  if (!agents || typeof agents !== 'object') return []
  const knowledgeBases = (agents as { knowledgeBases?: unknown }).knowledgeBases
  if (!Array.isArray(knowledgeBases)) return []
  return knowledgeBases.filter((item) => {
    if (!item || typeof item !== 'object') return false
    return Array.isArray((item as { docs?: unknown }).docs)
  })
}

function normalizeAgentConfig(input: unknown): AgentConfig | null {
  if (!input || typeof input !== 'object') return null
  const raw = input as Record<string, unknown>
  const id = typeof raw['id'] === 'string' ? raw['id'].trim() : ''
  const name = typeof raw['name'] === 'string' ? raw['name'].trim() : ''
  if (!id || !name) return null
  return {
    id,
    name,
    systemPrompt: typeof raw['systemPrompt'] === 'string' ? raw['systemPrompt'] : '',
    knowledgeBaseId:
      typeof raw['knowledgeBaseId'] === 'string' ? raw['knowledgeBaseId'].trim() || null : null,
    createdAt: typeof raw['createdAt'] === 'number' ? raw['createdAt'] : Date.now(),
    updatedAt: typeof raw['updatedAt'] === 'number' ? raw['updatedAt'] : Date.now()
  }
}

export function normalizeSettings(input: unknown): AppSettings {
  const base = structuredClone(DEFAULT_SETTINGS)
  if (!input || typeof input !== 'object') return base
  const obj = input as Partial<AppSettings>

  if (obj.general) {
    base.general.minimizeToTray = Boolean(obj.general.minimizeToTray)
    base.general.autoStart = Boolean(obj.general.autoStart)
  }

  if (obj.snip) {
    base.snip.provider = 'app'
    base.snip.saveDir = typeof obj.snip.saveDir === 'string' ? obj.snip.saveDir : base.snip.saveDir
    const sn = obj.snip as Record<string, unknown>
    const suspendEyeOverlay = sn['suspendEyeOverlay']
    if (typeof suspendEyeOverlay === 'boolean') {
      base.snip.suspendEyeOverlay = suspendEyeOverlay
    } else {
      const eye = obj.eye as Record<string, unknown> | undefined
      const legacySuspendOnSnip = eye?.['suspendOnSnip']
      if (typeof legacySuspendOnSnip === 'boolean')
        base.snip.suspendEyeOverlay = legacySuspendOnSnip
    }
  }

  if (
    (obj as { stickyNotes?: unknown }).stickyNotes &&
    typeof (obj as { stickyNotes?: unknown }).stickyNotes === 'object'
  ) {
    const sn = (obj as { stickyNotes: Record<string, unknown> }).stickyNotes
    base.stickyNotes.saveDir =
      typeof sn['saveDir'] === 'string' ? (sn['saveDir'] as string) : base.stickyNotes.saveDir
  }

  if (obj.shortcuts) {
    if (typeof obj.shortcuts.toggleEye === 'string')
      base.shortcuts.toggleEye = obj.shortcuts.toggleEye
    if (typeof (obj.shortcuts as Record<string, unknown>).translateSelection === 'string')
      base.shortcuts.translateSelection = (
        obj.shortcuts as Record<string, string>
      ).translateSelection
    if (typeof (obj.shortcuts as Record<string, unknown>).stickyNotesPopup === 'string')
      base.shortcuts.stickyNotesPopup = (obj.shortcuts as Record<string, string>).stickyNotesPopup
    if (typeof (obj.shortcuts as Record<string, unknown>).snipStart === 'string')
      base.shortcuts.snipStart = (obj.shortcuts as Record<string, string>).snipStart
    if (typeof (obj.shortcuts as Record<string, unknown>).stickerPaste === 'string')
      base.shortcuts.stickerPaste = (obj.shortcuts as Record<string, string>).stickerPaste
    if (typeof (obj.shortcuts as Record<string, unknown>).stickersToggleHidden === 'string')
      base.shortcuts.stickersToggleHidden = (
        obj.shortcuts as Record<string, string>
      ).stickersToggleHidden
    if (typeof (obj.shortcuts as Record<string, unknown>).stashLeft === 'string')
      base.shortcuts.stashLeft = (obj.shortcuts as Record<string, string>).stashLeft
    if (typeof (obj.shortcuts as Record<string, unknown>).stashTop === 'string')
      base.shortcuts.stashTop = (obj.shortcuts as Record<string, string>).stashTop
    if (typeof (obj.shortcuts as Record<string, unknown>).stashRight === 'string')
      base.shortcuts.stashRight = (obj.shortcuts as Record<string, string>).stashRight
    if (typeof (obj.shortcuts as Record<string, unknown>).stashBottom === 'string')
      base.shortcuts.stashBottom = (obj.shortcuts as Record<string, string>).stashBottom
    if (typeof (obj.shortcuts as Record<string, unknown>).toggleTopmostWindow === 'string')
      base.shortcuts.toggleTopmostWindow = (
        obj.shortcuts as Record<string, string>
      ).toggleTopmostWindow
  }

  const se = (obj as { shortcutsEnabled?: unknown }).shortcutsEnabled
  if (se && typeof se === 'object') {
    const m = se as Record<string, unknown>
    if (typeof m['toggleEye'] === 'boolean')
      base.shortcutsEnabled.toggleEye = m['toggleEye'] as boolean
    if (typeof m['translateSelection'] === 'boolean')
      base.shortcutsEnabled.translateSelection = m['translateSelection'] as boolean
    if (typeof m['stickyNotesPopup'] === 'boolean')
      base.shortcutsEnabled.stickyNotesPopup = m['stickyNotesPopup'] as boolean
    if (typeof m['snipStart'] === 'boolean')
      base.shortcutsEnabled.snipStart = m['snipStart'] as boolean
    if (typeof m['stickerPaste'] === 'boolean')
      base.shortcutsEnabled.stickerPaste = m['stickerPaste'] as boolean
    if (typeof m['stickersToggleHidden'] === 'boolean')
      base.shortcutsEnabled.stickersToggleHidden = m['stickersToggleHidden'] as boolean
    if (typeof m['stashLeft'] === 'boolean')
      base.shortcutsEnabled.stashLeft = m['stashLeft'] as boolean
    if (typeof m['stashTop'] === 'boolean')
      base.shortcutsEnabled.stashTop = m['stashTop'] as boolean
    if (typeof m['stashRight'] === 'boolean')
      base.shortcutsEnabled.stashRight = m['stashRight'] as boolean
    if (typeof m['stashBottom'] === 'boolean')
      base.shortcutsEnabled.stashBottom = m['stashBottom'] as boolean
    if (typeof m['toggleTopmostWindow'] === 'boolean')
      base.shortcutsEnabled.toggleTopmostWindow = m['toggleTopmostWindow'] as boolean
  }

  if (
    (obj as { translate?: unknown }).translate &&
    typeof (obj as { translate?: unknown }).translate === 'object'
  ) {
    const tr = (obj as { translate: Record<string, unknown> }).translate
    const provider = tr['provider']
    if (provider === 'baidu' || provider === 'bing' || provider === 'ai')
      base.translate.provider = provider
    if (typeof tr['defaultSource'] === 'string')
      base.translate.defaultSource = tr['defaultSource'].trim()
    if (typeof tr['defaultTarget'] === 'string')
      base.translate.defaultTarget = tr['defaultTarget'].trim()

    const baidu = tr['baidu']
    if (baidu && typeof baidu === 'object') {
      const b = baidu as Record<string, unknown>
      if (typeof b['baseUrl'] === 'string') base.translate.baidu.baseUrl = b['baseUrl'].trim()
      if (typeof b['appId'] === 'string') base.translate.baidu.appId = b['appId'].trim()
      if (typeof b['secret'] === 'string') base.translate.baidu.secret = b['secret']
    } else {
      const legacyBaseUrl = tr['baseUrl']
      if (typeof legacyBaseUrl === 'string' && legacyBaseUrl.trim())
        base.translate.baidu.baseUrl = legacyBaseUrl.trim()
      const legacyKey = tr['apiKey']
      if (typeof legacyKey === 'string') base.translate.baidu.secret = legacyKey
      const legacyAppId = tr['appId']
      if (typeof legacyAppId === 'string') base.translate.baidu.appId = legacyAppId.trim()
    }

    const bing = tr['bing']
    if (bing && typeof bing === 'object') {
      const b = bing as Record<string, unknown>
      if (typeof b['baseUrl'] === 'string') base.translate.bing.baseUrl = b['baseUrl'].trim()
      if (typeof b['key'] === 'string') base.translate.bing.key = b['key']
      if (typeof b['region'] === 'string') base.translate.bing.region = b['region'].trim()
    }
  }

  if ((obj as { ai?: unknown }).ai && typeof (obj as { ai?: unknown }).ai === 'object') {
    const ai = (obj as { ai: Record<string, unknown> }).ai
    base.ai.enabled = Boolean(ai['enabled'])
    if (typeof ai['searchMcpCommand'] === 'string' && (ai['searchMcpCommand'] as string).trim())
      base.ai.searchMcpCommand = (ai['searchMcpCommand'] as string).trim()
  }

  if (
    (obj as { funFact?: unknown }).funFact &&
    typeof (obj as { funFact?: unknown }).funFact === 'object'
  ) {
    const ff = (obj as { funFact: Record<string, unknown> }).funFact
    if (typeof ff['title'] === 'string' && ff['title'].trim())
      base.funFact.title = ff['title'].trim()
    if (typeof ff['prompt'] === 'string' && ff['prompt'].trim()) base.funFact.prompt = ff['prompt']
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
  base.break.closeOnEnd =
    typeof (obj.break as { closeOnEnd?: unknown } | undefined)?.closeOnEnd === 'boolean'
      ? (obj.break as { closeOnEnd: boolean }).closeOnEnd
      : base.break.closeOnEnd

  if (
    (obj as { scheduledTasks?: unknown }).scheduledTasks &&
    typeof (obj as { scheduledTasks?: unknown }).scheduledTasks === 'object'
  ) {
    const st = (obj as { scheduledTasks: Record<string, unknown> }).scheduledTasks
    const shutdown = st['shutdown']
    if (shutdown && typeof shutdown === 'object') {
      const sd = shutdown as Record<string, unknown>
      if (typeof sd['enabled'] === 'boolean')
        base.scheduledTasks.shutdown.enabled = sd['enabled'] as boolean
      const mode = sd['mode']
      if (mode === 'once' || mode === 'daily') base.scheduledTasks.shutdown.mode = mode
      const time = normalizeTimeString(sd['time'])
      if (time) base.scheduledTasks.shutdown.time = time
      const dayOffset = sd['onceDayOffset']
      if (dayOffset === 0 || dayOffset === 1) base.scheduledTasks.shutdown.onceDayOffset = dayOffset
    }
  }

  if (
    (obj as { windowStash?: unknown }).windowStash &&
    typeof (obj as { windowStash?: unknown }).windowStash === 'object'
  ) {
    const ws = (obj as { windowStash: Record<string, unknown> }).windowStash
    const colors = ws['handleColors']
    if (colors && typeof colors === 'object') {
      const c = colors as Record<string, unknown>
      const left = typeof c['left'] === 'string' ? c['left'].trim() : ''
      const top = typeof c['top'] === 'string' ? c['top'].trim() : ''
      const right = typeof c['right'] === 'string' ? c['right'].trim() : ''
      const bottom = typeof c['bottom'] === 'string' ? c['bottom'].trim() : ''
      if (left) base.windowStash.handleColors.left = left
      if (top) base.windowStash.handleColors.top = top
      if (right) base.windowStash.handleColors.right = right
      if (bottom) base.windowStash.handleColors.bottom = bottom
    }
    if (typeof ws['handleOpacity'] === 'number')
      base.windowStash.handleOpacity = clampNumber(Number(ws['handleOpacity']), 0, 1)
    if (typeof ws['showHandleTitle'] === 'boolean')
      base.windowStash.showHandleTitle = ws['showHandleTitle'] as boolean
    if (typeof ws['showHandleDrag'] === 'boolean')
      base.windowStash.showHandleDrag = ws['showHandleDrag'] as boolean
    if (typeof ws['animate'] === 'boolean') base.windowStash.animate = ws['animate'] as boolean
    if (typeof ws['durationMs'] === 'number')
      base.windowStash.durationMs = clampNumber(Number(ws['durationMs']), 60, 1200)
    if (typeof ws['topmostHighlightEnabled'] === 'boolean')
      base.windowStash.topmostHighlightEnabled = ws['topmostHighlightEnabled'] as boolean
    if (typeof ws['topmostBorderColor'] === 'string') {
      const c = (ws['topmostBorderColor'] as string).trim()
      if (c) base.windowStash.topmostBorderColor = c
    }
    if (typeof ws['topmostBorderWidth'] === 'number')
      base.windowStash.topmostBorderWidth = clampNumber(Number(ws['topmostBorderWidth']), 1, 16)
  }

  if (
    (obj as { agents?: unknown }).agents &&
    typeof (obj as { agents?: unknown }).agents === 'object'
  ) {
    const agents = (obj as { agents: Record<string, unknown> }).agents
    if (Array.isArray(agents['configs'])) {
      base.agents.configs = (agents['configs'] as unknown[])
        .map((item) => normalizeAgentConfig(item))
        .filter((item): item is AgentConfig => item !== null)
    }
    if (Array.isArray(agents['knowledgeBases'])) {
      base.agents.knowledgeBases = (agents['knowledgeBases'] as unknown[])
        .map((item) => normalizeKnowledgeBase(item))
        .filter((item): item is KnowledgeBaseConfig => item !== null)
    }
    const rag = normalizeRagRuntimeConfig(agents['rag'])
    if (typeof rag.topK === 'number') base.agents.rag.topK = rag.topK
    if (typeof rag.chunkSize === 'number') base.agents.rag.chunkSize = rag.chunkSize
    if (typeof rag.chunkOverlap === 'number') base.agents.rag.chunkOverlap = rag.chunkOverlap
  }

  return base
}

export function applySettingsPatch(current: AppSettings, patch: unknown): AppSettings {
  if (!patch || typeof patch !== 'object') return current
  const p = patch as SettingsPatch
  const next: AppSettings = structuredClone(current)

  if (p.general) {
    if (typeof p.general.minimizeToTray === 'boolean')
      next.general.minimizeToTray = p.general.minimizeToTray
    if (typeof p.general.autoStart === 'boolean') next.general.autoStart = p.general.autoStart
  }

  if (p.snip) {
    if (p.snip.provider === 'app') next.snip.provider = p.snip.provider
    if (typeof p.snip.saveDir === 'string') next.snip.saveDir = p.snip.saveDir
    if (typeof (p.snip as Record<string, unknown>).suspendEyeOverlay === 'boolean')
      next.snip.suspendEyeOverlay = (p.snip as Record<string, boolean>).suspendEyeOverlay
  }

  if (
    (p as { stickyNotes?: unknown }).stickyNotes &&
    typeof (p as { stickyNotes?: unknown }).stickyNotes === 'object'
  ) {
    const sn = (p as { stickyNotes: Record<string, unknown> }).stickyNotes
    if (typeof sn['saveDir'] === 'string') next.stickyNotes.saveDir = sn['saveDir'] as string
  }

  if (p.shortcuts) {
    if (typeof p.shortcuts.toggleEye === 'string') next.shortcuts.toggleEye = p.shortcuts.toggleEye
    if (typeof (p.shortcuts as Record<string, unknown>).translateSelection === 'string')
      next.shortcuts.translateSelection = (p.shortcuts as Record<string, string>).translateSelection
    if (typeof (p.shortcuts as Record<string, unknown>).stickyNotesPopup === 'string')
      next.shortcuts.stickyNotesPopup = (p.shortcuts as Record<string, string>).stickyNotesPopup
    if (typeof (p.shortcuts as Record<string, unknown>).snipStart === 'string')
      next.shortcuts.snipStart = (p.shortcuts as Record<string, string>).snipStart
    if (typeof (p.shortcuts as Record<string, unknown>).stickerPaste === 'string')
      next.shortcuts.stickerPaste = (p.shortcuts as Record<string, string>).stickerPaste
    if (typeof (p.shortcuts as Record<string, unknown>).stickersToggleHidden === 'string')
      next.shortcuts.stickersToggleHidden = (
        p.shortcuts as Record<string, string>
      ).stickersToggleHidden
    if (typeof (p.shortcuts as Record<string, unknown>).stashLeft === 'string')
      next.shortcuts.stashLeft = (p.shortcuts as Record<string, string>).stashLeft
    if (typeof (p.shortcuts as Record<string, unknown>).stashTop === 'string')
      next.shortcuts.stashTop = (p.shortcuts as Record<string, string>).stashTop
    if (typeof (p.shortcuts as Record<string, unknown>).stashRight === 'string')
      next.shortcuts.stashRight = (p.shortcuts as Record<string, string>).stashRight
    if (typeof (p.shortcuts as Record<string, unknown>).stashBottom === 'string')
      next.shortcuts.stashBottom = (p.shortcuts as Record<string, string>).stashBottom
    if (typeof (p.shortcuts as Record<string, unknown>).toggleTopmostWindow === 'string')
      next.shortcuts.toggleTopmostWindow = (
        p.shortcuts as Record<string, string>
      ).toggleTopmostWindow
  }

  if ((p as { shortcutsEnabled?: unknown }).shortcutsEnabled) {
    const se = (p as { shortcutsEnabled: Record<string, unknown> }).shortcutsEnabled
    if (typeof se['toggleEye'] === 'boolean')
      next.shortcutsEnabled.toggleEye = se['toggleEye'] as boolean
    if (typeof se['translateSelection'] === 'boolean')
      next.shortcutsEnabled.translateSelection = se['translateSelection'] as boolean
    if (typeof se['stickyNotesPopup'] === 'boolean')
      next.shortcutsEnabled.stickyNotesPopup = se['stickyNotesPopup'] as boolean
    if (typeof se['snipStart'] === 'boolean')
      next.shortcutsEnabled.snipStart = se['snipStart'] as boolean
    if (typeof se['stickerPaste'] === 'boolean')
      next.shortcutsEnabled.stickerPaste = se['stickerPaste'] as boolean
    if (typeof se['stickersToggleHidden'] === 'boolean')
      next.shortcutsEnabled.stickersToggleHidden = se['stickersToggleHidden'] as boolean
    if (typeof se['stashLeft'] === 'boolean')
      next.shortcutsEnabled.stashLeft = se['stashLeft'] as boolean
    if (typeof se['stashTop'] === 'boolean')
      next.shortcutsEnabled.stashTop = se['stashTop'] as boolean
    if (typeof se['stashRight'] === 'boolean')
      next.shortcutsEnabled.stashRight = se['stashRight'] as boolean
    if (typeof se['stashBottom'] === 'boolean')
      next.shortcutsEnabled.stashBottom = se['stashBottom'] as boolean
    if (typeof se['toggleTopmostWindow'] === 'boolean')
      next.shortcutsEnabled.toggleTopmostWindow = se['toggleTopmostWindow'] as boolean
  }

  if (
    (p as { translate?: unknown }).translate &&
    typeof (p as { translate?: unknown }).translate === 'object'
  ) {
    const tr = (p as { translate: Record<string, unknown> }).translate
    const provider = tr['provider']
    if (provider === 'baidu' || provider === 'bing' || provider === 'ai')
      next.translate.provider = provider
    if (typeof tr['defaultSource'] === 'string') next.translate.defaultSource = tr['defaultSource']
    if (typeof tr['defaultTarget'] === 'string') next.translate.defaultTarget = tr['defaultTarget']

    const baidu = tr['baidu']
    if (baidu && typeof baidu === 'object') {
      const b = baidu as Record<string, unknown>
      if (typeof b['baseUrl'] === 'string') next.translate.baidu.baseUrl = b['baseUrl']
      if (typeof b['appId'] === 'string') next.translate.baidu.appId = b['appId']
      if (typeof b['secret'] === 'string') next.translate.baidu.secret = b['secret']
    }

    const bing = tr['bing']
    if (bing && typeof bing === 'object') {
      const b = bing as Record<string, unknown>
      if (typeof b['baseUrl'] === 'string') next.translate.bing.baseUrl = b['baseUrl']
      if (typeof b['key'] === 'string') next.translate.bing.key = b['key']
      if (typeof b['region'] === 'string') next.translate.bing.region = b['region']
    }
  }

  if ((p as { ai?: unknown }).ai && typeof (p as { ai?: unknown }).ai === 'object') {
    const ai = (p as { ai: Record<string, unknown> }).ai
    if (typeof ai['enabled'] === 'boolean') next.ai.enabled = ai['enabled'] as boolean
    if (typeof ai['searchMcpCommand'] === 'string')
      next.ai.searchMcpCommand = ai['searchMcpCommand'] as string
  }

  if (
    (p as { funFact?: unknown }).funFact &&
    typeof (p as { funFact?: unknown }).funFact === 'object'
  ) {
    const ff = (p as { funFact: Record<string, unknown> }).funFact
    if (typeof ff['title'] === 'string') next.funFact.title = ff['title'] as string
    if (typeof ff['prompt'] === 'string') next.funFact.prompt = ff['prompt'] as string
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
    if (typeof (p.break as Record<string, unknown>).closeOnEnd === 'boolean')
      next.break.closeOnEnd = (p.break as Record<string, boolean>).closeOnEnd
  }
  if (
    (p as { scheduledTasks?: unknown }).scheduledTasks &&
    typeof (p as { scheduledTasks?: unknown }).scheduledTasks === 'object'
  ) {
    const st = (p as { scheduledTasks: Record<string, unknown> }).scheduledTasks
    const shutdown = st['shutdown']
    if (shutdown && typeof shutdown === 'object') {
      const sd = shutdown as Record<string, unknown>
      if (typeof sd['enabled'] === 'boolean')
        next.scheduledTasks.shutdown.enabled = sd['enabled'] as boolean
      const mode = sd['mode']
      if (mode === 'once' || mode === 'daily') next.scheduledTasks.shutdown.mode = mode
      if (typeof sd['time'] === 'string') next.scheduledTasks.shutdown.time = sd['time'] as string
      const dayOffset = sd['onceDayOffset']
      if (dayOffset === 0 || dayOffset === 1) next.scheduledTasks.shutdown.onceDayOffset = dayOffset
    }
  }
  if (
    (p as { windowStash?: unknown }).windowStash &&
    typeof (p as { windowStash?: unknown }).windowStash === 'object'
  ) {
    const ws = (p as { windowStash: Record<string, unknown> }).windowStash
    const colors = ws['handleColors']
    if (colors && typeof colors === 'object') {
      const c = colors as Record<string, unknown>
      if (typeof c['left'] === 'string') next.windowStash.handleColors.left = c['left'] as string
      if (typeof c['top'] === 'string') next.windowStash.handleColors.top = c['top'] as string
      if (typeof c['right'] === 'string') next.windowStash.handleColors.right = c['right'] as string
      if (typeof c['bottom'] === 'string')
        next.windowStash.handleColors.bottom = c['bottom'] as string
    }
    if (typeof ws['handleOpacity'] === 'number')
      next.windowStash.handleOpacity = ws['handleOpacity'] as number
    if (typeof ws['showHandleTitle'] === 'boolean')
      next.windowStash.showHandleTitle = ws['showHandleTitle'] as boolean
    if (typeof ws['showHandleDrag'] === 'boolean')
      next.windowStash.showHandleDrag = ws['showHandleDrag'] as boolean
    if (typeof ws['animate'] === 'boolean') next.windowStash.animate = ws['animate'] as boolean
    if (typeof ws['durationMs'] === 'number')
      next.windowStash.durationMs = ws['durationMs'] as number
    if (typeof ws['topmostHighlightEnabled'] === 'boolean')
      next.windowStash.topmostHighlightEnabled = ws['topmostHighlightEnabled'] as boolean
    if (typeof ws['topmostBorderColor'] === 'string')
      next.windowStash.topmostBorderColor = ws['topmostBorderColor'] as string
    if (typeof ws['topmostBorderWidth'] === 'number')
      next.windowStash.topmostBorderWidth = ws['topmostBorderWidth'] as number
  }
  {
    const rsv = (p as { reminderSeconds?: unknown }).reminderSeconds
    if (typeof rsv === 'number') {
      next.reminderSeconds = clampNumber(rsv, 5, 600)
    }
  }

  if (
    (p as { agents?: unknown }).agents &&
    typeof (p as { agents?: unknown }).agents === 'object'
  ) {
    const agents = (p as { agents: Record<string, unknown> }).agents
    if (Array.isArray(agents['configs'])) {
      next.agents.configs = (agents['configs'] as unknown[])
        .map((item) => normalizeAgentConfig(item))
        .filter((item): item is AgentConfig => item !== null)
    }
    if (Array.isArray(agents['knowledgeBases'])) {
      next.agents.knowledgeBases = (agents['knowledgeBases'] as unknown[])
        .map((item) => normalizeKnowledgeBase(item))
        .filter((item): item is KnowledgeBaseConfig => item !== null)
    }
    const rag = normalizeRagRuntimeConfig(agents['rag'])
    if (typeof rag.topK === 'number') next.agents.rag.topK = rag.topK
    if (typeof rag.chunkSize === 'number') next.agents.rag.chunkSize = rag.chunkSize
    if (typeof rag.chunkOverlap === 'number') next.agents.rag.chunkOverlap = rag.chunkOverlap
  }

  return normalizeSettings(next)
}

export function loadSettingsFromDisk(): AppSettings {
  let parsed: unknown = null
  try {
    const raw = readFileSync(settingsFilePath(), 'utf-8')
    parsed = JSON.parse(raw)
  } catch {
    parsed = null
  }

  const normalized = normalizeSettings(parsed)
  const legacyKnowledgeBases = extractLegacyKnowledgeBases(parsed)
  if (legacyKnowledgeBases.length) {
    normalized.agents.knowledgeBases = migrateLegacyKnowledgeBases(
      legacyKnowledgeBases,
      join(app.getPath('userData'), 'agents', 'knowledge-bases')
    )
    saveSettingsToDisk(normalized)
  }

  return normalized
}

export function saveSettingsToDisk(next: AppSettings): void {
  try {
    writeFileSync(settingsFilePath(), JSON.stringify(next), 'utf-8')
  } catch {
    return
  }
}
