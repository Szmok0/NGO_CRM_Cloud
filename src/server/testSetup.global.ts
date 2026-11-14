// Vitest globalSetup: migracje bazy testowej raz, przed wszystkimi plikami testów
// (równoległe pliki nie wykonują migracji jednocześnie). Zabezpieczenie: testDatabaseUrl().
import { openDb, runMigrations } from './db/connection'
import { testDatabaseUrl } from './testDb'

export default async function setup() {
  const { db, close } = await openDb(testDatabaseUrl())
  try {
    await runMigrations(db)
  } finally {
    await close()
  }
}
