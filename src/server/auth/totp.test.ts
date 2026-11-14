// TOTP: wektory z RFC, sprawdzanie kodów, szyfrowanie sekretu, blokada ponownego użycia (lokalna baza testowa), kod QR.
// Sekrety i konta fikcyjne, tylko tutaj; konta usuwane po testach.
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import type { Db } from '../db/connection'
import { users } from '../db/schema'
import { openTestDb } from '../testDb'
import { qrSvg } from './qr'
import {
  TOTP_STEP_SECONDS,
  base32Decode,
  base32Encode,
  consumeTotpCode,
  decryptTotpSecret,
  encryptTotpSecret,
  generateTotpSecret,
  hotp,
  matchingTotpSteps,
  otpauthUrl,
  totpStep
} from './totp'

const APP_SECRET = 'testowy-sekret-aplikacji-tylko-do-testow-0123456789'
const OTHER_APP_SECRET = 'inny-testowy-sekret-aplikacji-tylko-do-testow-98765'
const STEP_MS = TOTP_STEP_SECONDS * 1000
const T0 = Date.parse('2026-01-01T10:00:10.000Z')
const codeAt = (secret: string, timeMs: number) => hotp(base32Decode(secret), totpStep(timeMs))

describe('HOTP / TOTP: wektory z RFC', () => {
  const rfcSecret = Buffer.from('12345678901234567890', 'ascii')

  it('RFC 4226 (HOTP, 6 cyfr), liczniki 0–9', () => {
    const expected = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489']
    expect(expected.map((_, i) => hotp(rfcSecret, i))).toEqual(expected)
  })

  it.each([
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130']
  ])('RFC 6238 (TOTP, SHA-1, 8 cyfr), czas %i s', (seconds, code) => {
    expect(hotp(rfcSecret, totpStep(seconds * 1000), 8)).toBe(code)
  })

  it('base32: zapis i odczyt; nowy sekret ma 160 bitów (32 znaki), każdy inny', () => {
    expect(base32Encode(rfcSecret)).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ')
    expect(base32Decode('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ')).toEqual(rfcSecret)
    expect(base32Decode('gezd gnbv-gy3t qojq').toString('ascii')).toBe('1234567890')
    const s = generateTotpSecret()
    expect(s).toMatch(/^[A-Z2-7]{32}$/)
    expect(generateTotpSecret()).not.toBe(s)
    expect(() => base32Decode('nie!base32')).toThrow()
  })
})

describe('sprawdzanie kodu (bez bazy)', () => {
  const secret = generateTotpSecret()

  it('kod z bieżącego, poprzedniego i następnego okna pasuje (±1 okno)', () => {
    expect(matchingTotpSteps(secret, codeAt(secret, T0), T0)).toContain(totpStep(T0))
    expect(matchingTotpSteps(secret, codeAt(secret, T0 - STEP_MS), T0)).toContain(totpStep(T0) - 1)
    expect(matchingTotpSteps(secret, codeAt(secret, T0 + STEP_MS), T0)).toContain(totpStep(T0) + 1)
  })

  it('kod sprzed dwóch okien i za dwa okna nie pasuje', () => {
    // pomijamy rzadki przypadek, gdy kod z odległego okna jest równy kodowi z dozwolonego
    const allowed = [-1, 0, 1].map((i) => codeAt(secret, T0 + i * STEP_MS))
    for (const shift of [-2, 2]) {
      const code = codeAt(secret, T0 + shift * STEP_MS)
      if (!allowed.includes(code)) expect(matchingTotpSteps(secret, code, T0)).toEqual([])
    }
  })

  it('błędny kod i kod w złym formacie nie pasują', () => {
    const good = codeAt(secret, T0)
    const wrong = String((Number(good) + 1) % 1_000_000).padStart(6, '0')
    const allowed = [-1, 0, 1].map((i) => codeAt(secret, T0 + i * STEP_MS))
    if (!allowed.includes(wrong)) expect(matchingTotpSteps(secret, wrong, T0)).toEqual([])
    for (const bad of ['', '12345', '1234567', 'abcdef', '12 34', '１２３４５６', good + '0']) {
      expect(matchingTotpSteps(secret, bad, T0)).toEqual([])
    }
  })

  it('kod wpisany ze spacją („123 456”) jest przyjmowany', () => {
    const good = codeAt(secret, T0)
    expect(matchingTotpSteps(secret, `${good.slice(0, 3)} ${good.slice(3)}`, T0)).toContain(totpStep(T0))
  })

  it('kod innego sekretu nie pasuje', () => {
    const other = generateTotpSecret()
    const code = codeAt(other, T0)
    const allowed = [-1, 0, 1].map((i) => codeAt(secret, T0 + i * STEP_MS))
    if (!allowed.includes(code)) expect(matchingTotpSteps(secret, code, T0)).toEqual([])
  })
})

describe('sekret TOTP zaszyfrowany kluczem z APP_SECRET', () => {
  const USER = randomUUID()
  const secret = generateTotpSecret()

  it('zaszyfruj → odszyfruj; w zapisie nie ma sekretu; mieści się w kolumnie (255)', () => {
    const enc = encryptTotpSecret(secret, APP_SECRET, USER)
    expect(enc).toMatch(/^v1\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$/)
    expect(enc).not.toContain(secret)
    expect(Buffer.from(enc.split('.')[2]!, 'base64').toString('utf8')).not.toContain(secret)
    expect(enc.length).toBeLessThanOrEqual(255)
    expect(decryptTotpSecret(enc, APP_SECRET, USER)).toBe(secret)
    expect(encryptTotpSecret(secret, APP_SECRET, USER)).not.toBe(enc) // losowe IV
  })

  it('bez właściwego APP_SECRET sekret jest nieczytelny', () => {
    const enc = encryptTotpSecret(secret, APP_SECRET, USER)
    expect(() => decryptTotpSecret(enc, OTHER_APP_SECRET, USER)).toThrow()
  })

  it('szyfrogram przeniesiony na inne konto albo zmieniony → błąd', () => {
    const enc = encryptTotpSecret(secret, APP_SECRET, USER)
    expect(() => decryptTotpSecret(enc, APP_SECRET, randomUUID())).toThrow()
    const [v, iv, ct, tag] = enc.split('.') as [string, string, string, string]
    const flipped = Buffer.from(ct, 'base64')
    flipped[0]! ^= 1
    expect(() => decryptTotpSecret([v, iv, flipped.toString('base64'), tag].join('.'), APP_SECRET, USER)).toThrow()
    expect(() => decryptTotpSecret(`v2.${iv}.${ct}.${tag}`, APP_SECRET, USER)).toThrow()
  })
})

describe('kod z blokadą ponownego użycia (baza testowa)', () => {
  let db: Db
  let close: () => Promise<void>
  const created: string[] = []

  async function userWithTotp(withSecret = true) {
    const id = randomUUID()
    const secret = generateTotpSecret()
    created.push(id)
    const at = new Date(T0)
    await db.insert(users).values({
      id,
      createdAt: at,
      updatedAt: at,
      updatedBy: id,
      version: 1,
      email: `totp-test-${id}@example.invalid`,
      name: 'Konto testowe',
      role: 'staff',
      status: 'active',
      totpSecretEnc: withSecret ? encryptTotpSecret(secret, APP_SECRET, id) : null
    })
    return { id, secret }
  }
  const lastStep = async (id: string) => (await db.select({ s: users.totpLastStep, v: users.version }).from(users).where(eq(users.id, id)))[0]!

  beforeAll(async () => {
    ;({ db, close } = await openTestDb())
  })
  afterAll(async () => {
    if (!db) return
    if (created.length) await db.delete(users).where(inArray(users.id, created))
    await close()
  })

  it('poprawny kod jest przyjmowany raz; ten sam kod drugi raz → odmowa', async () => {
    const { id, secret } = await userWithTotp()
    const code = codeAt(secret, T0)
    expect(await consumeTotpCode(db, id, code, APP_SECRET, new Date(T0))).toBe(true)
    expect(await lastStep(id)).toEqual({ s: totpStep(T0), v: 1 }) // bez zmiany version
    expect(await consumeTotpCode(db, id, code, APP_SECRET, new Date(T0))).toBe(false)
    expect(await consumeTotpCode(db, id, code, APP_SECRET, new Date(T0 + 5000))).toBe(false)
  })

  it('po użyciu bieżącego kodu kod z poprzedniego okna też jest odrzucany; z następnego przechodzi', async () => {
    const { id, secret } = await userWithTotp()
    expect(await consumeTotpCode(db, id, codeAt(secret, T0), APP_SECRET, new Date(T0))).toBe(true)
    expect(await consumeTotpCode(db, id, codeAt(secret, T0 - STEP_MS), APP_SECRET, new Date(T0))).toBe(false)
    expect(await consumeTotpCode(db, id, codeAt(secret, T0 + STEP_MS), APP_SECRET, new Date(T0 + STEP_MS))).toBe(true)
  })

  it('kod z sąsiedniego okna (zegar telefonu spóźniony o 30 s) jest przyjmowany', async () => {
    const { id, secret } = await userWithTotp()
    expect(await consumeTotpCode(db, id, codeAt(secret, T0 - STEP_MS), APP_SECRET, new Date(T0))).toBe(true)
    expect((await lastStep(id)).s).toBe(totpStep(T0) - 1)
  })

  it('błędny kod → odmowa, nic nie zostaje zapisane', async () => {
    const { id, secret } = await userWithTotp()
    const allowed = [-1, 0, 1].map((i) => codeAt(secret, T0 + i * STEP_MS))
    const wrong = ['000000', '111111', '222222', '333333'].find((c) => !allowed.includes(c))!
    expect(await consumeTotpCode(db, id, wrong, APP_SECRET, new Date(T0))).toBe(false)
    expect(await consumeTotpCode(db, id, 'abcdef', APP_SECRET, new Date(T0))).toBe(false)
    expect((await lastStep(id)).s).toBeNull()
  })

  it('dwa równoczesne żądania z tym samym kodem: przechodzi dokładnie jedno', async () => {
    const { id, secret } = await userWithTotp()
    const code = codeAt(secret, T0)
    const results = await Promise.all([1, 2, 3, 4].map(() => consumeTotpCode(db, id, code, APP_SECRET, new Date(T0))))
    expect(results.filter(Boolean)).toHaveLength(1)
  })

  it('konto bez skonfigurowanego TOTP, nieistniejące albo usunięte → odmowa', async () => {
    const none = await userWithTotp(false)
    expect(await consumeTotpCode(db, none.id, '123456', APP_SECRET, new Date(T0))).toBe(false)
    expect(await consumeTotpCode(db, randomUUID(), '123456', APP_SECRET, new Date(T0))).toBe(false)
    const gone = await userWithTotp()
    await db.update(users).set({ deletedAt: new Date(T0) }).where(eq(users.id, gone.id))
    expect(await consumeTotpCode(db, gone.id, codeAt(gone.secret, T0), APP_SECRET, new Date(T0))).toBe(false)
  })

  it('zły APP_SECRET na serwerze → błąd, a nie ciche przyjęcie kodu', async () => {
    const { id, secret } = await userWithTotp()
    await expect(consumeTotpCode(db, id, codeAt(secret, T0), OTHER_APP_SECRET, new Date(T0))).rejects.toThrow()
  })
})

describe('adres otpauth i kod QR', () => {
  const secret = generateTotpSecret()
  const url = otpauthUrl(secret, 'osoba.testowa@example.invalid')

  it('adres otpauth ma sekret, wystawcę i parametry (SHA1, 6 cyfr, 30 s)', () => {
    const u = new URL(url)
    expect(u.protocol).toBe('otpauth:')
    expect(u.host).toBe('totp')
    expect(decodeURIComponent(u.pathname)).toBe('/NGO CRM:osoba.testowa@example.invalid')
    expect(Object.fromEntries(u.searchParams)).toEqual({ secret, issuer: 'NGO CRM', algorithm: 'SHA1', digits: '6', period: '30' })
  })

  it('QR to SVG bez stylów inline i skryptów (zgodny z CSP), ten sam adres → ten sam obrazek', async () => {
    const svg = await qrSvg(url)
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/)
    expect(svg).toContain('<path')
    expect(svg).not.toMatch(/<style|style=|<script|on\w+=|href=|<foreignObject/i)
    expect(svg).not.toContain(secret)
    expect(await qrSvg(url)).toBe(svg)
    expect(await qrSvg(otpauthUrl(generateTotpSecret(), 'osoba.testowa@example.invalid'))).not.toBe(svg)
  })
})
