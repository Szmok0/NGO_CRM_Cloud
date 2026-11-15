// Kontrakt API (POST /api/rpc z { method, params }): nazwa metody → schemat parametrów (zod, walidowany
// na serwerze), lista ról, które mogą ją wywołać, i czy jest dostępna przed 2FA. Typ wyniku: ApiOutputs.
// Wzór: desktopowe src/shared/ipc.ts.
import { z } from 'zod'
import { KDF_ITERATIONS, authKeySchema, emailSchema, kdfSaltSchema, sealedSchema } from './auth'
import * as d from './domain'
import type { RoleLabels } from './domain'
import type * as T from './types'
import { PROFILES, type ModuleId, type Profile } from './modules'
import type { CalendarData } from './calendar'

export const ROLES = ['admin', 'staff', 'readonly'] as const
export type Role = (typeof ROLES)[number]

export interface MethodSpec {
  input: z.ZodType
  /** Role, które mogą wywołać metodę. Wymagane i niepuste: metoda bez ról nie przejdzie typecheck. */
  roles: readonly [Role, ...Role[]]
  /** Dostępna z sesją bez potwierdzonego 2FA (tylko konfiguracja 2FA i wylogowanie). */
  before2fa?: true
}

const none = z.object({}).optional()
const ALL = ['admin', 'staff', 'readonly'] as const
const totpCode = z.string().max(20)
const role = z.enum(ROLES)
/** Rekord wskazany do zmiany: id i wersja, którą widział klient (blokada optymistyczna). */
const target = { id: z.uuid(), version: z.number().int().positive() }
const ADMIN = ['admin'] as const
/** Zapisy domenowe: administrator i pracownik (D4). Odczyt: wszystkie role. */
const WRITE = ['admin', 'staff'] as const

// Pola formularzy (jak w desktopowym ipc.ts). Tekst opcjonalny: pusty → null.
const opt = z
  .string()
  .trim()
  .max(10_000)
  .nullish()
  .transform((v) => (v ? v : null))
const short = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null))
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const optDay = day
  .nullish()
  .or(z.literal(''))
  .transform((v) => (v ? v : null))
const uuid = z.uuid()
const version = z.number().int().positive()
/** Rekord do usunięcia: id i wersja, którą widział klient. */
const ref = z.object({ id: uuid, version })
/** Klucz organizacji zaszyfrowany kluczem publicznym osoby (RSA-OAEP, base64), jak slot w kreatorze. */
const wrappedKeySchema = z.string().max(1000).regex(/^[A-Za-z0-9+/]+=*$/)
/** Największy szyfrogram danych wrażliwych osoby (base64); JSON pięciu pól (D1) jest dużo mniejszy. */
export const SENSITIVE_MAX_CIPHERTEXT = 65_536

const identityFields = {
  firstName: short(100),
  lastName: short(100),
  name: short(255),
  email: short(254),
  phone: short(50),
  address: short(255),
  city: short(100),
  notes: opt
}
const tags = z.array(z.string().trim().min(1).max(60)).max(30).default([])
const optTime = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
  .nullish()
  .or(z.literal(''))
  .transform((v) => (v ? v : null))
const optInt = z.number().int().min(0).max(1_000_000).nullish().transform((v) => v ?? null)

const topicFields = { name: z.string().trim().min(1).max(255), description: opt, program: opt, durationHours: optInt }
const actionFields = {
  type: z.enum(d.ACTION_TYPES),
  framework: z.enum(d.FRAMEWORKS),
  title: z.string().trim().min(1).max(255),
  status: z.enum(d.ACTION_STATUSES),
  startDate: optDay,
  endDate: optDay,
  place: short(255),
  topicId: uuid.nullish().or(z.literal('')).transform((v) => (v ? v : null)),
  description: opt,
  expectedParticipants: optInt
}
const taskFields = {
  title: z.string().trim().min(1).max(255),
  dueDate: optDay,
  assigneeUserId: uuid.nullish().or(z.literal('')).transform((v) => (v ? v : null)),
  status: z.enum(d.TASK_STATUSES),
  priority: z.enum(d.PRIORITIES),
  targetType: z
    .enum(d.TARGET_TYPES)
    .nullish()
    .transform((v) => v ?? null),
  targetId: uuid.nullish().or(z.literal('')).transform((v) => (v ? v : null)),
  description: opt
}
const sessionFields = { date: day, startTime: optTime, endTime: optTime, leaderContactId: uuid.nullish().or(z.literal('')).transform((v) => (v ? v : null)), note: opt }

export const apiMethods = {
  /** Kim jestem w tej sesji (także przed 2FA: klient wie, że ma pokazać konfigurację 2FA). */
  'auth.me': { input: none, roles: ALL, before2fa: true },
  /** Dane własnego konta (także przed 2FA: klient wie, czy pokazać konfigurację 2FA). */
  'auth.account': { input: none, roles: ALL, before2fa: true },
  /** Konfiguracja 2FA: nowy sekret z kodem QR (tylko gdy 2FA nie jest jeszcze włączone). */
  'auth.totpSetup.start': { input: none, roles: ALL, before2fa: true },
  /** Konfiguracja 2FA: potwierdzenie pierwszym kodem; włącza 2FA i daje pełną sesję. */
  'auth.totpSetup.confirm': { input: z.object({ code: totpCode }), roles: ALL, before2fa: true },
  /** Zaszyfrowany klucz prywatny i parametry KDF (odszyfrowanie tylko w przeglądarce). */
  'auth.keys': { input: none, roles: ALL },
  /** Zmiana hasła: obecny authKey, świeży kod TOTP, nowy authKey i klucz prywatny przeszyfrowany w przeglądarce. */
  'auth.changePassword': {
    input: z.object({
      currentAuthKey: authKeySchema,
      totpCode,
      newAuthKey: authKeySchema,
      newKdfSalt: kdfSaltSchema,
      newKdfIterations: z.literal(KDF_ITERATIONS),
      newPrivateKeyEnc: sealedSchema.optional()
    }),
    roles: ALL
  },
  /** Wylogowanie tej sesji (także przed 2FA). */
  'auth.logout': { input: none, roles: ALL, before2fa: true },
  /** „Wyloguj wszędzie”: koniec wszystkich sesji tej osoby. */
  'auth.logoutAll': { input: none, roles: ALL },
  /** Lista użytkowników programu (bez haseł i kluczy). */
  'users.list': { input: none, roles: ADMIN },
  /** Zaproszenie nowej osoby: zakłada konto w stanie „zaproszone” i zwraca jednorazowy token do linku (72 h). */
  'users.invite': { input: z.object({ email: emailSchema, role }), roles: ADMIN },
  'users.setRole': { input: z.object({ ...target, role }), roles: ADMIN },
  /** Wyłączenie konta: koniec sesji, usunięcie slotów klucza. */
  'users.disable': { input: z.object(target), roles: ADMIN },
  /** Reset konta (zapomniane hasło, ponowne zaproszenie, przywrócenie wyłączonego): nowy jednorazowy token. */
  'users.reset': { input: z.object(target), roles: ADMIN },
  /** Sloty zalogowanej osoby do niewycofanych wersji klucza organizacji (otwiera je tylko przeglądarka). */
  'keys.mySlots': { input: none, roles: ALL },
  /** Slot odzyskiwania bieżącej wersji klucza, tylko dla administratora bez slotu do niej (D10). */
  'keys.recoverySlot': { input: none, roles: ADMIN },
  /** Zapis własnego slotu po otwarciu slotu odzyskiwania w przeglądarce (D10). */
  'keys.recover': { input: z.object({ keyVersion: version, wrappedKey: wrappedKeySchema }), roles: ADMIN },
  /** Kto ma dostęp do danych wrażliwych; klucze publiczne aktywnych kont do nadawania dostępu. */
  'access.list': { input: none, roles: ADMIN },
  /** Nadanie dostępu: sloty do wszystkich niewycofanych wersji klucza, zrobione w przeglądarce administratora (D8). */
  'access.grant': {
    input: z.object({ userId: uuid, slots: z.array(z.object({ keyVersion: version, wrappedKey: wrappedKeySchema })).min(1).max(10) }),
    roles: ADMIN
  },
  /** Odebranie dostępu: usunięcie slotów i koniec sesji tej osoby (D8). */
  'access.revoke': { input: z.object({ userId: uuid }), roles: ADMIN },
  /** Dane techniczne instancji (wersja, migracje). Bez danych organizacji. */
  'system.info': { input: none, roles: ['admin'] },
  /** Ustawienia organizacji potrzebne interfejsowi (moduły, nazwy ról). */
  'settings.get': { input: none, roles: ALL },

  // --- osoby i instytucje (ZADANIE_02, krok 2) ---
  'contacts.list': {
    input: z
      .object({
        kind: z.enum(['person', 'institution', 'all']).default('all'),
        role: z.enum(d.ROLES).nullish(),
        tag: z.string().max(60).nullish(),
        q: z.string().max(200).nullish()
      })
      .default({ kind: 'all' }),
    roles: ALL
  },
  'contacts.tags': { input: none, roles: ALL },
  'contacts.get': { input: z.object({ id: uuid }), roles: ALL },
  /** Szyfrogram danych wrażliwych osoby; tylko ze slotem do jego wersji klucza, wpis `reveal_sensitive` (D3, D6). */
  'sensitive.reveal': { input: z.object({ contactId: uuid }), roles: ALL },
  /**
   * Zapis danych wrażliwych zaszyfrowanych w przeglądarce bieżącą wersją klucza (D1, D3). `version` = null: pierwszy zapis.
   */
  'sensitive.save': {
    input: z.object({
      contactId: uuid,
      version: version.nullable(),
      keyVersion: version,
      iv: z.string().length(16).regex(/^[A-Za-z0-9+/]+=*$/),
      ciphertext: z.string().min(1).max(SENSITIVE_MAX_CIPHERTEXT).regex(/^[A-Za-z0-9+/]+=*$/)
    }),
    roles: WRITE
  },
  /** Możliwe duplikaty po imieniu i nazwisku, e-mailu lub telefonie (sprawdzane przy zakładaniu osoby). */
  'contacts.duplicates': {
    input: z.object({ firstName: short(100), lastName: short(100), email: short(254), phone: short(50), excludeId: uuid.nullish() }),
    roles: ALL
  },
  'contacts.create': { input: z.object({ kind: z.enum(d.CONTACT_KINDS), ...identityFields, tags, roles: z.array(z.enum(d.ROLES)).max(8).default([]) }), roles: WRITE },
  /** `version` kontaktu i `identityVersion` tożsamości: obie sprawdzane (blokada optymistyczna). */
  'contacts.update': { input: z.object({ id: uuid, version, identityVersion: version, ...identityFields, tags }), roles: WRITE },
  'contacts.delete': { input: ref, roles: WRITE },
  'roles.add': { input: z.object({ contactId: uuid, role: z.enum(d.ROLES), since: optDay, note: opt }), roles: WRITE },
  'roles.end': { input: z.object({ id: uuid, version, until: day }), roles: WRITE },
  'roles.delete': { input: ref, roles: WRITE },
  'relationships.add': { input: z.object({ contactAId: uuid, contactBId: uuid, type: z.enum(d.RELATIONSHIP_TYPES), note: opt }), roles: WRITE },
  'relationships.delete': { input: ref, roles: WRITE },
  'consents.add': {
    input: z.object({ contactId: uuid, type: z.enum(d.CONSENT_TYPES), basis: short(255), givenAt: day, validUntil: optDay, note: opt }),
    roles: WRITE
  },
  'consents.withdraw': { input: z.object({ id: uuid, version, at: day }), roles: WRITE },
  'consents.delete': { input: ref, roles: WRITE },
  // --- oś aktywności (krok 3) ---
  'activities.add': {
    input: z.object({
      type: z.enum(['note', 'contact', 'support']),
      channel: z
        .enum(d.CHANNELS)
        .nullish()
        .transform((v) => v ?? null),
      form: short(255),
      durationMinutes: z
        .number()
        .int()
        .min(0)
        .max(24 * 60)
        .nullish()
        .transform((v) => v ?? null),
      occurredAt: z.iso.datetime(),
      content: z.string().trim().min(1).max(20_000),
      contactIds: z.array(uuid).max(500),
      /** wpis przy działaniu (wtedy osoby mogą być puste) */
      actionId: uuid.nullish().transform((v) => v ?? null)
    }).refine((i) => i.contactIds.length > 0 || i.actionId, { message: 'Wpis musi dotyczyć osoby albo działania' }),
    roles: WRITE
  },
  'activities.delete': { input: ref, roles: WRITE },
  // --- tematy szkoleń i działania (krok 4) ---
  'topics.list': { input: none, roles: ALL },
  'topics.get': { input: z.object({ id: uuid }), roles: ALL },
  'topics.create': { input: z.object(topicFields), roles: WRITE },
  'topics.update': { input: z.object({ id: uuid, version, ...topicFields }), roles: WRITE },
  'topics.delete': { input: ref, roles: WRITE },
  'actions.list': {
    input: z
      .object({
        type: z.enum(d.ACTION_TYPES).nullish(),
        status: z.enum(d.ACTION_STATUSES).nullish(),
        framework: z.enum(d.FRAMEWORKS).nullish(),
        from: day.nullish(),
        to: day.nullish(),
        q: z.string().max(200).nullish()
      })
      .default({}),
    roles: ALL
  },
  'actions.get': { input: z.object({ id: uuid }), roles: ALL },
  'actions.create': { input: z.object(actionFields), roles: WRITE },
  /** Zmiana statusu dopisuje wpis systemowy na osi działania. */
  'actions.update': { input: z.object({ id: uuid, version, ...actionFields }), roles: WRITE },
  'actions.delete': { input: ref, roles: WRITE },
  'participants.add': { input: z.object({ actionId: uuid, contactId: uuid }), roles: WRITE },
  'participants.setStatus': { input: z.object({ id: uuid, version, status: z.enum(d.PARTICIPANT_STATUSES) }), roles: WRITE },
  'participants.remove': { input: ref, roles: WRITE },
  /** Podgląd wklejonej listy: dopasowanie do osób w bazie po imieniu i nazwisku (bez zapisu). */
  'participants.previewPaste': { input: z.object({ actionId: uuid, text: z.string().max(100_000) }), roles: WRITE },
  /** Zapis wklejonej listy: istniejące osoby (`contactId`) albo nowe (uczestnik). */
  'participants.applyPaste': {
    input: z.object({
      actionId: uuid,
      rows: z
        .array(z.object({ firstName: z.string().trim().min(1).max(100), lastName: z.string().trim().min(1).max(100), email: short(254), phone: short(50), contactId: uuid.nullable() }))
        .max(500)
    }),
    roles: WRITE
  },
  'sessions.add': { input: z.object({ actionId: uuid, ...sessionFields }), roles: WRITE },
  'sessions.update': { input: z.object({ id: uuid, version, ...sessionFields }), roles: WRITE },
  'sessions.delete': { input: ref, roles: WRITE },
  /**
   * Obecność; `status` null = wyczyść. `version`: wersja zaznaczenia, które widział klient (null = nie było zaznaczenia).
   * Inna niż w bazie → VERSION_CONFLICT.
   */
  'attendance.set': {
    input: z.object({ sessionId: uuid, contactId: uuid, status: z.enum(d.ATTENDANCE_STATUSES).nullable(), version: version.nullable() }),
    roles: WRITE
  },
  // --- zadania (krok 5) ---
  /** Aktywni użytkownicy (imię i id) do przypisywania zadań; bez e-maili i ról. */
  'users.options': { input: none, roles: ALL },
  'tasks.list': {
    input: z
      .object({ mine: z.boolean().default(false), targetType: z.enum(d.TARGET_TYPES).nullish(), targetId: uuid.nullish() })
      .default({ mine: false }),
    roles: ALL
  },
  'tasks.get': { input: z.object({ id: uuid }), roles: ALL },
  'tasks.create': { input: z.object({ ...taskFields, items: z.array(z.string().trim().min(1).max(500)).max(100).default([]) }), roles: WRITE },
  'tasks.update': { input: z.object({ id: uuid, version, ...taskFields }), roles: WRITE },
  /** Zmiana kolumny w kanbanie / odhaczenie na „Dziś”. */
  'tasks.move': { input: z.object({ id: uuid, version, status: z.enum(d.TASK_STATUSES) }), roles: WRITE },
  'tasks.delete': { input: ref, roles: WRITE },
  'taskItems.add': { input: z.object({ taskId: uuid, label: z.string().trim().min(1).max(500) }), roles: WRITE },
  'taskItems.toggle': { input: z.object({ id: uuid, version, done: z.boolean() }), roles: WRITE },
  'taskItems.delete': { input: ref, roles: WRITE },
  // --- „Dziś”, kalendarz, kosz, ustawienia organizacji (krok 6) ---
  'today.get': { input: none, roles: ALL },
  /** Licznik przy „Zadaniach” w menu: moje niezrobione zadania zaległe i na dziś. */
  'today.counter': { input: none, roles: ALL },
  'calendar.entries': {
    input: z.object({ from: day, to: day }).refine((r) => r.from <= r.to && Date.parse(r.to) - Date.parse(r.from) <= 400 * 86_400_000, { message: 'Zakres do ok. 13 miesięcy' }),
    roles: ALL
  },
  'trash.list': { input: none, roles: ALL },
  'trash.restore': { input: z.object({ entity: z.enum(['contacts', 'actions', 'tasks', 'topics']), id: uuid, version }), roles: WRITE },
  /** Ustawienia organizacji (tylko administrator, D4). */
  'settings.update': {
    input: z.object({
      version,
      orgName: z.string().trim().min(1).max(200),
      profile: z.enum(PROFILES),
      enabledModules: z.array(z.string().max(32)).max(20),
      roleLabels: z.partialRecord(z.enum(d.ROLES), z.string().trim().max(40)),
      staleDays: z.number().int().min(1).max(3650),
      /** Brak = bez zmiany. Wyłączenie ukrywa pola, dane zostają (D2). */
      sensitiveFieldsEnabled: z.boolean().optional()
    }),
    roles: ADMIN
  },
  /** Wyszukiwarka w pasku górnym (od 2 znaków; po tożsamości, nie po danych wrażliwych). */
  'search.global': { input: z.object({ q: z.string().max(200) }), roles: ALL }
} satisfies Record<string, MethodSpec>

export type Method = keyof typeof apiMethods
export type ApiInput<M extends Method> = z.input<(typeof apiMethods)[M]['input']>
export type ApiParsed<M extends Method> = z.output<(typeof apiMethods)[M]['input']>

export interface UserListItem {
  id: string
  version: number
  name: string
  email: string
  role: Role
  status: 'invited' | 'active' | 'disabled'
  totpEnabled: boolean
  /** ISO 8601 (UTC) albo null. */
  lastLoginAt: string | null
  /** Do kiedy ważny jest niewykorzystany link z zaproszenia (ISO 8601) albo null. */
  inviteExpiresAt: string | null
}
/** Token do jednorazowego linku; klient składa z niego adres `#zaproszenie=TOKEN`. */
export interface InviteLink {
  token: string
  expiresAt: string
}

export interface KeySlotItem {
  keyVersion: number
  wrappedKey: string
}
export interface AccessListItem {
  userId: string
  /** Ma slot do bieżącej wersji klucza organizacji. */
  hasAccess: boolean
  /** Klucz publiczny (SPKI, base64) aktywnego konta; null: konto nieaktywne albo bez kluczy. */
  publicKey: string | null
}

export interface OrgSettings {
  id: string
  version: number
  orgName: string
  profile: Profile
  enabledModules: ModuleId[]
  roleLabels: RoleLabels
  staleDays: number
  /** Pola wrażliwe na karcie osoby (D2). */
  sensitiveFieldsEnabled: boolean
}

/** Szyfrogram danych wrażliwych osoby; otwiera go tylko przeglądarka kluczem organizacji w wersji `keyVersion`. */
export interface SensitiveCipher {
  /** Wersja rekordu (do zapisu). */
  version: number
  keyVersion: number
  iv: string
  ciphertext: string
}

export interface ApiOutputs {
  'auth.me': { userId: string; role: Role; totpVerified: boolean }
  'auth.account': { email: string; name: string; totpEnabled: boolean; orgName: string }
  'auth.totpSetup.start': { secret: string; otpauthUrl: string; qrSvg: string }
  'auth.totpSetup.confirm': void
  'auth.keys': { kdfSalt: string; kdfIterations: number; publicKey: string | null; privateKeyEnc: string | null }
  'auth.changePassword': void
  'auth.logout': void
  'auth.logoutAll': void
  'users.list': UserListItem[]
  'users.invite': InviteLink
  'users.setRole': void
  /** `hadAccess`: konto miało slot klucza (propozycja zmiany klucza organizacji, D8). */
  'users.disable': { hadAccess: boolean }
  'users.reset': InviteLink & { hadAccess: boolean }
  'keys.mySlots': KeySlotItem[]
  'keys.recoverySlot': { keyVersion: number; recoverySlot: string }
  'keys.recover': void
  'access.list': AccessListItem[]
  'access.grant': void
  'access.revoke': { hadAccess: boolean }
  'system.info': { version: string; migrations: number }
  'settings.get': OrgSettings
  'contacts.list': T.ContactListItem[]
  'contacts.tags': string[]
  'contacts.get': T.ContactDetail
  'sensitive.reveal': SensitiveCipher
  'sensitive.save': { version: number }
  'contacts.duplicates': T.ContactListItem[]
  'contacts.create': { id: string }
  'contacts.update': void
  'contacts.delete': void
  'roles.add': void
  'roles.end': void
  'roles.delete': void
  'relationships.add': void
  'relationships.delete': void
  'consents.add': void
  'consents.withdraw': void
  'consents.delete': void
  'activities.add': void
  'activities.delete': void
  'topics.list': T.Topic[]
  'topics.get': T.TopicDetail
  'topics.create': { id: string }
  'topics.update': void
  'topics.delete': void
  'actions.list': T.ActionListItem[]
  'actions.get': T.ActionDetail
  'actions.create': { id: string }
  'actions.update': void
  'actions.delete': void
  'participants.add': void
  'participants.setStatus': void
  'participants.remove': void
  'participants.previewPaste': T.PastePreviewRow[]
  'participants.applyPaste': { added: number; created: number }
  'sessions.add': void
  'sessions.update': void
  'sessions.delete': void
  'attendance.set': void
  'users.options': T.UserOption[]
  'tasks.list': T.TaskListItem[]
  'tasks.get': T.TaskDetail
  'tasks.create': { id: string }
  'tasks.update': void
  'tasks.move': void
  'tasks.delete': void
  'taskItems.add': void
  'taskItems.toggle': void
  'taskItems.delete': void
  'today.get': T.TodayData
  'today.counter': number
  'calendar.entries': CalendarData
  'trash.list': T.TrashItem[]
  'trash.restore': void
  'settings.update': void
  'search.global': T.SearchHit[]
}

export type ApiResult<M extends Method> = { ok: true; data: ApiOutputs[M] } | { ok: false; code: string; message: string }

/** Treść żądania POST /api/rpc. */
export const rpcRequest = z.object({ method: z.string().min(1).max(100), params: z.unknown().optional() })
