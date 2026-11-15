// Test „Kopia do pomocy” (ZADANIE_04, krok 5; D7; bezpieczeństwo, rozdział 6). Wymaga lokalnej bazy testowej.
// Fikcyjne dane demonstracyjne z imionami, nazwiskami, e-mailami, telefonami i treścią wpisów; w pliku nie może być nic z tego.
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
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
  changeLog,
  consents,
  contactIdentity,
  contactRoles,
  contactSensitive,
  contacts,
  erasedContacts,
  orgKeys,
  relationships,
  settings,
  taskItems,
  tasks,
  topics,
  users
} from '../db/schema'
import { openTestDb } from '../testDb'
import { SUPPORT_SKIPPED_TABLES, buildSupportCopy, sanitizeRows, schemaTableNames, supportRuleTables } from './supportCopy'

const HOST = 'crm.example.org'
const headers = { host: HOST, 'x-forwarded-proto': 'https', origin: `https://${HOST}`, 'x-ngo-crm': '1' }
const NOW = new Date('2026-11-15T12:00:00.000Z')
const clock = () => NOW

let db: Db
let close: () => Promise<void>
let app: ReturnType<typeof buildApp>
let adminId: string
let staffId: string

/** Wszystko, co jest dla tej organizacji danymi osobowymi albo treścią: żadne z tych słów nie może trafić do pliku. */
const SECRETS = [
  'Zdzisława',
  'Qwertyuszkiewicz',
  'Barnaba',
  'Trzcinowski',
  'zdzislawa.qw@example.org',
  '501 777 123',
  '501777123',
  'ul. Fikcyjna 7',
  'Wzorcowo',
  'rodzina-qwerty',
  'Notatka o Zdzisławie',
  'Rozmowa z panią Zdzisławą',
  'Pomoc dla Qwertyuszkiewiczów',
  'Warsztaty u Trzcinowskich',
  'Sala Barnaby',
  'Opis spotkania z Barnabą',
  'Program Qwerty',
  'Temat Qwerty',
  'Zadzwonić do Zdzisławy',
  'Kupić kwiaty dla Barnaby',
  'Zgoda ustna od Zdzisławy',
  'Uwaga o roli Barnaba',
  'Siostra Zdzisławy',
  'Fundacja Qwerty',
  'Podopieczny Qwerty',
  'Konto testowe',
  'example.invalid',
  'example.org'
]

const at = (day: string) => new Date(`${day}T10:00:00.000Z`)
const tech = () => ({ id: randomUUID(), createdAt: at('2026-10-01'), updatedAt: at('2026-10-01'), updatedBy: adminId, deletedAt: null, version: 1 })

async function seed() {
  const p1 = tech()
  const p2 = tech()
  const inst = tech()
  await db.insert(contacts).values([
    { ...p1, kind: 'person', tags: ['rodzina-qwerty'] },
    { ...p2, kind: 'person', tags: [] },
    { ...inst, kind: 'institution', tags: [] }
  ])
  await db.insert(contactIdentity).values([
    { ...tech(), contactId: p1.id, firstName: 'Zdzisława', lastName: 'Qwertyuszkiewicz', email: 'zdzislawa.qw@example.org', phone: '501 777 123', address: 'ul. Fikcyjna 7', city: 'Wzorcowo', notes: 'Notatka o Zdzisławie' },
    { ...tech(), contactId: p2.id, firstName: 'Barnaba', lastName: 'Trzcinowski', phone: '501777123' },
    { ...tech(), contactId: inst.id, name: 'Fundacja Qwerty' }
  ])
  await db.insert(contactRoles).values({ ...tech(), contactId: p1.id, role: 'participant', since: '2026-01-01', until: null, note: 'Uwaga o roli Barnaba' })
  await db.insert(relationships).values({ ...tech(), contactAId: p1.id, contactBId: p2.id, type: 'other', note: 'Siostra Zdzisławy' })
  await db.insert(consents).values({ ...tech(), contactId: p1.id, type: 'processing', basis: 'Zgoda ustna od Zdzisławy', givenAt: '2026-02-02', note: 'Zgoda ustna od Zdzisławy' })

  const topic = tech()
  await db.insert(topics).values({ ...topic, name: 'Temat Qwerty', description: 'Temat Qwerty', program: 'Program Qwerty', durationHours: 4 })
  const act = tech()
  await db.insert(actions).values({ ...act, type: 'training', framework: 'project', title: 'Warsztaty u Trzcinowskich', status: 'done', startDate: '2026-03-01', endDate: '2026-03-02', place: 'Sala Barnaby', topicId: topic.id, description: 'Opis spotkania z Barnabą', expectedParticipants: 12 })
  const session = tech()
  await db.insert(actionSessions).values({ ...session, actionId: act.id, date: '2026-03-01', startTime: '10:00', endTime: '12:00', leaderContactId: p2.id, note: 'Sala Barnaby' })
  await db.insert(actionParticipants).values({ ...tech(), actionId: act.id, contactId: p1.id, status: 'confirmed', note: 'Siostra Zdzisławy' })
  await db.insert(attendance).values({ ...tech(), sessionId: session.id, contactId: p1.id, status: 'present' })

  const note = tech()
  await db.insert(activities).values({ ...note, type: 'support', channel: null, form: 'Pomoc dla Qwertyuszkiewiczów', durationMinutes: 30, occurredAt: at('2026-04-04'), content: 'Rozmowa z panią Zdzisławą', actionId: act.id })
  await db.insert(activityContacts).values({ ...tech(), activityId: note.id, contactId: p1.id })

  const task = tech()
  await db.insert(tasks).values({ ...task, title: 'Zadzwonić do Zdzisławy', description: 'Zadzwonić do Zdzisławy', dueDate: '2026-12-01', assigneeUserId: adminId, status: 'todo', priority: 'high', targetType: 'contact', targetId: p1.id })
  await db.insert(taskItems).values({ ...tech(), taskId: task.id, label: 'Kupić kwiaty dla Barnaby', done: false, position: 0 })

  await db.insert(orgKeys).values({ version: 1, createdAt: NOW, createdBy: adminId })
  await db.insert(contactSensitive).values({ ...tech(), contactId: p1.id, keyVersion: 1, iv: 'AAAAAAAAAAAAAAAA', ciphertext: 'Qwertyuszkiewicz' })
  await db.insert(changeLog).values({ id: randomUUID(), entity: 'actions', entityId: act.id, op: 'update', changedFields: { title: 'Warsztaty u Trzcinowskich' }, userId: adminId, at: at('2026-10-20') })
  await db.insert(erasedContacts).values({ contactId: randomUUID(), erasedAt: at('2026-05-05'), clearedActivityIds: [randomUUID()], clearedTaskIds: [] })
  await db.insert(settings).values({ ...tech(), orgName: 'Fundacja Qwerty', profile: 'projects', enabledModules: ['contacts'], roleLabels: { participant: 'Podopieczny Qwerty' }, retentionMonths: 24 })
  return { p1: p1.id, p2: p2.id, inst: inst.id, act: act.id }
}

async function cleanup() {
  for (const t of [erasedContacts, attendance, actionSessions, actionParticipants, taskItems, tasks, activityContacts, activities, actions, topics, relationships, consents, contactRoles, contactSensitive, contactIdentity, contacts]) await db.delete(t)
  await wipeAccounts(db)
}

beforeAll(async () => {
  ;({ db, close } = await openTestDb())
  app = buildApp(db, [], dbSessions(db, clock), { appSecret: TEST_APP_SECRET, now: clock, scryptParams: TEST_SCRYPT })
})
beforeEach(async () => {
  await cleanup()
  adminId = (await addTestUser(db, { role: 'admin', now: NOW })).id
  staffId = (await addTestUser(db, { role: 'staff', now: NOW })).id
  await db.update(users).set({ name: 'Konto testowe' }).where(eq(users.id, adminId))
})
afterAll(async () => {
  if (!db) return
  await app?.close()
  await cleanup()
  await close()
})

/** Identyfikatory i daty ISO nie są danymi osobowymi: przed szukaniem wzorców usuwamy je z tekstu. */
const withoutIdsAndDates = (s: string) => s.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '').replace(/\d{4}-\d{2}-\d{2}(T[\d:.]+Z)?/g, '')

function assertClean(text: string) {
  const lower = text.toLowerCase()
  for (const s of SECRETS) expect(lower.includes(s.toLowerCase()), `w pliku jest „${s}”`).toBe(false)
  const rest = withoutIdsAndDates(text)
  expect(rest).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.-]+/) // adres e-mail
  expect(rest).not.toMatch(/(?<!\d)(\+?48[ -]?)?\d{3}[ -]?\d{3}[ -]?\d{3}(?!\d)/) // telefon
}

describe('reguły kopii do pomocy', () => {
  it('każda tabela schematu ma regułę albo jest jawnie pominięta (nowa tabela bez reguły nie wycieknie)', () => {
    const all = schemaTableNames()
    const ruled = supportRuleTables()
    for (const t of all) expect(ruled.includes(t) || SUPPORT_SKIPPED_TABLES.includes(t), `tabela ${t} bez reguły w supportCopy.ts`).toBe(true)
    for (const t of ruled) expect(all.includes(t), `reguła dla nieistniejącej tabeli ${t}`).toBe(true)
    expect(ruled.filter((t) => SUPPORT_SKIPPED_TABLES.includes(t))).toEqual([])
  })

  it('nieznana tabela to błąd, a nieznana kolumna jest pomijana', () => {
    expect(() => sanitizeRows('nowa_tabela', [])).toThrow()
    const [row] = sanitizeRows('contacts', [{ id: 'x', kind: 'person', tags: ['a', 'b'], nowaKolumna: 'Sekret', createdAt: '2026-01-01' }])
    expect(row).toMatchObject({ id: 'x', kind: 'person', label: 'Osoba 1', tagCount: 2 })
    expect(JSON.stringify(row)).not.toContain('Sekret')
  })
})

describe('Kopia do pomocy', () => {
  it('w pliku nie ma imion, nazwisk, e-maili, telefonów ani treści; zostają struktura, daty i liczby', async () => {
    const ids = await seed()
    const copy = await buildSupportCopy(db, NOW)
    const text = JSON.stringify(copy, null, 1)
    assertClean(text)

    expect(copy).toMatchObject({ format: 'ngo-crm-support-copy', formatVersion: 1, createdAt: NOW.toISOString() })
    expect(copy.migrations).toBeGreaterThan(0)
    for (const skipped of SUPPORT_SKIPPED_TABLES) expect(copy.tables[skipped]).toBeUndefined()

    expect(copy.tables.contacts!.map((c) => c.label).sort()).toEqual(['Instytucja 1', 'Osoba 1', 'Osoba 2'])
    // identyfikatory są losowe w obrębie pliku (żadnego prawdziwego), ale spójne między tabelami
    for (const id of Object.values(ids)) expect(text.includes(id), `prawdziwy identyfikator ${id} w pliku`).toBe(false)
    const person1 = copy.tables.contacts!.find((c) => c.tagCount === 1 && c.kind === 'person')!
    expect(person1).toMatchObject({ kind: 'person' })
    expect(copy.tables.users!.map((u) => u.label)).toEqual(['Użytkownik 1', 'Użytkownik 2'])
    expect(copy.tables.actions![0]).toMatchObject({ label: 'Działanie 1', type: 'training', startDate: '2026-03-01', expectedParticipants: 12 })
    expect(copy.tables.activities![0]).toMatchObject({ type: 'support', durationMinutes: 30 })
    expect(copy.tables.tasks![0]).toMatchObject({ label: 'Zadanie 1', status: 'todo', priority: 'high', targetId: person1.id })
    expect(copy.tables.attendance![0]).toMatchObject({ status: 'present' })
    expect(copy.tables.change_log![0]).toMatchObject({ entity: 'actions', op: 'update', changedFieldCount: 1 })
    expect(copy.counts.contacts).toBe(3)
    expect(copy.counts.users).toBe(2)
    expect(copy.tables.settings![0]).toMatchObject({ retentionMonths: 24, profile: 'projects' })
  })

  it('numeracja idzie w kolejności utworzenia (obiekty Date), a enabledModules przepuszcza tylko znane moduły', () => {
    const rows = sanitizeRows('topics', [
      { id: 'b', createdAt: new Date('2026-02-01T10:00:00Z'), name: 'Drugi' },
      { id: 'a', createdAt: new Date('2025-12-01T10:00:00Z'), name: 'Pierwszy' }
    ])
    expect(rows.map((r) => [r.id, r.label])).toEqual([['a', 'Temat 1'], ['b', 'Temat 2']])
    const [st] = sanitizeRows('settings', [{ id: 's', enabledModules: ['contacts', 'Zdzisława Qwertyuszkiewicz'], profile: 'custom' }])
    expect(st!.enabledModules).toEqual(['contacts'])
  })

  it('change_log: tylko ostatnie 90 dni, same liczby pól', async () => {
    await seed()
    await db.insert(changeLog).values({ id: randomUUID(), entity: 'contacts', entityId: randomUUID(), op: 'update', changedFields: { tags: ['x'] }, userId: adminId, at: new Date(NOW.getTime() - 120 * 86_400_000) })
    const copy = await buildSupportCopy(db, NOW)
    expect(copy.tables.change_log).toHaveLength(1)
    expect(copy.tables.change_log![0]).toMatchObject({ entity: 'actions' })
  })

  it('użytkownik: bez e-maila, hasła, skrótu, sekretu 2FA i kluczy', async () => {
    const copy = await buildSupportCopy(db, NOW)
    const u = copy.tables.users![0]!
    expect(Object.keys(u).sort()).toEqual(['createdAt', 'deletedAt', 'hasKeys', 'id', 'label', 'lastLoginAt', 'role', 'status', 'totpEnabled', 'updatedAt', 'updatedBy', 'version'].sort())
  })
})

describe('GET /api/support-copy', () => {
  const get = async (cookie?: string) => app.inject({ method: 'GET', url: '/api/support-copy', headers: { ...headers, ...(cookie ? { cookie } : {}) } })

  it('administrator pobiera jawny plik JSON bez danych osobowych; wpis w dzienniku; pracownik 403, brak sesji 401', async () => {
    await seed()
    const adminCookie = await sessionCookieFor(db, adminId, NOW)
    const res = await get(adminCookie)
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toMatch(/^application\/json/)
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="ngo-crm-do-pomocy-\d{4}-\d{2}-\d{2}\.json"$/)
    expect(res.headers['cache-control']).toBe('no-store')
    assertClean(res.body)
    expect(JSON.parse(res.body).format).toBe('ngo-crm-support-copy')

    const log = await db.select().from(accessLog).where(eq(accessLog.action, 'support_copy'))
    expect(log).toHaveLength(1)
    expect(log[0]!.userId).toBe(adminId)

    expect((await get(await sessionCookieFor(db, staffId, NOW))).statusCode).toBe(403)
    expect((await get()).statusCode).toBe(401)
    expect(await db.select().from(accessLog).where(eq(accessLog.action, 'support_copy'))).toHaveLength(1)
  })
})
