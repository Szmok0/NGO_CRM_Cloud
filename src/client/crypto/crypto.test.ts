// Kryptografia przeglądarki na WebCrypto z Node (globalThis.crypto). Hasła i identyfikatory fikcyjne, tylko tutaj.
import { beforeAll, describe, expect, it } from 'vitest'
import { fromBase64, randomBytes, utf8 } from './encoding'
import { KDF_ITERATIONS, KDF_SALT_BYTES, deriveKeys, newKdfSalt } from './kdf'
import {
  createSlot,
  exportPublicKey,
  generateOrgKey,
  generateUserKeyPair,
  importPublicKey,
  openSlot,
  rewrapPrivateKey,
  unwrapPrivateKey,
  wrapPrivateKey
} from './keys'
import { createRecoverySlot, formatRecoveryKey, generateRecoveryKey, openRecoverySlot, parseRecoveryKey } from './recovery'

const FAST = 1000 // mniej iteracji w testach, które nie sprawdzają samego PBKDF2
const USER = '00000000-0000-4000-8000-0000000000a1'
const OTHER = '00000000-0000-4000-8000-0000000000b2'
const PASSWORD = 'testowe-haslo-zazolc-123'

/** Czy dwa klucze organizacji to ten sam klucz: jeden szyfruje, drugi odszyfrowuje. */
async function sameAesKey(a: CryptoKey, b: CryptoKey) {
  const iv = randomBytes(12)
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, a, utf8('próba'))
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, b, ct)
  return new TextDecoder().decode(pt) === 'próba'
}

let alice: CryptoKeyPair
let bob: CryptoKeyPair
beforeAll(async () => {
  ;[alice, bob] = await Promise.all([generateUserKeyPair(), generateUserKeyPair()])
})

describe('hasło → authKey i wrapKey', () => {
  it('pełne parametry: 600 000 iteracji, sól 16 B, authKey 32 B; to samo hasło i sól → ten sam authKey', async () => {
    expect(KDF_ITERATIONS).toBe(600_000)
    const salt = newKdfSalt()
    expect(salt).toHaveLength(KDF_SALT_BYTES)
    const a = await deriveKeys(PASSWORD, salt)
    const b = await deriveKeys(PASSWORD, salt)
    expect(a.authKey).toBe(b.authKey)
    expect(fromBase64(a.authKey)).toHaveLength(32)
  })

  it('inne hasło, inna sól albo inna liczba iteracji → inny authKey', async () => {
    const salt = newKdfSalt()
    const base = (await deriveKeys(PASSWORD, salt, FAST)).authKey
    expect((await deriveKeys(PASSWORD + 'x', salt, FAST)).authKey).not.toBe(base)
    expect((await deriveKeys(PASSWORD, newKdfSalt(), FAST)).authKey).not.toBe(base)
    expect((await deriveKeys(PASSWORD, salt, FAST + 1)).authKey).not.toBe(base)
  })

  it('polskie znaki złożone i rozłożone (NFC/NFD) dają te same klucze', async () => {
    const salt = newKdfSalt()
    const nfc = await deriveKeys('zażółć gęślą jaźń'.normalize('NFC'), salt, FAST)
    const nfd = await deriveKeys('zażółć gęślą jaźń'.normalize('NFD'), salt, FAST)
    expect(nfc.authKey).toBe(nfd.authKey)
  })

  it('wrapKey nie da się wyeksportować i nie jest tym samym co authKey', async () => {
    const salt = newKdfSalt()
    const { authKey, wrapKey } = await deriveKeys(PASSWORD, salt, FAST)
    expect(wrapKey.extractable).toBe(false)
    await expect(crypto.subtle.exportKey('raw', wrapKey)).rejects.toThrow()

    // Klucz AES zbudowany z authKey (to, co zna serwer) nie odszyfruje klucza prywatnego.
    const enc = await wrapPrivateKey(alice.privateKey, wrapKey, USER)
    const fromAuth = await crypto.subtle.importKey('raw', fromBase64(authKey), 'AES-GCM', false, ['wrapKey', 'unwrapKey'])
    await expect(unwrapPrivateKey(enc, fromAuth, USER)).rejects.toThrow()
  })
})

describe('klucz prywatny zaszyfrowany wrapKey', () => {
  it('zaszyfruj → odszyfruj: klucz działa i domyślnie nie da się go wyeksportować', async () => {
    const salt = newKdfSalt()
    const { wrapKey } = await deriveKeys(PASSWORD, salt, FAST)
    const enc = await wrapPrivateKey(alice.privateKey, wrapKey, USER)
    expect(enc).toMatch(/^v1\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$/)

    // nowe logowanie: klucze wyprowadzone od nowa z hasła
    const again = await deriveKeys(PASSWORD, salt, FAST)
    const privateKey = await unwrapPrivateKey(enc, again.wrapKey, USER)
    expect(privateKey.extractable).toBe(false)

    const orgKey = await generateOrgKey()
    const slot = await createSlot(orgKey, alice.publicKey, 1)
    expect(await sameAesKey(orgKey, await openSlot(slot, privateKey, 1))).toBe(true)
  })

  it('dwa szyfrowania tego samego klucza dają różne szyfrogramy (losowe IV)', async () => {
    const { wrapKey } = await deriveKeys(PASSWORD, newKdfSalt(), FAST)
    expect(await wrapPrivateKey(alice.privateKey, wrapKey, USER)).not.toBe(await wrapPrivateKey(alice.privateKey, wrapKey, USER))
  })

  it('złe hasło → błąd', async () => {
    const salt = newKdfSalt()
    const enc = await wrapPrivateKey(alice.privateKey, (await deriveKeys(PASSWORD, salt, FAST)).wrapKey, USER)
    const wrong = await deriveKeys('inne-haslo-testowe-456', salt, FAST)
    await expect(unwrapPrivateKey(enc, wrong.wrapKey, USER)).rejects.toThrow()
  })

  it('szyfrogram przeniesiony na inne konto → błąd', async () => {
    const { wrapKey } = await deriveKeys(PASSWORD, newKdfSalt(), FAST)
    const enc = await wrapPrivateKey(alice.privateKey, wrapKey, USER)
    await expect(unwrapPrivateKey(enc, wrapKey, OTHER)).rejects.toThrow()
  })

  it('zmieniony szyfrogram albo nieznany format → błąd', async () => {
    const { wrapKey } = await deriveKeys(PASSWORD, newKdfSalt(), FAST)
    const enc = await wrapPrivateKey(alice.privateKey, wrapKey, USER)
    const [v, iv, ct] = enc.split('.') as [string, string, string]
    const flipped = `${v}.${iv}.${ct.slice(0, 10)}${ct[10] === 'A' ? 'B' : 'A'}${ct.slice(11)}`
    await expect(unwrapPrivateKey(flipped, wrapKey, USER)).rejects.toThrow()
    expect(() => unwrapPrivateKey(`v2.${iv}.${ct}`, wrapKey, USER)).toThrow()
  })

  it('zmiana hasła: stare hasło przestaje działać, nowe działa, slot nadal się otwiera', async () => {
    const salt = newKdfSalt()
    const oldKeys = await deriveKeys(PASSWORD, salt, FAST)
    const enc = await wrapPrivateKey(alice.privateKey, oldKeys.wrapKey, USER)
    const orgKey = await generateOrgKey()
    const slot = await createSlot(orgKey, alice.publicKey, 1)

    const newSalt = newKdfSalt()
    const newKeys = await deriveKeys('nowe-haslo-testowe-789', newSalt, FAST)
    const reEnc = await rewrapPrivateKey(enc, oldKeys.wrapKey, newKeys.wrapKey, USER)

    await expect(unwrapPrivateKey(reEnc, oldKeys.wrapKey, USER)).rejects.toThrow()
    const privateKey = await unwrapPrivateKey(reEnc, newKeys.wrapKey, USER)
    expect(await sameAesKey(orgKey, await openSlot(slot, privateKey, 1))).toBe(true)
    expect(newKeys.authKey).not.toBe(oldKeys.authKey)
  })
})

describe('klucz organizacji i sloty', () => {
  it('para RSA-OAEP 3072; klucz publiczny eksportuje się i importuje', async () => {
    expect(alice.publicKey.algorithm).toMatchObject({ name: 'RSA-OAEP', modulusLength: 3072 })
    const imported = await importPublicKey(await exportPublicKey(alice.publicKey))
    const orgKey = await generateOrgKey()
    const slot = await createSlot(orgKey, imported, 1)
    expect(await sameAesKey(orgKey, await openSlot(slot, alice.privateKey, 1))).toBe(true)
  })

  it('nadanie dostępu: klucz odczytany ze slotu Alicji da się zaszyfrować dla Roberta', async () => {
    const orgKey = await generateOrgKey()
    const aliceSlot = await createSlot(orgKey, alice.publicKey, 1)
    const opened = await openSlot(aliceSlot, alice.privateKey, 1)
    const bobSlot = await createSlot(opened, bob.publicKey, 1)
    expect(await sameAesKey(orgKey, await openSlot(bobSlot, bob.privateKey, 1))).toBe(true)
  })

  it('cudzy klucz prywatny albo inna wersja klucza → błąd', async () => {
    const slot = await createSlot(await generateOrgKey(), alice.publicKey, 1)
    await expect(openSlot(slot, bob.privateKey, 1)).rejects.toThrow()
    await expect(openSlot(slot, alice.privateKey, 2)).rejects.toThrow()
  })

  it('klucz organizacji: AES-GCM 256, każdy inny', async () => {
    const a = await generateOrgKey()
    expect(a.algorithm).toMatchObject({ name: 'AES-GCM', length: 256 })
    await expect(sameAesKey(a, await generateOrgKey())).rejects.toThrow()
  })
})

describe('klucz odzyskiwania', () => {
  it('format: 14 grup po 4 znaki, bez I, L, O, U; odczyt zwraca ten sam klucz', async () => {
    const key = generateRecoveryKey()
    expect(key).toHaveLength(32)
    const text = await formatRecoveryKey(key)
    expect(text).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){13}[0-9A-HJKMNP-TV-Z]{4}$/)
    expect(await parseRecoveryKey(text)).toEqual(key)
    expect(await formatRecoveryKey(generateRecoveryKey())).not.toBe(text)
  })

  it('wybacza małe litery, spacje, brak myślników oraz O/I/L wpisane zamiast 0/1', async () => {
    const key = generateRecoveryKey()
    const text = await formatRecoveryKey(key)
    expect(await parseRecoveryKey(`  ${text.toLowerCase().replace(/-/g, ' ')} `)).toEqual(key)
    expect(await parseRecoveryKey(text.replace(/-/g, ''))).toEqual(key)
    expect(await parseRecoveryKey(text.replace(/0/g, 'O').replace(/1/g, 'l'))).toEqual(key)
  })

  it('literówka w dowolnym miejscu → błąd (suma kontrolna)', async () => {
    const text = await formatRecoveryKey(generateRecoveryKey())
    for (const pos of [0, 7, 30, text.length - 1]) {
      if (text[pos] === '-') continue
      const typo = text.slice(0, pos) + (text[pos] === 'A' ? 'B' : 'A') + text.slice(pos + 1)
      await expect(parseRecoveryKey(typo)).rejects.toThrow('RECOVERY_KEY_INVALID')
    }
  })

  it('zła długość, niedozwolony znak, zamienione sąsiednie grupy → błąd', async () => {
    const text = await formatRecoveryKey(generateRecoveryKey())
    await expect(parseRecoveryKey(text.slice(5))).rejects.toThrow('RECOVERY_KEY_INVALID')
    await expect(parseRecoveryKey(text + '-AAAA')).rejects.toThrow('RECOVERY_KEY_INVALID')
    await expect(parseRecoveryKey('U' + text.slice(1))).rejects.toThrow('RECOVERY_KEY_INVALID')
    await expect(parseRecoveryKey('')).rejects.toThrow('RECOVERY_KEY_INVALID')
    const g = text.split('-')
    if (g[0] !== g[1]) await expect(parseRecoveryKey([g[1], g[0], ...g.slice(2)].join('-'))).rejects.toThrow('RECOVERY_KEY_INVALID')
  })

  it('slot odzyskiwania: klucz z kartki odtwarza klucz organizacji; zły klucz albo inna wersja → błąd', async () => {
    const orgKey = await generateOrgKey()
    const recovery = generateRecoveryKey()
    const slot = await createRecoverySlot(orgKey, recovery, 1)

    const typed = await parseRecoveryKey(await formatRecoveryKey(recovery))
    expect(await sameAesKey(orgKey, await openRecoverySlot(slot, typed, 1))).toBe(true)
    await expect(openRecoverySlot(slot, generateRecoveryKey(), 1)).rejects.toThrow()
    await expect(openRecoverySlot(slot, typed, 2)).rejects.toThrow()
  })
})
