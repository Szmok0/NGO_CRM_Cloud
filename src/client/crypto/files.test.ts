// Szyfrowanie załączników na WebCrypto z Node. Dane fikcyjne.
import { describe, expect, it } from 'vitest'
import { ATTACHMENT_ENCRYPTION_OVERHEAD, ATTACHMENT_MAX_META } from '@shared/api'
import { fromBase64 } from './encoding'
import { decryptFile, decryptMeta, encryptFile, reencryptMeta } from './files'
import { generateOrgKey } from './keys'

const T = { targetType: 'contact', targetId: '00000000-0000-4000-8000-0000000000c3' }
const OTHER = { targetType: 'contact', targetId: '00000000-0000-4000-8000-0000000000d4' }
const bytes = () => Uint8Array.from({ length: 5000 }, (_, i) => (i * 7) % 256)

describe('załączniki', () => {
  it('odszyfrowanie daje te same bajty i nazwę; narzut 28 B; szyfrogram nie zawiera nazwy', async () => {
    const key = await generateOrgKey()
    const plain = bytes()
    const enc = await encryptFile(plain.buffer, { name: 'orzeczenie zażółć.pdf', type: 'application/pdf' }, key, T, 3)
    expect(enc.body.length).toBe(plain.length + ATTACHMENT_ENCRYPTION_OVERHEAD)
    expect(enc.metaEnc.length).toBeLessThanOrEqual(ATTACHMENT_MAX_META)
    expect(atob(enc.metaEnc)).not.toContain('orzeczenie')
    const meta = await decryptMeta(enc.metaEnc, key, T, 3)
    expect(meta).toMatchObject({ name: 'orzeczenie zażółć.pdf', type: 'application/pdf' })
    expect(fromBase64(meta.fileKey)).toHaveLength(32)
    expect(new Uint8Array(await decryptFile(enc.body.buffer, meta.fileKey, 3))).toEqual(plain)
  })

  it('zły klucz organizacji, inny cel albo wersja → błąd; zmieniony plik → błąd', async () => {
    const key = await generateOrgKey()
    const enc = await encryptFile(bytes().buffer, { name: 'a.txt', type: 'text/plain' }, key, T, 3)
    await expect(decryptMeta(enc.metaEnc, await generateOrgKey(), T, 3)).rejects.toThrow()
    await expect(decryptMeta(enc.metaEnc, key, OTHER, 3)).rejects.toThrow()
    await expect(decryptMeta(enc.metaEnc, key, T, 4)).rejects.toThrow()
    const meta = await decryptMeta(enc.metaEnc, key, T, 3)
    await expect(decryptFile(enc.body.buffer, meta.fileKey, 4)).rejects.toThrow()
    const bad = enc.body.slice()
    bad[20] ^= 1
    await expect(decryptFile(bad.buffer, meta.fileKey, 3)).rejects.toThrow()
  })

  it('bardzo długa nazwa jest skracana, metadane mieszczą się w limicie', async () => {
    const key = await generateOrgKey()
    const enc = await encryptFile(new ArrayBuffer(10), { name: 'ż'.repeat(1000), type: 'x/'.repeat(200) }, key, T, 1)
    expect(enc.metaEnc.length).toBeLessThanOrEqual(ATTACHMENT_MAX_META)
  })

  it('zmiana klucza: metadane nowym kluczem i wersją, plik bez zmian dalej się odszyfrowuje', async () => {
    const oldKey = await generateOrgKey()
    const newKey = await generateOrgKey()
    const plain = bytes()
    const enc = await encryptFile(plain.buffer, { name: 'a.pdf', type: 'application/pdf' }, oldKey, T, 1)
    const metaEnc = await reencryptMeta(enc.metaEnc, oldKey, 1, newKey, 2, T)
    expect(metaEnc).not.toBe(enc.metaEnc)
    await expect(decryptMeta(metaEnc, oldKey, T, 2)).rejects.toThrow()
    await expect(decryptMeta(metaEnc, newKey, T, 1)).rejects.toThrow()
    const meta = await decryptMeta(metaEnc, newKey, T, 2)
    expect(meta.name).toBe('a.pdf')
    expect(meta.fileVersion).toBe(1)
    expect(new Uint8Array(await decryptFile(enc.body.buffer, meta.fileKey, meta.fileVersion ?? 2))).toEqual(plain)
    // druga zmiana zachowuje wersję AAD pliku
    const third = await generateOrgKey()
    const meta3 = await decryptMeta(await reencryptMeta(metaEnc, newKey, 2, third, 3, T), third, T, 3)
    expect(meta3.fileVersion).toBe(1)
  })
})
