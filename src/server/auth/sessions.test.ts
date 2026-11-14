// Sesje logowania na lokalnej bazie testowej (TEST_DATABASE_URL, zob. testDb.ts).
// Konta testowe istnieją tylko tu (fikcyjne, domena example.invalid) i są usuwane po testach.
import { randomBytes, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import type { Db } from '../db/connection'
import { authSessions, users } from '../db/schema'
import { openTestDb } from '../testDb'
import { buildApp } from '../app'
import {
  IDLE_TIMEOUT_MS,
  PRE_MFA_TTL_MS,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  createSession,
  dbSessions,
  getSession,
  hashToken,
  revokeAllSessions,
  revokeSession
} from './sessions'

let db: Db
let close: () => Promise<void>
const created: string[] = []
const T0 = new Date('2026-01-01T08:00:00.000Z')
const at = (ms: number) => new Date(T0.getTime() + ms)
const MIN = 60_000

async function testUser(role = 'staff', status = 'active') {
  const id = randomUUID()
  created.push(id)
  await db.insert(users).values({
    id,
    createdAt: T0,
    updatedAt: T0,
    updatedBy: id,
    version: 1,
    email: `sesja-test-${id}@example.invalid`,
    name: 'Konto testowe',
    role,
    status
  })
  return id
}

beforeAll(async () => {
  ;({ db, close } = await openTestDb())
})

afterAll(async () => {
  if (!db) return
  if (created.length) {
    await db.delete(authSessions).where(inArray(authSessions.userId, created))
    await db.delete(users).where(inArray(users.id, created))
    const [left] = await db.select({ id: users.id }).from(users).where(inArray(users.id, created))
    expect(left).toBeUndefined()
  }
  await close()
})

describe('sesje: zakładanie i odczyt', () => {
  it('pełna sesja: rola, 2FA, w bazie tylko skrót tokenu', async () => {
    const userId = await testUser('admin')
    const { token, expiresAt } = await createSession(db, userId, { mfaPassed: true, now: T0, userAgent: 'Testowa przeglądarka' })
    expect(expiresAt).toEqual(at(SESSION_TTL_MS))
    expect(await getSession(db, token, at(MIN))).toEqual({ userId, role: 'admin', totpVerified: true })

    const [row] = await db.select().from(authSessions).where(eq(authSessions.userId, userId))
    expect(row!.tokenHash).toBe(hashToken(token))
    expect(row!.tokenHash).not.toContain(token)
    expect(row!.userAgentHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('sesja przed 2FA: totpVerified false i ważna tylko 5 min', async () => {
    const userId = await testUser()
    const { token } = await createSession(db, userId, { mfaPassed: false, now: T0 })
    expect(await getSession(db, token, at(PRE_MFA_TTL_MS - 1000))).toMatchObject({ totpVerified: false })
    expect(await getSession(db, token, at(PRE_MFA_TTL_MS))).toBeNull()
  })
})

describe('sesje: wygaśnięcie', () => {
  it('pełna sesja kończy się po 12 h mimo ciągłej aktywności (bez przedłużania)', async () => {
    const userId = await testUser()
    const { token } = await createSession(db, userId, { mfaPassed: true, now: T0 })
    for (let t = 20 * MIN; t < SESSION_TTL_MS; t += 20 * MIN) {
      expect(await getSession(db, token, at(t))).not.toBeNull()
    }
    expect(await getSession(db, token, at(SESSION_TTL_MS))).toBeNull()
  })

  it('bezczynność ponad 30 min kończy sesję, a wygasła sesja znika z bazy', async () => {
    const userId = await testUser()
    const { token } = await createSession(db, userId, { mfaPassed: true, now: T0 })
    expect(await getSession(db, token, at(IDLE_TIMEOUT_MS))).not.toBeNull() // dokładnie 30 min: jeszcze ważna
    expect(await getSession(db, token, at(2 * IDLE_TIMEOUT_MS + 1))).toBeNull() // 30 min i 1 ms od ostatniej aktywności
    expect(await db.select().from(authSessions).where(eq(authSessions.tokenHash, hashToken(token)))).toHaveLength(0)
    expect(await getSession(db, token, at(2 * IDLE_TIMEOUT_MS + 2))).toBeNull()
  })

  it('konto wyłączone, zaproszone albo usunięte → brak sesji', async () => {
    for (const status of ['disabled', 'invited']) {
      const userId = await testUser('staff', status)
      const { token } = await createSession(db, userId, { mfaPassed: true, now: T0 })
      expect(await getSession(db, token, at(MIN))).toBeNull()
    }
    const userId = await testUser()
    const { token } = await createSession(db, userId, { mfaPassed: true, now: T0 })
    await db.update(users).set({ deletedAt: T0 }).where(eq(users.id, userId))
    expect(await getSession(db, token, at(MIN))).toBeNull()
  })
})

describe('sesje: nieprawidłowe ciasteczko', () => {
  it.each([
    ['brak', undefined],
    ['pusty', ''],
    ['losowy (sfałszowany) token', randomBytes(32).toString('base64url')],
    ['skrót z bazy zamiast tokenu', 'SKROT'],
    ['bardzo długi', 'x'.repeat(5000)]
  ])('%s → brak sesji', async (_name, value) => {
    const userId = await testUser()
    const { token } = await createSession(db, userId, { mfaPassed: true, now: T0 })
    const cookie = value === 'SKROT' ? hashToken(token) : value
    expect(await getSession(db, cookie, at(MIN))).toBeNull()
  })

  it('token zmieniony o jeden znak → brak sesji', async () => {
    const userId = await testUser()
    const { token } = await createSession(db, userId, { mfaPassed: true, now: T0 })
    const tampered = (token[0] === 'A' ? 'B' : 'A') + token.slice(1)
    expect(await getSession(db, tampered, at(MIN))).toBeNull()
    expect(await getSession(db, token, at(MIN))).not.toBeNull()
  })
})

describe('sesje: wylogowanie', () => {
  it('wylogowanie kończy tylko tę sesję', async () => {
    const userId = await testUser()
    const a = await createSession(db, userId, { mfaPassed: true, now: T0 })
    const b = await createSession(db, userId, { mfaPassed: true, now: T0 })
    await revokeSession(db, a.token)
    expect(await getSession(db, a.token, at(MIN))).toBeNull()
    expect(await getSession(db, b.token, at(MIN))).not.toBeNull()
  })

  it('„wyloguj wszędzie” kończy wszystkie sesje osoby, cudze zostają', async () => {
    const userId = await testUser()
    const other = await testUser()
    const mine = [await createSession(db, userId, { mfaPassed: true, now: T0 }), await createSession(db, userId, { mfaPassed: false, now: T0 })]
    const theirs = await createSession(db, other, { mfaPassed: true, now: T0 })
    await revokeAllSessions(db, userId)
    for (const s of mine) expect(await getSession(db, s.token, at(MIN))).toBeNull()
    expect(await getSession(db, theirs.token, at(MIN))).not.toBeNull()
  })
})

describe('sesje przez HTTP (dbSessions + strażnik RPC)', () => {
  const HOST = 'crm.example.org'
  const headers = { host: HOST, 'x-forwarded-proto': 'https', origin: `https://${HOST}`, 'x-ngo-crm': '1' }
  const me = (app: ReturnType<typeof buildApp>, cookie?: string) =>
    app.inject({ method: 'POST', url: '/api/rpc', headers: cookie ? { ...headers, cookie } : headers, payload: { method: 'auth.me' } })

  it('poprawne ciasteczko → 200; brak, sfałszowane albo pod inną nazwą → 401', async () => {
    const app = buildApp(db, [], dbSessions(db))
    const userId = await testUser('readonly')
    const { token } = await createSession(db, userId, { mfaPassed: true })

    const ok = await me(app, `${SESSION_COOKIE}=${token}`)
    expect(ok.statusCode).toBe(200)
    expect(ok.json()).toMatchObject({ ok: true, data: { userId, role: 'readonly' } })

    expect((await me(app)).statusCode).toBe(401)
    expect((await me(app, `${SESSION_COOKIE}=${randomBytes(32).toString('base64url')}`)).statusCode).toBe(401)
    expect((await me(app, `ngocrm_session=${token}`)).statusCode).toBe(401)
    await app.close()
  })
})
