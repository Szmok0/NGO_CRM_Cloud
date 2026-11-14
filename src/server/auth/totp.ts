// Kody z aplikacji w telefonie (TOTP, RFC 6238 / HOTP RFC 4226), bez dodatkowych bibliotek. Przeniesione z iV_CRM.
// Decyzje MOC (ZADANIE_01, krok 5): 30 s, 6 cyfr, SHA-1, ±1 okno; ponowne użycie kodu blokowane kolumną totpLastStep;
// sekret w bazie zaszyfrowany kluczem z HKDF(APP_SECRET), AES-256-GCM.
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto'
import { and, eq, isNull, lt, or } from 'drizzle-orm'
import type { Db } from '../db/connection'
import { users } from '../db/schema'

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
export const TOTP_STEP_SECONDS = 30
const TOTP_WINDOW = 1
const ISSUER = 'NGO CRM'

export function base32Encode(buf: Buffer): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of buf) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
    value &= (1 << bits) - 1
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31]
  return out
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[\s=-]/g, '')
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const ch of clean) {
    const idx = BASE32.indexOf(ch)
    if (idx === -1) throw new Error('Nieprawidłowy sekret base32')
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255)
      bits -= 8
      value &= (1 << bits) - 1
    }
  }
  return Buffer.from(out)
}

/** Nowy sekret (160 bitów) w base32, jak oczekują aplikacje uwierzytelniające. */
export const generateTotpSecret = () => base32Encode(randomBytes(20))

/** Kod HOTP dla licznika (RFC 4226). */
export function hotp(secret: Buffer, counter: number, digits = 6): string {
  const msg = Buffer.alloc(8)
  msg.writeBigUInt64BE(BigInt(counter))
  const hmac = createHmac('sha1', secret).update(msg).digest()
  const offset = hmac[hmac.length - 1]! & 0x0f
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits
  return code.toString().padStart(digits, '0')
}

export const totpStep = (timeMs: number) => Math.floor(timeMs / 1000 / TOTP_STEP_SECONDS)

/**
 * Okna (bieżące ±1), w których kod pasuje; pusta lista, gdy nie pasuje nigdzie albo kod ma zły format.
 * Zawsze liczy wszystkie okna i porównuje w stałym czasie.
 */
export function matchingTotpSteps(secretBase32: string, code: string, timeMs: number): number[] {
  const normalized = code.replace(/\s/g, '')
  if (!/^\d{6}$/.test(normalized)) return []
  const secret = base32Decode(secretBase32)
  const given = Buffer.from(normalized)
  const current = totpStep(timeMs)
  const steps: number[] = []
  for (let i = -TOTP_WINDOW; i <= TOTP_WINDOW; i++) {
    if (timingSafeEqual(Buffer.from(hotp(secret, current + i)), given)) steps.push(current + i)
  }
  return steps
}

/** Adres otpauth:// do kodu QR i ręcznego wpisania. */
export function otpauthUrl(secretBase32: string, account: string) {
  const label = encodeURIComponent(`${ISSUER}:${account}`)
  const params = new URLSearchParams({ secret: secretBase32, issuer: ISSUER, algorithm: 'SHA1', digits: '6', period: String(TOTP_STEP_SECONDS) })
  return `otpauth://totp/${label}?${params}`
}

// ---------- sekret w bazie: zaszyfrowany kluczem z APP_SECRET ----------

const totpKey = (appSecret: string) => Buffer.from(hkdfSync('sha256', appSecret, Buffer.alloc(0), 'ngo-crm/totp', 32))
const aad = (userId: string) => Buffer.from(`ngo-crm/totp/${userId}`)

/** Zapis „v1.IV.szyfrogram.znacznik” (base64). AAD = id konta: szyfrogram nie działa przy innym koncie. */
export function encryptTotpSecret(secretBase32: string, appSecret: string, userId: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', totpKey(appSecret), iv).setAAD(aad(userId))
  const ct = Buffer.concat([cipher.update(secretBase32, 'utf8'), cipher.final()])
  return ['v1', iv.toString('base64'), ct.toString('base64'), cipher.getAuthTag().toString('base64')].join('.')
}

/** Zły APP_SECRET, inne konto albo zmieniony szyfrogram → błąd. */
export function decryptTotpSecret(enc: string, appSecret: string, userId: string): string {
  const [version, iv, ct, tag] = enc.split('.')
  if (version !== 'v1' || !iv || !ct || !tag) throw new Error('Nieznany format sekretu TOTP')
  const decipher = createDecipheriv('aes-256-gcm', totpKey(appSecret), Buffer.from(iv, 'base64')).setAAD(aad(userId)).setAuthTag(Buffer.from(tag, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64')), decipher.final()]).toString('utf8')
}

// ---------- sprawdzenie kodu z blokadą ponownego użycia ----------

/**
 * Sprawdza kod TOTP użytkownika i „zużywa” go: zapisuje numer okna w totpLastStep.
 * Kod z okna już użytego albo starszego jest odrzucany (także przy dwóch równoczesnych żądaniach:
 * warunek w UPDATE przepuszcza tylko jedno). Zwraca true tylko dla poprawnego, nieużytego kodu.
 * Pola techniczne logowania (totpLastStep, liczniki blokady) zapisujemy wprost, bez change_log i bez zmiany `version`:
 * to nie są zmiany danych, a wpis przy każdym logowaniu zaśmiecałby dziennik.
 */
export async function consumeTotpCode(db: Db, userId: string, code: string, appSecret: string, now = new Date()): Promise<boolean> {
  const [user] = await db
    .select({ totpSecretEnc: users.totpSecretEnc, totpLastStep: users.totpLastStep })
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.deletedAt)))
  if (!user?.totpSecretEnc) return false

  const secret = decryptTotpSecret(user.totpSecretEnc, appSecret, userId)
  const last = user.totpLastStep
  const step = matchingTotpSteps(secret, code, now.getTime()).find((s) => last === null || s > last)
  if (step === undefined) return false

  const [res] = await db
    .update(users)
    .set({ totpLastStep: step })
    .where(and(eq(users.id, userId), or(isNull(users.totpLastStep), lt(users.totpLastStep, step))))
  return res.affectedRows === 1
}
