// Anonimizacja osoby (ZADANIE_03, krok 5a; D12) na lokalnej bazie testowej, przez HTTP jak w aplikacji.
// Test „Nic nie zostało” (bezpieczeństwo, rozdział 6, test 1). Dane fikcyjne.
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { buildApp } from '../app'
import type { Db } from '../db/connection'
import {
  accessLog,
  actionParticipants,
  actionSessions,
  actions,
  activities,
  activityContacts,
  attachments,
  attendance,
  changeLog,
  consents,
  contactIdentity,
  contactRoles,
  contactSensitive,
  contacts,
  erasedContacts,
  keySlots,
  orgKeys,
  relationships,
  taskItems,
  tasks
} from '../db/schema'
import { openTestDb } from '../testDb'
import { dbSessions } from '../auth/sessions'
import { TEST_APP_SECRET, TEST_SCRYPT, addTestUser, sessionCookieFor, wipeAccounts } from '../auth/testkit'
import { applyErasures } from './anonymize'

const HOST = 'crm.example.org'
const headers = { host: HOST, 'x-forwarded-proto': 'https', origin: `https://${HOST}`, 'x-ngo-crm': '1' }
/** Charakterystyczne, fikcyjne nazwisko do przeszukania bazy i plików. */
const MARK = 'Qwertyuszkiewicz'

let db: Db
let close: () => Promise<void>
let app: ReturnType<typeof buildApp>
let storageDir: string
const nowMs = Date.now()
const clock = () => new Date(nowMs)

async function rpc(cookie: string, method: string, params?: unknown) {
  const res = await app.inject({ method: 'POST', url: '/api/rpc', headers: { ...headers, cookie }, payload: { method, params } })
  return { status: res.statusCode, body: res.json() as { ok: boolean; code?: string; message?: string; data?: any } }
}
const ok = async (cookie: string, method: string, params?: unknown) => {
  const r = await rpc(cookie, method, params)
  if (!r.body.ok) throw new Error(`${method}: ${r.status} ${r.body.code} ${r.body.message}`)
  return r.body.data
}

async function account(role: 'admin' | 'staff' | 'readonly', withSlot = true) {
  const u = await addTestUser(db, { role, now: clock(), publicKey: randomBytes(294).toString('base64') })
  if (withSlot) await db.insert(keySlots).values({ id: randomUUID(), userId: u.id, keyVersion: 1, wrappedKey: randomBytes(256).toString('base64'), grantedBy: u.id, grantedAt: clock() })
  return { ...u, cookie: await sessionCookieFor(db, u.id, clock()) }
}

const tech = () => ({ id: randomUUID(), createdAt: clock(), updatedAt: clock(), updatedBy: randomUUID(), deletedAt: null, version: 1 })

async function person(cookie: string, lastName: string, extra: Record<string, unknown> = {}) {
  return (await ok(cookie, 'contacts.create', { kind: 'person', firstName: 'Ewa', lastName, roles: ['participant'], ...extra })).id as string
}

/**
 * Załącznik osoby. Nazwa pliku jest w aplikacji zaszyfrowana w `metaEnc` (tu: losowe bajty), a ciało celowo zawiera nazwisko jawnym tekstem
 * (najgorszy przypadek), żeby przeszukanie STORAGE_DIR coś znaczyło.
 */
async function uploadFor(cookie: string, targetId: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/attachments',
    headers: { ...headers, cookie, 'content-type': 'application/octet-stream', 'x-target-type': 'contact', 'x-target-id': targetId, 'x-key-version': '1', 'x-meta-enc': randomBytes(90).toString('base64') },
    payload: Buffer.concat([randomBytes(28), Buffer.from(`Orzeczenie ${MARK}.pdf`)])
  })
  expect(res.statusCode).toBe(200)
  return res.json().data.id as string
}

const storedFiles = () => {
  try {
    return readdirSync(join(storageDir, 'attachments'))
  } catch {
    return []
  }
}

/** Wszystkie kolumny tekstowe wszystkich tabel bazy testowej, w których występuje `needle`. */
async function textHits(needle: string): Promise<string[]> {
  const [cols] = (await db.execute(
    sql`select table_name as t, column_name as c from information_schema.columns where table_schema = database() and data_type in ('char','varchar','text','mediumtext','longtext','json')`
  )) as unknown as [{ t: string; c: string }[]]
  const hits: string[] = []
  for (const { t, c } of cols) {
    const [rows] = (await db.execute(sql`select count(*) as n from ${sql.identifier(t)} where ${sql.identifier(c)} like ${`%${needle}%`}`)) as unknown as [{ n: number }[]]
    if (Number(rows[0]?.n) > 0) hits.push(`${t}.${c}`)
  }
  return hits
}

async function cleanup() {
  for (const t of [erasedContacts, attachments, attendance, actionSessions, actionParticipants, taskItems, tasks, activityContacts, activities, actions, relationships, consents, contactRoles, contactSensitive, contactIdentity, contacts])
    await db.delete(t)
  await wipeAccounts(db)
  rmSync(join(storageDir, 'attachments'), { recursive: true, force: true })
}

beforeAll(async () => {
  ;({ db, close } = await openTestDb())
  storageDir = mkdtempSync(join(tmpdir(), 'ngocrm-test-anonymize-'))
  app = buildApp(db, [], dbSessions(db, clock), { appSecret: TEST_APP_SECRET, now: clock, scryptParams: TEST_SCRYPT, storageDir })
})
beforeEach(async () => {
  await cleanup()
  await db.insert(orgKeys).values({ version: 1, createdAt: clock(), createdBy: randomUUID(), retiredAt: null })
})
afterAll(async () => {
  if (!db) return
  await app?.close()
  await cleanup()
  rmSync(storageDir, { recursive: true, force: true })
  await close()
})

/** Osoba z nazwiskiem MARK w tożsamości, notatce, tagu, wpisach, zadaniu, notatkach przy rolach/zgodach/powiązaniach/udziale i załączniku. */
async function fullPerson(cookie: string) {
  const id = await person(cookie, MARK, { notes: `Notatka o ${MARK}`, email: 'ewa@example.invalid', tags: [`rodzina ${MARK}`] })
  const other = await person(cookie, 'Inna')
  await ok(cookie, 'activities.add', { type: 'note', content: `Rozmowa z ${MARK}`, occurredAt: clock().toISOString(), contactIds: [id] })
  await ok(cookie, 'activities.add', { type: 'support', form: `wsparcie ${MARK}`, durationMinutes: 30, content: `Wsparcie ${MARK} i Innej`, occurredAt: clock().toISOString(), contactIds: [id, other] })
  await ok(cookie, 'tasks.create', { title: `Zadzwonić do ${MARK}`, description: `Opis ${MARK}`, status: 'todo', priority: 'normal', targetType: 'contact', targetId: id, items: [`Punkt ${MARK}`] })
  await ok(cookie, 'roles.add', { contactId: id, role: 'volunteer', note: `Rola ${MARK}` })
  await ok(cookie, 'consents.add', { contactId: id, type: 'image', basis: `Podstawa ${MARK}`, givenAt: '2026-01-10', note: `Zgoda ${MARK}` })
  await ok(cookie, 'relationships.add', { contactAId: other, contactBId: id, type: 'other', note: `Siostra ${MARK}` })

  const action = { ...tech(), type: 'training', framework: 'project', title: 'Szkolenie testowe', status: 'done' }
  await db.insert(actions).values(action)
  await ok(cookie, 'participants.add', { actionId: action.id, contactId: id })
  await db.update(actionParticipants).set({ note: `Udział ${MARK}` }).where(eq(actionParticipants.contactId, id))
  const session = { ...tech(), actionId: action.id, date: '2026-02-01' }
  await db.insert(actionSessions).values(session)
  await db.insert(attendance).values({ ...tech(), sessionId: session.id, contactId: id, status: 'present' })

  await db.insert(contactSensitive).values({ ...tech(), contactId: id, keyVersion: 1, iv: randomBytes(12).toString('base64'), ciphertext: randomBytes(200).toString('base64') })
  await uploadFor(cookie, id)
  return { id, other, actionId: action.id }
}

describe('podgląd', () => {
  it('rozdziela wpisy tylko tej osoby i wspólne, pokazuje zadania i liczbę załączników', async () => {
    const admin = await account('admin')
    const { id } = await fullPerson(admin.cookie)
    const p = await ok(admin.cookie, 'contacts.anonymizePreview', { id })
    expect(p.version).toBe(1)
    expect(p.ownActivities.map((a: any) => a.content)).toEqual([`Rozmowa z ${MARK}`]) // wpis systemowy „Dodano do bazy” pominięty
    expect(p.sharedActivities.map((a: any) => a.content)).toEqual([`Wsparcie ${MARK} i Innej`])
    expect(p.tasks).toMatchObject([{ title: `Zadzwonić do ${MARK}`, deleted: false }])
    expect(p.attachments).toBe(1)
  })
})

describe('Nic nie zostało', () => {
  it('po anonimizacji nazwisko nie występuje w żadnej kolumnie tekstowej bazy ani w STORAGE_DIR', async () => {
    const admin = await account('admin')
    const { id } = await fullPerson(admin.cookie)
    expect((await textHits(MARK)).length).toBeGreaterThan(5)
    expect(storedFiles()).toHaveLength(1)
    expect(readFileSync(join(storageDir, 'attachments', String(storedFiles()[0]))).includes(MARK)).toBe(true)

    const p =await ok(admin.cookie, 'contacts.anonymizePreview', { id })
    await ok(admin.cookie, 'contacts.anonymize', {
      id,
      version: p.version,
      clearActivityIds: p.sharedActivities.map((a: any) => a.id),
      clearTaskIds: p.tasks.map((t: any) => t.id),
      confirm: 'ANONIMIZUJ'
    })

    expect(await textHits(MARK)).toEqual([])
    expect(storedFiles()).toHaveLength(0)
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]))
    for (const f of walk(storageDir)) expect(readFileSync(f).includes(MARK)).toBe(false)

    expect(await db.select().from(contactIdentity).where(eq(contactIdentity.contactId, id))).toHaveLength(0)
    expect(await db.select().from(contactSensitive).where(eq(contactSensitive.contactId, id))).toHaveLength(0)
    expect(await db.select().from(attachments)).toHaveLength(0)
    const [c] = await db.select().from(contacts).where(eq(contacts.id, id))
    expect(c).toMatchObject({ tags: [], version: 2 })
    expect(c!.anonymizedAt).not.toBeNull()

    expect(await db.select().from(accessLog).where(eq(accessLog.action, 'anonymize'))).toMatchObject([{ userId: admin.id, targetType: 'contact', targetId: id }])
    expect(await db.select().from(changeLog).where(eq(changeLog.op, 'anonymize'))).toMatchObject([{ entity: 'contacts', entityId: id, userId: admin.id }])
    const [erased] = await db.select().from(erasedContacts)
    expect(erased).toMatchObject({ contactId: id })
    expect(erased!.clearedActivityIds).toHaveLength(2)
    expect(erased!.clearedTaskIds).toHaveLength(1)
  })

  it('wpisy wspólne i zadania bez zaznaczenia zachowują treść; wpis tylko tej osoby traci ją zawsze', async () => {
    const admin = await account('admin')
    const { id } = await fullPerson(admin.cookie)
    await ok(admin.cookie, 'contacts.anonymize', { id, version: 1, confirm: 'ANONIMIZUJ' })
    const contents = (await db.select({ type: activities.type, content: activities.content }).from(activities)).filter((a) => a.type !== 'system').map((a) => a.content)
    expect(contents.sort()).toEqual(['', `Wsparcie ${MARK} i Innej`])
    expect((await db.select().from(tasks))[0]!.title).toBe(`Zadzwonić do ${MARK}`)
  })

  it('statystyka zostaje: role, udział, obecność i powiązania', async () => {
    const admin = await account('admin')
    const { id, actionId } = await fullPerson(admin.cookie)
    const before = await ok(admin.cookie, 'actions.get', { id: actionId })
    await ok(admin.cookie, 'contacts.anonymize', { id, version: 1, confirm: 'ANONIMIZUJ' })
    expect(await db.select().from(attendance).where(eq(attendance.contactId, id))).toMatchObject([{ status: 'present', deletedAt: null }])
    expect(await db.select().from(actionParticipants).where(eq(actionParticipants.contactId, id))).toHaveLength(1)
    expect(await db.select().from(contactRoles).where(eq(contactRoles.contactId, id))).toHaveLength(2)
    expect(await db.select().from(relationships)).toHaveLength(1)
    const after = await ok(admin.cookie, 'actions.get', { id: actionId })
    expect(after.participants.length).toBe(before.participants.length)
    expect(JSON.stringify(after.sessions)).toBe(JSON.stringify(before.sessions))
  })
})

describe('odmowy', () => {
  it('tylko administrator', async () => {
    const admin = await account('admin')
    const id = await person(admin.cookie, 'Testowa')
    for (const role of ['staff', 'readonly'] as const) {
      const u = await account(role)
      expect(await rpc(u.cookie, 'contacts.anonymizePreview', { id })).toMatchObject({ status: 403, body: { code: 'FORBIDDEN' } })
      expect(await rpc(u.cookie, 'contacts.anonymize', { id, version: 1, confirm: 'ANONIMIZUJ' })).toMatchObject({ status: 403, body: { code: 'FORBIDDEN' } })
    }
    expect((await db.select().from(contacts).where(eq(contacts.id, id)))[0]!.anonymizedAt).toBeNull()
  })

  it('bez wpisania „ANONIMIZUJ”, ze starą wersją, instytucja, brak osoby', async () => {
    const admin = await account('admin')
    const id = await person(admin.cookie, 'Testowa')
    expect(await rpc(admin.cookie, 'contacts.anonymize', { id, version: 1, confirm: 'anonimizuj' })).toMatchObject({ status: 400, body: { code: 'VALIDATION' } })
    expect(await rpc(admin.cookie, 'contacts.anonymize', { id, version: 7, confirm: 'ANONIMIZUJ' })).toMatchObject({ status: 409, body: { code: 'VERSION_CONFLICT' } })
    expect(await db.select().from(contactIdentity).where(eq(contactIdentity.contactId, id))).toHaveLength(1) // konflikt = nic nie usunięte
    const inst = (await ok(admin.cookie, 'contacts.create', { kind: 'institution', name: 'Fundacja Testowa' })).id
    expect(await rpc(admin.cookie, 'contacts.anonymizePreview', { id: inst })).toMatchObject({ status: 400, body: { code: 'VALIDATION' } })
    expect(await rpc(admin.cookie, 'contacts.anonymize', { id: inst, version: 1, confirm: 'ANONIMIZUJ' })).toMatchObject({ status: 400, body: { code: 'VALIDATION' } })
    expect(await rpc(admin.cookie, 'contacts.anonymize', { id: randomUUID(), version: 1, confirm: 'ANONIMIZUJ' })).toMatchObject({ status: 404 })
  })

  it('wpis lub zadanie spoza osoby nie traci treści', async () => {
    const admin = await account('admin')
    const id = await person(admin.cookie, 'Testowa')
    const other = await person(admin.cookie, 'Inna')
    await ok(admin.cookie, 'activities.add', { type: 'note', content: 'Cudzy wpis', occurredAt: clock().toISOString(), contactIds: [other] })
    const foreign = (await ok(admin.cookie, 'tasks.create', { title: 'Cudze zadanie', status: 'todo', priority: 'normal', targetType: 'contact', targetId: other })).id
    const [act] = (await db.select().from(activities)).filter((a) => a.content === 'Cudzy wpis')
    await ok(admin.cookie, 'contacts.anonymize', { id, version: 1, clearActivityIds: [act!.id], clearTaskIds: [foreign], confirm: 'ANONIMIZUJ' })
    expect((await db.select().from(activities).where(eq(activities.id, act!.id)))[0]!.content).toBe('Cudzy wpis')
    expect((await db.select().from(tasks).where(eq(tasks.id, foreign)))[0]!.title).toBe('Cudze zadanie')
  })

  it('osoba w Koszu da się zanonimizować; ponowna anonimizacja odrzucona', async () => {
    const admin = await account('admin')
    const id = await person(admin.cookie, 'Testowa')
    await ok(admin.cookie, 'contacts.delete', { id, version: 1 })
    await ok(admin.cookie, 'contacts.anonymize', { id, version: 2, confirm: 'ANONIMIZUJ' })
    const [c] = await db.select().from(contacts).where(eq(contacts.id, id))
    expect(c!.deletedAt).not.toBeNull()
    expect(c!.anonymizedAt).not.toBeNull()
    expect(await rpc(admin.cookie, 'contacts.anonymize', { id, version: 3, confirm: 'ANONIMIZUJ' })).toMatchObject({ status: 400, body: { code: 'VALIDATION', message: 'ALREADY_ANONYMIZED' } })
    expect(await rpc(admin.cookie, 'contacts.anonymizePreview', { id })).toMatchObject({ status: 400 })
  })

  it('edycja po anonimizacji odrzucona', async () => {
    const admin = await account('admin')
    const id = await person(admin.cookie, 'Testowa')
    const actionId = randomUUID()
    await db.insert(actions).values({ ...tech(), id: actionId, type: 'training', framework: 'project', title: 'Szkolenie', status: 'planned' })
    await ok(admin.cookie, 'contacts.anonymize', { id, version: 1, confirm: 'ANONIMIZUJ' })
    const refused = [
      ['contacts.update', { id, version: 2, identityVersion: 1, firstName: 'Ewa', lastName: 'Nowa' }],
      ['roles.add', { contactId: id, role: 'donor' }],
      ['consents.add', { contactId: id, type: 'image', givenAt: '2026-01-10' }],
      ['relationships.add', { contactAId: id, contactBId: await person(admin.cookie, 'Inna'), type: 'other' }],
      ['activities.add', { type: 'note', content: 'x', occurredAt: clock().toISOString(), contactIds: [id] }],
      ['participants.add', { actionId, contactId: id }],
      ['tasks.create', { title: 'x', status: 'todo', priority: 'normal', targetType: 'contact', targetId: id }]
      // sensitive.save i załączniki: odmowa dla osoby zanonimizowanej ma testy w sensitive.test.ts i attachments.test.ts
    ] as const
    for (const [method, params] of refused) expect({ method, status: (await rpc(admin.cookie, method, params)).status }).toEqual({ method, status: 404 })
  })
})

describe('applyErasures', () => {
  it('po „odtworzeniu kopii” usuwa dane ponownie, z wybranymi wpisami wspólnymi i zadaniami; drugi raz nic nie psuje', async () => {
    const admin = await account('admin')
    const { id, other } = await fullPerson(admin.cookie)
    const p = await ok(admin.cookie, 'contacts.anonymizePreview', { id })
    const shared = p.sharedActivities[0].id as string
    const taskId = p.tasks[0].id as string
    await ok(admin.cookie, 'contacts.anonymize', { id, version: 1, clearActivityIds: [shared], clearTaskIds: [taskId], confirm: 'ANONIMIZUJ' })

    // „kopia sprzed anonimizacji”: dane osoby wracają, erased_contacts zostaje
    await db.update(contacts).set({ anonymizedAt: null, tags: [`rodzina ${MARK}`] }).where(eq(contacts.id, id))
    await db.insert(contactIdentity).values({ ...tech(), contactId: id, firstName: 'Ewa', lastName: MARK, notes: `Notatka o ${MARK}` })
    await db.insert(contactSensitive).values({ ...tech(), contactId: id, keyVersion: 1, iv: randomBytes(12).toString('base64'), ciphertext: randomBytes(50).toString('base64') })
    await db.update(activities).set({ content: `Wsparcie ${MARK} i Innej` }).where(eq(activities.id, shared))
    await db.update(tasks).set({ title: `Zadzwonić do ${MARK}` }).where(eq(tasks.id, taskId))
    await db.insert(changeLog).values({ id: randomUUID(), entity: 'contacts', entityId: id, op: 'update', changedFields: { tags: [`rodzina ${MARK}`] }, userId: admin.id, at: clock() })
    const ghost = { ...tech(), targetType: 'contact', targetId: id, purpose: 'document', keyVersion: 1, metaEnc: 'AAAA', sizeBytes: 3, storageKey: randomBytes(16).toString('hex') }
    await db.insert(attachments).values(ghost)
    expect((await textHits(MARK)).length).toBeGreaterThan(0)

    expect(await applyErasures(db, storageDir)).toBe(1)
    expect(await textHits(MARK)).toEqual([])
    expect(await db.select().from(attachments)).toHaveLength(0)
    expect((await db.select().from(contacts).where(eq(contacts.id, id)))[0]!.anonymizedAt).not.toBeNull()
    // druga osoba nietknięta
    expect(await db.select().from(contactIdentity).where(eq(contactIdentity.contactId, other))).toHaveLength(1)

    expect(await applyErasures(db, storageDir)).toBe(1)
    expect(await textHits(MARK)).toEqual([])
  })

  it('osoby z listy nie ma w kopii → pomijana', async () => {
    await db.insert(erasedContacts).values({ contactId: randomUUID(), erasedAt: clock(), clearedActivityIds: [], clearedTaskIds: [] })
    expect(await applyErasures(db, storageDir)).toBe(0)
  })
})
