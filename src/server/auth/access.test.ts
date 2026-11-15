// Dostęp do danych wrażliwych (sloty klucza organizacji) przez HTTP na lokalnej bazie testowej (ZADANIE_03, krok 1a).
// Sloty to tu losowe bajty: serwer ich nie otwiera, tylko przechowuje i wydaje.
import { randomBytes, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { buildApp } from '../app'
import type { Db } from '../db/connection'
import { accessLog, authSessions, keySlots, orgKeys } from '../db/schema'
import { openTestDb } from '../testDb'
import { dbSessions } from './sessions'
import { TEST_APP_SECRET, TEST_SCRYPT, addTestUser, sessionCookieFor, wipeAccounts } from './testkit'

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
const wrapped = () => randomBytes(256).toString('base64')
const publicKey = () => randomBytes(294).toString('base64')

/** Konto z kluczem publicznym i sesją. */
async function account(role: 'admin' | 'staff' | 'readonly' = 'staff', status = 'active') {
  const u = await addTestUser(db, { role, status, now: clock(), publicKey: publicKey() })
  return { ...u, cookie: await sessionCookieFor(db, u.id, clock()) }
}
async function orgKey(version: number, retired = false) {
  await db.insert(orgKeys).values({ version, createdAt: clock(), createdBy: randomUUID(), retiredAt: retired ? clock() : null })
}
async function slot(userId: string | null, keyVersion: number, wrappedKey = wrapped()) {
  await db.insert(keySlots).values({ id: randomUUID(), userId, keyVersion, wrappedKey, grantedBy: randomUUID(), grantedAt: clock() })
  return wrappedKey
}
const slotsOf = async (userId: string) => (await db.select().from(keySlots).where(eq(keySlots.userId, userId))).map((s) => s.keyVersion).sort()
const logOf = (action: string) => db.select().from(accessLog).where(eq(accessLog.action, action))

/** Organizacja z wersją 1 klucza, slotem odzyskiwania i administratorem ze slotem. */
async function org() {
  await orgKey(1)
  const recovery = await slot(null, 1, `v1.${randomBytes(12).toString('base64')}.${randomBytes(48).toString('base64')}`)
  const a = await account('admin')
  await slot(a.id, 1)
  return { a, recovery }
}

beforeAll(async () => {
  ;({ db, close } = await openTestDb())
  app = buildApp(db, [], dbSessions(db, clock), { appSecret: TEST_APP_SECRET, now: clock, scryptParams: TEST_SCRYPT })
})
beforeEach(() => wipeAccounts(db))
afterAll(async () => {
  if (!db) return
  await app?.close()
  await wipeAccounts(db)
  await close()
})

describe('keys.mySlots', () => {
  it('zwraca tylko własne sloty do niewycofanych wersji; każda rola', async () => {
    const { a } = await org()
    await orgKey(2)
    await orgKey(3, true)
    const r = await account('readonly')
    const mine2 = await slot(r.id, 2)
    await slot(r.id, 3) // wersja wycofana
    expect((await rpc(r.cookie, 'keys.mySlots')).body.data).toEqual([{ keyVersion: 2, wrappedKey: mine2 }])
    expect((await rpc(a.cookie, 'keys.mySlots')).body.data).toHaveLength(1)
    const s = await account('staff')
    expect(await rpc(s.cookie, 'keys.mySlots')).toMatchObject({ status: 200, body: { data: [] } })
  })
})

describe('nadawanie i odbieranie dostępu', () => {
  it('nadanie zapisuje sloty i wpis w dzienniku; odebranie usuwa sloty i kończy sesje osoby', async () => {
    const { a } = await org()
    const s = await account('staff')
    const w = wrapped()
    expect((await rpc(a.cookie, 'access.grant', { userId: s.id, slots: [{ keyVersion: 1, wrappedKey: w }] })).status).toBe(200)
    expect((await rpc(s.cookie, 'keys.mySlots')).body.data).toEqual([{ keyVersion: 1, wrappedKey: w }])
    expect(await db.select().from(keySlots).where(eq(keySlots.userId, s.id))).toMatchObject([{ grantedBy: a.id, grantedAt: clock() }])
    expect(await logOf('grant_access')).toMatchObject([{ userId: a.id, targetType: 'user', targetId: s.id }])
    expect((await rpc(a.cookie, 'access.list')).body.data.find((x: any) => x.userId === s.id)).toMatchObject({ hasAccess: true })

    expect(await rpc(a.cookie, 'access.revoke', { userId: s.id })).toMatchObject({ status: 200, body: { data: { hadAccess: true } } })
    expect(await slotsOf(s.id)).toEqual([])
    expect(await db.select().from(authSessions).where(eq(authSessions.userId, s.id))).toHaveLength(0)
    expect((await rpc(s.cookie, 'auth.me')).status).toBe(401)
    expect(await logOf('revoke_access')).toMatchObject([{ userId: a.id, targetId: s.id }])
    expect((await rpc(a.cookie, 'auth.me')).status).toBe(200) // sesja administratora bez zmian

    // po ponownym zalogowaniu osoba nie ma slotów
    const again = await sessionCookieFor(db, s.id, clock())
    expect((await rpc(again, 'keys.mySlots')).body.data).toEqual([])
    // ponowne odebranie: nic do odebrania, sesje zostają, bez wpisu
    expect(await rpc(a.cookie, 'access.revoke', { userId: s.id })).toMatchObject({ status: 200, body: { data: { hadAccess: false } } })
    expect((await rpc(again, 'auth.me')).status).toBe(200)
    expect(await logOf('revoke_access')).toHaveLength(1)
  })

  it('osoba tylko do odczytu może dostać slot (dostęp to slot, nie rola)', async () => {
    const { a } = await org()
    const r = await account('readonly')
    expect((await rpc(a.cookie, 'access.grant', { userId: r.id, slots: [{ keyVersion: 1, wrappedKey: wrapped() }] })).status).toBe(200)
    expect(await slotsOf(r.id)).toEqual([1])
  })

  it('administrator bez własnego slotu nie nadaje dostępu (NO_KEY_ACCESS)', async () => {
    await org()
    const b = await account('admin')
    const s = await account('staff')
    expect(await rpc(b.cookie, 'access.grant', { userId: s.id, slots: [{ keyVersion: 1, wrappedKey: wrapped() }] })).toMatchObject({ status: 403, body: { code: 'NO_KEY_ACCESS' } })
    expect(await slotsOf(s.id)).toEqual([])
    expect(await logOf('grant_access')).toHaveLength(0)
  })

  it('administrator bez slotu do jednej z niewycofanych wersji też nie nadaje', async () => {
    const { a } = await org()
    await orgKey(2) // np. przerwana zmiana klucza; administrator ma tylko wersję 1
    const s = await account('staff')
    const res = await rpc(a.cookie, 'access.grant', { userId: s.id, slots: [{ keyVersion: 1, wrappedKey: wrapped() }, { keyVersion: 2, wrappedKey: wrapped() }] })
    expect(res).toMatchObject({ status: 403, body: { code: 'NO_KEY_ACCESS' } })
  })

  it('konto bez klucza publicznego, zaproszone albo wyłączone → ACCOUNT_NOT_READY', async () => {
    const { a } = await org()
    const noKey = await addTestUser(db, { now: clock() })
    const invited = await account('staff', 'invited')
    const disabled = await account('staff', 'disabled')
    for (const id of [noKey.id, invited.id, disabled.id]) {
      expect(await rpc(a.cookie, 'access.grant', { userId: id, slots: [{ keyVersion: 1, wrappedKey: wrapped() }] })).toMatchObject({ status: 409, body: { code: 'ACCOUNT_NOT_READY' } })
      expect(await slotsOf(id)).toEqual([])
    }
    expect(await rpc(a.cookie, 'access.grant', { userId: randomUUID(), slots: [{ keyVersion: 1, wrappedKey: wrapped() }] })).toMatchObject({ status: 404 })
  })

  it('sloty muszą obejmować dokładnie niewycofane wersje', async () => {
    const { a } = await org()
    await orgKey(2)
    await slot(a.id, 2)
    await orgKey(3, true)
    const s = await account('staff')
    const grant = (versions: number[]) => rpc(a.cookie, 'access.grant', { userId: s.id, slots: versions.map((keyVersion) => ({ keyVersion, wrappedKey: wrapped() })) })
    for (const versions of [[1], [2], [1, 1], [1, 2, 3], [1, 2, 4]]) {
      expect(await grant(versions)).toMatchObject({ status: 400, body: { code: 'VALIDATION' } })
    }
    expect(await slotsOf(s.id)).toEqual([])
    expect((await grant([2, 1])).status).toBe(200)
    expect(await slotsOf(s.id)).toEqual([1, 2])
  })

  it('ponowne nadanie → ACCESS_EXISTS, sloty bez zmian', async () => {
    const { a } = await org()
    const s = await account('staff')
    const first = wrapped()
    expect((await rpc(a.cookie, 'access.grant', { userId: s.id, slots: [{ keyVersion: 1, wrappedKey: first }] })).status).toBe(200)
    expect(await rpc(a.cookie, 'access.grant', { userId: s.id, slots: [{ keyVersion: 1, wrappedKey: wrapped() }] })).toMatchObject({ status: 409, body: { code: 'ACCESS_EXISTS' } })
    expect((await db.select().from(keySlots).where(eq(keySlots.userId, s.id))).map((x) => x.wrappedKey)).toEqual([first])
  })

  it('slot w złym formacie → 400', async () => {
    const { a } = await org()
    const s = await account('staff')
    for (const wrappedKey of ['klucz jawnym tekstem', 'A'.repeat(1001)]) {
      expect((await rpc(a.cookie, 'access.grant', { userId: s.id, slots: [{ keyVersion: 1, wrappedKey }] })).status).toBe(400)
    }
  })

  it('administrator nie odbiera dostępu samemu sobie', async () => {
    const { a } = await org()
    expect(await rpc(a.cookie, 'access.revoke', { userId: a.id })).toMatchObject({ status: 400, body: { code: 'VALIDATION' } })
    expect(await slotsOf(a.id)).toEqual([1])
  })

  it('access.list: dostęp do bieżącej wersji i klucz publiczny tylko aktywnych kont', async () => {
    const { a } = await org()
    const invited = await account('staff', 'invited')
    const list = (await rpc(a.cookie, 'access.list')).body.data
    expect(list.find((x: any) => x.userId === a.id)).toMatchObject({ hasAccess: true, publicKey: expect.any(String) })
    expect(list.find((x: any) => x.userId === invited.id)).toEqual({ userId: invited.id, hasAccess: false, publicKey: null })
  })

  it('pracownik i osoba tylko do odczytu nie wywołują metod dostępu ani odzyskiwania', async () => {
    const { a } = await org()
    for (const role of ['staff', 'readonly'] as const) {
      const u = await account(role)
      await slot(u.id, 1)
      for (const [method, params] of [['access.list'], ['access.grant', { userId: a.id, slots: [{ keyVersion: 1, wrappedKey: wrapped() }] }], ['access.revoke', { userId: a.id }], ['keys.recoverySlot'], ['keys.recover', { keyVersion: 1, wrappedKey: wrapped() }]] as const) {
        expect(await rpc(u.cookie, method, params)).toMatchObject({ status: 403, body: { code: 'FORBIDDEN' } })
      }
    }
    expect(await slotsOf(a.id)).toEqual([1])
  })
})

describe('odzyskiwanie dostępu (keys.recover)', () => {
  it('administrator bez slotu dostaje slot odzyskiwania i zapisuje własny slot; wpis key_recovered', async () => {
    const { recovery } = await org()
    const b = await account('admin')
    expect(await rpc(b.cookie, 'keys.recoverySlot')).toMatchObject({ status: 200, body: { data: { keyVersion: 1, recoverySlot: recovery } } })
    const w = wrapped()
    expect((await rpc(b.cookie, 'keys.recover', { keyVersion: 1, wrappedKey: w })).status).toBe(200)
    expect(await db.select().from(keySlots).where(eq(keySlots.userId, b.id))).toMatchObject([{ keyVersion: 1, wrappedKey: w, grantedBy: b.id }])
    expect(await logOf('key_recovered')).toMatchObject([{ userId: b.id, targetId: null }])
    // już ma slot: ani slotu odzyskiwania, ani ponownego zapisu
    expect(await rpc(b.cookie, 'keys.recoverySlot')).toMatchObject({ status: 409, body: { code: 'ACCESS_EXISTS' } })
    expect(await rpc(b.cookie, 'keys.recover', { keyVersion: 1, wrappedKey: wrapped() })).toMatchObject({ status: 409, body: { code: 'ACCESS_EXISTS' } })
  })

  it('tylko bieżąca wersja klucza', async () => {
    await org()
    await orgKey(2)
    await slot(null, 2)
    const b = await account('admin')
    expect((await rpc(b.cookie, 'keys.recoverySlot')).body.data.keyVersion).toBe(2)
    expect(await rpc(b.cookie, 'keys.recover', { keyVersion: 1, wrappedKey: wrapped() })).toMatchObject({ status: 400, body: { code: 'VALIDATION' } })
    expect(await rpc(b.cookie, 'keys.recover', { keyVersion: 9, wrappedKey: wrapped() })).toMatchObject({ status: 400 })
    expect(await slotsOf(b.id)).toEqual([])
  })

  it('bez klucza organizacji → NOT_FOUND', async () => {
    const b = await account('admin')
    expect((await rpc(b.cookie, 'keys.recoverySlot')).status).toBe(404)
  })
})

describe('wyłączenie i reset konta zwracają, czy konto miało slot', () => {
  it('hadAccess przy wyłączeniu i resecie', async () => {
    const { a } = await org()
    const withSlot = await account('staff')
    await slot(withSlot.id, 1)
    const without = await account('staff')
    expect((await rpc(a.cookie, 'users.disable', { id: withSlot.id, version: 1 })).body.data).toEqual({ hadAccess: true })
    expect((await rpc(a.cookie, 'users.disable', { id: without.id, version: 1 })).body.data).toEqual({ hadAccess: false })

    const other = await account('readonly')
    await slot(other.id, 1)
    expect((await rpc(a.cookie, 'users.reset', { id: other.id, version: 1 })).body.data).toMatchObject({ hadAccess: true, token: expect.any(String) })
    expect(await slotsOf(other.id)).toEqual([])
  })
})
