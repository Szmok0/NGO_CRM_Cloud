// Anonimizacja osoby (ZADANIE_03, krok 5a; D12; bezpieczeństwo, rozdział 6). Jedyny wyjątek od zasady „usuwanie = deletedAt”
// (zasada danych 3): tożsamość, dane wrażliwe, załączniki i wolny tekst osoby znikają fizycznie, statystyka zostaje.
// Wszystko w jednej transakcji; pliki znikają z dysku dopiero po jej zatwierdzeniu.
import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { and, eq, inArray, isNull, or } from 'drizzle-orm'
import type { ApiOutputs, ApiParsed } from '@shared/api'
import { AppError } from '@shared/errors'
import type { ActivityType } from '@shared/domain'
import { logAccess } from '../auth/accessLog'
import { appRoot } from '../config'
import type { Db } from '../db/connection'
import {
  actionParticipants,
  activities,
  activityContacts,
  attachments,
  changeLog,
  consents,
  contactIdentity,
  contactRoles,
  contactSensitive,
  contacts,
  erasedContacts,
  relationships,
  taskItems,
  tasks
} from '../db/schema'
import { repoFor, type Actor } from './common'

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

/** Folder plików załączników (jak w attachmentRoutes.ts); bez STORAGE_DIR nie ma plików do usunięcia. */
const attachmentsDir = (storageDir: string) => join(resolve(appRoot, storageDir), 'attachments')

/** Wpisy na osi osoby: tylko z nią (`own`) i wspólne (`shared`); wpisy systemowe pomijane (JSON zdarzenia, bez danych osobowych). */
async function linkedActivities(tx: Tx, contactId: string) {
  const mine = (await tx.select({ id: activityContacts.activityId }).from(activityContacts).where(and(eq(activityContacts.contactId, contactId), isNull(activityContacts.deletedAt)))).map((r) => r.id)
  if (mine.length === 0) return { own: [], shared: [] }
  const rows = await tx.select().from(activities).where(inArray(activities.id, mine))
  const links = await tx
    .select({ id: activityContacts.activityId, contactId: activityContacts.contactId })
    .from(activityContacts)
    .where(and(inArray(activityContacts.activityId, mine), isNull(activityContacts.deletedAt)))
  const others = new Set(links.filter((l) => l.contactId !== contactId).map((l) => l.id))
  const text = rows.filter((a) => a.type !== 'system')
  return { own: text.filter((a) => !others.has(a.id)), shared: text.filter((a) => others.has(a.id)) }
}

const personTasks = (tx: Tx, contactId: string) => tx.select().from(tasks).where(and(eq(tasks.targetType, 'contact'), eq(tasks.targetId, contactId)))

const activityItem = (a: typeof activities.$inferSelect) => ({
  id: a.id,
  type: a.type as ActivityType,
  occurredAt: a.occurredAt.toISOString(),
  content: a.content,
  deleted: !!a.deletedAt
})

/** Osoba do anonimizacji: istnieje, jest osobą (nie instytucją) i nie została jeszcze zanonimizowana. Także z Kosza. */
async function requirePerson(tx: Tx, id: string, lock = false) {
  const q = tx.select().from(contacts).where(eq(contacts.id, id))
  const [c] = await (lock ? q.for('update') : q)
  if (!c) throw new AppError('NOT_FOUND')
  if (c.kind !== 'person') throw new AppError('VALIDATION', 'PERSON_ONLY')
  if (c.anonymizedAt) throw new AppError('VALIDATION', 'ALREADY_ANONYMIZED')
  return c
}

export function anonymizePreview(db: Db, { id }: ApiParsed<'contacts.anonymizePreview'>): Promise<ApiOutputs['contacts.anonymizePreview']> {
  return db.transaction(async (tx) => {
    const c = await requirePerson(tx, id)
    const { own, shared } = await linkedActivities(tx, id)
    const attachmentRows = await tx.select({ id: attachments.id }).from(attachments).where(and(eq(attachments.targetType, 'contact'), eq(attachments.targetId, id)))
    return {
      version: c.version,
      ownActivities: own.map(activityItem),
      sharedActivities: shared.map(activityItem),
      tasks: (await personTasks(tx, id)).map((t) => ({ id: t.id, title: t.title, description: t.description, deleted: !!t.deletedAt })),
      attachments: attachmentRows.length
    }
  })
}

/** Zamienia wartości w change_log tych rekordów na same nazwy pól (zasada danych 8), żeby dziennik nie trzymał usuniętej treści. */
async function scrubChangeLog(tx: Tx, entity: string, ids: string[]) {
  if (ids.length === 0) return
  const rows = await tx.select({ id: changeLog.id, fields: changeLog.changedFields }).from(changeLog).where(and(eq(changeLog.entity, entity), inArray(changeLog.entityId, ids)))
  for (const r of rows) {
    const fields = r.fields as Record<string, unknown>
    if (Object.values(fields).every((v) => v === true)) continue
    await tx.update(changeLog).set({ changedFields: Object.fromEntries(Object.keys(fields).map((k) => [k, true])) }).where(eq(changeLog.id, r.id))
  }
}

interface Erased {
  storageKeys: string[]
  activityIds: string[]
  taskIds: string[]
}

/**
 * Fizyczne usunięcie danych osoby i wyczyszczenie jej wolnego tekstu. Idempotentne (używa go też `applyErasures`).
 * Wiersz `contacts` aktualizuje wywołujący. `extraActivityIds` i `extraTaskIds`: wpisy wspólne i zadania wskazane przez administratora.
 */
async function eraseData(tx: Tx, contactId: string, extraActivityIds: string[], extraTaskIds: string[]): Promise<Erased> {
  await tx.delete(contactIdentity).where(eq(contactIdentity.contactId, contactId))
  await tx.delete(contactSensitive).where(eq(contactSensitive.contactId, contactId))
  const files = await tx.select({ id: attachments.id, storageKey: attachments.storageKey }).from(attachments).where(and(eq(attachments.targetType, 'contact'), eq(attachments.targetId, contactId)))
  await tx.delete(attachments).where(and(eq(attachments.targetType, 'contact'), eq(attachments.targetId, contactId)))

  // wolny tekst przy rolach, zgodach, powiązaniach i udziale (wiersze zostają: statystyka)
  const roleIds = (await tx.select({ id: contactRoles.id }).from(contactRoles).where(eq(contactRoles.contactId, contactId))).map((r) => r.id)
  if (roleIds.length) await tx.update(contactRoles).set({ note: null }).where(inArray(contactRoles.id, roleIds))
  const consentIds = (await tx.select({ id: consents.id }).from(consents).where(eq(consents.contactId, contactId))).map((r) => r.id)
  if (consentIds.length) await tx.update(consents).set({ basis: null, note: null }).where(inArray(consents.id, consentIds))
  const relationshipIds = (await tx.select({ id: relationships.id }).from(relationships).where(or(eq(relationships.contactAId, contactId), eq(relationships.contactBId, contactId)))).map((r) => r.id)
  if (relationshipIds.length) await tx.update(relationships).set({ note: null }).where(inArray(relationships.id, relationshipIds))
  const participantIds = (await tx.select({ id: actionParticipants.id }).from(actionParticipants).where(eq(actionParticipants.contactId, contactId))).map((r) => r.id)
  if (participantIds.length) await tx.update(actionParticipants).set({ note: null }).where(inArray(actionParticipants.id, participantIds))

  // treść wpisów: tylko tej osoby zawsze, wspólne tylko wskazane; wpisy systemowe zostają
  const { own, shared } = await linkedActivities(tx, contactId)
  const sharedIds = new Set(shared.map((a) => a.id))
  const activityIds = [...new Set([...own.map((a) => a.id), ...extraActivityIds.filter((id) => sharedIds.has(id))])]
  if (activityIds.length) await tx.update(activities).set({ content: '', form: null }).where(inArray(activities.id, activityIds))

  const allowedTasks = new Set((await personTasks(tx, contactId)).map((t) => t.id))
  const taskIds = [...new Set(extraTaskIds.filter((id) => allowedTasks.has(id)))]
  let itemIds: string[] = []
  if (taskIds.length) {
    await tx.update(tasks).set({ title: '', description: null }).where(inArray(tasks.id, taskIds))
    itemIds = (await tx.select({ id: taskItems.id }).from(taskItems).where(inArray(taskItems.taskId, taskIds))).map((r) => r.id)
    if (itemIds.length) await tx.update(taskItems).set({ label: '' }).where(inArray(taskItems.id, itemIds))
  }

  await scrubChangeLog(tx, 'contacts', [contactId])
  await scrubChangeLog(tx, 'contact_roles', roleIds)
  await scrubChangeLog(tx, 'consents', consentIds)
  await scrubChangeLog(tx, 'relationships', relationshipIds)
  await scrubChangeLog(tx, 'action_participants', participantIds)
  await scrubChangeLog(tx, 'activities', activityIds)
  await scrubChangeLog(tx, 'tasks', taskIds)
  await scrubChangeLog(tx, 'task_items', itemIds)
  return { storageKeys: files.map((f) => f.storageKey), activityIds, taskIds }
}

/** Plik, którego już nie ma, nie jest błędem (anonimizacja ma się dać dokończyć). */
async function removeFiles(storageDir: string | undefined, keys: string[]) {
  if (!storageDir) return
  for (const key of keys) await rm(join(attachmentsDir(storageDir), key), { force: true })
}

/** Anonimizacja osoby (tylko administrator). Pliki znikają po zatwierdzeniu transakcji. */
export async function anonymizeContact(db: Db, input: ApiParsed<'contacts.anonymize'>, actor: Actor, storageDir?: string): Promise<void> {
  const erased = await db.transaction(async (tx) => {
    await requirePerson(tx, input.id, true)
    // version sprawdza repo (VERSION_CONFLICT); zapis tagów i znacznika anonimizacji podbija wersję
    const repo = repoFor(tx, actor)
    await repo.update(contacts, input.id, input.version, { tags: [], anonymizedAt: actor.now })
    const e = await eraseData(tx, input.id, input.clearActivityIds, input.clearTaskIds)
    await tx.insert(erasedContacts).values({ contactId: input.id, erasedAt: actor.now, clearedActivityIds: e.activityIds, clearedTaskIds: e.taskIds })
    await tx.insert(changeLog).values({ id: randomUUID(), entity: 'contacts', entityId: input.id, op: 'anonymize', changedFields: { anonymizedAt: true }, userId: actor.userId, at: actor.now })
    await logAccess(tx, actor.userId, 'anonymize', actor.now, input.id, 'contact')
    return e
  })
  await removeFiles(storageDir, erased.storageKeys)
}

/**
 * Ponowne nałożenie usunięć z `erased_contacts` (po odtworzeniu kopii zrobionej przed anonimizacją). Idempotentne.
 * Wywoła ją ZADANIE_04. Zwraca liczbę osób, którym coś usunięto.
 */
export async function applyErasures(db: Db, storageDir?: string): Promise<number> {
  let applied = 0
  for (const e of await db.select().from(erasedContacts)) {
    const keys = await db.transaction(async (tx) => {
      const [c] = await tx.select().from(contacts).where(eq(contacts.id, e.contactId)).for('update')
      if (!c) return null // osoby nie ma w tej kopii
      if (!c.anonymizedAt) await tx.update(contacts).set({ tags: [], anonymizedAt: e.erasedAt }).where(eq(contacts.id, c.id))
      return (await eraseData(tx, e.contactId, e.clearedActivityIds, e.clearedTaskIds)).storageKeys
    })
    if (keys === null) continue
    await removeFiles(storageDir, keys)
    applied++
  }
  return applied
}
