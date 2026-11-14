import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import fastifyCookie from '@fastify/cookie'
import type { Health } from '@shared/health'
import pkg from '../../package.json'
import { migrationCount, type Db } from './db/connection'
import { appRoot } from './config'
import { registerSecurity } from './security'
import { noSessions, registerRpc, type SessionProvider } from './rpc'
import { registerAuthRoutes, type AuthOptions } from './auth/routes'

/**
 * db = null: tryb kreatora (brak lub błędna konfiguracja), `missing` to nazwy zmiennych do ustawienia; API (RPC) wtedy nie działa.
 * `sessions`: źródło sesji dla strażnika RPC (na produkcji sesje z bazy, w testach podstawiane; domyślnie brak sesji).
 * `auth`: włącza trasy logowania (/api/auth/…); wymaga bazy.
 */
export function buildApp(db: Db | null, missing: string[] = [], sessions: SessionProvider = noSessions, auth?: AuthOptions) {
  // Logi bez danych osobowych (zasada danych 9): metoda, trasa (wzorzec, bez parametrów i zapytania),
  // kod wyniku i czas. Bez adresu IP, nagłówków i treści żądań. Id użytkownika dojdzie z sesjami (krok 5).
  const app = Fastify({
    logger: {
      level: 'info',
      serializers: {
        req: (req) => ({ method: req.method, route: req.routeOptions?.url ?? null }),
        res: (res) => ({ statusCode: res.statusCode })
      }
    },
    trustProxy: true
  })

  registerSecurity(app)
  // Ciasteczka (sesja logowania); bez podpisu: token jest losowy, a w bazie tylko jego skrót.
  app.register(fastifyCookie)

  app.get('/api/health', async (req): Promise<Health> => {
    const https = req.protocol === 'https'
    if (!db) return { status: 'setup', version: pkg.version, missing, https }
    return { status: 'ok', version: pkg.version, migrations: await migrationCount(db), https }
  })

  if (db) registerRpc(app, db, sessions)
  if (db && auth) registerAuthRoutes(app, db, auth)

  // Zbudowany klient (po `npm run build`). W trybie deweloperskim klienta serwuje Vite.
  const clientDir = resolve(appRoot, 'dist/client')
  if (existsSync(clientDir)) {
    app.register(fastifyStatic, { root: clientDir })
    // SPA: każdy adres poza /api dostaje index.html.
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'not_found' })
      return reply.sendFile('index.html')
    })
  }

  return app
}
