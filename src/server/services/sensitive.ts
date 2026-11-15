// Dane wrażliwe osoby (ZADANIE_03, krok 2; D1–D3, D6). Serwer przechowuje i wydaje tylko szyfrogram z przeglądarki:
// sprawdza przełącznik w ustawieniach, osobę, slot klucza i wersję rekordu, a wydanie zapisuje w dzienniku dostępu.
import { and, asc, eq, isNull } from 'drizzle-orm'
import type { ApiOutputs, ApiParsed } from '@shared/api'
import { AppError } from '@shared/errors'
import type { Db } from '../db/connection'
import { contactSensitive, contacts, keySlots, orgKeys, settings } from '../db/schema'
import { logAccess } from '../auth/accessLog'
import { repoFor, type Actor } from './common'

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

/** Wyłączone pola (D2) → FORBIDDEN, także dla odsłonięcia: wyłączenie ukrywa pola. */
async function requireEnabled(tx: Tx) {
  const [s] = await tx.select({ enabled: settings.sensitiveFieldsEnabled }).from(settings).where(isNull(settings.deletedAt)).limit(1)
  if (!s?.enabled) throw new AppError('FORBIDDEN', 'Pola wrażliwe są wyłączone')
}

/** Czy osoba ma slot do tej wersji klucza i wersja nie jest wycofana (D3). */
async function hasSlot(tx: Tx, userId: string, keyVersion: number) {
  const [s] = await tx
    .select({ id: keySlots.id })
    .from(keySlots)
    .innerJoin(orgKeys, eq(orgKeys.version, keySlots.keyVersion))
    .where(and(eq(keySlots.userId, userId), eq(keySlots.keyVersion, keyVersion), isNull(orgKeys.retiredAt)))
    .limit(1)
  return Boolean(s)
}

const findCipher = async (tx: Tx, contactId: string) =>
  (await tx.select().from(contactSensitive).where(and(eq(contactSensitive.contactId, contactId), isNull(contactSensitive.deletedAt))).limit(1))[0]

/** Szyfrogram dla osoby ze slotem; wpis `reveal_sensitive` w tej samej transakcji (D6). */
export function revealSensitive(db: Db, { contactId }: ApiParsed<'sensitive.reveal'>, actor: Actor): Promise<ApiOutputs['sensitive.reveal']> {
  return db.transaction(async (tx) => {
    await requireEnabled(tx)
    const row = await findCipher(tx, contactId)
    if (!row) throw new AppError('NOT_FOUND')
    if (!(await hasSlot(tx, actor.userId, row.keyVersion))) throw new AppError('NO_KEY_ACCESS')
    await logAccess(tx, actor.userId, 'reveal_sensitive', actor.now, contactId, 'contact')
    return { version: row.version, keyVersion: row.keyVersion, iv: row.iv, ciphertext: row.ciphertext }
  })
}

/**
 * Zapis szyfrogramu: tylko osoba (bez instytucji, z Kosza i zanonimizowanych), bieżąca wersja klucza i slot do niej.
 * `version` = null tylko przy pierwszym zapisie; inaczej wersja rekordu, którą widział klient (VERSION_CONFLICT).
 */
export function saveSensitive(db: Db, input: ApiParsed<'sensitive.save'>, actor: Actor): Promise<ApiOutputs['sensitive.save']> {
  return db.transaction(async (tx) => {
    await requireEnabled(tx)
    // Blokada wiersza osoby: dwa równoczesne pierwsze zapisy nie wpadną na UNIQUE, tylko na VERSION_CONFLICT.
    const [c] = await tx.select().from(contacts).where(eq(contacts.id, input.contactId)).for('update')
    if (!c || c.deletedAt || c.anonymizedAt) throw new AppError('NOT_FOUND')
    if (c.kind !== 'person') throw new AppError('VALIDATION', 'Dane wrażliwe są tylko dla osób')
    // Blokada wierszy wersji (jak w access.ts): zmiana klucza (krok 4) nie wycofa wersji w trakcie zapisu.
    const versions = (await tx.select({ version: orgKeys.version }).from(orgKeys).where(isNull(orgKeys.retiredAt)).orderBy(asc(orgKeys.version)).for('update')).map(
      (r) => r.version
    )
    if (input.keyVersion !== versions.at(-1)) throw new AppError('VALIDATION', 'Dane trzeba zaszyfrować bieżącą wersją klucza organizacji')
    if (!(await hasSlot(tx, actor.userId, input.keyVersion))) throw new AppError('NO_KEY_ACCESS')

    const values = { keyVersion: input.keyVersion, iv: input.iv, ciphertext: input.ciphertext }
    const repo = repoFor(tx, actor)
    const existing = await findCipher(tx, input.contactId)
    if (!existing) {
      if (input.version !== null) throw new AppError('VERSION_CONFLICT')
      return { version: (await repo.insert(contactSensitive, { contactId: input.contactId, ...values })).version }
    }
    if (input.version === null) throw new AppError('VERSION_CONFLICT')
    const updated = await repo.update(contactSensitive, existing.id, input.version, values)
    return { version: updated?.version ?? input.version }
  })
}
