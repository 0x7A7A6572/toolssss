import { app, safeStorage } from 'electron'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

type SecretsV1 = {
  v: 1
  aiApiKey?: string
}

function secretsFilePath(): string {
  return join(app.getPath('userData'), 'secrets.json')
}

function loadSecretsFromDisk(): SecretsV1 {
  try {
    const raw = readFileSync(secretsFilePath(), 'utf-8')
    const v = JSON.parse(raw) as unknown
    if (!v || typeof v !== 'object') return { v: 1 }
    const obj = v as Record<string, unknown>
    const out: SecretsV1 = { v: 1 }
    if (typeof obj['aiApiKey'] === 'string') out.aiApiKey = obj['aiApiKey']
    return out
  } catch {
    return { v: 1 }
  }
}

function saveSecretsToDisk(next: SecretsV1): void {
  try {
    writeFileSync(secretsFilePath(), JSON.stringify(next), 'utf-8')
  } catch {
    return
  }
}

function encryptToBase64(text: string): string | null {
  if (!text.trim()) return null
  try {
    const buf = safeStorage.encryptString(text)
    return buf.toString('base64')
  } catch {
    return null
  }
}

function decryptFromBase64(base64: string): string | null {
  if (!base64.trim()) return null
  try {
    return safeStorage.decryptString(Buffer.from(base64, 'base64'))
  } catch {
    return null
  }
}

export function getAiApiKeyFromSecrets(): string | null {
  const secrets = loadSecretsFromDisk()
  if (typeof secrets.aiApiKey !== 'string' || !secrets.aiApiKey.trim()) return null
  const v = decryptFromBase64(secrets.aiApiKey)
  return typeof v === 'string' && v.trim() ? v : null
}

export function setAiApiKeyToSecrets(apiKey: string): boolean {
  const trimmed = apiKey.trim()
  if (!trimmed) return false
  const enc = encryptToBase64(trimmed)
  if (!enc) return false
  const secrets = loadSecretsFromDisk()
  saveSecretsToDisk({ ...secrets, v: 1, aiApiKey: enc })
  return true
}

export function clearAiApiKeyFromSecrets(): boolean {
  try {
    const secrets = loadSecretsFromDisk()
    if (!('aiApiKey' in secrets)) return true
    const next: SecretsV1 = { ...secrets, v: 1 }
    delete next.aiApiKey
    saveSecretsToDisk(next)
    return true
  } catch {
    return false
  }
}
