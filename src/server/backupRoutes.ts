// Pobieranie kopii zapasowej (ZADANIE_04, krok 1; D4): strumień poza RPC, za strażnikiem sesji, 2FA i roli `admin`.
// Plik jest zaszyfrowany (otwiera go hasło administratora w przeglądarce); serwer oddaje go bez zmian.
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { AppError } from '@shared/errors'
import type { Db } from './db/connection'
import { backups } from './db/schema'
import { requireSession } from './attachmentRoutes'
import { logAccess } from './auth/accessLog'
import type { AuthOptions } from './auth/options'
import { sendError, type Session, type SessionProvider } from './rpc'
import { backupFilePath } from './services/backups'
import { buildSupportCopy } from './services/supportCopy'

export function registerBackupRoutes(app: FastifyInstance, db: Db, sessions: SessionProvider, auth: AuthOptions) {
  app.get('/api/backups/:id', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    let session: Session | undefined
    try {
      session = await requireSession(sessions, req)
      if (session.role !== 'admin') throw new AppError('FORBIDDEN')
      const id = z.uuid().safeParse(req.params.id)
      if (!id.success) throw new AppError('NOT_FOUND')
      if (!auth.storageDir) throw new AppError('VALIDATION', 'Kopie wymagają ustawienia STORAGE_DIR')
      const userId = session.userId
      const at = auth.now?.() ?? new Date()
      const row = await db.transaction(async (tx) => {
        const [r] = await tx
          .select({ id: backups.id, startedAt: backups.startedAt })
          .from(backups)
          .where(and(eq(backups.id, id.data), eq(backups.status, 'done')))
          .limit(1)
        if (!r) throw new AppError('NOT_FOUND')
        await tx.update(backups).set({ downloadedAt: at }).where(eq(backups.id, r.id))
        await logAccess(tx, userId, 'backup_download', at, r.id, 'backup')
        return r
      })
      const path = backupFilePath(auth.storageDir, row.id)
      const info = await stat(path).catch(() => null)
      if (!info) throw new AppError('NOT_FOUND')
      req.log.info({ route: 'backups.download', userId, code: 'OK' }, 'backup')
      return reply
        .header('Content-Type', 'application/octet-stream')
        .header('Content-Disposition', `attachment; filename="ngo-crm-kopia-${row.startedAt.toISOString().slice(0, 10)}.ngb"`)
        .header('Content-Length', info.size)
        .header('Cache-Control', 'no-store')
        .send(createReadStream(path))
    } catch (e) {
      return sendError(e, reply, req.log, { route: 'backups.download', userId: session?.userId })
    }
  })

  // Kopia do pomocy technicznej (D7): jawny plik JSON bez danych osobowych (services/supportCopy.ts), budowany na żądanie.
  app.get('/api/support-copy', async (req: FastifyRequest, reply: FastifyReply) => {
    let session: Session | undefined
    try {
      session = await requireSession(sessions, req)
      if (session.role !== 'admin') throw new AppError('FORBIDDEN')
      const at = auth.now?.() ?? new Date()
      const copy = await buildSupportCopy(db, at)
      await logAccess(db, session.userId, 'support_copy', at)
      req.log.info({ route: 'support.copy', userId: session.userId, code: 'OK' }, 'support copy')
      return reply
        .header('Content-Type', 'application/json; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="ngo-crm-do-pomocy-${at.toISOString().slice(0, 10)}.json"`)
        .header('Cache-Control', 'no-store')
        .send(JSON.stringify(copy, null, 1))
    } catch (e) {
      return sendError(e, reply, req.log, { route: 'support.copy', userId: session?.userId })
    }
  })
}
