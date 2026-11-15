// Panel „Stan bezpieczeństwa” (ZADANIE_04, krok 4; D8): jedno wywołanie, wszystkie sprawy z kolorem i faktami.
// Zwracamy same fakty (liczby, daty, flagi, nazwy kont); zdania składa klient z pl.ts. Żadnych innych danych osobowych.
import { and, asc, count, desc, eq, isNotNull, isNull, lt, max, min, ne } from 'drizzle-orm'
import type { SecurityItem, SecurityStatus, SecurityTone } from '@shared/api'
import pkg from '../../../package.json'
import type { Db } from '../db/connection'
import { attachments, backups, contactSensitive, keySlots, orgKeys, users } from '../db/schema'
import { DOWNLOAD_REMINDER_DAYS } from './backups'
import { updateCheckEnabled, updateStatus } from './updates'

/** Progi z D8. */
export const BACKUP_RED_DAYS = 2
export const VERIFY_YELLOW_DAYS = 30

const DAY = 86_400_000
const days = (from: Date, now: Date) => Math.max(0, Math.floor((now.getTime() - from.getTime()) / DAY))

export interface StatusContext {
  /** Serwer ma STORAGE_DIR. */
  storageConfigured: boolean
  /** Żądanie przyszło przez HTTPS (poza localhost w trybie deweloperskim, gdzie HTTPS nie jest wymagany). */
  secure: boolean
  now: Date
}

async function backupItems(db: Db, ctx: StatusContext): Promise<SecurityItem[]> {
  const { now } = ctx
  const [lastDone] = await db.select({ startedAt: backups.startedAt }).from(backups).where(and(eq(backups.status, 'done'), isNotNull(backups.finishedAt))).orderBy(desc(backups.startedAt)).limit(1)
  const [latest] = await db.select({ status: backups.status, startedAt: backups.startedAt }).from(backups).where(ne(backups.status, 'removed')).orderBy(desc(backups.startedAt)).limit(1)
  const [agg] = await db
    .select({ first: min(backups.startedAt), lastDownload: max(backups.downloadedAt), lastTested: max(backups.restoreTestedAt) })
    .from(backups)
    .where(ne(backups.status, 'failed'))
  const lastFailed = !!latest && latest.status === 'failed' && (!lastDone || latest.startedAt > lastDone.startedAt)
  const toDate = (v: Date | string | null | undefined) => (v ? new Date(v) : null)
  const first = toDate(agg?.first)
  const lastDownload = toDate(agg?.lastDownload)
  const lastTested = toDate(agg?.lastTested)

  let backupTone: SecurityTone
  if (!ctx.storageConfigured) backupTone = 'red'
  else if (!lastDone) backupTone = 'yellow'
  else if (days(lastDone.startedAt, now) > BACKUP_RED_DAYS) backupTone = 'red'
  else backupTone = lastFailed ? 'yellow' : 'green'

  // Pobranie i sprawdzenie: licznik od ostatniego zdarzenia, a gdy go nie było, od pierwszej kopii (jak przypomnienie z kroku 1).
  const age = (last: Date | null) => {
    const ref = last ?? first
    return ref ? days(ref, now) : null
  }
  const dlAge = age(lastDownload)
  const vAge = age(lastTested)
  return [
    { id: 'backup', tone: backupTone, data: { lastAt: lastDone?.startedAt.toISOString() ?? null, ageDays: lastDone ? days(lastDone.startedAt, now) : null, lastFailed } },
    { id: 'download', tone: dlAge === null ? 'grey' : dlAge > DOWNLOAD_REMINDER_DAYS ? 'yellow' : lastDownload ? 'green' : 'grey', data: { lastAt: lastDownload?.toISOString() ?? null, ageDays: dlAge } },
    { id: 'verify', tone: vAge === null ? 'grey' : vAge > VERIFY_YELLOW_DAYS ? 'yellow' : lastTested ? 'green' : 'grey', data: { lastAt: lastTested?.toISOString() ?? null, ageDays: vAge } }
  ]
}

async function accountItems(db: Db): Promise<SecurityItem[]> {
  const active = await db.select({ id: users.id, name: users.name, totp: users.totpEnabledAt }).from(users).where(and(isNull(users.deletedAt), eq(users.status, 'active'))).orderBy(asc(users.createdAt))
  const without = active.filter((u) => !u.totp).map((u) => u.name)

  const versions = (await db.select({ version: orgKeys.version }).from(orgKeys).where(isNull(orgKeys.retiredAt)).orderBy(asc(orgKeys.version))).map((r) => r.version)
  const current = versions.at(-1)
  let access: SecurityItem
  let rotation: SecurityItem
  if (current === undefined) {
    access = { id: 'access', tone: 'grey', data: { configured: false, names: [], hasRecovery: false } }
    rotation = { id: 'rotation', tone: 'grey', data: { inProgress: false, sensitive: 0, attachments: 0 } }
  } else {
    const slots = await db.select({ userId: keySlots.userId }).from(keySlots).where(eq(keySlots.keyVersion, current))
    const holders = new Set(slots.map((s) => s.userId).filter((x): x is string => !!x))
    const names = active.filter((u) => holders.has(u.id)).map((u) => u.name)
    const hasRecovery = slots.some((s) => !s.userId)
    access = { id: 'access', tone: names.length === 0 ? 'red' : hasRecovery ? 'green' : 'yellow', data: { configured: true, names, hasRecovery } }
    const inProgress = versions.length > 1
    const [s] = inProgress ? await db.select({ n: count() }).from(contactSensitive).where(lt(contactSensitive.keyVersion, current)) : [{ n: 0 }]
    const [a] = inProgress ? await db.select({ n: count() }).from(attachments).where(lt(attachments.keyVersion, current)) : [{ n: 0 }]
    rotation = { id: 'rotation', tone: inProgress ? 'yellow' : 'green', data: { inProgress, sensitive: s?.n ?? 0, attachments: a?.n ?? 0 } }
  }
  return [{ id: 'twofa', tone: without.length ? 'yellow' : 'green', data: { missing: without.length, names: without } }, access, rotation]
}

export async function getSecurityStatus(db: Db, ctx: StatusContext): Promise<SecurityStatus> {
  const enabled = await updateCheckEnabled(db)
  const update = updateStatus(enabled)
  const versionTone: SecurityTone = update.state === 'available' ? (update.security ? 'red' : 'yellow') : update.state === 'current' ? 'green' : 'grey'
  const items: SecurityItem[] = [
    { id: 'version', tone: versionTone, data: { current: pkg.version, releasedAt: pkg.releaseDate, state: update.state, latest: update.latest, security: update.security } },
    { id: 'https', tone: ctx.secure ? 'green' : 'yellow', data: { secure: ctx.secure } },
    { id: 'storage', tone: ctx.storageConfigured ? 'green' : 'red', data: { configured: ctx.storageConfigured } },
    ...(await backupItems(db, ctx)),
    ...(await accountItems(db)),
    // Okresy przechowywania (D10): logika w kroku 5; do tego czasu szara sprawa „jeszcze nie skonfigurowane”.
    { id: 'retention', tone: 'grey', data: { configured: false } }
  ]
  return { version: pkg.version, releasedAt: pkg.releaseDate, updateCheckEnabled: enabled, update, items }
}
