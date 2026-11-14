import { loadConfig } from './config'
import { openDb, runMigrations } from './db/connection'
import { buildApp } from './app'

const config = loadConfig()
const { db } = await openDb(config.DATABASE_URL)
await runMigrations(db)

const app = buildApp(db)
await app.listen({ port: config.PORT, host: config.HOST })
