// Tematy szkoleń, działania, uczestnicy, zajęcia i obecność (wzór: desktopowe src/main/services/actions.ts i tasks.ts).
// Różnice wobec desktopu: bez pól i tabel działań v2 (D1), `version` przy każdym zapisie, pary uczestnik/obecność z UNIQUE,
// tożsamość nowych osób z wklejonej listy w contact_identity.
import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { ApiParsed } from '@shared/api'
import { computeAttendanceStats } from '@shared/attendanceStats'
import type { ActionStatus, ActionType, AttendanceStatus, Framework, ParticipantStatus } from '@shared/domain'
import { AppError } from '@shared/errors'
import { parsePasteList } from '@shared/pasteList'
import { displayName, matchesQuery, normPhone, normText } from '@shared/text'
import type { Action, ActionDetail, ActionListItem, ContactListItem, PastePreviewRow, Topic, TopicDetail } from '@shared/types'
import type { Db } from '../db/connection'
import type { Repo } from '../db/repo'
import { actionParticipants, actionSessions, actions, attendance, contactIdentity, contactRoles, contacts, topics } from '../db/schema'
import { addSystemActivity, loadActivities } from './activities'
import { contactRef, contactsById, meta, repoFor, today, type Actor } from './common'
import { loadTasks } from './tasks'

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]
type ActionRow = typeof actions.$inferSelect
type TopicRow = typeof topics.$inferSelect

const toAction = (a: ActionRow): Action => ({
  ...meta(a),
  type: a.type as ActionType,
  framework: a.framework as Framework,
  title: a.title,
  status: a.status as ActionStatus,
  startDate: a.startDate,
  endDate: a.endDate,
  place: a.place,
  topicId: a.topicId,
  description: a.description,
  expectedParticipants: a.expectedParticipants
})

const toTopic = (t: TopicRow): Topic => ({ ...meta(t), name: t.name, description: t.description, program: t.program, durationHours: t.durationHours })

/** Duplikat pary (UNIQUE) przy równoczesnym zapisie dwóch osób: jak konflikt wersji (klient odświeża widok). */
async function uniquePair<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    const code = (e as { code?: string; cause?: { code?: string } }).cause?.code ?? (e as { code?: string }).code
    if (code === 'ER_DUP_ENTRY') throw new AppError('VERSION_CONFLICT')
    throw e
  }
}

// ---------- tematy ----------

export async function listTopics(db: Db): Promise<Topic[]> {
  return (await db.select().from(topics).where(isNull(topics.deletedAt))).map(toTopic).sort((a, b) => a.name.localeCompare(b.name, 'pl'))
}

export async function getTopic(db: Db, id: string): Promise<TopicDetail> {
  const [t] = await db.select().from(topics).where(eq(topics.id, id))
  if (!t) throw new AppError('NOT_FOUND')
  const rows = await db
    .select()
    .from(actions)
    .where(and(eq(actions.topicId, id), isNull(actions.deletedAt)))
  return { topic: toTopic(t), actions: await listActionItems(db, rows) }
}

export const createTopic = async (db: Db, i: ApiParsed<'topics.create'>, actor: Actor) => ({ id: (await repoFor(db, actor).insert(topics, i)).id })
export async function updateTopic(db: Db, { id, version, ...patch }: ApiParsed<'topics.update'>, actor: Actor): Promise<void> {
  await repoFor(db, actor).update(topics, id, version, patch)
}
export const deleteTopic = async (db: Db, i: ApiParsed<'topics.delete'>, actor: Actor) => void (await repoFor(db, actor).softDelete(topics, i.id, i.version))

// ---------- działania ----------

export async function listActionItems(db: Db, rows: ActionRow[]): Promise<ActionListItem[]> {
  if (rows.length === 0) return []
  const ids = rows.map((a) => a.id)
  const topicNames = new Map((await db.select({ id: topics.id, name: topics.name }).from(topics)).map((t) => [t.id, t.name]))
  const participants = await db
    .select({ actionId: actionParticipants.actionId, status: actionParticipants.status })
    .from(actionParticipants)
    .where(and(inArray(actionParticipants.actionId, ids), isNull(actionParticipants.deletedAt)))
  const sessions = await db
    .select({ actionId: actionSessions.actionId })
    .from(actionSessions)
    .where(and(inArray(actionSessions.actionId, ids), isNull(actionSessions.deletedAt)))
  return rows
    .map((a) => ({
      ...toAction(a),
      topicName: a.topicId ? (topicNames.get(a.topicId) ?? null) : null,
      participantCount: participants.filter((p) => p.actionId === a.id && p.status !== 'resigned').length,
      sessionCount: sessions.filter((x) => x.actionId === a.id).length
    }))
    .sort((x, y) => (y.startDate ?? '').localeCompare(x.startDate ?? '') || x.title.localeCompare(y.title, 'pl'))
}

export async function listActions(db: Db, f: ApiParsed<'actions.list'>): Promise<ActionListItem[]> {
  const rows = (await db.select().from(actions).where(isNull(actions.deletedAt)))
    .filter((a) => !f.type || a.type === f.type)
    .filter((a) => !f.status || a.status === f.status)
    .filter((a) => !f.framework || a.framework === f.framework)
    // filtr dat: działanie nachodzi na wybrany okres
    .filter((a) => !f.from || (a.endDate ?? a.startDate ?? '') >= f.from)
    .filter((a) => !f.to || (a.startDate ?? '') <= f.to)
    .filter((a) => !f.q || matchesQuery(f.q, a.title, a.place))
  return listActionItems(db, rows)
}

async function getActionRow(db: Db | Tx, id: string): Promise<ActionRow> {
  const [a] = await db.select().from(actions).where(eq(actions.id, id))
  if (!a) throw new AppError('NOT_FOUND')
  return a
}
async function liveAction(db: Db | Tx, id: string): Promise<ActionRow> {
  const a = await getActionRow(db, id)
  if (a.deletedAt) throw new AppError('NOT_FOUND')
  return a
}

export async function getActionDetail(db: Db, id: string, now: Date): Promise<ActionDetail> {
  const action = await getActionRow(db, id)
  const all = await contactsById(db)
  const participants = await db
    .select()
    .from(actionParticipants)
    .where(and(eq(actionParticipants.actionId, id), isNull(actionParticipants.deletedAt)))
  const sessions = (
    await db
      .select()
      .from(actionSessions)
      .where(and(eq(actionSessions.actionId, id), isNull(actionSessions.deletedAt)))
  ).sort((a, b) => a.date.localeCompare(b.date) || (a.startTime ?? '').localeCompare(b.startTime ?? ''))
  const marks =
    sessions.length === 0
      ? []
      : await db
          .select({ id: attendance.id, version: attendance.version, sessionId: attendance.sessionId, contactId: attendance.contactId, status: attendance.status })
          .from(attendance)
          .where(and(inArray(attendance.sessionId, sessions.map((x) => x.id)), isNull(attendance.deletedAt)))
  const typedMarks = marks.map((m) => ({ ...m, status: m.status as AttendanceStatus }))
  const stats = computeAttendanceStats(sessions, participants.map((p) => p.contactId), typedMarks, today(now))
  const [topic] = action.topicId ? await db.select().from(topics).where(eq(topics.id, action.topicId)) : []

  return {
    action: toAction(action),
    topic: topic ? toTopic(topic) : null,
    participants: participants
      .map((p) => {
        const c = all.get(p.contactId)
        return {
          ...meta(p),
          actionId: p.actionId,
          contactId: p.contactId,
          status: p.status as ParticipantStatus,
          note: p.note,
          contact: c ? contactRef(c) : { id: p.contactId, kind: 'person' as const, label: '', deleted: true },
          attendancePct: stats.byContact[p.contactId] ?? null
        }
      })
      .sort((a, b) => (all.get(a.contactId)?.lastName ?? a.contact.label).localeCompare(all.get(b.contactId)?.lastName ?? b.contact.label, 'pl')),
    sessions: sessions.map((x) => {
      const leader = x.leaderContactId ? all.get(x.leaderContactId) : undefined
      return {
        ...meta(x),
        actionId: x.actionId,
        date: x.date,
        startTime: x.startTime,
        endTime: x.endTime,
        leaderContactId: x.leaderContactId,
        note: x.note,
        leader: leader ? contactRef(leader) : null,
        presentCount: stats.presentBySession[x.id] ?? 0
      }
    }),
    attendance: typedMarks,
    heldCount: stats.heldCount,
    tasks: await loadTasks(db, { targetType: 'action', targetId: id }),
    activities: await loadActivities(db, { actionId: id }, all)
  }
}

/** Temat tylko przy szkoleniu; wskazany temat musi istnieć i nie być usunięty. */
async function normalizeTopic(db: Db, type: ActionType, topicId: string | null): Promise<string | null> {
  if (type !== 'training' || !topicId) return null
  const [t] = await db.select({ id: topics.id }).from(topics).where(and(eq(topics.id, topicId), isNull(topics.deletedAt)))
  if (!t) throw new AppError('NOT_FOUND')
  return topicId
}

export async function createAction(db: Db, i: ApiParsed<'actions.create'>, actor: Actor): Promise<{ id: string }> {
  const topicId = await normalizeTopic(db, i.type, i.topicId)
  return { id: (await repoFor(db, actor).insert(actions, { ...i, topicId })).id }
}

export async function updateAction(db: Db, input: ApiParsed<'actions.update'>, actor: Actor): Promise<void> {
  const { id, version, ...patch } = input
  const topicId = await normalizeTopic(db, patch.type, patch.topicId)
  await db.transaction(async (tx) => {
    const before = await getActionRow(tx, id)
    const repo = repoFor(tx, actor)
    await repo.update(actions, id, version, { ...patch, topicId })
    if (before.status !== patch.status) await addSystemActivity(repo, actor.now, { event: 'action_status', from: before.status, to: patch.status }, [], id)
  })
}

export const deleteAction = async (db: Db, i: ApiParsed<'actions.delete'>, actor: Actor) => void (await repoFor(db, actor).softDelete(actions, i.id, i.version))

// ---------- uczestnicy ----------

/** Dodaje osobę do działania (przywraca wcześniej usuniętą parę). Zwraca false, gdy już jest. */
async function addParticipant(tx: Tx, repo: Repo, actor: Actor, actionId: string, contactId: string, actionTitle: string): Promise<boolean> {
  const [existing] = await tx
    .select()
    .from(actionParticipants)
    .where(and(eq(actionParticipants.actionId, actionId), eq(actionParticipants.contactId, contactId)))
  if (existing && !existing.deletedAt) return false
  if (existing) {
    const restored = await repo.restore(actionParticipants, existing.id, existing.version)
    await repo.update(actionParticipants, existing.id, restored!.version, { status: 'registered' })
  } else {
    await repo.insert(actionParticipants, { actionId, contactId, status: 'registered' })
  }
  await addSystemActivity(repo, actor.now, { event: 'participant_added', actionTitle }, [contactId], actionId)
  return true
}

async function requireLivePerson(db: Db | Tx, id: string) {
  const [c] = await db.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.id, id), isNull(contacts.deletedAt)))
  if (!c) throw new AppError('NOT_FOUND')
}

export async function addParticipantById(db: Db, i: ApiParsed<'participants.add'>, actor: Actor): Promise<void> {
  await uniquePair(() =>
    db.transaction(async (tx) => {
      const action = await liveAction(tx, i.actionId)
      await requireLivePerson(tx, i.contactId)
      await addParticipant(tx, repoFor(tx, actor), actor, i.actionId, i.contactId, action.title)
    })
  )
}

export const setParticipantStatus = async (db: Db, i: ApiParsed<'participants.setStatus'>, actor: Actor) =>
  void (await repoFor(db, actor).update(actionParticipants, i.id, i.version, { status: i.status }))
export const removeParticipant = async (db: Db, i: ApiParsed<'participants.remove'>, actor: Actor) =>
  void (await repoFor(db, actor).softDelete(actionParticipants, i.id, i.version))

export async function previewPaste(db: Db, i: ApiParsed<'participants.previewPaste'>): Promise<PastePreviewRow[]> {
  await liveAction(db, i.actionId)
  const persons = [...(await contactsById(db)).values()].filter((c) => !c.deletedAt && c.kind === 'person')
  const inAction = new Set(
    (
      await db
        .select({ c: actionParticipants.contactId })
        .from(actionParticipants)
        .where(and(eq(actionParticipants.actionId, i.actionId), isNull(actionParticipants.deletedAt)))
    ).map((r) => r.c)
  )
  return parsePasteList(i.text).map((row) => {
    const matches: ContactListItem[] = persons
      .filter((c) => normText(c.firstName) === normText(row.firstName) && normText(c.lastName) === normText(row.lastName))
      .map((c) => ({ ...c, label: displayName(c), roles: [] }))
    // Pewne dopasowanie: jedna osoba, a podany e-mail / telefon nie przeczą danym w bazie.
    const only = matches.length === 1 ? matches[0]! : null
    const conflict =
      !!only &&
      ((!!row.email && !!only.email && normText(row.email) !== normText(only.email)) || (!!row.phone && !!only.phone && normPhone(row.phone) !== normPhone(only.phone)))
    const suggested = only && !conflict ? only.id : null
    return { ...row, matches, suggestedContactId: suggested, alreadyInAction: !!suggested && inAction.has(suggested) }
  })
}

export async function applyPaste(db: Db, i: ApiParsed<'participants.applyPaste'>, actor: Actor): Promise<{ added: number; created: number }> {
  return uniquePair(() =>
    db.transaction(async (tx) => {
      const action = await liveAction(tx, i.actionId)
      const repo = repoFor(tx, actor)
      let added = 0
      let created = 0
      for (const row of i.rows) {
        let contactId = row.contactId
        if (contactId) {
          await requireLivePerson(tx, contactId)
        } else {
          const c = await repo.insert(contacts, { kind: 'person', tags: [] })
          await repo.insert(contactIdentity, {
            contactId: c.id,
            firstName: row.firstName,
            lastName: row.lastName,
            name: null,
            email: row.email,
            phone: row.phone,
            address: null,
            city: null,
            notes: null
          })
          await repo.insert(contactRoles, { contactId: c.id, role: 'participant', since: today(actor.now) })
          await addSystemActivity(repo, actor.now, { event: 'contact_created' }, [c.id])
          contactId = c.id
          created++
        }
        if (await addParticipant(tx, repo, actor, i.actionId, contactId, action.title)) added++
      }
      return { added, created }
    })
  )
}

// ---------- zajęcia i obecność ----------

async function requireLeader(db: Db, id: string | null) {
  if (id) await requireLivePerson(db, id)
}

export async function addSession(db: Db, { actionId, ...fields }: ApiParsed<'sessions.add'>, actor: Actor): Promise<void> {
  await liveAction(db, actionId)
  await requireLeader(db, fields.leaderContactId)
  await repoFor(db, actor).insert(actionSessions, { actionId, ...fields })
}
export async function updateSession(db: Db, { id, version, ...patch }: ApiParsed<'sessions.update'>, actor: Actor): Promise<void> {
  await requireLeader(db, patch.leaderContactId)
  await repoFor(db, actor).update(actionSessions, id, version, patch)
}
export const deleteSession = async (db: Db, i: ApiParsed<'sessions.delete'>, actor: Actor) => void (await repoFor(db, actor).softDelete(actionSessions, i.id, i.version))

/** Ustawia albo czyści (status null) obecność. Sprawdza wersję zaznaczenia, które widział klient. */
export async function setAttendance(db: Db, i: ApiParsed<'attendance.set'>, actor: Actor): Promise<void> {
  await uniquePair(() =>
    db.transaction(async (tx) => {
      const [session] = await tx
        .select({ id: actionSessions.id })
        .from(actionSessions)
        .where(and(eq(actionSessions.id, i.sessionId), isNull(actionSessions.deletedAt)))
      if (!session) throw new AppError('NOT_FOUND')
      await requireLivePerson(tx, i.contactId)
      const [existing] = await tx
        .select()
        .from(attendance)
        .where(and(eq(attendance.sessionId, i.sessionId), eq(attendance.contactId, i.contactId)))
        .for('update')
      const live = existing && !existing.deletedAt ? existing : null
      // klient widział inny stan niż w bazie: ktoś zaznaczył albo zmienił obecność w międzyczasie
      if ((live?.version ?? null) !== i.version) throw new AppError('VERSION_CONFLICT')
      const repo = repoFor(tx, actor)
      if (i.status === null) {
        if (live) await repo.softDelete(attendance, live.id, live.version)
        return
      }
      if (!existing) {
        await repo.insert(attendance, { sessionId: i.sessionId, contactId: i.contactId, status: i.status })
        return
      }
      const current = live ?? (await repo.restore(attendance, existing.id, existing.version))!
      await repo.update(attendance, existing.id, current.version, { status: i.status })
    })
  )
}
