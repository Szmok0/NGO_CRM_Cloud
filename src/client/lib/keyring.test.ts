// Klucze w pamięci karty: odblokowanie hasłem, złe hasło, sloty, blokada po bezczynności. Dane fikcyjne.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { toBase64 } from '../crypto/encoding'
import { deriveKeys, newKdfSalt } from '../crypto/kdf'
import { createSlot, generateOrgKey, generateUserKeyPair, wrapPrivateKey } from '../crypto/keys'

const USER = '00000000-0000-4000-8000-0000000000a1'
const PASSWORD = 'testowe-haslo-zazolc-123'
const ITERATIONS = 1000

const api = vi.hoisted(() => ({ responses: {} as Record<string, unknown> }))
vi.mock('./api', () => ({ call: async (method: string) => api.responses[method] }))

const keyring = await import('./keyring')

beforeAll(async () => {
  const salt = newKdfSalt()
  const { wrapKey } = await deriveKeys(PASSWORD, salt, ITERATIONS)
  const pair = await generateUserKeyPair()
  const orgKey = await generateOrgKey()
  api.responses['auth.keys'] = { kdfSalt: toBase64(salt), kdfIterations: ITERATIONS, publicKey: null, privateKeyEnc: await wrapPrivateKey(pair.privateKey, wrapKey, USER) }
  api.responses['keys.mySlots'] = [{ keyVersion: 1, wrappedKey: await createSlot(orgKey, pair.publicKey, 1) }]
})

afterEach(() => {
  keyring.lockKeys()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('keyring', () => {
  it('złe hasło: WrongPasswordError, klucze zostają zablokowane', async () => {
    await expect(keyring.unlockWithPassword('inne-haslo', USER)).rejects.toBeInstanceOf(keyring.WrongPasswordError)
    expect(keyring.keysUnlocked()).toBe(false)
    expect(keyring.orgKeyFor(1)).toBeNull()
  })

  it('dobre hasło: otwiera klucz prywatny i sloty; klucz organizacji jest niewyeksportowalny', async () => {
    expect(await keyring.unlockWithPassword(PASSWORD, USER)).toBe(true)
    expect(keyring.keysUnlocked()).toBe(true)
    const key = keyring.orgKeyFor(1)
    expect(key).not.toBeNull()
    expect(key!.extractable).toBe(false)
    await expect(crypto.subtle.exportKey('raw', key!)).rejects.toThrow()
  })

  it('eksportowalne klucze tylko na czas operacji; po zablokowaniu pusta mapa', async () => {
    await keyring.unlockWithPassword(PASSWORD, USER)
    const keys = await keyring.openExportableOrgKeys()
    expect([...keys.keys()]).toEqual([1])
    expect(keys.get(1)!.extractable).toBe(true)
    expect(keyring.orgKeyFor(1)!.extractable).toBe(false)
    keyring.lockKeys()
    expect((await keyring.openExportableOrgKeys()).size).toBe(0)
  })

  it('konto bez slotów: odblokowane, ale bez dostępu do danych wrażliwych', async () => {
    const slots = api.responses['keys.mySlots']
    api.responses['keys.mySlots'] = []
    try {
      await keyring.unlockWithPassword(PASSWORD, USER)
      expect(keyring.keysUnlocked()).toBe(true)
      expect(keyring.orgKeyFor(1)).toBeNull()
    } finally {
      api.responses['keys.mySlots'] = slots
    }
  })

  it('blokada po bezczynności; aktywność przesuwa termin', async () => {
    vi.useFakeTimers()
    const target = new EventTarget()
    vi.stubGlobal('window', target)
    await keyring.unlockWithPassword(PASSWORD, USER)
    const stop = keyring.startIdleLock(keyring.IDLE_LOCK_MS)
    vi.advanceTimersByTime(keyring.IDLE_LOCK_MS - 1000)
    target.dispatchEvent(new Event('keydown'))
    vi.advanceTimersByTime(keyring.IDLE_LOCK_MS - 1000)
    expect(keyring.keysUnlocked()).toBe(true)
    vi.advanceTimersByTime(1000)
    expect(keyring.keysUnlocked()).toBe(false)
    expect(keyring.orgKeyFor(1)).toBeNull()
    stop()
  })

  it('15 minut (D5)', () => {
    expect(keyring.IDLE_LOCK_MS).toBe(15 * 60 * 1000)
  })
})
