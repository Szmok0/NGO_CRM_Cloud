// Hasło nie opuszcza przeglądarki (NGO_CRM_CLOUD_BEZPIECZENSTWO.md 5.1; decyzje 7 i 8 w ZADANIU_01):
// master = PBKDF2-SHA256(hasło, sól użytkownika, 600 000) → HKDF-SHA256 → authKey (do serwera) i wrapKey (zostaje tutaj).
import { randomBytes, toBase64, utf8 } from './encoding'

export const KDF_ITERATIONS = 600_000
export const KDF_SALT_BYTES = 16

/** Losowa sól dla nowego hasła (zapisywana przy użytkowniku jako kdfSalt). */
export const newKdfSalt = () => randomBytes(KDF_SALT_BYTES)

export interface DerivedKeys {
  /** Wysyłany do serwera zamiast hasła (base64, 32 bajty). Z niego nie da się odtworzyć wrapKey. */
  authKey: string
  /** Szyfruje klucz prywatny użytkownika. Nie da się go wyeksportować z WebCrypto. */
  wrapKey: CryptoKey
}

export async function deriveKeys(password: string, salt: Uint8Array<ArrayBuffer>, iterations = KDF_ITERATIONS): Promise<DerivedKeys> {
  // NFKC: to samo hasło wpisane na różnych systemach (np. „ż” złożone i rozłożone) daje te same klucze.
  const material = await crypto.subtle.importKey('raw', utf8(password.normalize('NFKC')), 'PBKDF2', false, ['deriveBits'])
  const master = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, material, 256)
  const hkdf = await crypto.subtle.importKey('raw', master, 'HKDF', false, ['deriveBits', 'deriveKey'])
  const params = (info: string) => ({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: utf8(info) })

  const authKey = toBase64(await crypto.subtle.deriveBits(params('ngo-crm/auth'), hkdf, 256))
  const wrapKey = await crypto.subtle.deriveKey(params('ngo-crm/wrap'), hkdf, { name: 'AES-GCM', length: 256 }, false, ['wrapKey', 'unwrapKey'])
  return { authKey, wrapKey }
}
