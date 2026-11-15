// Kopie zapasowe (ZADANIE_04, krok 1; D1, D4, D5): tworzenie w tle, blokada, rotacja, lista, harmonogram.
// Plik kopii: STORAGE_DIR/backups/backup-<id>.ngb (format: src/shared/backupFormat.ts, zapis: backupExport.ts).
import { randomUUID } from 'node:crypto'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { and, desc, eq, inArray, isNotNull, lt, max, min, ne } from 'drizzle-orm'
import type { BackupItem, BackupList } from '@shared/api'
import { AppError } from '@shared/errors'
import pkg from '../../../package.json'
import { appRoot } from '../config'
import { migrationCount, type Db } from '../db/connection'
import { backups, erasedContacts, users } from '../db/schema'
import { writeBackupFile } from './backupExport'

/** Przeterminowana „trwająca” kopia (np. po padzie procesu) przestaje blokować nowe (D1). */
export const BACKUP_STALE_MS = 30 * 60_000
/** Co ile robi się kopia automatyczna (D1). */
export const BACKUP_INTERVAL_MS = 24 * 3600_000
const DAILY_KEEP = 7
const WEEKLY_KEEP = 4

const storageRoot = (storageDir: string) => resolve(appRoot, storageDir)
export const backupsDir = (storageDir: string) => join(storageRoot(storageDir), 'backups')
export const backupFilePath = (storageDir: string, id: string) => join(backupsDir(storageDir), `backup-${id}.ngb`)

const isDuplicate = (e: unknown) => {
  const x = e as { code?: string; cause?: { code?: string } }
  return x?.code === 'ER_DUP_ENTRY' || x?.cause?.code === 'ER_DUP_ENTRY'
}

/**
 * Zakłada wiersz „running” (unikalny `runningLock` = jedna kopia naraz) i zwraca od razu; kopia powstaje w tle.
 * `done` nigdy nie odrzuca: wynik jest w wierszu (`done` / `failed`). Bez STORAGE_DIR kopie nie powstają.
 */
export async function startBackup(
  db: Db,
  opts: { storageDir?: string; kind: 'auto' | 'manual'; userId: string | null; now: Date }
): Promise<{ id: string; done: Promise<void> }> {
  if (!opts.storageDir) throw new AppError('VALIDATION', 'Kopie wymagają ustawienia STORAGE_DIR (folder poza aplikacją)')
  const storageDir = opts.storageDir
  await mkdir(backupsDir(storageDir), { recursive: true })

  await db
    .update(backups)
    .set({ status: 'failed', runningLock: null, finishedAt: opts.now })
    .where(and(eq(backups.status, 'running'), lt(backups.startedAt, new Date(opts.now.getTime() - BACKUP_STALE_MS))))

  const id = randomUUID()
  const migrations = await migrationCount(db)
  try {
    await db.insert(backups).values({
      id,
      startedAt: opts.now,
      status: 'running',
      kind: opts.kind,
      startedBy: opts.userId,
      runningLock: 'running',
      programVersion: pkg.version,
      migrations
    })
  } catch (e) {
    if (isDuplicate(e)) throw new AppError('VALIDATION', 'Kopia właśnie się robi. Poczekaj kilka minut.')
    throw e
  }
  return { id, done: runBackup(db, storageDir, id, migrations, opts.now) }
}

async function runBackup(db: Db, storageDir: string, id: string, migrations: number, now: Date): Promise<void> {
  const finalPath = backupFilePath(storageDir, id)
  const tmpPath = `${finalPath}.tmp`
  try {
    const r = await writeBackupFile(db, { path: tmpPath, attachmentsDir: join(storageRoot(storageDir), 'attachments'), programVersion: pkg.version, migrations, now })
    await rename(tmpPath, finalPath)
    await db.update(backups).set({ status: 'done', runningLock: null, finishedAt: new Date(), sizeBytes: r.sizeBytes, sha256: r.sha256 }).where(eq(backups.id, id))
    await writeErasedList(db, storageDir).catch(() => undefined)
    await rotateBackups(db, storageDir)
  } catch (e) {
    await rm(tmpPath, { force: true }).catch(() => undefined)
    await db.update(backups).set({ status: 'failed', runningLock: null, finishedAt: new Date() }).where(eq(backups.id, id)).catch(() => undefined)
    // Tylko identyfikator i rodzaj błędu (zasada danych 9): komunikat błędu bazy może zawierać dane.
    const x = e as { name?: string; cause?: { code?: string } }
    console.error('Kopia zapasowa nie powiodła się', { id, errorName: x?.name, causeCode: x?.cause?.code })
  }
}

const dayKey = (d: Date) => d.toISOString().slice(0, 10)
/** Poniedziałek (UTC) tygodnia daty, jako klucz tygodnia. */
function weekKey(d: Date) {
  const day = (d.getUTCDay() + 6) % 7
  return dayKey(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day)))
}

/**
 * Rotacja (D1): zostaje najnowsza kopia z każdej z `DAILY_KEEP` ostatnich dób i najnowsza z każdego z `WEEKLY_KEEP`
 * ostatnich tygodni wśród starszych. Reszta traci plik, wiersz dostaje status „removed” (historia pobrań zostaje).
 */
export async function rotateBackups(db: Db, storageDir: string): Promise<number> {
  const rows = await db.select({ id: backups.id, startedAt: backups.startedAt }).from(backups).where(eq(backups.status, 'done')).orderBy(desc(backups.startedAt))
  const keep = new Set<string>()
  const days = new Set<string>()
  for (const r of rows) {
    const k = dayKey(r.startedAt)
    if (!days.has(k) && days.size < DAILY_KEEP) {
      days.add(k)
      keep.add(r.id)
    }
  }
  const weeks = new Set<string>()
  for (const r of rows) {
    if (days.has(dayKey(r.startedAt))) continue
    const k = weekKey(r.startedAt)
    if (!weeks.has(k) && weeks.size < WEEKLY_KEEP) {
      weeks.add(k)
      keep.add(r.id)
    }
  }
  const drop = rows.filter((r) => !keep.has(r.id)).map((r) => r.id)
  for (const id of drop) await rm(backupFilePath(storageDir, id), { force: true })
  if (drop.length) await db.update(backups).set({ status: 'removed' }).where(inArray(backups.id, drop))
  return drop.length
}

/** Po ilu dniach od ostatniego pobrania przypominamy o pobraniu kopii na komputer (D4). */
export const DOWNLOAD_REMINDER_DAYS = 7

export async function listBackups(db: Db, now = new Date()): Promise<BackupList> {
  const rows = await db.select().from(backups).where(ne(backups.status, 'removed')).orderBy(desc(backups.startedAt)).limit(60)
  const iso = (d: Date | null) => (d ? d.toISOString() : null)
  // Pobranie liczymy po wszystkich wierszach, także po usuniętych rotacją (inaczej przypomnienie by się „cofało”).
  const [agg] = await db.select({ lastDownload: max(backups.downloadedAt), first: min(backups.startedAt) }).from(backups).where(ne(backups.status, 'failed'))
  const reference = agg?.lastDownload ?? agg?.first ?? null
  const downloadDue = !!reference && now.getTime() - new Date(reference).getTime() > DOWNLOAD_REMINDER_DAYS * 86_400_000
  const items = rows.map((r) => ({
    id: r.id,
    startedAt: r.startedAt.toISOString(),
    finishedAt: iso(r.finishedAt),
    status: r.status as BackupItem['status'],
    kind: r.kind as BackupItem['kind'],
    sizeBytes: r.sizeBytes,
    downloadedAt: iso(r.downloadedAt),
    restoreTestedAt: iso(r.restoreTestedAt),
    restoreTestResult: r.restoreTestResult
  }))
  return { items, lastDownloadedAt: iso(agg?.lastDownload ? new Date(agg.lastDownload) : null), downloadDue }
}

/**
 * Lista usunięć z anonimizacji także poza bazą (D5): `STORAGE_DIR/erased_contacts.json`, same identyfikatory i daty.
 * Odtworzenie kopii zrobionej przed anonimizacją łączy ją z listą z kopii. Zapis atomowy (plik tymczasowy, rename).
 */
export async function writeErasedList(db: Db, storageDir: string): Promise<void> {
  const rows = await db.select().from(erasedContacts)
  const list = rows.map((r) => ({ contactId: r.contactId, erasedAt: r.erasedAt.toISOString(), clearedActivityIds: r.clearedActivityIds, clearedTaskIds: r.clearedTaskIds }))
  const path = join(storageRoot(storageDir), 'erased_contacts.json')
  await mkdir(storageRoot(storageDir), { recursive: true })
  await writeFile(`${path}.tmp`, JSON.stringify(list), { mode: 0o600 })
  await rename(`${path}.tmp`, path)
}

/**
 * Harmonogram (D1): kopia automatyczna, gdy od ostatniej udanej minęła doba (albo żadnej nie ma). Bez STORAGE_DIR i bez kont
 * (tryb kreatora) nic nie robi. Zwraca kopię, którą rozpoczęto, albo null.
 */
export async function runBackupCheck(db: Db, opts: { storageDir?: string; now: Date }): Promise<{ id: string; done: Promise<void> } | null> {
  if (!opts.storageDir) return null
  const [anyUser] = await db.select({ id: users.id }).from(users).limit(1)
  if (!anyUser) return null
  const [last] = await db.select({ startedAt: backups.startedAt }).from(backups).where(and(eq(backups.status, 'done'), isNotNull(backups.finishedAt))).orderBy(desc(backups.startedAt)).limit(1)
  if (last && opts.now.getTime() - last.startedAt.getTime() < BACKUP_INTERVAL_MS) return null
  try {
    return await startBackup(db, { storageDir: opts.storageDir, kind: 'auto', userId: null, now: opts.now })
  } catch (e) {
    if (e instanceof AppError) return null // trwa inna kopia
    throw e
  }
}

/** Timer procesu: sprawdzenie zaraz po starcie i co godzinę. Nie blokuje zamknięcia procesu. */
export function startBackupTimer(db: Db, storageDir: string | undefined): void {
  const tick = () =>
    runBackupCheck(db, { storageDir, now: new Date() }).catch((e) => {
      const x = e as { name?: string; cause?: { code?: string } }
      console.error('Sprawdzenie kopii nie powiodło się', { errorName: x?.name, causeCode: x?.cause?.code })
    })
  void tick()
  setInterval(() => void tick(), 3600_000).unref()
}
