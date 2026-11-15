// Trasy plików poza RPC (ZADANIE_03, krok 3a; D11): wysyłanie i pobieranie zaszyfrowanych załączników.
// Kolejność jak w RPC: sesja → 2FA → rola → walidacja → slot klucza. CSRF i HTTPS sprawdza wcześniej security.ts.
// Serwer widzi tylko szyfrogram: nigdy klucza pliku, klucza organizacji ani nazwy pliku (są w `metaEnc`).
import { randomBytes } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { Transform, type Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { and, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { ATTACHMENT_ENCRYPTION_OVERHEAD, ATTACHMENT_MAX_BYTES, ATTACHMENT_MAX_META } from '@shared/api'
import { TARGET_TYPES } from '@shared/domain'
import { AppError } from '@shared/errors'
import { appRoot } from './config'
import type { Db } from './db/connection'
import { attachments } from './db/schema'
import { logAccess } from './auth/accessLog'
import type { AuthOptions } from './auth/options'
import { sendError, type Session, type SessionProvider } from './rpc'
import { checkUpload } from './services/attachments'
import { repoFor } from './services/common'
import { hasSlot } from './services/sensitive'

const WRITE_ROLES: readonly string[] = ['admin', 'staff']

const uploadHeaders = z.object({
  'x-target-type': z.enum(TARGET_TYPES),
  'x-target-id': z.uuid(),
  'x-key-version': z.coerce.number().int().positive(),
  'x-meta-enc': z.string().min(1).max(ATTACHMENT_MAX_META).regex(/^[A-Za-z0-9+/]+=*$/),
  'x-purpose': z
    .string()
    .regex(/^[a-z_]{1,32}$/)
    .default('document'),
  'content-length': z.coerce.number().int().gt(ATTACHMENT_ENCRYPTION_OVERHEAD).max(ATTACHMENT_MAX_BYTES)
})

/** Folder plików; bez STORAGE_DIR załączniki nie działają (D2, D11). */
async function storageDir(auth: AuthOptions): Promise<string> {
  if (!auth.storageDir) throw new AppError('VALIDATION', 'Załączniki wymagają ustawienia STORAGE_DIR')
  const dir = join(resolve(appRoot, auth.storageDir), 'attachments')
  await mkdir(dir, { recursive: true })
  return dir
}

export async function requireSession(sessions: SessionProvider, req: FastifyRequest): Promise<Session> {
  const session = await sessions.get(req)
  if (!session) throw new AppError('UNAUTHENTICATED')
  if (!session.totpVerified) throw new AppError('TOTP_REQUIRED')
  return session
}

/** Przepuszcza bajty i przerywa, gdy jest ich więcej niż limit. */
function limitBytes(max: number) {
  let n = 0
  return Object.assign(
    new Transform({
      transform(chunk: Buffer, _enc, cb) {
        n += chunk.length
        cb(n > max ? new AppError('VALIDATION', 'Plik jest za duży') : null, chunk)
      }
    }),
    { count: () => n }
  )
}

export function registerAttachmentRoutes(app: FastifyInstance, db: Db, sessions: SessionProvider, auth: AuthOptions) {
  const now = () => auth.now?.() ?? new Date()

  // Osobny zakres: surowy strumień bajtów tylko dla tej trasy (reszta API przyjmuje wyłącznie JSON).
  app.register(async (scope) => {
    scope.addContentTypeParser('application/octet-stream', (_req, payload, done) => done(null, payload))

    scope.post('/api/attachments', async (req, reply) => {
      let session: Session | undefined
      let tmp: string | undefined
      let final: string | undefined
      try {
        session = await requireSession(sessions, req)
        if (!WRITE_ROLES.includes(session.role)) throw new AppError('FORBIDDEN')
        const h = uploadHeaders.safeParse(req.headers)
        if (!h.success) throw new AppError('VALIDATION', 'Nieprawidłowe nagłówki załącznika')
        const target = { targetType: h.data['x-target-type'], targetId: h.data['x-target-id'], keyVersion: h.data['x-key-version'] }
        const userId = session.userId
        const dir = await storageDir(auth)
        // Dostęp sprawdzamy przed przyjęciem bajtów, a jeszcze raz w transakcji zapisu (klucz mógł się zmienić).
        await db.transaction((tx) => checkUpload(tx, userId, target))

        const storageKey = randomBytes(16).toString('hex')
        const tmpPath = join(dir, `tmp-${storageKey}`)
        const finalPath = join(dir, storageKey)
        tmp = tmpPath
        final = finalPath
        const counter = limitBytes(ATTACHMENT_MAX_BYTES)
        await pipeline(req.body as Readable, counter, createWriteStream(tmpPath, { flags: 'wx', mode: 0o600 }))
        const size = counter.count()
        if (size !== h.data['content-length']) throw new AppError('VALIDATION', 'Rozmiar pliku nie zgadza się z nagłówkiem')

        const at = now()
        const row = await db.transaction(async (tx) => {
          await checkUpload(tx, userId, target)
          const inserted = await repoFor(tx, { userId, now: at }).insert(attachments, {
            targetType: target.targetType,
            targetId: target.targetId,
            purpose: h.data['x-purpose'],
            keyVersion: target.keyVersion,
            metaEnc: h.data['x-meta-enc'],
            sizeBytes: size,
            storageKey
          })
          await rename(tmpPath, finalPath) // błąd cofa transakcję
          return inserted
        })
        req.log.info({ route: 'attachments.upload', userId, code: 'OK' }, 'attachment')
        return { ok: true, data: { id: row.id, version: row.version } }
      } catch (e) {
        // Nic nie zostaje na dysku po odmowie ani błędzie (plik tymczasowy i ewentualny gotowy).
        await Promise.all([tmp, final].map((p) => (p ? rm(p, { force: true }).catch(() => undefined) : undefined)))
        return sendError(e, reply, req.log, { route: 'attachments.upload', userId: session?.userId })
      }
    })
  })

  app.get('/api/attachments/:id', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    let session: Session | undefined
    try {
      session = await requireSession(sessions, req)
      const id = z.uuid().safeParse(req.params.id)
      if (!id.success) throw new AppError('NOT_FOUND')
      const dir = await storageDir(auth)
      const userId = session.userId
      const row = await db.transaction(async (tx) => {
        const [r] = await tx
          .select({ id: attachments.id, keyVersion: attachments.keyVersion, storageKey: attachments.storageKey })
          .from(attachments)
          .where(and(eq(attachments.id, id.data), isNull(attachments.deletedAt)))
          .limit(1)
        if (!r) throw new AppError('NOT_FOUND')
        if (!(await hasSlot(tx, userId, r.keyVersion))) throw new AppError('NO_KEY_ACCESS')
        await logAccess(tx, userId, 'download_attachment', now(), r.id, 'attachment')
        return r
      })
      const info = await stat(join(dir, row.storageKey)).catch(() => null)
      if (!info) throw new AppError('NOT_FOUND')
      req.log.info({ route: 'attachments.download', userId, code: 'OK' }, 'attachment')
      return reply
        .header('Content-Type', 'application/octet-stream')
        .header('Content-Disposition', 'attachment; filename="attachment.bin"')
        .header('Content-Length', info.size)
        .header('Cache-Control', 'no-store')
        .send(createReadStream(join(dir, row.storageKey)))
    } catch (e) {
      return sendError(e, reply, req.log, { route: 'attachments.download', userId: session?.userId })
    }
  })
}
