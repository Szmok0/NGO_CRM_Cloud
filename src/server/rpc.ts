// Jeden punkt wejścia API: POST /api/rpc z { method, params }.
// Kolejność: sesja → 2FA → rola → walidacja zod → obsługa. CSRF i HTTPS sprawdza wcześniej security.ts.
import type { FastifyBaseLogger, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { ZodError } from 'zod'
import { apiMethods, rpcRequest, type ApiOutputs, type ApiParsed, type Method, type MethodSpec, type Role } from '@shared/api'
import { AppError, type ErrorCode } from '@shared/errors'
import pkg from '../../package.json'
import { migrationCount, type Db } from './db/connection'
import { logAccess } from './auth/accessLog'
import { changePassword, confirmTotpSetup, getAccount, getKeys, startTotpSetup } from './auth/account'
import { registerSuccess } from './auth/lockout'
import { disableUser, inviteUser, listUsers, resetUser, setUserRole } from './auth/users'
import type { AuthOptions } from './auth/options'
import { getSettings } from './services/settings'
import * as actions from './services/actions'
import * as activities from './services/activities'
import * as contacts from './services/contacts'
import * as tasks from './services/tasks'
import type { Actor } from './services/common'
import { SESSION_COOKIE, clearSessionCookie, createSession, revokeAllSessions, revokeSession, setSessionCookie } from './auth/sessions'

/** Sesja logowania widziana przez strażnika. */
export interface Session {
  userId: string
  role: Role
  /** Czy w tej sesji potwierdzono kod TOTP. */
  totpVerified: boolean
}

/** Wymienne źródło sesji: w testach podstawiana sesja, na produkcji sesje z bazy (auth/sessions.ts). */
export interface SessionProvider {
  get(req: FastifyRequest): Promise<Session | null>
}

/** Brak sesji dla każdego żądania: każda metoda odmawia. */
export const noSessions: SessionProvider = { get: async () => null }

interface RpcContext {
  session: Session
  db: Db
  req: FastifyRequest
  reply: FastifyReply
  now: Date
  /** Ustawienia logowania; brak (np. w testach innych modułów) → metody wymagające APP_SECRET zgłaszają błąd. */
  auth?: AuthOptions
}

const requireAuth = (ctx: RpcContext) => {
  if (!ctx.auth) throw new Error('Brak konfiguracji logowania')
  return ctx.auth
}

/** Nowa pełna sesja w miejsce bieżącej (nowy token w ciasteczku). */
async function issueFullSession({ db, req, reply, session, now }: RpcContext) {
  const full = await createSession(db, session.userId, { mfaPassed: true, userAgent: req.headers['user-agent'], now })
  setSessionCookie(reply, full.token, full.expiresAt)
}

const actor = ({ session, now }: RpcContext): Actor => ({ userId: session.userId, now })

type Handlers = { [M in Method]: (params: ApiParsed<M>, ctx: RpcContext) => ApiOutputs[M] | Promise<ApiOutputs[M]> }

const handlers: Handlers = {
  'auth.me': (_p, { session }) => ({ userId: session.userId, role: session.role, totpVerified: session.totpVerified }),
  'auth.account': (_p, { session, db }) => getAccount(db, session.userId),
  'auth.totpSetup.start': (_p, ctx) => startTotpSetup(ctx.db, ctx.session.userId, requireAuth(ctx).appSecret),
  'auth.totpSetup.confirm': async ({ code }, ctx) => {
    const { db, session, req, now } = ctx
    await confirmTotpSetup(db, session.userId, code, requireAuth(ctx).appSecret, now)
    // 2FA włączone i potwierdzone: sesja sprzed 2FA zamienia się w pełną.
    const token = req.cookies[SESSION_COOKIE]
    if (token) await revokeSession(db, token)
    await issueFullSession(ctx)
    await registerSuccess(db, session.userId, now)
    await logAccess(db, session.userId, 'login', now)
  },
  'auth.keys': (_p, { session, db }) => getKeys(db, session.userId),
  'auth.changePassword': async (input, ctx) => {
    const { db, session, reply, now } = ctx
    const result = await changePassword(db, session.userId, input, requireAuth(ctx), now)
    if (result === 'locked') {
      // Blokada konta (także po nieudanych próbach tutaj): koniec wszystkich sesji.
      await revokeAllSessions(db, session.userId)
      clearSessionCookie(reply)
      throw new AppError('LOGIN_FAILED')
    }
    if (result === 'wrong_password') throw new AppError('LOGIN_FAILED')
    if (result === 'wrong_code') throw new AppError('TOTP_INVALID')
    // Nowe hasło: pozostałe sesje tej osoby kończą się, ta dostaje nowy token.
    await revokeAllSessions(db, session.userId)
    await issueFullSession(ctx)
  },
  'auth.logout': async (_p, { session, db, req, reply }) => {
    const token = req.cookies[SESSION_COOKIE]
    if (token) await revokeSession(db, token)
    clearSessionCookie(reply)
    await logAccess(db, session.userId, 'logout')
  },
  'auth.logoutAll': async (_p, { session, db, reply }) => {
    await revokeAllSessions(db, session.userId)
    clearSessionCookie(reply)
    await logAccess(db, session.userId, 'logout_all')
  },
  'users.list': (_p, { db, now }) => listUsers(db, now),
  'users.invite': (input, { db, session, now }) => inviteUser(db, input, { userId: session.userId, now }),
  'users.setRole': (input, { db, session, now }) => setUserRole(db, input, { userId: session.userId, now }),
  'users.disable': (input, { db, session, now }) => disableUser(db, input, { userId: session.userId, now }),
  'users.reset': (input, { db, session, now }) => resetUser(db, input, { userId: session.userId, now }),
  'system.info': async (_p, { db }) => ({ version: pkg.version, migrations: await migrationCount(db) }),
  'settings.get': (_p, { db }) => getSettings(db),

  // osoby i instytucje
  'contacts.list': (p, { db, now }) => contacts.listContacts(db, p, now),
  'contacts.tags': (_p, { db }) => contacts.listTags(db),
  'contacts.get': ({ id }, { db }) => contacts.getContact(db, id),
  'contacts.duplicates': (p, { db, now }) => contacts.findDuplicates(db, p, now),
  'contacts.create': (p, ctx) => contacts.createContact(ctx.db, p, actor(ctx)),
  'contacts.update': (p, ctx) => contacts.updateContact(ctx.db, p, actor(ctx)),
  'contacts.delete': (p, ctx) => contacts.deleteContact(ctx.db, p, actor(ctx)),
  'roles.add': (p, ctx) => contacts.addRole(ctx.db, p, actor(ctx)),
  'roles.end': (p, ctx) => contacts.endRole(ctx.db, p, actor(ctx)),
  'roles.delete': (p, ctx) => contacts.deleteRole(ctx.db, p, actor(ctx)),
  'relationships.add': (p, ctx) => contacts.addRelationship(ctx.db, p, actor(ctx)),
  'relationships.delete': (p, ctx) => contacts.deleteRelationship(ctx.db, p, actor(ctx)),
  'consents.add': (p, ctx) => contacts.addConsent(ctx.db, p, actor(ctx)),
  'consents.withdraw': (p, ctx) => contacts.withdrawConsent(ctx.db, p, actor(ctx)),
  'consents.delete': (p, ctx) => contacts.deleteConsent(ctx.db, p, actor(ctx)),
  'activities.add': (p, ctx) => activities.addActivity(ctx.db, p, actor(ctx)),
  'activities.delete': (p, ctx) => activities.deleteActivity(ctx.db, p, actor(ctx)),
  // tematy i działania
  'topics.list': (_p, { db }) => actions.listTopics(db),
  'topics.get': ({ id }, { db }) => actions.getTopic(db, id),
  'topics.create': (p, ctx) => actions.createTopic(ctx.db, p, actor(ctx)),
  'topics.update': (p, ctx) => actions.updateTopic(ctx.db, p, actor(ctx)),
  'topics.delete': (p, ctx) => actions.deleteTopic(ctx.db, p, actor(ctx)),
  'actions.list': (p, { db }) => actions.listActions(db, p),
  'actions.get': ({ id }, { db, now }) => actions.getActionDetail(db, id, now),
  'actions.create': (p, ctx) => actions.createAction(ctx.db, p, actor(ctx)),
  'actions.update': (p, ctx) => actions.updateAction(ctx.db, p, actor(ctx)),
  'actions.delete': (p, ctx) => actions.deleteAction(ctx.db, p, actor(ctx)),
  'participants.add': (p, ctx) => actions.addParticipantById(ctx.db, p, actor(ctx)),
  'participants.setStatus': (p, ctx) => actions.setParticipantStatus(ctx.db, p, actor(ctx)),
  'participants.remove': (p, ctx) => actions.removeParticipant(ctx.db, p, actor(ctx)),
  'participants.previewPaste': (p, { db }) => actions.previewPaste(db, p),
  'participants.applyPaste': (p, ctx) => actions.applyPaste(ctx.db, p, actor(ctx)),
  'sessions.add': (p, ctx) => actions.addSession(ctx.db, p, actor(ctx)),
  'sessions.update': (p, ctx) => actions.updateSession(ctx.db, p, actor(ctx)),
  'sessions.delete': (p, ctx) => actions.deleteSession(ctx.db, p, actor(ctx)),
  'attendance.set': (p, ctx) => actions.setAttendance(ctx.db, p, actor(ctx)),
  // zadania
  'users.options': (_p, { db }) => tasks.listUserOptions(db),
  'tasks.list': (p, ctx) => tasks.listTasks(ctx.db, p, actor(ctx)),
  'tasks.get': ({ id }, { db }) => tasks.getTask(db, id),
  'tasks.create': (p, ctx) => tasks.createTask(ctx.db, p, actor(ctx)),
  'tasks.update': (p, ctx) => tasks.updateTask(ctx.db, p, actor(ctx)),
  'tasks.move': (p, ctx) => tasks.moveTask(ctx.db, p, actor(ctx)),
  'tasks.delete': (p, ctx) => tasks.deleteTask(ctx.db, p, actor(ctx)),
  'taskItems.add': (p, ctx) => tasks.addTaskItem(ctx.db, p, actor(ctx)),
  'taskItems.toggle': (p, ctx) => tasks.toggleTaskItem(ctx.db, p, actor(ctx)),
  'taskItems.delete': (p, ctx) => tasks.deleteTaskItem(ctx.db, p, actor(ctx)),
  'search.global': ({ q }, { db }) => contacts.searchGlobal(db, q)
}

export const HTTP_STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  LOGIN_FAILED: 401,
  RATE_LIMITED: 429,
  TOTP_INVALID: 400,
  SETUP_TOKEN_INVALID: 401,
  SETUP_UNAVAILABLE: 409,
  INVITE_INVALID: 400,
  EMAIL_TAKEN: 409,
  LAST_ADMIN: 409,
  TOTP_REQUIRED: 403,
  FORBIDDEN: 403,
  VALIDATION: 400,
  NOT_FOUND: 404,
  VERSION_CONFLICT: 409,
  UNKNOWN: 500
}

/**
 * Zamienia dowolny błąd na odpowiedź { ok: false, code, message } z kodem HTTP. Nieoczekiwany błąd loguje bez treści
 * (może zawierać zapytanie z danymi): tylko nazwa, kod przyczyny i stos bez pierwszej linii.
 */
export function sendError(e: unknown, reply: FastifyReply, log: FastifyBaseLogger, context: Record<string, unknown>) {
  const err =
    e instanceof AppError
      ? e
      : e instanceof ZodError
        ? new AppError('VALIDATION', e.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join('; '))
        : new AppError('UNKNOWN', 'Błąd serwera')
  if (err.code === 'UNKNOWN') {
    const x = e as { name?: string; stack?: string; cause?: { code?: string } }
    log.error({ ...context, errorName: x?.name, causeCode: x?.cause?.code, stack: x?.stack?.split('\n').slice(1).join('\n') }, 'error')
  } else {
    log.info({ ...context, code: err.code }, 'refused')
  }
  return reply.code(HTTP_STATUS[err.code]).send({ ok: false, code: err.code, message: err.message })
}

const isMethod = (m: string): m is Method => Object.hasOwn(apiMethods, m)

export function registerRpc(app: FastifyInstance, db: Db, sessions: SessionProvider, auth?: AuthOptions) {
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
      const data = await handler(params, { session, db, req, reply, now: auth?.now?.() ?? new Date(), auth })
      // Log bez parametrów i wyników (zasada danych 9): metoda, id użytkownika, kod.
      req.log.info({ rpc: method, userId: session.userId, code: 'OK' }, 'rpc')
      return { ok: true, data }
    } catch (e) {
      return sendError(e, reply, req.log, { rpc: method, userId: session?.userId })
    }
  })
}
