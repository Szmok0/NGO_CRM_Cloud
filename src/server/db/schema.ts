import { mysqlTable, varchar, text } from 'drizzle-orm/mysql-core'

// ---------- Techniczne ----------

/** Dane techniczne instancji (klucz → wartość), np. data instalacji. Bez danych osobowych. */
export const appMeta = mysqlTable('app_meta', {
  key: varchar('key', { length: 64 }).primaryKey(),
  value: text('value').notNull()
})
