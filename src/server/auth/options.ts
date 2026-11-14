import type { IpLimiter } from './lockout'
import type { ScryptParams } from './password'

/** Ustawienia logowania przekazywane do buildApp (trasy /api/auth/… i metody auth.* w RPC). */
export interface AuthOptions {
  appSecret: string
  /** Zegar (testy). */
  now?: () => Date
  /** Parametry scrypt (testy: tańsze). */
  scryptParams?: ScryptParams
  ipLimiter?: IpLimiter
}
