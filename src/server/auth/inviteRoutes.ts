// Trasy przyjęcia zaproszenia (poza RPC, bez sesji). HTTPS i CSRF sprawdza wcześniej security.ts.
// Jedynym uwierzytelnieniem jest token z linku; błędne tokeny liczą się do limitu prób z adresu IP.
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { AppError } from '@shared/errors'
import { inviteAcceptInput, inviteInfoInput, inviteTotpInput, type InviteInfo, type InviteTotpResult } from '@shared/invite'
import type { Db } from '../db/connection'
import type { IpLimiter } from './lockout'
import type { AuthOptions } from './options'
import { qrSvg } from './qr'
import { postRoute } from './routes'
import { sealEnrollment } from './setup'
import { generateTotpSecret, otpauthUrl } from './totp'
import { acceptInvite, inviteInfo } from './users'

export function registerInviteRoutes(app: FastifyInstance, db: Db, opts: AuthOptions, limiter: IpLimiter, now: () => Date) {
  /** Wykonuje krok z limitem prób: nieudane (zły token, zły kod) zostają policzone, udane są zwracane. */
  async function limited<T>(req: FastifyRequest, fn: (t: Date) => Promise<T>): Promise<T> {
    const t = now()
    if (!limiter.tryAcquire(req.ip, t)) throw new AppError('RATE_LIMITED')
    const result = await fn(t)
    limiter.release(req.ip, t)
    return result
  }

  postRoute(app, '/api/invite/info', 'invite.info', (req): Promise<InviteInfo> => {
    const { token } = inviteInfoInput.parse(req.body)
    return limited(req, (t) => inviteInfo(db, token, t))
  })

  postRoute(app, '/api/invite/totp', 'invite.totp', (req): Promise<InviteTotpResult> => {
    const { token } = inviteTotpInput.parse(req.body)
    return limited(req, async (t) => {
      const info = await inviteInfo(db, token, t)
      const secret = generateTotpSecret()
      const url = otpauthUrl(secret, info.email)
      return { secret, otpauthUrl: url, qrSvg: await qrSvg(url), enrollment: sealEnrollment(info.userId, secret, opts.appSecret, t) }
    })
  })

  postRoute(app, '/api/invite/accept', 'invite.accept', async (req, _reply, ctx) => {
    const input = inviteAcceptInput.parse(req.body)
    const { userId } = await limited(req, (t) => acceptInvite(db, input, opts, t))
    ctx.userId = userId
  })
}
