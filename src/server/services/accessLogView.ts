// Dziennik dostępu dla administratora (ZADANIE_03, krok 6a; D7): lista z filtrami i eksport CSV. W bazie są same
// identyfikatory; nazwy użytkowników, osób i działań dociągamy przy wyświetlaniu. Eksport sam trafia do dziennika.
import { and, desc, eq, gte, lt } from 'drizzle-orm'
import type { AccessLogEntry, ApiParsed, CsvExport } from '@shared/api'
import { csvText, toCsv } from '@shared/csv'
import { addDays } from '@shared/dates'
import { ACCESS_ACTION_LABELS, ACCESS_TARGET_LABELS } from '@shared/exportLabels'
import { displayName } from '@shared/text'
import type { Db } from '../db/connection'
import { logAccess } from '../auth/accessLog'
import { accessLog, actions, users } from '../db/schema'
import { contactsById, dayStart, today, type Actor } from './common'

type Filter = Pick<ApiParsed<'accessLog.list'>, 'userId' | 'action' | 'from' | 'to'>
type Row = typeof accessLog.$inferSelect

/** Górny limit wpisów w pliku CSV (zabezpieczenie pamięci serwera). */
export const ACCESS_CSV_MAX = 50_000

const where = (f: Filter) =>
  and(
    f.userId ? eq(accessLog.userId, f.userId) : undefined,
    f.action ? eq(accessLog.action, f.action) : undefined,
    f.from ? gte(accessLog.at, dayStart(f.from)) : undefined,
    // `to` włącznie: do początku następnego dnia
    f.to ? lt(accessLog.at, dayStart(addDays(f.to, 1))) : undefined
  )

/** Dociąga nazwy dla wpisów (użytkownicy, osoby, działania); zanonimizowana osoba daje pustą etykietę. */
async function withNames(db: Db, rows: Row[]): Promise<AccessLogEntry[]> {
  const userNames = new Map((await db.select({ id: users.id, name: users.name }).from(users)).map((u) => [u.id, u.name]))
  const needContacts = rows.some((r) => r.targetType === 'contact')
  const contactLabels = needContacts ? await contactsById(db) : null
  const needActions = rows.some((r) => r.targetType === 'participants_list')
  const actionTitles = needActions ? new Map((await db.select({ id: actions.id, title: actions.title }).from(actions)).map((a) => [a.id, a.title])) : null
  const label = (r: Row): string | null => {
    if (!r.targetId) return null
    if (r.targetType === 'user') return userNames.get(r.targetId) ?? null
    if (r.targetType === 'contact') {
      const c = contactLabels?.get(r.targetId)
      return c ? displayName(c) : null
    }
    if (r.targetType === 'participants_list') return actionTitles?.get(r.targetId) ?? null
    return null
  }
  return rows.map((r) => ({
    id: r.id,
    at: r.at.toISOString(),
    userId: r.userId,
    userName: r.userId ? (userNames.get(r.userId) ?? null) : null,
    action: r.action,
    targetType: r.targetType,
    targetId: r.targetId,
    targetLabel: label(r)
  }))
}

export async function listAccessLog(db: Db, f: ApiParsed<'accessLog.list'>): Promise<{ rows: AccessLogEntry[]; hasMore: boolean }> {
  // jeden wpis ponad limit mówi, czy są starsze
  const rows = await db
    .select()
    .from(accessLog)
    .where(where(f))
    .orderBy(desc(accessLog.at), desc(accessLog.id))
    .limit(f.limit + 1)
    .offset(f.offset)
  return { rows: await withNames(db, rows.slice(0, f.limit)), hasMore: rows.length > f.limit }
}

const WARSAW_TIME = new Intl.DateTimeFormat('pl-PL', {
  timeZone: 'Europe/Warsaw',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23'
})
/** `dd.mm.rrrr HH:mm:ss` w czasie polskim. */
const stamp = (iso: string) => {
  const p = Object.fromEntries(WARSAW_TIME.formatToParts(new Date(iso)).map((x) => [x.type, x.value]))
  return `${p.day}.${p.month}.${p.year} ${p.hour}:${p.minute}:${p.second}`
}

/** CSV dziennika (do 50 000 najnowszych wpisów), wpis `export` zapisany po odczycie. */
export async function exportAccessLog(db: Db, f: ApiParsed<'accessLog.exportCsv'>, actor: Actor): Promise<CsvExport> {
  const rows = await db.select().from(accessLog).where(where(f)).orderBy(desc(accessLog.at), desc(accessLog.id)).limit(ACCESS_CSV_MAX)
  const entries = await withNames(db, rows)
  await logAccess(db, actor.userId, 'export', actor.now, undefined, 'access_log')
  const csv = toCsv(
    ['Data i godzina', 'Użytkownik', 'Zdarzenie', 'Dotyczy', 'Nazwa'],
    entries.map((e) => [
      stamp(e.at),
      csvText(e.userName ?? ''),
      ACCESS_ACTION_LABELS[e.action] ?? e.action,
      e.targetType ? (ACCESS_TARGET_LABELS[e.targetType] ?? e.targetType) : '',
      csvText(e.targetLabel ?? '')
    ])
  )
  return { filename: `dziennik-dostepu-${today(actor.now)}.csv`, csv, rows: entries.length }
}
