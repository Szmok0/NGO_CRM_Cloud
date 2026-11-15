// Scenariusz akceptacji ZADAŃ_02 i 03 przez API (POST /api/rpc i trasy załączników) z prawdziwymi sesjami z bazy, na lokalnej bazie testowej.
// Wzór: desktopowe src/main/services/acceptance.test.ts (kroki dotyczące bazy, kopii i haseł są w ZADANIU_01 / ZADANIU_04).
// Dane wrażliwe szyfruje tu „przeglądarka” w Node: te same moduły `src/client/crypto` na WebCrypto. Dane fikcyjne.
import { randomUUID } from 'node:crypto'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ATTACHMENT_MAX_BYTES } from '@shared/api'
import { CONTACT_COLUMNS, CONTACT_COLUMNS_OPT_IN } from '@shared/exportLabels'
import { createSlot, exportPublicKey, generateOrgKey, generateUserKeyPair, importPublicKey, openSlot } from '../client/crypto/keys'
import { createRecoverySlot, formatRecoveryKey, generateRecoveryKey, openRecoverySlot, parseRecoveryKey } from '../client/crypto/recovery'
import { decryptSensitive, emptySensitive, encryptSensitive, reencryptSensitive } from '../client/crypto/sensitive'
import { decryptFile, decryptMeta, encryptFile, reencryptMeta } from '../client/crypto/files'
import { buildApp } from './app'
import { SETTINGS_ID } from './auth/setup'
import { dbSessions, SESSION_COOKIE } from './auth/sessions'
import { TEST_APP_SECRET, TEST_SCRYPT, addTestUser, sessionCookieFor, wipeAccounts } from './auth/testkit'
import type { Db } from './db/connection'
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
let storageDir: string
// staffNoKey: pracownik bez slotu; admin2: drugi administrator bez slotu (odzyskanie dostępu). Oba konta zakłada scenariusz ZADANIA_03.
const who = { admin: '', staff: '', readonly: '', staffNoKey: '', admin2: '' }
const cookie = { admin: '', staff: '', readonly: '', staffNoKey: '', admin2: '' }

async function wipeDomain() {
  for (const t of [
    erasedContacts,
    attachments,
    contactSensitive,
    taskItems,
    tasks,
    attendance,
    actionSessions,
    actionParticipants,
    activityContacts,
    activities,
    actions,
    topics,
    consents,
    relationships,
    contactRoles,
    contactIdentity,
    contacts
  ])
    await db.delete(t)
}

beforeAll(async () => {
  ;({ db, close } = await openTestDb())
  await wipeDomain()
  await wipeAccounts(db)
  storageDir = mkdtempSync(join(tmpdir(), 'ngocrm-test-acceptance-'))
  app = buildApp(db, [], dbSessions(db), { appSecret: TEST_APP_SECRET, scryptParams: TEST_SCRYPT, storageDir })
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
  rmSync(storageDir, { recursive: true, force: true })
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

// ---------- ZADANIE_03: dane wrażliwe ----------

describe('scenariusz akceptacji ZADANIA_03 (dane wrażliwe, przez API, szyfrowanie jak w przeglądarce)', () => {
  const pairs: Partial<Record<Role, CryptoKeyPair>> = {}
  let recovery1: Uint8Array<ArrayBuffer>
  let recovery2Printed = ''
  let halinaId = ''
  let actionId = ''
  let personFileId = ''
  let staffOldKey: CryptoKey
  let fields = { ...emptySensitive(), pesel: '02070803628', notes: 'Notatka poufna testowa' }
  const fileBytes = new TextEncoder().encode('%PDF-1.4 zaświadczenie testowe Halina Wrażliwa')
  const fileName = 'zaswiadczenie-Halina.pdf'

  const logOf = (action: string) => db.select().from(accessLog).where(eq(accessLog.action, action))
  const storedFiles = () => {
    try {
      return readdirSync(join(storageDir, 'attachments'))
    } catch {
      return [] // folder powstaje przy pierwszym pliku
    }
  }
  /** Klucz organizacji ze slotu osoby (domyślnie najnowsza wersja), jak `keyring.ts` po odblokowaniu. */
  async function myOrgKey(role: Role, version?: number) {
    const slots = (await ok<{ keyVersion: number; wrappedKey: string }[]>(role, 'keys.mySlots')).sort((a, b) => a.keyVersion - b.keyVersion)
    const slot = version === undefined ? slots.at(-1) : slots.find((s) => s.keyVersion === version)
    if (!slot) throw new Error(`brak slotu: ${role}`)
    return openSlot(slot.wrappedKey, pairs[role]!.privateKey, slot.keyVersion)
  }
  async function upload(role: Role, target: { targetType: string; targetId: string }, keyVersion: number, body: Uint8Array, metaEnc: string) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/attachments',
      headers: {
        ...headers,
        cookie: cookie[role],
        'content-type': 'application/octet-stream',
        'x-target-type': target.targetType,
        'x-target-id': target.targetId,
        'x-key-version': String(keyVersion),
        'x-meta-enc': metaEnc
      },
      payload: Buffer.from(body)
    })
    return { status: res.statusCode, code: (res.json() as { code?: string }).code }
  }
  const download = (role: Role, id: string) => app.inject({ method: 'GET', url: `/api/attachments/${id}`, headers: { ...headers, cookie: cookie[role] } })
  /** Pobranie i odszyfrowanie załącznika osoby tak jak w przeglądarce. */
  async function readPersonFile(role: Role) {
    const [file] = await ok<any[]>(role, 'attachments.list', { targetType: 'contact', targetId: halinaId })
    const meta = await decryptMeta(file.metaEnc, await myOrgKey(role), { targetType: 'contact', targetId: halinaId }, file.keyVersion)
    const res = await download(role, file.id)
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-disposition']).toMatch(/^attachment/)
    const plain = await decryptFile(new Uint8Array(res.rawPayload).buffer, meta.fileKey, meta.fileVersion ?? file.keyVersion)
    return { file, meta, plain: new Uint8Array(plain) }
  }

  beforeAll(async () => {
    for (const r of ['admin', 'staff', 'readonly'] as const) {
      pairs[r] = await generateUserKeyPair()
      await db.update(users).set({ publicKey: await exportPublicKey(pairs[r].publicKey) }).where(eq(users.id, who[r]))
    }
    for (const r of ['staffNoKey', 'admin2'] as const) {
      pairs[r] = await generateUserKeyPair()
      const u = await addTestUser(db, { role: r === 'admin2' ? 'admin' : 'staff', publicKey: await exportPublicKey(pairs[r].publicKey) })
      who[r] = u.id
      cookie[r] = await sessionCookieFor(db, u.id)
    }
    // Klucz organizacji jak po kreatorze pierwszego uruchomienia (auth/setup.ts): wersja 1, slot administratora, slot odzyskiwania.
    const orgKey = await generateOrgKey()
    recovery1 = generateRecoveryKey()
    const now = new Date()
    await db.insert(orgKeys).values({ version: 1, createdAt: now, createdBy: who.admin })
    await db.insert(keySlots).values([
      { id: randomUUID(), userId: who.admin, keyVersion: 1, wrappedKey: await createSlot(orgKey, pairs.admin!.publicKey, 1), grantedBy: who.admin, grantedAt: now },
      { id: randomUUID(), userId: null, keyVersion: 1, wrappedKey: await createRecoverySlot(orgKey, recovery1, 1), grantedBy: who.admin, grantedAt: now }
    ])
  }, 60_000)

  it('2: pola domyślnie wyłączone; po włączeniu PESEL i notatka; w bazie tylko szyfrogram, w change_log tylko nazwy pól', async () => {
    halinaId = (await person('Halina', 'Wrażliwa')).id
    const k1 = await myOrgKey('admin')
    const enc = await encryptSensitive(fields, k1, halinaId, 1)
    const s = await ok<any>('admin', 'settings.get')
    expect(s.sensitiveFieldsEnabled).toBe(false)
    expect(await rpc('admin', 'sensitive.save', { contactId: halinaId, version: null, keyVersion: 1, ...enc })).toMatchObject({ status: 403, code: 'FORBIDDEN' })

    await ok('admin', 'settings.update', {
      version: s.version,
      orgName: s.orgName,
      profile: s.profile,
      enabledModules: s.enabledModules,
      roleLabels: s.roleLabels,
      staleDays: s.staleDays,
      sensitiveFieldsEnabled: true
    })
    expect(await ok('admin', 'sensitive.save', { contactId: halinaId, version: null, keyVersion: 1, ...enc })).toEqual({ version: 1 })
    expect(await ok<any>('readonly', 'contacts.get', { id: halinaId })).toMatchObject({ hasSensitive: true, sensitiveKeyVersion: 1 })

    const [row] = await db.select().from(contactSensitive).where(eq(contactSensitive.contactId, halinaId))
    expect(row).toMatchObject({ keyVersion: 1, iv: enc.iv, ciphertext: enc.ciphertext })
    const plainInDb = JSON.stringify(row) + Buffer.from(row!.ciphertext, 'base64').toString('utf8')
    expect(plainInDb).not.toMatch(/02070803628|Notatka poufna|pesel/)
    const log = await db.select().from(changeLog).where(eq(changeLog.entity, 'contact_sensitive'))
    expect(log.length).toBeGreaterThan(0)
    expect(log.every((e) => Object.values(e.changedFields as object).every((v) => v === true))).toBe(true)
    expect(JSON.stringify(log)).not.toMatch(/02070803628|Notatka poufna/)
  })

  it('3, 5: bez slotu 403; administrator nadaje dostęp; odsłonięcie z wpisem w dzienniku; „tylko odczyt” odsłania, ale nie zapisze; konflikt wersji', async () => {
    for (const r of ['staff', 'staffNoKey'] as const) expect(await rpc(r, 'sensitive.reveal', { contactId: halinaId }), r).toMatchObject({ status: 403, code: 'NO_KEY_ACCESS' })

    const k1 = await myOrgKey('admin')
    const list = await ok<any[]>('admin', 'access.list')
    for (const r of ['staff', 'readonly'] as const) {
      const publicKey = await importPublicKey(list.find((x) => x.userId === who[r]).publicKey)
      await ok('admin', 'access.grant', { userId: who[r], slots: [{ keyVersion: 1, wrappedKey: await createSlot(k1, publicKey, 1) }] })
    }
    expect((await ok<any[]>('admin', 'access.list')).filter((x) => x.hasAccess).map((x) => x.userId).sort()).toEqual([who.admin, who.staff, who.readonly].sort())

    const revealsBefore = (await logOf('reveal_sensitive')).length
    for (const r of ['staff', 'readonly'] as const) {
      const c = await ok<any>(r, 'sensitive.reveal', { contactId: halinaId })
      expect(await decryptSensitive(c, await myOrgKey(r), halinaId, c.keyVersion), r).toEqual(fields)
    }
    const reveals = await logOf('reveal_sensitive')
    expect(reveals).toHaveLength(revealsBefore + 2)
    expect(reveals.every((e) => e.targetId === halinaId && e.targetType === 'contact')).toBe(true)

    const changed = { ...fields, health: 'Wpis testowy o zdrowiu' }
    const enc = await encryptSensitive(changed, await myOrgKey('staff'), halinaId, 1)
    expect(await rpc('readonly', 'sensitive.save', { contactId: halinaId, version: 1, keyVersion: 1, ...enc })).toMatchObject({ status: 403 })
    expect(await ok('staff', 'sensitive.save', { contactId: halinaId, version: 1, keyVersion: 1, ...enc })).toEqual({ version: 2 })
    expect(await rpc('admin', 'sensitive.save', { contactId: halinaId, version: 1, keyVersion: 1, ...enc })).toMatchObject({ status: 409, code: 'VERSION_CONFLICT' })
    fields = changed
    const c = await ok<any>('admin', 'sensitive.reveal', { contactId: halinaId })
    expect(await decryptSensitive(c, k1, halinaId, 1)).toEqual(fields)
  })

  it('7: załącznik do osoby i działania; w STORAGE_DIR tylko szyfrogram pod losową nazwą; pobranie z wpisem w dzienniku; plik ponad limit odrzucony', async () => {
    actionId = (await ok<{ id: string }>('staff', 'actions.create', { title: 'Warsztat z dokumentami', type: 'workshop', framework: 'project', status: 'planned', startDate: day(-3), endDate: day(3) })).id
    const k1 = await myOrgKey('staff')
    for (const target of [
      { targetType: 'contact', targetId: halinaId },
      { targetType: 'action', targetId: actionId }
    ]) {
      const enc = await encryptFile(fileBytes.buffer, { name: fileName, type: 'application/pdf' }, k1, target, 1)
      expect(await upload('staff', target, 1, enc.body, enc.metaEnc), target.targetType).toMatchObject({ status: 200 })
    }
    const target = { targetType: 'contact', targetId: halinaId }
    const enc = await encryptFile(fileBytes.buffer, { name: fileName, type: 'application/pdf' }, k1, target, 1)
    expect((await upload('readonly', target, 1, enc.body, enc.metaEnc)).status).toBe(403)
    expect(await upload('staffNoKey', target, 1, enc.body, enc.metaEnc)).toMatchObject({ status: 403, code: 'NO_KEY_ACCESS' })
    expect(await upload('staff', target, 1, new Uint8Array(ATTACHMENT_MAX_BYTES + 1), enc.metaEnc)).toMatchObject({ status: 400, code: 'VALIDATION' })

    const stored = storedFiles()
    expect(stored).toHaveLength(2)
    for (const f of stored) {
      expect(f).toMatch(/^[0-9a-f]{32}$/)
      const raw = readFileSync(join(storageDir, 'attachments', f))
      expect(raw.includes('%PDF-1.4')).toBe(false)
      expect(raw.includes('Halina')).toBe(false)
    }
    expect(JSON.stringify(await db.select().from(attachments))).not.toMatch(/Halina|zaswiadczenie|application\/pdf/)

    const { file, meta, plain } = await readPersonFile('readonly')
    personFileId = file.id
    expect(meta).toMatchObject({ name: fileName, type: 'application/pdf' })
    expect(plain).toEqual(fileBytes)
    expect(await logOf('download_attachment')).toMatchObject([{ userId: who.readonly, targetId: file.id }])
    expect((await download('staffNoKey', file.id)).statusCode).toBe(403)
    expect(await ok<any[]>('staff', 'attachments.list', { targetType: 'action', targetId: actionId })).toHaveLength(1)
  })

  it('5: odebranie dostępu kończy sesję pracownika; po ponownym logowaniu nie ma dostępu', async () => {
    staffOldKey = await myOrgKey('staff')
    expect(await ok('admin', 'access.revoke', { userId: who.staff })).toEqual({ hadAccess: true })
    const res = await app.inject({ method: 'POST', url: '/api/rpc', headers: { ...headers, cookie: cookie.staff }, payload: { method: 'contacts.list' } })
    expect(res.statusCode).toBe(401)

    cookie.staff = await sessionCookieFor(db, who.staff)
    expect(await ok('staff', 'keys.mySlots')).toEqual([])
    expect(await rpc('staff', 'sensitive.reveal', { contactId: halinaId })).toMatchObject({ status: 403, code: 'NO_KEY_ACCESS' })
    expect((await download('staff', personFileId)).statusCode).toBe(403)
    expect(await logOf('revoke_access')).toMatchObject([{ userId: who.admin, targetId: who.staff }])
  })

  it('6: zmiana klucza: nowy klucz odzyskiwania do wydruku, przerwana zmiana się kończy, dane i załączniki czytają się, stare sloty znikają', async () => {
    const k1 = await myOrgKey('admin', 1)
    const k2 = await generateOrgKey()
    const recovery2 = generateRecoveryKey()
    recovery2Printed = await formatRecoveryKey(recovery2)
    const holders = (await ok<any[]>('admin', 'access.list')).filter((x) => x.hasAccess)
    expect(holders.map((x) => x.userId).sort()).toEqual([who.admin, who.readonly].sort())
    const slots = await Promise.all(holders.map(async (h) => ({ userId: h.userId, wrappedKey: await createSlot(k2, await importPublicKey(h.publicKey), 2) })))
    await ok('admin', 'keys.rotateStart', { keyVersion: 2, slots, recoverySlot: await createRecoverySlot(k2, recovery2, 2) })

    // pierwsza partia (same dane wrażliwe), potem „zamknięta karta”
    const p1 = await ok<any>('admin', 'keys.rotatePending', { limit: 1 })
    expect(p1.remaining).toEqual({ sensitive: 1, attachments: 2 })
    const sensitive = await Promise.all(
      p1.sensitive.map(async (r: any) => ({ id: r.id, version: r.version, ...(await reencryptSensitive(r, k1, r.keyVersion, k2, 2, r.contactId)) }))
    )
    expect(await ok('admin', 'keys.rotateBatch', { keyVersion: 2, sensitive })).toEqual({ updated: 1, conflicts: [] })
    expect(await rpc('admin', 'keys.rotateFinish')).toMatchObject({ status: 409, code: 'ROTATION_PENDING' })

    // wznowienie: zostały metadane załączników (pliki na dysku bez zmian)
    const filesBefore = storedFiles().map((f) => readFileSync(join(storageDir, 'attachments', f)))
    const p2 = await ok<any>('admin', 'keys.rotatePending')
    expect(p2.remaining).toEqual({ sensitive: 0, attachments: 2 })
    const metas = await Promise.all(p2.attachments.map(async (f: any) => ({ id: f.id, version: f.version, metaEnc: await reencryptMeta(f.metaEnc, k1, f.keyVersion, k2, 2, f) })))
    expect(await ok('admin', 'keys.rotateBatch', { keyVersion: 2, attachments: metas })).toEqual({ updated: 2, conflicts: [] })
    await ok('admin', 'keys.rotateFinish')
    expect(storedFiles().map((f) => readFileSync(join(storageDir, 'attachments', f)))).toEqual(filesBefore)

    expect(new Set((await db.select().from(keySlots)).map((s) => s.keyVersion))).toEqual(new Set([2]))
    expect((await ok<any[]>('readonly', 'keys.mySlots')).map((s) => s.keyVersion)).toEqual([2])
    const c = await ok<any>('readonly', 'sensitive.reveal', { contactId: halinaId })
    expect(c.keyVersion).toBe(2)
    expect(await decryptSensitive(c, await myOrgKey('readonly'), halinaId, 2)).toEqual(fields)
    await expect(decryptSensitive(c, staffOldKey, halinaId, 2)).rejects.toThrow() // stary klucz odebranego pracownika już nic nie otwiera
    const { file, meta, plain } = await readPersonFile('readonly')
    expect(file.keyVersion).toBe(2)
    expect(meta.fileVersion).toBe(1)
    expect(plain).toEqual(fileBytes)
    expect(await logOf('key_rotated')).toMatchObject([{ userId: who.admin }])
  })

  it('8: „Odzyskaj dostęp” nowym kluczem odzyskiwania przywraca administratorowi dostęp; stary klucz odzyskiwania nie działa', async () => {
    expect(await rpc('admin2', 'sensitive.reveal', { contactId: halinaId })).toMatchObject({ status: 403, code: 'NO_KEY_ACCESS' })
    const { keyVersion, recoverySlot } = await ok<{ keyVersion: number; recoverySlot: string }>('admin2', 'keys.recoverySlot')
    expect(keyVersion).toBe(2)
    await expect(openRecoverySlot(recoverySlot, recovery1, 2)).rejects.toThrow()
    const typed = recovery2Printed.toLowerCase().replace(/-/g, ' ') // przepisany z kartki
    const k2 = await openRecoverySlot(recoverySlot, await parseRecoveryKey(typed), 2)
    await ok('admin2', 'keys.recover', { keyVersion: 2, wrappedKey: await createSlot(k2, pairs.admin2!.publicKey, 2) })

    const c = await ok<any>('admin2', 'sensitive.reveal', { contactId: halinaId })
    expect(await decryptSensitive(c, await myOrgKey('admin2'), halinaId, 2)).toEqual(fields)
    expect(await logOf('key_recovered')).toMatchObject([{ userId: who.admin2 }])
  })

  it('10: eksport danych osoby bez szyfrogramu danych wrażliwych, z listą dokumentów; „tylko odczyt” nie eksportuje', async () => {
    const e = await ok<any>('staff', 'contacts.exportData', { id: halinaId })
    expect(e.detail.contact).toMatchObject({ firstName: 'Halina', lastName: 'Wrażliwa' })
    expect(e.detail).toMatchObject({ hasSensitive: true, sensitiveKeyVersion: 2 })
    expect(e.attachments).toHaveLength(1)
    const [row] = await db.select().from(contactSensitive).where(eq(contactSensitive.contactId, halinaId))
    expect(JSON.stringify(e)).not.toContain(row!.ciphertext)
    expect(await rpc('readonly', 'contacts.exportData', { id: halinaId })).toMatchObject({ status: 403 })
    expect(await logOf('export')).toMatchObject([{ userId: who.staff, targetType: 'contact', targetId: halinaId }])
  })

  it('11: CSV listy osób: minimalne kolumny bez e-maili i telefonów, bez danych wrażliwych; „tylko odczyt” nie eksportuje', async () => {
    const columns = CONTACT_COLUMNS.filter((c) => !CONTACT_COLUMNS_OPT_IN.includes(c))
    const file = await ok<any>('staff', 'exports.csv', { list: 'contacts', kind: 'person', columns })
    expect(file.rows).toBeGreaterThan(0)
    expect(file.csv).toContain('Wrażliwa')
    expect(file.csv).not.toMatch(/@example\.org|500 000 001|02070803628|Notatka poufna/)
    expect(await rpc('staff', 'exports.csv', { list: 'contacts', columns: [...columns, 'pesel'] })).toMatchObject({ status: 400 })
    expect(await rpc('readonly', 'exports.csv', { list: 'contacts', columns })).toMatchObject({ status: 403 })
    expect((await logOf('export')).filter((e) => e.targetType === 'contacts_list')).toMatchObject([{ userId: who.staff, targetId: null }])
  })

  it('9: anonimizacja: tożsamość, dane wrażliwe i załączniki znikają, frekwencja bez zmian, „Osoba zanonimizowana”', async () => {
    await addParticipantById(db, { actionId, contactId: halinaId }, { userId: who.staff, now: new Date() })
    await ok('staff', 'sessions.add', { actionId, date: day(-1), startTime: '10:00', endTime: '12:00' })
    const [session] = (await ok<any>('readonly', 'actions.get', { id: actionId })).sessions
    await ok('staff', 'attendance.set', { sessionId: session.id, contactId: halinaId, status: 'present', version: null })
    await ok('staff', 'activities.add', { type: 'note', content: 'Rozmowa: Halina Wrażliwa', occurredAt: new Date().toISOString(), contactIds: [halinaId] })
    const before = await ok<any>('readonly', 'actions.get', { id: actionId })
    expect(before.participants.find((p: any) => p.contactId === halinaId).attendancePct).toBe(100)

    const preview = await ok<any>('admin', 'contacts.anonymizePreview', { id: halinaId })
    expect(preview.attachments).toBe(1)
    expect(preview.ownActivities.length).toBeGreaterThan(0)
    await ok('admin', 'contacts.anonymize', { id: halinaId, version: preview.version, confirm: 'ANONIMIZUJ' })

    const after = await ok<any>('readonly', 'actions.get', { id: actionId })
    expect(after.heldCount).toBe(before.heldCount)
    expect(after.sessions.map((s: any) => s.presentCount)).toEqual(before.sessions.map((s: any) => s.presentCount))
    expect(after.participants.find((p: any) => p.contactId === halinaId).attendancePct).toBe(100)
    const d = await ok<any>('readonly', 'contacts.get', { id: halinaId })
    expect(d.contact.identityVersion).toBeNull()
    expect(d.contact.anonymizedAt).not.toBeNull()
    expect(d.hasSensitive).toBe(false)
    expect(await db.select().from(contactIdentity).where(eq(contactIdentity.contactId, halinaId))).toEqual([])
    expect(await db.select().from(contactSensitive)).toEqual([])
    expect(storedFiles()).toHaveLength(1) // został tylko dokument działania
    expect(await ok<any[]>('readonly', 'attachments.list', { targetType: 'action', targetId: actionId })).toHaveLength(1)
    expect(await rpc('admin', 'contacts.exportData', { id: halinaId })).toMatchObject({ status: 404 })
    for (const t of [contacts, contactIdentity, activities, attachments, erasedContacts, accessLog, changeLog]) expect(JSON.stringify(await db.select().from(t))).not.toMatch(/Halin|Wrażliw/)
  })

  it('12: dziennik dostępu pokazuje odsłonięcia, pobrania, eksporty, nadania i odebrania, zmianę klucza i anonimizację; eksport CSV', async () => {
    const { rows } = await ok<{ rows: any[] }>('admin', 'accessLog.list', { limit: 500 })
    const seen = new Set(rows.map((r) => r.action))
    for (const a of ['grant_access', 'reveal_sensitive', 'download_attachment', 'revoke_access', 'key_rotation_started', 'key_rotated', 'key_recovered', 'export', 'anonymize'])
      expect(seen, a).toContain(a)
    expect(rows.find((r) => r.action === 'anonymize')).toMatchObject({ userId: who.admin, targetId: halinaId })
    expect(rows.filter((r) => r.targetId === halinaId).every((r) => !r.targetLabel)).toBe(true) // osoba zanonimizowana: bez nazwiska

    const file = await ok<any>('admin', 'accessLog.exportCsv', {})
    expect(file.rows).toBe(rows.length)
    expect(file.csv).not.toMatch(/Halin|Wrażliw|02070803628/)
    for (const r of ['staff', 'readonly'] as const) expect(await rpc(r, 'accessLog.list', {}), r).toMatchObject({ status: 403 })
    expect((await logOf('export')).some((e) => e.targetType === 'access_log')).toBe(true)
  })
})
