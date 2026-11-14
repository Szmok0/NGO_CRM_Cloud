// Test uprawnień: dla KAŻDEJ metody kontraktu sprawdza strażnika RPC (sesja → 2FA → rola → zod).
// Sesja podstawiana przez SessionProvider. Wymaga lokalnej bazy z DATABASE_URL (.env), jak repo.test.ts.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import './config' // wczytuje .env z katalogu aplikacji
import { apiMethods, ROLES, type Method, type Role } from '@shared/api'
import { buildApp } from './app'
import { openDb, runMigrations } from './db/connection'
import type { Session, SessionProvider } from './rpc'

let current: Session | null = null
const testSessions: SessionProvider = { get: async () => current }

let app: ReturnType<typeof buildApp>
let close: () => Promise<void>

beforeAll(async () => {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('Brak DATABASE_URL w .env (lokalna baza do testów)')
  const opened = await openDb(url)
  close = opened.close
  await runMigrations(opened.db)
  app = buildApp(opened.db, [], testSessions)
})
afterAll(async () => {
  await app?.close()
  await close?.()
})

const HOST = 'crm.example.org'
const headers = { host: HOST, 'x-forwarded-proto': 'https', origin: `https://${HOST}`, 'x-ngo-crm': '1' }
const rpc = async (session: Session | null, method: string, params?: unknown) => {
  current = session
  const res = await app.inject({ method: 'POST', url: '/api/rpc', headers, payload: { method, params } })
  return { status: res.statusCode, body: res.json() as { ok: boolean; code?: string; data?: unknown } }
}
const session = (role: Role, totpVerified = true): Session => ({ userId: `user-${role}`, role, totpVerified })
const methods = Object.keys(apiMethods) as Method[]

describe.each(methods)('metoda %s', (method) => {
  const spec: { roles: readonly Role[]; before2fa?: true } = apiMethods[method]

  it('bez sesji → 401', async () => {
    expect(await rpc(null, method)).toMatchObject({ status: 401, body: { ok: false, code: 'UNAUTHENTICATED' } })
  })

  it(spec.before2fa ? 'z sesją bez 2FA → dostępna (wyjątek)' : 'z sesją bez 2FA → 403', async () => {
    const r = await rpc(session(spec.roles[0]!, false), method)
    if (spec.before2fa) expect([401, 403]).not.toContain(r.status)
    else expect(r).toMatchObject({ status: 403, body: { code: 'TOTP_REQUIRED' } })
  })

  it.each(ROLES)('rola %s', async (role) => {
    const r = await rpc(session(role), method)
    if (spec.roles.includes(role)) expect([401, 403]).not.toContain(r.status)
    else expect(r).toMatchObject({ status: 403, body: { code: 'FORBIDDEN' } })
  })
})

describe('strażnik RPC', () => {
  it('kontrakt ma metody, każda z niepustą listą ról', () => {
    expect(methods.length).toBeGreaterThan(0)
    for (const m of methods) expect(apiMethods[m].roles.length).toBeGreaterThan(0)
  })

  it('nieznana metoda: bez sesji 401, z sesją 400', async () => {
    expect((await rpc(null, 'nie.ma')).status).toBe(401)
    expect(await rpc(session('admin'), 'nie.ma')).toMatchObject({ status: 400, body: { code: 'VALIDATION' } })
  })

  it('rola sprawdzana przed walidacją parametrów (zła rola + złe parametry → 403)', async () => {
    expect((await rpc(session('readonly'), 'system.info', 'zle')).status).toBe(403)
  })

  it('złe parametry przy dozwolonej roli → 400 VALIDATION', async () => {
    expect(await rpc(session('admin'), 'system.info', 'zle')).toMatchObject({ status: 400, body: { code: 'VALIDATION' } })
  })

  it('dozwolone wywołanie zwraca wynik', async () => {
    expect(await rpc(session('staff'), 'auth.me')).toMatchObject({
      status: 200,
      body: { ok: true, data: { userId: 'user-staff', role: 'staff', totpVerified: true } }
    })
    const info = await rpc(session('admin'), 'system.info')
    expect(info).toMatchObject({ status: 200, body: { ok: true, data: { version: expect.any(String) } } })
  })

  it('domyślnie (do kroku 5) nikt nie ma sesji: każda metoda → 401', async () => {
    const opened = await openDb(process.env.DATABASE_URL!)
    const prod = buildApp(opened.db)
    for (const m of methods) {
      const res = await prod.inject({ method: 'POST', url: '/api/rpc', headers, payload: { method: m } })
      expect(res.statusCode).toBe(401)
    }
    await prod.close()
    await opened.close()
  })

  it('ochrona CSRF obejmuje /api/rpc (bez X-NGO-CRM → 403 przed strażnikiem)', async () => {
    current = session('admin')
    const { 'x-ngo-crm': _x, ...h } = headers
    const res = await app.inject({ method: 'POST', url: '/api/rpc', headers: h, payload: { method: 'auth.me' } })
    expect(res.statusCode).toBe(403)
    expect(res.json()).toEqual({ error: 'forbidden' })
  })
})
