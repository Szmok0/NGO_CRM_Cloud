import { resolve } from 'node:path'
import mysql from 'mysql2/promise'
import { drizzle, type MySql2Database } from 'drizzle-orm/mysql2'
import { migrate } from 'drizzle-orm/mysql2/migrator'
import { sql } from 'drizzle-orm'
import * as schema from './schema'
import { appRoot } from '../config'

export type Db = MySql2Database<typeof schema>

export async function openDb(databaseUrl: string): Promise<{ db: Db; close: () => Promise<void> }> {
  // Daty zawsze w UTC (zasada danych 7).
  const pool = mysql.createPool({ uri: databaseUrl, timezone: 'Z', connectionLimit: 5 })
  const db = drizzle(pool, { schema, mode: 'default' })
  return { db, close: () => pool.end() }
}

/** Migracje z folderu drizzle/ (generowane przez `npm run db:generate`), uruchamiane przy starcie. */
export async function runMigrations(db: Db): Promise<void> {
  await migrate(db, { migrationsFolder: resolve(appRoot, 'drizzle') })
}

/** Liczba zastosowanych migracji (do /api/health). */
export async function migrationCount(db: Db): Promise<number> {
  const [rows] = (await db.execute(sql`select count(*) as n from __drizzle_migrations`)) as unknown as [{ n: number }[]]
  return Number(rows[0]?.n ?? 0)
}
