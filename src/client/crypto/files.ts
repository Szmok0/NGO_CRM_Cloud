// Załączniki (ZADANIE_03, D11): plik szyfrowany w przeglądarce losowym kluczem pliku (AES-GCM, IV 12 B przed szyfrogramem,
// razem narzut 28 B). Nazwa, typ i klucz pliku trafiają do `metaEnc`, zaszyfrowane kluczem organizacji (IV + szyfrogram
// w jednym base64). AAD wiąże metadane z celem i wersją klucza, a plik z wersją klucza. Serwer widzi tylko szyfrogram.
import { ATTACHMENT_MAX_META } from '@shared/api'
import { fromBase64, randomBytes, toBase64, utf8 } from './encoding'

const IV_BYTES = 12
/** Nazwa pliku w metadanych: krócej, żeby `metaEnc` zawsze mieścił się w limicie. */
export const FILE_NAME_MAX = 200

export interface FileMeta {
  name: string
  type: string
  /** Klucz pliku (surowe 32 bajty, base64). */
  fileKey: string
}

export interface EncryptedFile {
  /** IV (12 B) + szyfrogram z tagiem; wysyłany jako ciało żądania. */
  body: Uint8Array<ArrayBuffer>
  metaEnc: string
}

type Target = { targetType: string; targetId: string }

const metaAad = (t: Target, keyVersion: number) => utf8(`ngo-crm/attachment-meta/${t.targetType}/${t.targetId}/v${keyVersion}`)
const fileAad = (keyVersion: number) => utf8(`ngo-crm/attachment-file/v${keyVersion}`)

const concat = (iv: Uint8Array<ArrayBuffer>, ct: ArrayBuffer): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(iv.length + ct.byteLength)
  out.set(iv, 0)
  out.set(new Uint8Array(ct), iv.length)
  return out
}

export async function encryptFile(data: ArrayBuffer, meta: { name: string; type: string }, orgKey: CryptoKey, target: Target, keyVersion: number): Promise<EncryptedFile> {
  const fileKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
  const iv = randomBytes(IV_BYTES)
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: fileAad(keyVersion) }, fileKey, data)

  const payload: FileMeta = {
    name: meta.name.slice(0, FILE_NAME_MAX),
    type: meta.type.slice(0, 100),
    fileKey: toBase64(await crypto.subtle.exportKey('raw', fileKey))
  }
  const metaIv = randomBytes(IV_BYTES)
  const metaCt = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: metaIv, additionalData: metaAad(target, keyVersion) }, orgKey, utf8(JSON.stringify(payload)))
  const metaEnc = toBase64(concat(metaIv, metaCt))
  if (metaEnc.length > ATTACHMENT_MAX_META) throw new Error('Metadane załącznika są za duże')
  return { body: concat(iv, ct), metaEnc }
}

/** Zły klucz organizacji, inny cel, inna wersja albo zmieniony szyfrogram → błąd WebCrypto. */
export async function decryptMeta(metaEnc: string, orgKey: CryptoKey, target: Target, keyVersion: number): Promise<FileMeta> {
  const raw = fromBase64(metaEnc)
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, IV_BYTES), additionalData: metaAad(target, keyVersion) }, orgKey, raw.slice(IV_BYTES))
  const p: unknown = JSON.parse(new TextDecoder().decode(plain))
  const o = (p && typeof p === 'object' ? p : {}) as Record<string, unknown>
  if (typeof o.name !== 'string' || typeof o.fileKey !== 'string') throw new SyntaxError('Nieprawidłowe metadane załącznika')
  return { name: o.name, type: typeof o.type === 'string' ? o.type : '', fileKey: o.fileKey }
}

export async function decryptFile(body: ArrayBuffer, fileKeyB64: string, keyVersion: number): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey('raw', fromBase64(fileKeyB64), 'AES-GCM', false, ['decrypt'])
  const raw = new Uint8Array(body)
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, IV_BYTES), additionalData: fileAad(keyVersion) }, key, raw.slice(IV_BYTES))
}
