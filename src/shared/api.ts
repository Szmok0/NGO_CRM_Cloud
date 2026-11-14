// Kontrakt API (POST /api/rpc z { method, params }): nazwa metody → schemat parametrów (zod, walidowany
// na serwerze), lista ról, które mogą ją wywołać, i czy jest dostępna przed 2FA. Typ wyniku: ApiOutputs.
// Wzór: desktopowe src/shared/ipc.ts.
import { z } from 'zod'
import { KDF_ITERATIONS, authKeySchema, emailSchema, kdfSaltSchema, sealedSchema } from './auth'
import * as d from './domain'
import type { RoleLabels } from './domain'
import type * as T from './types'
import type { ModuleId, Profile } from './modules'

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
  // --- oś aktywności (krok 3; powiązanie z działaniem dojdzie w kroku 4) ---
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
      contactIds: z.array(uuid).min(1).max(200)
    }),
    roles: WRITE
  },
  'activities.delete': { input: ref, roles: WRITE },
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

export interface OrgSettings {
  id: string
  version: number
  orgName: string
  profile: Profile
  enabledModules: ModuleId[]
  roleLabels: RoleLabels
  staleDays: number
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
  'users.disable': void
  'users.reset': InviteLink
  'system.info': { version: string; migrations: number }
  'settings.get': OrgSettings
  'contacts.list': T.ContactListItem[]
  'contacts.tags': string[]
  'contacts.get': T.ContactDetail
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
  'search.global': T.SearchHit[]
}

export type ApiResult<M extends Method> = { ok: true; data: ApiOutputs[M] } | { ok: false; code: string; message: string }

/** Treść żądania POST /api/rpc. */
export const rpcRequest = z.object({ method: z.string().min(1).max(100), params: z.unknown().optional() })
