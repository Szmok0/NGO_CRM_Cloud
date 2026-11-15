// npm run dev:demo — dane demonstracyjne (FIKCYJNE, zasada danych 9) TYLKO w lokalnej bazie (D6).
// Usuwa dane domenowe z lokalnej bazy i zakłada je od nowa przez te same usługi co API (tożsamość osobno, oś, change_log).
// Wymaga konta próbnego z `npm run dev:account` (to ono jest autorem większości zmian). Drugi użytkownik „Tomasz Pomocny”
// powstaje bez hasła (nie da się na nie zalogować) — tylko jako autor części zmian i osoba odpowiedzialna za zadania.
// Odmawia: NODE_ENV=production, baza nie jest lokalna, nazwa bazy wygląda na hostingową (uNNN_…). Nie jest częścią zbudowanej aplikacji.
import { randomUUID } from 'node:crypto'
import { eq, inArray, like, sql } from 'drizzle-orm'
import '../src/server/config'
import { openDb, runMigrations, type Db } from '../src/server/db/connection'
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
  taskItems,
  tasks,
  topics,
  users
} from '../src/server/db/schema'
import * as acts from '../src/server/services/actions'
import { addActivity } from '../src/server/services/activities'
import type { Actor } from '../src/server/services/common'
import * as people from '../src/server/services/contacts'
import * as todo from '../src/server/services/tasks'
import type { ActionStatus, ActionType, AttendanceStatus, Framework, Role } from '../src/shared/domain'

const DEV_EMAIL = 'admin@lokalnie.test'
const SECOND_EMAIL = 'tomasz@lokalnie.test'
const DAY = 86_400_000

function localDatabaseUrl(): string {
  if (process.env.NODE_ENV === 'production') throw new Error('Odmowa: NODE_ENV=production')
  const raw = process.env.DATABASE_URL
  if (!raw) throw new Error('Brak DATABASE_URL w .env')
  const url = new URL(raw)
  if (!['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('Odmowa: baza nie jest lokalna')
  if (/^u\d+_/.test(url.pathname.slice(1))) throw new Error('Odmowa: nazwa bazy wygląda na bazę z hostingu')
  return raw
}

const PEOPLE: [string, string, Role[]][] = [
  ['Anna', 'Przykładowa', ['participant']],
  ['Barbara', 'Testowska', ['participant', 'volunteer']],
  ['Celina', 'Wzorcowa', ['participant']],
  ['Dorota', 'Fikcyjna', ['participant']],
  ['Ewa', 'Makietowa', ['participant']],
  ['Franciszek', 'Próbny', ['participant']],
  ['Grażyna', 'Szablonowa', ['participant', 'member']],
  ['Henryk', 'Demowski', ['participant']],
  ['Irena', 'Zmyślona', ['participant']],
  ['Jan', 'Wymyślony', ['participant']],
  ['Katarzyna', 'Umowna', ['participant']],
  ['Leszek', 'Roboczy', ['volunteer']],
  ['Magdalena', 'Przykład', ['volunteer', 'member']],
  ['Natalia', 'Testowa', ['volunteer']],
  ['Olga', 'Ćwiczebna', ['member']],
  ['Paweł', 'Modelowy', ['member']],
  ['Renata', 'Pozorna', ['donor']],
  ['Stanisław', 'Wirtualny', ['donor', 'member']],
  ['Teresa', 'Nieistniejąca', ['donor']],
  ['Urszula', 'Hipotetyczna', ['trainer']],
  ['Wojciech', 'Teoretyczny', ['trainer']],
  ['Zofia', 'Prototyp', ['staff']],
  ['Adam', 'Wstępny', ['staff']],
  ['Bożena', 'Szkicowa', ['partner']],
  ['Cezary', 'Udawany', ['other']]
]

const INSTITUTIONS = [
  'Gminny Ośrodek Pomocy Społecznej w Przykładowie',
  'Szkoła Podstawowa nr 1 w Przykładowie',
  'Urząd Gminy Przykładowo',
  'Fundacja Testowa',
  'Piekarnia „Zmyślona” s.c.',
  'Powiatowy Urząd Pracy w Wzorcowie'
]

/** Usuwa wszystkie dane domenowe (kolejność zgodna z kluczami obcymi) i ich wpisy w change_log. */
async function wipe(db: Db) {
  for (const t of [taskItems, tasks, attendance, actionSessions, actionParticipants, activityContacts, activities, actions, topics, consents, relationships, contactRoles, contactIdentity, contacts])
    await db.delete(t)
  await db
    .delete(changeLog)
    .where(inArray(changeLog.entity, ['contacts', 'contact_identity', 'contact_roles', 'relationships', 'consents', 'activities', 'activity_contacts', 'topics', 'actions', 'action_sessions', 'action_participants', 'attendance', 'tasks', 'task_items']))
}

async function main() {
  const { db, close } = await openDb(localDatabaseUrl())
  try {
    await runMigrations(db)
    const [me] = await db.select().from(users).where(eq(users.email, DEV_EMAIL))
    if (!me) throw new Error(`Brak konta ${DEV_EMAIL}: najpierw uruchom npm run dev:account`)
    const others = await db.select({ email: users.email }).from(users).where(sql`${users.email} not like '%@lokalnie.test'`)
    if (others.length) throw new Error('Odmowa: w bazie są konta spoza pracy lokalnej (to nie jest baza do danych demonstracyjnych)')

    await wipe(db)
    await db.delete(users).where(like(users.email, SECOND_EMAIL))
    const second = randomUUID()
    const created = new Date()
    await db.insert(users).values({ id: second, createdAt: created, updatedAt: created, updatedBy: me.id, version: 1, email: SECOND_EMAIL, name: 'Tomasz Pomocny', role: 'staff', status: 'active' })

    const base = Date.now()
    const day = (offset: number) => new Date(base + offset * DAY).toISOString().slice(0, 10)
    const as = (userId: string, daysAgo: number): Actor => ({ userId, now: new Date(base - daysAgo * DAY) })
    const a = (daysAgo: number) => as(me.id, daysAgo)
    const b = (daysAgo: number) => as(second, daysAgo)

    // --- osoby i instytucje (120 dni temu) ---
    const p: string[] = []
    for (const [i, [firstName, lastName, roles]] of PEOPLE.entries()) {
      const { id } = await people.createContact(
        db,
        {
          kind: 'person',
          firstName,
          lastName,
          name: null,
          email: i % 3 === 0 ? `${firstName.toLowerCase().replace(/[^a-z]/g, '')}.${i}@example.org` : null,
          phone: i % 2 === 0 ? `500 000 ${String(100 + i)}` : null,
          address: null,
          city: i % 4 === 0 ? 'Wzorcowo' : 'Przykładowo',
          notes: null,
          tags: i < 11 ? ['mieszkańcy'] : i < 15 ? ['wolontariat'] : [],
          roles
        },
        a(120)
      )
      p.push(id)
    }
    const inst: string[] = []
    for (const name of INSTITUTIONS) {
      const { id } = await people.createContact(
        db,
        { kind: 'institution', firstName: null, lastName: null, name, email: null, phone: null, address: null, city: 'Przykładowo', notes: null, tags: [], roles: [] },
        a(120)
      )
      inst.push(id)
    }
    const rel = (contactAId: string, contactBId: string, type: 'works_at' | 'contact_person' | 'guardian', note: string | null = null) =>
      people.addRelationship(db, { contactAId, contactBId, type, note }, a(118))
    await rel(p[23]!, inst[3]!, 'works_at')
    await rel(p[23]!, inst[3]!, 'contact_person', 'Koordynatorka współpracy')
    await rel(p[19]!, inst[1]!, 'works_at')
    await rel(p[24]!, inst[0]!, 'contact_person')
    await rel(p[15]!, inst[2]!, 'contact_person')
    await rel(p[6]!, p[9]!, 'guardian')

    // --- zgody ---
    const consent = (contactId: string, type: 'processing' | 'image' | 'communication', givenAt: string, extra: { basis?: string; validUntil?: string; note?: string } = {}) =>
      people.addConsent(db, { contactId, type, givenAt, basis: extra.basis ?? null, validUntil: extra.validUntil ?? null, note: extra.note ?? null }, a(110))
    for (const i of [0, 1, 2, 3, 4, 6, 12]) await consent(p[i]!, 'processing', day(-110), { basis: 'formularz zgłoszeniowy' })
    await consent(p[1]!, 'image', day(-110), { basis: 'zgoda pisemna' })
    await consent(p[12]!, 'communication', day(-100), { validUntil: day(265) })
    await consent(p[3]!, 'image', day(-110), { note: 'Wycofana telefonicznie' })
    const withdrawn = (await people.getContact(db, p[3]!)).consents.find((c) => c.type === 'image')!
    await people.withdrawConsent(db, { id: withdrawn.id, version: withdrawn.version, at: day(-20) }, a(20))

    // --- tematy ---
    const { id: t1 } = await acts.createTopic(db, { name: 'Pierwsza pomoc w praktyce', description: 'Podstawy pierwszej pomocy', program: '1. Ocena sytuacji\n2. RKO\n3. Pozycja boczna', durationHours: 12 }, a(90))
    await acts.createTopic(db, { name: 'Pisanie wniosków grantowych', description: 'Od pomysłu do wniosku', program: null, durationHours: 8 }, a(90))
    await acts.createTopic(db, { name: 'Rękodzieło regionalne', description: null, program: null, durationHours: 6 }, a(90))

    // --- działania (60 dni temu) ---
    const action = async (title: string, type: ActionType, status: ActionStatus, framework: Framework, start: number | null, end: number | null, extra: { topicId?: string; place?: string } = {}, who = a(60)) =>
      (
        await acts.createAction(
          db,
          {
            title,
            type,
            status,
            framework,
            startDate: start === null ? null : day(start),
            endDate: end === null ? null : day(end),
            place: extra.place ?? 'Świetlica wiejska, Przykładowo',
            topicId: extra.topicId ?? null,
            description: null,
            expectedParticipants: 10
          },
          who
        )
      ).id
    const training = await action('Pierwsza pomoc w praktyce — edycja jesienna', 'training', 'ongoing', 'statutory_free', -14, 3, { topicId: t1 })
    const workshop = await action('Warsztaty rękodzieła', 'workshop', 'planned', 'project', 5, 5)
    const festyn = await action('Festyn rodzinny', 'event', 'planned', 'statutory_free', 20, 20, { place: 'Boisko szkolne' }, b(60))
    const meeting = await action('Spotkanie z partnerami lokalnymi', 'meeting', 'done', 'statutory_free', -30, -30)
    await action('Szkolenie z pisania wniosków', 'training', 'cancelled', 'statutory_paid', -40, -40)
    await action('Zbiórka na wyprawki szkolne', 'fundraiser', 'ongoing', 'statutory_free', -25, 15)
    // kalendarz: wpisy w bieżącym i następnym miesiącu
    await action('Zbiórka świąteczna dla seniorów', 'fundraiser', 'planned', 'statutory_free', 12, 40, { place: 'Sklep spożywczy, Przykładowo' })
    for (const d of [7, 35]) {
      const board = await action('Zebranie zarządu', 'meeting', 'planned', 'statutory_free', d, d, { place: 'Biuro stowarzyszenia' })
      await acts.addSession(db, { actionId: board, date: day(d), startTime: '16:00', endTime: '18:00', leaderContactId: null, note: null }, a(60))
    }
    await action('Dzień seniora', 'event', 'planned', 'statutory_free', 5, 5)

    // szkolenie: 3 zajęcia, 8 uczestników (potwierdzeni), obecność na dwóch odbytych
    for (const d of [-14, -7, 3]) await acts.addSession(db, { actionId: training, date: day(d), startTime: '17:00', endTime: '20:00', leaderContactId: p[19]!, note: null }, a(60))
    const trainees = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => p[i]!)
    for (const c of trainees) await acts.addParticipantById(db, { actionId: training, contactId: c }, a(60))
    for (const part of (await acts.getActionDetail(db, training, new Date())).participants)
      await acts.setParticipantStatus(db, { id: part.id, version: part.version, status: 'confirmed' }, a(59))
    const sessions = (await acts.getActionDetail(db, training, new Date())).sessions
    const marks: AttendanceStatus[][] = [
      ['present', 'present'],
      ['present', 'present'],
      ['present', 'absent'],
      ['present', 'excused'],
      ['absent', 'present'],
      ['present', 'present'],
      ['present', 'present'],
      ['present', 'absent']
    ]
    for (const [i, c] of trainees.entries())
      for (const [s, status] of marks[i]!.entries()) await acts.setAttendance(db, { sessionId: sessions[s]!.id, contactId: c, status, version: null }, a(s === 0 ? 14 : 7))

    // warsztaty: uczestnicy zapisani 45 dni temu; dwie osoby bez kontaktu → „Wymaga uwagi”
    for (const i of [8, 9, 10]) await acts.addParticipantById(db, { actionId: workshop, contactId: p[i]! }, a(45))
    await acts.addSession(db, { actionId: workshop, date: day(5), startTime: '10:00', endTime: '14:00', leaderContactId: p[20]!, note: null }, a(45))
    for (const i of [23, 24, 15]) await acts.addParticipantById(db, { actionId: meeting, contactId: p[i]! }, a(30))

    // --- oś aktywności ---
    const activity = (daysAgo: number, type: 'note' | 'contact' | 'support', content: string, contactIds: string[], extra: { channel?: 'phone' | 'email'; form?: string; durationMinutes?: number; actionId?: string } = {}) =>
      addActivity(
        db,
        {
          type,
          content,
          occurredAt: new Date(base - daysAgo * DAY).toISOString(),
          channel: extra.channel ?? null,
          form: extra.form ?? null,
          durationMinutes: extra.durationMinutes ?? null,
          contactIds,
          actionId: extra.actionId ?? null
        },
        a(daysAgo)
      )
    await activity(10, 'contact', 'Telefon w sprawie terminu warsztatów — potwierdziła udział.', [p[10]!], { channel: 'phone', durationMinutes: 10, actionId: workshop })
    await activity(12, 'support', 'Pomoc w wypełnieniu formularza zgłoszeniowego.', [p[2]!], { form: 'konsultacja', durationMinutes: 60 })
    await activity(5, 'note', 'Prosi o materiały ze szkolenia w wersji drukowanej.', [p[0]!])
    await activity(3, 'contact', 'E-mail z planem festynu.', [p[23]!], { channel: 'email' })
    await activity(20, 'support', 'Doradztwo przy zakładaniu koła zainteresowań.', [p[6]!, p[14]!], { form: 'doradztwo grupowe', durationMinutes: 90 })
    await activity(30, 'note', 'Ustalono podział zadań na festyn.', [p[23]!, p[24]!, p[15]!], { actionId: meeting })

    // --- zadania (część zaległych, część z checklistą) ---
    const task = async (title: string, due: number | null, status: 'todo' | 'doing' | 'done', assignee: string, target: { type: 'contact' | 'action'; id: string } | null, items: string[] = [], who = a(15)) => {
      const { id } = await todo.createTask(
        db,
        {
          title,
          dueDate: due === null ? null : day(due),
          status,
          priority: due !== null && due < 0 ? 'high' : 'normal',
          assigneeUserId: assignee,
          targetType: target?.type ?? null,
          targetId: target?.id ?? null,
          description: null,
          items
        },
        who
      )
      if (items.length) {
        const first = (await todo.getTask(db, id)).items[0]!
        await todo.toggleTaskItem(db, { id: first.id, version: first.version, done: true }, who)
      }
    }
    await task('Wydrukować listy obecności', -2, 'todo', me.id, { type: 'action', id: training }, ['Sprawdzić listę', 'Wydrukować', 'Zanieść na salę'])
    await task('Zadzwonić do sponsora festynu', -5, 'doing', me.id, null)
    await task('Zamówić materiały na warsztaty', 0, 'todo', me.id, { type: 'action', id: workshop }, ['Włóczka', 'Nożyczki', 'Kleje'])
    await task('Przygotować podziękowania dla wolontariuszy', 0, 'todo', me.id, null)
    await task('Rozliczyć zbiórkę — wstępne zestawienie', 10, 'todo', me.id, null)
    await task('Zaktualizować dane kontaktowe instytucji', 7, 'todo', second, null, [], b(15))
    await task('Plakat festynu', 2, 'doing', second, { type: 'action', id: festyn }, ['Projekt', 'Druk'], b(15))
    await task('Umówić salę na festyn', -10, 'done', me.id, null)
    await task('Odpisać Pani Barbarze w sprawie zaświadczenia', 1, 'todo', me.id, { type: 'contact', id: p[1]! })
    await task('Notatka ze spotkania z partnerami', -25, 'done', second, { type: 'action', id: meeting }, [], b(15))

    // ostatnie zmiany (dla „Ostatnio w organizacji”)
    await consent(p[5]!, 'image', day(-1), { basis: 'zgoda pisemna' })
    await task('Potwierdzić ratownika na festyn', 18, 'todo', second, { type: 'action', id: festyn }, [], b(2 / 24))

    console.log(`Dane demonstracyjne założone (tylko lokalnie): ${PEOPLE.length} osób, ${INSTITUTIONS.length} instytucji, działania, zajęcia, obecność, zadania.`)
    console.log(`Zaloguj się kontem ${DEV_EMAIL} (hasło z npm run dev:account).`)
  } finally {
    await close()
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
