// Kontrakt API (POST /api/rpc z { method, params }): nazwa metody → schemat parametrów (zod, walidowany
// na serwerze), lista ról, które mogą ją wywołać, i czy jest dostępna przed 2FA. Typ wyniku: ApiOutputs.
// Wzór: desktopowe src/shared/ipc.ts.
import { z } from 'zod'

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

export const apiMethods = {
  /** Kim jestem w tej sesji (także przed 2FA: klient wie, że ma pokazać konfigurację 2FA). */
  'auth.me': { input: none, roles: ALL, before2fa: true },
  /** Wylogowanie tej sesji (także przed 2FA). */
  'auth.logout': { input: none, roles: ALL, before2fa: true },
  /** „Wyloguj wszędzie”: koniec wszystkich sesji tej osoby. */
  'auth.logoutAll': { input: none, roles: ALL },
  /** Dane techniczne instancji (wersja, migracje). Bez danych organizacji. */
  'system.info': { input: none, roles: ['admin'] }
} satisfies Record<string, MethodSpec>

export type Method = keyof typeof apiMethods
export type ApiInput<M extends Method> = z.input<(typeof apiMethods)[M]['input']>
export type ApiParsed<M extends Method> = z.output<(typeof apiMethods)[M]['input']>

export interface ApiOutputs {
  'auth.me': { userId: string; role: Role; totpVerified: boolean }
  'auth.logout': void
  'auth.logoutAll': void
  'system.info': { version: string; migrations: number }
}

export type ApiResult<M extends Method> = { ok: true; data: ApiOutputs[M] } | { ok: false; code: string; message: string }

/** Treść żądania POST /api/rpc. */
export const rpcRequest = z.object({ method: z.string().min(1).max(100), params: z.unknown().optional() })
