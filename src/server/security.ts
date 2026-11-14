// Nagłówki bezpieczeństwa, tylko HTTPS, ochrona CSRF (ZADANIE_01, krok 3; NGO_CRM_CLOUD_BEZPIECZENSTWO.md).
import type { FastifyInstance, FastifyRequest } from 'fastify'

export const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; " +
    "object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  'Strict-Transport-Security': 'max-age=31536000',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Cross-Origin-Opener-Policy': 'same-origin'
}

const HTTPS_ONLY_PAGE = `<!doctype html>
<html lang="pl"><head><meta charset="UTF-8"><title>NGO CRM</title></head>
<body><h1>Ta aplikacja działa tylko przez HTTPS</h1>
<p>Otwórz ten sam adres zaczynający się od <strong>https://</strong>.</p></body></html>`

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/** HTTPS bezpośrednio albo przez pośrednika hostingu (X-Forwarded-Proto przy trustProxy); wyjątek: localhost. */
export const isSecure = (req: FastifyRequest) => req.protocol === 'https' || LOCAL_HOSTS.has(req.hostname)

export function registerSecurity(app: FastifyInstance) {
  // Nagłówki przy każdej odpowiedzi (także 404, błędy i pliki statyczne).
  app.addHook('onSend', async (_req, reply, payload) => {
    reply.headers(SECURITY_HEADERS)
    return payload
  })

  app.addHook('onRequest', async (req, reply) => {
    // Bez HTTPS: strona z informacją, API nieobsługiwane. Wyjątek: /api/health (bez danych,
    // pokazuje `https: false`, żeby dało się zdiagnozować konfigurację pośrednika).
    if (!isSecure(req) && req.url !== '/api/health') {
      return reply.code(403).type('text/html; charset=utf-8').send(HTTPS_ONLY_PAGE)
    }

    // CSRF: każde żądanie zmieniające stan (POST i pozostałe poza GET/HEAD/OPTIONS) musi mieć
    // Origin równy adresowi aplikacji i własny nagłówek X-NGO-CRM: 1. Do tego SameSite=Strict (krok 5).
    if (!SAFE_METHODS.has(req.method)) {
      const appOrigin = `${req.protocol}://${req.host}`
      if (req.headers.origin !== appOrigin || req.headers['x-ngo-crm'] !== '1') {
        return reply.code(403).send({ error: 'forbidden' })
      }
    }
  })
}
