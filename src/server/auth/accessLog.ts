// Dziennik dostępu: tylko dopisywanie, bez danych osobowych (identyfikatory i nazwa zdarzenia).
import { randomUUID } from 'node:crypto'
import type { Db } from '../db/connection'
import { accessLog } from '../db/schema'

export type AccessAction = 'login' | 'login_failed' | 'logout' | 'logout_all' | 'password_changed' | 'totp_enabled' | 'user_invited' | 'user_disabled'

/** `userId` = null: nieudane logowanie na nieznany e-mail. */
export async function logAccess(db: Db, userId: string | null, action: AccessAction, at = new Date()) {
  await db.insert(accessLog).values({ id: randomUUID(), userId, action, at })
}
