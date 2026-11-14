// Zadania na lokalnej bazie testowej (TEST_DATABASE_URL). Dane fikcyjne.
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { and, eq, inArray, like } from 'drizzle-orm'
import type { Db } from '../db/connection'
import { actions, activities, activityContacts, changeLog, contactIdentity, contactRoles, contacts, taskItems, tasks, users } from '../db/schema'
import { openTestDb } from '../testDb'
import * as acts from './actions'
import * as people from './contacts'
import * as svc from './tasks'
import type { Actor } from './common'

let db: Db
let close: () => Promise<void>
const ME: string = randomUUID()
const OTHER: string = randomUUID()
const OFF: string = randomUUID()
const actor: Actor = { userId: ME, now: new Date('2026-11-15T10:00:00.000Z') }
const ENTITIES = ['tasks', 'task_items', 'actions', 'contacts', 'contact_identity', 'contact_roles', 'activities', 'activity_contacts']

async function cleanup() {
  await db.delete(taskItems)
  await db.delete(tasks)
  await db.delete(activityContacts)
  await db.delete(activities)
  await db.delete(actions)
  await db.delete(contactRoles)
  await db.delete(contactIdentity)
  await db.delete(contacts)
  await db.delete(changeLog).where(inArray(changeLog.entity, ENTITIES))
}

beforeAll(async () => {
  ;({ db, close } = await openTestDb())
  const now = new Date()
  const user = (id: string, name: string, status: string) => ({ id, createdAt: now, updatedAt: now, updatedBy: id, version: 1, email: `${id}@zadania.test`, name, role: 'staff', status })
  await db.insert(users).values([user(ME, 'Ala Zadaniowa', 'active'), user(OTHER, 'Bolek Pomocny', 'active'), user(OFF, 'Celina Wyłączona', 'disabled')])
})
beforeEach(cleanup)
afterAll(async () => {
  if (!db) return
  await cleanup()
  await db.delete(users).where(like(users.email, '%@zadania.test'))
  await close()
})

const base = { dueDate: '2026-11-20', assigneeUserId: ME, status: 'todo' as const, priority: 'normal' as const, targetType: null, targetId: null, description: null }
const newTask = async (title: string, extra: Partial<Parameters<typeof svc.createTask>[1]> = {}) => (await svc.createTask(db, { title, ...base, items: [], ...extra }, actor)).id

describe('zadania', () => {
  it('checklista przy tworzeniu, postęp i odhaczanie z wersją', async () => {
    const id = await newTask('Plakat festynu', { items: ['projekt', 'druk', 'rozwieszenie'] })
    const d = await svc.getTask(db, id)
    expect(d.items.map((i) => i.label)).toEqual(['projekt', 'druk', 'rozwieszenie'])
    expect(d.assigneeName).toBe('Ala Zadaniowa')
    await svc.toggleTaskItem(db, { id: d.items[0]!.id, version: 1, done: true }, actor)
    await expect(svc.toggleTaskItem(db, { id: d.items[0]!.id, version: 1, done: false }, actor)).rejects.toMatchObject({ code: 'VERSION_CONFLICT' })
    await svc.addTaskItem(db, { taskId: id, label: 'zdjęcie' }, actor)
    const [row] = await svc.loadTasks(db)
    expect(row).toMatchObject({ itemsDone: 1, itemsTotal: 4 })
    expect((await svc.getTask(db, id)).items.at(-1)).toMatchObject({ label: 'zdjęcie', position: 3 })
  })

  it('przesunięcie w kanbanie zmienia status i zapisuje wpis w change_log; stara wersja → konflikt', async () => {
    const id = await newTask('Zamówić salę')
    await svc.moveTask(db, { id, version: 1, status: 'doing' }, actor)
    expect((await svc.getTask(db, id)).task).toMatchObject({ status: 'doing', version: 2 })
    const log = await db
      .select()
      .from(changeLog)
      .where(and(eq(changeLog.entity, 'tasks'), eq(changeLog.entityId, id), eq(changeLog.op, 'update')))
    expect(log.map((e) => e.changedFields)).toEqual([{ status: 'doing' }])
    await expect(svc.moveTask(db, { id, version: 1, status: 'done' }, actor)).rejects.toMatchObject({ code: 'VERSION_CONFLICT' })
  })

  it('przypisać można tylko aktywnego użytkownika; lista wyboru bez wyłączonych', async () => {
    await expect(newTask('Dla wyłączonej', { assigneeUserId: OFF })).rejects.toMatchObject({ code: 'VALIDATION' })
    const options = (await svc.listUserOptions(db)).filter((u) => [ME, OTHER, OFF].includes(u.id))
    expect(options.map((u) => u.name)).toEqual(['Ala Zadaniowa', 'Bolek Pomocny'])
  })

  it('„moje”, sortowanie po terminie, zadania przy osobie i działaniu', async () => {
    const p = (await people.createContact(db, { kind: 'person', firstName: 'Dorota', lastName: 'Zadana', name: null, email: null, phone: null, address: null, city: null, notes: null, tags: [], roles: [] }, actor)).id
    const a = (await acts.createAction(db, { type: 'event', framework: 'project', title: 'Festyn', status: 'planned', startDate: null, endDate: null, place: null, topicId: null, description: null, expectedParticipants: null }, actor)).id
    await newTask('Zadzwonić', { targetType: 'contact', targetId: p, dueDate: '2026-11-18' })
    await newTask('Namiot', { targetType: 'action', targetId: a, assigneeUserId: OTHER })
    await newTask('Bez terminu', { dueDate: null })
    expect((await svc.listTasks(db, { mine: false }, actor)).map((t) => t.title)).toEqual(['Zadzwonić', 'Namiot', 'Bez terminu'])
    expect((await svc.listTasks(db, { mine: true }, actor)).map((t) => t.title)).toEqual(['Zadzwonić', 'Bez terminu'])
    expect((await people.getContact(db, p)).tasks).toMatchObject([{ title: 'Zadzwonić', targetLabel: 'Dorota Zadana' }])
    expect((await acts.getActionDetail(db, a, actor.now)).tasks).toMatchObject([{ title: 'Namiot', assigneeName: 'Bolek Pomocny' }])

    // działanie w Koszu: jego zadania znikają z listy ogólnej, zostają na karcie działania
    await acts.deleteAction(db, { id: a, version: 1 }, actor)
    expect((await svc.listTasks(db, { mine: false }, actor)).map((t) => t.title)).not.toContain('Namiot')
    expect((await svc.listTasks(db, { mine: false, targetType: 'action', targetId: a }, actor)).map((t) => t.title)).toEqual(['Namiot'])
  })

  it('„dotyczy”: usunięta osoba → NOT_FOUND; niepełne powiązanie jest czyszczone', async () => {
    const p = (await people.createContact(db, { kind: 'person', firstName: 'Ewa', lastName: 'Usunięta', name: null, email: null, phone: null, address: null, city: null, notes: null, tags: [], roles: [] }, actor)).id
    await people.deleteContact(db, { id: p, version: 1 }, actor)
    await expect(newTask('Do usuniętej', { targetType: 'contact', targetId: p })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    const id = await newTask('Sam typ', { targetType: 'contact', targetId: null })
    expect((await svc.getTask(db, id)).task).toMatchObject({ targetType: null, targetId: null })
  })

  it('usunięcie zadania: znika z listy', async () => {
    const id = await newTask('Do kosza')
    await svc.deleteTask(db, { id, version: 1 }, actor)
    expect(await svc.loadTasks(db)).toEqual([])
  })
})
