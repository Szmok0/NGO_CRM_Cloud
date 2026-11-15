// Dane wrażliwe osoby (ZADANIE_03, D1): jeden JSON na osobę, AES-GCM kluczem organizacji, losowe IV 96 bitów,
// AAD = id osoby + wersja klucza (bezpieczeństwo 5.4), więc szyfrogramu nie da się przenieść na inną osobę ani wersję.
import { fromBase64, randomBytes, toBase64, utf8 } from './encoding'

/** Pola wrażliwe (D1). Puste pole = pusty tekst; data jako `YYYY-MM-DD` albo pusty tekst. */
export interface SensitiveFields {
  pesel: string
  /** Orzeczenie: rodzaj / stopień. */
  disability: string
  /** Orzeczenie ważne do. */
  disabilityValidUntil: string
  health: string
  family: string
  notes: string
}

export const SENSITIVE_KEYS = ['pesel', 'disability', 'disabilityValidUntil', 'health', 'family', 'notes'] as const satisfies readonly (keyof SensitiveFields)[]

export const emptySensitive = (): SensitiveFields => ({ pesel: '', disability: '', disabilityValidUntil: '', health: '', family: '', notes: '' })

const sensitiveAad = (contactId: string, keyVersion: number) => utf8(`ngo-crm/sensitive/${contactId}/v${keyVersion}`)

export interface SensitiveEncrypted {
  /** 12 bajtów w base64 (16 znaków). */
  iv: string
  ciphertext: string
}

export async function encryptSensitive(fields: SensitiveFields, orgKey: CryptoKey, contactId: string, keyVersion: number): Promise<SensitiveEncrypted> {
  const iv = randomBytes(12)
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: sensitiveAad(contactId, keyVersion) }, orgKey, utf8(JSON.stringify(fields)))
  return { iv: toBase64(iv), ciphertext: toBase64(ciphertext) }
}

/** Inny klucz, inna osoba, inna wersja albo zmieniony szyfrogram → błąd WebCrypto. Brakujące pola → pusty tekst. */
export async function decryptSensitive(data: SensitiveEncrypted, orgKey: CryptoKey, contactId: string, keyVersion: number): Promise<SensitiveFields> {
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(data.iv), additionalData: sensitiveAad(contactId, keyVersion) }, orgKey, fromBase64(data.ciphertext))
  const parsed: unknown = JSON.parse(new TextDecoder().decode(plain))
  const out = emptySensitive()
  if (parsed && typeof parsed === 'object') {
    for (const k of SENSITIVE_KEYS) {
      const v = (parsed as Record<string, unknown>)[k]
      if (typeof v === 'string') out[k] = v
    }
  }
  return out
}

/** Zmiana klucza organizacji: szyfrogram odszyfrowany starym kluczem i zaszyfrowany nowym (nowy IV, AAD z nową wersją). */
export async function reencryptSensitive(data: SensitiveEncrypted, oldKey: CryptoKey, oldVersion: number, newKey: CryptoKey, newVersion: number, contactId: string): Promise<SensitiveEncrypted> {
  return encryptSensitive(await decryptSensitive(data, oldKey, contactId, oldVersion), newKey, contactId, newVersion)
}
