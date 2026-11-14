// Kreator pierwszego uruchomienia przez HTTP na lokalnej bazie testowej. Wymaga pustej tabeli użytkowników,
// dlatego pliki testów biegną po kolei (vitest.config.mts), a ten plik czyści tabele dostępu przed każdym testem.
// Token, konta i klucze fikcyjne, tylko tutaj.
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../app'
import { appRoot } from '../config'
import type { Db } from '../db/connection'
import { accessLog, authSessions, changeLog, keySlots, orgKeys, settings, users } from '../db/schema'
import { openTestDb } from '../testDb'
import type { AuthOptions } from './options'
import { dbSessions, SESSION_COOKIE } from './sessions'
import { SETTINGS_ID, openEnrollment } from './setup'
import { base32Decode, hotp, totpStep } from './totp'

const APP_SECRET = 'testowy-sekret-aplikacji-tylko-do-testow-0123456789'
const TOKEN = 'testowy-token-kreatora-0123456789-abcdefghij'
const HOST = 'crm.example.org'
const baseHeaders = { host: HOST, 'x-forwarded-proto': 'https', origin: `https://${HOST}`, 'x-ngo-crm': '1', 'x-forwarded-for': '198.51.100.20' }
const EMAIL = 'kreator-test@example.invalid'

let db: Db
let close: () => Promise<void>
let storageDir: string
const apps: ReturnType<typeof buildApp>[] = []
let nowMs = Date.now()
const clock = () => new Date(nowMs)

function makeApp(over: Partial<AuthOptions> = {}) {
  const app = buildApp(db, [], dbSessions(db, clock), { appSecret: APP_SECRET, setupToken: TOKEN, storageDir, now: clock, scryptParams: { N: 2 ** 10, r: 8, p: 1 }, ...over })
  apps.push(app)
  return app
}
type App = ReturnType<typeof buildApp>

async function post(app: App, url: string, payload: unknown, headers: Record<string, string> = {}) {
  const res = await app.inject({ method: 'POST', url, headers: { ...baseHeaders, ...headers }, payload: payload as object })
  const set = res.cookies.find((c) => c.name === SESSION_COOKIE)
  return { status: res.statusCode, body: res.json() as { ok: boolean; code?: string; message?: string; data?: Record<string, unknown> }, cookie: set ? `${SESSION_COOKIE}=${set.value}` : undefined }
}

const sealed = () => `v1.${randomBytes(12).toString('base64')}.${randomBytes(64).toString('base64')}`
const codeFor = (secret: string) => hotp(base32Decode(secret), totpStep(nowMs))

async function enroll(app: App) {
  const res = await post(app, '/api/setup/totp', { token: TOKEN, email: EMAIL })
  expect(res.status).toBe(200)
  return res.body.data as { userId: string; secret: string; otpauthUrl: string; qrSvg: string; enrollment: string }
}

function completeInput(e: { enrollment: string; secret: string }, over: Record<string, unknown> = {}) {
  return {
    token: TOKEN,
    enrollment: e.enrollment,
    totpCode: codeFor(e.secret),
    org: { name: 'Organizacja Testowa', profile: 'kgw' },
    admin: {
      name: 'Administrator Testowy',
      email: EMAIL,
      authKey: randomBytes(32).toString('base64'),
      kdfSalt: randomBytes(16).toString('base64'),
      kdfIterations: 600_000,
      publicKey: randomBytes(420).toString('base64'),
      privateKeyEnc: sealed()
    },
    keys: { slot: randomBytes(384).toString('base64'), recoverySlot: sealed() },
    ...over
  }
}

/** Czyści tabele dostępu w bazie testowej (tylko tu; baza testowa jest chroniona przez testDb.ts). */
async function wipe() {
  for (const table of [keySlots, orgKeys, authSessions, accessLog, changeLog, settings, users]) await db.delete(table)
}
const counts = async () => ({
  users: (await db.select().from(users)).length,
  settings: (await db.select().from(settings)).length,
  orgKeys: (await db.select().from(orgKeys)).length,
  keySlots: (await db.select().from(keySlots)).length
})
const EMPTY = { users: 0, settings: 0, orgKeys: 0, keySlots: 0 }

beforeAll(async () => {
  ;({ db, close } = await openTestDb())
  storageDir = mkdtempSync(join(tmpdir(), 'ngocrm-test-storage-'))
})
beforeEach(wipe)
afterAll(async () => {
  if (!db) return
  await Promise.all(apps.map((a) => a.close()))
  await wipe()
  rmSync(storageDir, { recursive: true, force: true })
  await close()
})

describe('stan kreatora', () => {
  const state = async (app: App) => (await post(app, '/api/setup/status', {})).body.data

  it('pusta baza i token co najmniej 32 znaki → dostępny', async () => {
    expect(await state(makeApp())).toEqual({ state: 'available' })
  })

  it('brak tokenu albo token krótszy niż 32 znaki → niedostępny, a trasy kreatora odmawiają', async () => {
    const none = makeApp({ setupToken: undefined })
    expect(await state(none)).toEqual({ state: 'no_token' })
    expect((await post(none, '/api/setup/check', { token: 'cokolwiek' })).status).toBe(409)

    const short = 'x'.repeat(31)
    const tooShort = makeApp({ setupToken: short })
    expect(await state(tooShort)).toEqual({ state: 'token_too_short' })
    expect(await post(tooShort, '/api/setup/check', { token: short })).toMatchObject({ status: 409, body: { code: 'SETUP_UNAVAILABLE' } })
    expect(await counts()).toEqual(EMPTY)
  })
})

describe('token kreatora', () => {
  it('zły, pusty albo brakujący token → odmowa na każdej trasie; nic nie powstaje', async () => {
    const app = makeApp()
    const e = await enroll(app)
    expect(await post(app, '/api/setup/check', { token: TOKEN + 'x' })).toMatchObject({ status: 401, body: { code: 'SETUP_TOKEN_INVALID' } })
    expect((await post(app, '/api/setup/check', { token: TOKEN.slice(0, -1) })).status).toBe(401)
    expect((await post(app, '/api/setup/check', { token: '' })).status).toBe(400)
    expect((await post(app, '/api/setup/check', {})).status).toBe(400)
    expect((await post(app, '/api/setup/totp', { token: 'zly-token', email: EMAIL })).status).toBe(401)
    expect((await post(app, '/api/setup/complete', completeInput(e, { token: 'zly-token' }))).status).toBe(401)
    expect(await counts()).toEqual(EMPTY)
  })

  it('zgadywanie tokenu: po 20 błędnych próbach z jednego adresu odmowa także dla poprawnego; inny adres działa', async () => {
    const app = makeApp()
    const ip = { 'x-forwarded-for': '203.0.113.70' }
    for (let i = 0; i < 20; i++) expect((await post(app, '/api/setup/check', { token: `zly-token-${i}` }, ip)).status).toBe(401)
    expect(await post(app, '/api/setup/check', { token: TOKEN }, ip)).toMatchObject({ status: 429, body: { code: 'RATE_LIMITED' } })
    expect((await post(app, '/api/setup/check', { token: TOKEN })).status).toBe(200)
  })

  it('kreator jest objęty ochroną CSRF', async () => {
    const app = makeApp()
    expect((await post(app, '/api/setup/check', { token: TOKEN }, { 'x-ngo-crm': '0' })).status).toBe(403)
    expect((await post(app, '/api/setup/check', { token: TOKEN }, { origin: 'https://evil.example' })).status).toBe(403)
  })
})

describe('sprawdzenie gotowości', () => {
  const storage = async (app: App) => ((await post(app, '/api/setup/check', { token: TOKEN })).body.data as { storage: unknown }).storage

  it('poprawny token → HTTPS, migracje, folder zapisywalny (próbny plik nie zostaje)', async () => {
    const res = await post(makeApp(), '/api/setup/check', { token: TOKEN })
    expect(res).toMatchObject({ status: 200, body: { data: { https: true, storage: { ok: true } } } })
    expect((res.body.data as { migrations: number }).migrations).toBeGreaterThanOrEqual(5)
  })

  it('STORAGE_DIR nieustawiony, w folderze aplikacji (produkcja) albo niezapisywalny → problem, a zapis kreatora odmawia', async () => {
    expect(await storage(makeApp({ storageDir: undefined }))).toEqual({ ok: false, problem: 'not_set' })
    expect(await storage(makeApp({ storageDir: join(appRoot, 'storage-w-aplikacji'), production: true }))).toEqual({ ok: false, problem: 'inside_app' })
    expect(await storage(makeApp({ storageDir: './storage-w-aplikacji', production: true }))).toEqual({ ok: false, problem: 'inside_app' })

    const file = join(storageDir, 'to-jest-plik')
    writeFileSync(file, 'x')
    const blocked = makeApp({ storageDir: join(file, 'podfolder') })
    expect(await storage(blocked)).toEqual({ ok: false, problem: 'not_writable' })

    const e = await enroll(blocked)
    expect((await post(blocked, '/api/setup/complete', completeInput(e))).status).toBe(400)
    expect(await counts()).toEqual(EMPTY)
  })
})

describe('zapis kreatora', () => {
  it('zakłada organizację, administratora z 2FA, klucz organizacji i oba sloty; potem da się zalogować', async () => {
    const app = makeApp()
    const e = await enroll(app)
    expect(e.secret).toMatch(/^[A-Z2-7]{32}$/)
    expect(e.qrSvg).toMatch(/^<svg /)
    expect(e.enrollment).not.toContain(e.secret)
    expect(await counts()).toEqual(EMPTY) // przed końcem nic nie jest zapisane

    const input = completeInput(e)
    const done = await post(app, '/api/setup/complete', input)
    expect(done.status).toBe(200)
    expect(done.cookie).toBeUndefined() // bez automatycznego zalogowania

    const [user] = await db.select().from(users)
    expect(user).toMatchObject({ id: e.userId, email: EMAIL, name: 'Administrator Testowy', role: 'admin', status: 'active', kdfSalt: input.admin.kdfSalt, publicKey: input.admin.publicKey, privateKeyEnc: input.admin.privateKeyEnc, failedAttempts: 0 })
    expect(user!.totpEnabledAt).toEqual(clock())
    expect(user!.authHash).toMatch(/^scrypt\$/)
    expect(user!.authHash).not.toContain(input.admin.authKey)
    expect(user!.totpSecretEnc).not.toContain(e.secret)

    const [org] = await db.select().from(settings)
    expect(org).toMatchObject({ id: SETTINGS_ID, orgName: 'Organizacja Testowa', profile: 'kgw', enabledModules: ['contacts', 'actions', 'tasks', 'calendar', 'knowledge'], roleLabels: {}, idleLogoutMinutes: 30, version: 1, updatedBy: e.userId })
    expect(await db.select().from(orgKeys)).toMatchObject([{ version: 1, createdBy: e.userId, retiredAt: null }])
    const slots = await db.select().from(keySlots)
    expect(slots.map((s) => [s.userId, s.wrappedKey]).sort()).toEqual([[e.userId, input.keys.slot], [null, input.keys.recoverySlot]].sort())
    expect((await db.select().from(accessLog)).map((a) => a.action).sort()).toEqual(['setup_completed', 'totp_enabled'])

    // dziennik zmian nie zawiera skrótu hasła ani szyfrogramów
    const log = JSON.stringify(await db.select().from(changeLog))
    for (const secretish of [input.admin.authKey, input.admin.privateKeyEnc, input.keys.slot, user!.authHash!]) expect(log).not.toContain(secretish)

    // logowanie nowym kontem: kod z kreatora jest zużyty, następny działa
    const pre = await post(app, '/api/auth/login', { email: EMAIL, authKey: input.admin.authKey })
    expect(pre).toMatchObject({ status: 200, body: { data: { totpEnabled: true } } })
    expect((await post(app, '/api/auth/totp', { code: codeFor(e.secret) }, { cookie: pre.cookie! })).status).toBe(401)
    nowMs += 30_000
    const full = await post(app, '/api/auth/totp', { code: codeFor(e.secret) }, { cookie: pre.cookie! })
    expect(full.status).toBe(200)
    expect((await post(app, '/api/rpc', { method: 'auth.keys' }, { cookie: full.cookie! })).body.data).toMatchObject({ privateKeyEnc: input.admin.privateKeyEnc })
  })

  it('po zakończeniu kreator jest wyłączony na stałe, także z poprawnym tokenem', async () => {
    const app = makeApp()
    const e = await enroll(app)
    expect((await post(app, '/api/setup/complete', completeInput(e))).status).toBe(200)

    expect((await post(app, '/api/setup/status', {})).body.data).toEqual({ state: 'done' })
    expect(await post(app, '/api/setup/check', { token: TOKEN })).toMatchObject({ status: 409, body: { code: 'SETUP_UNAVAILABLE' } })
    expect((await post(app, '/api/setup/totp', { token: TOKEN, email: 'drugi@example.invalid' })).status).toBe(409)
    nowMs += 30_000
    expect((await post(app, '/api/setup/complete', completeInput(e, { admin: { ...completeInput(e).admin, email: 'drugi@example.invalid' } }))).status).toBe(409)
    expect(await counts()).toEqual({ users: 1, settings: 1, orgKeys: 1, keySlots: 2 })
  })

  it('błędny kod TOTP → odmowa i nic nie zostaje zapisane; poprawny potem przechodzi', async () => {
    const app = makeApp()
    const e = await enroll(app)
    const good = codeFor(e.secret)
    const wrong = ['000000', '111111', '222222'].find((c) => ![-1, 0, 1].map((i) => hotp(base32Decode(e.secret), totpStep(nowMs) + i)).includes(c))!
    expect(await post(app, '/api/setup/complete', completeInput(e, { totpCode: wrong }))).toMatchObject({ status: 400, body: { code: 'TOTP_INVALID' } })
    expect(await counts()).toEqual(EMPTY)
    expect((await post(app, '/api/setup/complete', completeInput(e, { totpCode: good }))).status).toBe(200)
  })

  it('zmieniona, obca albo przeterminowana konfiguracja 2FA → odmowa, nic nie zostaje zapisane', async () => {
    const app = makeApp()
    const e = await enroll(app)
    const [iv, ct, tag] = e.enrollment.split('.') as [string, string, string]
    const flipped = [iv, ct.slice(0, -2) + (ct.endsWith('AA') ? 'BB' : 'AA'), tag].join('.')
    expect((await post(app, '/api/setup/complete', completeInput({ enrollment: flipped, secret: e.secret }))).status).toBe(400)
    expect((await post(app, '/api/setup/complete', completeInput({ enrollment: 'to.nie.jest', secret: e.secret }))).status).toBe(400)
    // zapis zaszyfrowany innym APP_SECRET
    const other = makeApp({ appSecret: 'inny-testowy-sekret-aplikacji-tylko-do-testow-98765' })
    expect((await post(other, '/api/setup/complete', completeInput(e))).status).toBe(400)
    expect(() => openEnrollment(e.enrollment, APP_SECRET, clock())).not.toThrow()

    nowMs += 31 * 60_000 // ważność 30 min
    expect((await post(app, '/api/setup/complete', completeInput(e))).status).toBe(400)
    expect(await counts()).toEqual(EMPTY)
  })

  it('złe formaty danych (jawne hasło, klucz bez szyfrowania, nieznany profil) → 400, nic nie zostaje zapisane', async () => {
    const app = makeApp()
    const e = await enroll(app)
    const base = completeInput(e)
    for (const bad of [
      { admin: { ...base.admin, authKey: 'haslo-jawnym-tekstem' } },
      { admin: { ...base.admin, privateKeyEnc: 'klucz-prywatny-jawnie' } },
      { admin: { ...base.admin, kdfIterations: 1000 } },
      { admin: { ...base.admin, email: 'to-nie-email' } },
      { admin: { ...base.admin, name: '   ' } },
      { org: { name: 'Organizacja', profile: 'nieznany' } },
      { keys: { ...base.keys, recoverySlot: 'jawny-klucz-organizacji' } }
    ]) {
      expect((await post(app, '/api/setup/complete', { ...base, ...bad })).status).toBe(400)
    }
    expect(await counts()).toEqual(EMPTY)
  })

  it('błąd w połowie zapisu wycofuje wszystko: nie zostaje konto bez organizacji ani klucza', async () => {
    const app = makeApp()
    const e = await enroll(app)
    // przeszkoda dopiero przy zapisie klucza organizacji (po ustawieniach i koncie)
    await db.insert(orgKeys).values({ version: 1, createdAt: clock(), createdBy: randomUUID() })
    const res = await post(app, '/api/setup/complete', completeInput(e))
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(await counts()).toEqual({ ...EMPTY, orgKeys: 1 })
    expect(await db.select().from(accessLog)).toHaveLength(0)
    expect(await db.select().from(changeLog)).toHaveLength(0)
  })

  it('dwa kreatory naraz: powstaje dokładnie jedna organizacja i jedno konto', async () => {
    const app = makeApp()
    const [a, b] = [await enroll(app), await enroll(app)]
    const results = await Promise.all([
      post(app, '/api/setup/complete', completeInput(a)),
      post(app, '/api/setup/complete', completeInput(b, { admin: { ...completeInput(b).admin, email: 'drugi-kreator@example.invalid' } }))
    ])
    expect(results.map((r) => r.status).sort()).toEqual([200, 409])
    expect(await counts()).toEqual({ users: 1, settings: 1, orgKeys: 1, keySlots: 2 })
  })

  it('gdy w bazie jest już jakiekolwiek konto (także wyłączone), kreator odmawia', async () => {
    const app = makeApp()
    const e = await enroll(app)
    const id = randomUUID()
    await db.insert(users).values({ id, createdAt: clock(), updatedAt: clock(), updatedBy: id, version: 1, email: 'istniejace@example.invalid', name: 'Konto testowe', role: 'staff', status: 'disabled' })
    expect((await post(app, '/api/setup/complete', completeInput(e))).status).toBe(409)
    expect(await counts()).toEqual({ ...EMPTY, users: 1 })
  })
})
