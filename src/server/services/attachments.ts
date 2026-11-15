// Załączniki osoby i działania (ZADANIE_03, krok 3a; D11). Serwer przechowuje i wydaje tylko szyfrogramy:
// sprawdza cel, wersję klucza i slot, a pobranie zapisuje w dzienniku dostępu (trasy plików: ../attachmentRoutes.ts).
import { and, asc, eq, isNull } from 'drizzle-orm'
import type { ApiOutputs, ApiParsed } from '@shared/api'
import type { TargetType } from '@shared/domain'
import { AppError } from '@shared/errors'
import type { Db } from '../db/connection'
import { actions, attachments, contacts, orgKeys } from '../db/schema'
import { repoFor, meta, type Actor } from './common'
import { hasSlot } from './sensitive'

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

export const listAttachments = async (db: Db, { targetType, targetId }: ApiParsed<'attachments.list'>): Promise<ApiOutputs['attachments.list']> =>
  (
    await db
      .select()
      .from(attachments)
      .where(and(eq(attachments.targetType, targetType), eq(attachments.targetId, targetId), isNull(attachments.deletedAt)))
      .orderBy(asc(attachments.createdAt))
  ).map((r) => ({
    ...meta(r),
    targetType: r.targetType as TargetType,
    targetId: r.targetId,
    purpose: r.purpose,
    keyVersion: r.keyVersion,
    metaEnc: r.metaEnc,
    sizeBytes: r.sizeBytes
  }))

/** Usunięcie do Kosza: tylko ze slotem do wersji klucza załącznika (D11). Plik zostaje na dysku do anonimizacji. */
export function deleteAttachment(db: Db, { id, version }: ApiParsed<'attachments.delete'>, actor: Actor): Promise<void> {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(attachments).where(eq(attachments.id, id)).limit(1)
    if (!row || row.deletedAt) throw new AppError('NOT_FOUND')
    if (!(await hasSlot(tx, actor.userId, row.keyVersion))) throw new AppError('NO_KEY_ACCESS')
    await repoFor(tx, actor).softDelete(attachments, id, version)
  })
}

export interface UploadTarget {
  targetType: TargetType
  targetId: string
  keyVersion: number
}

/**
 * Warunki wysłania pliku: cel istnieje i nie jest usunięty (osoba także nie zanonimizowana), wersja klucza jest bieżąca
 * i osoba ma do niej slot. Blokuje wiersze wersji kluczy (jak zapis danych wrażliwych): zmiana klucza nie wycofa wersji w trakcie.
 */
export async function checkUpload(tx: Tx, userId: string, t: UploadTarget): Promise<void> {
  if (t.targetType === 'contact') {
    const [c] = await tx.select({ deletedAt: contacts.deletedAt, anonymizedAt: contacts.anonymizedAt }).from(contacts).where(eq(contacts.id, t.targetId)).limit(1)
    if (!c || c.deletedAt || c.anonymizedAt) throw new AppError('NOT_FOUND')
  } else {
    const [a] = await tx.select({ deletedAt: actions.deletedAt }).from(actions).where(eq(actions.id, t.targetId)).limit(1)
    if (!a || a.deletedAt) throw new AppError('NOT_FOUND')
  }
  const versions = (await tx.select({ version: orgKeys.version }).from(orgKeys).where(isNull(orgKeys.retiredAt)).orderBy(asc(orgKeys.version)).for('update')).map((r) => r.version)
  if (t.keyVersion !== versions.at(-1)) throw new AppError('VALIDATION', 'Plik trzeba zaszyfrować bieżącą wersją klucza organizacji')
  if (!(await hasSlot(tx, userId, t.keyVersion))) throw new AppError('NO_KEY_ACCESS')
}
