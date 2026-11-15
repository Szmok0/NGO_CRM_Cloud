// Zmiana klucza organizacji (ZADANIE_03, krok 4; D9). Rotacja trwa, gdy są co najmniej dwie niewycofane wersje:
// najnowsza jest bieżąca (nowe zapisy), starsze czekają na przeszyfrowanie w przeglądarce administratora.
// Serwer nie widzi żadnego klucza: przechowuje sloty i szyfrogramy, pilnuje wersji i zestawu uprawnionych.
import { randomUUID } from 'node:crypto'
import { and, asc, count, eq, inArray, isNotNull, isNull, lt, max } from 'drizzle-orm'
import type { ApiOutputs, ApiParsed } from '@shared/api'
import type { TargetType } from '@shared/domain'
import { AppError } from '@shared/errors'
import type { Db } from '../db/connection'
import { attachments, contactSensitive, keySlots, orgKeys } from '../db/schema'
import { repoFor, type Actor } from '../services/common'
import { logAccess } from './accessLog'
import { requireOwnSlots } from './access'

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

/**
 * Niewycofane wersje rosnąco, z blokadą wierszy: nadawanie dostępu, zapis danych wrażliwych i wysyłanie plików
 * blokują te same wiersze, więc nie przeplatają się ze startem i końcem rotacji.
 */
const lockActiveVersions = async (tx: Tx) =>
  (await tx.select({ version: orgKeys.version }).from(orgKeys).where(isNull(orgKeys.retiredAt)).orderBy(asc(orgKeys.version)).for('update')).map((r) => r.version)

/** Ile rekordów ma wersję klucza starszą niż `current` (także w Koszu: po przywróceniu muszą dać się odczytać). */
async function remaining(tx: Tx, current: number) {
  const [s] = await tx.select({ n: count() }).from(contactSensitive).where(lt(contactSensitive.keyVersion, current))
  const [a] = await tx.select({ n: count() }).from(attachments).where(lt(attachments.keyVersion, current))
  return { sensitive: s?.n ?? 0, attachments: a?.n ?? 0 }
}

/**
 * Start: nowa wersja klucza (największa + 1), sloty dokładnie dla osób ze slotem do bieżącej wersji (jak `access.list`)
 * i nowy slot odzyskiwania, w jednej transakcji. Druga rotacja w trakcie pierwszej → ROTATION_IN_PROGRESS.
 */
export function rotateStart(db: Db, input: ApiParsed<'keys.rotateStart'>, actor: Actor): Promise<void> {
  return db.transaction(async (tx) => {
    const versions = await lockActiveVersions(tx)
    const current = versions.at(-1)
    if (current === undefined) throw new AppError('NOT_FOUND')
    if (versions.length > 1) throw new AppError('ROTATION_IN_PROGRESS')
    await requireOwnSlots(tx, actor.userId, versions)
    const [top] = await tx.select({ v: max(orgKeys.version) }).from(orgKeys)
    if (input.keyVersion !== (top?.v ?? 0) + 1) throw new AppError('VALIDATION', 'Nowa wersja klucza musi być kolejną liczbą')
    // Blokada slotów: odebranie dostępu w tym samym czasie poczeka albo zmieni zestaw przed sprawdzeniem.
    const holders = (
      await tx
        .select({ userId: keySlots.userId })
        .from(keySlots)
        .where(and(eq(keySlots.keyVersion, current), isNotNull(keySlots.userId)))
        .for('update')
    ).map((h) => h.userId as string)
    const sent = input.slots.map((s) => s.userId)
    if (new Set(sent).size !== sent.length || sent.length !== holders.length || !holders.every((h) => sent.includes(h))) {
      throw new AppError('VALIDATION', 'Sloty muszą obejmować dokładnie osoby z dostępem do danych wrażliwych')
    }
    await tx.insert(orgKeys).values({ version: input.keyVersion, createdAt: actor.now, createdBy: actor.userId })
    const slot = (userId: string | null, wrappedKey: string) => ({ id: randomUUID(), userId, keyVersion: input.keyVersion, wrappedKey, grantedBy: actor.userId, grantedAt: actor.now })
    await tx.insert(keySlots).values([...input.slots.map((s) => slot(s.userId, s.wrappedKey)), slot(null, input.recoverySlot)])
    await logAccess(tx, actor.userId, 'key_rotation_started', actor.now)
  })
}

/** Partia rekordów ze starszą wersją klucza; tylko dla administratora ze slotami do wszystkich niewycofanych wersji. */
export function rotationPending(db: Db, { limit }: ApiParsed<'keys.rotatePending'>, actor: Actor): Promise<ApiOutputs['keys.rotatePending']> {
  return db.transaction(async (tx) => {
    const versions = (await tx.select({ version: orgKeys.version }).from(orgKeys).where(isNull(orgKeys.retiredAt)).orderBy(asc(orgKeys.version))).map((r) => r.version)
    const current = versions.at(-1)
    if (current === undefined) throw new AppError('NOT_FOUND')
    await requireOwnSlots(tx, actor.userId, versions)
    const sensitive = await tx
      .select({
        id: contactSensitive.id,
        contactId: contactSensitive.contactId,
        version: contactSensitive.version,
        keyVersion: contactSensitive.keyVersion,
        iv: contactSensitive.iv,
        ciphertext: contactSensitive.ciphertext
      })
      .from(contactSensitive)
      .where(lt(contactSensitive.keyVersion, current))
      .orderBy(asc(contactSensitive.id))
      .limit(limit)
    const files = await tx
      .select({
        id: attachments.id,
        version: attachments.version,
        keyVersion: attachments.keyVersion,
        targetType: attachments.targetType,
        targetId: attachments.targetId,
        metaEnc: attachments.metaEnc
      })
      .from(attachments)
      .where(lt(attachments.keyVersion, current))
      .orderBy(asc(attachments.id))
      .limit(limit)
    return {
      currentVersion: current,
      remaining: await remaining(tx, current),
      sensitive,
      attachments: files.map((f) => ({ ...f, targetType: f.targetType as TargetType }))
    }
  })
}

/**
 * Zapis przeszyfrowanych rekordów bieżącą wersją (przez repozytorium: `version` + 1, `change_log` z samymi nazwami pól).
 * Rekord, który w międzyczasie zmienił wersję, zniknął albo ma już bieżący klucz, jest pomijany i trafia do `conflicts`:
 * bez nadpisywania cudzego zapisu; jeśli wciąż ma starszą wersję klucza, wróci w `keys.rotatePending`.
 */
export function rotateBatch(db: Db, input: ApiParsed<'keys.rotateBatch'>, actor: Actor): Promise<ApiOutputs['keys.rotateBatch']> {
  return db.transaction(async (tx) => {
    const versions = await lockActiveVersions(tx)
    const current = versions.at(-1)
    if (current === undefined || versions.length < 2) throw new AppError('VALIDATION', 'Zmiana klucza organizacji nie trwa')
    if (input.keyVersion !== current) throw new AppError('VALIDATION', 'Dane trzeba zaszyfrować bieżącą wersją klucza organizacji')
    await requireOwnSlots(tx, actor.userId, versions)
    const repo = repoFor(tx, actor)
    const conflicts: string[] = []
    let updated = 0
    for (const r of input.sensitive) {
      const [row] = await tx.select({ version: contactSensitive.version, keyVersion: contactSensitive.keyVersion }).from(contactSensitive).where(eq(contactSensitive.id, r.id)).for('update')
      if (!row || row.version !== r.version || row.keyVersion >= current) {
        conflicts.push(r.id)
        continue
      }
      await repo.update(contactSensitive, r.id, r.version, { keyVersion: current, iv: r.iv, ciphertext: r.ciphertext })
      updated++
    }
    for (const r of input.attachments) {
      const [row] = await tx.select({ version: attachments.version, keyVersion: attachments.keyVersion }).from(attachments).where(eq(attachments.id, r.id)).for('update')
      if (!row || row.version !== r.version || row.keyVersion >= current) {
        conflicts.push(r.id)
        continue
      }
      await repo.update(attachments, r.id, r.version, { keyVersion: current, metaEnc: r.metaEnc })
      updated++
    }
    return { updated, conflicts }
  })
}

/** Koniec: gdy nie zostało nic ze starszą wersją, te wersje dostają `retiredAt`, a ich sloty (z odzyskiwaniem) znikają. */
export function rotateFinish(db: Db, actor: Actor): Promise<void> {
  return db.transaction(async (tx) => {
    const versions = await lockActiveVersions(tx)
    const current = versions.at(-1)
    const old = versions.slice(0, -1)
    if (current === undefined || old.length === 0) throw new AppError('VALIDATION', 'Zmiana klucza organizacji nie trwa')
    await requireOwnSlots(tx, actor.userId, versions)
    const left = await remaining(tx, current)
    if (left.sensitive + left.attachments > 0) throw new AppError('ROTATION_PENDING')
    await tx.update(orgKeys).set({ retiredAt: actor.now }).where(inArray(orgKeys.version, old))
    await tx.delete(keySlots).where(inArray(keySlots.keyVersion, old))
    await logAccess(tx, actor.userId, 'key_rotated', actor.now)
  })
}
