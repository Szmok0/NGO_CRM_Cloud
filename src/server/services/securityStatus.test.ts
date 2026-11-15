// Testy panelu „Stan bezpieczeństwa” i sprawdzania wersji (ZADANIE_04, krok 4; D8, D9). Wymaga lokalnej bazy testowej.
// Siec jest podstawiona (setUpdateFetcher): testy nigdy nie pytają prawdziwego GitHuba. Dane wyłącznie fikcyjne.
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { SecurityStatus } from '@shared/api'
import pkg from '../../../package.json'
import { buildApp } from '../app'
import { dbSessions } from '../auth/sessions'
import { TEST_APP_SECRET, addTestUser, sessionCookieFor, wipeAccounts } from '../auth/testkit'
import type { Db } from '../db/connection'
import { accessLog, backups, keySlots, orgKeys, settings, users } from '../db/schema'
import { openTestDb } from '../testDb'
import { getSecurityStatus } from './securityStatus'
import { isNewerVersion, parseRelease, refreshUpdateInfo, setUpdateFetcher, updateCheckDue } from './updates'

let db: Db
let close: () => Promise<void>

const NOW = new Date('2026-11-15T12:00:00.000Z')
const ago = (d: number) => new Date(NOW.getTime() - d * 86_400_000)

beforeAll(async () => {
  const o = await openTestDb()
  db = o.db
  close = o.close
})
afterAll(async () => {
  await wipe()
  setUpdateFetcher(null)
  await close?.()
})
async function wipe() {
  await db.delete(backups)
  await wipeAccounts(db)
}
beforeEach(async () => {
  await wipe()
  setUpdateFetcher(async () => {
    throw new Error('Test nie powinien pytać sieci')
  })
})
afterEach(() => setUpdateFetcher(null))

const org = () =>
  db.insert(settings).values({
    id: randomUUID(),
    createdAt: NOW,
    updatedAt: NOW,
    updatedBy: randomUUID(),
    version: 1,
    orgName: 'Stowarzyszenie testowe',
    profile: 'projects',
    enabledModules: ['contacts'],
    roleLabels: {}
  })

const release = (over: Record<string, unknown> = {}) => ({ tag_name: 'v9.9.9', name: 'Wersja 9.9.9', html_url: 'https://github.com/Szmok0/NGO_CRM_Cloud/releases/tag/v9.9.9', ...over })
const fakeGithub = (body: unknown, ok = true) => {
  const calls: { url: string; init?: RequestInit }[] = []
  setUpdateFetcher((async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init })
    return { ok, status: ok ? 200 : 500, json: async () => body }
  }) as unknown as typeof fetch)
  return calls
}
const status = (over: Partial<{ storageConfigured: boolean; secure: boolean }> = {}) => getSecurityStatus(db, { storageConfigured: true, secure: true, now: NOW, ...over })
const item = (s: SecurityStatus, id: string) => s.items.find((i) => i.id === id)!

async function addBackup(o: { startedAt: Date; status?: string; downloadedAt?: Date; restoreTestedAt?: Date }) {
  await db.insert(backups).values({
    id: randomUUID(),
    startedAt: o.startedAt,
    finishedAt: o.status === 'running' ? null : o.startedAt,
    status: o.status ?? 'done',
    kind: 'auto',
    programVersion: '0.1.0',
    migrations: 1,
    downloadedAt: o.downloadedAt ?? null,
    restoreTestedAt: o.restoreTestedAt ?? null,
    runningLock: o.status === 'running' ? 'running' : null
  })
}

describe('wersje i wydania', () => {
  it('porównanie numerów x.y.z', () => {
    expect(isNewerVersion('0.2.0', '0.1.0')).toBe(true)
    expect(isNewerVersion('0.10.0', '0.9.5')).toBe(true)
    expect(isNewerVersion('1.0.0', '0.99.99')).toBe(true)
    expect(isNewerVersion('0.1.0', '0.1.0')).toBe(false)
    expect(isNewerVersion('0.1.0', '0.2.0')).toBe(false)
    expect(isNewerVersion('abc', '0.1.0')).toBe(false)
  })

  it('odpowiedź GitHuba: tytuł, słowo „bezpieczeństwo” oznacza poprawkę, obcy adres zastąpiony, szkice i zły kształt odrzucone', () => {
    expect(parseRelease(release())).toMatchObject({ version: '9.9.9', security: false, url: expect.stringContaining('github.com/Szmok0/NGO_CRM_Cloud/') })
    expect(parseRelease(release({ name: '[bezpieczeństwo] Wersja 0.1.1' }))?.security).toBe(true)
    expect(parseRelease(release({ name: '[Security] fix' }))?.security).toBe(true)
    expect(parseRelease(release({ name: 'Panel Stan bezpieczeństwa' }))?.security).toBe(false) // samo słowo nie wystarcza
    expect(parseRelease(release({ tag_name: 'v1.2.3-rc1' }))).toBeNull()
    expect(parseRelease(release({ html_url: 'https://zlosliwa.example/x' }))?.url).toBe('https://github.com/Szmok0/NGO_CRM_Cloud/releases')
    expect(parseRelease(release({ html_url: 'javascript:alert(1)' }))?.url).toBe('https://github.com/Szmok0/NGO_CRM_Cloud/releases')
    expect(parseRelease(release({ draft: true }))).toBeNull()
    expect(parseRelease(release({ tag_name: 'nie-wersja' }))).toBeNull()
    expect(parseRelease('tekst')).toBeNull()
    expect(parseRelease(null)).toBeNull()
  })

  it('jest nowsza wersja: żółte, link i numer; zapytanie bez danych organizacji (tylko adres wydań i ogólna nazwa klienta)', async () => {
    await org()
    const calls = fakeGithub(release())
    await refreshUpdateInfo(db, NOW)
    const s = await status()
    expect(s.update).toMatchObject({ state: 'available', latest: '9.9.9', security: false, checkedAt: NOW.toISOString() })
    expect(item(s, 'version')).toMatchObject({ tone: 'yellow', data: { current: pkg.version, releasedAt: pkg.releaseDate, latest: '9.9.9' } })
    // wynik w bazie (przeżywa restart, wspólny dla procesów), bez podbijania wersji ustawień
    expect((await db.select().from(settings))[0]).toMatchObject({ version: 1, updateInfo: { release: { version: '9.9.9' }, lastFailed: false } })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe('https://api.github.com/repos/Szmok0/NGO_CRM_Cloud/releases/latest')
    expect(calls[0]!.init?.headers).toEqual({ accept: 'application/vnd.github+json', 'user-agent': 'ngo-crm-cloud' })
    expect(calls[0]!.init).not.toHaveProperty('body')
  })

  it('wydanie z „bezpieczeństwo” w tytule → czerwone', async () => {
    await org()
    fakeGithub(release({ name: '[bezpieczeństwo] Ważna poprawka' }))
    await refreshUpdateInfo(db, NOW)
    const s = await status()
    expect(item(s, 'version').tone).toBe('red')
    expect(s.update.security).toBe(true)
  })

  it('ta sama wersja → zielone „aktualna”', async () => {
    await org()
    fakeGithub(release({ tag_name: `v${pkg.version}`, name: 'Obecna' }))
    await refreshUpdateInfo(db, NOW)
    const s = await status()
    expect(s.update.state).toBe('current')
    expect(item(s, 'version').tone).toBe('green')
  })

  it('brak sieci, błąd GitHuba i śmieci w odpowiedzi to szare „nie udało się sprawdzić”, nie błąd', async () => {
    await org()
    setUpdateFetcher(async () => {
      throw new TypeError('fetch failed')
    })
    await refreshUpdateInfo(db, NOW)
    let s = await status()
    expect(s.update.state).toBe('failed')
    expect(item(s, 'version').tone).toBe('grey')
    fakeGithub({ message: 'rate limited' }, false)
    await refreshUpdateInfo(db, NOW)
    expect((await status()).update.state).toBe('failed')
    fakeGithub({ cokolwiek: 1 })
    await refreshUpdateInfo(db, NOW)
    s = await status()
    expect(s.update.state).toBe('failed')
    expect(await updateCheckDue(db, NOW)).toBe(false) // po nieudanym próbujemy znowu najwcześniej po godzinie
    expect(await updateCheckDue(db, new Date(NOW.getTime() + 3600_000))).toBe(true)
  })

  it('przed pierwszym sprawdzeniem „pending”; po udanym raz na dobę, nieudane po udanym nie kasuje znanej nowej wersji', async () => {
    await org()
    expect((await status()).update.state).toBe('pending')
    fakeGithub(release())
    await refreshUpdateInfo(db, NOW)
    expect(await updateCheckDue(db, new Date(NOW.getTime() + 3600_000))).toBe(false)
    expect(await updateCheckDue(db, new Date(NOW.getTime() + 25 * 3600_000))).toBe(true)
    setUpdateFetcher(async () => {
      throw new TypeError('fetch failed')
    })
    await refreshUpdateInfo(db, NOW)
    expect((await status()).update.state).toBe('available')
  })

  it('wyłącznik: bez zapytania, stan „disabled”; domyślnie włączone', async () => {
    await org()
    expect((await status()).updateCheckEnabled).toBe(true)
    await db.update(settings).set({ checkUpdates: false })
    const calls = fakeGithub(release())
    await refreshUpdateInfo(db, NOW)
    expect(calls).toHaveLength(0)
    const s = await status()
    expect(s).toMatchObject({ updateCheckEnabled: false, update: { state: 'disabled', latest: null } })
    expect(item(s, 'version').tone).toBe('grey')
  })
})

describe('sprawy panelu', () => {
  it('HTTPS i STORAGE_DIR', async () => {
    await org()
    expect(item(await status(), 'https').tone).toBe('green')
    expect(item(await status({ secure: false }), 'https')).toMatchObject({ tone: 'yellow', data: { secure: false } })
    expect(item(await status(), 'storage').tone).toBe('green')
    expect(item(await status({ storageConfigured: false }), 'storage')).toMatchObject({ tone: 'red', data: { configured: false } })
  })

  it('ostatnia kopia: świeża zielona, > 2 dni czerwona, brak STORAGE_DIR czerwona, brak kopii żółta, nieudana po udanej żółta', async () => {
    await org()
    expect(item(await status(), 'backup')).toMatchObject({ tone: 'yellow', data: { lastAt: null } })
    await addBackup({ startedAt: ago(0.5) })
    expect(item(await status(), 'backup')).toMatchObject({ tone: 'green', data: { ageDays: 0, lastFailed: false } })
    expect(item(await status({ storageConfigured: false }), 'backup').tone).toBe('red')
    await addBackup({ startedAt: ago(0.1), status: 'failed' })
    expect(item(await status(), 'backup')).toMatchObject({ tone: 'yellow', data: { lastFailed: true } })
    await db.delete(backups)
    await addBackup({ startedAt: ago(2) })
    expect(item(await status(), 'backup').tone).toBe('green') // równo 2 dni jeszcze nie „> 2”
    await db.delete(backups)
    await addBackup({ startedAt: ago(2.5) })
    expect(item(await status(), 'backup').tone).toBe('red') // próg liczony w godzinach, nie w pełnych dniach
    expect(item(await status({ storageConfigured: false }), 'backup')).toMatchObject({ tone: 'red', data: { noStorage: true } })
    await db.delete(backups)
    await addBackup({ startedAt: ago(3) })
    expect(item(await status(), 'backup')).toMatchObject({ tone: 'red', data: { ageDays: 3 } })
  })

  it('pobranie (żółte > 7 dni) i sprawdzenie (żółte > 30 dni) liczone od zdarzenia albo od pierwszej kopii; pobranie liczy też kopie usunięte rotacją', async () => {
    await org()
    expect(item(await status(), 'download').tone).toBe('grey') // brak kopii
    await addBackup({ startedAt: ago(1) })
    expect(item(await status(), 'download')).toMatchObject({ tone: 'grey', data: { lastAt: null, ageDays: 1 } })
    await db.delete(backups)
    await addBackup({ startedAt: ago(10) })
    expect(item(await status(), 'download')).toMatchObject({ tone: 'yellow', data: { ageDays: 10 } })
    expect(item(await status(), 'verify').tone).toBe('grey')
    await addBackup({ startedAt: ago(1), status: 'removed', downloadedAt: ago(2) })
    expect(item(await status(), 'download')).toMatchObject({ tone: 'green', data: { ageDays: 2 } })
    await db.delete(backups)
    await addBackup({ startedAt: ago(7.5) })
    expect(item(await status(), 'download').tone).toBe('yellow') // zgodnie z downloadDue (ms)
    await db.delete(backups)
    await addBackup({ startedAt: ago(30.5) })
    expect(item(await status(), 'verify').tone).toBe('yellow')
    await db.delete(backups)
    await addBackup({ startedAt: ago(40) })
    expect(item(await status(), 'verify')).toMatchObject({ tone: 'yellow', data: { ageDays: 40 } })
    await addBackup({ startedAt: ago(1), restoreTestedAt: ago(5) })
    expect(item(await status(), 'verify')).toMatchObject({ tone: 'green', data: { ageDays: 5 } })
    await db.delete(backups)
    await addBackup({ startedAt: ago(50), restoreTestedAt: ago(31) })
    expect(item(await status(), 'verify').tone).toBe('yellow')
  })

  it('konta bez 2FA: nazwy kont aktywnych bez TOTP (zaproszeni i wyłączeni pominięci)', async () => {
    await org()
    const ok = await addTestUser(db, { role: 'admin' })
    const bez = await addTestUser(db, { role: 'staff' })
    await db.update(users).set({ totpEnabledAt: null, name: 'Ewa Testowa' }).where(eq(users.id, bez.id))
    const invited = await addTestUser(db, { status: 'invited' })
    await db.update(users).set({ totpEnabledAt: null }).where(eq(users.id, invited.id))
    const off = await addTestUser(db, { status: 'disabled' })
    await db.update(users).set({ totpEnabledAt: null }).where(eq(users.id, off.id))
    expect(item(await status(), 'twofa')).toMatchObject({ tone: 'yellow', data: { missing: 1, names: ['Ewa Testowa'] } })
    await db.update(users).set({ totpEnabledAt: NOW }).where(eq(users.id, bez.id))
    expect(item(await status(), 'twofa')).toMatchObject({ tone: 'green', data: { missing: 0, names: [] } })
    expect(ok.id).toBeTruthy()
  })

  it('dostęp do danych wrażliwych i zmiana klucza: bez klucza szare; slot + odzyskiwanie zielone; bez odzyskiwania żółte; bez nikogo czerwone; rotacja w toku żółta', async () => {
    await org()
    expect(item(await status(), 'access')).toMatchObject({ tone: 'grey', data: { configured: false } })
    expect(item(await status(), 'rotation').tone).toBe('grey')
    const a = await addTestUser(db, { role: 'admin' })
    await db.update(users).set({ name: 'Anna Adminowa' }).where(eq(users.id, a.id))
    const s = await addTestUser(db, { role: 'staff' })
    await db.update(users).set({ name: 'Jan Pracownik' }).where(eq(users.id, s.id))
    await addTestUser(db, { role: 'staff' }) // bez slotu: nie wymieniony
    await db.insert(orgKeys).values({ version: 1, createdAt: NOW, createdBy: a.id })
    const slot = (userId: string | null, keyVersion: number) => db.insert(keySlots).values({ id: randomUUID(), userId, keyVersion, wrappedKey: 'x', grantedBy: a.id, grantedAt: NOW })
    expect(item(await status(), 'access')).toMatchObject({ tone: 'red', data: { names: [], hasRecovery: false } })
    await slot(a.id, 1)
    await slot(s.id, 1)
    expect(item(await status(), 'access')).toMatchObject({ tone: 'yellow', data: { names: ['Anna Adminowa', 'Jan Pracownik'], hasRecovery: false } })
    await slot(null, 1)
    expect(item(await status(), 'access')).toMatchObject({ tone: 'green', data: { hasRecovery: true } })
    expect(item(await status(), 'rotation')).toMatchObject({ tone: 'green', data: { inProgress: false } })
    await db.insert(orgKeys).values({ version: 2, createdAt: NOW, createdBy: a.id })
    expect(item(await status(), 'rotation')).toMatchObject({ tone: 'yellow', data: { inProgress: true, sensitive: 0, attachments: 0 } })
    // po rotacji liczy się slot do bieżącej (nowej) wersji
    expect(item(await status(), 'access').data.names).toEqual([])
  })

  it('okresy przechowywania: szara sprawa „jeszcze nie skonfigurowane” (logika w kroku 5)', async () => {
    await org()
    expect(item(await status(), 'retention')).toMatchObject({ tone: 'grey', data: { configured: false } })
  })

  it('wszystkie sprawy z D8 są w jednej odpowiedzi', async () => {
    await org()
    expect((await status()).items.map((i) => i.id)).toEqual(['version', 'https', 'storage', 'backup', 'download', 'verify', 'twofa', 'access', 'rotation', 'retention'])
  })
})

describe('RPC security.*', () => {
  const HOST = 'crm.example.org'
  const hdr = { host: HOST, 'x-forwarded-proto': 'https', origin: `https://${HOST}`, 'x-ngo-crm': '1' }

  async function call(app: ReturnType<typeof buildApp>, cookie: string | undefined, method: string, params?: unknown) {
    const res = await app.inject({ method: 'POST', url: '/api/rpc', headers: { ...hdr, ...(cookie ? { cookie } : {}) }, payload: { method, params } })
    return { status: res.statusCode, body: res.json() as { ok: boolean; data?: any; code?: string } }
  }

  it('administrator dostaje status bez adresów e-mail; pracownik i brak sesji nie', async () => {
    await org()
    const admin = await addTestUser(db, { role: 'admin' })
    const staff = await addTestUser(db, { role: 'staff' })
    await db.update(users).set({ totpEnabledAt: null }).where(eq(users.id, staff.id))
    const app = buildApp(db, [], dbSessions(db), { appSecret: TEST_APP_SECRET, storageDir: '/nie/istnieje' })
    const cookie = await sessionCookieFor(db, admin.id)
    const r = await call(app, cookie, 'security.status')
    expect(r).toMatchObject({ status: 200, body: { ok: true, data: { version: pkg.version, updateCheckEnabled: true } } })
    expect(item(r.body.data, 'storage').tone).toBe('green')
    expect(item(r.body.data, 'https').tone).toBe('green')
    const json = JSON.stringify(r.body.data)
    expect(json).not.toContain('@example.invalid')
    expect(json).not.toContain(admin.id)
    expect((await call(app, await sessionCookieFor(db, staff.id), 'security.status')).status).toBe(403)
    expect((await call(app, undefined, 'security.status')).status).toBe(401)
    await app.close()
  })

  it('bez STORAGE_DIR: czerwone; po http na localhost: HTTPS żółte', async () => {
    await org()
    const admin = await addTestUser(db, { role: 'admin' })
    const app = buildApp(db, [], dbSessions(db), { appSecret: TEST_APP_SECRET })
    const cookie = await sessionCookieFor(db, admin.id)
    const r = await call(app, cookie, 'security.status')
    expect(item(r.body.data, 'storage').tone).toBe('red')
    const local = await app.inject({ method: 'POST', url: '/api/rpc', headers: { host: 'localhost:3001', origin: 'http://localhost:3001', 'x-ngo-crm': '1', cookie }, payload: { method: 'security.status' } })
    expect(item(local.json().data, 'https').tone).toBe('yellow')
    await app.close()
  })

  it('wyłącznik sprawdzania wersji: zapis, wpis w dzienniku, pracownik odmowa, zły parametr 400', async () => {
    await org()
    const admin = await addTestUser(db, { role: 'admin' })
    const staff = await addTestUser(db, { role: 'staff' })
    const calls = fakeGithub(release())
    const app = buildApp(db, [], dbSessions(db), { appSecret: TEST_APP_SECRET })
    const cookie = await sessionCookieFor(db, admin.id)
    expect((await call(app, await sessionCookieFor(db, staff.id), 'security.setUpdateCheck', { enabled: false })).status).toBe(403)
    expect((await call(app, cookie, 'security.setUpdateCheck', { enabled: 'tak' })).status).toBe(400)
    expect((await call(app, cookie, 'security.setUpdateCheck', { enabled: false })).body.ok).toBe(true)
    expect((await call(app, cookie, 'security.status')).body.data).toMatchObject({ updateCheckEnabled: false, update: { state: 'disabled' } })
    expect(calls).toHaveLength(0)
    expect((await db.select().from(settings))[0]).toMatchObject({ checkUpdates: false, version: 2, updatedBy: admin.id })
    expect((await call(app, cookie, 'security.setUpdateCheck', { enabled: true })).body.ok).toBe(true)
    expect((await call(app, cookie, 'security.status')).body.data.updateCheckEnabled).toBe(true)
    // ta sama wartość drugi raz: bez zapisu i bez wpisu
    expect((await call(app, cookie, 'security.setUpdateCheck', { enabled: true })).body.ok).toBe(true)
    expect((await db.select().from(settings))[0]).toMatchObject({ version: 3 })
    const log = (await db.select().from(accessLog)).filter((l) => l.action.startsWith('update_check_')).sort((a, b) => a.at.getTime() - b.at.getTime())
    expect(log.map((l) => l.action)).toEqual(['update_check_disabled', 'update_check_enabled'])
    expect(log[0]).toMatchObject({ userId: admin.id })
    // po włączeniu serwer od razu pyta o wersję (w tle)
    for (let i = 0; i < 50 && calls.length === 0; i++) await new Promise((r) => setTimeout(r, 20))
    expect(calls).toHaveLength(1)
    await app.close()
  })
})
