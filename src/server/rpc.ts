// Jeden punkt wejścia API: POST /api/rpc z { method, params }.
// Kolejność: sesja → 2FA → rola → walidacja zod → obsługa. CSRF i HTTPS sprawdza wcześniej security.ts.
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { ZodError } from 'zod'
import { apiMethods, rpcRequest, type ApiOutputs, type ApiParsed, type Method, type MethodSpec, type Role } from '@shared/api'
import { AppError, type ErrorCode } from '@shared/errors'
import pkg from '../../package.json'
import { migrationCount, type Db } from './db/connection'

/** Sesja logowania widziana przez strażnika. */
export interface Session {
  userId: string
  role: Role
  /** Czy w tej sesji potwierdzono kod TOTP. */
  totpVerified: boolean
}

/** Wymienne źródło sesji: do kroku 5 „brak sesji”, w testach podstawiana sesja, potem sesje z bazy. */
export interface SessionProvider {
  get(req: FastifyRequest): Promise<Session | null>
}

/** Do czasu kroku 5 (logowanie): nikt nie ma sesji, więc każda metoda odmawia. */
export const noSessions: SessionProvider = { get: async () => null }

interface RpcContext {
  session: Session
  db: Db
}

type Handlers = { [M in Method]: (params: ApiParsed<M>, ctx: RpcContext) => ApiOutputs[M] | Promise<ApiOutputs[M]> }

const handlers: Handlers = {
  'auth.me': (_p, { session }) => ({ userId: session.userId, role: session.role, totpVerified: session.totpVerified }),
  'system.info': async (_p, { db }) => ({ version: pkg.version, migrations: await migrationCount(db) })
}

const HTTP_STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  TOTP_REQUIRED: 403,
  FORBIDDEN: 403,
  VALIDATION: 400,
  NOT_FOUND: 404,
  VERSION_CONFLICT: 409,
  UNKNOWN: 500
}

const isMethod = (m: string): m is Method => Object.hasOwn(apiMethods, m)

export function registerRpc(app: FastifyInstance, db: Db, sessions: SessionProvider) {
  app.post('/api/rpc', async (req, reply) => {
    let method: string | undefined
    let session: Session | null = null
    try {
      const body = rpcRequest.safeParse(req.body)
      // Nazwa do logu tylko, gdy jest w kontrakcie (bez dowolnego tekstu od niezalogowanych).
      if (body.success && isMethod(body.data.method)) method = body.data.method

      session = await sessions.get(req)
      if (!session) throw new AppError('UNAUTHENTICATED')
      if (!body.success) throw new AppError('VALIDATION', 'Nieprawidłowe żądanie')
      if (!method || !isMethod(method)) throw new AppError('VALIDATION', 'Nieznana metoda')

      const spec: MethodSpec = apiMethods[method]
      if (!session.totpVerified && !spec.before2fa) throw new AppError('TOTP_REQUIRED')
      if (!spec.roles.includes(session.role)) throw new AppError('FORBIDDEN')

      const params = spec.input.parse(body.data.params)
      const handler = handlers[method] as (p: unknown, ctx: RpcContext) => unknown
      const data = await handler(params, { session, db })
      // Log bez parametrów i wyników (zasada danych 9): metoda, id użytkownika, kod.
      req.log.info({ rpc: method, userId: session.userId, code: 'OK' }, 'rpc')
      return { ok: true, data }
    } catch (e) {
      const err =
        e instanceof AppError
          ? e
          : e instanceof ZodError
            ? new AppError('VALIDATION', e.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join('; '))
            : new AppError('UNKNOWN', 'Błąd serwera')
      if (err.code === 'UNKNOWN') {
        // Bez treści błędu (może zawierać zapytanie z danymi): nazwa, kod przyczyny i stos bez pierwszej linii.
        const x = e as { name?: string; stack?: string; cause?: { code?: string } }
        req.log.error({ rpc: method, userId: session?.userId, errorName: x?.name, causeCode: x?.cause?.code, stack: x?.stack?.split('\n').slice(1).join('\n') }, 'rpc error')
      } else {
        req.log.info({ rpc: method, userId: session?.userId, code: err.code }, 'rpc')
      }
      return reply.code(HTTP_STATUS[err.code]).send({ ok: false, code: err.code, message: err.message })
    }
  })
}
