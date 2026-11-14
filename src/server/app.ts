import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import type { Health } from '@shared/health'
import pkg from '../../package.json'
import { migrationCount, type Db } from './db/connection'
import { appRoot } from './config'

export function buildApp(db: Db) {
  // Log bez treści żądań (zasada danych 9): Fastify loguje metodę, adres i kod odpowiedzi.
  const app = Fastify({ logger: { level: 'info' }, trustProxy: true })

  app.get('/api/health', async (req): Promise<Health> => ({
    status: 'ok',
    version: pkg.version,
    migrations: await migrationCount(db),
    https: req.protocol === 'https'
  }))

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
