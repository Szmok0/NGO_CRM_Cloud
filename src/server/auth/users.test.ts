// Użytkownicy i zaproszenia przez HTTP na lokalnej bazie testowej. Reguła „ostatni administrator” zależy od wszystkich
// kont w bazie, dlatego plik czyści tabele kont przed każdym testem (pliki testów biegną po kolei).
import { randomBytes, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { buildApp } from '../app'
import type { Db } from '../db/connection'
import { accessLog, authSessions, changeLog, invitations, keySlots, orgKeys, users } from '../db/schema'
import { openTestDb } from '../testDb'
import { dbSessions, hashToken, SESSION_COOKIE } from './sessions'
import { TEST_APP_SECRET, TEST_SCRYPT, addTestUser, sessionCookieFor, wipeAccounts } from './testkit'
import { base32Decode, hotp, totpStep } from './totp'

const HOST = 'crm.example.org'
const baseHeaders = { host: HOST, 'x-forwarded-proto': 'https', origin: `https://${HOST}`, 'x-ngo-crm': '1', 'x-forwarded-for': '198.51.100.30' }
const HOUR = 3_600_000

let db: Db
let close: () => Promise<void>
const apps: ReturnType<typeof buildApp>[] = []
let nowMs = Date.now()
const clock = () => new Date(nowMs)
type App = ReturnType<typeof buildApp>

function makeApp() {
  const app = buildApp(db, [], dbSessions(db, clock), { appSecret: TEST_APP_SECRET, now: clock, scryptParams: TEST_SCRYPT })
  apps.push(app)
  return app
}
async function post(app: App, url: string, payload: unknown, opts: { cookie?: string; ip?: string } = {}) {
  const headers = { ...baseHeaders, ...(opts.ip ? { 'x-forwarded-for': opts.ip } : {}), ...(opts.cookie ? { cookie: opts.cookie } : {}) }
  const res = await app.inject({ method: 'POST', url, headers, payload: payload as object })
  const set = res.cookies.find((c) => c.name === SESSION_COOKIE)
  return { status: res.statusCode, body: res.json() as { ok: boolean; code?: string; data?: any }, cookie: set ? `${SESSION_COOKIE}=${set.value}` : undefined }
}
const rpc = (app: App, cookie: string | undefined, method: string, params?: unknown) => post(app, '/api/rpc', { method, params }, { cookie })
const row = async (id: string) => (await db.select().from(users).where(eq(users.id, id)))[0]!
const sealed = () => `v1.${randomBytes(12).toString('base64')}.${randomBytes(64).toString('base64')}`

/** Administrator z sesją. */
async function admin() {
  const u = await addTestUser(db, { role: 'admin', now: clock() })
  return { ...u, cookie: await sessionCookieFor(db, u.id, clock()) }
}
const invite = async (app: App, a: { cookie: string }, email = `nowa-osoba-${randomUUID()}@example.invalid`, role = 'staff') => {
  const res = await rpc(app, a.cookie, 'users.invite', { email, role })
  expect(res.status).toBe(200)
  const [u] = await db.select().from(users).where(eq(users.email, email))
  return { token: res.body.data.token as string, expiresAt: res.body.data.expiresAt as string, email, userId: u!.id }
}
/** Przechodzi przyjęcie zaproszenia; zwraca dane nowego konta. */
async function accept(app: App, token: string, over: Record<string, unknown> = {}) {
  const totp = await post(app, '/api/invite/totp', { token })
  if (totp.status !== 200) return { res: totp, authKey: '', secret: '' }
  const { secret, enrollment } = totp.body.data as { secret: string; enrollment: string }
  const authKey = randomBytes(32).toString('base64')
  const res = await post(app, '/api/invite/accept', {
    token,
    enrollment,
    totpCode: hotp(base32Decode(secret), totpStep(nowMs)),
    name: 'Nowa Osoba',
    authKey,
    kdfSalt: randomBytes(16).toString('base64'),
    kdfIterations: 600_000,
    publicKey: randomBytes(420).toString('base64'),
    privateKeyEnc: sealed(),
    ...over
  })
  return { res, authKey, secret }
}

beforeAll(async () => {
  ;({ db, close } = await openTestDb())
})
beforeEach(() => wipeAccounts(db))
afterAll(async () => {
  if (!db) return
  await Promise.all(apps.map((a) => a.close()))
  await wipeAccounts(db)
  await close()
})

describe('lista użytkowników', () => {
  it('administrator widzi konta bez haseł, sekretów i kluczy', async () => {
    const app = makeApp()
    const a = await admin()
    const staff = await addTestUser(db, { now: clock() })
    const res = await rpc(app, a.cookie, 'users.list')
    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(2)
    expect(res.body.data.find((u: any) => u.id === staff.id)).toEqual({ id: staff.id, version: 1, name: 'Konto testowe', email: staff.email, role: 'staff', status: 'active', totpEnabled: true, lastLoginAt: null, inviteExpiresAt: null })
    const text = JSON.stringify(res.body)
    for (const secret of [(await row(staff.id)).authHash!, (await row(staff.id)).totpSecretEnc!, (await row(staff.id)).privateKeyEnc!, staff.authKey]) expect(text).not.toContain(secret)
  })

  it('pracownik i osoba tylko do odczytu nie mają dostępu do żadnej metody użytkowników', async () => {
    const app = makeApp()
    for (const role of ['staff', 'readonly']) {
      const u = await addTestUser(db, { role, now: clock() })
      const cookie = await sessionCookieFor(db, u.id, clock())
      for (const [method, params] of [['users.list'], ['users.invite', { email: 'x@example.invalid', role: 'admin' }], ['users.setRole', { id: u.id, version: 1, role: 'admin' }], ['users.disable', { id: u.id, version: 1 }], ['users.reset', { id: u.id, version: 1 }]] as const) {
        expect(await rpc(app, cookie, method, params)).toMatchObject({ status: 403, body: { code: 'FORBIDDEN' } })
      }
      expect((await row(u.id)).role).toBe(role)
    }
  })
})

describe('zaproszenie', () => {
  it('zakłada konto w stanie „zaproszone” i daje jednorazowy token ważny 72 h; w bazie tylko skrót tokenu', async () => {
    const app = makeApp()
    const a = await admin()
    const inv = await invite(app, a, 'Nowa.Osoba@Example.Invalid ', 'readonly')
    expect(inv.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(new Date(inv.expiresAt).getTime()).toBe(nowMs + 72 * HOUR)

    const [u] = await db.select().from(users).where(eq(users.email, 'nowa.osoba@example.invalid'))
    expect(u).toMatchObject({ role: 'readonly', status: 'invited', authHash: null, totpEnabledAt: null, updatedBy: a.id })
    const [stored] = await db.select().from(invitations)
    expect(stored).toMatchObject({ userId: u!.id, invitedBy: a.id, tokenHash: hashToken(inv.token), usedAt: null })
    expect(JSON.stringify(stored)).not.toContain(inv.token)
    expect(await db.select().from(accessLog).where(eq(accessLog.action, 'user_invited'))).toMatchObject([{ userId: a.id, targetId: u!.id }])

    const list = (await rpc(app, a.cookie, 'users.list')).body.data.find((x: any) => x.id === u!.id)
    expect(list).toMatchObject({ status: 'invited', totpEnabled: false, inviteExpiresAt: inv.expiresAt })
  })

  it('zajęty e-mail → EMAIL_TAKEN; zły e-mail albo rola → 400', async () => {
    const app = makeApp()
    const a = await admin()
    expect(await rpc(app, a.cookie, 'users.invite', { email: a.email, role: 'staff' })).toMatchObject({ status: 409, body: { code: 'EMAIL_TAKEN' } })
    expect((await rpc(app, a.cookie, 'users.invite', { email: 'to-nie-email', role: 'staff' })).status).toBe(400)
    expect((await rpc(app, a.cookie, 'users.invite', { email: 'ok@example.invalid', role: 'szef' })).status).toBe(400)
    expect(await db.select().from(users)).toHaveLength(1)
  })

  it('zaproszona osoba nie może się zalogować, dopóki nie przyjmie zaproszenia', async () => {
    const app = makeApp()
    const inv = await invite(app, await admin())
    expect((await post(app, '/api/auth/login', { email: inv.email, authKey: randomBytes(32).toString('base64') })).status).toBe(401)
  })
})

describe('przyjęcie zaproszenia', () => {
  it('link pokazuje, czyje to zaproszenie; przyjęcie ustawia hasło, 2FA i klucze, bez slotu; potem da się zalogować', async () => {
    const app = makeApp()
    const a = await admin()
    const inv = await invite(app, a)
    expect((await post(app, '/api/invite/info', { token: inv.token })).body.data).toEqual({ userId: inv.userId, email: inv.email, orgName: '' })

    const { res, authKey, secret } = await accept(app, inv.token)
    expect(res.status).toBe(200)
    expect(res.cookie).toBeUndefined() // bez automatycznego zalogowania
    const u = await row(inv.userId)
    expect(u).toMatchObject({ name: 'Nowa Osoba', status: 'active', role: 'staff', failedAttempts: 0 })
    expect(u.totpEnabledAt).toEqual(clock())
    expect(u.authHash).toMatch(/^scrypt\$/)
    expect(u.privateKeyEnc).toMatch(/^v1\./)
    expect(await db.select().from(keySlots)).toHaveLength(0) // dostęp do danych wrażliwych nadaje się osobno
    expect((await db.select().from(invitations))[0]!.usedAt).toEqual(clock())
    expect(JSON.stringify(await db.select().from(changeLog))).not.toContain(u.authHash!)

    const pre = await post(app, '/api/auth/login', { email: inv.email, authKey })
    expect(pre.status).toBe(200)
    nowMs += 30_000 // kod z przyjęcia zaproszenia jest zużyty
    const full = await post(app, '/api/auth/totp', { code: hotp(base32Decode(secret), totpStep(nowMs)) }, { cookie: pre.cookie })
    expect(full.status).toBe(200)
    expect((await rpc(app, full.cookie, 'auth.me')).body.data).toMatchObject({ userId: inv.userId, role: 'staff', totpVerified: true })
  })

  it('link działa raz: po przyjęciu jest nieważny', async () => {
    const app = makeApp()
    const inv = await invite(app, await admin())
    expect((await accept(app, inv.token)).res.status).toBe(200)
    expect(await post(app, '/api/invite/info', { token: inv.token })).toMatchObject({ status: 400, body: { code: 'INVITE_INVALID' } })
    expect((await accept(app, inv.token)).res.status).toBe(400)
  })

  it('link wygasa po 72 h', async () => {
    const app = makeApp()
    const inv = await invite(app, await admin())
    nowMs += 72 * HOUR - 1000
    expect((await post(app, '/api/invite/info', { token: inv.token })).status).toBe(200)
    nowMs += 1000
    expect(await post(app, '/api/invite/info', { token: inv.token })).toMatchObject({ status: 400, body: { code: 'INVITE_INVALID' } })
    expect((await accept(app, inv.token)).res.status).toBe(400)
    expect((await row(inv.userId)).status).toBe('invited')
  })

  it('zły token, błędny kod TOTP i złe formaty → nic się nie zmienia, link dalej działa', async () => {
    const app = makeApp()
    const inv = await invite(app, await admin())
    expect((await post(app, '/api/invite/info', { token: randomBytes(32).toString('base64url') })).status).toBe(400)
    expect((await post(app, '/api/invite/info', { token: 'krotki' })).status).toBe(400)
    expect((await accept(app, inv.token, { totpCode: 'abcdef' })).res).toMatchObject({ status: 400, body: { code: 'TOTP_INVALID' } })
    expect((await accept(app, inv.token, { authKey: 'haslo-jawnym-tekstem' })).res.status).toBe(400)
    expect((await accept(app, inv.token, { privateKeyEnc: 'klucz-jawnie' })).res.status).toBe(400)
    expect((await accept(app, inv.token, { name: '  ' })).res.status).toBe(400)
    expect(await row(inv.userId)).toMatchObject({ status: 'invited', authHash: null })
    expect((await accept(app, inv.token)).res.status).toBe(200)
  })

  it('konfiguracja 2FA z cudzego zaproszenia nie pasuje do innego konta', async () => {
    const app = makeApp()
    const a = await admin()
    const [one, two] = [await invite(app, a), await invite(app, a)]
    const { secret, enrollment } = (await post(app, '/api/invite/totp', { token: one.token })).body.data
    const res = await post(app, '/api/invite/accept', { token: two.token, enrollment, totpCode: hotp(base32Decode(secret), totpStep(nowMs)), name: 'Podmiana', authKey: randomBytes(32).toString('base64'), kdfSalt: randomBytes(16).toString('base64'), kdfIterations: 600_000, publicKey: randomBytes(420).toString('base64'), privateKeyEnc: sealed() })
    expect(res).toMatchObject({ status: 400, body: { code: 'INVITE_INVALID' } })
    expect((await row(two.userId)).status).toBe('invited')
    expect((await row(one.userId)).status).toBe('invited')
  })

  it('dwa równoczesne przyjęcia tego samego linku: udaje się dokładnie jedno', async () => {
    const app = makeApp()
    const inv = await invite(app, await admin())
    const results = await Promise.all([accept(app, inv.token), accept(app, inv.token)])
    expect(results.map((r) => r.res.status).sort()).toEqual([200, 400])
    expect((await row(inv.userId)).status).toBe('active')
  })

  it('zgadywanie tokenu jest ograniczone limitem prób z adresu IP', async () => {
    const app = makeApp()
    const inv = await invite(app, await admin())
    const ip = '203.0.113.90'
    for (let i = 0; i < 20; i++) expect((await post(app, '/api/invite/info', { token: randomBytes(32).toString('base64url') }, { ip })).status).toBe(400)
    expect(await post(app, '/api/invite/info', { token: inv.token }, { ip })).toMatchObject({ status: 429 })
    expect((await post(app, '/api/invite/info', { token: inv.token })).status).toBe(200)
  })
})

describe('zmiana roli', () => {
  it('zmienia rolę, podbija wersję i zapisuje zmianę; stara wersja → VERSION_CONFLICT', async () => {
    const app = makeApp()
    const a = await admin()
    const u = await addTestUser(db, { now: clock() })
    expect((await rpc(app, a.cookie, 'users.setRole', { id: u.id, version: 1, role: 'readonly' })).status).toBe(200)
    expect(await row(u.id)).toMatchObject({ role: 'readonly', version: 2, updatedBy: a.id })
    expect(await db.select().from(changeLog)).toMatchObject([{ entity: 'users', entityId: u.id, op: 'update', changedFields: { role: 'readonly' }, userId: a.id }])
    expect(await rpc(app, a.cookie, 'users.setRole', { id: u.id, version: 1, role: 'admin' })).toMatchObject({ status: 409, body: { code: 'VERSION_CONFLICT' } })
    expect((await row(u.id)).role).toBe('readonly')
    expect((await rpc(app, a.cookie, 'users.setRole', { id: randomUUID(), version: 1, role: 'staff' })).status).toBe(404)
  })

  it('ostatniego aktywnego administratora nie da się zdegradować; z drugim administratorem już tak', async () => {
    const app = makeApp()
    const a = await admin()
    await addTestUser(db, { role: 'admin', status: 'disabled', now: clock() }) // wyłączony administrator się nie liczy
    expect(await rpc(app, a.cookie, 'users.setRole', { id: a.id, version: 1, role: 'staff' })).toMatchObject({ status: 409, body: { code: 'LAST_ADMIN' } })
    expect((await row(a.id)).role).toBe('admin')

    const b = await addTestUser(db, { now: clock() })
    expect((await rpc(app, a.cookie, 'users.setRole', { id: b.id, version: 1, role: 'admin' })).status).toBe(200)
    expect((await rpc(app, a.cookie, 'users.setRole', { id: a.id, version: 1, role: 'staff' })).status).toBe(200)
    // po degradacji dawny administrator traci dostęp do metod administratora przy następnym żądaniu
    expect((await rpc(app, a.cookie, 'users.list')).status).toBe(403)
  })
})

describe('wyłączenie konta', () => {
  it('kończy sesję tej osoby przy następnym żądaniu, usuwa sloty i zaproszenia; wyłączona osoba się nie zaloguje', async () => {
    const app = makeApp()
    const a = await admin()
    const u = await addTestUser(db, { now: clock() })
    const theirCookie = await sessionCookieFor(db, u.id, clock())
    await db.insert(orgKeys).values({ version: 1, createdAt: clock(), createdBy: a.id })
    await db.insert(keySlots).values({ id: randomUUID(), userId: u.id, keyVersion: 1, wrappedKey: 'slot', grantedBy: a.id, grantedAt: clock() })
    expect((await rpc(app, theirCookie, 'auth.me')).status).toBe(200)

    expect((await rpc(app, a.cookie, 'users.disable', { id: u.id, version: 1 })).status).toBe(200)
    expect(await row(u.id)).toMatchObject({ status: 'disabled', version: 2 })
    expect((await rpc(app, theirCookie, 'auth.me')).status).toBe(401)
    expect(await db.select().from(authSessions).where(eq(authSessions.userId, u.id))).toHaveLength(0)
    expect(await db.select().from(keySlots)).toHaveLength(0)
    expect((await post(app, '/api/auth/login', { email: u.email, authKey: u.authKey })).status).toBe(401)
    expect(await db.select().from(accessLog).where(eq(accessLog.action, 'user_disabled'))).toMatchObject([{ userId: a.id, targetId: u.id }])
    expect((await rpc(app, a.cookie, 'auth.me')).status).toBe(200) // sesja administratora bez zmian
  })

  it('wyłączenie zaproszonej osoby unieważnia jej link', async () => {
    const app = makeApp()
    const a = await admin()
    const inv = await invite(app, a)
    expect((await rpc(app, a.cookie, 'users.disable', { id: inv.userId, version: 1 })).status).toBe(200)
    expect((await post(app, '/api/invite/info', { token: inv.token })).status).toBe(400)
    expect((await accept(app, inv.token)).res.status).toBe(400)
  })

  it('ostatniego aktywnego administratora nie da się wyłączyć ani zresetować', async () => {
    const app = makeApp()
    const a = await admin()
    await addTestUser(db, { now: clock() })
    expect(await rpc(app, a.cookie, 'users.disable', { id: a.id, version: 1 })).toMatchObject({ status: 409, body: { code: 'LAST_ADMIN' } })
    expect(await rpc(app, a.cookie, 'users.reset', { id: a.id, version: 1 })).toMatchObject({ status: 409, body: { code: 'LAST_ADMIN' } })
    expect(await row(a.id)).toMatchObject({ status: 'active', version: 1 })
    expect((await rpc(app, a.cookie, 'auth.me')).status).toBe(200)
  })

  it('dwóch administratorów wyłącza się nawzajem w tej samej chwili: zostaje co najmniej jeden aktywny', async () => {
    const app = makeApp()
    const [a, b] = [await admin(), await admin()]
    await Promise.all([rpc(app, a.cookie, 'users.disable', { id: b.id, version: 1 }), rpc(app, b.cookie, 'users.disable', { id: a.id, version: 1 })])
    const active = (await db.select().from(users)).filter((u) => u.role === 'admin' && u.status === 'active')
    expect(active.length).toBeGreaterThanOrEqual(1)
  })
})

describe('reset konta (zapomniane hasło)', () => {
  it('stare hasło i sesje przestają działać, sloty znikają; nowy link pozwala ustawić nowe hasło', async () => {
    const app = makeApp()
    const a = await admin()
    const u = await addTestUser(db, { now: clock() })
    const theirCookie = await sessionCookieFor(db, u.id, clock())
    await db.insert(orgKeys).values({ version: 1, createdAt: clock(), createdBy: a.id })
    await db.insert(keySlots).values({ id: randomUUID(), userId: u.id, keyVersion: 1, wrappedKey: 'slot', grantedBy: a.id, grantedAt: clock() })

    const res = await rpc(app, a.cookie, 'users.reset', { id: u.id, version: 1 })
    expect(res.status).toBe(200)
    expect(await row(u.id)).toMatchObject({ status: 'invited', authHash: null, kdfSalt: null, totpSecretEnc: null, totpEnabledAt: null, publicKey: null, privateKeyEnc: null })
    expect((await rpc(app, theirCookie, 'auth.me')).status).toBe(401)
    expect(await db.select().from(keySlots)).toHaveLength(0)
    expect((await post(app, '/api/auth/login', { email: u.email, authKey: u.authKey })).status).toBe(401)

    const done = await accept(app, res.body.data.token)
    expect(done.res.status).toBe(200)
    expect(await row(u.id)).toMatchObject({ status: 'active', role: 'staff' })
    expect((await post(app, '/api/auth/login', { email: u.email, authKey: u.authKey })).status).toBe(401) // stare hasło
    expect((await post(app, '/api/auth/login', { email: u.email, authKey: done.authKey })).status).toBe(200)
  })

  it('ponowne zaproszenie unieważnia poprzedni link; reset przywraca wyłączone konto', async () => {
    const app = makeApp()
    const a = await admin()
    const inv = await invite(app, a)
    const again = await rpc(app, a.cookie, 'users.reset', { id: inv.userId, version: 1 })
    expect(again.status).toBe(200)
    expect((await post(app, '/api/invite/info', { token: inv.token })).status).toBe(400)
    expect((await post(app, '/api/invite/info', { token: again.body.data.token })).status).toBe(200)

    const u = await addTestUser(db, { status: 'disabled', now: clock() })
    const back = await rpc(app, a.cookie, 'users.reset', { id: u.id, version: 1 })
    expect((await accept(app, back.body.data.token)).res.status).toBe(200)
    expect((await row(u.id)).status).toBe('active')
  })
})
