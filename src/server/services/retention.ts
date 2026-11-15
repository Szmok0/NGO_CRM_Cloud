// Okresy przechowywania (ZADANIE_04, krok 5; D10). Lista osób bez aktywności dłużej niż okres ustawiony przez administratora.
// Nic nie dzieje się automatycznie: osoba trafia na listę, a administrator wybiera „Anonimizuj” (okno z ZADANIA_03)
// albo „Zostaw jeszcze na rok”. Wyłączone: osoby z aktywną rolą członek / pracownik / darczyńca (potwierdzone przez MOC).
import { and, eq, inArray, isNull, or } from 'drizzle-orm'
import type { RetentionList, RetentionPerson } from '@shared/api'
import { AppError } from '@shared/errors'
import { displayName } from '@shared/text'
import type { Db } from '../db/connection'
import { actionParticipants, actionSessions, actions, activities, activityContacts, attendance, consents, contactRoles, contacts, relationships, settings, tasks } from '../db/schema'
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

  // Prowadzący zajęcia (bez obecności i bez wpisu na osi) też jest aktywny.
  const led = await db
    .select({ contactId: actionSessions.leaderContactId, date: actionSessions.date })
    .from(actionSessions)
    .innerJoin(actions, eq(actions.id, actionSessions.actionId))
    .where(and(inArray(actionSessions.leaderContactId, ids), isNull(actionSessions.deletedAt), isNull(actions.deletedAt)))
  for (const r of led) later(last, r.contactId!, r.date)

  // Zgody: dzień udzielenia i wycofania.
  const cons = await db
    .select({ contactId: consents.contactId, given: consents.givenAt, withdrawn: consents.withdrawnAt })
    .from(consents)
    .where(and(inArray(consents.contactId, ids), isNull(consents.deletedAt)))
  for (const r of cons) {
    later(last, r.contactId, r.given)
    later(last, r.contactId, r.withdrawn)
  }

  // Role: nadanie, zakończenie (gdy już minęło) i dodanie wiersza liczą się jako aktywność.
  const rs = await db
    .select({ contactId: contactRoles.contactId, since: contactRoles.since, until: contactRoles.until, createdAt: contactRoles.createdAt })
    .from(contactRoles)
    .where(and(inArray(contactRoles.contactId, ids), isNull(contactRoles.deletedAt)))
  for (const r of rs) {
    if (r.since && r.since <= todayStr) later(last, r.contactId, r.since)
    if (r.until && r.until <= todayStr) later(last, r.contactId, r.until)
    later(last, r.contactId, today(r.createdAt))
  }

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

/** Powiązania, przez które osoba „żyje” razem z drugą stroną (opiekun dziecka, osoba kontaktowa instytucji). */
const PROTECTING_RELATIONSHIPS = ['guardian', 'contact_person', 'works_at']

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

  // Druga strona powiązań: ktoś, kto jest nadal „żywy”, chroni swojego opiekuna / osobę kontaktową.
  const rels = await db
    .select({ a: relationships.contactAId, b: relationships.contactBId })
    .from(relationships)
    .where(and(isNull(relationships.deletedAt), inArray(relationships.type, PROTECTING_RELATIONSHIPS), or(inArray(relationships.contactAId, candidates), inArray(relationships.contactBId, candidates))))
  const partners = new Map<string, Set<string>>()
  const link = (x: string, y: string) => partners.set(x, (partners.get(x) ?? new Set()).add(y))
  for (const r of rels) {
    link(r.a, r.b)
    link(r.b, r.a)
  }
  const allIds = [...new Set([...candidates, ...[...partners.values()].flatMap((x) => [...x])])]

  const exempt = new Set(
    (
      await db
        .select({ contactId: contactRoles.contactId, until: contactRoles.until })
        .from(contactRoles)
        .where(and(inArray(contactRoles.contactId, allIds), inArray(contactRoles.role, [...RETENTION_EXEMPT_ROLES]), isNull(contactRoles.deletedAt)))
    )
      .filter((r) => !r.until || r.until >= todayStr)
      .map((r) => r.contactId)
  )
  const [all, last] = await Promise.all([contactsById(db), lastActivityByContact(db, allIds, now)])
  const lastOn = (id: string) => {
    const c = all.get(id)
    return [last.get(id), c ? today(new Date(c.createdAt)) : null].filter((x): x is string => !!x).sort().at(-1) ?? null
  }
  const alive = (id: string) => {
    const c = all.get(id)
    if (!c || c.deletedAt || c.anonymizedAt) return false
    return exempt.has(id) || (lastOn(id) ?? '') >= cutoff
  }

  const items: RetentionPerson[] = []
  for (const id of candidates) {
    const c = all.get(id)
    const on = lastOn(id)
    if (!c || !on || exempt.has(id) || on >= cutoff) continue
    if ([...(partners.get(id) ?? [])].some(alive)) continue
    items.push({ contactId: id, version: c.version, label: displayName(c), lastActivityOn: on, monthsInactive: wholeMonthsBetween(on, todayStr) })
  }
  return { months, items: items.sort((x, y) => x.lastActivityOn.localeCompare(y.lastActivityOn) || x.label.localeCompare(y.label, 'pl')) }
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
