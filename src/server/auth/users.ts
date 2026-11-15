// Zarządzanie użytkownikami (metody users.* w RPC, tylko administrator) i przyjmowanie zaproszeń (ZADANIE_01, krok 7).
// Zmiany danych konta (rola, status) idą przez repo (wersja rekordu, change_log); pola uwierzytelniania wprost (decyzja 20).
import { randomBytes, randomUUID } from 'node:crypto'
import { and, eq, gt, isNull, ne } from 'drizzle-orm'
import type { ApiOutputs, Role } from '@shared/api'
import { AppError } from '@shared/errors'
import { INVITE_TTL_HOURS, type InviteAcceptInput, type InviteInfo } from '@shared/invite'
import type { Db } from '../db/connection'
import { createRepo } from '../db/repo'
import { authSessions, invitations, keySlots, settings, users } from '../db/schema'
import { logAccess } from './accessLog'
import type { AuthOptions } from './options'
import { hashAuthKey } from './password'
import { hashToken } from './sessions'
import { openEnrollment } from './setup'
import { encryptTotpSecret, matchingTotpSteps } from './totp'

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]
export interface Actor {
  userId: string
  now: Date
}
export interface InviteLink {
  token: string
  expiresAt: string
}

const INVITE_TTL_MS = INVITE_TTL_HOURS * 3_600_000

export async function listUsers(db: Db, now: Date): Promise<ApiOutputs['users.list']> {
  const rows = await db.select().from(users).where(isNull(users.deletedAt)).orderBy(users.createdAt)
  const pending = await db
    .select({ userId: invitations.userId, expiresAt: invitations.expiresAt })
    .from(invitations)
    .where(and(isNull(invitations.usedAt), gt(invitations.expiresAt, now)))
  const pendingUntil = new Map(pending.map((p) => [p.userId, p.expiresAt]))
  return rows.map((u) => ({
    id: u.id,
    version: u.version,
    name: u.name,
    email: u.email,
    role: u.role as Role,
    status: u.status as 'invited' | 'active' | 'disabled',
    totpEnabled: !!u.totpEnabledAt,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    inviteExpiresAt: pendingUntil.get(u.id)?.toISOString() ?? null
  }))
}

/** Nowe zaproszenie dla konta; poprzednie, niewykorzystane linki tej osoby przestają działać. */
async function createInvitation(tx: Tx, userId: string, actor: Actor): Promise<InviteLink> {
  await tx.delete(invitations).where(and(eq(invitations.userId, userId), isNull(invitations.usedAt)))
  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(actor.now.getTime() + INVITE_TTL_MS)
  await tx.insert(invitations).values({ id: randomUUID(), tokenHash: hashToken(token), userId, invitedBy: actor.userId, createdAt: actor.now, expiresAt })
  return { token, expiresAt: expiresAt.toISOString() }
}

/** Koniec sesji i dostępów: wyłączenie i reset konta, odebranie dostępu. Zwraca, czy konto miało slot klucza. */
export async function revokeAccess(tx: Tx, userId: string): Promise<boolean> {
  const slots = await tx.select({ id: keySlots.id }).from(keySlots).where(eq(keySlots.userId, userId)).for('update')
  await tx.delete(authSessions).where(eq(authSessions.userId, userId))
  await tx.delete(keySlots).where(eq(keySlots.userId, userId))
  await tx.delete(invitations).where(and(eq(invitations.userId, userId), isNull(invitations.usedAt)))
  return slots.length > 0
}

/** Odmowa, gdy po operacji nie zostałby żaden aktywny administrator. Blokuje wiersze administratorów na czas transakcji. */
async function requireOtherActiveAdmin(tx: Tx, userId: string) {
  const admins = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, 'admin'), eq(users.status, 'active'), isNull(users.deletedAt), ne(users.id, userId)))
    .for('update')
  if (admins.length === 0) throw new AppError('LAST_ADMIN')
}

async function loadTarget(tx: Tx, id: string) {
  const [u] = await tx.select({ id: users.id, role: users.role, status: users.status }).from(users).where(and(eq(users.id, id), isNull(users.deletedAt))).for('update')
  if (!u) throw new AppError('NOT_FOUND')
  return u
}
const isActiveAdmin = (u: { role: string; status: string }) => u.role === 'admin' && u.status === 'active'

export function inviteUser(db: Db, input: { email: string; role: Role }, actor: Actor): Promise<InviteLink> {
  return db.transaction(async (tx) => {
    // także konta usunięte: e-mail jest unikalny w tabeli
    const [existing] = await tx.select({ id: users.id }).from(users).where(eq(users.email, input.email))
    if (existing) throw new AppError('EMAIL_TAKEN')
    const repo = createRepo(tx, { userId: actor.userId, now: () => actor.now })
    // Imię poda zaproszona osoba; do tego czasu w tym polu jest e-mail.
    const user = await repo.insert(users, { email: input.email, name: input.email, role: input.role, status: 'invited' })
    await logAccess(tx, actor.userId, 'user_invited', actor.now, user.id)
    return createInvitation(tx, user.id, actor)
  })
}

export function setUserRole(db: Db, input: { id: string; version: number; role: Role }, actor: Actor): Promise<void> {
  return db.transaction(async (tx) => {
    const target = await loadTarget(tx, input.id)
    if (isActiveAdmin(target) && input.role !== 'admin') await requireOtherActiveAdmin(tx, target.id)
    const repo = createRepo(tx, { userId: actor.userId, now: () => actor.now })
    if (await repo.update(users, input.id, input.version, { role: input.role })) await logAccess(tx, actor.userId, 'role_changed', actor.now, target.id)
  })
}

/** Wyłączenie konta: koniec wszystkich sesji, usunięcie slotów klucza i niewykorzystanych zaproszeń. */
export function disableUser(db: Db, input: { id: string; version: number }, actor: Actor): Promise<{ hadAccess: boolean }> {
  return db.transaction(async (tx) => {
    const target = await loadTarget(tx, input.id)
    if (isActiveAdmin(target)) await requireOtherActiveAdmin(tx, target.id)
    const repo = createRepo(tx, { userId: actor.userId, now: () => actor.now })
    await repo.update(users, input.id, input.version, { status: 'disabled' })
    const hadAccess = await revokeAccess(tx, target.id)
    await logAccess(tx, actor.userId, 'user_disabled', actor.now, target.id)
    return { hadAccess }
  })
}

/**
 * Reset konta (zapomniane hasło, ponowne zaproszenie, przywrócenie wyłączonego konta): hasło, 2FA i klucze znikają,
 * sesje i sloty też; osoba dostaje nowy jednorazowy link. Dostęp do danych wrażliwych trzeba potem nadać ponownie.
 */
export function resetUser(db: Db, input: { id: string; version: number }, actor: Actor): Promise<InviteLink & { hadAccess: boolean }> {
  return db.transaction(async (tx) => {
    const target = await loadTarget(tx, input.id)
    if (isActiveAdmin(target)) await requireOtherActiveAdmin(tx, target.id)
    const repo = createRepo(tx, { userId: actor.userId, now: () => actor.now })
    await repo.update(users, input.id, input.version, { status: 'invited' })
    await tx
      .update(users)
      .set({ kdfSalt: null, kdfIterations: null, authHash: null, totpSecretEnc: null, totpEnabledAt: null, totpLastStep: null, publicKey: null, privateKeyEnc: null, failedAttempts: 0, lockedUntil: null })
      .where(eq(users.id, target.id))
    const hadAccess = await revokeAccess(tx, target.id)
    await logAccess(tx, actor.userId, 'user_reset', actor.now, target.id)
    return { ...(await createInvitation(tx, target.id, actor)), hadAccess }
  })
}

// ---------- przyjęcie zaproszenia (bez sesji; uwierzytelnia token z linku) ----------

/** Ważne zaproszenie dla tokenu albo INVITE_INVALID (zły, wykorzystany, przeterminowany link albo konto już nie czeka). */
async function findInvitation(db: Pick<Db, 'select'>, token: string, now: Date, lock = false) {
  const query = db
    .select({ id: invitations.id, userId: invitations.userId, email: users.email })
    .from(invitations)
    .innerJoin(users, eq(users.id, invitations.userId))
    .where(and(eq(invitations.tokenHash, hashToken(token)), isNull(invitations.usedAt), gt(invitations.expiresAt, now), eq(users.status, 'invited'), isNull(users.deletedAt)))
  const [inv] = lock ? await query.for('update') : await query
  if (!inv) throw new AppError('INVITE_INVALID')
  return inv
}

export async function inviteInfo(db: Db, token: string, now: Date): Promise<InviteInfo> {
  const inv = await findInvitation(db, token, now)
  const [org] = await db.select({ orgName: settings.orgName }).from(settings).limit(1)
  return { userId: inv.userId, email: inv.email, orgName: org?.orgName ?? '' }
}

/** Zapisuje hasło (authKey), 2FA i parę kluczy; konto staje się aktywne, link zużyty. Bez slotu klucza organizacji. */
export async function acceptInvite(db: Db, input: InviteAcceptInput, opts: AuthOptions, now: Date): Promise<{ userId: string }> {
  const { userId, secret } = openEnrollment(input.enrollment, opts.appSecret, now)
  const step = matchingTotpSteps(secret, input.totpCode, now.getTime())[0]
  if (step === undefined) throw new AppError('TOTP_INVALID')
  const authHash = await hashAuthKey(input.authKey, opts.scryptParams)

  return db.transaction(async (tx) => {
    const inv = await findInvitation(tx, input.token, now, true)
    if (inv.userId !== userId) throw new AppError('INVITE_INVALID')
    const [u] = await tx.select({ version: users.version }).from(users).where(eq(users.id, userId))
    const repo = createRepo(tx, { userId, now: () => now })
    await repo.update(users, userId, u!.version, { name: input.name, status: 'active' })
    await tx
      .update(users)
      .set({
        kdfSalt: input.kdfSalt,
        kdfIterations: input.kdfIterations,
        authHash,
        totpSecretEnc: encryptTotpSecret(secret, opts.appSecret, userId),
        totpEnabledAt: now,
        totpLastStep: step,
        publicKey: input.publicKey,
        privateKeyEnc: input.privateKeyEnc,
        failedAttempts: 0,
        lockedUntil: null
      })
      .where(eq(users.id, userId))
    await tx.update(invitations).set({ usedAt: now }).where(eq(invitations.id, inv.id))
    await logAccess(tx, userId, 'invite_accepted', now)
    await logAccess(tx, userId, 'totp_enabled', now)
    return { userId }
  })
}
