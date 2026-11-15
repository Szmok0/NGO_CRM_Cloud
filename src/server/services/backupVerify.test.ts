// „Sprawdź kopię” (ZADANIE_04, krok 2): moduł klienta czyta prawdziwy plik kopii z serwera. Dane wyłącznie fikcyjne.
// Konto administratora ma prawdziwe klucze (jak po założeniu w przeglądarce), więc sprawdzamy całą drogę hasło → klucz → kopia.
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { BackupError, verifyBackup, type BackupProblem } from '../../client/crypto/backupRead'
import { deriveKeys } from '../../client/crypto/kdf'
import { exportPublicKey, generateUserKeyPair, wrapPrivateKey } from '../../client/crypto/keys'
import { buildApp } from '../app'
import { TEST_APP_SECRET, addTestUser, sessionCookieFor, wipeAccounts } from '../auth/testkit'
import type { Db } from '../db/connection'
import { accessLog, actions, attachments, backups, contacts, orgKeys } from '../db/schema'
import { openTestDb } from '../testDb'
import { backupFilePath, startBackup } from './backups'

let db: Db
let close: () => Promise<void>
let dir: string
const ITER = 2000
const PASSWORD = 'Fikcyjne-hasło-do-testów-1'

beforeAll(async () => {
  const o = await openTestDb()
  db = o.db
  close = o.close
  dir = await mkdtemp(join(tmpdir(), 'ngo-crm-verify-test-'))
})
afterAll(async () => {
  await wipeAll()
  await rm(dir, { recursive: true, force: true })
  await close?.()
})
async function wipeAll() {
  await db.delete(backups)
  await db.delete(attachments)
  await db.delete(actions)
  await db.delete(contacts)
  await wipeAccounts(db)
}
beforeEach(async () => {
  await wipeAll()
  await rm(join(dir, 'backups'), { recursive: true, force: true })
  await rm(join(dir, 'attachments'), { recursive: true, force: true })
})

/** Administrator z prawdziwymi kluczami (hasło `password`). */
async function addRealAdmin(password = PASSWORD) {
  const admin = await addTestUser(db, { role: 'admin' })
  await db.insert(orgKeys).values({ version: 1, createdAt: new Date(), createdBy: admin.id })
  await setPassword(admin.id, password)
  return admin
}
async function setPassword(userId: string, password: string, existing?: CryptoKeyPair) {
  const pair = existing ?? (await generateUserKeyPair())
  const salt = randomBytes(16)
  const { wrapKey } = await deriveKeys(password, new Uint8Array(salt), ITER)
  const { users } = await import('../db/schema')
  await db
    .update(users)
    .set({ kdfSalt: salt.toString('base64'), kdfIterations: ITER, publicKey: await exportPublicKey(pair.publicKey), privateKeyEnc: await wrapPrivateKey(pair.privateKey, wrapKey, userId) })
    .where(eq(users.id, userId))
  return pair
}

async function fillData(adminId: string) {
  const at = new Date()
  const base = { createdAt: at, updatedAt: at, updatedBy: adminId, version: 1 }
  const c = (kind: string, deletedAt: Date | null = null) => ({ ...base, id: randomUUID(), kind, tags: [], deletedAt })
  await db.insert(contacts).values([c('person'), c('person'), c('institution'), c('person', at)])
  await db.insert(actions).values({ ...base, id: randomUUID(), type: 'training', framework: 'project', title: 'Szkolenie próbne', status: 'planned' })
  const storageKey = randomBytes(16).toString('hex')
  const content = randomBytes(10_000)
  await mkdir(join(dir, 'attachments'), { recursive: true })
  await writeFile(join(dir, 'attachments', storageKey), content)
  await db.insert(attachments).values({ ...base, id: randomUUID(), targetType: 'contact', targetId: randomUUID(), purpose: 'document', keyVersion: 1, metaEnc: 'bQ==', sizeBytes: content.length, storageKey })
  return content.length
}

async function makeBackupFile(now = new Date()) {
  const { id, done } = await startBackup(db, { storageDir: dir, kind: 'manual', userId: null, now })
  await done
  return { id, file: await readFile(backupFilePath(dir, id)), now }
}
const blob = (b: Buffer | Uint8Array) => new Blob([new Uint8Array(b)])
const problem = async (p: Promise<unknown>): Promise<BackupProblem | 'no error'> => p.then(() => 'no error' as const, (e) => (e instanceof BackupError ? e.code : (`inny błąd: ${e}` as never)))

describe('Sprawdź kopię (moduł klienta)', () => {
  it('dobra kopia: liczby zgadzają się z danymi, e-mail bez względu na wielkość liter', async () => {
    const admin = await addRealAdmin()
    const bytes = await fillData(admin.id)
    const { file } = await makeBackupFile()
    const s = await verifyBackup(blob(file), `  ${admin.email.toUpperCase()} `, PASSWORD)
    expect(s).toMatchObject({ persons: 2, institutions: 1, actions: 1, documents: 1, files: 1, fileBytes: bytes, filesMissing: 0 })
  })

  it('złe hasło i zły e-mail → komunikaty, nic nie jest odszyfrowane', async () => {
    const admin = await addRealAdmin()
    const { file } = await makeBackupFile()
    expect(await problem(verifyBackup(blob(file), admin.email, 'zupełnie-inne-hasło'))).toBe('wrong_password')
    expect(await problem(verifyBackup(blob(file), 'ktos@example.invalid', PASSWORD))).toBe('no_account')
  })

  it('uszkodzony plik: zmieniony bajt, obcięcie, śmieci, nie-kopia', async () => {
    const admin = await addRealAdmin()
    await fillData(admin.id)
    const { file } = await makeBackupFile()
    const open = (b: Buffer | Uint8Array) => problem(verifyBackup(blob(b), admin.email, PASSWORD))

    const flipped = Buffer.from(file)
    flipped[file.length - 30] ^= 1
    expect(await open(flipped)).toBe('corrupt')
    expect(await open(file.subarray(0, file.length - 10))).toBe('corrupt')
    expect(await open(file.subarray(0, 30))).toBe('corrupt')
    const headerLen = file.readUInt32BE(8)
    expect(await open(file.subarray(0, 12 + headerLen))).toBe('corrupt') // sam nagłówek, bez treści
    expect(await open(Buffer.concat([file, Buffer.from([1, 2, 3, 4, 5])]))).toBe('corrupt') // doklejone śmieci
    expect(await open(Buffer.from('to na pewno nie jest kopia zapasowa'))).toBe('not_backup')
    expect(await open(Buffer.alloc(0))).toBe('not_backup')
    const badHeader = Buffer.from(file)
    badHeader[20] ^= 1 // nagłówek jest w AAD każdego segmentu
    expect(['corrupt', 'no_account', 'wrong_password']).toContain(await open(badHeader))
  })

  it('kopia sprzed zmiany hasła: otwiera ją stare hasło, nowe nie; nowsza kopia nowe', async () => {
    const admin = await addRealAdmin()
    const pair = await setPassword(admin.id, PASSWORD)
    const before = await makeBackupFile(new Date(Date.now() - 60_000))
    await setPassword(admin.id, 'Nowe-hasło-po-zmianie-2', pair)
    const after = await makeBackupFile()
    expect((await verifyBackup(blob(before.file), admin.email, PASSWORD)).persons).toBe(0)
    expect(await problem(verifyBackup(blob(before.file), admin.email, 'Nowe-hasło-po-zmianie-2'))).toBe('wrong_password')
    expect(await problem(verifyBackup(blob(after.file), admin.email, PASSWORD))).toBe('wrong_password')
    expect((await verifyBackup(blob(after.file), admin.email, 'Nowe-hasło-po-zmianie-2')).persons).toBe(0)
  })

  it('kopia z nowszą wersją formatu → osobny komunikat', async () => {
    const admin = await addRealAdmin()
    const { file } = await makeBackupFile()
    const headerLen = file.readUInt32BE(8)
    const header = JSON.parse(file.subarray(12, 12 + headerLen).toString('utf8'))
    header.format = 99
    const newHeader = Buffer.from(JSON.stringify(header))
    const prefix = Buffer.from(file.subarray(0, 12))
    prefix.writeUInt32BE(newHeader.length, 8)
    expect(await problem(verifyBackup(blob(Buffer.concat([prefix, newHeader, file.subarray(12 + headerLen)])), admin.email, PASSWORD))).toBe('newer_format')
  })
})

describe('backups.markTested', () => {
  const HOST = 'crm.example.org'
  const hdr = { host: HOST, 'x-forwarded-proto': 'https', origin: `https://${HOST}`, 'x-ngo-crm': '1' }

  it('zapisuje wynik przy kopii o tej dacie, wpis w dzienniku; obca kopia nic nie zapisuje; pracownik nie może', async () => {
    const admin = await addRealAdmin()
    const staff = await addTestUser(db, { role: 'staff' })
    const { id, now } = await makeBackupFile()
    const { dbSessions } = await import('../auth/sessions')
    const app = buildApp(db, [], dbSessions(db), { appSecret: TEST_APP_SECRET, storageDir: dir })
    const adminCookie = await sessionCookieFor(db, admin.id)
    const rpc = async (cookie: string, createdAt: string) =>
      app.inject({ method: 'POST', url: '/api/rpc', headers: { ...hdr, cookie }, payload: { method: 'backups.markTested', params: { createdAt, result: 'Kopia z 15.11.2026: 0 osób. Da się ją odtworzyć.' } } })

    const ok = await rpc(adminCookie, now.toISOString())
    expect(ok.json()).toMatchObject({ ok: true, data: { matched: true } })
    const [row] = await db.select().from(backups).where(eq(backups.id, id))
    expect(row!.restoreTestedAt).not.toBeNull()
    expect(row!.restoreTestResult).toMatch(/Da się ją odtworzyć/)
    expect(await db.select().from(accessLog).where(eq(accessLog.action, 'backup_verify'))).toHaveLength(1)

    const foreign = await rpc(adminCookie, new Date(now.getTime() + 5000).toISOString())
    expect(foreign.json()).toMatchObject({ ok: true, data: { matched: false } })
    expect(await db.select().from(accessLog).where(eq(accessLog.action, 'backup_verify'))).toHaveLength(1)

    expect((await rpc(await sessionCookieFor(db, staff.id), now.toISOString())).statusCode).toBe(403)
    await app.close()
  })
})

