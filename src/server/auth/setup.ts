// Kreator pierwszego uruchomienia (ZADANIE_01, krok 6). Działa tylko, gdy w bazie nie ma żadnego użytkownika
// i podano poprawny SETUP_TOKEN (co najmniej 32 znaki). Nic nie jest zapisywane przed końcem: organizacja,
// administrator z 2FA, klucz organizacji i oba sloty powstają w jednej transakcji.
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { AppError } from '@shared/errors'
import { PROFILE_DEFAULT_MODULES, normalizeModules } from '@shared/modules'
import { SETUP_TOKEN_MIN_LENGTH, type SetupCompleteInput, type SetupCheckResult, type SetupState } from '@shared/setup'
import { appRoot } from '../config'
import type { Db } from '../db/connection'
import { createRepo } from '../db/repo'
import { keySlots, orgKeys, settings, users } from '../db/schema'
import { logAccess } from './accessLog'
import type { AuthOptions } from './options'
import { hashAuthKey } from './password'
import { encryptTotpSecret, matchingTotpSteps } from './totp'

/** Stałe id jedynego wiersza `settings`: klucz główny nie pozwoli założyć organizacji dwa razy. */
export const SETTINGS_ID = '00000000-0000-4000-8000-000000000001'
/** Ile czasu jest na dokończenie kreatora od pokazania kodu QR. */
const ENROLLMENT_TTL_MS = 30 * 60_000

const hasUsers = async (db: Pick<Db, 'select'>) => (await db.select({ id: users.id }).from(users).limit(1)).length > 0

export async function setupState(db: Db, opts: AuthOptions): Promise<SetupState> {
  if (await hasUsers(db)) return 'done'
  if (!opts.setupToken) return 'no_token'
  if (opts.setupToken.length < SETUP_TOKEN_MIN_LENGTH) return 'token_too_short'
  return 'available'
}

/** Porównanie tokenu w stałym czasie (skróty mają tę samą długość, więc nie zdradza długości tokenu). */
export function tokenMatches(given: string, expected: string): boolean {
  const hash = (s: string) => createHash('sha256').update(s).digest()
  return timingSafeEqual(hash(given), hash(expected))
}

/** Czy w STORAGE_DIR da się zapisać (próbny plik). W produkcji folder nie może leżeć w folderze aplikacji. */
export async function checkStorage(storageDir: string | undefined, production: boolean): Promise<SetupCheckResult['storage']> {
  if (!storageDir) return { ok: false, problem: 'not_set' }
  const dir = resolve(appRoot, storageDir)
  const rel = relative(appRoot, dir)
  if (production && !rel.startsWith('..') && !isAbsolute(rel)) return { ok: false, problem: 'inside_app' }
  const probe = resolve(dir, `.zapis-probny-${randomBytes(6).toString('hex')}`)
  try {
    await mkdir(dir, { recursive: true })
    await writeFile(probe, 'ok')
    await rm(probe)
    return { ok: true }
  } catch {
    return { ok: false, problem: 'not_writable' }
  }
}

// ---------- sekret 2FA przed założeniem konta: zaszyfrowany przez serwer, przechowywany w przeglądarce ----------

const enrollmentKey = (appSecret: string) => Buffer.from(hkdfSync('sha256', appSecret, Buffer.alloc(0), 'ngo-crm/setup-enrollment', 32))
interface Enrollment {
  userId: string
  secret: string
  expiresAt: number
}

export function sealEnrollment(userId: string, secret: string, appSecret: string, now: Date): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', enrollmentKey(appSecret), iv)
  const data: Enrollment = { userId, secret, expiresAt: now.getTime() + ENROLLMENT_TTL_MS }
  const ct = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()])
  return [iv, ct, cipher.getAuthTag()].map((b) => b.toString('base64url')).join('.')
}

/** Zmieniony, obcy albo przeterminowany zapis → błąd VALIDATION. */
export function openEnrollment(sealed: string, appSecret: string, now: Date): Enrollment {
  try {
    const [iv, ct, tag] = sealed.split('.').map((p) => Buffer.from(p, 'base64url'))
    const decipher = createDecipheriv('aes-256-gcm', enrollmentKey(appSecret), iv!).setAuthTag(tag!)
    const data = JSON.parse(Buffer.concat([decipher.update(ct!), decipher.final()]).toString('utf8')) as Enrollment
    if (data.expiresAt <= now.getTime()) throw new Error('expired')
    return data
  } catch {
    throw new AppError('VALIDATION', 'Konfiguracja 2FA wygasła albo jest nieprawidłowa. Zacznij ten krok od nowa.')
  }
}

// ---------- zapis ----------

/** Zakłada organizację i administratora. Jedna transakcja: błąd w dowolnym miejscu nie zostawia niczego w bazie. */
export async function completeSetup(db: Db, input: SetupCompleteInput, opts: AuthOptions, now: Date): Promise<{ userId: string }> {
  const { userId, secret } = openEnrollment(input.enrollment, opts.appSecret, now)
  const step = matchingTotpSteps(secret, input.totpCode, now.getTime())[0]
  if (step === undefined) throw new AppError('TOTP_INVALID')
  const authHash = await hashAuthKey(input.admin.authKey, opts.scryptParams)

  try {
    await db.transaction(async (tx) => {
      if (await hasUsers(tx)) throw new AppError('SETUP_UNAVAILABLE')
      const repo = createRepo(tx, { userId, now: () => now })
      await repo.insert(settings, {
        id: SETTINGS_ID,
        orgName: input.org.name,
        profile: input.org.profile,
        enabledModules: normalizeModules(PROFILE_DEFAULT_MODULES[input.org.profile]),
        roleLabels: {}
      })
      await repo.insert(users, { id: userId, email: input.admin.email, name: input.admin.name, role: 'admin', status: 'active' })
      // Pola uwierzytelniania wprost (decyzja 20): skróty i szyfrogramy nie trafiają do change_log.
      await tx
        .update(users)
        .set({
          kdfSalt: input.admin.kdfSalt,
          kdfIterations: input.admin.kdfIterations,
          authHash,
          totpSecretEnc: encryptTotpSecret(secret, opts.appSecret, userId),
          totpEnabledAt: now,
          totpLastStep: step,
          publicKey: input.admin.publicKey,
          privateKeyEnc: input.admin.privateKeyEnc
        })
        .where(eq(users.id, userId))
      await tx.insert(orgKeys).values({ version: 1, createdAt: now, createdBy: userId })
      await tx.insert(keySlots).values([
        { id: randomUUID(), userId, keyVersion: 1, wrappedKey: input.keys.slot, grantedBy: userId, grantedAt: now },
        { id: randomUUID(), userId: null, keyVersion: 1, wrappedKey: input.keys.recoverySlot, grantedBy: userId, grantedAt: now }
      ])
      await logAccess(tx, userId, 'setup_completed', now)
      await logAccess(tx, userId, 'totp_enabled', now)
    })
  } catch (e) {
    // Dwa kreatory naraz: drugi trafia na zajęty klucz główny `settings` (baza zgłasza duplikat albo zakleszczenie
    // i wycofuje jego transakcję). Jeśli w tym czasie ktoś inny skończył kreator, to zwykła odmowa, nie awaria.
    if (!(e instanceof AppError) && (await hasUsers(db))) throw new AppError('SETUP_UNAVAILABLE')
    throw e
  }
  return { userId }
}
