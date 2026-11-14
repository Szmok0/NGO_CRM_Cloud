// Klucze użytkownika i organizacji (NGO_CRM_CLOUD_BEZPIECZENSTWO.md 5.2):
// para RSA-OAEP 3072 na osobę, klucz organizacji AES-GCM 256, slot = klucz organizacji zaszyfrowany kluczem publicznym osoby.
import { fromBase64, parseSealed, randomBytes, sealed, toBase64, utf8 } from './encoding'

const RSA_IMPORT = { name: 'RSA-OAEP', hash: 'SHA-256' }
const AES = { name: 'AES-GCM', length: 256 }

/** Dane dodatkowe (AAD): szyfrogram klucza prywatnego działa tylko przy tym koncie. */
const privateKeyAad = (userId: string) => utf8(`ngo-crm/private-key/${userId}`)
/** Etykieta wiąże slot z wersją klucza organizacji. */
export const orgKeyLabel = (keyVersion: number) => utf8(`ngo-crm/org-key/v${keyVersion}`)

// ---------- para kluczy użytkownika ----------

export function generateUserKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(
    { name: 'RSA-OAEP', modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['wrapKey', 'unwrapKey']
  )
}

/** Klucz publiczny do zapisania na serwerze (jawny, SPKI w base64). */
export const exportPublicKey = async (key: CryptoKey) => toBase64(await crypto.subtle.exportKey('spki', key))

export const importPublicKey = (spkiBase64: string) => crypto.subtle.importKey('spki', fromBase64(spkiBase64), RSA_IMPORT, true, ['wrapKey'])

/** Klucz prywatny zaszyfrowany `wrapKey` (AES-GCM, losowe IV 96 bitów, AAD = id konta). W tej postaci leży na serwerze. */
export async function wrapPrivateKey(privateKey: CryptoKey, wrapKey: CryptoKey, userId: string): Promise<string> {
  const iv = randomBytes(12)
  const ciphertext = await crypto.subtle.wrapKey('pkcs8', privateKey, wrapKey, { name: 'AES-GCM', iv, additionalData: privateKeyAad(userId) })
  return sealed(iv, ciphertext)
}

/**
 * Odszyfrowuje klucz prywatny. Domyślnie nie da się go potem wyeksportować z WebCrypto
 * (`extractable` tylko na czas zmiany hasła). Złe hasło, inne konto albo zmieniony szyfrogram → błąd.
 */
export function unwrapPrivateKey(privateKeyEnc: string, wrapKey: CryptoKey, userId: string, extractable = false): Promise<CryptoKey> {
  const { iv, ciphertext } = parseSealed(privateKeyEnc)
  return crypto.subtle.unwrapKey('pkcs8', ciphertext, wrapKey, { name: 'AES-GCM', iv, additionalData: privateKeyAad(userId) }, RSA_IMPORT, extractable, ['unwrapKey'])
}

/** Zmiana hasła: ten sam klucz prywatny zaszyfrowany nowym `wrapKey`. Sloty i dane bez zmian. */
export async function rewrapPrivateKey(privateKeyEnc: string, oldWrapKey: CryptoKey, newWrapKey: CryptoKey, userId: string): Promise<string> {
  return wrapPrivateKey(await unwrapPrivateKey(privateKeyEnc, oldWrapKey, userId, true), newWrapKey, userId)
}

// ---------- klucz organizacji i sloty ----------

/** Nowy klucz organizacji (losowany w przeglądarce administratora; serwer nigdy go nie widzi). */
export const generateOrgKey = () => crypto.subtle.generateKey(AES, true, ['encrypt', 'decrypt'])

/** Slot: klucz organizacji zaszyfrowany kluczem publicznym osoby (base64). */
export async function createSlot(orgKey: CryptoKey, publicKey: CryptoKey, keyVersion: number): Promise<string> {
  return toBase64(await crypto.subtle.wrapKey('raw', orgKey, publicKey, { name: 'RSA-OAEP', label: orgKeyLabel(keyVersion) }))
}

/** Odczyt klucza organizacji ze slotu kluczem prywatnym osoby. `extractable`: potrzebne, by nadać dostęp kolejnej osobie. */
export function openSlot(slot: string, privateKey: CryptoKey, keyVersion: number, extractable = true): Promise<CryptoKey> {
  return crypto.subtle.unwrapKey('raw', fromBase64(slot), privateKey, { name: 'RSA-OAEP', label: orgKeyLabel(keyVersion) }, AES, extractable, ['encrypt', 'decrypt'])
}
