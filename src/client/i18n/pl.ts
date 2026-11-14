// Teksty interfejsu w jednym miejscu (CLAUDE.md, Konwencje).
import type { Role } from '@shared/api'
import type { ErrorCode } from '@shared/errors'

export const pl = {
  app: {
    name: 'NGO CRM',
    loading: 'Wczytuję…',
    serverError: 'Brak połączenia z serwerem albo bazą danych.',
    setupNeeded: (vars: string) => `Aplikacja czeka na konfigurację. W panelu hostingu ustaw: ${vars} (opis w pliku .env.example).`,
    version: (v: string) => `wersja ${v}`
  },
  roles: { admin: 'administrator', staff: 'pracownik', readonly: 'tylko odczyt' } satisfies Record<Role, string>,
  login: {
    title: 'Logowanie',
    email: 'E-mail',
    password: 'Hasło',
    submit: 'Zaloguj',
    working: 'Sprawdzam… Przeliczenie hasła trwa chwilę.',
    codeTitle: 'Kod z aplikacji',
    codeHint: 'Wpisz 6-cyfrowy kod z aplikacji uwierzytelniającej w telefonie.',
    code: 'Kod',
    confirm: 'Potwierdź',
    back: 'Wróć do logowania',
    sessionExpired: 'Czas na wpisanie kodu minął. Zaloguj się ponownie.'
  },
  totpSetup: {
    title: 'Włącz weryfikację dwuetapową',
    intro: 'Logowanie wymaga hasła i kodu z telefonu. Zainstaluj aplikację uwierzytelniającą (np. Aegis, Google Authenticator, Microsoft Authenticator) i zeskanuj kod QR.',
    qrAlt: 'Kod QR do aplikacji uwierzytelniającej',
    manual: 'Nie możesz zeskanować? Wpisz ten klucz ręcznie:',
    code: 'Kod z aplikacji',
    codeHint: 'Po dodaniu konta aplikacja pokaże 6-cyfrowy kod. Wpisz go, żeby potwierdzić.',
    confirm: 'Potwierdź i włącz',
    cancel: 'Anuluj i wyloguj'
  },
  home: {
    title: 'Dziś',
    greeting: (name: string) => `Dzień dobry, ${name}`,
    empty: 'Tu pojawią się zadania, terminy i działania. Moduły dojdą w kolejnych wersjach.',
    account: 'Twoje konto',
    email: 'E-mail',
    role: 'Rola',
    keys: 'Klucz do danych wrażliwych',
    keysUnlocked: 'odblokowany w tej karcie',
    keysLocked: 'zablokowany (po odświeżeniu strony klucz znika z pamięci; zaloguj się ponownie, żeby go odblokować)',
    changePassword: 'Zmień hasło',
    logout: 'Wyloguj',
    logoutAll: 'Wyloguj wszędzie',
    passwordChanged: 'Hasło zostało zmienione. Pozostałe sesje zostały wylogowane.'
  },
  changePassword: {
    title: 'Zmiana hasła',
    current: 'Obecne hasło',
    next: 'Nowe hasło',
    repeat: 'Powtórz nowe hasło',
    code: 'Kod z aplikacji',
    codeHint: 'Aktualny kod. Jeśli przed chwilą się logowałeś, poczekaj, aż aplikacja pokaże następny.',
    submit: 'Zmień hasło',
    working: 'Zmieniam… Przeliczenie haseł trwa chwilę.',
    cancel: 'Anuluj',
    mismatch: 'Nowe hasło i powtórzenie różnią się.',
    same: 'Nowe hasło musi być inne niż obecne.'
  },
  passwordRules: {
    hint: 'Co najmniej 12 znaków. Najlepiej kilka przypadkowych słów.',
    tooShort: 'Hasło musi mieć co najmniej 12 znaków.',
    tooSimple: 'Hasło jest zbyt proste (za mało różnych znaków albo oczywisty ciąg).',
    containsEmail: 'Hasło nie może zawierać adresu e-mail.'
  },
  errors: {
    UNAUTHENTICATED: 'Sesja wygasła albo nie jesteś zalogowany. Zaloguj się ponownie.',
    LOGIN_FAILED: 'Nieprawidłowe dane logowania albo konto chwilowo zablokowane.',
    RATE_LIMITED: 'Zbyt wiele nieudanych prób logowania z tej sieci. Spróbuj ponownie za kilkanaście minut.',
    TOTP_INVALID: 'Nieprawidłowy kod. Sprawdź, czy telefon ma dobrze ustawioną godzinę, i wpisz aktualny kod.',
    TOTP_REQUIRED: 'Najpierw potwierdź logowanie kodem z aplikacji uwierzytelniającej.',
    FORBIDDEN: 'Nie masz uprawnień do tej operacji.',
    VALIDATION: 'Nieprawidłowe dane.',
    NOT_FOUND: 'Nie znaleziono rekordu (mógł zostać usunięty).',
    VERSION_CONFLICT: 'Ktoś zmienił ten rekord w międzyczasie. Odśwież widok i wprowadź zmianę ponownie.',
    UNKNOWN: 'Wystąpił nieoczekiwany błąd.'
  } satisfies Record<ErrorCode, string>
}
