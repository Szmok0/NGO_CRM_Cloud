import { loadConfig } from './config'
import { openDb, runMigrations } from './db/connection'
import { buildApp } from './app'

// Bez await na najwyższym poziomie: Hostinger (lsnode.js) wczytuje ten plik przez require().
// Diagnostyka połączenia z bazą: parametry z DATABASE_URL bez treści hasła (tylko długość i cechy).
function describeDbUrl(raw: string) {
  try {
    const u = new URL(raw)
    const rawPw = /^[^:]+:\/\/[^:@/]*:(.*)@[^@]*$/.exec(raw)?.[1] ?? ''
    let decodedLength: number | string
    try { decodedLength = decodeURIComponent(rawPw).length } catch { decodedLength = 'błąd dekodowania' }
    return {
      protocol: u.protocol,
      user: decodeURIComponent(u.username),
      host: u.hostname,
      port: u.port || '(domyślny)',
      database: decodeURIComponent(u.pathname.slice(1)),
      passwordLength: rawPw.length,
      passwordLengthAfterDecode: decodedLength,
      passwordLengthSentToMysql: decodeURIComponent(u.password).length,
      passwordHasPercent: rawPw.includes('%'),
      passwordHasSpace: /\s/.test(rawPw),
      passwordHasQuote: /["'`]/.test(rawPw),
      valueHasOuterWhitespaceOrQuotes: raw !== raw.trim() || /^["']|["']$/.test(raw.trim()),
      hasQueryParams: u.search !== ''
    }
  } catch {
    return { error: 'DATABASE_URL nie daje się sparsować jako URL' }
  }
}

async function start() {
  const config = loadConfig()
  console.log('Baza (diagnostyka):', JSON.stringify(describeDbUrl(config.DATABASE_URL)))
  const { db } = await openDb(config.DATABASE_URL)
  await runMigrations(db)

  const app = buildApp(db)
  await app.listen({ port: config.PORT, host: config.HOST })
}

start().catch((err) => {
  console.error(err)
  // Drizzle chowa błąd MySQL w err.cause; logujemy tylko pola diagnostyczne (bez adresu bazy i hasła).
  const c = err?.cause
  if (c) console.error('Przyczyna:', { code: c.code, errno: c.errno, sqlState: c.sqlState, message: c.sqlMessage ?? c.message })
  process.exit(1)
})
