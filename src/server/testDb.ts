// Baza dla testów: wyłącznie lokalna baza testowa z TEST_DATABASE_URL (.env).
// Test nie może dotknąć bazy produkcyjnej ani roboczej: bez spełnienia warunków odmawia startu.
import './config' // wczytuje .env z katalogu aplikacji
import { openDb } from './db/connection'

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1'])

/** Adres bazy testowej albo błąd, gdy nie jest to lokalna baza z przyrostkiem `_test`. */
export function testDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  if (env.NODE_ENV === 'production') throw new Error('Testy z bazą nie działają przy NODE_ENV=production')
  const raw = env.TEST_DATABASE_URL
  if (!raw) throw new Error('Brak TEST_DATABASE_URL w .env (lokalna baza testowa, nazwa z przyrostkiem _test)')
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('TEST_DATABASE_URL nie jest poprawnym adresem')
  }
  if (url.protocol !== 'mysql:') throw new Error('TEST_DATABASE_URL musi zaczynać się od mysql://')
  if (!LOCAL_HOSTS.has(url.hostname)) throw new Error('TEST_DATABASE_URL musi wskazywać lokalną bazę (localhost / 127.0.0.1)')
  if (!url.pathname.slice(1).endsWith('_test')) throw new Error('Nazwa bazy testowej musi kończyć się na _test')
  if (raw === env.DATABASE_URL) throw new Error('TEST_DATABASE_URL nie może być tym samym adresem co DATABASE_URL')
  return raw
}

/** Otwiera bazę testową (migracje wykonuje raz testSetup.global.ts). */
export function openTestDb() {
  return openDb(testDatabaseUrl())
}
