export interface TranslationHistoryItem {
  id: string
  createdAt: number
  source: string
  target: string
  input: string
  output: string
}

const STORAGE_KEY = 'translationHistory:v1'
const MAX_ITEMS = 200

function safeReadRaw(): unknown {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function normalizeList(value: unknown): TranslationHistoryItem[] {
  if (!Array.isArray(value)) return []
  const out: TranslationHistoryItem[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const obj = item as Record<string, unknown>
    const id = typeof obj.id === 'string' ? obj.id : ''
    const createdAt =
      typeof obj.createdAt === 'number' && Number.isFinite(obj.createdAt) ? obj.createdAt : 0
    const source = typeof obj.source === 'string' ? obj.source : ''
    const target = typeof obj.target === 'string' ? obj.target : ''
    const input = typeof obj.input === 'string' ? obj.input : ''
    const output = typeof obj.output === 'string' ? obj.output : ''
    if (!id || !createdAt || !target) continue
    out.push({
      id,
      createdAt,
      source,
      target,
      input,
      output
    })
  }
  out.sort((a, b) => b.createdAt - a.createdAt)
  return out.slice(0, MAX_ITEMS)
}

function writeList(items: TranslationHistoryItem[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, MAX_ITEMS)))
  } catch {
    return
  }
}

export function getTranslationHistory(): TranslationHistoryItem[] {
  return normalizeList(safeReadRaw())
}

export function clearTranslationHistory(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    return
  }
}

export function removeTranslationHistoryItem(id: string): TranslationHistoryItem[] {
  const next = getTranslationHistory().filter((x) => x.id !== id)
  writeList(next)
  return next
}

export function appendTranslationHistory(args: {
  input: string
  output: string
  source: string
  target: string
}): TranslationHistoryItem[] {
  const input = args.input.trim()
  const output = args.output.trim()
  const source = args.source.trim()
  const target = args.target.trim()
  if (!input || !output || !target) return getTranslationHistory()

  const now = Date.now()
  const items = getTranslationHistory()
  const sameIndex = items.findIndex(
    (x) => x.input === input && x.output === output && x.source === source && x.target === target
  )

  const id = sameIndex >= 0 ? items[sameIndex].id : `${now}-${Math.random().toString(16).slice(2)}`
  const nextItem: TranslationHistoryItem = { id, createdAt: now, input, output, source, target }
  const withoutSame = sameIndex >= 0 ? items.filter((x) => x.id !== id) : items
  const next = [nextItem, ...withoutSame].slice(0, MAX_ITEMS)
  writeList(next)
  return next
}
