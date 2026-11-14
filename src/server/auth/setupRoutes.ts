// Trasy kreatora pierwszego uruchomienia (poza RPC, bez sesji). HTTPS i CSRF sprawdza wcześniej security.ts.
// Każda trasa poza /status wymaga SETUP_TOKEN; błędne tokeny liczą się do limitu prób z adresu IP.
import { randomUUID } from 'node:crypto'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { AppError } from '@shared/errors'
import { setupCheckInput, setupCompleteInput, setupTotpInput, type SetupCheckResult, type SetupStatus, type SetupTotpResult } from '@shared/setup'
import { migrationCount, type Db } from '../db/connection'
import { isSecure } from '../security'
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
}
