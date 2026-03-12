import { app, BrowserWindow, dialog, ipcMain, shell, clipboard } from 'electron'
import { spawn } from 'child_process'
import { promises as fsp } from 'fs'
import { existsSync } from 'fs'
import { basename, extname, join, resolve, sep } from 'path'
import iconv from 'iconv-lite'
import type { OpenDialogOptions } from 'electron'

type ScriptMeta = {
  name: string
  filePath: string
  ext: 'bat' | 'sh'
  mtimeMs: number
  size: number
}

type RunResult = {
  ok: boolean
  code: number | null
  stdout: string
  stderr: string
  error?: string
}

function scriptsDir(): string {
  return join(app.getPath('userData'), 'scripts')
}

function ensureScriptsDir(): string {
  const dir = scriptsDir()
  try {
    if (!existsSync(dir)) {
      void fsp.mkdir(dir, { recursive: true })
    }
  } catch {
    // ignore
  }
  return dir
}

function normalizePathForCheck(p: string): string {
  const v = resolve(p)
  return process.platform === 'win32' ? v.toLowerCase() : v
}

function isWithinScriptsDir(filePath: string): boolean {
  const dir = ensureScriptsDir()
  const root = normalizePathForCheck(dir)
  const full = normalizePathForCheck(filePath)
  if (full === root) return false
  return full.startsWith(root.endsWith(sep) ? root : root + sep)
}

function sanitizeName(raw: string): string {
  const trimmed = raw.trim()
  const base = trimmed.replace(/\s+/g, ' ')
  const invalid = new Set(['<', '>', ':', '"', '/', '\\', '|', '?', '*'])
  let cleaned = ''
  for (const ch of base) {
    const code = ch.charCodeAt(0)
    if (code < 32 || code === 127) {
      cleaned += '_'
      continue
    }
    if (invalid.has(ch)) {
      cleaned += '_'
      continue
    }
    cleaned += ch
  }
  const collapsed = cleaned.replace(/[._ -]+$/g, '').replace(/^[._ -]+/g, '')
  return collapsed || 'script'
}

async function listScripts(): Promise<ScriptMeta[]> {
  const dir = ensureScriptsDir()
  try {
    await fsp.mkdir(dir, { recursive: true })
  } catch {
    return []
  }
  await ensurePresetScripts().catch(() => null)
  const items = await fsp.readdir(dir).catch(() => [])
  const out: ScriptMeta[] = []
  for (const name of items) {
    const lower = name.toLowerCase()
    const ext = lower.endsWith('.bat') ? 'bat' : lower.endsWith('.sh') ? 'sh' : null
    if (!ext) continue
    const filePath = join(dir, name)
    try {
      const st = await fsp.stat(filePath)
      if (!st.isFile()) continue
      out.push({
        name,
        filePath,
        ext,
        mtimeMs: st.mtimeMs,
        size: st.size
      })
    } catch {
      // ignore
    }
  }
  out.sort((a, b) => b.mtimeMs - a.mtimeMs)
  return out
}

function presetScripts(): Array<{ name: string; ext: 'bat' | 'sh'; content: string }> {
  const presets: Array<{ name: string; ext: 'bat' | 'sh'; content: string }> = []
  presets.push({
    name: 'system-info',
    ext: 'bat',
    content: [
      '@echo off',
      'setlocal',
      'echo === SYSTEM INFO ===',
      'echo.',
      'whoami',
      'hostname',
      'echo.',
      'echo --- IPCONFIG ---',
      'ipconfig',
      'echo.',
      'echo --- NETSTAT LISTENING ---',
      'netstat -ano | findstr LISTENING',
      'endlocal'
    ].join('\r\n')
  })
  presets.push({
    name: 'git-status',
    ext: 'bat',
    content: [
      '@echo off',
      'setlocal',
      'echo === GIT STATUS ===',
      'git status -sb',
      'endlocal'
    ].join('\r\n')
  })
  presets.push({
    name: 'system-info',
    ext: 'sh',
    content: [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      'echo "=== SYSTEM INFO ==="',
      'echo',
      'whoami || true',
      'hostname || true',
      'echo',
      'echo "--- UNAME ---"',
      'uname -a || true',
      'echo',
      'echo "--- IP ---"',
      '(ip a || ifconfig) 2>/dev/null || true',
      'echo',
      'echo "--- LISTENING ---"',
      '(lsof -i -P -n | head -n 50) 2>/dev/null || true'
    ].join('\n')
  })
  presets.push({
    name: 'git-status',
    ext: 'sh',
    content: [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      'echo "=== GIT STATUS ==="',
      'git status -sb'
    ].join('\n')
  })
  return presets
}

async function ensurePresetScripts(): Promise<void> {
  const dir = ensureScriptsDir()
  await fsp.mkdir(dir, { recursive: true }).catch(() => null)
  const files = await fsp.readdir(dir).catch(() => [])
  const hasAny = files.some((n) => {
    const lower = n.toLowerCase()
    return lower.endsWith('.bat') || lower.endsWith('.sh')
  })
  if (hasAny) return

  for (const preset of presetScripts()) {
    const fileName = `${preset.name}.${preset.ext}`
    const filePath = join(dir, fileName)
    if (existsSync(filePath)) continue
    await fsp.writeFile(filePath, preset.content, 'utf-8').catch(() => null)
  }
}

function decodeWindowsText(buf: Buffer): string {
  if (!buf.length) return ''
  let zeroCount = 0
  for (const b of buf) {
    if (b === 0) zeroCount += 1
  }
  if (zeroCount / buf.length >= 0.2) {
    try {
      const s = buf.toString('utf16le')
      if (s.trim()) return s.split('\u0000').join('')
    } catch {
      // ignore
    }
  }
  const utf8 = buf.toString('utf-8')
  const replacement = (utf8.match(/\uFFFD/g) ?? []).length
  if (replacement === 0) return utf8
  try {
    return iconv.decode(buf, 'cp936')
  } catch {
    return utf8
  }
}

function decodeProcessText(buf: Buffer): string {
  if (!buf.length) return ''
  if (process.platform === 'win32') return decodeWindowsText(buf)
  return buf.toString('utf-8')
}

function findGitBashExe(): string | null {
  const candidates: string[] = []
  const pf = process.env['ProgramFiles']
  const pfx86 = process.env['ProgramFiles(x86)']
  const local = process.env['LocalAppData']

  if (typeof pf === 'string' && pf) {
    candidates.push(join(pf, 'Git', 'bin', 'bash.exe'))
    candidates.push(join(pf, 'Git', 'usr', 'bin', 'bash.exe'))
  }
  if (typeof pfx86 === 'string' && pfx86) {
    candidates.push(join(pfx86, 'Git', 'bin', 'bash.exe'))
    candidates.push(join(pfx86, 'Git', 'usr', 'bin', 'bash.exe'))
  }
  if (typeof local === 'string' && local) {
    candidates.push(join(local, 'Programs', 'Git', 'bin', 'bash.exe'))
    candidates.push(join(local, 'Programs', 'Git', 'usr', 'bin', 'bash.exe'))
  }

  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  return null
}

function findWslExe(): string | null {
  const windir = typeof process.env['WINDIR'] === 'string' ? process.env['WINDIR'] : ''
  const base = windir && windir.trim() ? windir.trim() : 'C:\\Windows'
  const exe = join(base, 'System32', 'wsl.exe')
  return existsSync(exe) ? exe : null
}

function toGitBashPath(p: string): string {
  return p.replace(/\\/g, '/')
}

function toWslPath(p: string): string | null {
  const m = /^([a-zA-Z]):[\\/](.*)$/.exec(p)
  if (!m) return null
  const drive = m[1].toLowerCase()
  const rest = m[2].replace(/\\/g, '/')
  return `/mnt/${drive}/${rest}`
}

async function readScript(filePath: string): Promise<string | null> {
  if (!isWithinScriptsDir(filePath)) return null
  try {
    const raw = await fsp.readFile(filePath, 'utf-8')
    return typeof raw === 'string' ? raw : String(raw)
  } catch {
    return null
  }
}

async function writeScript(payload: unknown): Promise<ScriptMeta | null> {
  const p = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
  const nameRaw = typeof p['name'] === 'string' ? p['name'] : ''
  const extRaw = typeof p['ext'] === 'string' ? p['ext'] : ''
  const content = typeof p['content'] === 'string' ? p['content'] : ''
  const overwrite = Boolean(p['overwrite'])
  const ext: 'bat' | 'sh' = extRaw === 'sh' ? 'sh' : 'bat'

  const baseName = sanitizeName(nameRaw)
  const dir = ensureScriptsDir()
  const fileName = baseName.toLowerCase().endsWith(`.${ext}`) ? baseName : `${baseName}.${ext}`
  const filePath = join(dir, fileName)
  if (!isWithinScriptsDir(filePath)) return null

  if (!overwrite && existsSync(filePath)) return null
  await fsp.mkdir(dir, { recursive: true }).catch(() => null)
  await fsp.writeFile(filePath, content, 'utf-8').catch(() => null)

  try {
    const st = await fsp.stat(filePath)
    return { name: fileName, filePath, ext, mtimeMs: st.mtimeMs, size: st.size }
  } catch {
    return null
  }
}

async function deleteScript(filePath: string): Promise<boolean> {
  if (!isWithinScriptsDir(filePath)) return false
  try {
    await fsp.unlink(filePath)
    return true
  } catch {
    return false
  }
}

async function importScript(fromPath: string): Promise<ScriptMeta | null> {
  const ext =
    extname(fromPath).toLowerCase() === '.sh'
      ? 'sh'
      : extname(fromPath).toLowerCase() === '.bat'
        ? 'bat'
        : null
  if (!ext) return null
  const dir = ensureScriptsDir()
  await fsp.mkdir(dir, { recursive: true }).catch(() => null)
  const fromBase = basename(fromPath, extname(fromPath))
  const base = sanitizeName(fromBase)

  let n = 0
  while (n < 1000) {
    const suffix = n === 0 ? '' : ` (${n})`
    const fileName = `${base}${suffix}.${ext}`
    const target = join(dir, fileName)
    if (!existsSync(target)) {
      try {
        await fsp.copyFile(fromPath, target)
        const st = await fsp.stat(target)
        return { name: fileName, filePath: target, ext, mtimeMs: st.mtimeMs, size: st.size }
      } catch {
        return null
      }
    }
    n += 1
  }
  return null
}

function collectStreamLimited(
  stream: NodeJS.ReadableStream,
  limitBytes: number,
  onData: (chunk: Buffer) => void
): void {
  let total = 0
  stream.on('data', (chunk: Buffer) => {
    total += chunk.length
    if (total <= limitBytes) onData(chunk)
  })
}

function runScript(filePath: string): Promise<RunResult> {
  if (!isWithinScriptsDir(filePath)) {
    return Promise.resolve({
      ok: false,
      code: null,
      stdout: '',
      stderr: '',
      error: 'Invalid script path'
    })
  }
  const ext = extname(filePath).toLowerCase()
  const dir = ensureScriptsDir()

  let command = ''
  let args: string[] = []
  if (process.platform === 'win32') {
    if (ext === '.bat' || ext === '.cmd') {
      command = 'cmd.exe'
      args = ['/d', '/s', '/c', filePath]
    } else if (ext === '.sh') {
      const gitBash = findGitBashExe()
      if (gitBash) {
        command = gitBash
        args = [toGitBashPath(filePath)]
      } else {
        const wslExe = findWslExe()
        const wslPath = toWslPath(filePath)
        if (wslExe && wslPath) {
          command = wslExe
          args = ['--exec', 'bash', wslPath]
        } else {
          command = 'bash'
          args = [filePath]
        }
      }
    } else {
      return Promise.resolve({
        ok: false,
        code: null,
        stdout: '',
        stderr: '',
        error: 'Unsupported script type'
      })
    }
  } else {
    if (ext === '.sh') {
      command = 'bash'
      args = [filePath]
    } else {
      return Promise.resolve({
        ok: false,
        code: null,
        stdout: '',
        stderr: '',
        error: 'Unsupported script type'
      })
    }
  }

  return new Promise<RunResult>((resolveRun) => {
    let stdout = Buffer.alloc(0)
    let stderr = Buffer.alloc(0)
    let settled = false

    const child = spawn(command, args, { cwd: dir, windowsHide: true })
    const limit = 256 * 1024
    if (child.stdout) {
      collectStreamLimited(child.stdout, limit, (b) => {
        stdout = Buffer.concat([stdout, b])
      })
    }
    if (child.stderr) {
      collectStreamLimited(child.stderr, limit, (b) => {
        stderr = Buffer.concat([stderr, b])
      })
    }

    const timeoutMs = 60_000
    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      try {
        child.kill()
      } catch {
        // ignore
      }
      resolveRun({
        ok: false,
        code: null,
        stdout: decodeProcessText(stdout),
        stderr: decodeProcessText(stderr),
        error: 'Timeout'
      })
    }, timeoutMs)

    child.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolveRun({
        ok: false,
        code: null,
        stdout: decodeProcessText(stdout),
        stderr: decodeProcessText(stderr),
        error: err?.message || 'Failed to start process'
      })
    })

    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolveRun({
        ok: code === 0,
        code: typeof code === 'number' ? code : null,
        stdout: decodeProcessText(stdout),
        stderr: decodeProcessText(stderr)
      })
    })
  })
}

export function registerScriptLibraryHandlers(): void {
  ensurePresetScripts().catch(() => null)
  ipcMain.handle('script-library:list', async () => {
    return await listScripts()
  })
  ipcMain.handle('script-library:read', async (_e, payload: unknown) => {
    const filePath = typeof payload === 'string' ? payload : ''
    if (!filePath) return null
    return await readScript(filePath)
  })
  ipcMain.handle('script-library:save', async (_e, payload: unknown) => {
    return await writeScript(payload)
  })
  ipcMain.handle('script-library:delete', async (_e, payload: unknown) => {
    const filePath = typeof payload === 'string' ? payload : ''
    if (!filePath) return false
    return await deleteScript(filePath)
  })
  ipcMain.handle('script-library:run', async (_e, payload: unknown) => {
    const filePath = typeof payload === 'string' ? payload : ''
    if (!filePath)
      return { ok: false, code: null, stdout: '', stderr: '', error: 'Missing script path' }
    return await runScript(filePath)
  })
  ipcMain.handle('script-library:reveal', async (_e, payload: unknown) => {
    const filePath = typeof payload === 'string' ? payload : ''
    if (!filePath || !isWithinScriptsDir(filePath)) return false
    try {
      shell.showItemInFolder(filePath)
      return true
    } catch {
      return false
    }
  })
  ipcMain.handle('script-library:import:choose', async (event) => {
    const parent = BrowserWindow.fromWebContents(event.sender)
    const options: OpenDialogOptions = {
      properties: ['openFile'],
      filters: [
        { name: 'Scripts', extensions: ['bat', 'sh'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    }
    const result = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled) return null
    const p = result.filePaths?.[0]
    return typeof p === 'string' && p.trim() ? p : null
  })
  ipcMain.handle('script-library:import', async (_e, payload: unknown) => {
    const fromPath = typeof payload === 'string' ? payload : ''
    if (!fromPath) return null
    return await importScript(fromPath)
  })
  ipcMain.handle('clipboard:write-text', (event, payload: unknown) => {
    const text = typeof payload === 'string' ? payload : ''
    if (!text) return false
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win.isDestroyed()) return false
    try {
      clipboard.writeText(text)
      return true
    } catch {
      return false
    }
  })
}
