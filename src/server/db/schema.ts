import { mysqlTable, varchar, text, mediumtext, char, datetime, date, int, bigint, boolean, json, index, uniqueIndex } from 'drizzle-orm/mysql-core'

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

/**
 * Ustawienia organizacji: jeden wiersz o stałym id (SETTINGS_ID w auth/setup.ts), zakładany przez kreator.
 * Stałe id jest też zabezpieczeniem: dwa równoczesne kreatory nie założą dwóch organizacji.
 */
export const settings = mysqlTable('settings', {
  ...domainColumns(),
  orgName: varchar('org_name', { length: 200 }).notNull(),
  /** 'kgw' | 'donors' | 'projects' | 'custom' */
  profile: varchar('profile', { length: 16 }).notNull(),
  enabledModules: json('enabled_modules').$type<string[]>().notNull(),
  /** Własne nazwy ról kontaktów (np. „uczestnik” → „podopieczny”); puste = domyślne. */
  roleLabels: json('role_labels').$type<Record<string, string>>().notNull(),
  staleDays: int('stale_days').notNull().default(30),
  /** Pola wrażliwe na karcie osoby; domyślnie wyłączone, włącza administrator (ZADANIE_03, D2). */
  sensitiveFieldsEnabled: boolean('sensitive_fields_enabled').notNull().default(false),
  retentionMonths: int('retention_months'),
  /** Wylogowanie po bezczynności (15–120 min). Na razie sesje używają stałych 30 min. */
  idleLogoutMinutes: int('idle_logout_minutes').notNull().default(30)
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

/**
 * Zaproszenia: jednorazowy link do ustawienia hasła, 2FA i pary kluczy (nowa osoba albo reset konta).
 * W bazie tylko skrót tokenu z linku. Konto (`users`, status `invited`) istnieje od chwili zaproszenia.
 */
export const invitations = mysqlTable(
  'invitations',
  {
    id: char('id', { length: 36 }).primaryKey(),
    tokenHash: char('token_hash', { length: 64 }).notNull(),
    userId: char('user_id', { length: 36 })
      .notNull()
      .references(() => users.id),
    invitedBy: char('invited_by', { length: 36 }).notNull(),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 }).notNull(),
    expiresAt: datetime('expires_at', { mode: 'date', fsp: 3 }).notNull(),
    usedAt: datetime('used_at', { mode: 'date', fsp: 3 })
  },
  (t) => [uniqueIndex('invitations_token_uq').on(t.tokenHash), index('invitations_user_idx').on(t.userId)]
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

// ---------- Osoby i instytucje (ZADANIE_02, krok 2; model danych 2.3) ----------
// Klucze obce z ON DELETE RESTRICT (D3); usuwanie i tak jest oznaczeniem `deletedAt`.
const contactFk = () => ({ onDelete: 'restrict' as const })

/** Kontakt bez danych identyfikujących (zasada danych 4). Pozostałe tabele znają osobę tylko przez `contacts.id`. */
export const contacts = mysqlTable('contacts', {
  ...domainColumns(),
  /** 'person' | 'institution' */
  kind: varchar('kind', { length: 16 }).notNull(),
  tags: json('tags').$type<string[]>().notNull(),
  /** Anonimizacja osoby (ZADANIE_03): tożsamość i dane wrażliwe usunięte, statystyka zostaje. */
  anonymizedAt: datetime('anonymized_at', { mode: 'date', fsp: 3 })
})

/**
 * Tożsamość: imię, nazwisko, kontakt, adres, notatka o osobie (D2). Jawna dla serwera w wersji 1.
 * change_log zapisuje dla niej tylko nazwy pól (NAMES_ONLY_TABLES w repo.ts). Przy anonimizacji wiersz jest usuwany.
 */
export const contactIdentity = mysqlTable(
  'contact_identity',
  {
    ...domainColumns(),
    contactId: char('contact_id', { length: 36 })
      .notNull()
      .references(() => contacts.id, contactFk()),
    firstName: varchar('first_name', { length: 100 }),
    lastName: varchar('last_name', { length: 100 }),
    /** nazwa instytucji */
    name: varchar('name', { length: 255 }),
    email: varchar('email', { length: 254 }),
    phone: varchar('phone', { length: 50 }),
    address: varchar('address', { length: 255 }),
    city: varchar('city', { length: 100 }),
    notes: text('notes')
  },
  (t) => [uniqueIndex('contact_identity_contact_uq').on(t.contactId)]
)

/**
 * Dane wrażliwe osoby (ZADANIE_03, D1): jeden JSON zaszyfrowany w przeglądarce kluczem organizacji (AES-GCM,
 * AAD = contact_id + wersja klucza). Serwer zna tylko szyfrogram. change_log: same nazwy pól (NAMES_ONLY_TABLES).
 * Przy anonimizacji wiersz jest usuwany.
 */
export const contactSensitive = mysqlTable(
  'contact_sensitive',
  {
    ...domainColumns(),
    contactId: char('contact_id', { length: 36 })
      .notNull()
      .references(() => contacts.id, contactFk()),
    keyVersion: int('key_version')
      .notNull()
      .references(() => orgKeys.version),
    /** IV 96 bitów, base64. */
    iv: varchar('iv', { length: 24 }).notNull(),
    /** Szyfrogram z tagiem GCM, base64. */
    ciphertext: mediumtext('ciphertext').notNull()
  },
  (t) => [uniqueIndex('contact_sensitive_contact_uq').on(t.contactId)]
)

/**
 * Załącznik osoby albo działania (ZADANIE_03, D11). Plik w STORAGE_DIR to szyfrogram AES-GCM kluczem pliku z przeglądarki;
 * nazwa, typ i klucz pliku są w `metaEnc`, zaszyfrowane kluczem organizacji. Powiązanie przez targetType + targetId (zasada danych 6).
 */
export const attachments = mysqlTable(
  'attachments',
  {
    ...domainColumns(),
    targetType: varchar('target_type', { length: 16 }).notNull(),
    targetId: char('target_id', { length: 36 }).notNull(),
    purpose: varchar('purpose', { length: 32 }).notNull(),
    keyVersion: int('key_version')
      .notNull()
      .references(() => orgKeys.version),
    /** IV + szyfrogram metadanych, base64. */
    metaEnc: text('meta_enc').notNull(),
    sizeBytes: int('size_bytes').notNull(),
    /** Losowa nazwa pliku w STORAGE_DIR. */
    storageKey: char('storage_key', { length: 32 }).notNull()
  },
  (t) => [uniqueIndex('attachments_storage_key_uq').on(t.storageKey), index('attachments_target_idx').on(t.targetType, t.targetId)]
)

/**
 * Lista zanonimizowanych osób (ZADANIE_03, D12), bez danych osobowych: same identyfikatory. Po odtworzeniu kopii
 * `applyErasures` (services/anonymize.ts) nakłada te usunięcia ponownie. Wiersz nie jest tabelą domenową (bez `version`).
 */
export const erasedContacts = mysqlTable('erased_contacts', {
  contactId: char('contact_id', { length: 36 }).primaryKey(),
  erasedAt: datetime('erased_at', { mode: 'date', fsp: 3 }).notNull(),
  /** Wpisy wspólne na osi, którym administrator usunął treść. */
  clearedActivityIds: json('cleared_activity_ids').$type<string[]>().notNull(),
  /** Zadania przy osobie, którym administrator usunął treść. */
  clearedTaskIds: json('cleared_task_ids').$type<string[]>().notNull()
})

export const contactRoles = mysqlTable(
  'contact_roles',
  {
    ...domainColumns(),
    contactId: char('contact_id', { length: 36 })
      .notNull()
      .references(() => contacts.id, contactFk()),
    /** 'participant' | 'volunteer' | … (domain.ts ROLES) */
    role: varchar('role', { length: 16 }).notNull(),
    since: date('since', { mode: 'string' }),
    until: date('until', { mode: 'string' }),
    note: text('note')
  },
  (t) => [index('contact_roles_contact_idx').on(t.contactId)]
)

export const relationships = mysqlTable(
  'relationships',
  {
    ...domainColumns(),
    contactAId: char('contact_a_id', { length: 36 })
      .notNull()
      .references(() => contacts.id, contactFk()),
    contactBId: char('contact_b_id', { length: 36 })
      .notNull()
      .references(() => contacts.id, contactFk()),
    /** 'works_at' | 'contact_person' | 'guardian' | 'other' */
    type: varchar('type', { length: 32 }).notNull(),
    note: text('note')
  },
  (t) => [index('relationships_a_idx').on(t.contactAId), index('relationships_b_idx').on(t.contactBId)]
)

export const consents = mysqlTable(
  'consents',
  {
    ...domainColumns(),
    contactId: char('contact_id', { length: 36 })
      .notNull()
      .references(() => contacts.id, contactFk()),
    /** 'processing' | 'image' | 'communication' | 'other' */
    type: varchar('type', { length: 32 }).notNull(),
    basis: varchar('basis', { length: 255 }),
    givenAt: date('given_at', { mode: 'string' }).notNull(),
    validUntil: date('valid_until', { mode: 'string' }),
    withdrawnAt: date('withdrawn_at', { mode: 'string' }),
    note: text('note')
  },
  (t) => [index('consents_contact_idx').on(t.contactId)]
)

// ---------- Oś aktywności (ZADANIE_02, krok 3) ----------

/**
 * Wpis na osi: notatka, kontakt, wsparcie albo wpis systemowy (`content` = JSON zdarzenia, tekst składa klient).
 * `actionId`: wpis przy działaniu (opcjonalnie).
 */
export const activities = mysqlTable(
  'activities',
  {
    ...domainColumns(),
    /** 'note' | 'contact' | 'support' | 'system' */
    type: varchar('type', { length: 16 }).notNull(),
    /** 'phone' | 'email' | 'meeting' | 'other' (tylko kontakt) */
    channel: varchar('channel', { length: 16 }),
    /** forma wsparcia (tylko wsparcie) */
    form: varchar('form', { length: 255 }),
    durationMinutes: int('duration_minutes'),
    occurredAt: datetime('occurred_at', { mode: 'date', fsp: 3 }).notNull(),
    content: text('content').notNull(),
    actionId: char('action_id', { length: 36 }).references(() => actions.id, { onDelete: 'restrict' })
  },
  (t) => [index('activities_action_idx').on(t.actionId), index('activities_occurred_idx').on(t.occurredAt)]
)

/** Osoby, których dotyczy wpis. */
export const activityContacts = mysqlTable(
  'activity_contacts',
  {
    ...domainColumns(),
    activityId: char('activity_id', { length: 36 })
      .notNull()
      .references(() => activities.id, { onDelete: 'restrict' }),
    contactId: char('contact_id', { length: 36 })
      .notNull()
      .references(() => contacts.id, contactFk())
  },
  (t) => [index('activity_contacts_activity_idx').on(t.activityId), index('activity_contacts_contact_idx').on(t.contactId)]
)

// ---------- Tematy szkoleń i działania (ZADANIE_02, krok 4) ----------

export const topics = mysqlTable('topics', {
  ...domainColumns(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  program: text('program'),
  durationHours: int('duration_hours')
})

/** Działanie (D1: pola rdzenia; osoba odpowiedzialna i szablon przygotowania dojdą w ZADANIU_05). */
export const actions = mysqlTable(
  'actions',
  {
    ...domainColumns(),
    /** 'training' | 'workshop' | 'event' | 'meeting' | 'fundraiser' | 'other' */
    type: varchar('type', { length: 16 }).notNull(),
    /** 'project' | 'statutory_free' | 'statutory_paid' | 'business' */
    framework: varchar('framework', { length: 16 }).notNull(),
    title: varchar('title', { length: 255 }).notNull(),
    /** 'planned' | 'ongoing' | 'done' | 'cancelled' */
    status: varchar('status', { length: 16 }).notNull(),
    startDate: date('start_date', { mode: 'string' }),
    endDate: date('end_date', { mode: 'string' }),
    place: varchar('place', { length: 255 }),
    /** temat tylko przy szkoleniu */
    topicId: char('topic_id', { length: 36 }).references(() => topics.id, { onDelete: 'restrict' }),
    description: text('description'),
    expectedParticipants: int('expected_participants')
  },
  (t) => [index('actions_start_idx').on(t.startDate), index('actions_topic_idx').on(t.topicId)]
)

/** Zajęcia / termin działania (w desktopie `sessions`; nazwa zmieniona, żeby nie mylić z sesją logowania). */
export const actionSessions = mysqlTable(
  'action_sessions',
  {
    ...domainColumns(),
    actionId: char('action_id', { length: 36 })
      .notNull()
      .references(() => actions.id, { onDelete: 'restrict' }),
    date: date('date', { mode: 'string' }).notNull(),
    /** HH:mm */
    startTime: char('start_time', { length: 5 }),
    endTime: char('end_time', { length: 5 }),
    leaderContactId: char('leader_contact_id', { length: 36 }).references(() => contacts.id, contactFk()),
    note: text('note')
  },
  (t) => [index('action_sessions_action_idx').on(t.actionId), index('action_sessions_date_idx').on(t.date)]
)

/** Uczestnik działania. Para (działanie, osoba) jedna (UNIQUE); usunięty wiersz wraca przy ponownym dodaniu. */
export const actionParticipants = mysqlTable(
  'action_participants',
  {
    ...domainColumns(),
    actionId: char('action_id', { length: 36 })
      .notNull()
      .references(() => actions.id, { onDelete: 'restrict' }),
    contactId: char('contact_id', { length: 36 })
      .notNull()
      .references(() => contacts.id, contactFk()),
    /** 'registered' | 'confirmed' | 'resigned' */
    status: varchar('status', { length: 16 }).notNull(),
    note: text('note')
  },
  (t) => [uniqueIndex('action_participants_pair_uq').on(t.actionId, t.contactId), index('action_participants_contact_idx').on(t.contactId)]
)

/** Obecność na zajęciach. Para (zajęcia, osoba) jedna (UNIQUE); wyczyszczenie = oznaczenie `deletedAt`. */
export const attendance = mysqlTable(
  'attendance',
  {
    ...domainColumns(),
    sessionId: char('session_id', { length: 36 })
      .notNull()
      .references(() => actionSessions.id, { onDelete: 'restrict' }),
    contactId: char('contact_id', { length: 36 })
      .notNull()
      .references(() => contacts.id, contactFk()),
    /** 'present' | 'absent' | 'excused' */
    status: varchar('status', { length: 16 }).notNull()
  },
  (t) => [uniqueIndex('attendance_pair_uq').on(t.sessionId, t.contactId), index('attendance_contact_idx').on(t.contactId)]
)

// ---------- Zadania (ZADANIE_02, krok 5) ----------

/** Zadanie; „dotyczy” przez `targetType` + `targetId` (osoba albo działanie), bez klucza obcego (zasada danych 6). */
export const tasks = mysqlTable(
  'tasks',
  {
    ...domainColumns(),
    title: varchar('title', { length: 255 }).notNull(),
    dueDate: date('due_date', { mode: 'string' }),
    assigneeUserId: char('assignee_user_id', { length: 36 }).references(() => users.id, { onDelete: 'restrict' }),
    /** 'todo' | 'doing' | 'done' */
    status: varchar('status', { length: 16 }).notNull(),
    /** 'low' | 'normal' | 'high' */
    priority: varchar('priority', { length: 16 }).notNull(),
    /** 'contact' | 'action' */
    targetType: varchar('target_type', { length: 16 }),
    targetId: char('target_id', { length: 36 }),
    description: text('description')
  },
  (t) => [index('tasks_due_idx').on(t.dueDate), index('tasks_assignee_idx').on(t.assigneeUserId), index('tasks_target_idx').on(t.targetType, t.targetId)]
)

/** Pozycja checklisty zadania. */
export const taskItems = mysqlTable(
  'task_items',
  {
    ...domainColumns(),
    taskId: char('task_id', { length: 36 })
      .notNull()
      .references(() => tasks.id, { onDelete: 'restrict' }),
    label: varchar('label', { length: 500 }).notNull(),
    done: boolean('done').notNull().default(false),
    position: int('position').notNull()
  },
  (t) => [index('task_items_task_idx').on(t.taskId)]
)
