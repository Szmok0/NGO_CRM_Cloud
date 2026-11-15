// Dziennik dostępu: tylko dopisywanie, bez danych osobowych (identyfikatory i nazwa zdarzenia).
import { randomUUID } from 'node:crypto'
import type { Db } from '../db/connection'
import { accessLog } from '../db/schema'

export type AccessAction =
  | 'login'
  | 'login_failed'
  | 'logout'
  | 'logout_all'
  | 'password_changed'
  | 'totp_enabled'
  | 'setup_completed'
  | 'user_invited'
  | 'user_disabled'
  | 'user_reset'
  | 'role_changed'
  | 'invite_accepted'
  | 'grant_access'
  | 'revoke_access'
  | 'key_recovered'

/** `userId` = null: nieudane logowanie na nieznany e-mail. `targetUserId`: konto, którego dotyczy działanie administratora. `db` może być transakcją. */
export async function logAccess(db: Pick<Db, 'insert'>, userId: string | null, action: AccessAction, at = new Date(), targetUserId?: string) {
  await db.insert(accessLog).values({ id: randomUUID(), userId, action, at, targetType: targetUserId ? 'user' : null, targetId: targetUserId ?? null })
}
