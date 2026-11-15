// Pomocnicze funkcje testów kont (tylko dla plików *.test.ts; nie jest częścią aplikacji).
import { randomBytes, randomUUID } from 'node:crypto'
import type { Db } from '../db/connection'
import { accessLog, authSessions, changeLog, invitations, keySlots, orgKeys, settings, users } from '../db/schema'
import { hashAuthKey } from './password'
import { SESSION_COOKIE, createSession } from './sessions'
import { encryptTotpSecret, generateTotpSecret } from './totp'

export const TEST_APP_SECRET = 'testowy-sekret-aplikacji-tylko-do-testow-0123456789'
export const TEST_SCRYPT = { N: 2 ** 10, r: 8, p: 1 }

/** Czyści tabele kont w bazie testowej (baza testowa jest chroniona przez testDb.ts). */
export async function wipeAccounts(db: Db) {
  for (const table of [invitations, keySlots, orgKeys, authSessions, accessLog, changeLog, settings, users]) await db.delete(table)
}

/** Fikcyjne konto testowe z hasłem (authKey), 2FA i „kluczem prywatnym”. */
export async function addTestUser(db: Db, opts: { role?: string; status?: string; now?: Date; publicKey?: string } = {}) {
  const id = randomUUID()
  const at = opts.now ?? new Date()
  const authKey = randomBytes(32).toString('base64')
  const secret = generateTotpSecret()
  const email = `konto-test-${id}@example.invalid`
  await db.insert(users).values({
    id,
    createdAt: at,
    updatedAt: at,
    updatedBy: id,
    version: 1,
    email,
    name: 'Konto testowe',
    role: opts.role ?? 'staff',
    status: opts.status ?? 'active',
    kdfSalt: randomBytes(16).toString('base64'),
    kdfIterations: 600_000,
    authHash: await hashAuthKey(authKey, TEST_SCRYPT),
    totpSecretEnc: encryptTotpSecret(secret, TEST_APP_SECRET, id),
    totpEnabledAt: at,
    publicKey: opts.publicKey ?? null,
    privateKeyEnc: `v1.${randomBytes(12).toString('base64')}.${randomBytes(64).toString('base64')}`
  })
  return { id, email, authKey, secret }
}

/** Ciasteczko pełnej sesji (po 2FA) dla konta. */
export async function sessionCookieFor(db: Db, userId: string, now = new Date()) {
  const { token } = await createSession(db, userId, { mfaPassed: true, now })
  return `${SESSION_COOKIE}=${token}`
}
