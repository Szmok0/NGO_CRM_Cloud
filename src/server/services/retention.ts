// Okresy przechowywania (ZADANIE_04, krok 5; D10). Lista osób bez aktywności dłużej niż okres ustawiony przez administratora.
// Nic nie dzieje się automatycznie: osoba trafia na listę, a administrator wybiera „Anonimizuj” (okno z ZADANIA_03)
// albo „Zostaw jeszcze na rok”. Wyłączone: osoby z aktywną rolą członek / pracownik / darczyńca (potwierdzone przez MOC).
import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { RetentionList, RetentionPerson } from '@shared/api'
import { AppError } from '@shared/errors'
import { displayName } from '@shared/text'
import type { Db } from '../db/connection'
import { actionParticipants, actionSessions, actions, activities, activityContacts, attendance, contactRoles, contacts, settings, tasks } from '../db/schema'
import { contactsById, repoFor, today, type Actor } from './common'

/** Role, które wyłączają osobę z listy (D10): ktoś, kogo organizacja trzyma z natury rzeczy. */
export const RETENTION_EXEMPT_ROLES = ['member', 'staff', 'donor'] as const

/** RRRR-MM-DD przesunięte o `months` miesięcy wstecz (dzień przycięty do długości miesiąca). */
export function subtractMonths(day: string, months: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number]
  const total = y * 12 + (m - 1) - months
  const ny = Math.floor(total / 12)
  const nm = total - ny * 12
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate()
  return `${String(ny).padStart(4, '0')}-${String(nm + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`
}

/** RRRR-MM-DD plus rok (29 lutego → 28 lutego). */
export const addYear = (day: string): string => subtractMonths(day, -12)

/** Pełne miesiące od `from` do `to` (obie RRRR-MM-DD). */
export function wholeMonthsBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number) as [number, number, number]
  const [ty, tm, td] = to.split('-').map(Number) as [number, number, number]
  return Math.max(0, (ty - fy) * 12 + (tm - fm) - (td < fd ? 1 : 0))
}

export async function getRetentionMonths(db: Db): Promise<number | null> {
  const [s] = await db.select({ months: settings.retentionMonths }).from(settings).where(isNull(settings.deletedAt)).limit(1)
  return s?.months ?? null
}

const later = (map: Map<string, string>, id: string, day: string | null | undefined) => {
  if (!day) return
  const cur = map.get(id)
  if (!cur || day > cur) map.set(id, day)
}

/**
 * Ostatnia aktywność każdej osoby jako RRRR-MM-DD: wpisy na osi, udział w działaniu (data działania), obecność, zadanie
 * (otwarte zadanie = aktywność „dziś”). Gdy nie ma niczego, punktem odniesienia jest dzień dodania do bazy.
 */
async function lastActivityByContact(db: Db, ids: string[], now: Date): Promise<Map<string, string>> {
  const last = new Map<string, string>()
  if (ids.length === 0) return last
  const todayStr = today(now)

  const acts = await db
    .select({ contactId: activityContacts.contactId, at: activities.occurredAt })
    .from(activityContacts)
    .innerJoin(activities, eq(activities.id, activityContacts.activityId))
    .where(and(inArray(activityContacts.contactId, ids), isNull(activityContacts.deletedAt), isNull(activities.deletedAt)))
  for (const r of acts) later(last, r.contactId, today(r.at))

  const parts = await db
    .select({ contactId: actionParticipants.contactId, createdAt: actionParticipants.createdAt, start: actions.startDate, end: actions.endDate })
    .from(actionParticipants)
    .innerJoin(actions, eq(actions.id, actionParticipants.actionId))
    .where(and(inArray(actionParticipants.contactId, ids), isNull(actionParticipants.deletedAt), isNull(actions.deletedAt)))
  for (const r of parts) later(last, r.contactId, r.end ?? r.start ?? today(r.createdAt))

  const att = await db
    .select({ contactId: attendance.contactId, date: actionSessions.date })
    .from(attendance)
    .innerJoin(actionSessions, eq(actionSessions.id, attendance.sessionId))
    .where(and(inArray(attendance.contactId, ids), isNull(attendance.deletedAt), isNull(actionSessions.deletedAt)))
  for (const r of att) later(last, r.contactId, r.date)

  const tks = await db
    .select({ contactId: tasks.targetId, status: tasks.status, due: tasks.dueDate, updatedAt: tasks.updatedAt })
    .from(tasks)
    .where(and(eq(tasks.targetType, 'contact'), inArray(tasks.targetId, ids), isNull(tasks.deletedAt)))
  for (const r of tks) {
    if (!r.contactId) continue
    later(last, r.contactId, r.status === 'done' ? (r.due && r.due > today(r.updatedAt) ? r.due : today(r.updatedAt)) : todayStr)
  }
  return last
}

export async function listRetention(db: Db, now: Date): Promise<RetentionList> {
  const months = await getRetentionMonths(db)
  if (months === null) return { months: null, items: [] }
  const todayStr = today(now)
  const cutoff = subtractMonths(todayStr, months)

  const rows = await db
    .select({ id: contacts.id, snooze: contacts.retentionSnoozeUntil })
    .from(contacts)
    .where(and(eq(contacts.kind, 'person'), isNull(contacts.deletedAt), isNull(contacts.anonymizedAt)))
  const candidates = rows.filter((r) => !r.snooze || r.snooze < todayStr).map((r) => r.id)
  if (candidates.length === 0) return { months, items: [] }

  const exempt = new Set(
    (
      await db
        .select({ contactId: contactRoles.contactId, until: contactRoles.until })
        .from(contactRoles)
        .where(and(inArray(contactRoles.contactId, candidates), inArray(contactRoles.role, [...RETENTION_EXEMPT_ROLES]), isNull(contactRoles.deletedAt)))
    )
      .filter((r) => !r.until || r.until >= todayStr)
      .map((r) => r.contactId)
  )
  const ids = candidates.filter((id) => !exempt.has(id))
  const [all, last] = await Promise.all([contactsById(db), lastActivityByContact(db, ids, now)])

  const items: RetentionPerson[] = []
  for (const id of ids) {
    const c = all.get(id)
    if (!c) continue
    const lastOn = [last.get(id), today(new Date(c.createdAt))].filter((x): x is string => !!x).sort().at(-1)!
    if (lastOn >= cutoff) continue
    items.push({ contactId: id, version: c.version, label: displayName(c), lastActivityOn: lastOn, monthsInactive: wholeMonthsBetween(lastOn, todayStr) })
  }
  return { months, items: items.sort((a, b) => a.lastActivityOn.localeCompare(b.lastActivityOn) || a.label.localeCompare(b.label, 'pl')) }
}

/** Zapis okresu; `false`, gdy bez zmiany (wtedy bez wpisu w dzienniku). */
export async function setRetentionMonths(db: Db, months: number | null, actor: Actor): Promise<boolean> {
  const [s] = await db.select({ id: settings.id, version: settings.version, months: settings.retentionMonths }).from(settings).where(isNull(settings.deletedAt)).limit(1)
  if (!s) throw new AppError('NOT_FOUND')
  if ((s.months ?? null) === months) return false
  await repoFor(db, actor).update(settings, s.id, s.version, { retentionMonths: months })
  return true
}

/** „Zostaw jeszcze na rok”: tylko osoba żywa i niezanonimizowana; wersja osoby chroni przed cichym nadpisaniem. */
export async function snoozeRetention(db: Db, contactId: string, version: number, actor: Actor): Promise<void> {
  const [c] = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(eq(contacts.id, contactId), eq(contacts.kind, 'person'), isNull(contacts.deletedAt), isNull(contacts.anonymizedAt)))
  if (!c) throw new AppError('NOT_FOUND')
  await repoFor(db, actor).update(contacts, contactId, version, { retentionSnoozeUntil: addYear(today(actor.now)) })
}
