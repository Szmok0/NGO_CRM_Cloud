// Ekran „Dziś”, licznik zadań, kalendarz i Kosz (wzór: desktopowe src/main/services/overview.ts i calendar.ts).
// Różnice wobec desktopu: bez karty kopii (ZADANIE_04) i alertów przygotowania (ZADANIE_05); „dziś” w strefie Europe/Warsaw;
// „Ostatnio w organizacji” rozumie zmiany tożsamości (contact_identity).
import { and, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm'
import type { ApiParsed } from '@shared/api'
import { buildCalendar, type CalendarData, type CalendarEntry } from '@shared/calendar'
import { addDays, startOfWeek } from '@shared/dates'
import type { ActionStatus, ActionType, ActivityType, ConsentType, ContactKind, OpType } from '@shared/domain'
import { buildFeed, type ChangeLogRow, type FeedItem } from '@shared/feed'
import { findStale, type StaleInput } from '@shared/stale'
import { displayName } from '@shared/text'
import type { StaleContact, TodayData, TrashItem } from '@shared/types'
import type { Db } from '../db/connection'
import {
  actionParticipants,
  actionSessions,
  actions,
  activities,
  activityContacts,
  attendance,
  changeLog,
  consents,
  contactIdentity,
  contactRoles,
  contacts,
  tasks,
  topics,
  users
} from '../db/schema'
import { contactRef, contactsById, repoFor, today, type Actor } from './common'
import { getSettings } from './settings'
import { loadTasks } from './tasks'

/** „Najbliższe dni” na ekranie „Dziś”. */
const UPCOMING_DAYS = 30
const UPCOMING_MAX = 5
const iso = (d: Date | null) => (d ? d.toISOString() : null)

// ---------- kalendarz ----------

export async function calendarEntries(db: Db, from: string, to: string, now: Date): Promise<CalendarData> {
  const modules = (await getSettings(db)).enabledModules
  const actionsOn = modules.includes('actions')
  const participantCounts = new Map<string, number>()
  if (actionsOn) {
    for (const p of await db.select({ actionId: actionParticipants.actionId, status: actionParticipants.status }).from(actionParticipants).where(isNull(actionParticipants.deletedAt))) {
      if (p.status !== 'resigned') participantCounts.set(p.actionId, (participantCounts.get(p.actionId) ?? 0) + 1)
    }
  }
  const actionRows = actionsOn ? await db.select().from(actions) : []
  const sessionRows = actionsOn ? await db.select().from(actionSessions) : []
  return buildCalendar(
    {
      actions: actionRows.map((a) => ({
        id: a.id,
        title: a.title,
        type: a.type as ActionType,
        status: a.status as ActionStatus,
        startDate: a.startDate,
        endDate: a.endDate,
        place: a.place,
        deletedAt: iso(a.deletedAt)
      })),
      sessions: sessionRows.map((x) => ({ id: x.id, actionId: x.actionId, date: x.date, startTime: x.startTime, endTime: x.endTime, deletedAt: iso(x.deletedAt) })),
      tasks: modules.includes('tasks') ? await loadTasks(db) : [],
      participantCounts,
      today: today(now)
    },
    from,
    to
  )
}

// ---------- „Dziś” ----------

export async function getToday(db: Db, actor: Actor): Promise<TodayData> {
  const settings = await getSettings(db)
  const t = today(actor.now)
  const tasksOn = settings.enabledModules.includes('tasks')
  const actionsOn = settings.enabledModules.includes('actions')

  const mine = tasksOn ? (await loadTasks(db, { assigneeUserId: actor.userId })).filter((x) => x.dueDate && x.dueDate <= t) : []
  const open = mine.filter((x) => x.status !== 'done')
  // zrobione dziś zostają na liście (przekreślone), żeby dało się cofnąć odhaczenie
  const doneToday = mine.filter((x) => x.status === 'done' && today(new Date(x.updatedAt)) === t)

  const weekStart = startOfWeek(t)
  const cal = actionsOn ? (await calendarEntries(db, weekStart, addDays(t, Math.max(UPCOMING_DAYS, 60)), actor.now)).entries : []
  const isAgenda = (e: CalendarEntry) => e.kind === 'session' || e.kind === 'actionStart'
  const nextSession = cal.find((e) => e.kind === 'session' && e.date >= t) ?? null

  return {
    tasksToday: open.filter((x) => x.dueDate === t),
    tasksOverdue: open.filter((x) => x.dueDate! < t),
    tasksDoneToday: doneToday,
    upcoming: cal.filter((e) => isAgenda(e) && e.date >= t && e.date <= addDays(t, UPCOMING_DAYS)).slice(0, UPCOMING_MAX),
    week: {
      sessions: cal.filter((e) => e.kind === 'session' && e.date <= addDays(weekStart, 6)).length,
      next: nextSession && { date: nextSession.date, startTime: nextSession.startTime }
    },
    stale: actionsOn ? await staleContacts(db, settings.staleDays, actor.now) : [],
    feed: await recentFeed(db)
  }
}

/** Licznik przy „Zadaniach” w menu: moje niezrobione zadania zaległe i na dziś. */
export async function taskCounter(db: Db, actor: Actor): Promise<number> {
  if (!(await getSettings(db)).enabledModules.includes('tasks')) return 0
  const t = today(actor.now)
  return (await loadTasks(db, { assigneeUserId: actor.userId })).filter((x) => x.status !== 'done' && x.dueDate && x.dueDate <= t).length
}

/** „Ostatnio w organizacji”: najnowsze zmiany z change_log jako zdarzenia (tekst po polsku składa klient). */
async function recentFeed(db: Db): Promise<FeedItem[]> {
  const log = await db.select().from(changeLog).orderBy(desc(changeLog.at)).limit(400)
  if (log.length === 0) return []
  const names = new Map((await db.select({ id: users.id, name: users.name }).from(users)).map((u) => [u.id, u.name]))
  const people = await contactsById(db)
  const identities = new Map((await db.select({ id: contactIdentity.id, contactId: contactIdentity.contactId }).from(contactIdentity)).map((i) => [i.id, i.contactId]))
  const actionTitles = new Map((await db.select({ id: actions.id, title: actions.title }).from(actions)).map((a) => [a.id, { title: a.title }]))
  const taskTitles = new Map((await db.select({ id: tasks.id, title: tasks.title }).from(tasks)).map((x) => [x.id, { title: x.title }]))
  const sessionNo = new Map<string, { actionId: string; no: number }>()
  const byAction = new Map<string, { id: string; date: string; startTime: string | null }[]>()
  for (const x of await db.select().from(actionSessions).where(isNull(actionSessions.deletedAt))) byAction.set(x.actionId, [...(byAction.get(x.actionId) ?? []), x])
  for (const [actionId, list] of byAction) {
    list.sort((a, b) => a.date.localeCompare(b.date) || (a.startTime ?? '').localeCompare(b.startTime ?? ''))
    list.forEach((x, i) => sessionNo.set(x.id, { actionId, no: i + 1 }))
  }
  const attendanceSession = new Map((await db.select({ id: attendance.id, sessionId: attendance.sessionId }).from(attendance)).map((a) => [a.id, a.sessionId]))
  const participantAction = new Map((await db.select({ id: actionParticipants.id, actionId: actionParticipants.actionId }).from(actionParticipants)).map((p) => [p.id, p.actionId]))
  const firstContact = new Map<string, string>()
  for (const l of await db.select({ activityId: activityContacts.activityId, contactId: activityContacts.contactId }).from(activityContacts)) {
    if (!firstContact.has(l.activityId)) firstContact.set(l.activityId, l.contactId)
  }
  const activityTypes = new Map((await db.select({ id: activities.id, type: activities.type }).from(activities)).map((a) => [a.id, a.type as ActivityType]))
  const consentRows = new Map(
    (await db.select({ id: consents.id, contactId: consents.contactId, type: consents.type }).from(consents)).map((c) => [c.id, { contactId: c.contactId, type: c.type as ConsentType }])
  )
  const topicNames = new Map((await db.select({ id: topics.id, name: topics.name }).from(topics)).map((x) => [x.id, { name: x.name }]))

  const rows: ChangeLogRow[] = log.map((e) => ({
    entity: e.entity,
    entityId: e.entityId,
    op: e.op as OpType,
    changedFields: e.changedFields as Record<string, unknown>,
    userId: e.userId,
    at: e.at.toISOString()
  }))
  return buildFeed(rows, {
    userName: (id) => names.get(id),
    contact: (id) => {
      const c = people.get(id)
      return c && { label: displayName(c), kind: c.kind as ContactKind }
    },
    action: (id) => actionTitles.get(id),
    task: (id) => taskTitles.get(id),
    session: (id) => sessionNo.get(id),
    attendanceSession: (id) => attendanceSession.get(id),
    participantAction: (id) => participantAction.get(id),
    activity: (id) => {
      const type = activityTypes.get(id)
      return type && { type, contactId: firstContact.get(id) ?? null }
    },
    consent: (id) => consentRows.get(id),
    topic: (id) => topicNames.get(id),
    identityContact: (id) => identities.get(id)
  })
}

/** „Wymaga uwagi”: uczestnicy trwających i planowanych działań bez kontaktu, wsparcia ani obecności od `staleDays` dni. */
async function staleContacts(db: Db, staleDays: number, now: Date): Promise<StaleContact[]> {
  const t = today(now)
  const participantIds = new Set(
    (await db.select().from(contactRoles).where(and(eq(contactRoles.role, 'participant'), isNull(contactRoles.deletedAt))))
      .filter((r) => !r.until || r.until >= t)
      .map((r) => r.contactId)
  )
  const activeActions = (
    await db
      .select({ id: actions.id })
      .from(actions)
      .where(and(isNull(actions.deletedAt), inArray(actions.status, ['planned', 'ongoing'])))
  ).map((a) => a.id)
  if (activeActions.length === 0) return []

  const joined = new Map<string, { at: string; actionId: string }>()
  for (const p of await db
    .select()
    .from(actionParticipants)
    .where(and(inArray(actionParticipants.actionId, activeActions), isNull(actionParticipants.deletedAt)))) {
    if (p.status === 'resigned' || !participantIds.has(p.contactId)) continue
    const at = p.createdAt.toISOString()
    const prev = joined.get(p.contactId)
    if (!prev || at < prev.at) joined.set(p.contactId, { at, actionId: p.actionId })
  }
  const actionTitles = new Map((await db.select({ id: actions.id, title: actions.title }).from(actions)).map((a) => [a.id, a.title]))

  const touches = new Map<string, string[]>()
  const push = (id: string, at: string) => touches.set(id, [...(touches.get(id) ?? []), at])
  for (const r of await db
    .select({ contactId: activityContacts.contactId, at: activities.occurredAt })
    .from(activityContacts)
    .innerJoin(activities, eq(activities.id, activityContacts.activityId))
    .where(and(isNull(activityContacts.deletedAt), isNull(activities.deletedAt), inArray(activities.type, ['contact', 'support'])))) {
    push(r.contactId, r.at.toISOString())
  }
  for (const r of await db
    .select({ contactId: attendance.contactId, date: actionSessions.date })
    .from(attendance)
    .innerJoin(actionSessions, eq(actionSessions.id, attendance.sessionId))
    .where(and(isNull(attendance.deletedAt), isNull(actionSessions.deletedAt), eq(attendance.status, 'present')))) {
    push(r.contactId, r.date)
  }

  const people = await contactsById(db)
  const inputs: StaleInput[] = [...joined].map(([contactId, j]) => ({ contactId, joinedAt: j.at, touches: touches.get(contactId) ?? [] }))
  return findStale(inputs, staleDays, now)
    .map((r) => ({ ...r, c: people.get(r.contactId) }))
    .filter((r) => r.c && !r.c.deletedAt)
    .map((r) => ({ contact: contactRef(r.c!), days: r.days, lastTouch: r.lastTouch, actionTitle: actionTitles.get(joined.get(r.contactId)!.actionId) ?? null }))
}

// ---------- Kosz ----------

export async function listTrash(db: Db): Promise<TrashItem[]> {
  const names = new Map((await db.select({ id: users.id, name: users.name }).from(users)).map((u) => [u.id, u.name]))
  const by = (id: string) => names.get(id) ?? ''
  const people = await contactsById(db)
  const items: TrashItem[] = [
    ...[...people.values()]
      .filter((c) => c.deletedAt)
      .map((c) => ({ entity: 'contacts' as const, id: c.id, version: c.version, label: displayName(c), kind: c.kind, deletedAt: c.deletedAt!, deletedBy: '' })),
    ...(await db.select().from(actions).where(isNotNull(actions.deletedAt))).map((a) => ({
      entity: 'actions' as const,
      id: a.id,
      version: a.version,
      label: a.title,
      kind: null,
      deletedAt: a.deletedAt!.toISOString(),
      deletedBy: by(a.updatedBy)
    })),
    ...(await db.select().from(tasks).where(isNotNull(tasks.deletedAt))).map((x) => ({
      entity: 'tasks' as const,
      id: x.id,
      version: x.version,
      label: x.title,
      kind: null,
      deletedAt: x.deletedAt!.toISOString(),
      deletedBy: by(x.updatedBy)
    })),
    ...(await db.select().from(topics).where(isNotNull(topics.deletedAt))).map((x) => ({
      entity: 'topics' as const,
      id: x.id,
      version: x.version,
      label: x.name,
      kind: null,
      deletedAt: x.deletedAt!.toISOString(),
      deletedBy: by(x.updatedBy)
    }))
  ]
  // kto usunął osobę: autor ostatniej zmiany wiersza `contacts` (tożsamość ma osobnego autora)
  const contactAuthors = new Map((await db.select({ id: contacts.id, updatedBy: contacts.updatedBy }).from(contacts).where(isNotNull(contacts.deletedAt))).map((c) => [c.id, c.updatedBy]))
  for (const i of items) if (i.entity === 'contacts') i.deletedBy = by(contactAuthors.get(i.id) ?? '')
  return items.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt))
}

const TRASH_TABLES = { contacts, actions, tasks, topics }

export async function restoreFromTrash(db: Db, i: ApiParsed<'trash.restore'>, actor: Actor): Promise<void> {
  await repoFor(db, actor).restore(TRASH_TABLES[i.entity], i.id, i.version)
}
