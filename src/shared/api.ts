// Kontrakt API (POST /api/rpc z { method, params }): nazwa metody → schemat parametrów (zod, walidowany
// na serwerze), lista ról, które mogą ją wywołać, i czy jest dostępna przed 2FA. Typ wyniku: ApiOutputs.
// Wzór: desktopowe src/shared/ipc.ts.
import { z } from 'zod'
import { KDF_ITERATIONS, authKeySchema, emailSchema, kdfSaltSchema, sealedSchema } from './auth'

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
  'system.info': { input: none, roles: ['admin'] }
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
}

export type ApiResult<M extends Method> = { ok: true; data: ApiOutputs[M] } | { ok: false; code: string; message: string }

/** Treść żądania POST /api/rpc. */
export const rpcRequest = z.object({ method: z.string().min(1).max(100), params: z.unknown().optional() })
