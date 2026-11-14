// Klucz odzyskiwania: losowe 256 bitów pokazane raz w kreatorze, do wydruku.
// Zapis: 14 grup po 4 znaki (Crockford Base32, bez I, L, O, U): 256 bitów klucza + 24 bity sumy kontrolnej,
// żeby literówka przy przepisywaniu z kartki była wykrywana od razu.
import { orgKeyLabel } from './keys'
import { parseSealed, randomBytes, sealed, utf8 } from './encoding'

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const KEY_BYTES = 32
const CHECK_BYTES = 3
const CHARS = ((KEY_BYTES + CHECK_BYTES) * 8) / 5 // 56

export const generateRecoveryKey = () => randomBytes(KEY_BYTES)

async function checksum(key: Uint8Array): Promise<Uint8Array> {
  const data = new Uint8Array([...utf8('ngo-crm/recovery-check'), ...key])
  return new Uint8Array(await crypto.subtle.digest('SHA-256', data)).slice(0, CHECK_BYTES)
}

/** Klucz w postaci do wydruku: „XXXX-XXXX-…” (14 grup). */
export async function formatRecoveryKey(key: Uint8Array): Promise<string> {
  if (key.length !== KEY_BYTES) throw new Error('Nieprawidłowa długość klucza odzyskiwania')
  const bytes = [...key, ...(await checksum(key))]
  let bits = 0
  let acc = 0
  let out = ''
  for (const b of bytes) {
    acc = (acc << 8) | b
    bits += 8
    while (bits >= 5) {
      out += ALPHABET[(acc >>> (bits - 5)) & 31]
      bits -= 5
    }
    acc &= (1 << bits) - 1
  }
  return out.match(/.{4}/g)!.join('-')
}

/**
 * Odczyt klucza wpisanego z kartki. Wybacza małe litery, spacje, myślniki oraz O zamiast 0 i I/L zamiast 1.
 * Zła długość, niedozwolony znak albo literówka (suma kontrolna) → błąd RECOVERY_KEY_INVALID.
 */
export async function parseRecoveryKey(text: string): Promise<Uint8Array<ArrayBuffer>> {
  const invalid = () => new Error('RECOVERY_KEY_INVALID')
  const clean = text.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1')
  if (clean.length !== CHARS) throw invalid()
  const bytes = new Uint8Array(KEY_BYTES + CHECK_BYTES)
  let bits = 0
  let acc = 0
  let n = 0
  for (const ch of clean) {
    const v = ALPHABET.indexOf(ch)
    if (v < 0) throw invalid()
    acc = (acc << 5) | v
    bits += 5
    if (bits >= 8) {
      bytes[n++] = (acc >>> (bits - 8)) & 255
      bits -= 8
      acc &= (1 << bits) - 1
    }
  }
  const key = bytes.slice(0, KEY_BYTES)
  const expected = await checksum(key)
  if (!bytes.slice(KEY_BYTES).every((b, i) => b === expected[i])) throw invalid()
  return key
}

// ---------- slot odzyskiwania ----------

async function recoveryWrapKey(recoveryKey: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const hkdf = await crypto.subtle.importKey('raw', recoveryKey, 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: utf8('ngo-crm/recovery') },
    hkdf,
    { name: 'AES-GCM', length: 256 },
    false,
    ['wrapKey', 'unwrapKey']
  )
}

/** Slot odzyskiwania: klucz organizacji zaszyfrowany kluczem odzyskiwania. Na serwerze leży tylko ten slot. */
export async function createRecoverySlot(orgKey: CryptoKey, recoveryKey: Uint8Array<ArrayBuffer>, keyVersion: number): Promise<string> {
  const iv = randomBytes(12)
  const ciphertext = await crypto.subtle.wrapKey('raw', orgKey, await recoveryWrapKey(recoveryKey), { name: 'AES-GCM', iv, additionalData: orgKeyLabel(keyVersion) })
  return sealed(iv, ciphertext)
}

export async function openRecoverySlot(slot: string, recoveryKey: Uint8Array<ArrayBuffer>, keyVersion: number, extractable = true): Promise<CryptoKey> {
  const { iv, ciphertext } = parseSealed(slot)
  return crypto.subtle.unwrapKey(
    'raw',
    ciphertext,
    await recoveryWrapKey(recoveryKey),
    { name: 'AES-GCM', iv, additionalData: orgKeyLabel(keyVersion) },
    { name: 'AES-GCM', length: 256 },
    extractable,
    ['encrypt', 'decrypt']
  )
}
