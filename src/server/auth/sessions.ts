// Sesje logowania (ZADANIE_01, krok 5; decyzje MOC 2026-11-14 w pliku zadania):
// losowy token w ciasteczku __Host-ngocrm_session (httpOnly, Secure, SameSite=Strict, Path=/), w bazie tylko skrót SHA-256.
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { and, eq, isNull } from 'drizzle-orm'
import type { FastifyReply } from 'fastify'
import { ROLES, type Role } from '@shared/api'
import type { Db } from '../db/connection'
import { authSessions, users } from '../db/schema'
import type { Session, SessionProvider } from '../rpc'

export const SESSION_COOKIE = '__Host-ngocrm_session'
const MIN = 60_000
/** Pełna sesja: 12 h od zalogowania, bez przedłużania aktywnością. */
export const SESSION_TTL_MS = 12 * 60 * MIN
/** Sesja po haśle, przed kodem TOTP: 5 min. */
export const PRE_MFA_TTL_MS = 5 * MIN
/** Wylogowanie po bezczynności: 30 min (do czasu ustawienia w tabeli settings). */
export const IDLE_TIMEOUT_MS = 30 * MIN

/** Skrót SHA-256 tokenu: w bazie nigdy nie trzymamy samego tokenu. */
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

const isRole = (r: string): r is Role => (ROLES as readonly string[]).includes(r)

/** Zakłada sesję i zwraca token do ciasteczka (jedyne miejsce, gdzie token istnieje jawnie). */
export async function createSession(db: Db, userId: string, opts: { mfaPassed: boolean; userAgent?: string; now?: Date }) {
  const now = opts.now ?? new Date()
  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(now.getTime() + (opts.mfaPassed ? SESSION_TTL_MS : PRE_MFA_TTL_MS))
  await db.insert(authSessions).values({
    id: randomUUID(),
    tokenHash: hashToken(token),
    userId,
    createdAt: now,
    lastSeenAt: now,
    expiresAt,
    mfaPassed: opts.mfaPassed,
    userAgentHash: opts.userAgent ? hashToken(opts.userAgent) : null
  })
  return { token, expiresAt }
}

/**
 * Sesja dla tokenu z ciasteczka albo null: nieznany token, wygaśnięcie (12 h / 5 min przed 2FA), bezczynność > 30 min,
 * konto wyłączone, nieaktywne albo usunięte. Wygasłą sesję usuwa; ważnej odświeża `lastSeenAt`.
 */
export async function getSession(db: Db, token: string | undefined, now = new Date()): Promise<Session | null> {
  if (!token || token.length > 128) return null
  const tokenHash = hashToken(token)
  const [row] = await db
    .select({
      id: authSessions.id,
      userId: authSessions.userId,
      lastSeenAt: authSessions.lastSeenAt,
      expiresAt: authSessions.expiresAt,
      mfaPassed: authSessions.mfaPassed,
      role: users.role,
      status: users.status
    })
    .from(authSessions)
    .innerJoin(users, and(eq(users.id, authSessions.userId), isNull(users.deletedAt)))
    .where(eq(authSessions.tokenHash, tokenHash))
  if (!row) return null

  const expired = now >= row.expiresAt || now.getTime() - row.lastSeenAt.getTime() > IDLE_TIMEOUT_MS
  if (expired || row.status !== 'active' || !isRole(row.role)) {
    if (expired) await db.delete(authSessions).where(eq(authSessions.id, row.id))
    return null
  }
  await db.update(authSessions).set({ lastSeenAt: now }).where(eq(authSessions.id, row.id))
  return { userId: row.userId, role: row.role, totpVerified: row.mfaPassed }
}

/** Wylogowanie tej sesji. */
export async function revokeSession(db: Db, token: string) {
  await db.delete(authSessions).where(eq(authSessions.tokenHash, hashToken(token)))
}

/** „Wyloguj wszędzie”: wszystkie sesje osoby (także przy wyłączeniu konta). */
export async function revokeAllSessions(db: Db, userId: string) {
  await db.delete(authSessions).where(eq(authSessions.userId, userId))
}

export function setSessionCookie(reply: FastifyReply, token: string, expiresAt: Date) {
  reply.setCookie(SESSION_COOKIE, token, { httpOnly: true, secure: true, sameSite: 'strict', path: '/', expires: expiresAt })
}

export function clearSessionCookie(reply: FastifyReply) {
  reply.clearCookie(SESSION_COOKIE, { httpOnly: true, secure: true, sameSite: 'strict', path: '/' })
}

/** Prawdziwe źródło sesji dla strażnika RPC (podpinane, gdy będzie logowanie; do tego czasu produkcja: noSessions). */
export const dbSessions = (db: Db): SessionProvider => ({
  get: (req) => getSession(db, req.cookies[SESSION_COOKIE])
})
