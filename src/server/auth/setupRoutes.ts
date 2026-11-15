// Trasy kreatora pierwszego uruchomienia (poza RPC, bez sesji). HTTPS i CSRF sprawdza wcześniej security.ts.
// Każda trasa poza /status wymaga SETUP_TOKEN; błędne tokeny liczą się do limitu prób z adresu IP.
import { randomBytes, randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { Transform, type Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { AppError } from '@shared/errors'
import {
  RESTORE_CHUNK_BYTES,
  RESTORE_MAX_BYTES,
  setupCheckInput,
  setupCompleteInput,
  setupRestoreBeginInput,
  setupRestoreFinishInput,
  setupTotpInput,
  type SetupCheckResult,
  type SetupRestoreBeginResult,
  type SetupRestoreResult,
  type SetupStatus,
  type SetupTotpResult
} from '@shared/setup'
import { migrationCount, type Db } from '../db/connection'
import { isSecure } from '../security'
import { sendError } from '../rpc'
import { assertDatabaseEmpty, restoreBackup, restoreDir } from '../services/backupRestore'
import type { IpLimiter } from './lockout'
import type { AuthOptions } from './options'
import { qrSvg } from './qr'
import { postRoute } from './routes'
import { checkStorage, completeSetup, sealEnrollment, setupState, tokenMatches } from './setup'
import { generateTotpSecret, otpauthUrl } from './totp'

export function registerSetupRoutes(app: FastifyInstance, db: Db, opts: AuthOptions, limiter: IpLimiter, now: () => Date) {
  /** Kreator dostępny i token poprawny; inaczej SETUP_UNAVAILABLE, RATE_LIMITED albo SETUP_TOKEN_INVALID. */
  async function requireToken(req: FastifyRequest, token: string) {
    const state = await setupState(db, opts)
    if (state !== 'available') throw new AppError('SETUP_UNAVAILABLE', state)
    const t = now()
    if (!limiter.tryAcquire(req.ip, t)) throw new AppError('RATE_LIMITED')
    if (!tokenMatches(token, opts.setupToken!)) throw new AppError('SETUP_TOKEN_INVALID')
    limiter.release(req.ip, t)
  }

  postRoute(app, '/api/setup/status', 'setup.status', async (): Promise<SetupStatus> => ({ state: await setupState(db, opts) }))

  postRoute(app, '/api/setup/check', 'setup.check', async (req): Promise<SetupCheckResult> => {
    const { token } = setupCheckInput.parse(req.body)
    await requireToken(req, token)
    return { https: isSecure(req), migrations: await migrationCount(db), storage: await checkStorage(opts.storageDir, !!opts.production) }
  })

  postRoute(app, '/api/setup/totp', 'setup.totp', async (req): Promise<SetupTotpResult> => {
    const { token, email } = setupTotpInput.parse(req.body)
    await requireToken(req, token)
    const userId = randomUUID()
    const secret = generateTotpSecret()
    const url = otpauthUrl(secret, email)
    return { userId, secret, otpauthUrl: url, qrSvg: await qrSvg(url), enrollment: sealEnrollment(userId, secret, opts.appSecret, now()) }
  })

  postRoute(app, '/api/setup/complete', 'setup.complete', async (req, _reply, ctx) => {
    const input = setupCompleteInput.parse(req.body)
    await requireToken(req, input.token)
    const storage = await checkStorage(opts.storageDir, !!opts.production)
    if (!storage.ok) throw new AppError('VALIDATION', `STORAGE_DIR: ${storage.problem}`)
    const { userId } = await completeSetup(db, input, opts, now())
    ctx.userId = userId
  })

  registerRestoreRoutes(app, db, opts, requireToken, now)
}

/** Plik roboczy z kawałkami kopii starszy niż to jest sprzątany przy kolejnym rozpoczęciu. */
const STALE_UPLOAD_MS = 2 * 3600_000
const uploadChunkHeaders = z.object({
  'x-setup-token': z.string().min(1).max(500),
  'x-upload-id': z.string().regex(/^[a-f0-9]{32}$/),
  'x-offset': z.coerce.number().int().min(0).max(RESTORE_MAX_BYTES),
  'content-length': z.coerce.number().int().min(1).max(RESTORE_CHUNK_BYTES)
})

/**
 * Odtwarzanie z kopii w kreatorze (D6): begin (plik roboczy) → chunk (kawałki po kolei) → finish (klucz kopii, odtworzenie).
 * Każdy krok za SETUP_TOKEN i tylko na pustej bazie. Plik roboczy znika po finish (udanym albo nie) i po 2 godzinach.
 */
function registerRestoreRoutes(app: FastifyInstance, db: Db, opts: AuthOptions, requireToken: (req: FastifyRequest, token: string) => Promise<void>, now: () => Date) {
  const storageDir = () => {
    if (!opts.storageDir) throw new AppError('VALIDATION', 'Brak folderu na pliki (zmienna STORAGE_DIR). Ustaw go według instrukcji wdrożenia i uruchom program ponownie.')
    return opts.storageDir
  }
  const partPath = (id: string) => join(restoreDir(storageDir()), `${id}.part`)
  let restoring = false

  postRoute(app, '/api/setup/restore/begin', 'setup.restore.begin', async (req): Promise<SetupRestoreBeginResult> => {
    const { token } = setupRestoreBeginInput.parse(req.body)
    await requireToken(req, token)
    const dir = restoreDir(storageDir())
    await assertDatabaseEmpty(db)
    await mkdir(dir, { recursive: true })
    for (const name of await readdir(dir)) {
      const info = await stat(join(dir, name)).catch(() => null)
      if (info && now().getTime() - info.mtimeMs > STALE_UPLOAD_MS) await rm(join(dir, name), { recursive: true, force: true })
    }
    return { uploadId: randomBytes(16).toString('hex') }
  })

  // Osobny zakres: surowe bajty tylko dla tej trasy (reszta kreatora przyjmuje JSON).
  void app.register(async (scope) => {
    scope.addContentTypeParser('application/octet-stream', (_req, payload, done) => done(null, payload))
    scope.post('/api/setup/restore/chunk', async (req, reply) => {
      try {
        const h = uploadChunkHeaders.safeParse(req.headers)
        if (!h.success) throw new AppError('VALIDATION', 'Nieprawidłowy kawałek pliku kopii')
        await requireToken(req, h.data['x-setup-token'])
        const path = partPath(h.data['x-upload-id'])
        const size = (await stat(path).catch(() => null))?.size ?? 0
        if (h.data['x-offset'] !== size) throw new AppError('VALIDATION', 'Kawałki pliku przyszły w złej kolejności. Zacznij odtwarzanie od nowa.')
        if (size + h.data['content-length'] > RESTORE_MAX_BYTES) throw new AppError('VALIDATION', 'Plik kopii jest za duży.')
        await mkdir(restoreDir(storageDir()), { recursive: true })
        let got = 0
        const counter = new Transform({
          transform(chunk: Buffer, _enc, cb) {
            got += chunk.length
            cb(got > RESTORE_CHUNK_BYTES ? new AppError('VALIDATION', 'Kawałek pliku jest za duży') : null, chunk)
          }
        })
        await pipeline(req.body as Readable, counter, createWriteStream(path, { flags: 'a', mode: 0o600 }))
        if (got !== h.data['content-length']) {
          await rm(path, { force: true })
          throw new AppError('VALIDATION', 'Kawałek pliku doszedł niepełny. Zacznij odtwarzanie od nowa.')
        }
        req.log.info({ auth: 'setup.restore.chunk', code: 'OK' }, 'auth')
        return { ok: true, data: {} }
      } catch (e) {
        return sendError(e, reply, req.log, { auth: 'setup.restore.chunk' })
      }
    })
  })

  postRoute(app, '/api/setup/restore/finish', 'setup.restore.finish', async (req): Promise<SetupRestoreResult> => {
    const input = setupRestoreFinishInput.parse(req.body)
    await requireToken(req, input.token)
    const dir = storageDir()
    if (restoring) throw new AppError('VALIDATION', 'Odtwarzanie już trwa.')
    restoring = true
    const path = partPath(input.uploadId)
    try {
      if (!(await stat(path).catch(() => null))) throw new AppError('VALIDATION', 'Nie ma wysłanego pliku kopii. Zacznij odtwarzanie od nowa.')
      const r = await restoreBackup(db, { path, key: Buffer.from(input.key, 'base64'), storageDir: dir, appSecret: opts.appSecret, now: now() })
      return {
        persons: r.persons,
        institutions: r.institutions,
        actions: r.actions,
        documents: r.documents,
        filesMissing: r.filesMissing,
        erasuresApplied: r.erasuresApplied,
        twoFaReset: r.twoFaReset
      }
    } finally {
      restoring = false
      await rm(path, { force: true })
    }
  })
}
