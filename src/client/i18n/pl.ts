// Teksty interfejsu w jednym miejscu (CLAUDE.md, Konwencje). Na razie komunikaty błędów API.
import type { ErrorCode } from '@shared/errors'

export const pl = {
  errors: {
    UNAUTHENTICATED: 'Sesja wygasła albo nie jesteś zalogowany. Zaloguj się ponownie.',
    LOGIN_FAILED: 'Nieprawidłowe dane logowania albo konto chwilowo zablokowane.',
    RATE_LIMITED: 'Zbyt wiele nieudanych prób logowania z tej sieci. Spróbuj ponownie za kilkanaście minut.',
    TOTP_REQUIRED: 'Najpierw potwierdź logowanie kodem z aplikacji uwierzytelniającej.',
    FORBIDDEN: 'Nie masz uprawnień do tej operacji.',
    VALIDATION: 'Nieprawidłowe dane.',
    NOT_FOUND: 'Nie znaleziono rekordu (mógł zostać usunięty).',
    VERSION_CONFLICT: 'Ktoś zmienił ten rekord w międzyczasie. Odśwież widok i wprowadź zmianę ponownie.',
    UNKNOWN: 'Wystąpił nieoczekiwany błąd.'
  } satisfies Record<ErrorCode, string>
}
