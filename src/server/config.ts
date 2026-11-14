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

// Bez tych ustawień serwer nie wystartuje wcale.
const serverSchema = z.object({
  PORT: z.coerce.number().int().positive().default(isProduction ? 3000 : 3001),
  HOST: z.string().default(isProduction ? '0.0.0.0' : '127.0.0.1'),
  // Potrzebne dopiero kreatorowi pierwszego uruchomienia (sprawdza je i mówi, co poprawić).
  SETUP_TOKEN: z.string().optional(),
  STORAGE_DIR: z.string().optional()
})

// Bez tych ustawień serwer startuje tylko w trybie kreatora z informacją, co ustawić.
const requiredSchema = z.object({
  DATABASE_URL: z.string().startsWith('mysql://'),
  APP_SECRET: z.string().refine((s) => Buffer.byteLength(s, 'utf8') >= 32)
})

type ServerConfig = z.infer<typeof serverSchema> & { isProduction: boolean }
export type Config =
  | (ServerConfig & z.infer<typeof requiredSchema> & { ready: true })
  | (ServerConfig & { ready: false; missing: string[]; message: string })

export function loadConfig(): Config {
  const server = { ...serverSchema.parse(process.env), isProduction }
  const parsed = requiredSchema.safeParse(process.env)
  if (parsed.success) return { ...server, ...parsed.data, ready: true }

  // Bez wartości zmiennych w logu, tylko nazwy.
  const missing = [...new Set(parsed.error.issues.map((i) => i.path.join('.')))]
  // Diagnostyka DATABASE_URL bez sekretów: tylko czy istnieje i jaki ma schemat.
  const dbUrl = process.env.DATABASE_URL
  const dbInfo = dbUrl === undefined ? 'brak zmiennej' : `schemat: ${/^[a-z][a-z0-9+.-]*:/i.exec(dbUrl)?.[0] ?? 'nierozpoznany'}`
  const message =
    `Brak lub błędna konfiguracja: ${missing.join(', ')} (DATABASE_URL: ${dbInfo}; APP_SECRET musi mieć co najmniej 32 bajty; ` +
    `plik .env w katalogu aplikacji: ${existsSync(envFile) ? 'jest' : 'brak'}). Serwer działa w trybie kreatora. Wzór: .env.example`
  return { ...server, ready: false, missing, message }
}
