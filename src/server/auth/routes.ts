// Logowanie: trasy poza RPC (CLAUDE.md dopuszcza ten wyjątek). HTTPS i CSRF sprawdza wcześniej security.ts.
// 1) /api/auth/prelogin: sól do wyprowadzenia kluczy (dla nieznanego e-maila pozorna, nieodróżnialna),
// 2) /api/auth/login: authKey zamiast hasła → sesja 5 min przed 2FA,
// 3) /api/auth/totp: kod z aplikacji → pełna sesja.
// Odpowiedź przy złym haśle, nieznanym e-mailu, wyłączonym i zablokowanym koncie jest taka sama (LOGIN_FAILED).
import { createHmac, randomBytes } from 'node:crypto'
import { and, eq, isNull } from 'drizzle-orm'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { loginInput, preloginInput, totpInput, type LoginResult, type PreloginResult } from '@shared/auth'
import { AppError } from '@shared/errors'
import type { Db } from '../db/connection'
import { users } from '../db/schema'
import { sendError } from '../rpc'
import { logAccess } from './accessLog'
import { createIpLimiter, isLocked, registerFailure, registerSuccess } from './lockout'
import type { AuthOptions } from './options'
import { hashAuthKey, verifyAuthKey } from './password'
import { SESSION_COOKIE, clearSessionCookie, createSession, getSession, revokeSession, setSessionCookie } from './sessions'
import { consumeTotpCode } from './totp'

/** Liczba iteracji PBKDF2 podawana dla nieznanego e-maila (taka sama jak dla nowych kont). */
const KDF_ITERATIONS = 600_000

export function registerAuthRoutes(app: FastifyInstance, db: Db, opts: AuthOptions) {
  const now = opts.now ?? (() => new Date())
  const limiter = opts.ipLimiter ?? createIpLimiter()

  // Pozorny skrót: dla nieznanego e-maila i zablokowanego konta liczymy scrypt tak samo jak dla prawdziwego,
  // żeby czas odpowiedzi nie zdradzał, czy konto istnieje.
  let dummyHash: Promise<string> | undefined
  const dummy = () => (dummyHash ??= hashAuthKey(randomBytes(32).toString('base64'), opts.scryptParams))

  /** Sól pozorna: stała dla danego e-maila, nie do odróżnienia od losowej bez znajomości APP_SECRET. */
  const fakeSalt = (email: string) => createHmac('sha256', opts.appSecret).update(`ngo-crm/kdf-salt/${email}`).digest().subarray(0, 16).toString('base64')

  const findUser = async (email: string) =>
    (
      await db
        .select({
          id: users.id,
          status: users.status,
          kdfSalt: users.kdfSalt,
          kdfIterations: users.kdfIterations,
          authHash: users.authHash,
          totpEnabledAt: users.totpEnabledAt,
          lockedUntil: users.lockedUntil
        })
        .from(users)
        .where(and(eq(users.email, email), isNull(users.deletedAt)))
    )[0]

  /** Wspólna obsługa: { ok, data } albo błąd; w logu tylko nazwa kroku, id użytkownika i kod (bez e-maila i IP). */
  const route = <T>(url: string, step: string, handler: (req: FastifyRequest, reply: FastifyReply, ctx: { userId?: string }) => Promise<T>) =>
    app.post(url, async (req, reply) => {
      const ctx: { userId?: string } = {}
      try {
        const data = await handler(req, reply, ctx)
        req.log.info({ auth: step, userId: ctx.userId, code: 'OK' }, 'auth')
        return { ok: true, data }
      } catch (e) {
        return sendError(e, reply, req.log, { auth: step, userId: ctx.userId })
      }
    })

  route('/api/auth/prelogin', 'prelogin', async (req): Promise<PreloginResult> => {
    const { email } = preloginInput.parse(req.body)
    const user = await findUser(email)
    if (user?.kdfSalt && user.kdfIterations) return { kdfSalt: user.kdfSalt, kdfIterations: user.kdfIterations }
    return { kdfSalt: fakeSalt(email), kdfIterations: KDF_ITERATIONS }
  })

  route('/api/auth/login', 'login', async (req, reply, ctx): Promise<LoginResult> => {
    const { email, authKey } = loginInput.parse(req.body)
    const t = now()
    if (!limiter.tryAcquire(req.ip, t)) throw new AppError('RATE_LIMITED')

    const user = await findUser(email)
    const usable = !!user && user.status === 'active' && !!user.authHash && !isLocked(user.lockedUntil, t)
    const ok = await verifyAuthKey(authKey, usable ? user.authHash! : await dummy())
    if (!user || !usable || !ok) {
      // Do licznika konta liczy się tylko złe hasło na konto, na które da się zalogować.
      if (user && usable) await registerFailure(db, user.id, t)
      await logAccess(db, user?.id ?? null, 'login_failed', t)
      throw new AppError('LOGIN_FAILED')
    }

    ctx.userId = user.id
    limiter.release(req.ip, t)
    const session = await createSession(db, user.id, { mfaPassed: false, userAgent: req.headers['user-agent'], now: t })
    setSessionCookie(reply, session.token, session.expiresAt)
    return { totpEnabled: !!user.totpEnabledAt }
  })

  route('/api/auth/totp', 'totp', async (req, reply, ctx) => {
    const { code } = totpInput.parse(req.body)
    const t = now()
    const token = req.cookies[SESSION_COOKIE]
    const session = await getSession(db, token, t)
    if (!token || !session) throw new AppError('UNAUTHENTICATED')
    ctx.userId = session.userId
    if (session.totpVerified) return // już po 2FA

    const [user] = await db.select({ totpEnabledAt: users.totpEnabledAt, lockedUntil: users.lockedUntil }).from(users).where(eq(users.id, session.userId))
    if (!user?.totpEnabledAt) throw new AppError('VALIDATION', 'Konto nie ma jeszcze skonfigurowanego 2FA')
    if (!limiter.tryAcquire(req.ip, t)) throw new AppError('RATE_LIMITED')

    const usable = !isLocked(user.lockedUntil, t)
    const ok = usable && (await consumeTotpCode(db, session.userId, code, opts.appSecret, t))
    if (!ok) {
      const locked = usable ? await registerFailure(db, session.userId, t) : true
      await logAccess(db, session.userId, 'login_failed', t)
      if (locked) {
        // Konto zablokowane: sesja przed 2FA kończy się od razu.
        await revokeSession(db, token)
        clearSessionCookie(reply)
      }
      throw new AppError('LOGIN_FAILED')
    }

    // Pełne logowanie: nowy token (stary, sprzed 2FA, przestaje działać), licznik blokady wyzerowany.
    limiter.release(req.ip, t)
    await revokeSession(db, token)
    const full = await createSession(db, session.userId, { mfaPassed: true, userAgent: req.headers['user-agent'], now: t })
    setSessionCookie(reply, full.token, full.expiresAt)
    await registerSuccess(db, session.userId, t)
    await logAccess(db, session.userId, 'login', t)
  })
}
