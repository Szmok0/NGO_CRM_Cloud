// Konfiguracja z zmiennych środowiskowych, sprawdzana przy starcie (zod).
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

// Katalog aplikacji: dwa poziomy nad tym plikiem (src/server/config.ts albo zbudowany dist/server/index.js).
// Nie process.cwd(): Hostinger (lsnode.js) uruchamia serwer z innego katalogu.
export const appRoot = fileURLToPath(new URL('../..', import.meta.url))

// Zmienne z pliku .env w katalogu aplikacji (lokalnie; Hostinger też zapisuje tam zmienne z panelu).
const envFile = resolve(appRoot, '.env')
if (existsSync(envFile)) process.loadEnvFile(envFile)

const isProduction = process.env.NODE_ENV === 'production'

const schema = z.object({
  DATABASE_URL: z.string().startsWith('mysql://'),
  PORT: z.coerce.number().int().positive().default(isProduction ? 3000 : 3001),
  HOST: z.string().default(isProduction ? '0.0.0.0' : '127.0.0.1')
})

export type Config = z.infer<typeof schema> & { isProduction: boolean }

export function loadConfig(): Config {
  const parsed = schema.safeParse(process.env)
  if (!parsed.success) {
    // Bez wartości zmiennych w logu, tylko nazwy.
    const names = parsed.error.issues.map((i) => i.path.join('.')).join(', ')
    // Diagnostyka DATABASE_URL bez sekretów: tylko czy istnieje i jaki ma schemat.
    const dbUrl = process.env.DATABASE_URL
    const dbInfo = dbUrl === undefined ? 'brak zmiennej' : `schemat: ${/^[a-z][a-z0-9+.-]*:/i.exec(dbUrl)?.[0] ?? 'nierozpoznany'}`
    throw new Error(`Brak lub błędna konfiguracja: ${names} (DATABASE_URL: ${dbInfo}; plik .env w katalogu aplikacji: ${existsSync(envFile) ? 'jest' : 'brak'}). Wzór: .env.example`)
  }
  return { ...parsed.data, isProduction }
}
