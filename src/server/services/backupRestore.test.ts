// Odtworzenie z kopii w kreatorze (ZADANIE_04, krok 3; D5, D6) przez HTTP na lokalnej bazie testowej.
// Pełny cykl: dane → kopia → pusta baza → odtworzenie → logowanie tym samym hasłem → dane wrażliwe → usunięcia z D5.
// Wszystko fikcyjne. Test zostawia bazę pustą (inne pliki testów zakładają pustą tabelę użytkowników).
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { and, eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { openBackup } from '../../client/crypto/backupRead'
import { deriveKeys } from '../../client/crypto/kdf'
import { createSlot, exportPublicKey, generateOrgKey, generateUserKeyPair, openSlot, unwrapPrivateKey, wrapPrivateKey } from '../../client/crypto/keys'
import { decryptSensitive, emptySensitive, encryptSensitive } from '../../client/crypto/sensitive'
import { toBase64 } from '../../client/crypto/encoding'
import { buildApp } from '../app'
import { hashAuthKey } from '../auth/password'
import { dbSessions } from '../auth/sessions'
import { TEST_SCRYPT, addTestUser, wipeAccounts } from '../auth/testkit'
import type { Db } from '../db/connection'
import { accessLog, actions, attachments, backups, contactIdentity, contactSensitive, contacts, erasedContacts, keySlots, users } from '../db/schema'
import { openTestDb } from '../testDb'
import { anonymizeContact } from './anonymize'
import { backupTables, writeBackupFile } from './backupExport'
import { assertDatabaseEmpty, insertRows, restoreBackup, restoreDir } from './backupRestore'
import { backupFilePath, startBackup } from './backups'

const APP_SECRET = 'testowy-sekret-aplikacji-tylko-do-testow-0123456789'
const OTHER_SECRET = 'zupelnie-inny-sekret-serwera-tylko-do-testow-9876543210'
const TOKEN = 'testowy-token-kreatora-0123456789-abcdefghij'
const HOST = 'crm.example.org'
const headers = { host: HOST, 'x-forwarded-proto': 'https', origin: `https://${HOST}`, 'x-ngo-crm': '1', 'x-forwarded-for': '198.51.100.31' }
const ITER = 2000
const PASSWORD = 'Fikcyjne-hasło-do-testów-1'

let db: Db
let close: () => Promise<void>
let dir: string

beforeAll(async () => {
  const o = await openTestDb()
  db = o.db
  close = o.close
  dir = await mkdtemp(join(tmpdir(), 'ngo-crm-restore-test-'))
})
afterAll(async () => {
  await wipeEverything()
  await rm(dir, { recursive: true, force: true })
  await close?.()
})
beforeEach(async () => {
  await wipeEverything()
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true })
})

/** Czyści wszystkie tabele kopii (kolejność alfabetyczna, więc na czas czyszczenia bez kluczy obcych). */
async function wipeEverything() {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SET FOREIGN_KEY_CHECKS = 0`)
    for (const t of backupTables()) await tx.delete(t)
    await tx.execute(sql`SET FOREIGN_KEY_CHECKS = 1`)
  })
  await wipeAccounts(db)
  await db.delete(backups)
}

interface Scenario {
  adminId: string
  email: string
  authKey: string
  personA: string
  personB: string
  attachment: { storageKey: string; content: Buffer }
  file: Buffer
  key: string
}

/** Administrator z prawdziwymi kluczami, dwie osoby (A z danymi wrażliwymi, B do anonimizacji po kopii), załącznik, kopia. */
async function makeScenario(): Promise<Scenario> {
  const admin = await addTestUser(db, { role: 'admin' })
  const pair = await generateUserKeyPair()
  const salt = randomBytes(16)
  const { wrapKey, authKey } = await deriveKeys(PASSWORD, new Uint8Array(salt), ITER)
  await db
    .update(users)
    .set({
      kdfSalt: salt.toString('base64'),
      kdfIterations: ITER,
      publicKey: await exportPublicKey(pair.publicKey),
      privateKeyEnc: await wrapPrivateKey(pair.privateKey, wrapKey, admin.id),
      authHash: await hashAuthKey(authKey, TEST_SCRYPT)
    })
    .where(eq(users.id, admin.id))
  const at = new Date()
  const base = { createdAt: at, updatedAt: at, updatedBy: admin.id, version: 1 }
  const { orgKeys } = await import('../db/schema')
  await db.insert(orgKeys).values({ version: 1, createdAt: at, createdBy: admin.id })
  const orgKey = await generateOrgKey()
  await db.insert(keySlots).values({ id: randomUUID(), userId: admin.id, keyVersion: 1, wrappedKey: await createSlot(orgKey, pair.publicKey, 1), grantedBy: admin.id, grantedAt: at })

  const personA = randomUUID()
  const personB = randomUUID()
  await db.insert(contacts).values([
    { ...base, id: personA, kind: 'person', tags: [] },
    { ...base, id: personB, kind: 'person', tags: [] }
  ])
  await db.insert(contactIdentity).values([
    { ...base, id: randomUUID(), contactId: personA, firstName: 'Ala', lastName: 'Przykładowa' },
    { ...base, id: randomUUID(), contactId: personB, firstName: 'Bolesław', lastName: 'Fikcyjny', email: 'b@example.invalid' }
  ])
  const enc = await encryptSensitive({ ...emptySensitive(), notes: 'fikcyjna notatka wrażliwa' }, orgKey, personA, 1)
  await db.insert(contactSensitive).values({ ...base, id: randomUUID(), contactId: personA, keyVersion: 1, iv: enc.iv, ciphertext: enc.ciphertext })
  await db.insert(actions).values({ ...base, id: randomUUID(), type: 'training', framework: 'project', title: 'Szkolenie próbne', status: 'planned' })

  const storageKey = randomBytes(16).toString('hex')
  const content = randomBytes(150_000)
  await mkdir(join(dir, 'attachments'), { recursive: true })
  await writeFile(join(dir, 'attachments', storageKey), content)
  await db.insert(attachments).values({ ...base, id: randomUUID(), targetType: 'contact', targetId: personA, purpose: 'document', keyVersion: 1, metaEnc: 'bQ==', sizeBytes: content.length, storageKey })

  const { id, done } = await startBackup(db, { storageDir: dir, kind: 'manual', userId: null, now: new Date() })
  await done
  const file = await readFile(backupFilePath(dir, id))
  // klucz kopii odwija przeglądarka (tu: ten sam moduł klienta) hasłem administratora
  const opened = await openBackup(new Blob([new Uint8Array(file)]), admin.email, PASSWORD, true)
  const key = toBase64(await crypto.subtle.exportKey('raw', opened.key))
  return { adminId: admin.id, email: admin.email, authKey, personA, personB, attachment: { storageKey, content }, file, key }
}

type App = ReturnType<typeof buildApp>
const makeApp = (appSecret = APP_SECRET) => buildApp(db, [], dbSessions(db), { appSecret, setupToken: TOKEN, storageDir: dir, scryptParams: TEST_SCRYPT })

async function post(app: App, url: string, payload: unknown) {
  const res = await app.inject({ method: 'POST', url, headers, payload: payload as object })
  return res.json() as { ok: boolean; code?: string; message?: string; data?: any }
}

/** Droga przeglądarki: begin → kawałki (tu małe, żeby było ich kilka) → finish. */
async function restoreOverHttp(app: App, file: Buffer, key: string, chunk = 60_000) {
  const begin = await post(app, '/api/setup/restore/begin', { token: TOKEN })
  if (!begin.ok) return begin
  const uploadId = begin.data.uploadId as string
  for (let off = 0; off < file.length; off += chunk) {
    const part = file.subarray(off, off + chunk)
    const res = await app.inject({
      method: 'POST',
      url: '/api/setup/restore/chunk',
      headers: { ...headers, 'content-type': 'application/octet-stream', 'x-setup-token': TOKEN, 'x-upload-id': uploadId, 'x-offset': String(off) },
      payload: part
    })
    const body = res.json() as { ok: boolean }
    if (!body.ok) return body as Awaited<ReturnType<typeof post>>
  }
  return post(app, '/api/setup/restore/finish', { token: TOKEN, uploadId, key })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const count = async (table: any) => (await db.select().from(table)).length

describe('pełny cykl odtworzenia', () => {
  it('dane → kopia → pusta baza → odtworzenie → to samo hasło, dane wrażliwe, usunięcia z D5, załączniki', async () => {
    const s = await makeScenario()
    // Po kopii osoba B zostaje zanonimizowana: usunięcie jest tylko w bazie i w pliku poza bazą (D5), nie w kopii.
    await anonymizeContact(db, { id: s.personB, version: 1, clearActivityIds: [], clearTaskIds: [], confirm: 'ANONIMIZUJ' }, { userId: s.adminId, now: new Date() }, dir)
    expect(JSON.parse(await readFile(join(dir, 'erased_contacts.json'), 'utf8')).map((e: { contactId: string }) => e.contactId)).toEqual([s.personB])

    await wipeEverything() // „awaria”: nowa, pusta baza; folder plików został (ten sam STORAGE_DIR)
    await rm(join(dir, 'attachments'), { recursive: true, force: true })
    expect(await count(users)).toBe(0)

    const app = makeApp()
    const res = await restoreOverHttp(app, s.file, s.key)
    expect(res).toMatchObject({ ok: true, data: { persons: 2, institutions: 0, actions: 1, documents: 1, filesMissing: 0, erasuresApplied: 1, twoFaReset: false } })

    // usunięcie z D5 nałożone na odtworzoną kopię
    const identityB = await db.select().from(contactIdentity).where(eq(contactIdentity.contactId, s.personB))
    expect(identityB).toHaveLength(0)
    const [b] = await db.select().from(contacts).where(eq(contacts.id, s.personB))
    expect(b!.anonymizedAt).not.toBeNull()
    expect(await db.select().from(contactIdentity).where(eq(contactIdentity.contactId, s.personA))).toHaveLength(1)
    expect(await db.select().from(erasedContacts)).toHaveLength(1)

    // załącznik na miejscu, bajt w bajt
    expect((await readFile(join(dir, 'attachments', s.attachment.storageKey))).equals(s.attachment.content)).toBe(true)

    // logowanie tym samym hasłem (authKey z hasła) i 2FA nadal włączone
    const login = await post(app, '/api/auth/login', { email: s.email, authKey: s.authKey })
    expect(login).toMatchObject({ ok: true, data: { totpEnabled: true } })

    // odsłonięcie danych wrażliwych: klucz prywatny z hasła → slot → szyfrogram osoby A
    const [u] = await db.select().from(users).where(eq(users.id, s.adminId))
    const { wrapKey } = await deriveKeys(PASSWORD, new Uint8Array(Buffer.from(u!.kdfSalt!, 'base64')), u!.kdfIterations!)
    const priv = await unwrapPrivateKey(u!.privateKeyEnc!, wrapKey, u!.id)
    const [slot] = await db.select().from(keySlots).where(and(eq(keySlots.userId, u!.id), eq(keySlots.keyVersion, 1)))
    const orgKey = await openSlot(slot!.wrappedKey, priv, 1, false)
    const [sens] = await db.select().from(contactSensitive).where(eq(contactSensitive.contactId, s.personA))
    expect((await decryptSensitive({ iv: sens!.iv, ciphertext: sens!.ciphertext }, orgKey, s.personA, 1)).notes).toBe('fikcyjna notatka wrażliwa')

    // ślad w dzienniku, plik roboczy posprzątany, kreator zamknięty
    expect(await db.select().from(accessLog).where(eq(accessLog.action, 'backup_restore'))).toHaveLength(1)
    expect(await readdir(restoreDir(dir))).toEqual([])
    expect(await post(app, '/api/setup/restore/begin', { token: TOKEN })).toMatchObject({ ok: false, code: 'SETUP_UNAVAILABLE' })
    await app.close()
  })

  it('inny APP_SECRET niż w dniu kopii: 2FA wszystkich kont zresetowane, logowanie prowadzi do ustawienia 2FA', async () => {
    const s = await makeScenario()
    await wipeEverything()
    const app = makeApp(OTHER_SECRET)
    const res = await restoreOverHttp(app, s.file, s.key)
    expect(res).toMatchObject({ ok: true, data: { twoFaReset: true } })
    const [u] = await db.select().from(users).where(eq(users.id, s.adminId))
    expect(u).toMatchObject({ totpSecretEnc: null, totpEnabledAt: null })
    expect(await post(app, '/api/auth/login', { email: s.email, authKey: s.authKey })).toMatchObject({ ok: true, data: { totpEnabled: false } })
    await app.close()
  })
})

describe('odmowy', () => {
  it('niepusta baza: kreator odmawia (są konta), a samo odtwarzanie odmawia także przy innych danych', async () => {
    const s = await makeScenario()
    const app = makeApp()
    expect(await restoreOverHttp(app, s.file, s.key)).toMatchObject({ ok: false, code: 'SETUP_UNAVAILABLE' })
    await app.close()

    await wipeEverything()
    const at = new Date()
    await db.insert(contacts).values({ id: randomUUID(), createdAt: at, updatedAt: at, updatedBy: randomUUID(), version: 1, kind: 'person', tags: [] })
    await expect(assertDatabaseEmpty(db)).rejects.toMatchObject({ code: 'VALIDATION', message: expect.stringMatching(/Baza nie jest pusta/) })
  })

  it('kopia z nowszą liczbą migracji niż program: „Najpierw zaktualizuj program”, baza bez zmian', async () => {
    await makeScenario()
    const path = join(dir, 'nowsza.ngb')
    await writeBackupFile(db, { path, attachmentsDir: null, programVersion: '9.9.9', migrations: 9999, now: new Date() })
    await wipeEverything()
    await expect(restoreBackup(db, { path, key: randomBytes(32), storageDir: dir, appSecret: APP_SECRET, now: new Date() })).rejects.toMatchObject({ code: 'VALIDATION', message: expect.stringMatching(/nowszej wersji programu/) })
    expect(await count(users)).toBe(0)
  })

  it('zły klucz albo uszkodzony plik: komunikat po polsku, baza pusta, nic nie zostaje na dysku', async () => {
    const s = await makeScenario()
    await wipeEverything()
    await rm(join(dir, 'attachments'), { recursive: true, force: true }) // nowy serwer: bez plików
    const app = makeApp()
    const wrongKey = randomBytes(32).toString('base64')
    expect(await restoreOverHttp(app, s.file, wrongKey)).toMatchObject({ ok: false, code: 'VALIDATION', message: expect.stringMatching(/uszkodzony albo nie pasuje/) })
    expect(await count(users)).toBe(0)

    const flipped = Buffer.from(s.file)
    flipped[flipped.length - 40] ^= 1
    expect(await restoreOverHttp(app, flipped, s.key)).toMatchObject({ ok: false, code: 'VALIDATION' })
    expect(await restoreOverHttp(app, s.file.subarray(0, s.file.length - 100), s.key)).toMatchObject({ ok: false, code: 'VALIDATION' })
    expect(await restoreOverHttp(app, Buffer.from('to nie jest kopia'), s.key)).toMatchObject({ ok: false, code: 'VALIDATION' })
    expect(await count(users)).toBe(0)
    expect(await count(contacts)).toBe(0)
    expect(await readdir(restoreDir(dir))).toEqual([])
    await expect(stat(join(dir, 'attachments', s.attachment.storageKey))).rejects.toThrow()
    await app.close()
  })

  it('kopia wielosegmentowa uszkodzona na końcu: transakcja się wycofuje, baza pusta, dysk czysty', async () => {
    const s = await makeScenario()
    // trzy duże, słabo kompresowalne załączniki: kilka segmentów po 4 MB
    const at = new Date()
    for (let i = 0; i < 3; i++) {
      const storageKey = randomBytes(16).toString('hex')
      await writeFile(join(dir, 'attachments', storageKey), randomBytes(3_000_000))
      await db.insert(attachments).values({ id: randomUUID(), createdAt: at, updatedAt: at, updatedBy: s.adminId, version: 1, targetType: 'contact', targetId: s.personA, purpose: 'document', keyVersion: 1, metaEnc: 'bQ==', sizeBytes: 3_000_000, storageKey })
    }
    const { id, done } = await startBackup(db, { storageDir: dir, kind: 'manual', userId: null, now: new Date(Date.now() + 1000) })
    await done
    const big = await readFile(backupFilePath(dir, id))
    const key = toBase64(await crypto.subtle.exportKey('raw', (await openBackup(new Blob([new Uint8Array(big)]), s.email, PASSWORD, true)).key))
    await wipeEverything()
    await rm(join(dir, 'attachments'), { recursive: true, force: true })
    const app = makeApp()
    const broken = big.subarray(0, big.length - 50) // obcięty koniec: błąd dopiero na ostatnim segmencie, po wgraniu tabel i części plików
    expect(await restoreOverHttp(app, broken, key, 1_000_000)).toMatchObject({ ok: false, code: 'VALIDATION' })
    expect(await count(users)).toBe(0)
    expect(await count(contacts)).toBe(0)
    expect(await count(attachments)).toBe(0)
    expect(await readdir(restoreDir(dir))).toEqual([])
    expect(await readdir(join(dir, 'attachments')).catch(() => [])).toEqual([])
    // po nieudanej próbie można spróbować z dobrym plikiem
    expect(await restoreOverHttp(app, big, key, 1_000_000)).toMatchObject({ ok: true, data: { documents: 4 } })
    await app.close()
  })

  it('błąd po zatwierdzeniu bazy (nie da się przenieść plików): wszystko wycofane, kreator znów dostępny', async () => {
    const s = await makeScenario()
    await wipeEverything()
    await rm(join(dir, 'attachments'), { recursive: true, force: true })
    await writeFile(join(dir, 'attachments'), 'to jest plik, nie folder') // mkdir folderu załączników się nie uda
    const app = makeApp()
    expect(await restoreOverHttp(app, s.file, s.key)).toMatchObject({ ok: false })
    expect(await count(users)).toBe(0)
    expect(await count(contacts)).toBe(0)
    expect(await post(app, '/api/setup/status', {})).toMatchObject({ ok: true, data: { state: 'available' } })
    await app.close()
  })

  it('kawałki w złej kolejności i zły token są odrzucane', async () => {
    const app = makeApp()
    const begin = await post(app, '/api/setup/restore/begin', { token: TOKEN })
    const send = (token: string, offset: number) =>
      app.inject({ method: 'POST', url: '/api/setup/restore/chunk', headers: { ...headers, 'content-type': 'application/octet-stream', 'x-setup-token': token, 'x-upload-id': begin.data.uploadId, 'x-offset': String(offset) }, payload: Buffer.from('abc') })
    const stranger = await app.inject({ method: 'POST', url: '/api/setup/restore/chunk', headers: { ...headers, 'content-type': 'application/octet-stream', 'x-setup-token': TOKEN, 'x-upload-id': 'a'.repeat(32), 'x-offset': '0' }, payload: Buffer.from('abc') })
    expect(stranger.json()).toMatchObject({ ok: false, code: 'VALIDATION' }) // identyfikator nie wydany przez begin
    expect((await send(TOKEN, 5)).json()).toMatchObject({ ok: false, code: 'VALIDATION' })
    expect((await send('zly-token', 0)).json()).toMatchObject({ ok: false, code: 'SETUP_TOKEN_INVALID' })
    expect((await send(TOKEN, 0)).json()).toMatchObject({ ok: true })
    expect((await post(app, '/api/setup/restore/begin', { token: 'zly-token' })).code).toBe('SETUP_TOKEN_INVALID')
    await app.close()
  })
})

describe('starsza kopia w nowszym schemacie', () => {
  it('brakujące kolumny dostają wartości domyślne, nieznane kolumny są ignorowane', async () => {
    const at = new Date().toISOString()
    const id = randomUUID()
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET FOREIGN_KEY_CHECKS = 0`)
      // wiersz „sprzed” kolumn place, start_date i description; z kolumną, której dziś nie ma
      await insertRows(tx, actions, [{ id, created_at: at, updated_at: at, updated_by: randomUUID(), version: 1, type: 'event', framework: 'project', title: 'Dawne działanie', status: 'done', kolumna_usunieta_pozniej: 'x' }])
      await tx.execute(sql`SET FOREIGN_KEY_CHECKS = 1`)
    })
    const [row] = await db.select().from(actions).where(eq(actions.id, id))
    expect(row).toMatchObject({ title: 'Dawne działanie', place: null, startDate: null, description: null, deletedAt: null })
    expect(row!.createdAt.toISOString()).toBe(at)
  })
})

