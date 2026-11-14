// Wymagania co do hasła sprawdza przeglądarka, bo serwer hasła nie widzi (bezpieczeństwo 5.1).
import { pl } from '../i18n/pl'

export const MIN_PASSWORD_LENGTH = 12

const OBVIOUS = ['password', 'haslo', 'hasło', 'qwerty', '123456', 'abcdef', 'zaq12wsx', 'admin']

/** Komunikat, dlaczego hasło jest za słabe, albo null, gdy może być. */
export function passwordProblem(password: string, email = ''): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return pl.passwordRules.tooShort
  const lower = password.toLowerCase()
  const mail = email.trim().toLowerCase()
  const local = mail.split('@')[0] ?? ''
  if ((mail && lower.includes(mail)) || (local.length >= 4 && lower.includes(local))) return pl.passwordRules.containsEmail
  // Po usunięciu oczywistych ciągów musi zostać dość różnych znaków.
  const rest = OBVIOUS.reduce((s, w) => s.split(w).join(''), lower)
  if (new Set(password).size < 6 || new Set(rest).size < 5) return pl.passwordRules.tooSimple
  return null
}
