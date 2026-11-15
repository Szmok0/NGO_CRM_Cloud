// Odtworzenie z kopii zapasowej (ZADANIE_04, krok 3; D5, D6). Format: src/shared/backupFormat.ts, zapis: backupExport.ts.
// Tylko na pustej bazie (kreator pierwszego uruchomienia). Klucz kopii dostajemy od przeglądarki wyłącznie na czas
// odtwarzania (serwer i tak trzyma wszystkie te dane w bazie); nigdzie go nie zapisujemy.
import { createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { createWriteStream } from 'node:fs'
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable, pipeline } from 'node:stream'
import { createGunzip } from 'node:zlib'
import { getTableColumns, sql } from 'drizzle-orm'
import { getTableConfig, type AnyMySqlColumn } from 'drizzle-orm/mysql-core'
import { z } from 'zod'
import {
  BACKUP_FORMAT_VERSION,
  BACKUP_IV_BYTES,
  BACKUP_MAGIC,
  BACKUP_TAG_BYTES,
  FRAME_FILE_DATA,
  FRAME_FILE_START,
  FRAME_MANIFEST,
  FRAME_TABLE,
  segmentAad,
  type BackupHeader,
  type BackupManifest
} from '@shared/backupFormat'
import { AppError } from '@shared/errors'
import { logAccess } from '../auth/accessLog'
import { decryptTotpSecret } from '../auth/totp'
import { migrationCount, type Db } from '../db/connection'
import { appMeta, authSessions, erasedContacts, users } from '../db/schema'
import { applyErasures } from './anonymize'
import { backupTables } from './backupExport'
import { storageRoot, writeErasedList } from './backups'

const CORRUPT = 'Plik kopii jest uszkodzony albo nie pasuje do podanego klucza. Pobierz kopię jeszcze raz albo użyj innej.'
const NEWER = 'Ta kopia pochodzi z nowszej wersji programu. Najpierw zaktualizuj program (GitHub → „Sync fork”), potem odtwórz kopię.'
const NOT_EMPTY = 'Baza nie jest pusta. Odtworzenie z kopii jest możliwe tylko w nowej, pustej instalacji, żeby nic nie zostało nadpisane.'
const MAX_HEADER_BYTES = 1024 * 1024
const MAX_FRAME_BYTES = 64 * 1024 * 1024
const ROWS_PER_INSERT = 200
/** Klucz pliku załącznika z kopii trafia do ścieżki: tylko bezpieczne znaki. */
const STORAGE_KEY = /^[A-Za-z0-9_-]{8,128}$/

export const restoreDir = (storageDir: string) => join(storageRoot(storageDir), 'restore')

/** Tabele, w których świeża instalacja nie musi być pusta (techniczne, odtwarzane z kopii). */
const SEEDED_TABLES = new Set(['app_meta'])

/** Odmowa, jeśli w bazie są już jakiekolwiek dane (poza technicznymi). */
export async function assertDatabaseEmpty(db: Db): Promise<void> {
  for (const table of backupTables()) {
    const { name } = getTableConfig(table)
    if (SEEDED_TABLES.has(name)) continue
    const [row] = await db.select({ one: sql<number>`1` }).from(table).limit(1)
    if (row) throw new AppError('VALIDATION', NOT_EMPTY)
  }
}

export interface RestoreHeader {
  header: BackupHeader
  headerHash: string
  bodyStart: number
}

/** Nagłówek pliku kopii (bez odszyfrowywania). */
export async function readHeader(path: string): Promise<RestoreHeader> {
  const fh = await open(path, 'r')
  try {
    const prefix = Buffer.alloc(12)
    const { bytesRead } = await fh.read(prefix, 0, 12, 0)
    if (bytesRead < 12 || prefix.subarray(0, 8).toString('ascii') !== BACKUP_MAGIC) throw new AppError('VALIDATION', 'To nie jest plik kopii z tego programu.')
    const len = prefix.readUInt32BE(8)
    if (len === 0 || len > MAX_HEADER_BYTES) throw new AppError('VALIDATION', CORRUPT)
    const bytes = Buffer.alloc(len)
    const r = await fh.read(bytes, 0, len, 12)
    if (r.bytesRead < len) throw new AppError('VALIDATION', CORRUPT)
    let header: BackupHeader
    try {
      header = JSON.parse(bytes.toString('utf8')) as BackupHeader
    } catch {
      throw new AppError('VALIDATION', CORRUPT)
    }
    if (typeof header.format !== 'number' || typeof header.migrations !== 'number') throw new AppError('VALIDATION', CORRUPT)
    return { header, headerHash: createHash('sha256').update(bytes).digest('hex'), bodyStart: 12 + len }
  } finally {
    await fh.close()
  }
}

/** Odszyfrowane segmenty po kolei; tag GCM (z numerem i flagą „ostatni”) wykrywa zmianę, obcięcie i przestawienie. */
async function* plainSegments(path: string, key: Buffer, h: RestoreHeader): AsyncGenerator<Buffer> {
  const fh = await open(path, 'r')
  try {
    const { size } = await fh.stat()
    let off = h.bodyStart
    let index = 0
    if (off >= size) throw new AppError('VALIDATION', CORRUPT)
    while (off < size) {
      if (off + 4 > size) throw new AppError('VALIDATION', CORRUPT)
      const lenBuf = Buffer.alloc(4)
      await fh.read(lenBuf, 0, 4, off)
      const len = lenBuf.readUInt32BE(0)
      if (len < BACKUP_IV_BYTES + BACKUP_TAG_BYTES || off + 4 + len > size) throw new AppError('VALIDATION', CORRUPT)
      const body = Buffer.alloc(len)
      await fh.read(body, 0, len, off + 4)
      const last = off + 4 + len === size
      let plain: Buffer
      try {
        const d = createDecipheriv('aes-256-gcm', key, body.subarray(0, BACKUP_IV_BYTES))
        d.setAAD(Buffer.from(segmentAad(h.headerHash, index, last), 'utf8'))
        d.setAuthTag(body.subarray(len - BACKUP_TAG_BYTES))
        plain = Buffer.concat([d.update(body.subarray(BACKUP_IV_BYTES, len - BACKUP_TAG_BYTES)), d.final()])
      } catch {
        throw new AppError('VALIDATION', CORRUPT)
      }
      yield plain
      off += 4 + len
      index++
    }
  } finally {
    await fh.close()
  }
}

/** Ramki (rodzaj, dane) z całej treści kopii. Każdy błąd odszyfrowania lub rozpakowania to `VALIDATION`. */
export async function* readFrames(path: string, key: Buffer, h: RestoreHeader): AsyncGenerator<{ kind: number; data: Buffer }> {
  const gunzip = createGunzip()
  pipeline(Readable.from(plainSegments(path, key, h)), gunzip, () => undefined)
  let pending: Buffer = Buffer.alloc(0)
  try {
    for await (const chunk of gunzip as AsyncIterable<Buffer>) {
      pending = pending.length ? Buffer.concat([pending, chunk]) : chunk
      for (;;) {
        if (pending.length < 5) break
        const len = pending.readUInt32BE(1)
        if (len > MAX_FRAME_BYTES) throw new AppError('VALIDATION', CORRUPT)
        if (pending.length < 5 + len) break
        yield { kind: pending.readUInt8(0), data: pending.subarray(5, 5 + len) }
        pending = pending.subarray(5 + len)
      }
    }
  } catch (e) {
    throw e instanceof AppError ? e : new AppError('VALIDATION', CORRUPT)
  }
  if (pending.length !== 0) throw new AppError('VALIDATION', CORRUPT)
}

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]
type Table = ReturnType<typeof backupTables>[number]

/**
 * Wgrywa wiersze tabeli z kopii. Wiersze starszej kopii dostają wartości domyślne w kolumnach, których wtedy nie było
 * (kolumna pominięta w INSERT); kolumny, których już nie ma, są ignorowane.
 */
export async function insertRows(tx: Tx, table: Table, rows: Record<string, unknown>[]) {
  const columns = Object.entries(getTableColumns(table)) as [string, AnyMySqlColumn][]
  const byDbName = new Map(columns.map(([prop, col]) => [col.name, { prop, col }]))
  for (let i = 0; i < rows.length; i += ROWS_PER_INSERT) {
    // Wiersze jednej tabeli mogą mieć różne zestawy kolumn: wstawiamy grupami o tym samym zestawie.
    const groups = new Map<string, Record<string, unknown>[]>()
    for (const r of rows.slice(i, i + ROWS_PER_INSERT)) {
      const out: Record<string, unknown> = {}
      for (const [name, v] of Object.entries(r)) {
        const c = byDbName.get(name)
        if (!c) continue
        out[c.prop] = v !== null && v !== undefined && c.col.columnType === 'MySqlDateTime' ? new Date(v as string) : v
      }
      const k = Object.keys(out).sort().join(',')
      groups.set(k, [...(groups.get(k) ?? []), out])
    }
    for (const g of groups.values()) await tx.insert(table).values(g as never)
  }
}

export interface RestoreResult {
  /** Bez usuniętych (kosz). */
  persons: number
  institutions: number
  actions: number
  documents: number
  files: number
  filesMissing: number
  /** Osoby, którym nałożono usunięcia z anonimizacji (D5). */
  erasuresApplied: number
  /** Sekret serwera (APP_SECRET) inny niż w dniu kopii: 2FA wszystkich kont ustawia się od nowa przy logowaniu. */
  twoFaReset: boolean
}

const erasedListSchema = z.array(z.object({ contactId: z.uuid(), erasedAt: z.iso.datetime(), clearedActivityIds: z.array(z.string()), clearedTaskIds: z.array(z.string()) }))

/** Łączy listę usunięć z pliku poza bazą (jeśli jest) z listą z kopii (D5). */
async function mergeErasedList(db: Db, storageDir: string): Promise<void> {
  let list: z.output<typeof erasedListSchema>
  try {
    list = erasedListSchema.parse(JSON.parse(await readFile(join(storageRoot(storageDir), 'erased_contacts.json'), 'utf8')))
  } catch {
    return // brak pliku (nowy serwer) albo nieczytelny: zostaje lista z kopii
  }
  for (const e of list) {
    await db
      .insert(erasedContacts)
      .values({ contactId: e.contactId, erasedAt: new Date(e.erasedAt), clearedActivityIds: e.clearedActivityIds, clearedTaskIds: e.clearedTaskIds })
      .onDuplicateKeyUpdate({ set: { contactId: e.contactId } })
  }
}

/** Po odtworzeniu: czy sekrety 2FA z kopii da się odczytać obecnym APP_SECRET; jeśli nie, czyści 2FA (konta ustawią je od nowa). */
async function resetTwoFaIfUnreadable(db: Db, appSecret: string): Promise<boolean> {
  const rows = await db.select({ id: users.id, enc: users.totpSecretEnc }).from(users)
  const withSecret = rows.find((r) => r.enc)
  if (!withSecret) return false
  try {
    decryptTotpSecret(withSecret.enc!, appSecret, withSecret.id)
    return false
  } catch {
    await db.update(users).set({ totpSecretEnc: null, totpEnabledAt: null, totpLastStep: null })
    return true
  }
}

/**
 * Odtwarza kopię z pliku `path` kluczem `key`. Jedna transakcja na bazę; pliki załączników trafiają na miejsce dopiero po
 * jej zatwierdzeniu (do tego czasu leżą w folderze roboczym, który zawsze sprzątamy). Zwraca podsumowanie do pokazania.
 */
export async function restoreBackup(db: Db, opts: { path: string; key: Buffer; storageDir: string; appSecret: string; now: Date }): Promise<RestoreResult> {
  await assertDatabaseEmpty(db)
  const h = await readHeader(opts.path)
  if (h.header.format > BACKUP_FORMAT_VERSION || h.header.migrations > (await migrationCount(db))) throw new AppError('VALIDATION', NEWER)
  if (opts.key.length !== 32) throw new AppError('VALIDATION', CORRUPT)

  const staging = join(restoreDir(opts.storageDir), `files-${randomBytes(8).toString('hex')}`)
  await mkdir(staging, { recursive: true })
  const staged: string[] = []
  try {
    const tables = new Map(backupTables().map((t) => [getTableConfig(t).name, t]))
    const counted: Record<string, number> = {}
    let manifest: BackupManifest | null = null
    let file: { bytes: number; got: number; stream: ReturnType<typeof createWriteStream> } | null = null
    let files = 0
    let filesMissingCount = 0
    const live = { persons: 0, institutions: 0, actions: 0, documents: 0 }

    const closeFile = async () => {
      if (!file) return
      const f = file
      file = null
      f.stream.end()
      await once(f.stream, 'finish')
      if (f.got !== f.bytes) throw new AppError('VALIDATION', CORRUPT)
      files++
    }

    await db.transaction(async (tx) => {
      // Kolejność tabel w kopii jest alfabetyczna, nie według kluczy obcych; kopia była spójna, więc na czas wgrywania wyłączamy sprawdzanie.
      await tx.execute(sql`SET FOREIGN_KEY_CHECKS = 0`)
      try {
        await tx.delete(appMeta)
        for await (const { kind, data } of readFrames(opts.path, opts.key, h)) {
          if (manifest) throw new AppError('VALIDATION', CORRUPT)
          if (kind === FRAME_TABLE) {
            await closeFile()
            const frame = JSON.parse(data.toString('utf8')) as { t: string; rows: Record<string, unknown>[] }
            counted[frame.t] = (counted[frame.t] ?? 0) + frame.rows.length
            for (const r of frame.rows) {
              if (r.deleted_at) continue
              if (frame.t === 'contacts') r.kind === 'institution' ? live.institutions++ : live.persons++
              else if (frame.t === 'actions') live.actions++
              else if (frame.t === 'attachments') live.documents++
            }
            const table = tables.get(frame.t)
            if (table) await insertRows(tx, table, frame.rows)
          } else if (kind === FRAME_FILE_START) {
            await closeFile()
            const m = JSON.parse(data.toString('utf8')) as { name: string; bytes: number }
            if (!STORAGE_KEY.test(m.name)) throw new AppError('VALIDATION', CORRUPT)
            staged.push(m.name)
            file = { bytes: m.bytes, got: 0, stream: createWriteStream(join(staging, m.name), { flags: 'wx', mode: 0o600 }) }
          } else if (kind === FRAME_FILE_DATA) {
            if (!file) throw new AppError('VALIDATION', CORRUPT)
            file.got += data.length
            if (!file.stream.write(data)) await once(file.stream, 'drain')
          } else if (kind === FRAME_MANIFEST) {
            await closeFile()
            manifest = JSON.parse(data.toString('utf8')) as BackupManifest
          } else throw new AppError('VALIDATION', CORRUPT)
        }
        const m = manifest as BackupManifest | null
        if (!m) throw new AppError('VALIDATION', CORRUPT)
        for (const [t, n] of Object.entries(m.tables)) if ((counted[t] ?? 0) !== n) throw new AppError('VALIDATION', CORRUPT)
        if (files !== m.files) throw new AppError('VALIDATION', CORRUPT)
        filesMissingCount = m.filesMissing
      } finally {
        await closeFile().catch(() => undefined)
        await tx.execute(sql`SET FOREIGN_KEY_CHECKS = 1`)
      }
    })

    // Baza zatwierdzona: pliki na miejsce, sesje (w kopii ich nie ma, ale na wszelki wypadek) precz.
    const attachmentsDir = join(storageRoot(opts.storageDir), 'attachments')
    await mkdir(attachmentsDir, { recursive: true })
    for (const name of staged) await rename(join(staging, name), join(attachmentsDir, name))
    await db.delete(authSessions)

    // D5: usunięcia z anonimizacji przeżywają odtworzenie.
    await mergeErasedList(db, opts.storageDir)
    const erasuresApplied = await applyErasures(db, opts.storageDir)
    await writeErasedList(db, opts.storageDir).catch(() => undefined)

    const twoFaReset = await resetTwoFaIfUnreadable(db, opts.appSecret)
    await logAccess(db, null, 'backup_restore', opts.now, undefined, 'backup')
    return { ...live, files, filesMissing: filesMissingCount, erasuresApplied, twoFaReset }
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}
