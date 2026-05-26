import { execSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const winUnpacked = path.join(projectRoot, 'dist', 'win-unpacked')

function killProjectElectron() {
  if (process.platform === 'win32') {
    const escaped = projectRoot.replace(/'/g, "''")
    try {
      execSync(
        `powershell -NoProfile -Command "Get-Process electron,toolssss -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*${escaped}*' } | Stop-Process -Force -ErrorAction SilentlyContinue"`,
        { stdio: 'ignore' }
      )
    } catch {
      // no matching processes
    }
    return
  }

  try {
    execSync(`pkill -f "${path.join(projectRoot, 'node_modules')}"`, { stdio: 'ignore' })
  } catch {
    // no matching processes
  }
}

function removeWinUnpacked() {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      rmSync(winUnpacked, { recursive: true, force: true })
      return
    } catch {
      if (attempt === 4) {
        console.warn(
          '[prepare-pack] Could not remove dist/win-unpacked. Close any running app, dev server, or editor tabs for dist/** (especially app.asar), then retry.'
        )
        return
      }
      const until = Date.now() + 400
      while (Date.now() < until) {
        /* retry after file lock release */
      }
    }
  }
}

killProjectElectron()
removeWinUnpacked()
