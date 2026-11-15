// Scenariusz akceptacji ZADANIA_02 przez API (POST /api/rpc) z prawdziwymi sesjami z bazy, na lokalnej bazie testowej.
// Wzór: desktopowe src/main/services/acceptance.test.ts (kroki dotyczące bazy, kopii i haseł są w ZADANIU_01 / ZADANIU_04).
// Dane fikcyjne.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from './app'
import { SETTINGS_ID } from './auth/setup'
import { dbSessions, SESSION_COOKIE } from './auth/sessions'
import { TEST_APP_SECRET, TEST_SCRYPT, addTestUser, sessionCookieFor, wipeAccounts } from './auth/testkit'
import type { Db } from './db/connection'
import {
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
  contacts,
  relationships,
  settings,
  taskItems,
  tasks,
  topics,
  users
} from './db/schema'
import { addParticipantById } from './services/actions'
import { createContact } from './services/contacts'
import { today } from './services/common'
import { openTestDb } from './testDb'
import { eq } from 'drizzle-orm'

const HOST = 'crm.example.org'
const headers = { host: HOST, 'x-forwarded-proto': 'https', origin: `https://${HOST}`, 'x-ngo-crm': '1' }
const DAY = 86_400_000
const day = (offset: number) => today(new Date(Date.now() + offset * DAY))

let db: Db
let close: () => Promise<void>
let app: ReturnType<typeof buildApp>
const who = { admin: '', staff: '', readonly: '' }
const cookie = { admin: '', staff: '', readonly: '' }

async function wipeDomain() {
  for (const t of [taskItems, tasks, attendance, actionSessions, actionParticipants, activityContacts, activities, actions, topics, consents, relationships, contactRoles, contactIdentity, contacts])
    await db.delete(t)
}

beforeAll(async () => {
  ;({ db, close } = await openTestDb())
  await wipeDomain()
  await wipeAccounts(db)
  app = buildApp(db, [], dbSessions(db), { appSecret: TEST_APP_SECRET, scryptParams: TEST_SCRYPT })
  for (const role of ['admin', 'staff', 'readonly'] as const) {
    const u = await addTestUser(db, { role })
    who[role] = u.id
    cookie[role] = await sessionCookieFor(db, u.id)
  }
  await db.update(users).set({ name: 'Ala Pracownica' }).where(eq(users.id, who.staff))
  const now = new Date()
  await db.insert(settings).values({
    id: SETTINGS_ID,
    createdAt: now,
    updatedAt: now,
    updatedBy: who.admin,
    version: 1,
    orgName: 'Stowarzyszenie Testowe',
    profile: 'projects',
    enabledModules: ['contacts', 'actions', 'tasks', 'calendar'],
    roleLabels: {}
  })
})

afterAll(async () => {
  await app?.close()
  if (!db) return
  await wipeDomain()
  await wipeAccounts(db)
  await close()
})

type Role = keyof typeof cookie
async function rpc<T = any>(role: Role, method: string, params?: unknown): Promise<{ status: number; code?: string; data: T }> {
  const res = await app.inject({ method: 'POST', url: '/api/rpc', headers: { ...headers, cookie: cookie[role] }, payload: { method, params } })
  const body = res.json() as { ok: boolean; code?: string; data: T }
  return { status: res.statusCode, code: body.code, data: body.data }
}
/** Wywołanie, które ma się udać; zwraca dane. */
async function ok<T = any>(role: Role, method: string, params?: unknown): Promise<T> {
  const r = await rpc<T>(role, method, params)
  expect(r, `${method}: ${r.code ?? ''}`).toMatchObject({ status: 200 })
  return r.data
}
const person = (firstName: string, lastName: string, extra: Record<string, unknown> = {}) =>
  ok<{ id: string }>('staff', 'contacts.create', { kind: 'person', firstName, lastName, tags: [], roles: [], ...extra })

describe('scenariusz akceptacji ZADANIA_02 (przez API)', () => {
  let annaId = ''
  let trainingId = ''

  it('2–4: osoba z rolami i zgodą, duplikat, instytucja z powiązaniem; tożsamość tylko w contact_identity; konflikt wersji', async () => {
    annaId = (await person('Anna', 'Próbna', { email: 'anna@example.org', roles: ['participant', 'volunteer'] })).id
    await ok('staff', 'consents.add', { contactId: annaId, type: 'image', givenAt: day(0) })
    expect((await ok<any[]>('staff', 'contacts.duplicates', { firstName: 'anna', lastName: 'PRÓBNA' })).map((d) => d.id)).toEqual([annaId])
    const inst = (await ok<{ id: string }>('staff', 'contacts.create', { kind: 'institution', name: 'Szkoła Testowa', tags: [], roles: [] })).id
    await ok('staff', 'relationships.add', { contactAId: annaId, contactBId: inst, type: 'contact_person' })
    expect((await ok<any>('readonly', 'contacts.get', { id: inst })).relationships[0]).toMatchObject({ isA: false, other: { id: annaId } })
    expect((await ok<any[]>('readonly', 'search.global', { q: 'Próbna' })).map((h) => h.id)).toContain(annaId)

    // kryterium 4: druga zmiana ze starą wersją dostaje konflikt, dane pierwszej zostają
    const c = (await ok<any>('staff', 'contacts.get', { id: annaId })).contact
    const edit = { id: annaId, version: c.version, identityVersion: c.identityVersion, firstName: 'Anna', lastName: 'Próbna', email: c.email, tags: [] }
    await ok('staff', 'contacts.update', { ...edit, city: 'Mosina' })
    expect(await rpc('admin', 'contacts.update', { ...edit, city: 'Poznań' })).toMatchObject({ status: 409, code: 'VERSION_CONFLICT' })
    expect((await ok<any>('readonly', 'contacts.get', { id: annaId })).contact.city).toBe('Mosina')
  })

  it('6: szkolenie z tematem i trzema zajęciami, wklejona lista 6 osób (2 z bazy), obecność, frekwencja, wpis o statusie', async () => {
    await person('Bogdan', 'Wzorcowy')
    const { id: topicId } = await ok<{ id: string }>('staff', 'topics.create', { name: 'Pierwsza pomoc', durationHours: 8 })
    trainingId = (
      await ok<{ id: string }>('staff', 'actions.create', { title: 'Szkolenie testowe', type: 'training', framework: 'statutory_free', status: 'planned', startDate: day(-10), endDate: day(10), topicId })
    ).id
    for (const d of [-7, -1, 5]) await ok('staff', 'sessions.add', { actionId: trainingId, date: day(d), startTime: '10:00', endTime: '12:00' })

    const text = ['Anna Próbna', 'bogdan wzorcowy', 'Celina Nowa; celina@example.org', 'Dawid Nowy', 'Ewa Nowa; 500 000 001', 'Filip Nowy'].join('\n')
    const preview = await ok<any[]>('staff', 'participants.previewPaste', { actionId: trainingId, text })
    expect(preview.filter((r) => r.suggestedContactId)).toHaveLength(2)
    const res = await ok('staff', 'participants.applyPaste', {
      actionId: trainingId,
      rows: preview.map((r) => ({ firstName: r.firstName, lastName: r.lastName, email: r.email, phone: r.phone, contactId: r.suggestedContactId }))
    })
    expect(res).toEqual({ added: 6, created: 4 })
    const newbie = (await ok<any[]>('readonly', 'contacts.list', { kind: 'person', q: 'Celina Nowa' }))[0]
    expect(newbie.roles).toEqual(['participant'])

    const detail = await ok<any>('readonly', 'actions.get', { id: trainingId })
    expect(detail.topic.name).toBe('Pierwsza pomoc')
    const [s1, s2] = detail.sessions
    const mark = async (sessionId: string, contactId: string, status: string) => {
      const current = (await ok<any>('readonly', 'actions.get', { id: trainingId })).attendance.find((m: any) => m.sessionId === sessionId && m.contactId === contactId)
      await ok('staff', 'attendance.set', { sessionId, contactId, status, version: current?.version ?? null })
    }
    await mark(s1.id, annaId, 'present')
    await mark(s2.id, annaId, 'absent')
    await mark(s2.id, annaId, 'present')
    await mark(s1.id, newbie.id, 'present')
    const after = await ok<any>('readonly', 'actions.get', { id: trainingId })
    expect(after.heldCount).toBe(2)
    expect(after.participants.find((p: any) => p.contactId === annaId).attendancePct).toBe(100)
    expect(after.participants.find((p: any) => p.contactId === newbie.id).attendancePct).toBe(50)
    expect(after.sessions.map((s: any) => s.presentCount)).toEqual([2, 1, 0])

    await ok('staff', 'actions.update', { ...after.action, status: 'ongoing' })
    expect((await ok<any>('readonly', 'actions.get', { id: trainingId })).activities.some((a: any) => a.content.includes('action_status'))).toBe(true)
    expect((await ok<any[]>('readonly', 'contacts.get', { id: annaId }).then((d: any) => d.participations)).length).toBe(1)
  })

  it('5: notatka i wsparcie 60 min na osi osoby, z autorem', async () => {
    const now = new Date().toISOString()
    await ok('staff', 'activities.add', { type: 'note', content: 'Notatka testowa', occurredAt: now, contactIds: [annaId] })
    await ok('staff', 'activities.add', { type: 'support', content: 'Konsultacja', occurredAt: now, contactIds: [annaId], form: 'konsultacja', durationMinutes: 60 })
    const acts = (await ok<any>('readonly', 'contacts.get', { id: annaId })).activities
    expect(acts.find((a: any) => a.type === 'support')).toMatchObject({ durationMinutes: 60, authorName: 'Ala Pracownica', form: 'konsultacja' })
  })

  it('7, 8: zadanie zaległe na „Dziś” i w liczniku; przesunięcie w kanbanie zapisuje change_log; odhaczenie i cofnięcie', async () => {
    const { id } = await ok<{ id: string }>('staff', 'tasks.create', {
      title: 'Zadanie zaległe',
      dueDate: day(-1),
      assigneeUserId: who.staff,
      status: 'todo',
      priority: 'normal',
      targetType: 'action',
      targetId: trainingId,
      items: ['a', 'b', 'c']
    })
    const t = await ok<any>('staff', 'today.get')
    expect(t.tasksOverdue.map((x: any) => x.title)).toEqual(['Zadanie zaległe'])
    expect(t.tasksOverdue[0]).toMatchObject({ itemsTotal: 3, targetLabel: 'Szkolenie testowe' })
    expect(await ok('staff', 'today.counter')).toBe(1)
    expect(await ok('admin', 'today.counter')).toBe(0)

    await ok('staff', 'tasks.move', { id, version: 1, status: 'doing' })
    await ok('staff', 'tasks.move', { id, version: 2, status: 'done' })
    expect(await ok('staff', 'today.counter')).toBe(0)
    expect((await ok<any>('staff', 'today.get')).tasksDoneToday.map((x: any) => x.title)).toEqual(['Zadanie zaległe'])
    await ok('staff', 'tasks.move', { id, version: 3, status: 'doing' })
    expect(await ok('staff', 'today.counter')).toBe(1)
    const log = await db.select().from(changeLog).where(eq(changeLog.entityId, id))
    expect(log.filter((e) => e.op === 'update').map((e) => e.changedFields)).toEqual(expect.arrayContaining([{ status: 'doing' }, { status: 'done' }]))
    expect((await ok<any>('readonly', 'actions.get', { id: trainingId })).tasks).toHaveLength(1)
  })

  it('3 (Dziś): uczestnik bez kontaktu od ponad 30 dni wymaga uwagi; po wpisie kontaktu znika', async () => {
    // zapis w przeszłości tylko przez usługi (API zawsze używa bieżącej daty)
    const past = { userId: who.staff, now: new Date(Date.now() - 40 * DAY) }
    const { id: old } = await createContact(
      db,
      { kind: 'person', firstName: 'Zenon', lastName: 'Dawny', name: null, email: null, phone: null, address: null, city: null, notes: null, tags: [], roles: ['participant'] },
      past
    )
    await addParticipantById(db, { actionId: trainingId, contactId: old }, past)
    expect((await ok<any>('staff', 'today.get')).stale.map((s: any) => s.contact.id)).toEqual([old])
    await ok('staff', 'activities.add', { type: 'contact', content: 'Telefon', occurredAt: new Date().toISOString(), contactIds: [old], channel: 'phone', durationMinutes: 5 })
    expect((await ok<any>('staff', 'today.get')).stale).toEqual([])
  })

  it('5 (kalendarz): zajęcia i termin zadania w kalendarzu', async () => {
    const cal = await ok<any>('readonly', 'calendar.entries', { from: day(-10), to: day(10) })
    expect(cal.entries.filter((e: any) => e.kind === 'session')).toHaveLength(3)
    expect(cal.entries.some((e: any) => e.kind === 'task' && e.title === 'Zadanie zaległe')).toBe(true)
  })

  it('10: usunięcie osoby → Kosz z autorem, „usunięta” w działaniu, przywrócenie', async () => {
    const c = (await ok<any>('staff', 'contacts.get', { id: annaId })).contact
    await ok('staff', 'contacts.delete', { id: annaId, version: c.version })
    expect((await ok<any[]>('readonly', 'contacts.list', {})).some((x) => x.id === annaId)).toBe(false)
    expect((await ok<any>('readonly', 'actions.get', { id: trainingId })).participants.find((p: any) => p.contactId === annaId).contact.deleted).toBe(true)
    const trash = await ok<any[]>('readonly', 'trash.list')
    expect(trash[0]).toMatchObject({ entity: 'contacts', id: annaId, deletedBy: 'Ala Pracownica' })
    await ok('staff', 'trash.restore', { entity: 'contacts', id: annaId, version: trash[0].version })
    expect((await ok<any[]>('readonly', 'contacts.list', {})).some((x) => x.id === annaId)).toBe(true)
    expect(await ok('readonly', 'trash.list')).toEqual([])
  })

  it('11: „tylko odczyt” widzi wszystko, nie zapisze niczego; pracownik nie zmieni ustawień organizacji', async () => {
    for (const m of ['contacts.list', 'actions.list', 'tasks.list', 'today.get', 'trash.list', 'topics.list', 'users.options']) await ok('readonly', m, {})
    const denied: [string, unknown][] = [
      ['contacts.create', { kind: 'person', firstName: 'X', lastName: 'Y' }],
      ['activities.add', { type: 'note', content: 'x', occurredAt: new Date().toISOString(), contactIds: [annaId] }],
      ['tasks.move', { id: annaId, version: 1, status: 'done' }],
      ['attendance.set', { sessionId: annaId, contactId: annaId, status: 'present', version: null }]
    ]
    for (const [m, p] of denied) expect(await rpc('readonly', m, p), m).toMatchObject({ status: 403, code: 'FORBIDDEN' })
    const s = await ok<any>('staff', 'settings.get')
    expect(await rpc('staff', 'settings.update', { ...s, enabledModules: s.enabledModules })).toMatchObject({ status: 403 })
  })

  it('12: wyłączenie modułu zadań ukrywa je na „Dziś” i w liczniku, włączenie przywraca; własna nazwa roli', async () => {
    const s = await ok<any>('admin', 'settings.get')
    const save = (patch: Record<string, unknown>, version: number) =>
      ok('admin', 'settings.update', { version, orgName: s.orgName, profile: s.profile, enabledModules: s.enabledModules, roleLabels: s.roleLabels, staleDays: s.staleDays, ...patch })
    await save({ enabledModules: ['contacts', 'actions'] }, s.version)
    expect((await ok<any>('staff', 'today.get')).tasksOverdue).toHaveLength(0)
    expect(await ok('staff', 'today.counter')).toBe(0)
    await save({ enabledModules: ['contacts', 'actions', 'tasks'], roleLabels: { participant: 'podopieczny' } }, s.version + 1)
    expect(await ok('staff', 'today.counter')).toBe(1)
    expect((await ok<any>('readonly', 'settings.get')).roleLabels).toEqual({ participant: 'podopieczny' })
  })

  it('kryterium 3: w change_log ani w tabelach bez tożsamości nie ma imion i nazwisk', async () => {
    const names = /Anna|Próbna|Bogdan|Wzorcowy|Celina|Zenon|Dawny/
    const log = await db.select().from(changeLog)
    expect(log.length).toBeGreaterThan(0)
    expect(JSON.stringify(log.filter((e) => e.entity !== 'tasks' && e.entity !== 'actions' && e.entity !== 'topics' && e.entity !== 'activities'))).not.toMatch(names)
    expect(log.filter((e) => e.entity === 'contact_identity').every((e) => Object.values(e.changedFields as object).every((v) => v === true))).toBe(true)
    for (const t of [contacts, contactRoles, actionParticipants, attendance, tasks]) expect(JSON.stringify(await db.select().from(t))).not.toMatch(names)
    const entities = new Set(log.map((e) => e.entity))
    for (const e of ['contacts', 'contact_identity', 'contact_roles', 'consents', 'relationships', 'settings', 'topics', 'actions', 'action_sessions', 'action_participants', 'attendance', 'activities', 'activity_contacts', 'tasks', 'task_items'])
      expect(entities, e).toContain(e)
  })

  it('wylogowana sesja nie ma dostępu', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/rpc', headers: { ...headers, cookie: `${SESSION_COOKIE}=nieznany-token` }, payload: { method: 'contacts.list' } })
    expect(res.statusCode).toBe(401)
  })
})
