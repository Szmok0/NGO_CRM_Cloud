// Zmiana klucza organizacji przez HTTP na lokalnej bazie testowej (ZADANIE_03, krok 4a). Sloty i szyfrogramy to tu
// losowe bajty: serwer ich nie otwiera, tylko pilnuje wersji, zestawu uprawnionych i kolejności kroków. Dane fikcyjne.
import { randomBytes, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { and, eq, isNull } from 'drizzle-orm'
import { buildApp } from '../app'
import type { Db } from '../db/connection'
import {
  accessLog,
  activities,
  activityContacts,
  attachments,
  changeLog,
  contactIdentity,
  contactRoles,
  contactSensitive,
  contacts,
  keySlots,
  orgKeys,
  settings
} from '../db/schema'
import { openTestDb } from '../testDb'
import { SETTINGS_ID } from './setup'
import { dbSessions } from './sessions'
import { TEST_APP_SECRET, TEST_SCRYPT, addTestUser, sessionCookieFor, wipeAccounts } from './testkit'
import { repoFor } from '../services/common'
import * as contactsSvc from '../services/contacts'

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
const b64 = (n: number) => randomBytes(n).toString('base64')
const recoverySlot = () => `v1.${b64(12)}.${b64(48)}`
const cipher = () => ({ iv: b64(12), ciphertext: b64(300) })

async function account(role: 'admin' | 'staff' | 'readonly', slotVersions: number[] = []) {
  const u = await addTestUser(db, { role, now: clock(), publicKey: b64(294) })
  for (const keyVersion of slotVersions) {
    await db.insert(keySlots).values({ id: randomUUID(), userId: u.id, keyVersion, wrappedKey: b64(256), grantedBy: u.id, grantedAt: clock() })
  }
  return { ...u, cookie: await sessionCookieFor(db, u.id, clock()) }
}

const writer = { userId: randomUUID(), now: clock() }
const person = async () =>
  (
    await contactsSvc.createContact(
      db,
      { kind: 'person', firstName: 'Ewa', lastName: 'Testowa', name: null, email: null, phone: null, address: null, city: null, notes: null, tags: [], roles: [] },
      writer
    )
  ).id
/** Dane wrażliwe osoby zaszyfrowane wersją 1 klucza. */
const sensitiveRow = async (contactId: string) => repoFor(db, writer).insert(contactSensitive, { contactId, keyVersion: 1, ...cipher() })
const attachmentRow = async (targetId: string) =>
  repoFor(db, writer).insert(attachments, { targetType: 'contact', targetId, purpose: 'document', keyVersion: 1, metaEnc: b64(200), sizeBytes: 1000, storageKey: randomBytes(16).toString('hex') })

/** Organizacja z włączonymi polami, wersją 1 klucza ze slotem odzyskiwania, administratorem i pracownikiem ze slotami. */
async function org() {
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
    sensitiveFieldsEnabled: true
  })
  await db.insert(orgKeys).values({ version: 1, createdAt: clock(), createdBy: randomUUID() })
  await db.insert(keySlots).values({ id: randomUUID(), userId: null, keyVersion: 1, wrappedKey: recoverySlot(), grantedBy: randomUUID(), grantedAt: clock() })
  return { a: await account('admin', [1]), s: await account('staff', [1]) }
}

const startInput = (userIds: string[], keyVersion = 2) => ({ keyVersion, slots: userIds.map((userId) => ({ userId, wrappedKey: b64(256) })), recoverySlot: recoverySlot() })
const logOf = (action: string) => db.select().from(accessLog).where(eq(accessLog.action, action))
const slotVersions = async () => (await db.select({ v: keySlots.keyVersion }).from(keySlots)).map((s) => s.v)

async function cleanup() {
  await db.delete(attachments)
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

describe('keys.rotateStart', () => {
  it('zakłada nową wersję ze slotami wszystkich uprawnionych i nowym slotem odzyskiwania', async () => {
    const { a, s } = await org()
    const input = startInput([a.id, s.id])
    expect((await rpc(a.cookie, 'keys.rotateStart', input)).status).toBe(200)
    expect(await db.select().from(orgKeys).where(eq(orgKeys.version, 2))).toMatchObject([{ createdBy: a.id, retiredAt: null }])
    const v2 = await db.select().from(keySlots).where(eq(keySlots.keyVersion, 2))
    expect(v2).toHaveLength(3)
    expect(v2.find((x) => x.userId === null)!.wrappedKey).toBe(input.recoverySlot)
    expect(v2.find((x) => x.userId === s.id)).toMatchObject({ wrappedKey: input.slots[1]!.wrappedKey, grantedBy: a.id })
    expect((await rpc(s.cookie, 'keys.mySlots')).body.data.map((x: any) => x.keyVersion)).toEqual([1, 2])
    expect(await logOf('key_rotation_started')).toMatchObject([{ userId: a.id }])
    expect((await rpc(a.cookie, 'access.list')).body.data.filter((x: any) => x.hasAccess)).toHaveLength(2)
  })

  it('odrzuca zły zestaw slotów, złą wersję, drugą rotację w trakcie i administratora bez slotu', async () => {
    const { a, s } = await org()
    const other = await account('staff')
    expect((await rpc(a.cookie, 'keys.rotateStart', startInput([a.id]))).body.code).toBe('VALIDATION') // brak pracownika
    expect((await rpc(a.cookie, 'keys.rotateStart', startInput([a.id, s.id, other.id]))).body.code).toBe('VALIDATION') // osoba bez dostępu
    expect((await rpc(a.cookie, 'keys.rotateStart', startInput([a.id, a.id, s.id]))).body.code).toBe('VALIDATION') // powtórzenie
    expect((await rpc(a.cookie, 'keys.rotateStart', startInput([a.id, s.id], 3))).body.code).toBe('VALIDATION')
    const noSlot = await account('admin')
    expect((await rpc(noSlot.cookie, 'keys.rotateStart', startInput([a.id, s.id]))).body.code).toBe('NO_KEY_ACCESS')
    expect(await db.select().from(orgKeys)).toHaveLength(1)

    expect((await rpc(a.cookie, 'keys.rotateStart', startInput([a.id, s.id]))).status).toBe(200)
    expect(await rpc(a.cookie, 'keys.rotateStart', startInput([a.id, s.id], 3))).toMatchObject({ status: 409, body: { code: 'ROTATION_IN_PROGRESS' } })
  })
})

describe('przeszyfrowanie i zakończenie', () => {
  it('przerwana rotacja wznawia się; zakończenie odrzucone przy pozostałych rekordach; stare sloty znikają', async () => {
    const { a, s } = await org()
    const ids = [await person(), await person(), await person()]
    const rows = [await sensitiveRow(ids[0]!), await sensitiveRow(ids[1]!), await sensitiveRow(ids[2]!)]
    await repoFor(db, writer).softDelete(contactSensitive, rows[2]!.id, 1) // w Koszu też trzeba przeszyfrować
    const files = [await attachmentRow(ids[0]!), await attachmentRow(ids[1]!)]
    await rpc(a.cookie, 'keys.rotateStart', startInput([a.id, s.id]))

    // pierwsza partia, potem „przerwa”
    const p1 = (await rpc(a.cookie, 'keys.rotatePending', { limit: 2 })).body.data
    expect(p1).toMatchObject({ currentVersion: 2, remaining: { sensitive: 3, attachments: 2 } })
    expect(p1.sensitive).toHaveLength(2)
    const sent = p1.sensitive.map((r: any) => ({ id: r.id, version: r.version, ...cipher() }))
    expect((await rpc(a.cookie, 'keys.rotateBatch', { keyVersion: 2, sensitive: sent })).body.data).toEqual({ updated: 2, conflicts: [] })
    expect(await rpc(a.cookie, 'keys.rotateFinish')).toMatchObject({ status: 409, body: { code: 'ROTATION_PENDING' } })

    // wznowienie: zostały tylko rekordy ze starszą wersją (także ten z Kosza)
    const p2 = (await rpc(a.cookie, 'keys.rotatePending')).body.data
    expect(p2.remaining).toEqual({ sensitive: 1, attachments: 2 })
    expect(p2.attachments.map((f: any) => f.id).sort()).toEqual(files.map((f) => f.id).sort())
    const last = p2.sensitive.map((r: any) => ({ id: r.id, version: r.version, ...cipher() }))
    const meta = p2.attachments.map((f: any) => ({ id: f.id, version: f.version, metaEnc: b64(200) }))
    expect((await rpc(a.cookie, 'keys.rotateBatch', { keyVersion: 2, sensitive: last, attachments: meta })).body.data).toEqual({ updated: 3, conflicts: [] })
    expect((await rpc(a.cookie, 'keys.rotatePending')).body.data).toMatchObject({ remaining: { sensitive: 0, attachments: 0 }, sensitive: [], attachments: [] })

    // w bazie dokładnie przesłane szyfrogramy w nowej wersji, `version` podbite, change_log bez wartości
    const saved = await db.select().from(contactSensitive).where(eq(contactSensitive.id, last[0].id))
    expect(saved).toMatchObject([{ keyVersion: 2, iv: last[0].iv, ciphertext: last[0].ciphertext, version: last[0].version + 1 }])
    expect((await db.select().from(contactSensitive).where(eq(contactSensitive.id, rows[2]!.id)))[0]).toMatchObject({ keyVersion: 2 })
    expect(await db.select().from(attachments).where(eq(attachments.id, meta[0].id))).toMatchObject([{ keyVersion: 2, metaEnc: meta[0].metaEnc, version: 2 }])
    const log = await db.select().from(changeLog).where(and(eq(changeLog.entityId, last[0].id), eq(changeLog.op, 'update')))
    expect(log.map((e) => e.changedFields)).toEqual([{ keyVersion: true, iv: true, ciphertext: true }])
    const fileLog = await db.select().from(changeLog).where(and(eq(changeLog.entityId, meta[0].id), eq(changeLog.op, 'update')))
    expect(fileLog.map((e) => e.changedFields)).toEqual([{ keyVersion: true, metaEnc: true }])

    expect((await rpc(a.cookie, 'keys.rotateFinish')).status).toBe(200)
    expect((await db.select().from(orgKeys).where(eq(orgKeys.version, 1)))[0]!.retiredAt).toEqual(clock())
    expect(new Set(await slotVersions())).toEqual(new Set([2]))
    expect(await db.select().from(keySlots).where(isNull(keySlots.userId))).toHaveLength(1)
    expect((await rpc(s.cookie, 'keys.mySlots')).body.data.map((x: any) => x.keyVersion)).toEqual([2])
    expect(await logOf('key_rotated')).toMatchObject([{ userId: a.id }])
    // po zakończeniu kolejna rotacja jest możliwa, a partie i koniec już nie
    expect((await rpc(a.cookie, 'keys.rotateFinish')).body.code).toBe('VALIDATION')
    expect((await rpc(a.cookie, 'keys.rotateBatch', { keyVersion: 2 })).body.code).toBe('VALIDATION')
  })

  it('zapis w trakcie rotacji idzie nową wersją; starą jest odrzucany; odsłonięcie starego rekordu działa', async () => {
    const { a, s } = await org()
    const [old, fresh] = [await person(), await person()]
    await sensitiveRow(old)
    await rpc(a.cookie, 'keys.rotateStart', startInput([a.id, s.id]))
    expect((await rpc(s.cookie, 'sensitive.save', { contactId: fresh, version: null, keyVersion: 1, ...cipher() })).body.code).toBe('VALIDATION')
    expect((await rpc(s.cookie, 'sensitive.save', { contactId: fresh, version: null, keyVersion: 2, ...cipher() })).status).toBe(200)
    expect((await rpc(s.cookie, 'sensitive.reveal', { contactId: old })).body.data).toMatchObject({ keyVersion: 1 })
    expect((await rpc(a.cookie, 'keys.rotatePending')).body.data.remaining).toEqual({ sensitive: 1, attachments: 0 })
  })

  it('konflikt wersji przy równoczesnej edycji: rekord pominięty, zapis pracownika zostaje', async () => {
    const { a, s } = await org()
    const id = await person()
    await sensitiveRow(id)
    await rpc(a.cookie, 'keys.rotateStart', startInput([a.id, s.id]))
    const pending = (await rpc(a.cookie, 'keys.rotatePending')).body.data.sensitive[0]
    const staffWrite = cipher()
    expect((await rpc(s.cookie, 'sensitive.save', { contactId: id, version: 1, keyVersion: 2, ...staffWrite })).body.data).toEqual({ version: 2 })
    const res = await rpc(a.cookie, 'keys.rotateBatch', { keyVersion: 2, sensitive: [{ id: pending.id, version: pending.version, ...cipher() }] })
    expect(res.body.data).toEqual({ updated: 0, conflicts: [pending.id] })
    expect(await db.select().from(contactSensitive)).toMatchObject([{ keyVersion: 2, version: 2, ciphertext: staffWrite.ciphertext }])
    expect((await rpc(a.cookie, 'keys.rotateFinish')).status).toBe(200)
  })

  it('partia tylko bieżącą wersją i tylko przez administratora ze slotami do wszystkich wersji', async () => {
    const { a, s } = await org()
    const row = await sensitiveRow(await person())
    await rpc(a.cookie, 'keys.rotateStart', startInput([a.id, s.id]))
    const item = { id: row.id, version: 1, ...cipher() }
    expect((await rpc(a.cookie, 'keys.rotateBatch', { keyVersion: 1, sensitive: [item] })).body.code).toBe('VALIDATION')
    const noSlot = await account('admin', [2])
    expect((await rpc(noSlot.cookie, 'keys.rotatePending')).body.code).toBe('NO_KEY_ACCESS')
    expect((await rpc(noSlot.cookie, 'keys.rotateBatch', { keyVersion: 2, sensitive: [item] })).body.code).toBe('NO_KEY_ACCESS')
    expect((await rpc(noSlot.cookie, 'keys.rotateFinish')).body.code).toBe('NO_KEY_ACCESS')
    expect((await rpc(s.cookie, 'keys.rotatePending')).status).toBe(403)
    expect(await db.select().from(contactSensitive)).toMatchObject([{ keyVersion: 1, version: 1 }])
  })
})
