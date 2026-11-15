// Zapis pliku kopii zapasowej (ZADANIE_04, krok 1; D2, D3). Format: src/shared/backupFormat.ts.
// Serwer widzi tylko to, co i tak ma w bazie. Klucz kopii jest losowy, żyje w pamięci procesu i trafia do pliku
// wyłącznie zawinięty kluczami publicznymi administratorów; hasła ani klucza organizacji serwer nie dostaje.
import { createCipheriv, createHash, createPublicKey, publicEncrypt, randomBytes, constants } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createGzip } from 'node:zlib'
import { and, asc, eq, getTableColumns, gt, isNotNull, isNull, is, type SQL } from 'drizzle-orm'
import { getTableConfig, MySqlTable, type AnyMySqlColumn } from 'drizzle-orm/mysql-core'
import {
  BACKUP_FORMAT_VERSION,
  BACKUP_IV_BYTES,
  BACKUP_KEY_LABEL,
  BACKUP_MAGIC,
  BACKUP_SEGMENT_BYTES,
  FRAME_FILE_DATA,
  FRAME_FILE_START,
  FRAME_MANIFEST,
  FRAME_TABLE,
  segmentAad,
  type BackupAdminEntry,
  type BackupHeader,
  type BackupManifest
} from '@shared/backupFormat'
import { AppError } from '@shared/errors'
import type { Db } from '../db/connection'
import * as schema from '../db/schema'

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

/** Tabele poza kopią: sesje logowania, sama tabela kopii (D2) i zaproszenia (stare linki nie mogą ożyć po odtworzeniu). */
export const BACKUP_EXCLUDED_TABLES = new Set(['auth_sessions', 'backups', 'invitations'])

const ROWS_PER_FRAME = 500
const FILE_FRAME_BYTES = 256 * 1024

/** Tabele schematu objęte kopią, w stałej kolejności. */
export function backupTables(): MySqlTable[] {
  const tables = Object.values(schema as Record<string, unknown>).filter((x): x is MySqlTable => is(x, MySqlTable))
  return tables.filter((t) => !BACKUP_EXCLUDED_TABLES.has(getTableConfig(t).name)).sort((a, b) => getTableConfig(a).name.localeCompare(getTableConfig(b).name))
}

function primaryKeyOf(table: MySqlTable): AnyMySqlColumn {
  const pk = getTableConfig(table).columns.filter((c) => c.primary)
  if (pk.length !== 1) throw new Error(`Tabela ${getTableConfig(table).name} musi mieć jednokolumnowy klucz główny`)
  return pk[0]!
}

const frame = (kind: number, payload: Buffer) => {
  const head = Buffer.alloc(5)
  head.writeUInt8(kind, 0)
  head.writeUInt32BE(payload.length, 1)
  return Buffer.concat([head, payload])
}
const jsonFrame = (kind: number, value: unknown) => frame(kind, Buffer.from(JSON.stringify(value), 'utf8'))

/** Dzieli strumień na segmenty, każdy szyfrowany osobno AES-256-GCM (IV losowy, AAD: nagłówek, numer, „ostatni”). */
class SegmentEncryptor extends Transform {
  private chunks: Buffer[] = []
  private buffered = 0
  private pending: Buffer | null = null
  private index = 0

  constructor(
    private readonly key: Buffer,
    private readonly headerHash: string
  ) {
    super()
  }

  private seal(plain: Buffer, last: boolean): Buffer {
    const iv = randomBytes(BACKUP_IV_BYTES)
    const cipher = createCipheriv('aes-256-gcm', this.key, iv)
    cipher.setAAD(Buffer.from(segmentAad(this.headerHash, this.index++, last), 'utf8'))
    const body = Buffer.concat([iv, cipher.update(plain), cipher.final(), cipher.getAuthTag()])
    const len = Buffer.alloc(4)
    len.writeUInt32BE(body.length)
    return Buffer.concat([len, body])
  }

  // Segment wysyłamy dopiero, gdy znamy następny: dopiero wtedy wiadomo, czy poprzedni był ostatni.
  private advance(next: Buffer) {
    if (this.pending) this.push(this.seal(this.pending, false))
    this.pending = next
  }

  override _transform(chunk: Buffer, _enc: BufferEncoding, cb: (err?: Error | null) => void) {
    this.chunks.push(chunk)
    this.buffered += chunk.length
    if (this.buffered >= BACKUP_SEGMENT_BYTES) {
      const all = Buffer.concat(this.chunks)
      let off = 0
      for (; all.length - off >= BACKUP_SEGMENT_BYTES; off += BACKUP_SEGMENT_BYTES) this.advance(all.subarray(off, off + BACKUP_SEGMENT_BYTES))
      const rest = all.subarray(off)
      this.chunks = rest.length ? [rest] : []
      this.buffered = rest.length
    }
    cb()
  }

  override _flush(cb: (err?: Error | null) => void) {
    const rest = Buffer.concat(this.chunks)
    if (rest.length > 0 || !this.pending) this.advance(rest)
    this.push(this.seal(this.pending!, true))
    cb()
  }
}

/** Administratorzy z kompletem kluczy; tylko im zawijamy klucz kopii (D3). */
async function adminEntries(tx: Tx, backupKey: Buffer): Promise<BackupAdminEntry[]> {
  const u = schema.users
  const rows = await tx
    .select()
    .from(u)
    .where(and(eq(u.role, 'admin'), eq(u.status, 'active'), isNull(u.deletedAt), isNotNull(u.publicKey), isNotNull(u.privateKeyEnc), isNotNull(u.kdfSalt), isNotNull(u.kdfIterations)))
  const entries = rows.map((r) => ({
    userId: r.id,
    emailHash: createHash('sha256').update(r.email.toLowerCase()).digest('hex'),
    kdfSalt: r.kdfSalt!,
    kdfIterations: r.kdfIterations!,
    privateKeyEnc: r.privateKeyEnc!,
    wrappedKey: publicEncrypt(
      {
        key: createPublicKey({ key: Buffer.from(r.publicKey!, 'base64'), format: 'der', type: 'spki' }),
        padding: constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256',
        oaepLabel: Buffer.from(BACKUP_KEY_LABEL, 'utf8')
      },
      backupKey
    ).toString('base64')
  }))
  if (entries.length === 0) throw new AppError('VALIDATION', 'Brak aktywnego administratora z kluczami: kopii nie da się zabezpieczyć')
  return entries
}

export interface BackupWriteResult {
  sizeBytes: number
  sha256: string
  manifest: BackupManifest
}

/**
 * Zapisuje kopię do `path` (plik tymczasowy zamienia się w docelowy dopiero po zapisie całości; tę zamianę robi wołający).
 * Cała baza czytana w jednej transakcji z migawką (spójny obraz), partiami po `ROWS_PER_FRAME` wierszy.
 */
export async function writeBackupFile(
  db: Db,
  opts: { path: string; attachmentsDir: string | null; programVersion: string; migrations: number; now: Date }
): Promise<BackupWriteResult> {
  const backupKey = randomBytes(32)
  const hash = createHash('sha256')
  let size = 0
  const tracker = new Transform({
    transform(chunk: Buffer, _e, cb) {
      hash.update(chunk)
      size += chunk.length
      cb(null, chunk)
    }
  })
  const manifest: BackupManifest = { tables: {}, files: 0, filesMissing: 0, fileBytes: 0 }

  await db.transaction(
    async (tx) => {
      const header: BackupHeader = {
        format: BACKUP_FORMAT_VERSION,
        programVersion: opts.programVersion,
        migrations: opts.migrations,
        createdAt: opts.now.toISOString(),
        segmentBytes: BACKUP_SEGMENT_BYTES,
        admins: await adminEntries(tx, backupKey)
      }
      const headerBytes = Buffer.from(JSON.stringify(header), 'utf8')
      const headerHash = createHash('sha256').update(headerBytes).digest('hex')
      const prefix = Buffer.alloc(12)
      prefix.write(BACKUP_MAGIC, 0, 'ascii')
      prefix.writeUInt32BE(headerBytes.length, 8)
      tracker.write(Buffer.concat([prefix, headerBytes]))

      const storageKeys: string[] = []
      async function* frames() {
        for (const table of backupTables()) {
          const { name } = getTableConfig(table)
          const columns = Object.entries(getTableColumns(table)) as [string, AnyMySqlColumn][]
          const pk = primaryKeyOf(table)
          let after: unknown = null
          let total = 0
          for (;;) {
            const where: SQL | undefined = after === null ? undefined : gt(pk, after)
            const rows = (await tx.select().from(table).where(where).orderBy(asc(pk)).limit(ROWS_PER_FRAME)) as Record<string, unknown>[]
            if (rows.length === 0) break
            // Klucze w pliku to nazwy kolumn w bazie (stabilniejsze niż nazwy pól w kodzie).
            const out = rows.map((r) => Object.fromEntries(columns.map(([prop, col]) => [col.name, r[prop]])))
            yield jsonFrame(FRAME_TABLE, { t: name, rows: out })
            if (name === 'attachments') for (const r of rows) storageKeys.push(String(r.storageKey))
            total += rows.length
            after = rows[rows.length - 1]![columns.find(([, c]) => c === pk)![0]]
          }
          manifest.tables[name] = total
        }
        for (const key of storageKeys) {
          const info = opts.attachmentsDir ? await stat(join(opts.attachmentsDir, key)).catch(() => null) : null
          if (!info) {
            manifest.filesMissing++
            continue
          }
          yield jsonFrame(FRAME_FILE_START, { name: key, bytes: info.size })
          let sent = 0
          for await (const part of createReadStream(join(opts.attachmentsDir!, key), { highWaterMark: FILE_FRAME_BYTES })) {
            sent += (part as Buffer).length
            yield frame(FRAME_FILE_DATA, part as Buffer)
          }
          if (sent !== info.size) throw new Error('Plik załącznika zmienił rozmiar w trakcie kopii')
          manifest.files++
          manifest.fileBytes += sent
        }
        yield jsonFrame(FRAME_MANIFEST, manifest)
      }

      await pipeline(
        Readable.from(frames()),
        createGzip(),
        new SegmentEncryptor(backupKey, headerHash),
        tracker,
        createWriteStream(opts.path, { flags: 'wx', mode: 0o600 })
      )
    },
    { isolationLevel: 'repeatable read', withConsistentSnapshot: true }
  )
  backupKey.fill(0)
  return { sizeBytes: size, sha256: hash.digest('hex'), manifest }
}
