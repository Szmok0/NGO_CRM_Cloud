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
  setup: {
    title: 'Pierwsze uruchomienie',
    step: (n: number, of: number) => `Krok ${n} z ${of}`,
    next: 'Dalej',
    back: 'Wstecz',
    working: 'Pracuję… Przeliczenie hasła i utworzenie kluczy trwa chwilę.',
    noToken: 'Aplikacja nie ma jeszcze żadnego konta, a w konfiguracji brakuje tokenu kreatora. W panelu hostingu ustaw zmienną SETUP_TOKEN (losowa, co najmniej 32 znaki) i odśwież stronę.',
    tokenTooShort: 'Aplikacja nie ma jeszcze żadnego konta, a token kreatora jest za krótki. W panelu hostingu ustaw zmienną SETUP_TOKEN na losową wartość o długości co najmniej 32 znaków i odśwież stronę.',
    appSecretHint: 'Możesz użyć tej wartości jako APP_SECRET (wygenerowana teraz w Twojej przeglądarce, nigdzie niezapisana):',
    token: {
      intro: 'Ta aplikacja nie ma jeszcze żadnego konta. Kreator założy organizację i konto administratora. Potrzebny jest token z konfiguracji serwera (zmienna SETUP_TOKEN w panelu hostingu).',
      label: 'Token konfiguracji',
      submit: 'Sprawdź',
      checks: 'Sprawdzenie serwera',
      https: 'Połączenie szyfrowane (HTTPS)',
      database: (n: number) => `Baza danych i migracje (${n})`,
      storage: 'Folder na załączniki i kopie (STORAGE_DIR)',
      ok: 'w porządku',
      storageProblems: {
        not_set: 'brak zmiennej STORAGE_DIR w konfiguracji serwera',
        inside_app: 'folder leży w folderze aplikacji; wdrożenie by go skasowało. Wskaż folder poza aplikacją',
        not_writable: 'nie da się w nim zapisać. Sprawdź ścieżkę i uprawnienia'
      },
      fixAndRetry: 'Popraw konfigurację w panelu hostingu i sprawdź ponownie.',
      retry: 'Sprawdź ponownie'
    },
    org: {
      title: 'Organizacja',
      name: 'Nazwa organizacji',
      profile: 'Profil (dobiera moduły na start; można zmienić później)',
      profiles: {
        kgw: ['Koło gospodyń wiejskich', 'członkinie, wydarzenia, warsztaty'],
        donors: ['Darczyńcy i zbiórki', 'baza darczyńców, podziękowania, zbiórki'],
        projects: ['Projekty i szkolenia', 'działania, uczestnicy, obecność'],
        custom: ['Własny', 'tylko baza osób; moduły włączysz samodzielnie']
      }
    },
    admin: {
      title: 'Administrator',
      intro: 'Pierwsze konto ma pełne uprawnienia. Kolejne osoby zaprosisz po zalogowaniu.',
      name: 'Imię i nazwisko',
      email: 'E-mail (login)',
      password: 'Hasło',
      repeat: 'Powtórz hasło',
      mismatch: 'Hasło i powtórzenie różnią się.'
    },
    recovery: {
      title: 'Klucz odzyskiwania',
      warning: 'Bez hasła osoby z dostępem i bez tego klucza danych wrażliwych nie da się odzyskać. Autor programu też ich nie odzyska.',
      intro: 'Wydrukuj ten klucz albo przepisz go na kartkę i schowaj w bezpiecznym miejscu organizacji (np. w sejfie). Nie zapisuj go w komputerze ani w telefonie. Pokazujemy go tylko raz.',
      restartNote: 'Jeśli zaczniesz kreator od nowa (np. odświeżysz stronę), powstanie nowy klucz, a ten wydruk będzie nieważny.',
      print: 'Drukuj',
      printTitle: 'NGO CRM — klucz odzyskiwania',
      printOrg: (name: string) => `Organizacja: ${name}`,
      confirm: 'Wpisz 4 ostatnie znaki klucza',
      confirmHint: 'Potwierdzenie, że masz klucz zapisany.',
      confirmWrong: 'To nie są 4 ostatnie znaki klucza. Sprawdź wydruk albo kartkę.'
    },
    totp: {
      title: 'Weryfikacja dwuetapowa',
      submit: 'Zakończ i załóż konto'
    },
    done: {
      title: 'Gotowe',
      intro: 'Organizacja i konto administratora zostały założone.',
      checklist: 'Zostały trzy rzeczy do zrobienia:',
      items: [
        'Usuń zmienną SETUP_TOKEN w panelu hostingu (kreator i tak już się nie uruchomi).',
        'Schowaj wydruk klucza odzyskiwania w bezpiecznym miejscu organizacji.',
        'Włącz automatyczne kopie zapasowe w panelu hostingu.'
      ],
      login: 'Przejdź do logowania'
    }
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
    SETUP_TOKEN_INVALID: 'Nieprawidłowy token konfiguracji. Sprawdź wartość SETUP_TOKEN w panelu hostingu.',
    SETUP_UNAVAILABLE: 'Kreator pierwszego uruchomienia nie jest dostępny (został już wykonany albo brakuje tokenu w konfiguracji).',
    TOTP_REQUIRED: 'Najpierw potwierdź logowanie kodem z aplikacji uwierzytelniającej.',
    FORBIDDEN: 'Nie masz uprawnień do tej operacji.',
    VALIDATION: 'Nieprawidłowe dane.',
    NOT_FOUND: 'Nie znaleziono rekordu (mógł zostać usunięty).',
    VERSION_CONFLICT: 'Ktoś zmienił ten rekord w międzyczasie. Odśwież widok i wprowadź zmianę ponownie.',
    UNKNOWN: 'Wystąpił nieoczekiwany błąd.'
  } satisfies Record<ErrorCode, string>
}
