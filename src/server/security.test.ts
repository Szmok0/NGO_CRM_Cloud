// Zabezpieczenia z kroku 3 na aplikacji w trybie kreatora (bez bazy).
import { afterAll, describe, expect, it } from 'vitest'
import { buildApp } from './app'
import { SECURITY_HEADERS } from './security'

const app = buildApp(null, ['APP_SECRET'])
afterAll(() => app.close())

const HOST = 'crm.example.org'
const viaHttps = { host: HOST, 'x-forwarded-proto': 'https' }
const viaHttp = { host: HOST, 'x-forwarded-proto': 'http' }
const csrfOk = { ...viaHttps, origin: `https://${HOST}`, 'x-ngo-crm': '1' }

const expectSecurityHeaders = (headers: Record<string, unknown>) => {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) expect(headers[name.toLowerCase()]).toBe(value)
}

describe('nagłówki bezpieczeństwa', () => {
  it('są przy odpowiedzi API', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health', headers: viaHttps })
    expect(res.statusCode).toBe(200)
    expectSecurityHeaders(res.headers)
  })

  it('są przy 404, przy odmowie CSRF i przy stronie „tylko HTTPS”', async () => {
    for (const req of [
      { method: 'GET' as const, url: '/api/nie-ma', headers: viaHttps },
      { method: 'POST' as const, url: '/api/rpc', headers: viaHttps },
      { method: 'GET' as const, url: '/', headers: viaHttp }
    ]) {
      expectSecurityHeaders((await app.inject(req)).headers)
    }
  })

  it('CSP zgodna z planem: bez unsafe-inline i unsafe-eval, frame-ancestors none', () => {
    const csp = SECURITY_HEADERS['Content-Security-Policy']!
    expect(csp).not.toMatch(/unsafe-(inline|eval)/)
    expect(csp).toContain("frame-ancestors 'none'")
  })
})

describe('tylko HTTPS', () => {
  it('przez pośrednika z X-Forwarded-Proto: https działa', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health', headers: viaHttps })
    expect(res.json()).toMatchObject({ status: 'setup', https: true })
  })

  it('bez HTTPS: strona z informacją, API nieobsługiwane', async () => {
    const page = await app.inject({ method: 'GET', url: '/', headers: viaHttp })
    expect(page.statusCode).toBe(403)
    expect(page.headers['content-type']).toContain('text/html')
    expect(page.body).toContain('Ta aplikacja działa tylko przez HTTPS')

    const api = await app.inject({ method: 'POST', url: '/api/rpc', headers: { ...csrfOk, 'x-forwarded-proto': 'http', origin: `http://${HOST}` } })
    expect(api.statusCode).toBe(403)
    expect(api.body).toContain('tylko przez HTTPS')
  })

  it('/api/health odpowiada też bez HTTPS (diagnostyka, bez danych)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health', headers: viaHttp })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ https: false })
  })

  it('localhost bez HTTPS działa (praca lokalna)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/nie-ma', headers: { host: 'localhost:3001' } })
    expect(res.statusCode).toBe(404)
  })
})

describe('CSRF: Origin i X-NGO-CRM przy POST', () => {
  const post = (headers: Record<string, string>) => app.inject({ method: 'POST', url: '/api/rpc', headers, payload: {} })

  it('bez Origin → 403', async () => {
    const { origin: _o, ...h } = csrfOk
    expect((await post(h)).statusCode).toBe(403)
  })

  it('obcy Origin → 403', async () => {
    expect((await post({ ...csrfOk, origin: 'https://evil.example' })).statusCode).toBe(403)
  })

  it('Origin z http zamiast https → 403', async () => {
    expect((await post({ ...csrfOk, origin: `http://${HOST}` })).statusCode).toBe(403)
  })

  it('bez nagłówka X-NGO-CRM albo z inną wartością → 403', async () => {
    const { 'x-ngo-crm': _x, ...h } = csrfOk
    expect((await post(h)).statusCode).toBe(403)
    expect((await post({ ...csrfOk, 'x-ngo-crm': '0' })).statusCode).toBe(403)
  })

  it('poprawny Origin i nagłówek → przechodzi dalej (tu 404, trasy jeszcze nie ma)', async () => {
    expect((await post(csrfOk)).statusCode).toBe(404)
  })

  it('także inne metody zmieniające stan (DELETE) wymagają sprawdzenia', async () => {
    expect((await app.inject({ method: 'DELETE', url: '/api/rpc', headers: viaHttps })).statusCode).toBe(403)
  })

  it('GET nie wymaga nagłówków CSRF', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/health', headers: viaHttps })).statusCode).toBe(200)
  })
})
