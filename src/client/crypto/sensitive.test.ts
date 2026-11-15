// Szyfrowanie danych wrażliwych na WebCrypto z Node. Dane fikcyjne, tylko tutaj.
import { describe, expect, it } from 'vitest'
import { fromBase64, toBase64 } from './encoding'
import { generateOrgKey } from './keys'
import { decryptSensitive, emptySensitive, encryptSensitive, reencryptSensitive, type SensitiveFields } from './sensitive'

const PERSON = '00000000-0000-4000-8000-0000000000c3'
const OTHER = '00000000-0000-4000-8000-0000000000d4'
const FIELDS: SensitiveFields = {
  pesel: '85031212343',
  disability: 'umiarkowany',
  disabilityValidUntil: '2030-01-31',
  health: 'Fikcyjna notatka o zdrowiu — zażółć gęślą jaźń',
  family: 'Fikcyjna sytuacja rodzinna',
  notes: ''
}

describe('dane wrażliwe', () => {
  it('szyfruje i odszyfrowuje JSON; IV ma 12 bajtów (16 znaków base64)', async () => {
    const key = await generateOrgKey()
    const enc = await encryptSensitive(FIELDS, key, PERSON, 1)
    expect(enc.iv).toHaveLength(16)
    expect(fromBase64(enc.iv)).toHaveLength(12)
    expect(enc.ciphertext).not.toContain('85031212343')
    expect(await decryptSensitive(enc, key, PERSON, 1)).toEqual(FIELDS)
  })

  it('losowe IV: ten sam JSON daje różne szyfrogramy', async () => {
    const key = await generateOrgKey()
    const a = await encryptSensitive(FIELDS, key, PERSON, 1)
    const b = await encryptSensitive(FIELDS, key, PERSON, 1)
    expect(a.iv).not.toBe(b.iv)
    expect(a.ciphertext).not.toBe(b.ciphertext)
  })

  it('inny contact_id → błąd (szyfrogramu nie da się przenieść na inną osobę)', async () => {
    const key = await generateOrgKey()
    const enc = await encryptSensitive(FIELDS, key, PERSON, 1)
    await expect(decryptSensitive(enc, key, OTHER, 1)).rejects.toThrow()
  })

  it('inna wersja klucza, inny klucz albo zmieniony szyfrogram → błąd', async () => {
    const key = await generateOrgKey()
    const enc = await encryptSensitive(FIELDS, key, PERSON, 1)
    await expect(decryptSensitive(enc, key, PERSON, 2)).rejects.toThrow()
    await expect(decryptSensitive(enc, await generateOrgKey(), PERSON, 1)).rejects.toThrow()
    const bytes = fromBase64(enc.ciphertext)
    bytes[0] = bytes[0]! ^ 1
    await expect(decryptSensitive({ iv: enc.iv, ciphertext: toBase64(bytes) }, key, PERSON, 1)).rejects.toThrow()
  })

  it('brakujące i obce pola: puste teksty, bez nieznanych kluczy', async () => {
    const key = await generateOrgKey()
    const partial = { pesel: '02270803624', extra: 'x', health: 5 } as unknown as SensitiveFields
    const enc = await encryptSensitive(partial, key, PERSON, 1)
    expect(await decryptSensitive(enc, key, PERSON, 1)).toEqual({ ...emptySensitive(), pesel: '02270803624' })
  })

  it('zmiana klucza: nowy klucz i wersja, te same dane, stary klucz już nie działa', async () => {
    const oldKey = await generateOrgKey()
    const newKey = await generateOrgKey()
    const enc = await encryptSensitive(FIELDS, oldKey, PERSON, 1)
    const next = await reencryptSensitive(enc, oldKey, 1, newKey, 2, PERSON)
    expect(next.iv).not.toBe(enc.iv)
    expect(await decryptSensitive(next, newKey, PERSON, 2)).toEqual(FIELDS)
    await expect(decryptSensitive(next, oldKey, PERSON, 2)).rejects.toThrow()
    await expect(decryptSensitive(next, newKey, PERSON, 1)).rejects.toThrow()
  })
})
