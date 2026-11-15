// Kreator pierwszego uruchomienia (POST /api/setup/…): działa tylko, gdy w bazie nie ma żadnego użytkownika
// i podano poprawny SETUP_TOKEN. Odpowiedź jak w RPC: { ok: true, data } albo { ok: false, code, message }.
import { z } from 'zod'
import { KDF_ITERATIONS, authKeySchema, emailSchema, kdfSaltSchema, sealedSchema } from './auth'
import { PROFILES } from './modules'

/** Minimalna długość SETUP_TOKEN; przy krótszym kreator odmawia. */
export const SETUP_TOKEN_MIN_LENGTH = 32

/** Stan kreatora: dostępny, już wykonany, brak tokenu w konfiguracji albo token za krótki. */
export type SetupState = 'available' | 'done' | 'no_token' | 'token_too_short'
export interface SetupStatus {
  state: SetupState
}

const token = z.string().min(1).max(500)
const base64 = z.string().regex(/^[A-Za-z0-9+/]+=*$/)

/** POST /api/setup/check: token i sprawdzenie gotowości instancji. */
export const setupCheckInput = z.object({ token })
export type StorageProblem = 'not_set' | 'inside_app' | 'not_writable'
export interface SetupCheckResult {
  https: boolean
  migrations: number
  storage: { ok: true } | { ok: false; problem: StorageProblem }
}

/** POST /api/setup/totp: sekret 2FA dla przyszłego administratora (nic nie jest jeszcze zapisane w bazie). */
export const setupTotpInput = z.object({ token, email: emailSchema })
export interface SetupTotpResult {
  /** Identyfikator przyszłego konta: przeglądarka wiąże z nim zaszyfrowany klucz prywatny. */
  userId: string
  secret: string
  otpauthUrl: string
  qrSvg: string
  /** Sekret i identyfikator zaszyfrowane przez serwer; przeglądarka odsyła to bez zmian przy zapisie. */
  enrollment: string
}

/** POST /api/setup/complete: zapis wszystkiego jedną transakcją. */
export const setupCompleteInput = z.object({
  token,
  enrollment: z.string().max(2000),
  totpCode: z.string().max(20),
  org: z.object({ name: z.string().trim().min(1).max(200), profile: z.enum(PROFILES) }),
  admin: z.object({
    name: z.string().trim().min(1).max(200),
    email: emailSchema,
    authKey: authKeySchema,
    kdfSalt: kdfSaltSchema,
    kdfIterations: z.literal(KDF_ITERATIONS),
    /** Klucz publiczny RSA-OAEP (SPKI, base64) i prywatny zaszyfrowany `wrapKey`. */
    publicKey: base64.max(2000),
    privateKeyEnc: sealedSchema
  }),
  keys: z.object({
    /** Klucz organizacji zaszyfrowany kluczem publicznym administratora. */
    slot: base64.max(1000),
    /** Klucz organizacji zaszyfrowany kluczem odzyskiwania. */
    recoverySlot: sealedSchema
  })
})
export type SetupCompleteInput = z.output<typeof setupCompleteInput>

// ---------- odtwarzanie z kopii (ZADANIE_04, krok 3; D6) ----------

/** Kawałek pliku kopii przy wysyłaniu (limit żądania hostingu): największy dozwolony. */
export const RESTORE_CHUNK_BYTES = 4 * 1024 * 1024
export const RESTORE_MAX_BYTES = 2 * 1024 * 1024 * 1024

/** POST /api/setup/restore/begin: zakłada plik roboczy na serwerze; zwraca `uploadId`. */
export const setupRestoreBeginInput = z.object({ token })
export interface SetupRestoreBeginResult {
  uploadId: string
}

/** POST /api/setup/restore/finish: klucz kopii (32 bajty, base64) odwinięty w przeglądarce hasłem administratora. */
export const setupRestoreFinishInput = z.object({
  token,
  uploadId: z.string().regex(/^[a-f0-9]{32}$/),
  key: base64.length(44)
})
export interface SetupRestoreResult {
  persons: number
  institutions: number
  actions: number
  documents: number
  filesMissing: number
  erasuresApplied: number
  /** 2FA zresetowane (zmienił się APP_SECRET): przy logowaniu każdy ustawia je od nowa. */
  twoFaReset: boolean
}
