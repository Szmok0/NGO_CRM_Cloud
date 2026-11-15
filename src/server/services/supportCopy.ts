// „Kopia do pomocy technicznej” (ZADANIE_04, krok 5; D7): plik JSON bez danych osobowych, do wysłania komuś, kto pomaga
// naprawić program. Plik jest NIEZASZYFROWANY, dlatego działa na zasadzie listy dozwolonych pól: każda tabela musi mieć
// regułę, a z wiersza trafia do pliku tylko to, co reguła wymieni. Nowa tabela albo kolumna bez reguły nie wycieknie:
// brak reguły tabeli to błąd (test pilnuje kompletu), a nowa kolumna jest po prostu pomijana.
// Tożsamość zamieniona na „Osoba 17” / „Instytucja 3”, użytkownicy na „Użytkownik 2”; treść osi, zadań, notatek, opisów,
// tytułów i miejsc wyczyszczona (może zawierać nazwiska); zostają identyfikatory, typy, statusy, daty i liczby.
import { randomUUID } from 'node:crypto'
import { getTableConfig, MySqlTable } from 'drizzle-orm/mysql-core'
import { gte, is } from 'drizzle-orm'
import { MODULES } from '@shared/modules'
import pkg from '../../../package.json'
import { migrationCount, type Db } from '../db/connection'
import * as schema from '../db/schema'

/** Pola techniczne każdej tabeli domenowej; identyfikatory użytkowników to UUID, nie dane osobowe. */
const BASE = ['id', 'createdAt', 'updatedAt', 'updatedBy', 'deletedAt', 'version']

type Row = Record<string, unknown>
interface Rule {
  /** Pola przepisane bez zmian (poza `BASE`, które idą zawsze, gdy są w tabeli). */
  keep?: string[]
  /** Pola zastępcze liczone z wiersza; `n` to numer wiersza w tabeli (od 1, w kolejności utworzenia). */
  derive?: (row: Row, n: number) => Row
  /** Numeracja `n` liczona osobno w grupach (np. osoby i instytucje); domyślnie jedna grupa na tabelę. */
  group?: (row: Row) => string
}

const count = (v: unknown) => (Array.isArray(v) ? v.length : v && typeof v === 'object' ? Object.keys(v).length : 0)

/** Tabele, których w pliku nie ma wcale (tożsamość, dane wrażliwe, załączniki, klucze, sesje, dziennik dostępu, kopie). */
export const SUPPORT_SKIPPED_TABLES = ['app_meta', 'auth_sessions', 'invitations', 'org_keys', 'key_slots', 'access_log', 'backups', 'contact_identity', 'contact_sensitive', 'attachments']

const RULES: Record<string, Rule> = {
  // Nazwa organizacji i własne nazwy ról pomijamy; zostają ustawienia techniczne.
  settings: { derive: (r) => ({ enabledModules: (Array.isArray(r.enabledModules) ? r.enabledModules : []).filter((m) => MODULES.some((x) => x.id === m)) }), keep: ['profile', 'staleDays', 'sensitiveFieldsEnabled', 'retentionMonths', 'idleLogoutMinutes', 'checkUpdates'] },
  users: { keep: ['role', 'status', 'lastLoginAt'], derive: (r, n) => ({ label: `Użytkownik ${n}`, totpEnabled: !!r.totpEnabledAt, hasKeys: !!r.publicKey }) },
  contacts: { group: (r) => String(r.kind), keep: ['kind', 'anonymizedAt', 'retentionSnoozeUntil'], derive: (r, n) => ({ label: `${r.kind === 'institution' ? 'Instytucja' : 'Osoba'} ${n}`, tagCount: count(r.tags) }) },
  contact_roles: { keep: ['contactId', 'role', 'since', 'until'] },
  relationships: { keep: ['contactAId', 'contactBId', 'type'] },
  consents: { keep: ['contactId', 'type', 'givenAt', 'validUntil', 'withdrawnAt'] },
  activities: { keep: ['type', 'channel', 'durationMinutes', 'occurredAt', 'actionId'] },
  activity_contacts: { keep: ['activityId', 'contactId'] },
  topics: { keep: ['durationHours'], derive: (_r, n) => ({ label: `Temat ${n}` }) },
  actions: { keep: ['type', 'framework', 'status', 'startDate', 'endDate', 'topicId', 'expectedParticipants'], derive: (_r, n) => ({ label: `Działanie ${n}` }) },
  action_sessions: { keep: ['actionId', 'date', 'startTime', 'endTime', 'leaderContactId'] },
  action_participants: { keep: ['actionId', 'contactId', 'status'] },
  attendance: { keep: ['sessionId', 'contactId', 'status'] },
  tasks: { keep: ['dueDate', 'assigneeUserId', 'status', 'priority', 'targetType', 'targetId'], derive: (_r, n) => ({ label: `Zadanie ${n}` }) },
  task_items: { keep: ['taskId', 'done', 'position'] },
  // change_log: wartości pól (poza tożsamością) bywają treścią, więc zostaje tylko liczba zmienionych pól.
  change_log: { keep: ['entity', 'entityId', 'op', 'userId', 'at'], derive: (r) => ({ changedFieldCount: count(r.changedFields) }) },
  erased_contacts: { keep: ['contactId', 'erasedAt'], derive: (r) => ({ clearedActivities: count(r.clearedActivityIds), clearedTasks: count(r.clearedTaskIds) }) }
}

/** Nazwy tabel schematu (do testu kompletu reguł). */
export function schemaTableNames(): string[] {
  return Object.values(schema as Record<string, unknown>)
    .filter((x): x is MySqlTable => is(x, MySqlTable))
    .map((t) => getTableConfig(t).name)
}

export const supportRuleTables = () => Object.keys(RULES)

const sortKey = (r: Row): string => {
  const v = r.createdAt ?? r.at ?? r.erasedAt ?? ''
  return v instanceof Date ? v.toISOString() : String(v)
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Prawdziwe identyfikatory zastępujemy losowymi, spójnymi w obrębie jednego pliku: nie da się ich dopasować do adresów ani zrzutów ekranu. */
function pseudonymizeIds(tables: Record<string, Row[]>): void {
  const map = new Map<string, string>()
  const swap = (v: unknown) => {
    if (typeof v !== 'string' || !UUID.test(v)) return v
    let n = map.get(v)
    if (!n) map.set(v, (n = randomUUID()))
    return n
  }
  for (const rows of Object.values(tables)) for (const row of rows) for (const k of Object.keys(row)) row[k] = swap(row[k])
}

/** `change_log` rośnie z każdym zapisem; do pomocy wystarczy ostatnie 90 dni. */
export const SUPPORT_CHANGELOG_DAYS = 90

export function sanitizeRows(table: string, rows: Row[]): Row[] {
  const rule = RULES[table]
  if (!rule) throw new Error(`Kopia do pomocy: brak reguły dla tabeli ${table}`)
  const keys = [...BASE, ...(rule.keep ?? [])]
  const seen = new Map<string, number>()
  return [...rows]
    .sort((a, b) => sortKey(a).localeCompare(sortKey(b)) || String(a.id ?? '').localeCompare(String(b.id ?? '')))
    .map((row) => {
      const out: Row = {}
      for (const k of keys) if (k in row) out[k] = row[k]
      const g = rule.group?.(row) ?? ''
      const n = (seen.get(g) ?? 0) + 1
      seen.set(g, n)
      return { ...out, ...rule.derive?.(row, n) }
    })
}

export interface SupportCopy {
  format: 'ngo-crm-support-copy'
  formatVersion: 1
  createdAt: string
  programVersion: string
  migrations: number
  /** Dla czytającego: czego w pliku nie ma. */
  note: string
  counts: Record<string, number>
  tables: Record<string, Row[]>
}

export async function buildSupportCopy(db: Db, now: Date): Promise<SupportCopy> {
  const tables: Record<string, Row[]> = {}
  await db.transaction(async (tx) => {
    for (const t of Object.values(schema as Record<string, unknown>).filter((x): x is MySqlTable => is(x, MySqlTable))) {
      const name = getTableConfig(t).name
      if (SUPPORT_SKIPPED_TABLES.includes(name)) continue
      const q = tx.select().from(t)
      const rows = name === 'change_log' ? await q.where(gte(schema.changeLog.at, new Date(now.getTime() - SUPPORT_CHANGELOG_DAYS * 86_400_000))) : await q
      tables[name] = sanitizeRows(name, rows as Row[])
    }
  })
  pseudonymizeIds(tables)
  return {
    format: 'ngo-crm-support-copy',
    formatVersion: 1,
    createdAt: now.toISOString(),
    programVersion: pkg.version,
    migrations: await migrationCount(db),
    note: `Dane spseudonimizowane, nie anonimowe: bez imion, nazwisk, danych kontaktowych, treści wpisów, zadań i notatek, danych wrażliwych, załączników, kluczy, haseł i dziennika dostępu; identyfikatory są losowe (ważne tylko w tym pliku); zmiany z ostatnich ${SUPPORT_CHANGELOG_DAYS} dni. Powiązania i daty zostają, więc przekazuj plik tylko osobie, z którą masz umowę powierzenia.`,
    counts: Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length])),
    tables
  }
}
