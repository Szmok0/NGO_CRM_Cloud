// Dane wrażliwe osoby przez HTTP na lokalnej bazie testowej (ZADANIE_03, krok 2a). Szyfrogramy to tu losowe bajty:
// serwer ich nie otwiera, tylko sprawdza dostęp, przechowuje i wydaje. Dane fikcyjne.
import { randomBytes, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { SENSITIVE_MAX_CIPHERTEXT } from '@shared/api'
import { buildApp } from '../app'
import type { Db } from '../db/connection'
import { accessLog, activities, activityContacts, changeLog, contactIdentity, contactRoles, contactSensitive, contacts, keySlots, orgKeys, settings } from '../db/schema'
import { openTestDb } from '../testDb'
import { SETTINGS_ID } from '../auth/setup'
import { dbSessions } from '../auth/sessions'
import { TEST_APP_SECRET, TEST_SCRYPT, addTestUser, sessionCookieFor, wipeAccounts } from '../auth/testkit'
import * as svc from './contacts'

const HOST = 'crm.example.org'
const headers = { host: HOST, 'x-forwarded-proto': 'https', origin: `https://${HOST}`, 'x-ngo-crm': '1' }

let db: Db
let close: () => Promise<void>
let app: ReturnType<typeof buildApp>
const nowMs = Date.now()
const clock = () => new Date(nowMs)

async function rpc(cookie: string, method: string, params?: unknown) {
  const res = await app.inject({ method: 'POST', url: '/api/rpc', headers: { ...headers, cookie }, payload: { method, params } })
  return { status: res.statusCode, body: res.json() as { ok: boolean; code?: string; data?: any } }
}

async function account(role: 'admin' | 'staff' | 'readonly' = 'staff', slotVersions: number[] = []) {
  const u = await addTestUser(db, { role, now: clock(), publicKey: randomBytes(294).toString('base64') })
  for (const keyVersion of slotVersions) {
    await db.insert(keySlots).values({ id: randomUUID(), userId: u.id, keyVersion, wrappedKey: randomBytes(256).toString('base64'), grantedBy: u.id, grantedAt: clock() })
  }
  return { ...u, cookie: await sessionCookieFor(db, u.id, clock()) }
}
const orgKey = (version: number, retired = false) => db.insert(orgKeys).values({ version, createdAt: clock(), createdBy: randomUUID(), retiredAt: retired ? clock() : null })

/** Ustawienia organizacji; bez `enabled` zostaje wartość domyślna z bazy. */
async function orgSettings(enabled?: boolean) {
  await db.insert(settings).values({
    id: SETTINGS_ID,
    createdAt: clock(),
    updatedAt: clock(),
    updatedBy: randomUUID(),
    version: 1,
    orgName: 'Stowarzyszenie testowe',
    profile: 'projects',
    enabledModules: ['contacts'],
    roleLabels: {},
    sensitiveFieldsEnabled: enabled
  })
}

const contact = async (kind: 'person' | 'institution' = 'person') =>
  (
    await svc.createContact(
      db,
      { kind, firstName: kind === 'person' ? 'Ewa' : null, lastName: kind === 'person' ? 'Testowa' : null, name: kind === 'person' ? null : 'Instytucja Testowa', email: null, phone: null, address: null, city: null, notes: null, tags: [], roles: [] },
      { userId: randomUUID(), now: clock() }
    )
  ).id

const cipher = (keyVersion = 1, version: number | null = null) => ({ version, keyVersion, iv: randomBytes(12).toString('base64'), ciphertext: randomBytes(300).toString('base64') })
const revealLog = () => db.select().from(accessLog).where(eq(accessLog.action, 'reveal_sensitive'))

/** Organizacja z włączonymi polami, wersją 1 klucza i pracownikiem ze slotem. */
async function org() {
  await orgSettings(true)
  await orgKey(1)
  return { s: await account('staff', [1]), id: await contact() }
}

async function cleanup() {
  await db.delete(contactSensitive)
  await db.delete(activityContacts)
  await db.delete(activities)
  await db.delete(contactRoles)
  await db.delete(contactIdentity)
  await db.delete(contacts)
  await wipeAccounts(db)
}

beforeAll(async () => {
  ;({ db, close } = await openTestDb())
  app = buildApp(db, [], dbSessions(db, clock), { appSecret: TEST_APP_SECRET, now: clock, scryptParams: TEST_SCRYPT })
})
beforeEach(cleanup)
afterAll(async () => {
  if (!db) return
  await app?.close()
  await cleanup()
  await close()
})

describe('zapis i odsłonięcie', () => {
  it('zapis, contacts.get bez szyfrogramu, odsłonięcie z wpisem w dzienniku przy każdym wywołaniu', async () => {
    const { s, id } = await org()
    const c = cipher()
    expect(await rpc(s.cookie, 'sensitive.save', { contactId: id, ...c })).toMatchObject({ status: 200, body: { data: { version: 1 } } })

    const detail = await rpc(s.cookie, 'contacts.get', { id })
    expect(detail.body.data).toMatchObject({ hasSensitive: true, sensitiveKeyVersion: 1 })
    expect(JSON.stringify(detail.body)).not.toContain(c.ciphertext)
    expect(JSON.stringify(detail.body)).not.toContain(c.iv)

    for (let i = 0; i < 2; i++) {
      expect((await rpc(s.cookie, 'sensitive.reveal', { contactId: id })).body.data).toEqual({ version: 1, keyVersion: 1, iv: c.iv, ciphertext: c.ciphertext })
    }
    expect(await revealLog()).toMatchObject([
      { userId: s.id, targetType: 'contact', targetId: id },
      { userId: s.id, targetType: 'contact', targetId: id }
    ])
  })

  it('osoba bez danych: hasSensitive false, odsłonięcie → 404', async () => {
    const { s, id } = await org()
    expect((await rpc(s.cookie, 'contacts.get', { id })).body.data).toMatchObject({ hasSensitive: false, sensitiveKeyVersion: null })
    expect((await rpc(s.cookie, 'sensitive.reveal', { contactId: id })).status).toBe(404)
    expect(await revealLog()).toEqual([])
  })

  it('readonly ze slotem odsłania, ale nie zapisuje', async () => {
    const { s, id } = await org()
    await rpc(s.cookie, 'sensitive.save', { contactId: id, ...cipher() })
    const r = await account('readonly', [1])
    expect((await rpc(r.cookie, 'sensitive.reveal', { contactId: id })).status).toBe(200)
    expect(await rpc(r.cookie, 'sensitive.save', { contactId: id, ...cipher(1, 1) })).toMatchObject({ status: 403, body: { code: 'FORBIDDEN' } })
  })
})

describe('dostęp = slot (D3)', () => {
  it('bez slotu: zapis i odsłonięcie → 403 NO_KEY_ACCESS, bez wpisu w dzienniku', async () => {
    const { s, id } = await org()
    await rpc(s.cookie, 'sensitive.save', { contactId: id, ...cipher() })
    for (const role of ['admin', 'staff', 'readonly'] as const) {
      const u = await account(role)
      expect(await rpc(u.cookie, 'sensitive.reveal', { contactId: id })).toMatchObject({ status: 403, body: { code: 'NO_KEY_ACCESS' } })
      if (role !== 'readonly') expect(await rpc(u.cookie, 'sensitive.save', { contactId: id, ...cipher(1, 1) })).toMatchObject({ status: 403, body: { code: 'NO_KEY_ACCESS' } })
    }
    expect(await revealLog()).toEqual([])
  })

  it('slot tylko do innej wersji klucza nie wystarcza do odsłonięcia', async () => {
    const { s, id } = await org()
    await rpc(s.cookie, 'sensitive.save', { contactId: id, ...cipher() })
    await orgKey(2)
    const u = await account('staff', [2])
    expect((await rpc(u.cookie, 'sensitive.reveal', { contactId: id })).body.code).toBe('NO_KEY_ACCESS')
  })

  it('szyfrogram w wersji wycofanej → NO_KEY_ACCESS mimo slotu', async () => {
    const { s, id } = await org()
    await rpc(s.cookie, 'sensitive.save', { contactId: id, ...cipher() })
    await db.update(orgKeys).set({ retiredAt: clock() }).where(eq(orgKeys.version, 1))
    expect((await rpc(s.cookie, 'sensitive.reveal', { contactId: id })).body.code).toBe('NO_KEY_ACCESS')
  })

  it('zapis starą wersją klucza odrzucony, bieżącą przyjęty', async () => {
    const { id } = await org()
    await orgKey(2)
    const a = await account('admin', [1, 2])
    expect(await rpc(a.cookie, 'sensitive.save', { contactId: id, ...cipher(1) })).toMatchObject({ status: 400, body: { code: 'VALIDATION' } })
    expect(await rpc(a.cookie, 'sensitive.save', { contactId: id, ...cipher(3) })).toMatchObject({ status: 400, body: { code: 'VALIDATION' } })
    expect((await rpc(a.cookie, 'sensitive.save', { contactId: id, ...cipher(2) })).status).toBe(200)
    expect((await rpc(a.cookie, 'contacts.get', { id })).body.data.sensitiveKeyVersion).toBe(2)
  })
})

describe('wersja rekordu i change_log', () => {
  it('kolejne zapisy podbijają version; stara version → VERSION_CONFLICT, dane pierwszego zapisu zostają', async () => {
    const { s, id } = await org()
    expect((await rpc(s.cookie, 'sensitive.save', { contactId: id, ...cipher(1, 3) })).body.code).toBe('VERSION_CONFLICT')
    await rpc(s.cookie, 'sensitive.save', { contactId: id, ...cipher() })
    expect((await rpc(s.cookie, 'sensitive.save', { contactId: id, ...cipher() })).body.code).toBe('VERSION_CONFLICT')

    const first = cipher(1, 1)
    expect((await rpc(s.cookie, 'sensitive.save', { contactId: id, ...first })).body.data).toEqual({ version: 2 })
    expect(await rpc(s.cookie, 'sensitive.save', { contactId: id, ...cipher(1, 1) })).toMatchObject({ status: 409, body: { code: 'VERSION_CONFLICT' } })
    expect((await rpc(s.cookie, 'sensitive.reveal', { contactId: id })).body.data).toMatchObject({ version: 2, ciphertext: first.ciphertext })
  })

  it('change_log ma tylko nazwy pól, bez szyfrogramu i IV', async () => {
    const { s, id } = await org()
    const a = cipher()
    const b = cipher(1, 1)
    await rpc(s.cookie, 'sensitive.save', { contactId: id, ...a })
    await rpc(s.cookie, 'sensitive.save', { contactId: id, ...b })
    const log = await db.select().from(changeLog).where(eq(changeLog.entity, 'contact_sensitive'))
    expect(log.map((e) => e.op).sort()).toEqual(['insert', 'update'])
    expect(log.find((e) => e.op === 'update')!.changedFields).toEqual({ iv: true, ciphertext: true })
    expect(log.find((e) => e.op === 'insert')!.changedFields).toEqual({ contactId: true, keyVersion: true, iv: true, ciphertext: true })
    const text = JSON.stringify(log)
    for (const v of [a.iv, a.ciphertext, b.iv, b.ciphertext]) expect(text).not.toContain(v)
  })
})

describe('kogo dotyczy zapis', () => {
  it('instytucja → 400; osoba w Koszu, zanonimizowana albo nieistniejąca → 404', async () => {
    const { s } = await org()
    expect(await rpc(s.cookie, 'sensitive.save', { contactId: await contact('institution'), ...cipher() })).toMatchObject({ status: 400, body: { code: 'VALIDATION' } })

    const trashed = await contact()
    await db.update(contacts).set({ deletedAt: clock() }).where(eq(contacts.id, trashed))
    const anonymized = await contact()
    await db.update(contacts).set({ anonymizedAt: clock() }).where(eq(contacts.id, anonymized))
    for (const contactId of [trashed, anonymized, randomUUID()]) {
      expect((await rpc(s.cookie, 'sensitive.save', { contactId, ...cipher() })).status).toBe(404)
    }
    expect(await db.select().from(contactSensitive)).toEqual([])
  })

  it('za duży szyfrogram albo zły IV → 400', async () => {
    const { s, id } = await org()
    expect((await rpc(s.cookie, 'sensitive.save', { contactId: id, ...cipher(), ciphertext: 'A'.repeat(SENSITIVE_MAX_CIPHERTEXT + 1) })).status).toBe(400)
    expect((await rpc(s.cookie, 'sensitive.save', { contactId: id, ...cipher(), iv: randomBytes(16).toString('base64') })).status).toBe(400)
  })
})

describe('przełącznik w ustawieniach (D2)', () => {
  it('domyślnie wyłączone: zapis i odsłonięcie → 403 FORBIDDEN', async () => {
    await orgSettings()
    await orgKey(1)
    const s = await account('staff', [1])
    const id = await contact()
    expect((await rpc(s.cookie, 'settings.get')).body.data.sensitiveFieldsEnabled).toBe(false)
    expect(await rpc(s.cookie, 'sensitive.save', { contactId: id, ...cipher() })).toMatchObject({ status: 403, body: { code: 'FORBIDDEN' } })
    expect(await db.select().from(contactSensitive)).toEqual([])
  })

  it('administrator włącza i wyłącza pola; wyłączenie ukrywa dane, nie usuwa ich', async () => {
    await orgSettings()
    await orgKey(1)
    const a = await account('admin', [1])
    const id = await contact()
    const update = (version: number, sensitiveFieldsEnabled?: boolean) =>
      rpc(a.cookie, 'settings.update', { version, orgName: 'Stowarzyszenie testowe', profile: 'projects', enabledModules: ['contacts'], roleLabels: {}, staleDays: 30, sensitiveFieldsEnabled })

    expect((await update(1, true)).status).toBe(200)
    expect((await rpc(a.cookie, 'settings.get')).body.data.sensitiveFieldsEnabled).toBe(true)
    expect((await rpc(a.cookie, 'sensitive.save', { contactId: id, ...cipher() })).status).toBe(200)

    // bez pola: bez zmiany
    expect((await update(2)).status).toBe(200)
    expect((await rpc(a.cookie, 'settings.get')).body.data.sensitiveFieldsEnabled).toBe(true)

    expect((await update(2, false)).status).toBe(200)
    expect(await rpc(a.cookie, 'sensitive.reveal', { contactId: id })).toMatchObject({ status: 403, body: { code: 'FORBIDDEN' } })
    expect(await db.select().from(contactSensitive).where(eq(contactSensitive.contactId, id))).toHaveLength(1)
  })
})
