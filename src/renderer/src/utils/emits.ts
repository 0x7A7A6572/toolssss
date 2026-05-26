type EmitsHandler = (...args: unknown[]) => void

type ListenerMap = Map<string, Set<EmitsHandler>>

type EmitMessage =
  | { type: 'emit'; id: string; from: string; event: string; args: unknown[] }
  | { type: 'noop' }

const instanceId = `${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`
const listeners: ListenerMap = new Map()

let bc: BroadcastChannel | null = null
const storageKey = 'freamx:emits'

function ensureSet(event: string): Set<EmitsHandler> {
  const key = event.trim()
  const existing = listeners.get(key)
  if (existing) return existing
  const next = new Set<EmitsHandler>()
  listeners.set(key, next)
  return next
}

function dispatch(event: string, args: unknown[]): void {
  const key = event.trim()
  if (!key) return
  const set = listeners.get(key)
  if (!set || !set.size) return
  for (const fn of Array.from(set)) {
    try {
      fn(...args)
    } catch {
      void 0
    }
  }
}

function tryBroadcast(msg: EmitMessage): void {
  if (bc) {
    try {
      bc.postMessage(msg)
      return
    } catch {
      bc = null
    }
  }

  try {
    localStorage.setItem(storageKey, JSON.stringify(msg))
  } catch {
    void 0
  }
}

function onMessage(data: unknown): void {
  if (!data || typeof data !== 'object') return
  const p = data as Partial<EmitMessage>
  if (p.type !== 'emit') return
  const from = typeof p.from === 'string' ? p.from : ''
  if (from === instanceId) return
  const event = typeof p.event === 'string' ? p.event : ''
  const args = Array.isArray(p.args) ? p.args : []
  dispatch(event, args)
}

function init(): void {
  if (bc !== null) return
  try {
    bc = new BroadcastChannel('freamx:emits')
    bc.addEventListener('message', (ev: MessageEvent) => onMessage(ev.data))
  } catch {
    bc = null
  }
  window.addEventListener('storage', (ev: StorageEvent) => {
    if (ev.key !== storageKey) return
    if (!ev.newValue) return
    try {
      onMessage(JSON.parse(ev.newValue) as unknown)
    } catch {
      void 0
    }
  })
}

init()

const emits = {
  on(event: string, handler: EmitsHandler): void {
    if (!event.trim()) return
    if (typeof handler !== 'function') return
    ensureSet(event).add(handler)
  },
  once(event: string, handler: EmitsHandler): void {
    if (!event.trim()) return
    if (typeof handler !== 'function') return
    const wrapped: EmitsHandler = (...args) => {
      emits.off(event, wrapped)
      handler(...args)
    }
    emits.on(event, wrapped)
  },
  off(event: string, handler?: EmitsHandler): void {
    const key = event.trim()
    if (!key) return
    const set = listeners.get(key)
    if (!set) return
    if (!handler) {
      set.clear()
      listeners.delete(key)
      return
    }
    set.delete(handler)
    if (!set.size) listeners.delete(key)
  },
  emit(event: string, ...args: unknown[]): void {
    const key = event.trim()
    if (!key) return
    dispatch(key, args)
    tryBroadcast({
      type: 'emit',
      id: `${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`,
      from: instanceId,
      event: key,
      args
    })
  }
}

export default emits
