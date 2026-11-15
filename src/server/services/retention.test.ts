// Testy okresów przechowywania (ZADANIE_04, krok 5; D10). Wymaga lokalnej bazy testowej. Dane wyłącznie fikcyjne.
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { RetentionList } from '@shared/api'
import { buildApp } from '../app'
import { dbSessions } from '../auth/sessions'
import { TEST_APP_SECRET, TEST_SCRYPT, addTestUser, sessionCookieFor, wipeAccounts } from '../auth/testkit'
import type { Db } from '../db/connection'
import {
  accessLog,
  actionParticipants,
  actionSessions,
  actions,
  activities,
  activityContacts,
  attendance,
  contactIdentity,
  contactRoles,
  contacts,
  settings,
  taskItems,
  tasks
} from '../db/schema'
import { openTestDb } from '../testDb'
import { addYear, subtractMonths, wholeMonthsBetween } from './retention'
import { getSecurityStatus } from './securityStatus'

const HOST = 'crm.example.org'
const headers = { host: HOST, 'x-forwarded-proto': 'https', origin: `https://${HOST}`, 'x-ngo-crm': '1' }
const NOW = new Date('2026-11-15T12:00:00.000Z')
const clock = () => NOW
const at = (day: string) => new Date(`${day}T10:00:00.000Z`)

let db: Db
let close: () => Promise<void>
let app: ReturnType<typeof buildApp>
let admin: { id: string; cookie: string }
let staff: { id: string; cookie: string }

async function rpc(cookie: string | undefined, method: string, params?: unknown) {
  const res = await app.inject({ method: 'POST', url: '/api/rpc', headers: { ...headers, ...(cookie ? { cookie } : {}) }, payload: { method, params } })
  return { status: res.statusCode, body: res.json() as { ok: boolean; code?: string; data?: any } }
}
const list = async () => (await rpc(admin.cookie, 'retention.list')).body.data as RetentionList
const labels = async () => (await list()).items.map((i) => i.label)

const tech = (day = '2026-11-01') => ({ id: randomUUID(), createdAt: at(day), updatedAt: at(day), updatedBy: admin.id, deletedAt: null, version: 1 })

interface P {
  last: string
  created?: string
  kind?: 'person' | 'institution'
  deleted?: boolean
  anonymized?: boolean
  snooze?: string
}
/** Osoba „Nazwisko”; `created` domyślnie bardzo dawno, żeby o liście decydowała aktywność. */
async function person(last: string, o: Partial<P> = {}) {
  const base = tech(o.created ?? '2019-01-10')
  await db.insert(contacts).values({
    ...base,
    kind: o.kind ?? 'person',
    tags: [],
    deletedAt: o.deleted ? at('2025-01-01') : null,
    anonymizedAt: o.anonymized ? at('2025-01-01') : null,
    retentionSnoozeUntil: o.snooze ?? null
  })
  await db.insert(contactIdentity).values({ ...tech(), contactId: base.id, firstName: 'Jan', lastName: last, name: o.kind === 'institution' ? last : null })
  return base.id
}
const role = (contactId: string, r: string, until: string | null = null) => db.insert(contactRoles).values({ ...tech(), contactId, role: r, since: '2019-01-10', until })

async function actionOn(startDate: string, endDate: string | null = null) {
  const a = tech()
  await db.insert(actions).values({ ...a, type: 'training', framework: 'project', title: 'Działanie testowe', status: 'done', startDate, endDate })
  return a.id
}

async function cleanup() {
  for (const t of [attendance, actionSessions, actionParticipants, taskItems, tasks, activityContacts, activities, actions, contactRoles, contactIdentity, contacts]) await db.delete(t)
  await wipeAccounts(db)
}
async function org(retentionMonths: number | null) {
  await db.insert(settings).values({ ...tech(), orgName: 'Stowarzyszenie testowe', profile: 'projects', enabledModules: ['contacts'], roleLabels: {}, retentionMonths })
}

beforeAll(async () => {
  ;({ db, close } = await openTestDb())
  app = buildApp(db, [], dbSessions(db, clock), { appSecret: TEST_APP_SECRET, now: clock, scryptParams: TEST_SCRYPT })
})
beforeEach(async () => {
  await cleanup()
  const a = await addTestUser(db, { role: 'admin', now: NOW })
  const s = await addTestUser(db, { role: 'staff', now: NOW })
  admin = { id: a.id, cookie: await sessionCookieFor(db, a.id, NOW) }
  staff = { id: s.id, cookie: await sessionCookieFor(db, s.id, NOW) }
})
afterAll(async () => {
  if (!db) return
  await app?.close()
  await cleanup()
  await close()
})

describe('daty pomocnicze', () => {
  it('odejmowanie miesięcy przycina dzień, rok przestępny, liczenie pełnych miesięcy', () => {
    expect(subtractMonths('2026-11-15', 24)).toBe('2024-11-15')
    expect(subtractMonths('2026-03-31', 1)).toBe('2026-02-28')
    expect(subtractMonths('2026-01-15', 2)).toBe('2025-11-15')
    expect(addYear('2024-02-29')).toBe('2025-02-28')
    expect(addYear('2026-11-15')).toBe('2027-11-15')
    expect(wholeMonthsBetween('2024-11-16', '2026-11-15')).toBe(23)
    expect(wholeMonthsBetween('2024-11-15', '2026-11-15')).toBe(24)
    expect(wholeMonthsBetween('2026-12-01', '2026-11-15')).toBe(0)
  })
})

describe('lista osób po okresie', () => {
  it('okres wyłączony: pusta lista i months = null', async () => {
    await org(null)
    await person('Stary')
    expect(await list()).toEqual({ months: null, items: [] })
  })

  it('stara osoba bez aktywności jest na liście, świeża nie; granica to dokładnie okres', async () => {
    await org(24)
    await person('Dawny', { created: '2020-03-05' })
    await person('Swiezy', { created: '2026-06-01' })
    await person('Graniczny', { created: '2024-11-15' }) // dokładnie 24 miesiące temu: jeszcze nie po okresie
    await person('Tuzprzed', { created: '2024-11-14' })
    const l = await list()
    expect(l.months).toBe(24)
    expect(l.items.map((i) => i.label)).toEqual(['Jan Dawny', 'Jan Tuzprzed'])
    expect(l.items[0]).toMatchObject({ lastActivityOn: '2020-03-05', monthsInactive: 80 })
    expect(typeof l.items[0]!.version).toBe('number')
  })

  it('oś, udział w działaniu, obecność i zadania przesuwają ostatnią aktywność', async () => {
    await org(24)
    const onAxis = await person('Os')
    const oldAxis = await person('OsStara')
    const inAction = await person('Dzialanie')
    const inOldAction = await person('DzialanieStare')
    const present = await person('Obecnosc')
    const openTask = await person('Zadanie')
    const doneTask = await person('ZadanieZrobione')
    const future = await person('Przyszle')

    const newAct = { ...tech(), type: 'note', occurredAt: at('2026-06-10'), content: '' }
    const oldAct = { ...tech(), type: 'note', occurredAt: at('2023-02-10'), content: '' }
    await db.insert(activities).values([newAct, oldAct])
    await db.insert(activityContacts).values([
      { ...tech(), activityId: newAct.id, contactId: onAxis },
      { ...tech(), activityId: oldAct.id, contactId: oldAxis }
    ])

    const recentAction = await actionOn('2026-02-01', '2026-03-01')
    const oldAction = await actionOn('2021-02-01', '2021-02-02')
    const upcoming = await actionOn('2027-03-01')
    await db.insert(actionParticipants).values([
      { ...tech(), actionId: recentAction, contactId: inAction, status: 'confirmed' },
      { ...tech(), actionId: oldAction, contactId: inOldAction, status: 'confirmed' },
      { ...tech(), actionId: upcoming, contactId: future, status: 'registered' }
    ])

    const session = { ...tech(), actionId: oldAction, date: '2026-01-20' }
    await db.insert(actionSessions).values(session)
    await db.insert(attendance).values({ ...tech(), sessionId: session.id, contactId: present, status: 'present' })

    await db.insert(tasks).values([
      { ...tech('2020-01-01'), title: 'Otwarte', status: 'todo', priority: 'normal', targetType: 'contact', targetId: openTask },
      { ...tech('2020-01-01'), title: 'Zrobione', status: 'done', priority: 'normal', targetType: 'contact', targetId: doneTask }
    ])

    const l = await list()
    expect(l.items.map((i) => i.label).sort()).toEqual(['Jan DzialanieStare', 'Jan OsStara', 'Jan ZadanieZrobione'].sort())
    expect(l.items.find((i) => i.label === 'Jan OsStara')!.lastActivityOn).toBe('2023-02-10')
    expect(l.items.find((i) => i.label === 'Jan DzialanieStare')!.lastActivityOn).toBe('2021-02-02')
  })

  it('aktywna rola członek / pracownik / darczyńca wyłącza osobę; zakończona, uczestnik i inna nie', async () => {
    await org(24)
    const member = await person('Czlonek')
    const staffer = await person('Pracownik')
    const donor = await person('Darczynca')
    const formerMember = await person('Byly')
    const participant = await person('Uczestnik')
    const deletedRole = await person('RolaUsunieta')
    await role(member, 'member')
    await role(staffer, 'staff', '2027-01-01')
    await role(donor, 'donor')
    await role(formerMember, 'member', '2021-12-31')
    await role(participant, 'participant')
    await db.insert(contactRoles).values({ ...tech(), deletedAt: at('2025-01-01'), contactId: deletedRole, role: 'member', since: '2019-01-10', until: null })
    expect((await labels()).sort()).toEqual(['Jan Byly', 'Jan RolaUsunieta', 'Jan Uczestnik'])
  })

  it('nie wchodzą: usunięte, zanonimizowane, instytucje, odłożone na rok; po upływie odłożenia wracają', async () => {
    await org(24)
    await person('Usuniety', { deleted: true })
    await person('Zanonimizowany', { anonymized: true })
    await person('Instytucja', { kind: 'institution' })
    await person('Odlozony', { snooze: '2027-05-01' })
    await person('OdlozonyDawno', { snooze: '2026-11-14' })
    expect(await labels()).toEqual(['Jan OdlozonyDawno'])
  })
})

describe('RPC retention.*', () => {
  it('uprawnienia: pracownik 403, brak sesji 401, zła wartość 400', async () => {
    await org(null)
    for (const [m, p] of [
      ['retention.list', undefined],
      ['retention.setPeriod', { months: 12 }],
      ['retention.snooze', { contactId: randomUUID(), version: 1 }]
    ] as const) {
      expect((await rpc(staff.cookie, m, p)).status).toBe(403)
      expect((await rpc(undefined, m, p)).status).toBe(401)
    }
    for (const months of [0, -3, 241, 1.5, '24']) expect((await rpc(admin.cookie, 'retention.setPeriod', { months })).status).toBe(400)
  })

  it('setPeriod zapisuje okres i wpis w dzienniku; ta sama wartość nie loguje; null wyłącza', async () => {
    await org(null)
    const logs = async () => (await db.select().from(accessLog).where(eq(accessLog.action, 'retention_changed'))).length
    expect((await rpc(admin.cookie, 'retention.setPeriod', { months: 24 })).body.ok).toBe(true)
    expect((await list()).months).toBe(24)
    expect(await logs()).toBe(1)
    expect((await rpc(admin.cookie, 'retention.setPeriod', { months: 24 })).body.ok).toBe(true)
    expect(await logs()).toBe(1)
    expect((await rpc(admin.cookie, 'retention.setPeriod', { months: null })).body.ok).toBe(true)
    expect((await list()).months).toBeNull()
    expect(await logs()).toBe(2)
  })

  it('snooze: osoba znika z listy na rok od dziś, wersja chroni przed nadpisaniem, zły identyfikator to 404', async () => {
    await org(24)
    const id = await person('Dawny')
    const [item] = (await list()).items
    expect(item!.contactId).toBe(id)
    expect((await rpc(admin.cookie, 'retention.snooze', { contactId: id, version: item!.version + 5 })).status).toBe(409)
    expect((await rpc(admin.cookie, 'retention.snooze', { contactId: id, version: item!.version })).body.ok).toBe(true)
    expect((await list()).items).toEqual([])
    const [c] = await db.select().from(contacts).where(eq(contacts.id, id))
    expect(c!.retentionSnoozeUntil).toBe('2027-11-15')
    expect(c!.version).toBe(item!.version + 1)
    expect((await rpc(admin.cookie, 'retention.snooze', { contactId: randomUUID(), version: 1 })).status).toBe(404)
    const inst = await person('Instytucja', { kind: 'institution' })
    expect((await rpc(admin.cookie, 'retention.snooze', { contactId: inst, version: 1 })).status).toBe(404)
  })
})

describe('panel „Stan bezpieczeństwa”: sprawa okresów przechowywania', () => {
  const status = async () => (await getSecurityStatus(db, { storageConfigured: true, secure: true, now: NOW })).items.find((i) => i.id === 'retention')!
  it('szara bez okresu, zielona bez osób, żółta z liczbą osób (bez nazwisk)', async () => {
    await org(null)
    expect(await status()).toMatchObject({ tone: 'grey', data: { configured: false } })
    await db.update(settings).set({ retentionMonths: 24 })
    expect(await status()).toMatchObject({ tone: 'green', data: { configured: true, months: 24, due: 0 } })
    await person('Tajemnicza')
    await person('Inna')
    const s = await status()
    expect(s).toMatchObject({ tone: 'yellow', data: { due: 2 } })
    expect(JSON.stringify(s)).not.toMatch(/Tajemnicza|Inna/)
  })
})
