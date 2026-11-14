// Tematy, działania, uczestnicy, zajęcia i obecność na lokalnej bazie testowej (TEST_DATABASE_URL). Dane fikcyjne.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { inArray } from 'drizzle-orm'
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
  topics
} from '../db/schema'
import { openTestDb } from '../testDb'
import * as svc from './actions'
import * as people from './contacts'
import type { Actor } from './common'

let db: Db
let close: () => Promise<void>
const actor: Actor = { userId: '00000000-0000-4000-8000-0000000000c2', now: new Date('2026-11-15T10:00:00.000Z') }
const ENTITIES = ['contacts', 'contact_identity', 'contact_roles', 'activities', 'activity_contacts', 'topics', 'actions', 'action_sessions', 'action_participants', 'attendance']

async function cleanup() {
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
  await db.delete(changeLog).where(inArray(changeLog.entity, ENTITIES))
}

beforeAll(async () => {
  ;({ db, close } = await openTestDb())
})
beforeEach(cleanup)
afterAll(async () => {
  if (!db) return
  await cleanup()
  await close()
})

const person = async (firstName: string, lastName: string, email: string | null = null) =>
  (
    await people.createContact(
      db,
      { kind: 'person', firstName, lastName, name: null, email, phone: null, address: null, city: null, notes: null, tags: [], roles: [] },
      actor
    )
  ).id
const base = { framework: 'project' as const, status: 'planned' as const, startDate: '2026-11-01', endDate: null, place: 'Sala testowa', topicId: null, description: null, expectedParticipants: null }
const newAction = async (title: string, extra: Partial<Parameters<typeof svc.createAction>[1]> = {}) =>
  (await svc.createAction(db, { type: 'training', title, ...base, ...extra }, actor)).id
const detail = (id: string) => svc.getActionDetail(db, id, actor.now)

describe('tematy i działania', () => {
  it('temat zostaje tylko przy szkoleniu; karta tematu pokazuje jego działania', async () => {
    const { id: topicId } = await svc.createTopic(db, { name: 'Pierwsza pomoc', description: null, program: null, durationHours: 8 }, actor)
    const training = await newAction('Kurs pierwszej pomocy', { topicId })
    const event = await newAction('Festyn', { type: 'event', topicId })
    expect((await detail(training)).topic).toMatchObject({ name: 'Pierwsza pomoc' })
    expect((await detail(event)).action.topicId).toBeNull()
    expect((await svc.getTopic(db, topicId)).actions.map((a) => a.title)).toEqual(['Kurs pierwszej pomocy'])
  })

  it('zmiana statusu dopisuje wpis systemowy na osi działania; stara wersja → konflikt', async () => {
    const id = await newAction('Warsztaty rękodzieła', { type: 'workshop' })
    const a = (await detail(id)).action
    await svc.updateAction(db, { ...a, id, version: a.version, status: 'ongoing' }, actor)
    const d = await detail(id)
    expect(d.activities.map((x) => JSON.parse(x.content))).toEqual([{ event: 'action_status', from: 'planned', to: 'ongoing' }])
    expect(d.activities[0]!.actionTitle).toBe('Warsztaty rękodzieła')
    await expect(svc.updateAction(db, { ...a, id, version: a.version, title: 'Inny' }, actor)).rejects.toMatchObject({ code: 'VERSION_CONFLICT' })
  })

  it('lista: filtry typu, statusu, okresu i tekstu; bez usuniętych; wyszukiwarka globalna', async () => {
    await newAction('Spotkanie zarządu', { type: 'meeting', startDate: '2026-10-05' })
    const b = await newAction('Szkolenie RODO', { startDate: '2026-12-01' })
    expect((await svc.listActions(db, { type: 'meeting' })).map((x) => x.title)).toEqual(['Spotkanie zarządu'])
    expect((await svc.listActions(db, { from: '2026-11-15' })).map((x) => x.title)).toEqual(['Szkolenie RODO'])
    expect((await svc.listActions(db, { q: 'rodo' })).map((x) => x.id)).toEqual([b])
    expect(await people.searchGlobal(db, 'zarządu')).toMatchObject([{ type: 'action', label: 'Spotkanie zarządu' }])
    await svc.deleteAction(db, { id: b, version: 1 }, actor)
    expect((await svc.listActions(db, {})).map((x) => x.title)).toEqual(['Spotkanie zarządu'])
  })
})

describe('uczestnicy', () => {
  it('ta sama osoba dodana dwa razy: jeden uczestnik; po usunięciu wraca ten sam wiersz', async () => {
    const id = await newAction('Kurs')
    const p = await person('Anna', 'Uczestniczka')
    await svc.addParticipantById(db, { actionId: id, contactId: p }, actor)
    await svc.addParticipantById(db, { actionId: id, contactId: p }, actor)
    let d = await detail(id)
    expect(d.participants).toHaveLength(1)
    const part = d.participants[0]!
    await svc.removeParticipant(db, { id: part.id, version: part.version }, actor)
    expect((await detail(id)).participants).toEqual([])
    await svc.addParticipantById(db, { actionId: id, contactId: p }, actor)
    d = await detail(id)
    expect(d.participants).toMatchObject([{ id: part.id, status: 'registered' }])
    expect(await db.select().from(actionParticipants)).toHaveLength(1)
    // karta osoby: udział w działaniu i wpis systemowy
    const card = await people.getContact(db, p)
    expect(card.participations).toMatchObject([{ action: { title: 'Kurs' }, status: 'registered' }])
    expect(card.activities.some((x) => x.content.includes('participant_added'))).toBe(true)
  })

  it('wklejona lista: dopasowanie po tożsamości, nowe osoby z rolą uczestnika', async () => {
    const id = await newAction('Kurs z listy')
    const known = await person('Barbara', 'Znana', 'b@example.org')
    const preview = await svc.previewPaste(db, { actionId: id, text: 'barbara znana\nCelina Nowa; c@example.org\nSamo' })
    expect(preview.map((r) => [r.firstName, r.suggestedContactId, r.error])).toEqual([
      ['barbara', known, null],
      ['Celina', null, null],
      ['Samo', null, 'NAME_INCOMPLETE']
    ])
    // e-mail sprzeczny z bazą: brak pewnego dopasowania
    expect((await svc.previewPaste(db, { actionId: id, text: 'Barbara Znana; inny@example.org' }))[0]!.suggestedContactId).toBeNull()

    const res = await svc.applyPaste(
      db,
      {
        actionId: id,
        rows: [
          { firstName: 'Barbara', lastName: 'Znana', email: null, phone: null, contactId: known },
          { firstName: 'Celina', lastName: 'Nowa', email: 'c@example.org', phone: null, contactId: null }
        ]
      },
      actor
    )
    expect(res).toEqual({ added: 2, created: 1 })
    const d = await detail(id)
    expect(d.participants.map((x) => x.contact.label).sort()).toEqual(['Barbara Znana', 'Celina Nowa'])
    const celina = d.participants.find((x) => x.contact.label === 'Celina Nowa')!
    const card = await people.getContact(db, celina.contactId)
    expect(card).toMatchObject({ contact: { email: 'c@example.org' }, roles: [{ role: 'participant' }] })
  })
})

describe('zajęcia i obecność', () => {
  it('frekwencja liczona względem zajęć, które się odbyły', async () => {
    const id = await newAction('Kurs z obecnością')
    const a = await person('Ewa', 'Obecna')
    const b = await person('Feliks', 'Nieobecny')
    for (const c of [a, b]) await svc.addParticipantById(db, { actionId: id, contactId: c }, actor)
    for (const date of ['2026-11-02', '2026-11-09', '2026-12-07']) await svc.addSession(db, { actionId: id, date, startTime: '17:00', endTime: null, leaderContactId: null, note: null }, actor)
    const [s1, s2] = (await detail(id)).sessions
    await svc.setAttendance(db, { sessionId: s1!.id, contactId: a, status: 'present', version: null }, actor)
    await svc.setAttendance(db, { sessionId: s2!.id, contactId: a, status: 'present', version: null }, actor)
    await svc.setAttendance(db, { sessionId: s1!.id, contactId: b, status: 'absent', version: null }, actor)
    const d = await detail(id)
    expect(d.heldCount).toBe(2)
    expect(Object.fromEntries(d.participants.map((p) => [p.contact.label, p.attendancePct]))).toEqual({ 'Ewa Obecna': 100, 'Feliks Nieobecny': 0 })
    expect(d.sessions.map((s) => s.presentCount)).toEqual([2 - 1, 1, 0])
  })

  it('obecność: druga zmiana ze starym stanem → konflikt; wyczyszczenie i ponowne zaznaczenie bez duplikatu', async () => {
    const id = await newAction('Kurs')
    const p = await person('Gosia', 'Klikająca')
    await svc.addParticipantById(db, { actionId: id, contactId: p }, actor)
    await svc.addSession(db, { actionId: id, date: '2026-11-03', startTime: null, endTime: null, leaderContactId: null, note: null }, actor)
    const sessionId = (await detail(id)).sessions[0]!.id
    await svc.setAttendance(db, { sessionId, contactId: p, status: 'present', version: null }, actor)
    // druga osoba widziała pustą kratkę
    await expect(svc.setAttendance(db, { sessionId, contactId: p, status: 'absent', version: null }, actor)).rejects.toMatchObject({ code: 'VERSION_CONFLICT' })
    const mark = (await detail(id)).attendance[0]!
    await svc.setAttendance(db, { sessionId, contactId: p, status: 'excused', version: mark.version }, actor)
    const m2 = (await detail(id)).attendance[0]!
    expect(m2.status).toBe('excused')
    await svc.setAttendance(db, { sessionId, contactId: p, status: null, version: m2.version }, actor)
    expect((await detail(id)).attendance).toEqual([])
    await svc.setAttendance(db, { sessionId, contactId: p, status: 'present', version: null }, actor)
    expect((await detail(id)).attendance).toMatchObject([{ status: 'present' }])
    expect(await db.select().from(attendance)).toHaveLength(1)
  })

  it('wpis na osi działania bez osób', async () => {
    const { addActivity } = await import('./activities')
    const id = await newAction('Kurs z notatką')
    await addActivity(db, { type: 'note', channel: null, form: null, durationMinutes: null, occurredAt: '2026-11-14T09:00:00.000Z', content: 'Sala zarezerwowana', contactIds: [], actionId: id }, actor)
    expect((await detail(id)).activities).toMatchObject([{ type: 'note', content: 'Sala zarezerwowana', actionTitle: 'Kurs z notatką', contacts: [] }])
  })
})
