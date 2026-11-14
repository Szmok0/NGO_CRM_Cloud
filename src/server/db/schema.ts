import { mysqlTable, varchar, text, char, datetime, int, json, index } from 'drizzle-orm/mysql-core'

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
