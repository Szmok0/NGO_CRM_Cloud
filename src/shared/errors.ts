// Kody błędów przekazywane z serwera do klienta (wzór desktopu).
// Polskie komunikaty: src/client/i18n/pl.ts (errors).
export const ERROR_CODES = [
  'UNAUTHENTICATED',
  'LOGIN_FAILED',
  'RATE_LIMITED',
  'TOTP_INVALID',
  'SETUP_TOKEN_INVALID',
  'SETUP_UNAVAILABLE',
  'INVITE_INVALID',
  'EMAIL_TAKEN',
  'LAST_ADMIN',
  'NO_KEY_ACCESS',
  'ACCESS_EXISTS',
  'ACCOUNT_NOT_READY',
  'TOTP_REQUIRED',
  'FORBIDDEN',
  'VALIDATION',
  'NOT_FOUND',
  'VERSION_CONFLICT',
  'UNKNOWN'
] as const
export type ErrorCode = (typeof ERROR_CODES)[number]

export class AppError extends Error {
  constructor(
    public code: ErrorCode,
    message?: string
  ) {
    super(message ?? code)
  }
}
