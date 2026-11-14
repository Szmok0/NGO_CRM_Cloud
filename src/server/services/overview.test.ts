// „Dziś”, kalendarz, Kosz i ustawienia organizacji na lokalnej bazie testowej (TEST_DATABASE_URL). Dane fikcyjne.
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq, inArray, like } from 'drizzle-orm'
import type { Db } from '../db/connection'
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
} from '../db/schema'
import { SETTINGS_ID } from '../auth/setup'
import { openTestDb } from '../testDb'
import * as acts from './actions'
import { today, type Actor } from './common'
import * as people from './contacts'
import * as svc from './overview'
import { getSettings, updateSettings } from './settings'
import * as todo from './tasks'

let db: Db
let close: () => Promise<void>
let ownSettings = false
const ME: string = randomUUID()
const NOW = new Date('2026-11-15T10:00:00.000Z')
const actor: Actor = { userId: ME, now: NOW }
const earlier = (iso: string): Actor => ({ userId: ME, now: new Date(iso) })

async function cleanup() {
  await db.delete(taskItems)
  await db.delete(tasks)
  await db.delete(attendance)
  await db.delete(actionSessions)
  await db.delete(actionParticipants)
  await db.delete(activityContacts)
  await db.delete(activities)
  await db.delete(actions)
  await db.delete(topics)
  await db.delete(consents)
  await db.delete(relationships)
  await db.delete(contactRoles)
  await db.delete(contactIdentity)
  await db.delete(contacts)
  await db.delete(changeLog).where(eq(changeLog.userId, ME))
}

beforeAll(async () => {
  ;({ db, close } = await openTestDb())
  const now = new Date()
  await db.insert(users).values({ id: ME, createdAt: now, updatedAt: now, updatedBy: ME, version: 1, email: `${ME}@dzis.test`, name: 'Daria Dzisiejsza', role: 'admin', status: 'active' })
  const [s] = await db.select().from(settings)
  if (!s) {
    ownSettings = true
    await db.insert(settings).values({
      id: SETTINGS_ID,
      createdAt: now,
      updatedAt: now,
      updatedBy: ME,
      version: 1,
      orgName: 'Stowarzyszenie testowe',
      profile: 'projects',
      enabledModules: ['contacts', 'actions', 'tasks'],
      roleLabels: {}
    })
  }
})
beforeEach(cleanup)
afterAll(async () => {
  if (!db) return
  await cleanup()
  if (ownSettings) await db.delete(settings).where(eq(settings.id, SETTINGS_ID))
  await db.delete(changeLog).where(inArray(changeLog.entity, ['settings']))
  await db.delete(users).where(like(users.email, '%@dzis.test'))
  await close()
})

const person = async (firstName: string, lastName: string, who: Actor = actor) =>
  (await people.createContact(db, { kind: 'person', firstName, lastName, name: null, email: null, phone: null, address: null, city: null, notes: null, tags: [], roles: ['participant'] }, who)).id
const action = async (title: string, extra: Partial<Parameters<typeof acts.createAction>[1]> = {}, who: Actor = actor) =>
  (
    await acts.createAction(
      db,
      { type: 'training', framework: 'project', title, status: 'planned', startDate: null, endDate: null, place: null, topicId: null, description: null, expectedParticipants: null, ...extra },
      who
    )
  ).id
const task = async (title: string, dueDate: string | null, extra: Partial<Parameters<typeof todo.createTask>[1]> = {}) =>
  (await todo.createTask(db, { title, dueDate, assigneeUserId: ME, status: 'todo', priority: 'normal', targetType: null, targetId: null, description: null, items: [], ...extra }, actor)).id

describe('„Dziś” po polsku', () => {
  it('„dziś” to data w Polsce, także gdy w UTC jest jeszcze wczoraj', () => {
    expect(today(new Date('2026-11-14T23:30:00.000Z'))).toBe('2026-11-15')
    expect(today(new Date('2026-07-14T22:30:00.000Z'))).toBe('2026-07-15')
  })
})

describe('ekran „Dziś”', () => {
  it('moje zadania: zaległe, na dziś, zrobione dziś; licznik w menu', async () => {
    await task('Zaległe', '2026-11-10')
    await task('Na dziś', '2026-11-15')
    await task('Jutro', '2026-11-16')
    const done = await task('Zrobione dziś', '2026-11-15')
    await todo.moveTask(db, { id: done, version: 1, status: 'done' }, actor)
    const d = await svc.getToday(db, { ...actor, now: new Date() })
    // `now` testu wpływa tylko na „dziś”, a zadanie odhaczono teraz — sprawdzamy na stałej dacie
    const fixed = await svc.getToday(db, actor)
    expect(fixed.tasksOverdue.map((t) => t.title)).toEqual(['Zaległe'])
    expect(fixed.tasksToday.map((t) => t.title)).toEqual(['Na dziś'])
    expect(d.tasksDoneToday.map((t) => t.title)).toEqual(['Zrobione dziś'])
    expect(await svc.taskCounter(db, actor)).toBe(2)
  })

  it('najbliższe dni i zajęcia w tygodniu; odwołane działania pomijane', async () => {
    const a = await action('Kurs komputerowy')
    await acts.addSession(db, { actionId: a, date: '2026-11-17', startTime: '17:00', endTime: null, leaderContactId: null, note: null }, actor)
    await action('Festyn', { type: 'event', startDate: '2026-11-20' })
    await action('Odwołane spotkanie', { type: 'meeting', startDate: '2026-11-18', status: 'cancelled' })
    const d = await svc.getToday(db, actor)
    expect(d.upcoming.map((e) => [e.date, e.title])).toEqual([
      ['2026-11-17', 'Kurs komputerowy'],
      ['2026-11-20', 'Festyn']
    ])
    // 15.11.2026 to niedziela: tydzień pn 9.11 – nd 15.11, więc zajęcia 17.11 są już w następnym
    expect(d.week).toEqual({ sessions: 0, next: { date: '2026-11-17', startTime: '17:00' } })
  })

  it('„Wymaga uwagi”: uczestnik bez kontaktu od ponad 30 dni; kontakt zdejmuje go z listy', async () => {
    const old = earlier('2026-10-01T10:00:00.000Z')
    const p = await person('Ewa', 'Zapomniana', old)
    const a = await action('Projekt wsparcia', {}, old)
    await acts.addParticipantById(db, { actionId: a, contactId: p }, old)
    expect((await svc.getToday(db, actor)).stale).toMatchObject([{ contact: { label: 'Ewa Zapomniana' }, actionTitle: 'Projekt wsparcia', days: 45 }])
    const { addActivity } = await import('./activities')
    await addActivity(db, { type: 'contact', channel: 'phone', form: null, durationMinutes: 10, occurredAt: '2026-11-14T09:00:00.000Z', content: 'Telefon', contactIds: [p], actionId: null }, actor)
    expect((await svc.getToday(db, actor)).stale).toEqual([])
  })

  it('„Ostatnio w organizacji”: zmiana nazwiska (tożsamość) jako zmiana danych osoby', async () => {
    const p = await person('Fryderyka', 'Stara')
    const c = (await people.getContact(db, p)).contact
    await people.updateContact(db, { ...c, id: p, version: c.version, identityVersion: c.identityVersion!, lastName: 'Nowa' }, earlier('2026-11-15T11:00:00.000Z'))
    const feed = (await svc.getToday(db, actor)).feed.filter((f) => f.userId === ME)
    expect(feed[0]).toMatchObject({ kind: 'contactUpdated', subject: 'Fryderyka Nowa', userName: 'Daria Dzisiejsza' })
  })
})

describe('kalendarz', () => {
  it('zajęcia, działanie bez zajęć, koniec zbiórki i termin zadania; bez usuniętych', async () => {
    const a = await action('Warsztaty', { type: 'workshop' })
    await acts.addSession(db, { actionId: a, date: '2026-11-21', startTime: '10:00', endTime: '12:00', leaderContactId: null, note: null }, actor)
    await action('Zbiórka na schronisko', { type: 'fundraiser', startDate: '2026-11-01', endDate: '2026-11-30' })
    const gone = await action('Usunięte', { type: 'meeting', startDate: '2026-11-25' })
    await acts.deleteAction(db, { id: gone, version: 1 }, actor)
    await task('Wysłać zaproszenia', '2026-11-19')
    const cal = await svc.calendarEntries(db, '2026-11-01', '2026-11-30', NOW)
    expect(cal.entries.map((e) => [e.date, e.kind, e.title])).toEqual(
      expect.arrayContaining([
        ['2026-11-21', 'session', 'Warsztaty'],
        ['2026-11-30', 'fundraiserEnd', 'Zbiórka na schronisko'],
        ['2026-11-19', 'task', 'Wysłać zaproszenia']
      ])
    )
    expect(cal.entries.some((e) => e.title === 'Usunięte')).toBe(false)
  })
})

describe('Kosz', () => {
  it('lista usuniętych i przywracanie z wersją', async () => {
    const p = await person('Gabriela', 'Koszowa')
    const a = await action('Działanie do kosza')
    const t = await task('Zadanie do kosza', null)
    const { id: topicId } = await acts.createTopic(db, { name: 'Temat do kosza', description: null, program: null, durationHours: null }, actor)
    await people.deleteContact(db, { id: p, version: 1 }, actor)
    await acts.deleteAction(db, { id: a, version: 1 }, actor)
    await todo.deleteTask(db, { id: t, version: 1 }, actor)
    await acts.deleteTopic(db, { id: topicId, version: 1 }, actor)
    const trash = await svc.listTrash(db)
    expect(trash.map((i) => [i.entity, i.label, i.deletedBy]).sort()).toEqual([
      ['actions', 'Działanie do kosza', 'Daria Dzisiejsza'],
      ['contacts', 'Gabriela Koszowa', 'Daria Dzisiejsza'],
      ['tasks', 'Zadanie do kosza', 'Daria Dzisiejsza'],
      ['topics', 'Temat do kosza', 'Daria Dzisiejsza']
    ])
    const item = trash.find((i) => i.entity === 'contacts')!
    await expect(svc.restoreFromTrash(db, { entity: 'contacts', id: item.id, version: item.version - 1 }, actor)).rejects.toMatchObject({ code: 'VERSION_CONFLICT' })
    await svc.restoreFromTrash(db, { entity: 'contacts', id: item.id, version: item.version }, actor)
    expect((await people.listContacts(db, { kind: 'all' }, NOW)).map((c) => c.label)).toEqual(['Gabriela Koszowa'])
    expect((await svc.listTrash(db)).map((i) => i.entity).sort()).toEqual(['actions', 'tasks', 'topics'])
  })
})

describe('ustawienia organizacji', () => {
  it('zapis: moduły znormalizowane, puste nazwy ról pomijane, stara wersja → konflikt', async () => {
    const s = await getSettings(db)
    await updateSettings(
      db,
      { version: s.version, orgName: s.orgName, profile: s.profile, enabledModules: ['actions', 'nieistniejący'], roleLabels: { participant: 'podopieczny', donor: '' }, staleDays: 14 },
      actor
    )
    const after = await getSettings(db)
    expect(after).toMatchObject({ enabledModules: ['contacts', 'actions', 'calendar', 'knowledge'], roleLabels: { participant: 'podopieczny' }, staleDays: 14 })
    await expect(updateSettings(db, { ...s, version: s.version, roleLabels: {} }, actor)).rejects.toMatchObject({ code: 'VERSION_CONFLICT' })
    // przywrócenie stanu sprzed testu (inne pliki testów korzystają z tego wiersza)
    await updateSettings(db, { version: after.version, orgName: s.orgName, profile: s.profile, enabledModules: s.enabledModules, roleLabels: s.roleLabels, staleDays: s.staleDays }, actor)
  })
})
