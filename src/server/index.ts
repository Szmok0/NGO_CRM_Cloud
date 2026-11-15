import { loadConfig } from './config'
import { openDb, runMigrations } from './db/connection'
import { buildApp } from './app'
import { dbSessions } from './auth/sessions'
import { startBackupTimer } from './services/backups'
import { startUpdateTimer } from './services/updates'

// Bez await na najwyższym poziomie: Hostinger (lsnode.js) wczytuje ten plik przez require().
async function start() {
  const config = loadConfig()
  if (!config.ready) {
    // Tryb kreatora: bez bazy, /api/health mówi, które zmienne ustawić.
    console.warn(config.message)
    const app = buildApp(null, config.missing)
    await app.listen({ port: config.PORT, host: config.HOST })
    return
  }

  const { db } = await openDb(config.DATABASE_URL)
  await runMigrations(db)

  const app = buildApp(db, [], dbSessions(db), {
    appSecret: config.APP_SECRET,
    setupToken: config.SETUP_TOKEN,
    storageDir: config.STORAGE_DIR,
    production: config.isProduction
  })
  await app.listen({ port: config.PORT, host: config.HOST })
  startBackupTimer(db, config.STORAGE_DIR)
  startUpdateTimer(db)
}

start().catch((err) => {
  console.error(err)
  // Drizzle chowa błąd MySQL w err.cause; logujemy tylko pola diagnostyczne (bez adresu bazy i hasła).
  const c = err?.cause
  if (c) console.error('Przyczyna:', { code: c.code, errno: c.errno, sqlState: c.sqlState, message: c.sqlMessage ?? c.message })
  process.exit(1)
})
