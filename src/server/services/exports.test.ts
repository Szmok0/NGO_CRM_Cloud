// Eksporty i dziennik dostępu przez HTTP na lokalnej bazie testowej (ZADANIE_03, krok 6a; D7, D13, D14). Dane fikcyjne.
import { randomBytes, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { buildApp } from '../app'
import type { Db } from '../db/connection'
import {
  accessLog,
  actionParticipants,
  actions,
  activities,
  activityContacts,
  changeLog,
  contactIdentity,
  contactRoles,
  contactSensitive,
  contacts,
  erasedContacts,
  orgKeys,
  settings
} from '../db/schema'
import { openTestDb } from '../testDb'
import { SETTINGS_ID } from '../auth/setup'
import { dbSessions } from '../auth/sessions'
import { TEST_APP_SECRET, TEST_SCRYPT, addTestUser, sessionCookieFor, wipeAccounts } from '../auth/testkit'
import { dayStart } from './common'
import * as contactsSvc from './contacts'
import * as actionsSvc from './actions'

const HOST = 'crm.example.org'
const headers = { host: HOST, 'x-forwarded-proto': 'https', origin: `https://${HOST}`, 'x-ngo-crm': '1' }

let db: Db
let close: () => Promise<void>
let app: ReturnType<typeof buildApp>
const nowMs = Date.now()
const clock = () => new Date(nowMs)
/** Nazwa kont z `addTestUser`. */
const USER_NAME = 'Konto testowe'
const actor = () => ({ userId: randomUUID(), now: clock() })

async function rpc(cookie: string, method: string, params?: unknown) {
  const res = await app.inject({ method: 'POST', url: '/api/rpc', headers: { ...headers, cookie }, payload: { method, params } })
  return { status: res.statusCode, body: res.json() as { ok: boolean; code?: string; message?: string; data?: any } }
}

async function account(role: 'admin' | 'staff' | 'readonly') {
  const u = await addTestUser(db, { role, now: clock() })
  return { ...u, cookie: await sessionCookieFor(db, u.id, clock()) }
}

const person = async (o: { firstName?: string; lastName?: string; email?: string | null; phone?: string | null; address?: string | null; notes?: string | null; roles?: ('participant' | 'donor')[] } = {}) =>
  (
    await contactsSvc.createContact(
      db,
      {
        kind: 'person',
        firstName: o.firstName ?? 'Ewa',
        lastName: o.lastName ?? 'Testowa',
        name: null,
        email: o.email === undefined ? 'ewa@example.invalid' : o.email,
        phone: o.phone === undefined ? '+48 600 000 001' : o.phone,
        address: o.address === undefined ? 'ul. Fikcyjna 1' : o.address,
        city: 'Testowo',
        notes: o.notes ?? null,
        tags: ['tag-testowy'],
        roles: o.roles ?? ['participant']
      },
      actor()
    )
  ).id

const institution = async () =>
  (
    await contactsSvc.createContact(
      db,
      { kind: 'institution', firstName: null, lastName: null, name: 'Instytucja Testowa', email: 'biuro@example.invalid', phone: null, address: null, city: null, notes: null, tags: [], roles: [] },
      actor()
    )
  ).id

const action = async (o: { title?: string; status?: 'planned' | 'done' } = {}) =>
  (
    await actionsSvc.createAction(
      db,
      { type: 'workshop', framework: 'project', title: o.title ?? 'Warsztat testowy', status: o.status ?? 'planned', startDate: '2026-03-10', endDate: null, place: 'Sala', topicId: null, description: null, expectedParticipants: null },
      actor()
    )
  ).id

async function insertSettings(roleLabels: Record<string, string> = {}) {
  await db.insert(settings).values({
    id: SETTINGS_ID,
    createdAt: clock(),
    updatedAt: clock(),
    updatedBy: randomUUID(),
    version: 1,
    orgName: 'Stowarzyszenie testowe',
    profile: 'projects',
    enabledModules: ['contacts'],
    roleLabels
  })
}

const exportLog = () => db.select().from(accessLog).where(eq(accessLog.action, 'export'))

/** Wiersze CSV bez nagłówka, komórki jako tekst. */
const lines = (csv: string) => csv.split('\r\n')

async function cleanup() {
  for (const t of [erasedContacts, actionParticipants, activityContacts, activities, actions, contactRoles, contactSensitive, contactIdentity, contacts]) await db.delete(t)
  await db.delete(changeLog)
  await wipeAccounts(db)
  await db.delete(settings)
}

beforeAll(async () => {
  ;({ db, close } = await openTestDb())
  app = buildApp(db, [], dbSessions(db, clock), { appSecret: TEST_APP_SECRET, now: clock, scryptParams: TEST_SCRYPT })
})
beforeEach(async () => {
  await cleanup()
  await insertSettings()
  await db.insert(orgKeys).values({ version: 1, createdAt: clock(), createdBy: randomUUID(), retiredAt: null })
})
afterAll(async () => {
  if (!db) return
  await app?.close()
  await cleanup()
  await close()
})

describe('eksport CSV list (D14)', () => {
  it('readonly nie eksportuje CSV ani danych osoby; admin i staff tak', async () => {
    const ro = await account('readonly')
    const id = await person()
    expect((await rpc(ro.cookie, 'exports.csv', { list: 'contacts', columns: ['name'] })).status).toBe(403)
    expect((await rpc(ro.cookie, 'contacts.exportData', { id })).status).toBe(403)
    for (const role of ['admin', 'staff'] as const) {
      const u = await account(role)
      expect((await rpc(u.cookie, 'exports.csv', { list: 'contacts', columns: ['name'] })).status).toBe(200)
      expect((await rpc(u.cookie, 'contacts.exportData', { id })).status).toBe(200)
    }
    expect(await exportLog()).toHaveLength(4)
  })

  it('lista osób: tylko wybrane kolumny; bez e-maili i telefonów, jeśli ich nie zaznaczono', async () => {
    const s = await account('staff')
    await person()
    const minimal = await rpc(s.cookie, 'exports.csv', { list: 'contacts', columns: ['name', 'kind', 'roles'] })
    expect(minimal.body.data).toMatchObject({ rows: 1, filename: expect.stringMatching(/^osoby-\d{4}-\d{2}-\d{2}\.csv$/) })
    expect(lines(minimal.body.data.csv)).toEqual(['Nazwa;Rodzaj;Role', 'Ewa Testowa;osoba;uczestnik'])
    expect(minimal.body.data.csv).not.toMatch(/example\.invalid|600 000|Fikcyjna/)

    const full = await rpc(s.cookie, 'exports.csv', { list: 'contacts', columns: ['phone', 'email', 'name'] })
    // kolejność kolumn wg kontraktu, nie żądania
    expect(lines(full.body.data.csv)).toEqual(['Nazwa;E-mail;Telefon', 'Ewa Testowa;ewa@example.invalid;+48 600 000 001'])
  })

  it('nazwy ról organizacji (własne etykiety) w kolumnie Role', async () => {
    await db.delete(settings)
    await insertSettings({ participant: 'beneficjent' })
    const s = await account('staff')
    await person()
    expect(lines((await rpc(s.cookie, 'exports.csv', { list: 'contacts', columns: ['roles'] })).body.data.csv)).toEqual(['Role', 'beneficjent'])
  })

  it('filtry listy: rodzaj i szukanie; osoba z Kosza i zanonimizowana poza plikiem', async () => {
    const s = await account('admin')
    await person({ firstName: 'Anna', lastName: 'Alfa' })
    await person({ firstName: 'Bartosz', lastName: 'Beta' })
    await institution()
    const gone = await person({ firstName: 'Cezary', lastName: 'Gamma' })
    const v = (await rpc(s.cookie, 'contacts.get', { id: gone })).body.data.contact.version
    await rpc(s.cookie, 'contacts.delete', { id: gone, version: v })

    const all = await rpc(s.cookie, 'exports.csv', { list: 'contacts', columns: ['name'] })
    expect(lines(all.body.data.csv)).toEqual(['Nazwa', 'Anna Alfa', 'Bartosz Beta', 'Instytucja Testowa'])
    const onlyInst = await rpc(s.cookie, 'exports.csv', { list: 'contacts', kind: 'institution', columns: ['name'] })
    expect(lines(onlyInst.body.data.csv)).toEqual(['Nazwa', 'Instytucja Testowa'])
    const q = await rpc(s.cookie, 'exports.csv', { list: 'contacts', q: 'Beta', columns: ['name'] })
    expect(lines(q.body.data.csv)).toEqual(['Nazwa', 'Bartosz Beta'])

    // anonimizacja: osoba znika z pliku
    const anna = (await rpc(s.cookie, 'contacts.list', { q: 'Alfa' })).body.data[0]
    const done = await rpc(s.cookie, 'contacts.anonymize', { id: anna.id, version: anna.version, confirm: 'ANONIMIZUJ' })
    expect(done.status).toBe(200)
    expect(lines((await rpc(s.cookie, 'exports.csv', { list: 'contacts', columns: ['name'] })).body.data.csv)).toEqual(['Nazwa', 'Bartosz Beta', 'Instytucja Testowa'])
  })

  it('CSV nie zawiera danych wrażliwych ani notatek z tożsamości', async () => {
    const s = await account('staff')
    const id = await person({ notes: 'NOTATKA-PRYWATNA' })
    const iv = randomBytes(12).toString('base64')
    const ciphertext = randomBytes(200).toString('base64')
    await db.insert(contactSensitive).values({ id: randomUUID(), createdAt: clock(), updatedAt: clock(), updatedBy: s.id, version: 1, contactId: id, keyVersion: 1, iv, ciphertext })
    const r = await rpc(s.cookie, 'exports.csv', { list: 'contacts', columns: ['name', 'kind', 'roles', 'tags', 'email', 'phone', 'address', 'city'] })
    expect(r.status).toBe(200)
    expect(r.body.data.csv).not.toContain(ciphertext)
    expect(r.body.data.csv).not.toContain(iv)
    expect(r.body.data.csv).not.toContain('NOTATKA-PRYWATNA')
    // kolumn wrażliwych i notatek nie da się nawet zażądać
    expect((await rpc(s.cookie, 'exports.csv', { list: 'contacts', columns: ['notes'] })).status).toBe(400)
    expect((await rpc(s.cookie, 'exports.csv', { list: 'contacts', columns: ['sensitive'] })).status).toBe(400)
    expect((await rpc(s.cookie, 'exports.csv', { list: 'contacts', columns: [] })).status).toBe(400)
  })

  it('komórki z formułą dostają apostrof, numer telefonu z plusem zostaje', async () => {
    const s = await account('staff')
    await person({ firstName: '=HYPERLINK("x")', lastName: 'Testowa', phone: '+48 600 000 001', address: '@SUMA(A1)' })
    const r = await rpc(s.cookie, 'exports.csv', { list: 'contacts', columns: ['name', 'phone', 'address'] })
    expect(r.body.data.csv).toContain('"\'=HYPERLINK(""x"") Testowa"')
    expect(r.body.data.csv).toContain(';+48 600 000 001;')
    expect(r.body.data.csv).toContain(";'@SUMA(A1)")
  })

  it('wpis `export` z rodzajem listy, bez filtra, z autorem i bez danych osobowych', async () => {
    const s = await account('staff')
    await person({ lastName: 'Unikalnonazwisko' })
    await rpc(s.cookie, 'exports.csv', { list: 'contacts', q: 'Unikalnonazwisko', columns: ['name'] })
    await rpc(s.cookie, 'exports.csv', { list: 'actions', columns: ['title'] })
    const rows = await exportLog()
    expect(rows.map((r) => ({ userId: r.userId, targetType: r.targetType, targetId: r.targetId })).sort((a, b) => a.targetType!.localeCompare(b.targetType!))).toEqual([
      { userId: s.id, targetType: 'actions_list', targetId: null },
      { userId: s.id, targetType: 'contacts_list', targetId: null }
    ])
    expect(JSON.stringify(rows)).not.toContain('Unikalnonazwisko')
  })

  it('lista działań: filtr statusu i kolumny', async () => {
    const s = await account('staff')
    await action({ title: 'Warsztat A', status: 'planned' })
    await action({ title: 'Warsztat B', status: 'done' })
    const r = await rpc(s.cookie, 'exports.csv', { list: 'actions', status: 'done', columns: ['title', 'type', 'status', 'startDate', 'participantCount'] })
    expect(lines(r.body.data.csv)).toEqual(['Tytuł;Typ;Status;Data od;Liczba uczestników', 'Warsztat B;warsztat;zakończone;2026-03-10;0'])
    expect(r.body.data.filename).toMatch(/^dzialania-/)
  })

  it('uczestnicy działania: dane osób, status i frekwencja; osoba z Kosza pominięta; wpis z id działania', async () => {
    const s = await account('staff')
    const act = await action()
    const a = await person({ firstName: 'Anna', lastName: 'Alfa' })
    const b = await person({ firstName: 'Bartosz', lastName: 'Beta' })
    for (const id of [a, b]) await actionsSvc.addParticipantById(db, { actionId: act, contactId: id }, actor())
    const bv = (await rpc(s.cookie, 'contacts.get', { id: b })).body.data.contact.version
    await rpc(s.cookie, 'contacts.delete', { id: b, version: bv })

    const r = await rpc(s.cookie, 'exports.csv', { list: 'participants', actionId: act, columns: ['name', 'email', 'status', 'attendance'] })
    expect(r.status).toBe(200)
    expect(lines(r.body.data.csv)).toEqual(['Nazwa;E-mail;Status;Frekwencja (%)', 'Anna Alfa;ewa@example.invalid;zgłoszony;'])
    expect(r.body.data.filename).toMatch(/^uczestnicy-/)
    expect(await exportLog()).toMatchObject([{ userId: s.id, targetType: 'participants_list', targetId: act }])
    // brak działania
    expect((await rpc(s.cookie, 'exports.csv', { list: 'participants', actionId: randomUUID(), columns: ['name'] })).status).toBe(404)
  })
})

describe('eksport danych osoby (D13)', () => {
  it('zwraca wszystko o osobie bez szyfrogramu i zapisuje wpis `export` z id osoby', async () => {
    const s = await account('staff')
    const id = await person({ notes: 'Notatka' })
    const act = await action()
    await actionsSvc.addParticipantById(db, { actionId: act, contactId: id }, actor())
    const iv = randomBytes(12).toString('base64')
    const ciphertext = randomBytes(200).toString('base64')
    await db.insert(contactSensitive).values({ id: randomUUID(), createdAt: clock(), updatedAt: clock(), updatedBy: s.id, version: 1, contactId: id, keyVersion: 1, iv, ciphertext })

    const r = await rpc(s.cookie, 'contacts.exportData', { id })
    expect(r.status).toBe(200)
    expect(r.body.data).toMatchObject({
      exportedAt: new Date(nowMs).toISOString(),
      attachments: [],
      detail: {
        label: 'Ewa Testowa',
        contact: { email: 'ewa@example.invalid', phone: '+48 600 000 001', notes: 'Notatka' },
        roles: [{ role: 'participant' }],
        participations: [{ action: { id: act } }],
        hasSensitive: true,
        sensitiveKeyVersion: 1
      }
    })
    expect(JSON.stringify(r.body)).not.toContain(ciphertext)
    expect(await exportLog()).toMatchObject([{ userId: s.id, targetType: 'contact', targetId: id }])
  })

  it('instytucja → 400 PERSON_ONLY, brak osoby → 404, zanonimizowana → 404; żaden nie zostawia wpisu', async () => {
    const admin = await account('admin')
    const inst = await institution()
    expect(await rpc(admin.cookie, 'contacts.exportData', { id: inst })).toMatchObject({ status: 400, body: { code: 'VALIDATION', message: 'PERSON_ONLY' } })
    expect((await rpc(admin.cookie, 'contacts.exportData', { id: randomUUID() })).status).toBe(404)

    const id = await person()
    const v = (await rpc(admin.cookie, 'contacts.anonymizePreview', { id })).body.data.version
    expect((await rpc(admin.cookie, 'contacts.anonymize', { id, version: v, confirm: 'ANONIMIZUJ' })).status).toBe(200)
    expect((await rpc(admin.cookie, 'contacts.exportData', { id })).status).toBe(404)
    expect(await exportLog()).toHaveLength(0)
  })

  it('osoba z Kosza da się wyeksportować', async () => {
    const s = await account('staff')
    const id = await person()
    const v = (await rpc(s.cookie, 'contacts.get', { id })).body.data.contact.version
    await rpc(s.cookie, 'contacts.delete', { id, version: v })
    expect((await rpc(s.cookie, 'contacts.exportData', { id })).status).toBe(200)
  })
})

describe('dziennik dostępu (D7)', () => {
  /** Wpis w dzienniku z wybraną chwilą. */
  const entry = (userId: string | null, action: string, at: Date, targetId?: string, targetType?: string) =>
    db.insert(accessLog).values({ id: randomUUID(), userId, action, at, targetType: targetType ?? null, targetId: targetId ?? null })

  it('tylko admin: staff i readonly → 403 (lista i eksport)', async () => {
    for (const role of ['staff', 'readonly'] as const) {
      const u = await account(role)
      expect((await rpc(u.cookie, 'accessLog.list')).status).toBe(403)
      expect((await rpc(u.cookie, 'accessLog.exportCsv')).status).toBe(403)
    }
    const admin = await account('admin')
    expect((await rpc(admin.cookie, 'accessLog.list')).status).toBe(200)
  })

  it('lista od najnowszych z dociągniętymi nazwami (użytkownik, osoba, działanie); osoba zanonimizowana ma pustą etykietę', async () => {
    const admin = await account('admin')
    const staff = await account('staff')
    const id = await person({ firstName: 'Anna', lastName: 'Alfa' })
    const act = await action({ title: 'Warsztat nazwany' })
    const t = (min: number) => new Date(nowMs - min * 60_000)
    await entry(staff.id, 'reveal_sensitive', t(30), id, 'contact')
    await entry(admin.id, 'grant_access', t(20), staff.id, 'user')
    await entry(staff.id, 'export', t(10), act, 'participants_list')
    await entry(staff.id, 'export', t(5), undefined, 'contacts_list')
    await entry(null, 'login_failed', t(1))

    const r = await rpc(admin.cookie, 'accessLog.list', {})
    expect(r.body.data.hasMore).toBe(false)
    const rows = r.body.data.rows as any[]
    // dwa wpisy `login` z sesji testowych mogą być na liście; sprawdzamy własne wpisy po rodzaju
    const mine = rows.filter((x) => ['reveal_sensitive', 'grant_access', 'export', 'login_failed'].includes(x.action))
    expect(mine.map((x) => x.action)).toEqual(['login_failed', 'export', 'export', 'grant_access', 'reveal_sensitive'])
    expect(mine[0]).toMatchObject({ userId: null, userName: null, targetLabel: null })
    expect(mine[1]).toMatchObject({ targetType: 'contacts_list', targetId: null, targetLabel: null, userName: USER_NAME })
    expect(mine[2]).toMatchObject({ targetType: 'participants_list', targetLabel: 'Warsztat nazwany' })
    expect(mine[3]).toMatchObject({ targetType: 'user', targetLabel: USER_NAME, userName: USER_NAME })
    expect(mine[4]).toMatchObject({ targetType: 'contact', targetLabel: 'Anna Alfa' })

    // po anonimizacji nazwa znika, wpis zostaje
    const v = (await rpc(admin.cookie, 'contacts.anonymizePreview', { id })).body.data.version
    await rpc(admin.cookie, 'contacts.anonymize', { id, version: v, confirm: 'ANONIMIZUJ' })
    const after = (await rpc(admin.cookie, 'accessLog.list', {})).body.data.rows.find((x: any) => x.action === 'reveal_sensitive')
    expect(after).toMatchObject({ targetId: id, targetLabel: '' })
  })

  it('filtry: użytkownik, rodzaj zdarzenia, zakres dat (dni polskie, włącznie)', async () => {
    const admin = await account('admin')
    const u1 = await account('staff')
    const u2 = await account('staff')
    await db.delete(accessLog) // bez wpisów logowania z kont testowych
    // 2026-03-10 22:30 UTC = 23:30 w Polsce (zima, UTC+1) → dzień 10; 2026-03-10 23:30 UTC = 00:30 dnia 11
    await entry(u1.id, 'reveal_sensitive', new Date('2026-03-10T22:30:00Z'))
    await entry(u1.id, 'export', new Date('2026-03-10T23:30:00Z'))
    await entry(u2.id, 'export', new Date('2026-03-12T10:00:00Z'))
    // lato (UTC+2): 2026-07-01 22:30 UTC = 00:30 dnia 2
    await entry(u2.id, 'export', new Date('2026-07-01T22:30:00Z'))

    const ask = async (p: object) => ((await rpc(admin.cookie, 'accessLog.list', p)).body.data.rows as any[]).map((x) => x.at)
    expect(await ask({ userId: u2.id })).toHaveLength(2)
    expect(await ask({ action: 'export' })).toHaveLength(3)
    expect(await ask({ userId: u1.id, action: 'export' })).toEqual(['2026-03-10T23:30:00.000Z'])
    expect(await ask({ from: '2026-03-10', to: '2026-03-10' })).toEqual(['2026-03-10T22:30:00.000Z'])
    expect(await ask({ from: '2026-03-11', to: '2026-03-11' })).toEqual(['2026-03-10T23:30:00.000Z'])
    expect(await ask({ from: '2026-03-11', to: '2026-03-12' })).toEqual(['2026-03-12T10:00:00.000Z', '2026-03-10T23:30:00.000Z'])
    expect(await ask({ from: '2026-07-02', to: '2026-07-02' })).toEqual(['2026-07-01T22:30:00.000Z'])
    expect(await ask({ to: '2026-07-01' })).toHaveLength(3)
    expect(await ask({ from: '2026-07-03' })).toEqual([])
  })

  it('strony: limit i offset, hasMore', async () => {
    const admin = await account('admin')
    await db.delete(accessLog)
    for (let i = 0; i < 5; i++) await entry(admin.id, 'export', new Date(nowMs - i * 1000))
    const p1 = (await rpc(admin.cookie, 'accessLog.list', { limit: 2 })).body.data
    expect(p1.rows).toHaveLength(2)
    expect(p1.hasMore).toBe(true)
    const p3 = (await rpc(admin.cookie, 'accessLog.list', { limit: 2, offset: 4 })).body.data
    expect(p3.rows).toHaveLength(1)
    expect(p3.hasMore).toBe(false)
    expect((await rpc(admin.cookie, 'accessLog.list', { limit: 501 })).status).toBe(400)
  })

  it('eksport CSV: polskie nazwy, czas polski, filtry; sam eksport trafia do dziennika', async () => {
    const admin = await account('admin')
    const id = await person({ firstName: 'Anna', lastName: 'Alfa' })
    await db.delete(accessLog)
    await entry(admin.id, 'reveal_sensitive', new Date('2026-03-10T22:30:00Z'), id, 'contact')
    await entry(admin.id, 'anonymize', new Date('2026-03-11T09:05:07Z'), randomUUID(), 'contact')

    const r = await rpc(admin.cookie, 'accessLog.exportCsv', { from: '2026-03-10', to: '2026-03-11' })
    expect(r.status).toBe(200)
    expect(r.body.data).toMatchObject({ rows: 2, filename: expect.stringMatching(/^dziennik-dostepu-\d{4}-\d{2}-\d{2}\.csv$/) })
    expect(lines(r.body.data.csv)).toEqual([
      'Data i godzina;Użytkownik;Zdarzenie;Dotyczy;Nazwa',
      `11.03.2026 10:05:07;${USER_NAME};anonimizacja osoby;osoba;`,
      `10.03.2026 23:30:00;${USER_NAME};odsłonięcie danych wrażliwych;osoba;Anna Alfa`
    ])

    const log = await exportLog()
    expect(log).toMatchObject([{ userId: admin.id, targetType: 'access_log', targetId: null }])
    // drugi eksport widzi pierwszy
    const second = await rpc(admin.cookie, 'accessLog.exportCsv', { action: 'export' })
    expect(second.body.data.rows).toBe(1)
    expect(lines(second.body.data.csv)[1]).toMatch(/;eksport;dziennik dostępu;$/)
  })
})

describe('dayStart', () => {
  it('początek polskiego dnia jako chwila UTC (zima +1, lato +2, zmiana czasu)', () => {
    expect(dayStart('2026-01-15').toISOString()).toBe('2026-01-14T23:00:00.000Z')
    expect(dayStart('2026-07-15').toISOString()).toBe('2026-07-14T22:00:00.000Z')
    // zmiana czasu 2026-03-29 (02:00 → 03:00): dzień 29 zaczyna się jeszcze w czasie zimowym, dzień 30 w letnim
    expect(dayStart('2026-03-29').toISOString()).toBe('2026-03-28T23:00:00.000Z')
    expect(dayStart('2026-03-30').toISOString()).toBe('2026-03-29T22:00:00.000Z')
    // zmiana czasu 2026-10-25 (03:00 → 02:00)
    expect(dayStart('2026-10-25').toISOString()).toBe('2026-10-24T22:00:00.000Z')
    expect(dayStart('2026-10-26').toISOString()).toBe('2026-10-25T23:00:00.000Z')
  })
})
