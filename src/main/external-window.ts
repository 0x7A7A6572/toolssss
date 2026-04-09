import { exec, spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { createInterface } from 'readline'
import { promisify } from 'util'
import { WINDOW_RECT_EVENT_RUNNER_PS } from '../libs/win32/powershellRunners'

const execAsync = promisify(exec)

export type ExternalWindowEdge = 'left' | 'right' | 'top' | 'bottom'
export type ExternalWindowMatch = 'contains' | 'equals'
export type ExternalWindowRect = { left: number; top: number; right: number; bottom: number }
export type ExternalWindowMatchEntry = { hwnd: string; title: string }
export type ExternalWindowRectChange = { hwnd: string; rect: ExternalWindowRect }

function clampNumber(value: number, min: number, max: number): number {
  if (Number.isNaN(value) || !Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

function encodePowerShellCommand(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64')
}

type PowerShellBridgePending = {
  resolve: (stdout: string) => void
  reject: (error: Error) => void
}

class PowerShellBridge {
  private proc: ChildProcessWithoutNullStreams
  private pending = new Map<string, PowerShellBridgePending>()
  private nextId = 1
  private closed = false

  constructor(sta: boolean) {
    const runner = `
      $in = [Console]::In
      [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
      while ($true) {
        $line = $in.ReadLine()
        if ($null -eq $line) { break }
        if ($line -eq '__EXIT__') { break }
        $parts = $line.Split('|', 2)
        if ($parts.Count -lt 2) { continue }
        $id = $parts[0]
        $b64 = $parts[1]
        try {
          $script = [System.Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($b64))
          $ErrorActionPreference = 'Stop'
          $out = &([ScriptBlock]::Create($script)) 2>&1 | Out-String
          $payload = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes([string]$out))
          [Console]::WriteLine(($id + '|OK|' + $payload))
        } catch {
          $err = ($_ | Out-String)
          $payload = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes([string]$err))
          [Console]::WriteLine(($id + '|ERR|' + $payload))
        }
      }
      exit
    `
    const encoded = encodePowerShellCommand(runner)
    const args: string[] = []
    if (sta) args.push('-STA')
    args.push('-NoLogo', '-NoProfile', '-NonInteractive', '-NoExit', '-EncodedCommand', encoded)
    this.proc = spawn('powershell', args, {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    }) as ChildProcessWithoutNullStreams

    const rl = createInterface({ input: this.proc.stdout })
    rl.on('line', (line) => this.onLine(line))
    this.proc.on('exit', () => this.onExit())
    this.proc.on('error', (e) =>
      this.onExit(e instanceof Error ? e : new Error('PowerShell 启动失败'))
    )
  }

  exec(script: string): Promise<string> {
    if (this.closed) return Promise.reject(new Error('PowerShell 已退出'))
    const id = String(this.nextId++)
    const encoded = encodePowerShellCommand(script)
    return new Promise<string>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      try {
        this.proc.stdin.write(`${id}|${encoded}\n`)
      } catch (e) {
        this.pending.delete(id)
        reject(e instanceof Error ? e : new Error('PowerShell 写入失败'))
      }
    })
  }

  dispose(): void {
    if (this.closed) return
    this.closed = true
    try {
      this.proc.stdin.write(`__EXIT__\n`)
    } catch {
      void 0
    }
    try {
      this.proc.stdin.end()
    } catch {
      void 0
    }
  }

  private onLine(line: string): void {
    const parts = line.split('|')
    if (parts.length < 3) return
    const id = parts[0]
    const status = parts[1]
    const payloadB64 = parts.slice(2).join('|')
    const pending = this.pending.get(id)
    if (!pending) return
    this.pending.delete(id)
    const payload = Buffer.from(payloadB64, 'base64').toString('utf8')
    if (status === 'OK') {
      pending.resolve(payload)
      return
    }
    pending.reject(new Error(payload || 'PowerShell 执行失败'))
  }

  private onExit(error?: Error): void {
    if (this.closed) return
    this.closed = true
    const err = error ?? new Error('PowerShell 已退出')
    for (const [, p] of this.pending) p.reject(err)
    this.pending.clear()
  }
}

let psBridgeMta: PowerShellBridge | null = null
let psBridgeSta: PowerShellBridge | null = null

export function disposeExternalWindowPowerShell(): void {
  psBridgeMta?.dispose()
  psBridgeSta?.dispose()
  psBridgeMta = null
  psBridgeSta = null
}

class ExternalWindowRectEventBridge {
  private proc: ChildProcessWithoutNullStreams
  private closed = false
  private onChange: (evt: ExternalWindowRectChange) => void

  constructor(onChange: (evt: ExternalWindowRectChange) => void) {
    this.onChange = onChange

    const runner = WINDOW_RECT_EVENT_RUNNER_PS

    const encoded = encodePowerShellCommand(runner)
    const args: string[] = [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-NoExit',
      '-EncodedCommand',
      encoded
    ]
    this.proc = spawn('powershell', args, {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    }) as ChildProcessWithoutNullStreams

    const rl = createInterface({ input: this.proc.stdout })
    rl.on('line', (line) => this.onLine(line))
    this.proc.on('exit', () => this.dispose())
    this.proc.on('error', () => this.dispose())
  }

  add(hwnd: string): void {
    const id = typeof hwnd === 'string' ? hwnd.trim() : ''
    if (!id) return
    if (this.closed) return
    try {
      this.proc.stdin.write(`ADD|${id}\n`)
    } catch {
      void 0
    }
  }

  remove(hwnd: string): void {
    const id = typeof hwnd === 'string' ? hwnd.trim() : ''
    if (!id) return
    if (this.closed) return
    try {
      this.proc.stdin.write(`DEL|${id}\n`)
    } catch {
      void 0
    }
  }

  dispose(): void {
    if (this.closed) return
    this.closed = true
    try {
      this.proc.stdin.write(`__EXIT__\n`)
    } catch {
      void 0
    }
    try {
      this.proc.stdin.end()
    } catch {
      void 0
    }
  }

  private onLine(line: string): void {
    const s = typeof line === 'string' ? line.trim() : ''
    if (!s) return
    if (!s.startsWith('EVT|')) return
    const b64 = s.slice(4)
    if (!b64) return
    try {
      const json = Buffer.from(b64, 'base64').toString('utf8')
      const parsed = JSON.parse(json) as unknown
      if (!parsed || typeof parsed !== 'object') return
      const p = parsed as { hwnd?: unknown; rect?: unknown }
      const hwnd = typeof p.hwnd === 'string' ? p.hwnd : ''
      if (!hwnd) return
      const rectRaw =
        p.rect && typeof p.rect === 'object' ? (p.rect as Record<string, unknown>) : null
      if (!rectRaw) return
      const left = Number(rectRaw['left'])
      const top = Number(rectRaw['top'])
      const right = Number(rectRaw['right'])
      const bottom = Number(rectRaw['bottom'])
      if (![left, top, right, bottom].every((n) => Number.isFinite(n))) return
      this.onChange({ hwnd, rect: { left, top, right, bottom } })
    } catch {
      void 0
    }
  }
}

let rectEventBridge: ExternalWindowRectEventBridge | null = null

export function ensureExternalWindowRectEvents(
  onChange: (evt: ExternalWindowRectChange) => void
): void {
  if (process.platform !== 'win32') return
  if (rectEventBridge) return
  rectEventBridge = new ExternalWindowRectEventBridge(onChange)
}

export function watchExternalWindowRect(hwnd: string, watch: boolean): void {
  if (process.platform !== 'win32') return
  if (!rectEventBridge) return
  if (watch) rectEventBridge.add(hwnd)
  else rectEventBridge.remove(hwnd)
}

export function disposeExternalWindowRectEvents(): void {
  rectEventBridge?.dispose()
  rectEventBridge = null
}

async function runPowerShellOneShot(script: string, opts?: { sta?: boolean }): Promise<string> {
  const innerB64 = encodePowerShellCommand(script)
  const wrapper = `
    $inner = [System.Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${innerB64}'))
    $ErrorActionPreference = 'Stop'
    try {
      $out = &([ScriptBlock]::Create($inner)) 2>&1 | Out-String
      $b64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes([string]$out))
      $bytes = [System.Text.Encoding]::ASCII.GetBytes([string]$b64)
      $stdout = [System.Console]::OpenStandardOutput()
      $stdout.Write($bytes, 0, $bytes.Length)
      $stdout.Flush()
      exit 0
    } catch {
      $err = ($_ | Out-String)
      $b64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes([string]$err))
      $bytes = [System.Text.Encoding]::ASCII.GetBytes([string]$b64)
      $stdout = [System.Console]::OpenStandardOutput()
      $stdout.Write($bytes, 0, $bytes.Length)
      $stdout.Flush()
      exit 1
    }
  `
  const encoded = encodePowerShellCommand(wrapper)
  const args: string[] = []
  if (opts?.sta) args.push('-STA')
  args.push('-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded)
  const proc = spawn('powershell', args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  const stdoutChunks: Buffer[] = []
  const stderrChunks: Buffer[] = []
  proc.stdout.on('data', (d: Buffer) => stdoutChunks.push(d))
  proc.stderr.on('data', (d: Buffer) => stderrChunks.push(d))
  const exitCode: number = await new Promise((resolve, reject) => {
    proc.once('error', (e) => reject(e instanceof Error ? e : new Error('PowerShell 启动失败')))
    proc.once('close', (code) => resolve(typeof code === 'number' ? code : 1))
  })
  const b64 = Buffer.concat(stdoutChunks).toString('ascii').trim()
  const decoded = b64 ? Buffer.from(b64, 'base64').toString('utf8') : ''
  if (exitCode === 0) return decoded
  const stderr = Buffer.concat(stderrChunks).toString('utf8').trim()
  throw new Error(decoded || stderr || 'PowerShell 执行失败')
}

async function runPowerShell(script: string, opts?: { sta?: boolean }): Promise<string> {
  if (process.platform === 'win32') {
    const useSta = Boolean(opts?.sta)
    const bridge = useSta
      ? (psBridgeSta ?? (psBridgeSta = new PowerShellBridge(true)))
      : (psBridgeMta ?? (psBridgeMta = new PowerShellBridge(false)))
    try {
      return await bridge.exec(script)
    } catch {
      bridge.dispose()
      if (useSta) psBridgeSta = null
      else psBridgeMta = null
      return await runPowerShellOneShot(script, opts)
    }
  }
  const encoded = encodePowerShellCommand(script)
  const sta = opts?.sta ? '-STA ' : ''
  const { stdout } = await execAsync(
    `powershell ${sta}-NoProfile -NonInteractive -EncodedCommand ${encoded}`
  )
  return stdout
}

function psJsonB64(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')
}

function getExternalWindowPreamblePs(): string {
  return `
    if (-not ('Win32' -as [type])) {
      Add-Type @"
        using System;
        using System.Runtime.InteropServices;
        using System.Text;
        public class Win32 {
          public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
          [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
          [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
          [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hwnd, uint gaFlags);
          [DllImport("user32.dll", SetLastError=true, CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
          [DllImport("user32.dll", SetLastError=true)] public static extern int GetWindowTextLength(IntPtr hWnd);
          [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
          [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
          [DllImport("user32.dll", SetLastError=true)] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
          [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
          [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
          [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
          [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
          public static string Title(IntPtr hWnd) {
            int len = GetWindowTextLength(hWnd);
            if (len <= 0) return "";
            var sb = new StringBuilder(len + 1);
            GetWindowText(hWnd, sb, sb.Capacity);
            return sb.ToString();
          }
        }
"@
    }
  `
}

export async function findExternalWindows(payload: {
  title: string
  match: ExternalWindowMatch
  limit: number
}): Promise<ExternalWindowMatchEntry[]> {
  if (process.platform !== 'win32') return []
  const title = typeof payload.title === 'string' ? payload.title.trim() : ''
  if (!title) return []
  const match: ExternalWindowMatch = payload.match === 'equals' ? 'equals' : 'contains'
  const limit = clampNumber(Number(payload.limit), 1, 50)
  const b64 = psJsonB64({ title, match, limit })
  const script = `
    $p = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64}')) | ConvertFrom-Json
    ${getExternalWindowPreamblePs()}
    $needle = [string]$p.title
    $mode = [string]$p.match
    $lim = [int]$p.limit
    $results = New-Object System.Collections.Generic.List[object]
    [Win32]::EnumWindows({
      param([IntPtr]$h, [IntPtr]$l)
      if (-not [Win32]::IsWindowVisible($h)) { return $true }
      $t = [Win32]::Title($h)
      if (-not $t) { return $true }
      $ok = $false
      if ($mode -eq 'equals') {
        $ok = ($t -eq $needle)
      } else {
        $ok = ($t -like ("*" + $needle + "*"))
      }
      if ($ok) {
        $results.Add([pscustomobject]@{ hwnd = [string]([Int64]$h); title = $t }) | Out-Null
        if ($results.Count -ge $lim) { return $false }
      }
      return $true
    }, [IntPtr]::Zero) | Out-Null
    $results | ConvertTo-Json -Compress
  `

  try {
    const out = (await runPowerShell(script)).trim()
    if (!out) return []
    const parsed = JSON.parse(out) as unknown
    const arr = Array.isArray(parsed) ? parsed : parsed ? [parsed] : []
    const normalized: ExternalWindowMatchEntry[] = []
    for (const it of arr) {
      if (!it || typeof it !== 'object') continue
      const p = it as { hwnd?: unknown; title?: unknown }
      const hwnd = typeof p.hwnd === 'string' ? p.hwnd : ''
      const t = typeof p.title === 'string' ? p.title : ''
      if (!hwnd || !t) continue
      normalized.push({ hwnd, title: t })
    }
    return normalized
  } catch {
    return []
  }
}

export async function hideExternalWindowToEdge(payload: {
  hwnd: string
  edge: ExternalWindowEdge
  peekPx: number
  animate?: boolean
  durationMs?: number
}): Promise<{
  ok: boolean
  hwnd: string
  rect?: ExternalWindowRect
  newPos?: { x: number; y: number }
}> {
  if (process.platform !== 'win32') return { ok: false, hwnd: '' }
  const hwnd = typeof payload.hwnd === 'string' ? payload.hwnd.trim() : ''
  if (!hwnd) return { ok: false, hwnd: '' }
  const edge: ExternalWindowEdge =
    payload.edge === 'right' || payload.edge === 'top' || payload.edge === 'bottom'
      ? payload.edge
      : 'left'
  const peekPx = clampNumber(Number(payload.peekPx), 0, 400)
  const animate = Boolean(payload.animate)
  const durationMs = clampNumber(Number(payload.durationMs ?? 180), 60, 1200)
  const b64 = psJsonB64({ hwnd, edge, peekPx, animate, durationMs })
  const script = `
    $p = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64}')) | ConvertFrom-Json
    ${getExternalWindowPreamblePs()}
    Add-Type -AssemblyName System.Windows.Forms
    $h = [IntPtr]([Int64]([string]$p.hwnd))
    $rect = New-Object Win32+RECT
    $okRect = [Win32]::GetWindowRect($h, [ref]$rect)
    if (-not $okRect) {
      @{ ok = $false; hwnd = [string]([Int64]$h) } | ConvertTo-Json -Compress
      return
    }
    $w = $rect.Right - $rect.Left
    $hgt = $rect.Bottom - $rect.Top
    $wa = [System.Windows.Forms.Screen]::FromHandle($h).WorkingArea
    $sx = $rect.Left
    $sy = $rect.Top
    $x = $rect.Left
    $y = $rect.Top
    $edge = [string]$p.edge
    $peek = [int]$p.peekPx
    if ($edge -eq 'left') {
      $x = $wa.Left + $peek - $w
    } elseif ($edge -eq 'right') {
      $x = $wa.Right - $peek
    } elseif ($edge -eq 'top') {
      $y = $wa.Top + $peek - $hgt
    } else {
      $y = $wa.Bottom - $peek
    }
    $flags = 0x0001 -bor 0x0004 -bor 0x0010
    $okMove = $true
    if ([bool]$p.animate) {
      $dur = [int]$p.durationMs
      $steps = [Math]::Max(8, [Math]::Min(24, [Math]::Floor($dur / 12)))
      $sleep = [Math]::Max(1, [Math]::Floor($dur / $steps))
      for ($i = 1; $i -le $steps; $i++) {
        $nx = [Math]::Round($sx + ($x - $sx) * $i / $steps)
        $ny = [Math]::Round($sy + ($y - $sy) * $i / $steps)
        $okMove = [Win32]::SetWindowPos($h, [IntPtr]::Zero, [int]$nx, [int]$ny, 0, 0, [uint32]$flags)
        Start-Sleep -Milliseconds $sleep
      }
    } else {
      $okMove = [Win32]::SetWindowPos($h, [IntPtr]::Zero, [int]$x, [int]$y, 0, 0, [uint32]$flags)
    }
    @{
      ok = [bool]$okMove
      hwnd = [string]([Int64]$h)
      rect = @{ left = [int]$rect.Left; top = [int]$rect.Top; right = [int]$rect.Right; bottom = [int]$rect.Bottom }
      newPos = @{ x = [int]$x; y = [int]$y }
    } | ConvertTo-Json -Compress
  `

  try {
    const out = (await runPowerShell(script, { sta: true })).trim()
    const parsed = out ? (JSON.parse(out) as unknown) : null
    if (!parsed || typeof parsed !== 'object') return { ok: false, hwnd }
    const p = parsed as { ok?: unknown; hwnd?: unknown; rect?: unknown; newPos?: unknown }
    const ok = Boolean(p.ok)
    const h = typeof p.hwnd === 'string' ? p.hwnd : hwnd
    const rectRaw =
      p.rect && typeof p.rect === 'object' ? (p.rect as Record<string, unknown>) : null
    const newPosRaw =
      p.newPos && typeof p.newPos === 'object' ? (p.newPos as Record<string, unknown>) : null
    const rect: ExternalWindowRect | undefined =
      rectRaw &&
      Number.isFinite(Number(rectRaw['left'])) &&
      Number.isFinite(Number(rectRaw['top'])) &&
      Number.isFinite(Number(rectRaw['right'])) &&
      Number.isFinite(Number(rectRaw['bottom']))
        ? {
            left: Number(rectRaw['left']),
            top: Number(rectRaw['top']),
            right: Number(rectRaw['right']),
            bottom: Number(rectRaw['bottom'])
          }
        : undefined
    const newPos: { x: number; y: number } | undefined =
      newPosRaw &&
      Number.isFinite(Number(newPosRaw['x'])) &&
      Number.isFinite(Number(newPosRaw['y']))
        ? { x: Number(newPosRaw['x']), y: Number(newPosRaw['y']) }
        : undefined
    return { ok, hwnd: h, rect, newPos }
  } catch {
    return { ok: false, hwnd }
  }
}

export async function restoreExternalWindow(payload: {
  hwnd: string
  rect: ExternalWindowRect
  animate?: boolean
  durationMs?: number
}): Promise<{ ok: boolean; hwnd: string }> {
  if (process.platform !== 'win32') return { ok: false, hwnd: '' }
  const hwnd = typeof payload.hwnd === 'string' ? payload.hwnd.trim() : ''
  if (!hwnd) return { ok: false, hwnd: '' }
  const r = payload.rect
  const animate = Boolean(payload.animate)
  const durationMs = clampNumber(Number(payload.durationMs ?? 180), 60, 1200)
  const b64 = psJsonB64({ hwnd, rect: r, animate, durationMs })
  const script = `
    $p = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64}')) | ConvertFrom-Json
    ${getExternalWindowPreamblePs()}
    $h = [IntPtr]([Int64]([string]$p.hwnd))
    $x = [int]$p.rect.left
    $y = [int]$p.rect.top
    $flags = 0x0001 -bor 0x0004 -bor 0x0010
    $okMove = $true
    if ([bool]$p.animate) {
      $rect = New-Object Win32+RECT
      $okRect = [Win32]::GetWindowRect($h, [ref]$rect)
      $sx = if ($okRect) { [int]$rect.Left } else { $x }
      $sy = if ($okRect) { [int]$rect.Top } else { $y }
      $dur = [int]$p.durationMs
      $steps = [Math]::Max(8, [Math]::Min(24, [Math]::Floor($dur / 12)))
      $sleep = [Math]::Max(1, [Math]::Floor($dur / $steps))
      for ($i = 1; $i -le $steps; $i++) {
        $nx = [Math]::Round($sx + ($x - $sx) * $i / $steps)
        $ny = [Math]::Round($sy + ($y - $sy) * $i / $steps)
        $okMove = [Win32]::SetWindowPos($h, [IntPtr]::Zero, $nx, $ny, 0, 0, [uint32]$flags)
        Start-Sleep -Milliseconds $sleep
      }
    } else {
      $okMove = [Win32]::SetWindowPos($h, [IntPtr]::Zero, $x, $y, 0, 0, [uint32]$flags)
    }
    @{ ok = [bool]$okMove; hwnd = [string]([Int64]$h) } | ConvertTo-Json -Compress
  `

  try {
    const out = (await runPowerShell(script)).trim()
    const parsed = out ? (JSON.parse(out) as unknown) : null
    if (!parsed || typeof parsed !== 'object') return { ok: false, hwnd }
    const p = parsed as { ok?: unknown; hwnd?: unknown }
    return { ok: Boolean(p.ok), hwnd: typeof p.hwnd === 'string' ? p.hwnd : hwnd }
  } catch {
    return { ok: false, hwnd }
  }
}

export async function getForegroundExternalWindow(): Promise<{
  hwnd: string
  title: string
} | null> {
  if (process.platform !== 'win32') return null
  const nodePid = process.pid
  const b64 = psJsonB64({ nodePid })
  const script = `
    $p = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64}')) | ConvertFrom-Json
    ${getExternalWindowPreamblePs()}
    $h = [Win32]::GetForegroundWindow()
    if ($h -eq [IntPtr]::Zero) {
      $null
      return
    }
    $wpid = [uint32]0
    [Win32]::GetWindowThreadProcessId($h, [ref]$wpid) | Out-Null
    if ([int]$wpid -eq [int]$p.nodePid) {
      $null
      return
    }
    @{
      hwnd = [string]([Int64]$h)
      title = [Win32]::Title($h)
    } | ConvertTo-Json -Compress
  `
  try {
    const out = (await runPowerShell(script)).trim()
    if (!out) return null
    const parsed = JSON.parse(out) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    const p = parsed as { hwnd?: unknown; title?: unknown }
    const hwnd = typeof p.hwnd === 'string' ? p.hwnd : ''
    const title = typeof p.title === 'string' ? p.title : ''
    if (!hwnd) return null
    return { hwnd, title }
  } catch {
    return null
  }
}

export async function activateExternalWindow(hwnd: string): Promise<boolean> {
  if (process.platform !== 'win32') return false
  const h = typeof hwnd === 'string' ? hwnd.trim() : ''
  if (!h) return false
  const b64 = psJsonB64({ hwnd: h })
  const script = `
    $p = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64}')) | ConvertFrom-Json
    ${getExternalWindowPreamblePs()}
    $h = [IntPtr]([Int64]([string]$p.hwnd))
    [Win32]::SetForegroundWindow($h) | Out-Null
    $true
  `
  try {
    await runPowerShell(script)
    return true
  } catch {
    return false
  }
}

export async function raiseExternalWindow(hwnd: string): Promise<boolean> {
  if (process.platform !== 'win32') return false
  const h = typeof hwnd === 'string' ? hwnd.trim() : ''
  if (!h) return false
  const b64 = psJsonB64({ hwnd: h })
  const script = `
    $p = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64}')) | ConvertFrom-Json
    ${getExternalWindowPreamblePs()}
    $h = [IntPtr]([Int64]([string]$p.hwnd))
    $GA_ROOTOWNER = 3
    $root = [Win32]::GetAncestor($h, [uint32]$GA_ROOTOWNER)
    if ($root -eq [IntPtr]::Zero) { $root = $h }
    $SWP_NOSIZE = 0x0001
    $SWP_NOMOVE = 0x0002
    $SWP_NOACTIVATE = 0x0010
    $SWP_SHOWWINDOW = 0x0040
    $flags = $SWP_NOSIZE -bor $SWP_NOMOVE -bor $SWP_NOACTIVATE -bor $SWP_SHOWWINDOW
    $HWND_TOPMOST = [IntPtr](-1)
    $HWND_NOTOPMOST = [IntPtr](-2)
    try {
      [Win32]::ShowWindow($root, 4) | Out-Null # SW_SHOWNOACTIVATE
    } catch { }
    [Win32]::SetWindowPos($root, $HWND_TOPMOST, 0, 0, 0, 0, [uint32]$flags) | Out-Null
    [Win32]::SetWindowPos($root, $HWND_NOTOPMOST, 0, 0, 0, 0, [uint32]$flags) | Out-Null
    $true
  `
  try {
    await runPowerShell(script)
    return true
  } catch {
    return false
  }
}

export async function setExternalWindowTopmost(hwnd: string, topmost: boolean): Promise<boolean> {
  if (process.platform !== 'win32') return false
  const h = typeof hwnd === 'string' ? hwnd.trim() : ''
  if (!h) return false
  const b64 = psJsonB64({ hwnd: h, topmost: Boolean(topmost) })
  const script = `
    $p = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64}')) | ConvertFrom-Json
    ${getExternalWindowPreamblePs()}
    $h = [IntPtr]([Int64]([string]$p.hwnd))
    $GA_ROOTOWNER = 3
    $root = [Win32]::GetAncestor($h, [uint32]$GA_ROOTOWNER)
    if ($root -eq [IntPtr]::Zero) { $root = $h }
    $SWP_NOSIZE = 0x0001
    $SWP_NOMOVE = 0x0002
    $SWP_NOACTIVATE = 0x0010
    $SWP_SHOWWINDOW = 0x0040
    $flags = $SWP_NOSIZE -bor $SWP_NOMOVE -bor $SWP_NOACTIVATE -bor $SWP_SHOWWINDOW
    $HWND_TOPMOST = [IntPtr](-1)
    $HWND_NOTOPMOST = [IntPtr](-2)
    $after = if ([bool]$p.topmost) { $HWND_TOPMOST } else { $HWND_NOTOPMOST }
    try {
      [Win32]::ShowWindow($root, 4) | Out-Null # SW_SHOWNOACTIVATE
    } catch { }
    [Win32]::SetWindowPos($root, $after, 0, 0, 0, 0, [uint32]$flags) | Out-Null
    $true
  `
  try {
    await runPowerShell(script)
    return true
  } catch {
    return false
  }
}

export async function getExternalWindowRect(hwnd: string): Promise<ExternalWindowRect | null> {
  if (process.platform !== 'win32') return null
  const h = typeof hwnd === 'string' ? hwnd.trim() : ''
  if (!h) return null
  const b64 = psJsonB64({ hwnd: h })
  const script = `
    $p = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64}')) | ConvertFrom-Json
    ${getExternalWindowPreamblePs()}
    $h = [IntPtr]([Int64]([string]$p.hwnd))
    $rect = New-Object Win32+RECT
    $okRect = [Win32]::GetWindowRect($h, [ref]$rect)
    if (-not $okRect) {
      $null
      return
    }
    @{
      left = [int]$rect.Left
      top = [int]$rect.Top
      right = [int]$rect.Right
      bottom = [int]$rect.Bottom
    } | ConvertTo-Json -Compress
  `
  try {
    const out = (await runPowerShell(script)).trim()
    if (!out) return null
    const parsed = JSON.parse(out) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    const p = parsed as Record<string, unknown>
    const left = Number(p['left'])
    const top = Number(p['top'])
    const right = Number(p['right'])
    const bottom = Number(p['bottom'])
    if (
      !Number.isFinite(left) ||
      !Number.isFinite(top) ||
      !Number.isFinite(right) ||
      !Number.isFinite(bottom)
    )
      return null
    return { left, top, right, bottom }
  } catch {
    return null
  }
}

export async function warmupExternalWindowPowerShell(): Promise<void> {
  if (process.platform !== 'win32') return
  const script = `
    ${getExternalWindowPreamblePs()}
    [Win32]::GetForegroundWindow() | Out-Null
    $true
  `
  try {
    await runPowerShell(script)
  } catch {
    void 0
  }
  try {
    await runPowerShell(script, { sta: true })
  } catch {
    void 0
  }
}
