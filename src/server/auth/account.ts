// Operacje na własnym koncie (metody auth.* w RPC): dane konta, konfiguracja 2FA, klucze, zmiana hasła.
// Pola uwierzytelniania zapisujemy wprost (decyzja 20): bez change_log, żeby skróty i szyfrogramy nie trafiały do dziennika zmian.
import { and, eq, isNull } from 'drizzle-orm'
import type { ApiOutputs, ApiParsed } from '@shared/api'
import { AppError } from '@shared/errors'
import type { Db } from '../db/connection'
import { settings, users } from '../db/schema'
import { logAccess } from './accessLog'
import { isLocked, registerFailure } from './lockout'
import { hashAuthKey, verifyAuthKey, type ScryptParams } from './password'
import { qrSvg } from './qr'
import { consumeTotpCode, encryptTotpSecret, generateTotpSecret, otpauthUrl } from './totp'

async function loadUser(db: Db, userId: string) {
  const [user] = await db.select().from(users).where(and(eq(users.id, userId), isNull(users.deletedAt)))
  if (!user) throw new AppError('NOT_FOUND')
  return user
}

export async function getAccount(db: Db, userId: string): Promise<ApiOutputs['auth.account']> {
  const u = await loadUser(db, userId)
  const [org] = await db.select({ orgName: settings.orgName }).from(settings).limit(1)
  return { email: u.email, name: u.name, totpEnabled: !!u.totpEnabledAt, orgName: org?.orgName ?? '' }
}

/** Nowy sekret TOTP (jeszcze nieaktywny) z adresem i kodem QR. Tylko gdy 2FA nie jest włączone. */
export async function startTotpSetup(db: Db, userId: string, appSecret: string): Promise<ApiOutputs['auth.totpSetup.start']> {
  const u = await loadUser(db, userId)
  if (u.totpEnabledAt) throw new AppError('VALIDATION', 'Weryfikacja dwuetapowa jest już włączona')
  const secret = generateTotpSecret()
  await db
    .update(users)
    .set({ totpSecretEnc: encryptTotpSecret(secret, appSecret, userId), totpLastStep: null })
    .where(eq(users.id, userId))
  const url = otpauthUrl(secret, u.email)
  return { secret, otpauthUrl: url, qrSvg: await qrSvg(url) }
}

/** Potwierdzenie konfiguracji pierwszym kodem z aplikacji: od tej chwili 2FA jest włączone. */
export async function confirmTotpSetup(db: Db, userId: string, code: string, appSecret: string, now: Date) {
  const u = await loadUser(db, userId)
  if (u.totpEnabledAt) throw new AppError('VALIDATION', 'Weryfikacja dwuetapowa jest już włączona')
  if (!u.totpSecretEnc || !(await consumeTotpCode(db, userId, code, appSecret, now))) throw new AppError('TOTP_INVALID')
  await db.update(users).set({ totpEnabledAt: now }).where(eq(users.id, userId))
  await logAccess(db, userId, 'totp_enabled', now)
}

/** Zaszyfrowany klucz prywatny i parametry do wyprowadzenia `wrapKey` (odszyfrowanie tylko w przeglądarce). */
export async function getKeys(db: Db, userId: string): Promise<ApiOutputs['auth.keys']> {
  const u = await loadUser(db, userId)
  if (!u.kdfSalt || !u.kdfIterations) throw new AppError('NOT_FOUND')
  return { kdfSalt: u.kdfSalt, kdfIterations: u.kdfIterations, publicKey: u.publicKey, privateKeyEnc: u.privateKeyEnc }
}

/**
 * Zmiana hasła: wymaga obecnego `authKey` i świeżego kodu TOTP (błędy liczą się do blokady konta).
 * Zapisuje nowy skrót, nową sól i klucz prywatny przeszyfrowany w przeglądarce nowym `wrapKey`.
 * Zwraca 'locked', gdy nieudana próba zablokowała konto (wywołujący kończy wtedy sesje).
 */
export async function changePassword(
  db: Db,
  userId: string,
  input: ApiParsed<'auth.changePassword'>,
  opts: { appSecret: string; scryptParams?: ScryptParams },
  now: Date
): Promise<'ok' | 'locked' | 'wrong_password' | 'wrong_code'> {
  const u = await loadUser(db, userId)
  if (!u.authHash || isLocked(u.lockedUntil, now)) return 'locked'
  if (u.privateKeyEnc && !input.newPrivateKeyEnc) throw new AppError('VALIDATION', 'Brak przeszyfrowanego klucza prywatnego')

  const fail = async (result: 'wrong_password' | 'wrong_code') => {
    const locked = await registerFailure(db, userId, now)
    await logAccess(db, userId, 'login_failed', now)
    return locked ? 'locked' : result
  }
  if (!(await verifyAuthKey(input.currentAuthKey, u.authHash))) return fail('wrong_password')
  if (!(await consumeTotpCode(db, userId, input.totpCode, opts.appSecret, now))) return fail('wrong_code')

  await db
    .update(users)
    .set({
      authHash: await hashAuthKey(input.newAuthKey, opts.scryptParams),
      kdfSalt: input.newKdfSalt,
      kdfIterations: input.newKdfIterations,
      ...(input.newPrivateKeyEnc ? { privateKeyEnc: input.newPrivateKeyEnc } : {}),
      failedAttempts: 0,
      lockedUntil: null
    })
    .where(eq(users.id, userId))
  await logAccess(db, userId, 'password_changed', now)
  return 'ok'
}
