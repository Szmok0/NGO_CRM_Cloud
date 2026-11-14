// Konfiguracja z zmiennych środowiskowych, sprawdzana przy starcie (zod).
import { existsSync } from 'node:fs'
import { z } from 'zod'

// Lokalnie zmienne z pliku .env; na serwerze ustawia je panel hostingu (pliku nie ma).
if (existsSync('.env')) process.loadEnvFile('.env')

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
    throw new Error(`Brak lub błędna konfiguracja: ${names}. Wzór: .env.example`)
  }
  return { ...parsed.data, isProduction }
}
