import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const builderArgs = ['electron-builder', ...args]

if (existsSync(path.join(projectRoot, 'dist', 'win-unpacked'))) {
  console.warn(
    '[pack] dist/win-unpacked could not be removed (file lock). Packaging to release/ instead.\n' +
      '       Close running toolssss/electron, and close any editor tabs under dist/ (especially app.asar).'
  )
  builderArgs.push('--config.directories.output=release')
}

const result = spawnSync('npx', builderArgs, {
  cwd: projectRoot,
  stdio: 'inherit',
  shell: true
})

process.exit(result.status ?? 1)
