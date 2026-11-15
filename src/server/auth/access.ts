// Dostęp do danych wrażliwych = slot klucza organizacji (ZADANIE_03, D3, D8, D10). Serwer przechowuje i wydaje
// sloty (szyfrogramy z przeglądarki), sprawdza, kto może je zapisać, i dopisuje dziennik dostępu w tej samej transakcji.
import { randomUUID } from 'node:crypto'
import { and, asc, eq, isNull } from 'drizzle-orm'
import type { ApiOutputs } from '@shared/api'
import { AppError } from '@shared/errors'
import type { Db } from '../db/connection'
import { keySlots, orgKeys, users } from '../db/schema'
import { logAccess } from './accessLog'
import { revokeAccess, type Actor } from './users'

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

/** Niewycofane wersje klucza organizacji, rosnąco (ostatnia = bieżąca). */
async function activeVersions(db: Pick<Db, 'select'>): Promise<number[]> {
  const rows = await db.select({ version: orgKeys.version }).from(orgKeys).where(isNull(orgKeys.retiredAt)).orderBy(asc(orgKeys.version))
  return rows.map((r) => r.version)
}

async function slotVersions(db: Pick<Db, 'select'>, userId: string): Promise<Set<number>> {
  const rows = await db.select({ keyVersion: keySlots.keyVersion }).from(keySlots).where(eq(keySlots.userId, userId))
  return new Set(rows.map((r) => r.keyVersion))
}

export async function mySlots(db: Db, userId: string): Promise<ApiOutputs['keys.mySlots']> {
  return db
    .select({ keyVersion: keySlots.keyVersion, wrappedKey: keySlots.wrappedKey })
    .from(keySlots)
    .innerJoin(orgKeys, eq(orgKeys.version, keySlots.keyVersion))
    .where(and(eq(keySlots.userId, userId), isNull(orgKeys.retiredAt)))
    .orderBy(asc(keySlots.keyVersion))
}

export async function listAccess(db: Db): Promise<ApiOutputs['access.list']> {
  const current = (await activeVersions(db)).at(-1)
  const holders = current === undefined ? [] : await db.select({ userId: keySlots.userId }).from(keySlots).where(eq(keySlots.keyVersion, current))
  const withSlot = new Set(holders.map((h) => h.userId))
  const rows = await db.select({ id: users.id, status: users.status, publicKey: users.publicKey }).from(users).where(isNull(users.deletedAt)).orderBy(users.createdAt)
  return rows.map((u) => ({ userId: u.id, hasAccess: withSlot.has(u.id), publicKey: u.status === 'active' ? u.publicKey : null }))
}

/** Odmowa NO_KEY_ACCESS, gdy wykonujący nie ma slotu do którejś niewycofanej wersji. */
async function requireOwnSlots(tx: Tx, userId: string, versions: number[]) {
  const own = await slotVersions(tx, userId)
  if (!versions.every((v) => own.has(v))) throw new AppError('NO_KEY_ACCESS')
}

/**
 * Nadanie dostępu: administrator ze slotami do wszystkich niewycofanych wersji zapisuje sloty zrobione w przeglądarce
 * kluczem publicznym osoby. Zestaw wersji musi być dokładnie taki jak niewycofane wersje (bez braków i nadmiaru).
 */
export function grantAccess(db: Db, input: { userId: string; slots: { keyVersion: number; wrappedKey: string }[] }, actor: Actor): Promise<void> {
  return db.transaction(async (tx) => {
    const [target] = await tx.select({ status: users.status, publicKey: users.publicKey }).from(users).where(and(eq(users.id, input.userId), isNull(users.deletedAt))).for('update')
    if (!target) throw new AppError('NOT_FOUND')
    if (target.status !== 'active' || !target.publicKey) throw new AppError('ACCOUNT_NOT_READY')
    // Blokada wierszy wersji: zmiana klucza (krok 4) nie wycofa wersji w trakcie nadawania.
    const versions = (await tx.select({ version: orgKeys.version }).from(orgKeys).where(isNull(orgKeys.retiredAt)).for('update')).map((r) => r.version)
    await requireOwnSlots(tx, actor.userId, versions)
    if ((await slotVersions(tx, input.userId)).size > 0) throw new AppError('ACCESS_EXISTS')
    const sent = input.slots.map((s) => s.keyVersion)
    if (new Set(sent).size !== sent.length || sent.length !== versions.length || !versions.every((v) => sent.includes(v))) {
      throw new AppError('VALIDATION', 'Sloty muszą obejmować dokładnie bieżące wersje klucza organizacji')
    }
    await tx.insert(keySlots).values(input.slots.map((s) => ({ id: randomUUID(), userId: input.userId, keyVersion: s.keyVersion, wrappedKey: s.wrappedKey, grantedBy: actor.userId, grantedAt: actor.now })))
    await logAccess(tx, actor.userId, 'grant_access', actor.now, input.userId)
  })
}

/** Odebranie dostępu: sloty znikają, sesje tej osoby się kończą. Bez odbierania samemu sobie. */
export function revokeUserAccess(db: Db, input: { userId: string }, actor: Actor): Promise<{ hadAccess: boolean }> {
  if (input.userId === actor.userId) throw new AppError('VALIDATION', 'Nie można odebrać dostępu samemu sobie')
  return db.transaction(async (tx) => {
    const [target] = await tx.select({ id: users.id }).from(users).where(and(eq(users.id, input.userId), isNull(users.deletedAt))).for('update')
    if (!target) throw new AppError('NOT_FOUND')
    const [slot] = await tx.select({ id: keySlots.id }).from(keySlots).where(eq(keySlots.userId, input.userId)).limit(1)
    if (!slot) return { hadAccess: false }
    await revokeAccess(tx, input.userId)
    await logAccess(tx, actor.userId, 'revoke_access', actor.now, input.userId)
    return { hadAccess: true }
  })
}

/** Slot odzyskiwania bieżącej wersji; tylko dla administratora, który nie ma do niej slotu. */
export async function recoverySlot(db: Db, userId: string): Promise<ApiOutputs['keys.recoverySlot']> {
  const current = (await activeVersions(db)).at(-1)
  if (current === undefined) throw new AppError('NOT_FOUND')
  if ((await slotVersions(db, userId)).has(current)) throw new AppError('ACCESS_EXISTS')
  const [slot] = await db
    .select({ wrappedKey: keySlots.wrappedKey })
    .from(keySlots)
    .where(and(isNull(keySlots.userId), eq(keySlots.keyVersion, current)))
  if (!slot) throw new AppError('NOT_FOUND')
  return { keyVersion: current, recoverySlot: slot.wrappedKey }
}

/**
 * Zapis własnego slotu do bieżącej wersji po odzyskaniu klucza w przeglądarce. Serwer nie sprawdzi, czy w slocie jest
 * właściwy klucz: zły slot psuje tylko dostęp osoby, która go zapisała.
 */
export function recoverAccess(db: Db, input: { keyVersion: number; wrappedKey: string }, actor: Actor): Promise<void> {
  return db.transaction(async (tx) => {
    const [me] = await tx.select({ id: users.id }).from(users).where(and(eq(users.id, actor.userId), eq(users.status, 'active'), isNull(users.deletedAt))).for('update')
    if (!me) throw new AppError('NOT_FOUND')
    const versions = (await tx.select({ version: orgKeys.version }).from(orgKeys).where(isNull(orgKeys.retiredAt)).for('update')).map((r) => r.version)
    if (input.keyVersion !== versions.at(-1)) throw new AppError('VALIDATION', 'Odzyskać można tylko bieżącą wersję klucza')
    const own = await slotVersions(tx, actor.userId)
    if (own.has(input.keyVersion)) throw new AppError('ACCESS_EXISTS')
    await tx.insert(keySlots).values({ id: randomUUID(), userId: actor.userId, keyVersion: input.keyVersion, wrappedKey: input.wrappedKey, grantedBy: actor.userId, grantedAt: actor.now })
    await logAccess(tx, actor.userId, 'key_recovered', actor.now)
  })
}
