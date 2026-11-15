// Załączniki przez HTTP na lokalnej bazie testowej (ZADANIE_03, krok 3a). Pliki to tu losowe bajty:
// serwer ich nie otwiera, tylko sprawdza dostęp, przechowuje i wydaje. Dane fikcyjne.
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { ATTACHMENT_MAX_BYTES } from '@shared/api'
import { buildApp } from '../app'
import type { Db } from '../db/connection'
import { accessLog, actions, activities, activityContacts, attachments, changeLog, contactIdentity, contactRoles, contacts, keySlots, orgKeys } from '../db/schema'
import { openTestDb } from '../testDb'
import { SESSION_COOKIE, createSession, dbSessions } from '../auth/sessions'
import { TEST_APP_SECRET, TEST_SCRYPT, addTestUser, sessionCookieFor, wipeAccounts } from '../auth/testkit'
import * as svc from './contacts'

const HOST = 'crm.example.org'
const headers = { host: HOST, 'x-forwarded-proto': 'https', origin: `https://${HOST}`, 'x-ngo-crm': '1' }

let db: Db
let close: () => Promise<void>
let app: ReturnType<typeof buildApp>
let noStorageApp: ReturnType<typeof buildApp>
let storageDir: string
const nowMs = Date.now()
const clock = () => new Date(nowMs)
const files = () => {
  try {
    return readdirSync(join(storageDir, 'attachments'))
  } catch {
    return [] // folder powstaje przy pierwszym użyciu
  }
}

async function rpc(cookie: string, method: string, params?: unknown) {
  const res = await app.inject({ method: 'POST', url: '/api/rpc', headers: { ...headers, cookie }, payload: { method, params } })
  return { status: res.statusCode, body: res.json() as { ok: boolean; code?: string; data?: any } }
}

interface UploadOpts {
  targetType?: string
  targetId: string
  keyVersion?: number
  bytes?: Buffer
  meta?: string
  server?: typeof app
}
async function upload(cookie: string | null, o: UploadOpts) {
  const res = await (o.server ?? app).inject({
    method: 'POST',
    url: '/api/attachments',
    headers: {
      ...headers,
      ...(cookie ? { cookie } : {}),
      'content-type': 'application/octet-stream',
      'x-target-type': o.targetType ?? 'contact',
      'x-target-id': o.targetId,
      'x-key-version': String(o.keyVersion ?? 1),
      'x-meta-enc': o.meta ?? randomBytes(80).toString('base64')
    },
    payload: o.bytes ?? randomBytes(1000)
  })
  return { status: res.statusCode, body: res.json() as { ok: boolean; code?: string; data?: any } }
}
const download = (cookie: string | null, id: string) => app.inject({ method: 'GET', url: `/api/attachments/${id}`, headers: { ...headers, ...(cookie ? { cookie } : {}) } })
const downloadLog = () => db.select().from(accessLog).where(eq(accessLog.action, 'download_attachment'))

async function account(role: 'admin' | 'staff' | 'readonly' = 'staff', slotVersions: number[] = []) {
  const u = await addTestUser(db, { role, now: clock(), publicKey: randomBytes(294).toString('base64') })
  for (const keyVersion of slotVersions) {
    await db.insert(keySlots).values({ id: randomUUID(), userId: u.id, keyVersion, wrappedKey: randomBytes(256).toString('base64'), grantedBy: u.id, grantedAt: clock() })
  }
  return { ...u, cookie: await sessionCookieFor(db, u.id, clock()) }
}
const orgKey = (version: number) => db.insert(orgKeys).values({ version, createdAt: clock(), createdBy: randomUUID(), retiredAt: null })

const person = async () =>
  (
    await svc.createContact(
      db,
      { kind: 'person', firstName: 'Ewa', lastName: 'Testowa', name: null, email: null, phone: null, address: null, city: null, notes: null, tags: [], roles: [] },
      { userId: randomUUID(), now: clock() }
    )
  ).id

/** Organizacja z wersją 1 klucza, pracownikiem ze slotem i osobą. */
async function org() {
  await orgKey(1)
  return { s: await account('staff', [1]), id: await person() }
}

async function cleanup() {
  await db.delete(attachments)
  await db.delete(actions)
  await db.delete(activityContacts)
  await db.delete(activities)
  await db.delete(contactRoles)
  await db.delete(contactIdentity)
  await db.delete(contacts)
  await wipeAccounts(db)
  rmSync(join(storageDir, 'attachments'), { recursive: true, force: true })
}

beforeAll(async () => {
  ;({ db, close } = await openTestDb())
  storageDir = mkdtempSync(join(tmpdir(), 'ngocrm-test-attachments-'))
  const auth = { appSecret: TEST_APP_SECRET, now: clock, scryptParams: TEST_SCRYPT }
  app = buildApp(db, [], dbSessions(db, clock), { ...auth, storageDir })
  noStorageApp = buildApp(db, [], dbSessions(db, clock), auth)
})
beforeEach(cleanup)
afterAll(async () => {
  if (!db) return
  await app?.close()
  await noStorageApp?.close()
  await cleanup()
  rmSync(storageDir, { recursive: true, force: true })
  await close()
})

describe('wysłanie, lista i pobranie', () => {
  it('pełny obieg: plik w STORAGE_DIR to dokładnie wysłane bajty pod losową nazwą, pobranie z wpisem w dzienniku', async () => {
    const { s, id } = await org()
    const bytes = randomBytes(5000)
    const meta = randomBytes(90).toString('base64')
    const up = await upload(s.cookie, { targetId: id, bytes, meta })
    expect(up).toMatchObject({ status: 200, body: { ok: true, data: { version: 1 } } })

    const stored = files()
    expect(stored).toHaveLength(1)
    expect(stored[0]).toMatch(/^[0-9a-f]{32}$/)
    expect(readFileSync(join(storageDir, 'attachments', String(stored[0])))).toEqual(bytes)

    const list = await rpc(s.cookie, 'attachments.list', { targetType: 'contact', targetId: id })
    expect(list.body.data).toMatchObject([{ id: up.body.data.id, targetType: 'contact', targetId: id, purpose: 'document', keyVersion: 1, metaEnc: meta, sizeBytes: 5000 }])
    expect(JSON.stringify(list.body)).not.toContain(String(stored[0]))

    const res = await download(s.cookie, up.body.data.id)
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-disposition']).toMatch(/^attachment/)
    expect(res.headers['content-type']).toBe('application/octet-stream')
    expect(res.rawPayload).toEqual(bytes)
    expect(await downloadLog()).toMatchObject([{ userId: s.id, targetType: 'attachment', targetId: up.body.data.id }])
  })

  it('załącznik do działania; lista rozdziela cele', async () => {
    const { s, id } = await org()
    const actionId = randomUUID()
    await db.insert(actions).values({ id: actionId, createdAt: clock(), updatedAt: clock(), updatedBy: s.id, version: 1, type: 'training', framework: 'project', title: 'Szkolenie testowe', status: 'planned' })
    expect((await upload(s.cookie, { targetType: 'action', targetId: actionId })).status).toBe(200)
    expect((await rpc(s.cookie, 'attachments.list', { targetType: 'action', targetId: actionId })).body.data).toHaveLength(1)
    expect((await rpc(s.cookie, 'attachments.list', { targetType: 'contact', targetId: id })).body.data).toHaveLength(0)
  })

  it('readonly ze slotem pobiera, ale nie wysyła', async () => {
    const { s, id } = await org()
    const up = await upload(s.cookie, { targetId: id })
    const r = await account('readonly', [1])
    expect(await upload(r.cookie, { targetId: id })).toMatchObject({ status: 403, body: { code: 'FORBIDDEN' } })
    expect((await download(r.cookie, up.body.data.id)).statusCode).toBe(200)
    expect(files()).toHaveLength(1)
  })
})

describe('dostęp = slot (D3, D11)', () => {
  it('bez slotu: wysyłanie i pobieranie → 403 NO_KEY_ACCESS, bez pliku i bez wpisu w dzienniku', async () => {
    const { s, id } = await org()
    const up = await upload(s.cookie, { targetId: id })
    for (const role of ['admin', 'staff', 'readonly'] as const) {
      const u = await account(role)
      expect(JSON.parse((await download(u.cookie, up.body.data.id)).body)).toMatchObject({ code: 'NO_KEY_ACCESS' })
      if (role !== 'readonly') expect(await upload(u.cookie, { targetId: id })).toMatchObject({ status: 403, body: { code: 'NO_KEY_ACCESS' } })
    }
    expect(files()).toHaveLength(1)
    expect(await downloadLog()).toEqual([])
  })

  it('slot tylko do innej wersji klucza nie wystarcza do pobrania; wysłanie starą wersją klucza odrzucone', async () => {
    const { s, id } = await org()
    const up = await upload(s.cookie, { targetId: id })
    await orgKey(2)
    const u = await account('staff', [2])
    expect((await download(u.cookie, up.body.data.id)).statusCode).toBe(403)
    expect(await upload(s.cookie, { targetId: id, keyVersion: 1 })).toMatchObject({ status: 400, body: { code: 'VALIDATION' } })
    expect((await upload(u.cookie, { targetId: id, keyVersion: 2 })).status).toBe(200)
  })

  it('bez sesji → 401, sesja bez 2FA → 403 TOTP_REQUIRED (wysyłanie i pobieranie)', async () => {
    const { s, id } = await org()
    const up = await upload(s.cookie, { targetId: id })
    expect(await upload(null, { targetId: id })).toMatchObject({ status: 401, body: { code: 'UNAUTHENTICATED' } })
    expect((await download(null, up.body.data.id)).statusCode).toBe(401)
    const { token } = await createSession(db, s.id, { mfaPassed: false, now: clock() })
    const half = `${SESSION_COOKIE}=${token}`
    expect(await upload(half, { targetId: id })).toMatchObject({ status: 403, body: { code: 'TOTP_REQUIRED' } })
    expect((await download(half, up.body.data.id)).statusCode).toBe(403)
    expect(files()).toHaveLength(1)
  })

  it('serwer bez CSRF-owych nagłówków odrzuca wysyłanie', async () => {
    const { s, id } = await org()
    const res = await app.inject({
      method: 'POST',
      url: '/api/attachments',
      headers: { host: HOST, 'x-forwarded-proto': 'https', cookie: s.cookie, 'content-type': 'application/octet-stream', 'x-target-type': 'contact', 'x-target-id': id, 'x-key-version': '1', 'x-meta-enc': 'AAAA' },
      payload: randomBytes(100)
    })
    expect(res.statusCode).toBe(403)
    expect(files()).toHaveLength(0)
  })
})

describe('kontrole wysyłania', () => {
  it('plik ponad limit odrzucony i nie zostaje na dysku', async () => {
    const { s, id } = await org()
    expect(await upload(s.cookie, { targetId: id, bytes: randomBytes(ATTACHMENT_MAX_BYTES + 1) })).toMatchObject({ status: 400, body: { code: 'VALIDATION' } })
    expect(files()).toHaveLength(0)
    expect(await db.select().from(attachments)).toEqual([])
  })

  it('plik pusty albo krótszy niż narzut szyfrowania odrzucony', async () => {
    const { s, id } = await org()
    expect((await upload(s.cookie, { targetId: id, bytes: Buffer.alloc(10) })).status).toBe(400)
    expect(files()).toHaveLength(0)
  })

  it('złe nagłówki (cel, id, metadane) → 400', async () => {
    const { s, id } = await org()
    expect((await upload(s.cookie, { targetType: 'task', targetId: id })).status).toBe(400)
    expect((await upload(s.cookie, { targetId: 'nie-uuid' })).status).toBe(400)
    expect((await upload(s.cookie, { targetId: id, meta: 'to nie jest base64!' })).status).toBe(400)
    expect(files()).toHaveLength(0)
  })

  it('cel nieistniejący, w Koszu albo zanonimizowany → 404, bez pliku', async () => {
    const { s, id } = await org()
    expect((await upload(s.cookie, { targetId: randomUUID() })).status).toBe(404)
    expect((await upload(s.cookie, { targetType: 'action', targetId: randomUUID() })).status).toBe(404)
    await db.update(contacts).set({ deletedAt: clock() }).where(eq(contacts.id, id))
    expect((await upload(s.cookie, { targetId: id })).status).toBe(404)
    await db.update(contacts).set({ deletedAt: null, anonymizedAt: clock() }).where(eq(contacts.id, id))
    expect((await upload(s.cookie, { targetId: id })).status).toBe(404)
    expect(files()).toHaveLength(0)
  })

  it('bez STORAGE_DIR załączniki nie działają', async () => {
    const { s, id } = await org()
    expect(await upload(s.cookie, { targetId: id, server: noStorageApp })).toMatchObject({ status: 400, body: { code: 'VALIDATION' } })
  })
})

describe('usuwanie, Kosz i change_log', () => {
  it('usunięcie = Kosz: znika z listy i pobrania, plik zostaje, przywrócenie go oddaje', async () => {
    const { s, id } = await org()
    const up = await upload(s.cookie, { targetId: id })
    const aid = up.body.data.id as string
    expect(await rpc(s.cookie, 'attachments.delete', { id: aid, version: 5 })).toMatchObject({ status: 409, body: { code: 'VERSION_CONFLICT' } })
    expect((await rpc(s.cookie, 'attachments.delete', { id: aid, version: 1 })).status).toBe(200)

    expect((await rpc(s.cookie, 'attachments.list', { targetType: 'contact', targetId: id })).body.data).toEqual([])
    expect((await download(s.cookie, aid)).statusCode).toBe(404)
    expect(files()).toHaveLength(1)
    expect((await rpc(s.cookie, 'attachments.delete', { id: aid, version: 2 })).status).toBe(404)

    const trash = (await rpc(s.cookie, 'trash.list')).body.data as { entity: string; id: string; version: number }[]
    const item = trash.find((t) => t.id === aid)
    expect(item).toMatchObject({ entity: 'attachments', version: 2 })
    expect((await rpc(s.cookie, 'trash.restore', { entity: 'attachments', id: aid, version: item!.version })).status).toBe(200)
    expect((await download(s.cookie, aid)).statusCode).toBe(200)
  })

  it('usunięcie bez slotu → 403, readonly → 403', async () => {
    const { s, id } = await org()
    const aid = (await upload(s.cookie, { targetId: id })).body.data.id as string
    const noSlot = await account('staff')
    expect(await rpc(noSlot.cookie, 'attachments.delete', { id: aid, version: 1 })).toMatchObject({ status: 403, body: { code: 'NO_KEY_ACCESS' } })
    const ro = await account('readonly', [1])
    expect((await rpc(ro.cookie, 'attachments.delete', { id: aid, version: 1 })).body.code).toBe('FORBIDDEN')
  })

  it('change_log załącznika ma tylko nazwy pól, bez zaszyfrowanych metadanych', async () => {
    const { s, id } = await org()
    const meta = randomBytes(90).toString('base64')
    await upload(s.cookie, { targetId: id, meta })
    const log = await db.select().from(changeLog).where(eq(changeLog.entity, 'attachments'))
    expect(log).toHaveLength(1)
    expect(Object.values(log[0]!.changedFields as object).every((v) => v === true)).toBe(true)
    expect(JSON.stringify(log)).not.toContain(meta)
  })
})
