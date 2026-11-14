import { loadConfig } from './config'
import { openDb, runMigrations } from './db/connection'
import { buildApp } from './app'

// Bez await na najwyższym poziomie: Hostinger (lsnode.js) wczytuje ten plik przez require().
async function start() {
  const config = loadConfig()
  const { db } = await openDb(config.DATABASE_URL)
  await runMigrations(db)

  const app = buildApp(db)
  await app.listen({ port: config.PORT, host: config.HOST })
}

start().catch((err) => {
  console.error(err)
  process.exit(1)
})
