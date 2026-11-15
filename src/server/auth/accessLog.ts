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
  | 'key_rotation_started'
  | 'key_rotated'
  | 'reveal_sensitive'
  | 'download_attachment'
  | 'anonymize'
  | 'export'
  | 'backup_create'
  | 'backup_download'

export type AccessTargetType = 'user' | 'contact' | 'attachment' | 'contacts_list' | 'actions_list' | 'participants_list' | 'access_log' | 'backup'

/**
 * `userId` = null: nieudane logowanie na nieznany e-mail. `targetId`: konto, którego dotyczy działanie administratora
 * (`targetType` 'user', domyślnie), albo osoba (`contact`), załącznik (`attachment`), działanie (`participants_list`).
 * Eksport listy bez `targetId` zapisuje samo `targetType` (rodzaj listy, bez filtrów). `db` może być transakcją.
 */
export async function logAccess(
  db: Pick<Db, 'insert'>,
  userId: string | null,
  action: AccessAction,
  at = new Date(),
  targetId?: string,
  targetType?: AccessTargetType
) {
  await db
    .insert(accessLog)
    .values({ id: randomUUID(), userId, action, at, targetType: targetType ?? (targetId ? 'user' : null), targetId: targetId ?? null })
}
