// Trasy logowania poza RPC (POST /api/auth/…): schematy wejścia (zod) i typy wyników.
// Odpowiedź jak w RPC: { ok: true, data } albo { ok: false, code, message }.
import { z } from 'zod'

/** E-mail zawsze bez spacji i małymi literami (tak też jest zapisywany). */
export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254))
/** `authKey` z przeglądarki: 32 bajty w base64. */
export const authKeySchema = z.string().regex(/^[A-Za-z0-9+/]{43}=$/)

/** POST /api/auth/prelogin: sól i liczba iteracji do wyprowadzenia kluczy z hasła. */
export const preloginInput = z.object({ email: emailSchema })
export interface PreloginResult {
  kdfSalt: string
  kdfIterations: number
}

/** POST /api/auth/login: pierwszy krok (zamiast hasła `authKey`). Daje 5-minutową sesję przed 2FA. */
export const loginInput = z.object({ email: emailSchema, authKey: authKeySchema })
export interface LoginResult {
  /** false: konto nie ma jeszcze 2FA i musi je najpierw skonfigurować. */
  totpEnabled: boolean
}

/** POST /api/auth/totp: drugi krok, kod z aplikacji. Daje pełną sesję. */
export const totpInput = z.object({ code: z.string().max(20) })
