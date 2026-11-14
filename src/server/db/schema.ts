import { mysqlTable, varchar, text, char, datetime, int, bigint, boolean, json, index, uniqueIndex } from 'drizzle-orm/mysql-core'

// ---------- Kolumny wspólne tabel domenowych (zasada danych 1) ----------

/** Pola techniczne każdej tabeli domenowej. Ustawia je wyłącznie warstwa zapisu (repo.ts). */
export const domainColumns = () => ({
  id: char('id', { length: 36 }).primaryKey(),
  createdAt: datetime('created_at', { mode: 'date', fsp: 3 }).notNull(),
  updatedAt: datetime('updated_at', { mode: 'date', fsp: 3 }).notNull(),
  updatedBy: char('updated_by', { length: 36 }).notNull(),
  deletedAt: datetime('deleted_at', { mode: 'date', fsp: 3 }),
  version: int('version').notNull()
})

// ---------- Techniczne ----------

/** Dane techniczne instancji (klucz → wartość), np. data instalacji. Bez danych osobowych. */
export const appMeta = mysqlTable('app_meta', {
  key: varchar('key', { length: 64 }).primaryKey(),
  value: text('value').notNull()
})

// ---------- Dostęp (model danych 2.2, bezpieczeństwo rozdział 5) ----------

/**
 * Użytkownicy programu. Hasła brak: serwer zna tylko skrót `authKey` (scrypt). Pola uwierzytelniania puste,
 * dopóki osoba nie ustawi hasła (zaproszenie / kreator).
 */
export const users = mysqlTable(
  'users',
  {
    ...domainColumns(),
    email: varchar('email', { length: 254 }).notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    /** 'admin' | 'staff' | 'readonly' */
    role: varchar('role', { length: 16 }).notNull(),
    /** 'invited' | 'active' | 'disabled' */
    status: varchar('status', { length: 16 }).notNull(),
    /** Sól i liczba iteracji PBKDF2 w przeglądarce (base64, 16 B; 600 000). */
    kdfSalt: varchar('kdf_salt', { length: 64 }),
    kdfIterations: int('kdf_iterations'),
    /** scrypt(authKey) w zapisie „scrypt$N$r$p$sól$skrót” (parametry i sól serwera w jednym polu). */
    authHash: varchar('auth_hash', { length: 255 }),
    /** Sekret TOTP zaszyfrowany kluczem z APP_SECRET (AES-256-GCM). */
    totpSecretEnc: varchar('totp_secret_enc', { length: 255 }),
    totpEnabledAt: datetime('totp_enabled_at', { mode: 'date', fsp: 3 }),
    /** Ostatnie użyte okno TOTP (blokada ponownego użycia kodu). */
    totpLastStep: bigint('totp_last_step', { mode: 'number' }),
    failedAttempts: int('failed_attempts').notNull().default(0),
    lockedUntil: datetime('locked_until', { mode: 'date', fsp: 3 }),
    /** Klucz publiczny RSA-OAEP (jawny) i prywatny zaszyfrowany `wrapKey` w przeglądarce. */
    publicKey: text('public_key'),
    privateKeyEnc: text('private_key_enc'),
    lastLoginAt: datetime('last_login_at', { mode: 'date', fsp: 3 })
  },
  (t) => [uniqueIndex('users_email_uq').on(t.email)]
)

/** Sesje logowania. W bazie tylko skrót SHA-256 tokenu z ciasteczka; bez IP. */
export const authSessions = mysqlTable(
  'auth_sessions',
  {
    id: char('id', { length: 36 }).primaryKey(),
    tokenHash: char('token_hash', { length: 64 }).notNull(),
    userId: char('user_id', { length: 36 })
      .notNull()
      .references(() => users.id),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 }).notNull(),
    lastSeenAt: datetime('last_seen_at', { mode: 'date', fsp: 3 }).notNull(),
    expiresAt: datetime('expires_at', { mode: 'date', fsp: 3 }).notNull(),
    /** Czy w tej sesji potwierdzono kod TOTP. */
    mfaPassed: boolean('mfa_passed').notNull(),
    /** Skrót SHA-256 nagłówka User-Agent (do listy sesji), bez pełnej wartości. */
    userAgentHash: char('user_agent_hash', { length: 64 })
  },
  (t) => [uniqueIndex('auth_sessions_token_uq').on(t.tokenHash), index('auth_sessions_user_idx').on(t.userId)]
)

/** Wersje klucza organizacji: same metadane. Klucz istnieje tylko w slotach, zaszyfrowany; serwer go nie zna. */
export const orgKeys = mysqlTable('org_keys', {
  version: int('version').primaryKey(),
  createdAt: datetime('created_at', { mode: 'date', fsp: 3 }).notNull(),
  createdBy: char('created_by', { length: 36 }).notNull(),
  retiredAt: datetime('retired_at', { mode: 'date', fsp: 3 })
})

/**
 * Sloty: klucz organizacji zaszyfrowany w przeglądarce kluczem publicznym osoby (RSA-OAEP)
 * albo kluczem odzyskiwania (`userId` = null). Serwer tylko przechowuje.
 * UNIQUE nie obejmuje wierszy z `userId` = null: jeden slot odzyskiwania na wersję pilnuje kod zapisu.
 */
export const keySlots = mysqlTable(
  'key_slots',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('user_id', { length: 36 }).references(() => users.id),
    keyVersion: int('key_version')
      .notNull()
      .references(() => orgKeys.version),
    wrappedKey: text('wrapped_key').notNull(),
    grantedBy: char('granted_by', { length: 36 }).notNull(),
    grantedAt: datetime('granted_at', { mode: 'date', fsp: 3 }).notNull()
  },
  (t) => [uniqueIndex('key_slots_user_version_uq').on(t.userId, t.keyVersion)]
)

/** Dziennik dostępu: kto i kiedy (logowanie, wylogowanie, odsłonięcia…). Bez danych osobowych; tylko dopisywanie. */
export const accessLog = mysqlTable(
  'access_log',
  {
    id: char('id', { length: 36 }).primaryKey(),
    /** null: nieudane logowanie na nieznany e-mail. */
    userId: char('user_id', { length: 36 }),
    /** 'login' | 'login_failed' | 'logout' | 'logout_all' | 'password_changed' | 'totp_enabled' | 'user_invited' | 'user_disabled' | … */
    action: varchar('action', { length: 32 }).notNull(),
    targetType: varchar('target_type', { length: 32 }),
    targetId: char('target_id', { length: 36 }),
    at: datetime('at', { mode: 'date', fsp: 3 }).notNull()
  },
  (t) => [index('access_log_user_idx').on(t.userId), index('access_log_at_idx').on(t.at)]
)

/** Dziennik zmian: każdy zapis domenowy przez repo.ts. Tylko dopisywanie. */
export const changeLog = mysqlTable(
  'change_log',
  {
    id: char('id', { length: 36 }).primaryKey(),
    entity: varchar('entity', { length: 64 }).notNull(),
    entityId: char('entity_id', { length: 36 }).notNull(),
    /** 'insert' | 'update' | 'delete' | 'restore' | 'anonymize' */
    op: varchar('op', { length: 16 }).notNull(),
    changedFields: json('changed_fields').notNull(),
    userId: char('user_id', { length: 36 }).notNull(),
    at: datetime('at', { mode: 'date', fsp: 3 }).notNull()
  },
  (t) => [index('change_log_entity_idx').on(t.entity, t.entityId), index('change_log_at_idx').on(t.at)]
)
