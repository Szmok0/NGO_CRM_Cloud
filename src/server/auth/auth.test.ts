// Logowanie przez HTTP na lokalnej bazie testowej: cała ścieżka, blokady, wygaśnięcie, TOTP, ciasteczka.
// Konta, klucze i sekrety fikcyjne, tylko tutaj; wszystko usuwane po testach.
import { randomBytes, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { buildApp } from '../app'
import type { Db } from '../db/connection'
import { accessLog, authSessions, users } from '../db/schema'
import { openTestDb } from '../testDb'
import { IP_MAX_ATTEMPTS, IP_WINDOW_MS, LOCK_MS, MAX_FAILED_ATTEMPTS, createIpLimiter } from './lockout'
import { SCRYPT_PARAMS, hashAuthKey, verifyAuthKey, type ScryptParams } from './password'
import { PRE_MFA_TTL_MS, SESSION_COOKIE, dbSessions } from './sessions'
import { base32Decode, encryptTotpSecret, generateTotpSecret, hotp, totpStep } from './totp'

const FAST: ScryptParams = { N: 2 ** 10, r: 8, p: 1 } // tańszy scrypt w testach ścieżki; pełne parametry sprawdza osobny test
const APP_SECRET = 'testowy-sekret-aplikacji-tylko-do-testow-0123456789'
const HOST = 'crm.example.org'
const baseHeaders = { host: HOST, 'x-forwarded-proto': 'https', origin: `https://${HOST}`, 'x-ngo-crm': '1' }
const MIN = 60_000

let db: Db
let close: () => Promise<void>
const created: string[] = []
const apps: ReturnType<typeof buildApp>[] = []

// Wspólny zegar testów: stoi w miejscu, dopóki test go nie przesunie.
let nowMs = Date.now()
const clock = () => new Date(nowMs)
const advance = (ms: number) => (nowMs += ms)

/** Świeża aplikacja (i świeży licznik IP) dla każdego testu. */
function makeApp() {
  const app = buildApp(db, [], dbSessions(db, clock), { appSecret: APP_SECRET, now: clock, scryptParams: FAST })
  apps.push(app)
  return app
}

const newAuthKey = () => randomBytes(32).toString('base64')

async function createUser(opts: { status?: string; totp?: boolean; role?: string } = {}) {
  const id = randomUUID()
  const authKey = newAuthKey()
  const secret = generateTotpSecret()
  const email = `logowanie-test-${id}@example.invalid`
  created.push(id)
  await db.insert(users).values({
    id,
    createdAt: clock(),
    updatedAt: clock(),
    updatedBy: id,
    version: 1,
    email,
    name: 'Konto testowe',
    role: opts.role ?? 'staff',
    status: opts.status ?? 'active',
    kdfSalt: randomBytes(16).toString('base64'),
    kdfIterations: 600_000,
    authHash: await hashAuthKey(authKey, FAST),
    totpSecretEnc: opts.totp === false ? null : encryptTotpSecret(secret, APP_SECRET, id),
    totpEnabledAt: opts.totp === false ? null : clock()
  })
  return { id, email, authKey, secret }
}
type TestUser = Awaited<ReturnType<typeof createUser>>

const code = (u: TestUser) => hotp(base32Decode(u.secret), totpStep(nowMs))
const wrongCode = (u: TestUser) => {
  const allowed = [-1, 0, 1].map((i) => hotp(base32Decode(u.secret), totpStep(nowMs) + i))
  return ['000000', '111111', '222222', '333333'].find((c) => !allowed.includes(c))!
}

async function post(app: ReturnType<typeof buildApp>, url: string, payload: unknown, opts: { cookie?: string; ip?: string } = {}) {
  const res = await app.inject({
    method: 'POST',
    url,
    headers: opts.cookie ? { ...baseHeaders, cookie: opts.cookie } : baseHeaders,
    payload: payload as object,
    remoteAddress: opts.ip ?? '198.51.100.1'
  })
  const set = res.cookies.find((c) => c.name === SESSION_COOKIE)
  return { status: res.statusCode, body: res.json() as { ok: boolean; code?: string; data?: Record<string, unknown> }, set, cookie: set ? `${SESSION_COOKIE}=${set.value}` : undefined }
}
const login = (app: ReturnType<typeof buildApp>, u: { email: string; authKey: string }, ip?: string) => post(app, '/api/auth/login', { email: u.email, authKey: u.authKey }, { ip })
const totp = (app: ReturnType<typeof buildApp>, cookie: string | undefined, c: string, ip?: string) => post(app, '/api/auth/totp', { code: c }, { cookie, ip })
const me = (app: ReturnType<typeof buildApp>, cookie?: string) => post(app, '/api/rpc', { method: 'auth.me' }, { cookie })
const FAILED = { status: 401, body: { ok: false, code: 'LOGIN_FAILED' } }

async function fullLogin(app: ReturnType<typeof buildApp>, u: TestUser) {
  const step1 = await login(app, u)
  expect(step1.status).toBe(200)
  const step2 = await totp(app, step1.cookie, code(u))
  expect(step2.status).toBe(200)
  return step2.cookie!
}
const userRow = async (id: string) => (await db.select().from(users).where(eq(users.id, id)))[0]!
const logCount = async (id: string, action: string) => (await db.select().from(accessLog).where(and(eq(accessLog.userId, id), eq(accessLog.action, action)))).length

beforeAll(async () => {
  ;({ db, close } = await openTestDb())
})
afterAll(async () => {
  if (!db) return
  await Promise.all(apps.map((a) => a.close()))
  if (created.length) {
    await db.delete(authSessions).where(inArray(authSessions.userId, created))
    await db.delete(accessLog).where(inArray(accessLog.userId, created))
    await db.delete(users).where(inArray(users.id, created))
  }
  await db.delete(accessLog).where(and(isNull(accessLog.userId), eq(accessLog.action, 'login_failed')))
  await close()
})

describe('skrót authKey (scrypt)', () => {
  it('pełne parametry: N=2^17, r=8, p=1, sól 16 B, skrót 32 B; poprawny klucz pasuje, inny nie', async () => {
    expect(SCRYPT_PARAMS).toEqual({ N: 131072, r: 8, p: 1 })
    const key = newAuthKey()
    const stored = await hashAuthKey(key)
    const [scheme, n, r, p, salt, hash] = stored.split('$')
    expect([scheme, n, r, p]).toEqual(['scrypt', '131072', '8', '1'])
    expect(Buffer.from(salt!, 'base64')).toHaveLength(16)
    expect(Buffer.from(hash!, 'base64')).toHaveLength(32)
    expect(stored).not.toContain(key)
    expect(stored.length).toBeLessThanOrEqual(255)
    expect(await verifyAuthKey(key, stored)).toBe(true)
    expect(await verifyAuthKey(newAuthKey(), stored)).toBe(false)
    expect(await hashAuthKey(key)).not.toBe(stored) // losowa sól
  })

  it('nieczytelny zapis w bazie → false, bez wyjątku', async () => {
    for (const bad of ['', 'scrypt', 'scrypt$x$8$1$AAAA$AAAA', 'bcrypt$1024$8$1$AAAA$AAAA', 'scrypt$1024$8$1$AAAA$AAAA']) {
      expect(await verifyAuthKey(newAuthKey(), bad)).toBe(false)
    }
  })
})

describe('licznik prób z adresu IP (w pamięci)', () => {
  it('20 prób w oknie, potem odmowa; udane próby są zwracane; po 15 min nowe okno; adresy niezależne', () => {
    const limiter = createIpLimiter()
    const t0 = new Date('2026-01-01T10:00:00Z')
    for (let i = 0; i < IP_MAX_ATTEMPTS; i++) expect(limiter.tryAcquire('a', t0)).toBe(true)
    expect(limiter.tryAcquire('a', t0)).toBe(false)
    expect(limiter.tryAcquire('b', t0)).toBe(true)
    limiter.release('a', t0)
    expect(limiter.tryAcquire('a', t0)).toBe(true)
    expect(limiter.tryAcquire('a', new Date(t0.getTime() + IP_WINDOW_MS - 1))).toBe(false)
    expect(limiter.tryAcquire('a', new Date(t0.getTime() + IP_WINDOW_MS))).toBe(true)
  })
})

describe('sól przed logowaniem (prelogin)', () => {
  it('znany e-mail dostaje swoją sól; nieznany pozorną o tym samym kształcie, stałą i różną dla różnych adresów', async () => {
    const app = makeApp()
    const u = await createUser()
    const known = await post(app, '/api/auth/prelogin', { email: u.email })
    expect(known).toMatchObject({ status: 200, body: { ok: true, data: { kdfSalt: (await userRow(u.id)).kdfSalt, kdfIterations: 600_000 } } })

    const ask = async (email: string) => (await post(app, '/api/auth/prelogin', { email })).body.data as { kdfSalt: string; kdfIterations: number }
    const fake = await ask('nikt-taki@example.invalid')
    expect(Object.keys(fake)).toEqual(Object.keys(known.body.data!))
    expect(fake.kdfIterations).toBe(600_000)
    expect(Buffer.from(fake.kdfSalt, 'base64')).toHaveLength(16)
    expect(await ask('nikt-taki@example.invalid')).toEqual(fake)
    expect(await ask('  NIKT-taki@Example.Invalid ')).toEqual(fake)
    expect((await ask('ktos-inny@example.invalid')).kdfSalt).not.toBe(fake.kdfSalt)
    expect(known.set).toBeUndefined()
  })

  it('zły format e-maila → 400', async () => {
    expect((await post(makeApp(), '/api/auth/prelogin', { email: 'to-nie-email' })).status).toBe(400)
  })
})

describe('pełna ścieżka logowania', () => {
  it('authKey → sesja przed 2FA → kod → pełna sesja z nowym tokenem', async () => {
    const app = makeApp()
    const u = await createUser({ role: 'admin' })

    const step1 = await login(app, u)
    expect(step1).toMatchObject({ status: 200, body: { ok: true, data: { totpEnabled: true } } })
    expect(step1.set).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Strict', path: '/' })
    expect((await me(app, step1.cookie)).body.data).toMatchObject({ userId: u.id, totpVerified: false })
    // przed 2FA metody wymagające 2FA odmawiają
    expect(await post(app, '/api/rpc', { method: 'system.info' }, { cookie: step1.cookie })).toMatchObject({ status: 403, body: { code: 'TOTP_REQUIRED' } })
    expect(await logCount(u.id, 'login')).toBe(0)

    const step2 = await totp(app, step1.cookie, code(u))
    expect(step2.status).toBe(200)
    expect(step2.cookie).not.toBe(step1.cookie)
    expect((await me(app, step2.cookie)).body.data).toMatchObject({ userId: u.id, role: 'admin', totpVerified: true })
    expect((await post(app, '/api/rpc', { method: 'system.info' }, { cookie: step2.cookie })).status).toBe(200)
    expect((await me(app, step1.cookie)).status).toBe(401) // token sprzed 2FA już nie działa

    const row = await userRow(u.id)
    expect(row.lastLoginAt).toEqual(clock())
    expect(row).toMatchObject({ failedAttempts: 0, lockedUntil: null, version: 1 })
    expect(await logCount(u.id, 'login')).toBe(1)
  })

  it('e-mail wpisany wielkimi literami i ze spacjami też działa', async () => {
    const app = makeApp()
    const u = await createUser()
    expect((await login(app, { email: `  ${u.email.toUpperCase()} `, authKey: u.authKey })).status).toBe(200)
  })

  it('konto bez 2FA: dostaje sesję przed 2FA z informacją, a trasa kodu odmawia', async () => {
    const app = makeApp()
    const u = await createUser({ totp: false })
    const step1 = await login(app, u)
    expect(step1.body.data).toEqual({ totpEnabled: false })
    expect((await totp(app, step1.cookie, '123456')).status).toBe(400)
    expect((await me(app, step1.cookie)).body.data).toMatchObject({ totpVerified: false })
  })
})

describe('odmowy: jedna, taka sama odpowiedź', () => {
  it('złe hasło, nieznany e-mail, konto wyłączone i zaproszone → identyczne 401 LOGIN_FAILED, bez ciasteczka', async () => {
    const app = makeApp()
    const u = await createUser()
    const disabled = await createUser({ status: 'disabled' })
    const invited = await createUser({ status: 'invited' })
    const answers = [
      await login(app, { email: u.email, authKey: newAuthKey() }),
      await login(app, { email: 'nikt-taki@example.invalid', authKey: newAuthKey() }),
      await login(app, disabled),
      await login(app, invited)
    ]
    for (const a of answers) {
      expect(a).toMatchObject(FAILED)
      expect(a.body).toEqual(answers[0]!.body)
      expect(a.set).toBeUndefined()
    }
    expect(await logCount(u.id, 'login_failed')).toBe(1)
    // logowanie na nieznany e-mail nie zakłada konta
    expect(await db.select().from(users).where(eq(users.email, 'nikt-taki@example.invalid'))).toHaveLength(0)
  })

  it('authKey w złym formacie → 400, bez wpisu o nieudanym logowaniu', async () => {
    const app = makeApp()
    const u = await createUser()
    expect((await login(app, { email: u.email, authKey: 'haslo-jawnym-tekstem' })).status).toBe(400)
    expect(await logCount(u.id, 'login_failed')).toBe(0)
  })
})

describe('blokada konta po nieudanych logowaniach', () => {
  it('5 złych haseł blokuje konto na 15 min: poprawne hasło też odmawia; po 15 min działa', async () => {
    const app = makeApp()
    const u = await createUser()
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) expect(await login(app, { email: u.email, authKey: newAuthKey() })).toMatchObject(FAILED)
    const row = await userRow(u.id)
    expect(row.failedAttempts).toBe(0)
    expect(row.lockedUntil).toEqual(new Date(nowMs + LOCK_MS))

    expect(await login(app, u)).toMatchObject(FAILED) // poprawne hasło, ale blokada
    advance(LOCK_MS - 1000)
    expect(await login(app, u)).toMatchObject(FAILED)
    expect((await userRow(u.id)).failedAttempts).toBe(0) // próby w trakcie blokady nie są liczone
    advance(1000)
    await fullLogin(app, u)
    expect(await userRow(u.id)).toMatchObject({ failedAttempts: 0, lockedUntil: null })
  })

  it('4 złe hasła nie blokują; pełne logowanie zeruje licznik', async () => {
    const app = makeApp()
    const u = await createUser()
    for (let i = 0; i < MAX_FAILED_ATTEMPTS - 1; i++) await login(app, { email: u.email, authKey: newAuthKey() })
    expect((await userRow(u.id)).failedAttempts).toBe(4)
    await fullLogin(app, u)
    expect((await userRow(u.id)).failedAttempts).toBe(0)

    advance(MIN) // nowe okno TOTP
    for (let i = 0; i < MAX_FAILED_ATTEMPTS - 1; i++) await login(app, { email: u.email, authKey: newAuthKey() })
    expect((await userRow(u.id)).lockedUntil).toBeNull()
    await fullLogin(app, u)
  })

  it('samo poprawne hasło (bez kodu) nie zeruje licznika', async () => {
    const app = makeApp()
    const u = await createUser()
    for (let i = 0; i < 3; i++) await login(app, { email: u.email, authKey: newAuthKey() })
    expect((await login(app, u)).status).toBe(200)
    expect((await userRow(u.id)).failedAttempts).toBe(3)
  })

  it('błędny kod TOTP liczy się do tych samych 5 prób: 3 złe hasła + 2 złe kody = blokada i koniec sesji przed 2FA', async () => {
    const app = makeApp()
    const u = await createUser()
    for (let i = 0; i < 3; i++) await login(app, { email: u.email, authKey: newAuthKey() })
    const step1 = await login(app, u)
    expect(await totp(app, step1.cookie, wrongCode(u))).toMatchObject(FAILED)
    expect((await userRow(u.id)).failedAttempts).toBe(4)
    expect((await me(app, step1.cookie)).status).toBe(200) // jeszcze nie blokada: sesja przed 2FA trwa

    const last = await totp(app, step1.cookie, wrongCode(u))
    expect(last).toMatchObject(FAILED)
    expect(last.set?.value).toBe('') // ciasteczko wyczyszczone
    expect((await userRow(u.id)).lockedUntil).toEqual(new Date(nowMs + LOCK_MS))
    expect((await me(app, step1.cookie)).status).toBe(401)
    expect(await totp(app, step1.cookie, code(u))).toMatchObject({ status: 401 }) // poprawny kod już nie pomoże
    expect(await login(app, u)).toMatchObject(FAILED)
    expect(await logCount(u.id, 'login_failed')).toBe(6)
  })
})

describe('kod TOTP przy logowaniu', () => {
  it('błędny kod → odmowa, sesja pozostaje przed 2FA; poprawny potem przechodzi', async () => {
    const app = makeApp()
    const u = await createUser()
    const step1 = await login(app, u)
    expect(await totp(app, step1.cookie, wrongCode(u))).toMatchObject(FAILED)
    expect(await totp(app, step1.cookie, 'abcdef')).toMatchObject(FAILED)
    expect((await me(app, step1.cookie)).body.data).toMatchObject({ totpVerified: false })
    expect((await totp(app, step1.cookie, code(u))).status).toBe(200)
  })

  it('ponowne użycie kodu: ten sam kod przy drugim logowaniu w tym samym oknie → odmowa', async () => {
    const app = makeApp()
    const u = await createUser()
    const used = code(u)
    await fullLogin(app, u)

    const again = await login(app, u)
    expect(await totp(app, again.cookie, used)).toMatchObject(FAILED)
    expect((await me(app, again.cookie)).body.data).toMatchObject({ totpVerified: false })
    advance(30_000) // następne okno: nowy kod działa
    expect((await totp(app, again.cookie, code(u))).status).toBe(200)
  })

  it('kod bez sesji, z nieprawidłowym albo sfałszowanym ciasteczkiem → 401', async () => {
    const app = makeApp()
    const u = await createUser()
    expect((await totp(app, undefined, code(u))).status).toBe(401)
    expect((await totp(app, `${SESSION_COOKIE}=`, code(u))).status).toBe(401)
    expect((await totp(app, `${SESSION_COOKIE}=${randomBytes(32).toString('base64url')}`, code(u))).status).toBe(401)
    const step1 = await login(app, u)
    const token = step1.set!.value
    expect((await totp(app, `${SESSION_COOKIE}=${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`, code(u))).status).toBe(401)
    expect((await totp(app, `inna_nazwa=${token}`, code(u))).status).toBe(401)
    expect((await userRow(u.id)).failedAttempts).toBe(0)
  })
})

describe('wygaśnięcie sesji', () => {
  it('sesja przed 2FA wygasa po 5 min: poprawny kod już nie zaloguje', async () => {
    const app = makeApp()
    const u = await createUser()
    const step1 = await login(app, u)
    advance(PRE_MFA_TTL_MS)
    expect((await totp(app, step1.cookie, code(u))).status).toBe(401)
    expect((await me(app, step1.cookie)).status).toBe(401)
  })

  it('pełna sesja: ponad 30 min bezczynności → 401; aktywna sesja kończy się po 12 h', async () => {
    const app = makeApp()
    const u = await createUser()
    const idle = await fullLogin(app, u)
    advance(31 * MIN)
    expect((await me(app, idle)).status).toBe(401)

    const active = await fullLogin(app, u)
    for (let i = 0; i < 12 * 3 - 1; i++) {
      advance(20 * MIN)
      expect((await me(app, active)).status).toBe(200)
    }
    advance(20 * MIN)
    expect((await me(app, active)).status).toBe(401)
  })
})

describe('wylogowanie', () => {
  it('„wyloguj” kończy tę sesję i czyści ciasteczko; druga sesja działa dalej', async () => {
    const app = makeApp()
    const u = await createUser()
    const a = await fullLogin(app, u)
    advance(30_000)
    const b = await fullLogin(app, u)

    const out = await post(app, '/api/rpc', { method: 'auth.logout' }, { cookie: a })
    expect(out.status).toBe(200)
    expect(out.set?.value).toBe('')
    expect((await me(app, a)).status).toBe(401)
    expect((await me(app, b)).status).toBe(200)
    expect(await logCount(u.id, 'logout')).toBe(1)
  })

  it('„wyloguj wszędzie” kończy wszystkie sesje osoby; wymaga pełnej sesji', async () => {
    const app = makeApp()
    const u = await createUser()
    const a = await fullLogin(app, u)
    advance(30_000)
    const b = await fullLogin(app, u)
    const pre = await login(app, u)
    expect((await post(app, '/api/rpc', { method: 'auth.logoutAll' }, { cookie: pre.cookie })).status).toBe(403)

    expect((await post(app, '/api/rpc', { method: 'auth.logoutAll' }, { cookie: a })).status).toBe(200)
    for (const c of [a, b, pre.cookie]) expect((await me(app, c)).status).toBe(401)
    expect(await db.select().from(authSessions).where(eq(authSessions.userId, u.id))).toHaveLength(0)
    expect(await logCount(u.id, 'logout_all')).toBe(1)
  })
})

describe('blokada z adresu IP', () => {
  it('20 nieudanych prób z jednego adresu → 429 także dla poprawnych danych; inny adres działa; po 15 min znowu wolno', async () => {
    const app = makeApp()
    const u = await createUser()
    const BAD_IP = '203.0.113.7'
    // 19 nieudanych (nieznane e-maile, żeby nie blokować konta)
    for (let i = 0; i < IP_MAX_ATTEMPTS - 1; i++) expect((await login(app, { email: `nikt-${i}@example.invalid`, authKey: newAuthKey() }, BAD_IP)).status).toBe(401)
    // udane logowania nie zużywają limitu
    for (let i = 0; i < 3; i++) expect((await login(app, u, BAD_IP)).status).toBe(200)
    expect((await login(app, { email: 'nikt-ostatni@example.invalid', authKey: newAuthKey() }, BAD_IP)).status).toBe(401) // 20.

    expect(await login(app, u, BAD_IP)).toMatchObject({ status: 429, body: { code: 'RATE_LIMITED' } })
    const pre = await login(app, u, '203.0.113.8')
    expect(pre.status).toBe(200)
    expect((await totp(app, pre.cookie, code(u), BAD_IP)).status).toBe(429) // krok z kodem też objęty limitem
    expect((await totp(app, pre.cookie, code(u), '203.0.113.8')).status).toBe(200)

    advance(IP_WINDOW_MS)
    expect((await login(app, u, BAD_IP)).status).toBe(200)
    expect((await userRow(u.id)).failedAttempts).toBe(0)
  })
})

describe('trasy logowania a konfiguracja', () => {
  it('bez opcji logowania (tryb kreatora / testy innych modułów) tras logowania nie ma', async () => {
    const app = buildApp(db)
    apps.push(app)
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', headers: baseHeaders, payload: { email: 'a@example.invalid', authKey: newAuthKey() } })
    expect(res.statusCode).toBe(404)
  })

  it('logowanie jest objęte ochroną CSRF i wymogiem HTTPS', async () => {
    const app = makeApp()
    const u = await createUser()
    const { 'x-ngo-crm': _x, ...noHeader } = baseHeaders
    const payload = { email: u.email, authKey: u.authKey }
    expect((await app.inject({ method: 'POST', url: '/api/auth/login', headers: noHeader, payload })).statusCode).toBe(403)
    expect((await app.inject({ method: 'POST', url: '/api/auth/login', headers: { ...baseHeaders, origin: 'https://evil.example' }, payload })).statusCode).toBe(403)
    expect((await app.inject({ method: 'POST', url: '/api/auth/login', headers: { ...baseHeaders, 'x-forwarded-proto': 'http', origin: `http://${HOST}` }, payload })).statusCode).toBe(403)
  })
})
