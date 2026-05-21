import { app, safeStorage } from 'electron'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

type SecretsV2 = {
  v: 2
  aiApiKey?: string
  aiApiKeys?: Record<string, string>
}

function secretsFilePath(): string {
  return join(app.getPath('userData'), 'secrets.json')
}

function loadSecretsFromDisk(): SecretsV2 {
  try {
    const raw = readFileSync(secretsFilePath(), 'utf-8')
    const v = JSON.parse(raw) as unknown
    if (!v || typeof v !== 'object') return { v: 2 }
    const obj = v as Record<string, unknown>
    const out: SecretsV2 = { v: 2 }
    if (typeof obj['aiApiKey'] === 'string') out.aiApiKey = obj['aiApiKey']
    if (obj['aiApiKeys'] && typeof obj['aiApiKeys'] === 'object') {
      const aiApiKeys = obj['aiApiKeys'] as Record<string, unknown>
      const next: Record<string, string> = {}
      for (const [key, value] of Object.entries(aiApiKeys)) {
        const normalizedKey = key.trim()
        if (!normalizedKey || typeof value !== 'string' || !value.trim()) continue
        next[normalizedKey] = value
      }
      if (Object.keys(next).length) out.aiApiKeys = next
    }
    return out
  } catch {
    return { v: 2 }
  }
}

function saveSecretsToDisk(next: SecretsV2): void {
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

function resolveAiSecretKey(profileId: string): string | null {
  const trimmed = profileId.trim()
  return trimmed || null
}

function readEncryptedAiApiKey(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const decrypted = decryptFromBase64(value)
  return typeof decrypted === 'string' && decrypted.trim() ? decrypted : null
}

export function getLegacyAiApiKeyFromSecrets(): string | null {
  const secrets = loadSecretsFromDisk()
  return readEncryptedAiApiKey(secrets.aiApiKey)
}

export function getAiApiKeyFromSecrets(profileId: string): string | null {
  const secretKey = resolveAiSecretKey(profileId)
  if (!secretKey) return null
  const secrets = loadSecretsFromDisk()
  const mapped = secrets.aiApiKeys?.[secretKey]
  return readEncryptedAiApiKey(mapped)
}

export function setAiApiKeyToSecrets(profileId: string, apiKey: string): boolean
export function setAiApiKeyToSecrets(apiKey: string): boolean
export function setAiApiKeyToSecrets(profileIdOrApiKey: string, maybeApiKey?: string): boolean {
  const profileId = maybeApiKey === undefined ? '' : profileIdOrApiKey
  const apiKey = maybeApiKey === undefined ? profileIdOrApiKey : maybeApiKey
  const trimmed = apiKey.trim()
  if (!trimmed) return false
  const enc = encryptToBase64(trimmed)
  if (!enc) return false
  const secretKey = resolveAiSecretKey(profileId)
  if (!secretKey) return false
  const secrets = loadSecretsFromDisk()
  const aiApiKeys = { ...(secrets.aiApiKeys ?? {}), [secretKey]: enc }
  const next: SecretsV2 = { ...secrets, v: 2, aiApiKeys }
  saveSecretsToDisk(next)
  return true
}

export function clearAiApiKeyFromSecrets(profileId: string): boolean {
  try {
    const secretKey = resolveAiSecretKey(profileId)
    if (!secretKey) return false
    const secrets = loadSecretsFromDisk()
    const next: SecretsV2 = { ...secrets, v: 2, aiApiKeys: { ...(secrets.aiApiKeys ?? {}) } }
    if (next.aiApiKeys) delete next.aiApiKeys[secretKey]
    if (next.aiApiKeys && !Object.keys(next.aiApiKeys).length) delete next.aiApiKeys
    saveSecretsToDisk(next)
    return true
  } catch {
    return false
  }
}
