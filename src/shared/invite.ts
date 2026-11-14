// Przyjęcie zaproszenia (POST /api/invite/…): osoba z jednorazowym linkiem ustawia imię, hasło, 2FA i parę kluczy.
// Bez sesji; token z linku jest jedynym uwierzytelnieniem. Odpowiedź jak w RPC.
import { z } from 'zod'
import { KDF_ITERATIONS, authKeySchema, kdfSaltSchema, sealedSchema } from './auth'

/** Ważność linku z zaproszenia. */
export const INVITE_TTL_HOURS = 72

const token = z.string().min(20).max(200)

/** POST /api/invite/info: czyje to zaproszenie. */
export const inviteInfoInput = z.object({ token })
export interface InviteInfo {
  userId: string
  email: string
  orgName: string
}

/** POST /api/invite/totp: sekret 2FA (nic nie jest jeszcze zapisane). */
export const inviteTotpInput = z.object({ token })
export interface InviteTotpResult {
  secret: string
  otpauthUrl: string
  qrSvg: string
  enrollment: string
}

/** POST /api/invite/accept: zapis hasła (authKey), 2FA i pary kluczy; konto staje się aktywne. */
export const inviteAcceptInput = z.object({
  token,
  enrollment: z.string().max(2000),
  totpCode: z.string().max(20),
  name: z.string().trim().min(1).max(200),
  authKey: authKeySchema,
  kdfSalt: kdfSaltSchema,
  kdfIterations: z.literal(KDF_ITERATIONS),
  publicKey: z.string().regex(/^[A-Za-z0-9+/]+=*$/).max(2000),
  privateKeyEnc: sealedSchema
})
export type InviteAcceptInput = z.output<typeof inviteAcceptInput>
