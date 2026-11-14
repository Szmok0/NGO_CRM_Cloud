// Blokada logowania (decyzje 5 i 6): 5 nieudanych prób na konto = 15 min blokady (błędne hasło i błędny kod TOTP
// liczą się razem; licznik zeruje pełne logowanie); 20 nieudanych prób z jednego adresu IP na 15 min
// (okno stałe, licznik tylko w pamięci, IP nigdzie nie zapisywane).
import { eq } from 'drizzle-orm'
import type { Db } from '../db/connection'
import { users } from '../db/schema'

export const MAX_FAILED_ATTEMPTS = 5
export const LOCK_MS = 15 * 60_000
export const IP_MAX_ATTEMPTS = 20
export const IP_WINDOW_MS = 15 * 60_000

export const isLocked = (lockedUntil: Date | null, now: Date) => !!lockedUntil && lockedUntil > now

/** Zapisuje nieudaną próbę. Piąta z rzędu blokuje konto na 15 min i zeruje licznik. Zwraca, czy konto jest teraz zablokowane. */
export function registerFailure(db: Db, userId: string, now: Date): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [user] = await tx.select({ failedAttempts: users.failedAttempts }).from(users).where(eq(users.id, userId)).for('update')
    if (!user) return false
    const attempts = user.failedAttempts + 1
    const locked = attempts >= MAX_FAILED_ATTEMPTS
    await tx
      .update(users)
      .set(locked ? { failedAttempts: 0, lockedUntil: new Date(now.getTime() + LOCK_MS) } : { failedAttempts: attempts })
      .where(eq(users.id, userId))
    return locked
  })
}

/** Pełne logowanie (hasło i kod): zeruje licznik i blokadę, zapisuje czas logowania. */
export async function registerSuccess(db: Db, userId: string, now: Date) {
  await db.update(users).set({ failedAttempts: 0, lockedUntil: null, lastLoginAt: now }).where(eq(users.id, userId))
}

/**
 * Licznik prób z adresu IP, tylko w pamięci procesu (znika po restarcie). Próbę rezerwujemy przed kosztownym
 * sprawdzeniem (scrypt), a udaną zwracamy: do limitu liczą się tylko nieudane, a zalew równoczesnych żądań też jest ograniczony.
 */
export function createIpLimiter(max = IP_MAX_ATTEMPTS, windowMs = IP_WINDOW_MS) {
  const windows = new Map<string, { start: number; count: number }>()
  return {
    /** false: limit wyczerpany do końca okna. */
    tryAcquire(ip: string, now: Date): boolean {
      const t = now.getTime()
      if (windows.size > 10_000) for (const [k, w] of windows) if (t - w.start >= windowMs) windows.delete(k)
      let w = windows.get(ip)
      if (!w || t - w.start >= windowMs) windows.set(ip, (w = { start: t, count: 0 }))
      if (w.count >= max) return false
      w.count++
      return true
    },
    /** Próba okazała się udana: nie liczy się do limitu. */
    release(ip: string, now: Date) {
      const w = windows.get(ip)
      if (w && w.count > 0 && now.getTime() - w.start < windowMs) w.count--
    }
  }
}
export type IpLimiter = ReturnType<typeof createIpLimiter>
