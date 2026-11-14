// Kody błędów przekazywane z serwera do klienta (wzór desktopu).
// Polskie komunikaty dojdą w kliencie (src/client/i18n/pl.ts), np. VERSION_CONFLICT → „Ktoś zmienił ten rekord w międzyczasie”.
export const ERROR_CODES = ['NOT_FOUND', 'VERSION_CONFLICT'] as const
export type ErrorCode = (typeof ERROR_CODES)[number]

export class AppError extends Error {
  constructor(
    public code: ErrorCode,
    message?: string
  ) {
    super(message ?? code)
  }
}
