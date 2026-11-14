// Osoby i instytucje na lokalnej bazie testowej (TEST_DATABASE_URL). Dane fikcyjne.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { inArray, sql } from 'drizzle-orm'
import type { Db } from '../db/connection'
import { activities, activityContacts, changeLog, consents, contactIdentity, contactRoles, contacts, relationships } from '../db/schema'
import { openTestDb } from '../testDb'
import * as act from './activities'
import * as svc from './contacts'
import type { Actor } from './common'

let db: Db
let close: () => Promise<void>
const USER = '00000000-0000-4000-8000-0000000000c1'
const NOW = new Date('2026-11-15T10:00:00.000Z')
const actor: Actor = { userId: USER, now: NOW }
const ENTITIES = ['contacts', 'contact_identity', 'contact_roles', 'relationships', 'consents', 'activities', 'activity_contacts']

async function cleanup() {
  await db.delete(activityContacts)
  await db.delete(activities)
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

const person = (firstName: string, lastName: string, extra: Partial<Parameters<typeof svc.createContact>[1]> = {}) =>
  svc.createContact(
    db,
    { kind: 'person', firstName, lastName, name: null, email: null, phone: null, address: null, city: null, notes: null, tags: [], roles: [], ...extra },
    actor
  )
const list = (f: Partial<Parameters<typeof svc.listContacts>[1]> = {}) => svc.listContacts(db, { kind: 'all', ...f }, NOW)

describe('osoby i instytucje', () => {
  it('tworzy osobę z tożsamością w osobnej tabeli; contacts nie ma imion ani nazwisk', async () => {
    const { id } = await person('Anna', 'Testowa', { email: 'anna@example.org', roles: ['participant'], tags: ['senior'] })
    const [row] = await db.select().from(contacts).where(inArray(contacts.id, [id]))
    expect(JSON.stringify(row)).not.toMatch(/Anna|Testowa/)
    const d = await svc.getContact(db, id)
    expect(d).toMatchObject({ label: 'Anna Testowa', contact: { kind: 'person', email: 'anna@example.org', tags: ['senior'], version: 1, identityVersion: 1 } })
    expect(d.roles.map((r) => [r.role, r.since])).toEqual([['participant', '2026-11-15']])
  })

  it('change_log tożsamości ma tylko nazwy pól, bez wartości', async () => {
    const { id } = await person('Barbara', 'Przykładowa', { phone: '600100200' })
    const d = await svc.getContact(db, id)
    await svc.updateContact(db, { ...d.contact, id, version: 1, identityVersion: 1, lastName: 'Zmieniona', tags: [] }, actor)
    const log = await db.select().from(changeLog).where(sql`${changeLog.entity} = 'contact_identity'`)
    // oba wpisy mają ten sam czas (stały zegar testu), więc bez założeń o kolejności
    expect(log.map((e) => e.op).sort()).toEqual(['insert', 'update'])
    expect(log.find((e) => e.op === 'update')!.changedFields).toEqual({ lastName: true })
    expect(JSON.stringify(log)).not.toMatch(/Barbara|Przykładowa|Zmieniona|600100200/)
  })

  it('równoczesna edycja: druga zmiana ze starą wersją → VERSION_CONFLICT, dane pierwszej zostają', async () => {
    const { id } = await person('Celina', 'Próbna')
    const d = await svc.getContact(db, id)
    const base = { ...d.contact, id, version: d.contact.version, identityVersion: d.contact.identityVersion!, tags: [] }
    await svc.updateContact(db, { ...base, city: 'Mosina' }, actor)
    await expect(svc.updateContact(db, { ...base, city: 'Poznań' }, actor)).rejects.toMatchObject({ code: 'VERSION_CONFLICT' })
    expect((await svc.getContact(db, id)).contact.city).toBe('Mosina')
  })

  it('walidacja: osoba bez nazwiska, instytucja bez nazwy', async () => {
    await expect(person('Dorota', '')).rejects.toMatchObject({ code: 'VALIDATION' })
    await expect(
      svc.createContact(db, { kind: 'institution', firstName: null, lastName: null, name: null, email: null, phone: null, address: null, city: null, notes: null, tags: [], roles: [] }, actor)
    ).rejects.toMatchObject({ code: 'VALIDATION' })
  })

  it('lista: filtry, sortowanie po nazwisku po polsku, bez usuniętych', async () => {
    const a = await person('Ewa', 'Żak', { roles: ['volunteer'], tags: ['kgw'] })
    await person('Jan', 'Łuczak', { city: 'Mosina' })
    const c = await person('Olga', 'Adamska')
    expect((await list()).map((x) => x.label)).toEqual(['Olga Adamska', 'Jan Łuczak', 'Ewa Żak'])
    expect((await list({ role: 'volunteer' })).map((x) => x.id)).toEqual([a.id])
    expect((await list({ tag: 'kgw' })).map((x) => x.id)).toEqual([a.id])
    expect((await list({ q: 'mosina' })).map((x) => x.label)).toEqual(['Jan Łuczak'])
    await svc.deleteContact(db, { id: c.id, version: 1 }, actor)
    expect((await list()).map((x) => x.label)).toEqual(['Jan Łuczak', 'Ewa Żak'])
    expect(await svc.searchGlobal(db, 'Adamska')).toEqual([])
    expect(await svc.listTags(db)).toEqual(['kgw'])
  })

  it('duplikaty po imieniu i nazwisku, e-mailu albo telefonie', async () => {
    const a = await person('Halina', 'Wzorcowa', { email: 'h@example.org', phone: '+48 600 200 300' })
    const dup = { firstName: null, lastName: null, email: null, phone: null, excludeId: null }
    expect((await svc.findDuplicates(db, { ...dup, firstName: 'halina', lastName: 'WZORCOWA' }, NOW)).map((x) => x.id)).toEqual([a.id])
    expect((await svc.findDuplicates(db, { ...dup, phone: '600200300' }, NOW)).map((x) => x.id)).toEqual([a.id])
    expect(await svc.findDuplicates(db, { ...dup, email: 'h@example.org', excludeId: a.id }, NOW)).toEqual([])
  })

  it('role: zakończona rola nie jest aktywna; powiązania z obu stron; zgody', async () => {
    const p = await person('Irena', 'Fikcyjna')
    const inst = await svc.createContact(
      db,
      { kind: 'institution', firstName: null, lastName: null, name: 'Gminny Ośrodek Testowy', email: null, phone: null, address: null, city: null, notes: null, tags: [], roles: [] },
      actor
    )
    await svc.addRole(db, { contactId: p.id, role: 'member', since: '2026-01-01', note: null }, actor)
    const role = (await svc.getContact(db, p.id)).roles[0]!
    await svc.endRole(db, { id: role.id, version: role.version, until: '2026-11-01' }, actor)
    expect((await list()).find((x) => x.id === p.id)!.roles).toEqual([])

    await svc.addRelationship(db, { contactAId: p.id, contactBId: inst.id, type: 'works_at', note: null }, actor)
    expect((await svc.getContact(db, p.id)).relationships).toMatchObject([{ isA: true, type: 'works_at', other: { label: 'Gminny Ośrodek Testowy' } }])
    expect((await svc.getContact(db, inst.id)).relationships).toMatchObject([{ isA: false, other: { label: 'Irena Fikcyjna' } }])
    await expect(svc.addRelationship(db, { contactAId: p.id, contactBId: p.id, type: 'other', note: null }, actor)).rejects.toMatchObject({ code: 'VALIDATION' })

    await svc.addConsent(db, { contactId: p.id, type: 'image', basis: null, givenAt: '2026-10-01', validUntil: null, note: null }, actor)
    const consent = (await svc.getContact(db, p.id)).consents[0]!
    await svc.withdrawConsent(db, { id: consent.id, version: consent.version, at: '2026-11-10' }, actor)
    expect((await svc.getContact(db, p.id)).consents[0]).toMatchObject({ type: 'image', withdrawnAt: '2026-11-10', version: 2 })
  })

  it('nie da się dopisać roli do usuniętej osoby', async () => {
    const p = await person('Krystyna', 'Usunięta')
    await svc.deleteContact(db, { id: p.id, version: 1 }, actor)
    await expect(svc.addRole(db, { contactId: p.id, role: 'donor', since: null, note: null }, actor)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('wyszukiwarka globalna od 2 znaków, po tożsamości', async () => {
    await person('Lena', 'Szukana', { email: 'lena@example.org' })
    expect(await svc.searchGlobal(db, 'l')).toEqual([])
    expect(await svc.searchGlobal(db, 'szuk')).toMatchObject([{ type: 'person', label: 'Lena Szukana', sub: 'lena@example.org' }])
  })
})

describe('oś aktywności', () => {
  const entry = (contactIds: string[], extra: Partial<Parameters<typeof act.addActivity>[1]> = {}) =>
    act.addActivity(db, { type: 'note', channel: null, form: null, durationMinutes: null, occurredAt: '2026-11-14T09:00:00.000Z', content: 'Rozmowa testowa', contactIds, ...extra }, actor)

  it('nowa osoba dostaje wpis systemowy „contact_created”', async () => {
    const p = await person('Maria', 'Osiowa')
    const [a] = (await svc.getContact(db, p.id)).activities
    expect(a).toMatchObject({ type: 'system', contacts: [{ id: p.id, label: 'Maria Osiowa' }] })
    expect(JSON.parse(a!.content)).toEqual({ event: 'contact_created' })
  })

  it('wpis z kilkoma osobami widać na osi każdej z nich; kolejność od najnowszego', async () => {
    const a = await person('Nina', 'Pierwsza')
    const b = await person('Ola', 'Druga')
    await entry([a.id, b.id], { type: 'contact', channel: 'phone', durationMinutes: 15, form: 'pominięte przy kontakcie' })
    const onA = (await svc.getContact(db, a.id)).activities
    expect(onA.map((x) => x.type)).toEqual(['system', 'contact'])
    expect(onA[1]).toMatchObject({ channel: 'phone', durationMinutes: 15, form: null, contacts: [{ label: 'Nina Pierwsza' }, { label: 'Ola Druga' }] })
    expect((await svc.getContact(db, b.id)).activities.map((x) => x.type)).toContain('contact')
  })

  it('notatka nie ma kanału ani czasu; wsparcie ma formę i czas', async () => {
    const p = await person('Paula', 'Wsparta')
    await entry([p.id], { channel: 'email', durationMinutes: 30 })
    await entry([p.id], { type: 'support', form: 'doradztwo', durationMinutes: 60, occurredAt: '2026-11-15T08:00:00.000Z' })
    const [support, note] = (await svc.getContact(db, p.id)).activities.filter((x) => x.type !== 'system')
    expect(support).toMatchObject({ type: 'support', form: 'doradztwo', durationMinutes: 60 })
    expect(note).toMatchObject({ type: 'note', channel: null, durationMinutes: null })
  })

  it('usunięcie wpisu: znika z osi; wpisu systemowego nie da się usunąć', async () => {
    const p = await person('Renata', 'Kasująca')
    await entry([p.id])
    const list = (await svc.getContact(db, p.id)).activities
    const note = list.find((x) => x.type === 'note')!
    const system = list.find((x) => x.type === 'system')!
    await act.deleteActivity(db, { id: note.id, version: note.version }, actor)
    await expect(act.deleteActivity(db, { id: system.id, version: system.version }, actor)).rejects.toMatchObject({ code: 'VALIDATION' })
    expect((await svc.getContact(db, p.id)).activities.map((x) => x.type)).toEqual(['system'])
  })

  it('wpis dla usuniętej albo nieistniejącej osoby → NOT_FOUND', async () => {
    const p = await person('Sara', 'Usunięta')
    await svc.deleteContact(db, { id: p.id, version: 1 }, actor)
    await expect(entry([p.id])).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(entry(['00000000-0000-4000-8000-00000000ffff'])).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})
