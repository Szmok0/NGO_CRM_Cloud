// Oś aktywności (wzór: desktopowe addActivity / loadActivities / addSystemActivity z src/main/services).
// Wpis zna osoby tylko przez `contacts.id` (activity_contacts); imiona do widoku dokłada złączenie z tożsamością.
import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { ApiParsed } from '@shared/api'
import type { ActivityType, Channel } from '@shared/domain'
import { AppError } from '@shared/errors'
import type { ActivityView, Contact } from '@shared/types'
import type { Db } from '../db/connection'
import type { Repo } from '../db/repo'
import { activities, activityContacts, contacts, users } from '../db/schema'
import { contactRef, contactsById, meta, repoFor, type Actor } from './common'

/** Wpis systemowy na osi. Treść to JSON ze zdarzeniem; tekst po polsku składa klient (Timeline.tsx). */
export async function addSystemActivity(repo: Repo, now: Date, event: Record<string, unknown> & { event: string }, contactIds: string[], actionId: string | null = null) {
  const a = await repo.insert(activities, { type: 'system', occurredAt: now, content: JSON.stringify(event), actionId })
  for (const contactId of contactIds) await repo.insert(activityContacts, { activityId: a.id, contactId })
}

export async function addActivity(db: Db, i: ApiParsed<'activities.add'>, actor: Actor): Promise<void> {
  const ids = [...new Set(i.contactIds)]
  const live = await db.select({ id: contacts.id }).from(contacts).where(and(inArray(contacts.id, ids), isNull(contacts.deletedAt)))
  if (live.length !== ids.length) throw new AppError('NOT_FOUND')
  await db.transaction(async (tx) => {
    const repo = repoFor(tx, actor)
    const a = await repo.insert(activities, {
      type: i.type,
      content: i.content,
      occurredAt: new Date(i.occurredAt),
      channel: i.type === 'contact' ? i.channel : null,
      form: i.type === 'support' ? i.form : null,
      durationMinutes: i.type === 'note' ? null : i.durationMinutes,
      actionId: null
    })
    for (const contactId of ids) await repo.insert(activityContacts, { activityId: a.id, contactId })
  })
}

/** Usunięcie wpisu (oznaczenie). Wpisów systemowych nie usuwa się z interfejsu. */
export async function deleteActivity(db: Db, { id, version }: ApiParsed<'activities.delete'>, actor: Actor): Promise<void> {
  const [a] = await db.select({ type: activities.type }).from(activities).where(eq(activities.id, id))
  if (!a) throw new AppError('NOT_FOUND')
  if (a.type === 'system') throw new AppError('VALIDATION', 'SYSTEM_ACTIVITY')
  await repoFor(db, actor).softDelete(activities, id, version)
}

/** Wpisy na osi osoby (najnowsze najpierw). Wpisy działań dojdą z krokiem 4. */
export async function loadActivities(db: Db, filter: { contactId: string }, all?: Map<string, Contact>): Promise<ActivityView[]> {
  const linked = await db
    .select({ id: activityContacts.activityId })
    .from(activityContacts)
    .where(and(eq(activityContacts.contactId, filter.contactId), isNull(activityContacts.deletedAt)))
  if (linked.length === 0) return []
  const rows = await db
    .select()
    .from(activities)
    .where(and(isNull(activities.deletedAt), inArray(activities.id, linked.map((l) => l.id))))
  if (rows.length === 0) return []

  const links = await db
    .select()
    .from(activityContacts)
    .where(and(inArray(activityContacts.activityId, rows.map((r) => r.id)), isNull(activityContacts.deletedAt)))
  const people = all ?? (await contactsById(db))
  const authors = new Map((await db.select({ id: users.id, name: users.name }).from(users)).map((u) => [u.id, u.name]))

  return rows
    .map(
      (a): ActivityView => ({
        ...meta(a),
        type: a.type as ActivityType,
        channel: a.channel as Channel | null,
        form: a.form,
        durationMinutes: a.durationMinutes,
        occurredAt: a.occurredAt.toISOString(),
        content: a.content,
        actionId: a.actionId,
        authorName: authors.get(a.updatedBy) ?? '',
        actionTitle: null,
        contacts: links.flatMap((l) => {
          const c = l.activityId === a.id ? people.get(l.contactId) : undefined
          return c ? [contactRef(c)] : []
        })
      })
    )
    .sort((x, y) => y.occurredAt.localeCompare(x.occurredAt))
}
