// Testy kopii zapasowych (ZADANIE_04, krok 1). Wymaga lokalnej bazy testowej (zob. testDb.ts). Dane wyłącznie fikcyjne.
// Plik kopii odszyfrowujemy tu niezależnym kodem (node:crypto), tak jak zrobi to przeglądarka (krok 2).
import { createDecipheriv, createHash, generateKeyPairSync, privateDecrypt, randomBytes, randomUUID, constants } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { eq } from 'drizzle-orm'
import { getTableConfig } from 'drizzle-orm/mysql-core'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  BACKUP_IV_BYTES,
  BACKUP_KEY_LABEL,
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
import { buildApp } from '../app'
import type { Db } from '../db/connection'
import { accessLog, attachments, backups, orgKeys } from '../db/schema'
import { openTestDb } from '../testDb'
import { TEST_APP_SECRET, addTestUser, sessionCookieFor, wipeAccounts } from '../auth/testkit'
import { AppError } from '@shared/errors'
import { BACKUP_EXCLUDED_TABLES, backupTables } from './backupExport'
import { BACKUP_INTERVAL_MS, backupFilePath, listBackups, rotateBackups, runBackupCheck, startBackup, writeErasedList } from './backups'

let db: Db
let close: () => Promise<void>
let dir: string
const keys = generateKeyPairSync('rsa', { modulusLength: 2048 })
const publicKey = keys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64')

beforeAll(async () => {
  const o = await openTestDb()
  db = o.db
  close = o.close
  dir = await mkdtemp(join(tmpdir(), 'ngo-crm-backup-test-'))
})
afterAll(async () => {
  await wipeAll()
  await rm(dir, { recursive: true, force: true })
  await close?.()
})

async function wipeAll() {
  await db.delete(backups)
  await db.delete(attachments)
  await wipeAccounts(db)
}
beforeEach(async () => {
  await wipeAll()
  await rm(join(dir, 'backups'), { recursive: true, force: true })
  await rm(join(dir, 'attachments'), { recursive: true, force: true })
})

async function addAdmin() {
  const admin = await addTestUser(db, { role: 'admin', publicKey })
  // wersja klucza organizacji: załączniki odwołują się do niej kluczem obcym
  await db.insert(orgKeys).values({ version: 1, createdAt: new Date(), createdBy: admin.id })
  return admin
}

/** Odszyfrowanie pliku kopii kluczem prywatnym administratora (jak w przeglądarce). Zwraca ramki. */
function decode(file: Buffer, privateKey = keys.privateKey, tamper?: (segments: Buffer[]) => Buffer[]) {
  expect(file.subarray(0, 8).toString('ascii')).toBe(BACKUP_MAGIC)
  const headerLen = file.readUInt32BE(8)
  const headerBytes = file.subarray(12, 12 + headerLen)
  const header = JSON.parse(headerBytes.toString('utf8')) as BackupHeader
  const headerHash = createHash('sha256').update(headerBytes).digest('hex')
  const backupKey = privateDecrypt(
    { key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256', oaepLabel: Buffer.from(BACKUP_KEY_LABEL, 'utf8') },
    Buffer.from(header.admins[0]!.wrappedKey, 'base64')
  )
  let segments: Buffer[] = []
  for (let off = 12 + headerLen; off < file.length; ) {
    const len = file.readUInt32BE(off)
    segments.push(file.subarray(off + 4, off + 4 + len))
    off += 4 + len
  }
  if (tamper) segments = tamper(segments)
  const plain = segments.map((body, i) => {
    const iv = body.subarray(0, BACKUP_IV_BYTES)
    const tag = body.subarray(body.length - BACKUP_TAG_BYTES)
    const d = createDecipheriv('aes-256-gcm', backupKey, iv)
    d.setAAD(Buffer.from(segmentAad(headerHash, i, i === segments.length - 1), 'utf8'))
    d.setAuthTag(tag)
    return Buffer.concat([d.update(body.subarray(BACKUP_IV_BYTES, body.length - BACKUP_TAG_BYTES)), d.final()])
  })
  const stream = gunzipSync(Buffer.concat(plain))
  const frames: { kind: number; data: Buffer }[] = []
  for (let off = 0; off < stream.length; ) {
    const len = stream.readUInt32BE(off + 1)
    frames.push({ kind: stream.readUInt8(off), data: stream.subarray(off + 5, off + 5 + len) })
    off += 5 + len
  }
  return { header, frames }
}

const json = (b: Buffer) => JSON.parse(b.toString('utf8'))

async function makeBackup(now = new Date()) {
  const { id, done } = await startBackup(db, { storageDir: dir, kind: 'manual', userId: null, now })
  await done
  return id
}

describe('zawartość i szyfrowanie', () => {
  it('kopia zawiera tabele, załączniki i zestawienie; odszyfrowuje ją klucz administratora', async () => {
    const admin = await addAdmin()
    const storageKey = randomBytes(16).toString('hex')
    const content = randomBytes(300_000) // kilka ramek pliku
    await mkdir(join(dir, 'attachments'), { recursive: true })
    await writeFile(join(dir, 'attachments', storageKey), content)
    const at = new Date()
    await db.insert(attachments).values({
      id: randomUUID(),
      createdAt: at,
      updatedAt: at,
      updatedBy: admin.id,
      version: 1,
      targetType: 'contact',
      targetId: randomUUID(),
      purpose: 'document',
      keyVersion: 1,
      metaEnc: 'bWV0YQ==',
      sizeBytes: content.length,
      storageKey
    })
    const id = await makeBackup()
    const file = await readFile(backupFilePath(dir, id))
    const { header, frames } = decode(file)

    expect(header.admins).toHaveLength(1)
    expect(header.admins[0]).toMatchObject({ userId: admin.id, kdfIterations: 600_000 })
    expect(JSON.stringify(header)).not.toContain(admin.email) // jawnego e-maila w nagłówku nie ma

    const manifest = json(frames.at(-1)!.data) as BackupManifest
    expect(frames.at(-1)!.kind).toBe(FRAME_MANIFEST)
    expect(manifest.tables.users).toBe(1)
    expect(manifest.tables.attachments).toBe(1)
    expect(manifest.files).toBe(1)
    expect(manifest.fileBytes).toBe(content.length)

    const usersRows = frames.filter((f) => f.kind === FRAME_TABLE).map((f) => json(f.data)).filter((f) => f.t === 'users')
    expect(usersRows[0].rows[0]).toMatchObject({ id: admin.id, email: admin.email, role: 'admin' })

    const start = frames.findIndex((f) => f.kind === FRAME_FILE_START)
    expect(json(frames[start]!.data)).toEqual({ name: storageKey, bytes: content.length })
    const data = Buffer.concat(frames.filter((f) => f.kind === FRAME_FILE_DATA).map((f) => f.data))
    expect(data.equals(content)).toBe(true)

    const [row] = await db.select().from(backups).where(eq(backups.id, id))
    expect(row).toMatchObject({ status: 'done', runningLock: null, sizeBytes: file.length })
    expect(row!.sha256).toBe(createHash('sha256').update(file).digest('hex'))
  })

  it('tabele wyłączone z kopii (sesje, zaproszenia, sama kopia) nie trafiają do pliku, reszta tak', async () => {
    await addAdmin()
    const { frames } = decode(await readFile(backupFilePath(dir, await makeBackup())))
    const names = Object.keys((json(frames.at(-1)!.data) as BackupManifest).tables)
    for (const t of BACKUP_EXCLUDED_TABLES) expect(names).not.toContain(t)
    expect(names).toEqual(backupTables().map((t) => getTableConfig(t).name))
    expect(names).toEqual(expect.arrayContaining(['users', 'key_slots', 'org_keys', 'access_log', 'erased_contacts', 'contact_sensitive']))
  })

  it('inny klucz prywatny nie odwinie klucza kopii', async () => {
    await addAdmin()
    const file = await readFile(backupFilePath(dir, await makeBackup()))
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 })
    expect(() => decode(file, other.privateKey)).toThrow()
  })

  it('wykrywa zmianę bajtu, obcięcie i przestawienie segmentów', async () => {
    await addAdmin()
    // Dużo danych, żeby segmentów było kilka (losowe bajty słabo się kompresują).
    await mkdir(join(dir, 'attachments'), { recursive: true })
    const at = new Date()
    for (let i = 0; i < 3; i++) {
      const storageKey = randomBytes(16).toString('hex')
      await writeFile(join(dir, 'attachments', storageKey), randomBytes(3_000_000))
      await db.insert(attachments).values({ id: randomUUID(), createdAt: at, updatedAt: at, updatedBy: randomUUID(), version: 1, targetType: 'contact', targetId: randomUUID(), purpose: 'document', keyVersion: 1, metaEnc: 'bQ==', sizeBytes: 3_000_000, storageKey })
    }
    const file = await readFile(backupFilePath(dir, await makeBackup()))
    expect(() => decode(file)).not.toThrow()
    let count = 0
    decode(file, keys.privateKey, (s) => ((count = s.length), s))
    expect(count).toBeGreaterThan(2)

    expect(() => decode(file, keys.privateKey, (s) => s.slice(0, -1))).toThrow() // obcięty koniec
    expect(() => decode(file, keys.privateKey, (s) => [s[1]!, s[0]!, ...s.slice(2)])).toThrow() // zamiana kolejności
    expect(() =>
      decode(file, keys.privateKey, (s) => {
        const copy = s.map((b) => Buffer.from(b))
        copy[0]![20] = copy[0]![20]! ^ 1
        return copy
      })
    ).toThrow() // zmiana bajtu
  })
})

describe('blokada, rotacja, harmonogram', () => {
  it('bez STORAGE_DIR kopia nie powstaje', async () => {
    await expect(startBackup(db, { kind: 'manual', userId: null, now: new Date() })).rejects.toMatchObject({ code: 'VALIDATION' })
  })

  it('bez aktywnego administratora z kluczami kopia kończy się błędem i nie zostawia pliku ani blokady', async () => {
    await addTestUser(db, { role: 'staff', publicKey })
    const { id, done } = await startBackup(db, { storageDir: dir, kind: 'manual', userId: null, now: new Date() })
    await done
    const [row] = await db.select().from(backups).where(eq(backups.id, id))
    expect(row).toMatchObject({ status: 'failed', runningLock: null })
    await expect(stat(backupFilePath(dir, id))).rejects.toThrow()
    await expect(stat(`${backupFilePath(dir, id)}.tmp`)).rejects.toThrow()
    await makeBackup() // blokada zwolniona: kolejna próba jest możliwa
  })

  it('dwie kopie naraz: druga odmawia; przeterminowana „trwająca” nie blokuje', async () => {
    await addAdmin()
    const now = new Date()
    const first = await startBackup(db, { storageDir: dir, kind: 'manual', userId: null, now })
    const second = await startBackup(db, { storageDir: dir, kind: 'manual', userId: null, now }).catch((e) => e)
    expect(second).toBeInstanceOf(AppError)
    await first.done
    // sztuczna zawieszona kopia sprzed 31 minut
    await db.insert(backups).values({ id: randomUUID(), startedAt: new Date(now.getTime() - 31 * 60_000), status: 'running', kind: 'auto', runningLock: 'running', programVersion: '0', migrations: 0 })
    const third = await startBackup(db, { storageDir: dir, kind: 'auto', userId: null, now })
    await third.done
    expect((await listBackups(db)).filter((b) => b.status === 'running')).toHaveLength(0)
  })

  it('rotacja: 7 ostatnich dób + 4 tygodnie, reszta traci plik, wiersz dostaje „removed”', async () => {
    await mkdir(join(dir, 'backups'), { recursive: true })
    const base = Date.UTC(2026, 10, 15, 3, 0, 0) // 15.11.2026 (niedziela)
    const ids: string[] = []
    // jedna kopia dziennie przez 60 dób
    for (let d = 0; d < 60; d++) {
      const id = randomUUID()
      ids.push(id)
      await writeFile(backupFilePath(dir, id), 'x')
      await db.insert(backups).values({ id, startedAt: new Date(base - d * 86_400_000), finishedAt: new Date(base - d * 86_400_000), status: 'done', kind: 'auto', programVersion: '0', migrations: 0 })
    }
    const removed = await rotateBackups(db, dir)
    const kept = (await listBackups(db)).length
    expect(kept).toBe(7 + 4)
    expect(removed).toBe(60 - 11)
    // najnowsze 7 zostało
    for (const id of ids.slice(0, 7)) await expect(stat(backupFilePath(dir, id))).resolves.toBeTruthy()
    await expect(stat(backupFilePath(dir, ids[59]!))).rejects.toThrow()
    const [gone] = await db.select().from(backups).where(eq(backups.id, ids[59]!))
    expect(gone!.status).toBe('removed')
  })

  it('harmonogram: bez STORAGE_DIR i bez kont nic; świeża kopia nic; po dobie startuje automatyczna', async () => {
    const now = new Date()
    expect(await runBackupCheck(db, { now })).toBeNull() // brak STORAGE_DIR
    expect(await runBackupCheck(db, { storageDir: dir, now })).toBeNull() // brak kont (kreator)
    await addAdmin()
    const first = await runBackupCheck(db, { storageDir: dir, now })
    expect(first).not.toBeNull()
    await first!.done
    expect(await runBackupCheck(db, { storageDir: dir, now: new Date(now.getTime() + BACKUP_INTERVAL_MS - 60_000) })).toBeNull()
    const next = await runBackupCheck(db, { storageDir: dir, now: new Date(now.getTime() + BACKUP_INTERVAL_MS + 60_000) })
    expect(next).not.toBeNull()
    await next!.done
    const list = await listBackups(db)
    expect(list.filter((b) => b.status === 'done' && b.kind === 'auto')).toHaveLength(2)
  })

  it('lista usunięć z anonimizacji trafia do pliku poza bazą (D5)', async () => {
    await addAdmin()
    await makeBackup()
    expect(JSON.parse(await readFile(join(dir, 'erased_contacts.json'), 'utf8'))).toEqual([])
    await writeErasedList(db, dir)
    expect(JSON.parse(await readFile(join(dir, 'erased_contacts.json'), 'utf8'))).toEqual([])
  })
})

describe('pobieranie i RPC', () => {
  const HOST = 'crm.example.org'
  const hdr = { host: HOST, 'x-forwarded-proto': 'https', origin: `https://${HOST}`, 'x-ngo-crm': '1' }
  const opts = () => ({ appSecret: TEST_APP_SECRET, storageDir: dir })

  async function appWith() {
    // sesje z bazy (prawdziwe ciasteczka), jak na produkcji
    const { dbSessions } = await import('../auth/sessions')
    return buildApp(db, [], dbSessions(db), opts())
  }

  it('administrator pobiera kopię (bajty bez zmian, wpis w dzienniku i znacznik pobrania); pracownik i brak sesji nie', async () => {
    const admin = await addAdmin()
    const staff = await addTestUser(db, { role: 'staff' })
    const id = await makeBackup()
    const app = await appWith()
    const adminCookie = await sessionCookieFor(db, admin.id)
    const staffCookie = await sessionCookieFor(db, staff.id)

    const ok = await app.inject({ method: 'GET', url: `/api/backups/${id}`, headers: { ...hdr, cookie: adminCookie } })
    expect(ok.statusCode).toBe(200)
    expect(ok.headers['content-disposition']).toMatch(/^attachment; filename="ngo-crm-kopia-\d{4}-\d{2}-\d{2}\.ngb"$/)
    expect(ok.headers['cache-control']).toBe('no-store')
    expect(ok.rawPayload.equals(await readFile(backupFilePath(dir, id)))).toBe(true)

    const [row] = await db.select().from(backups).where(eq(backups.id, id))
    expect(row!.downloadedAt).not.toBeNull()
    const log = await db.select().from(accessLog).where(eq(accessLog.action, 'backup_download'))
    expect(log).toHaveLength(1)
    expect(log[0]).toMatchObject({ userId: admin.id, targetType: 'backup', targetId: id })

    expect((await app.inject({ method: 'GET', url: `/api/backups/${id}`, headers: { ...hdr, cookie: staffCookie } })).statusCode).toBe(403)
    expect((await app.inject({ method: 'GET', url: `/api/backups/${id}`, headers: hdr })).statusCode).toBe(401)
    expect((await app.inject({ method: 'GET', url: `/api/backups/nie-uuid`, headers: { ...hdr, cookie: adminCookie } })).statusCode).toBe(404)
    await app.close()
  })

  it('kopia w toku albo nieudana nie jest do pobrania', async () => {
    const admin = await addAdmin()
    const id = randomUUID()
    await db.insert(backups).values({ id, startedAt: new Date(), status: 'running', kind: 'auto', runningLock: 'running', programVersion: '0', migrations: 0 })
    const app = await appWith()
    const cookie = await sessionCookieFor(db, admin.id)
    expect((await app.inject({ method: 'GET', url: `/api/backups/${id}`, headers: { ...hdr, cookie } })).statusCode).toBe(404)
    await app.close()
  })

  it('backups.create zwraca id od razu, wpis w dzienniku; backups.list pokazuje kopię', async () => {
    const admin = await addAdmin()
    const app = await appWith()
    const cookie = await sessionCookieFor(db, admin.id)
    const rpc = async (method: string) => (await app.inject({ method: 'POST', url: '/api/rpc', headers: { ...hdr, cookie }, payload: { method } })).json() as { ok: boolean; data?: any; code?: string }
    const created = await rpc('backups.create')
    expect(created.ok).toBe(true)
    // czekamy aż kopia się skończy (działa w tle)
    for (let i = 0; i < 100; i++) {
      const l = await rpc('backups.list')
      if (l.data[0]?.status !== 'running') break
      await new Promise((r) => setTimeout(r, 100))
    }
    const list = await rpc('backups.list')
    expect(list.data[0]).toMatchObject({ id: created.data.id, status: 'done', kind: 'manual', downloadedAt: null })
    expect(list.data[0].sizeBytes).toBeGreaterThan(0)
    const log = await db.select().from(accessLog).where(eq(accessLog.action, 'backup_create'))
    expect(log[0]).toMatchObject({ userId: admin.id, targetType: 'backup', targetId: created.data.id })
    await app.close()
  })

  it('bez STORAGE_DIR backups.create odmawia po polsku', async () => {
    const admin = await addAdmin()
    const { dbSessions } = await import('../auth/sessions')
    const app = buildApp(db, [], dbSessions(db), { appSecret: TEST_APP_SECRET })
    const cookie = await sessionCookieFor(db, admin.id)
    const r = await app.inject({ method: 'POST', url: '/api/rpc', headers: { ...hdr, cookie }, payload: { method: 'backups.create' } })
    expect(r.statusCode).toBe(400)
    expect(r.json().message).toMatch(/STORAGE_DIR/)
    await app.close()
  })
})
