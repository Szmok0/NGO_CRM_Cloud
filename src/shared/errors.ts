// Kody błędów przekazywane z serwera do klienta (wzór desktopu).
// Polskie komunikaty: src/client/i18n/pl.ts (errors).
export const ERROR_CODES = [
  'UNAUTHENTICATED',
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
