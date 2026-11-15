// Kolumny i polskie nazwy dla eksportów CSV (ZADANIE_03, krok 6; D14). Plik CSV buduje serwer, więc nazwy muszą być
// po jego stronie; interfejs ma własne teksty w `client/i18n/pl.ts`. Dane wrażliwe nie mają tu kolumn (nigdy w CSV).
import type { ActionStatus, ActionType, Framework, ParticipantStatus, Role } from './domain'

/** Kolumny listy osób i instytucji; e-mail, telefon, adres i miejscowość klient zaznacza świadomie (domyślnie minimum). */
export const CONTACT_COLUMNS = ['name', 'kind', 'roles', 'tags', 'email', 'phone', 'address', 'city'] as const
export type ContactColumn = (typeof CONTACT_COLUMNS)[number]
/** Kolumny, które domyślnie nie są zaznaczone (dane kontaktowe). */
export const CONTACT_COLUMNS_OPT_IN: readonly ContactColumn[] = ['email', 'phone', 'address', 'city']

export const PARTICIPANT_COLUMNS = [...CONTACT_COLUMNS, 'status', 'attendance'] as const
export type ParticipantColumn = (typeof PARTICIPANT_COLUMNS)[number]

export const ACTION_COLUMNS = ['title', 'type', 'framework', 'status', 'startDate', 'endDate', 'place', 'topic', 'participantCount', 'sessionCount'] as const
export type ActionColumn = (typeof ACTION_COLUMNS)[number]

export const COLUMN_HEADERS: Record<ParticipantColumn | ActionColumn, string> = {
  name: 'Nazwa',
  kind: 'Rodzaj',
  roles: 'Role',
  tags: 'Tagi',
  email: 'E-mail',
  phone: 'Telefon',
  address: 'Adres',
  city: 'Miejscowość',
  status: 'Status',
  attendance: 'Frekwencja (%)',
  title: 'Tytuł',
  type: 'Typ',
  framework: 'W ramach',
  startDate: 'Data od',
  endDate: 'Data do',
  place: 'Miejsce',
  topic: 'Temat',
  participantCount: 'Liczba uczestników',
  sessionCount: 'Liczba zajęć'
}

export const KIND_LABELS = { person: 'osoba', institution: 'instytucja' } as const

export const ROLE_LABELS: Record<Role, string> = {
  participant: 'uczestnik',
  volunteer: 'wolontariusz',
  donor: 'darczyńca',
  member: 'członek',
  partner: 'partner',
  trainer: 'trener',
  staff: 'pracownik',
  other: 'inna'
}

export const ACTION_TYPE_LABELS: Record<ActionType, string> = {
  training: 'szkolenie',
  workshop: 'warsztat',
  event: 'wydarzenie',
  meeting: 'spotkanie',
  fundraiser: 'zbiórka',
  other: 'inne'
}

export const FRAMEWORK_LABELS: Record<Framework, string> = {
  project: 'projekt',
  statutory_free: 'działalność statutowa nieodpłatna',
  statutory_paid: 'działalność statutowa odpłatna',
  business: 'działalność gospodarcza'
}

export const ACTION_STATUS_LABELS: Record<ActionStatus, string> = {
  planned: 'planowane',
  ongoing: 'w realizacji',
  done: 'zakończone',
  cancelled: 'odwołane'
}

export const PARTICIPANT_STATUS_LABELS: Record<ParticipantStatus, string> = {
  registered: 'zgłoszony',
  confirmed: 'potwierdzony',
  resigned: 'zrezygnował'
}

/** Zdarzenia dziennika dostępu po polsku (CSV dziennika). Nieznane zdarzenie wypisujemy kodem. */
export const ACCESS_ACTION_LABELS: Record<string, string> = {
  login: 'logowanie',
  login_failed: 'nieudane logowanie',
  logout: 'wylogowanie',
  logout_all: 'wylogowanie ze wszystkich urządzeń',
  password_changed: 'zmiana hasła',
  totp_enabled: 'włączenie 2FA',
  setup_completed: 'zakończenie kreatora',
  user_invited: 'zaproszenie użytkownika',
  user_disabled: 'wyłączenie konta',
  user_reset: 'reset konta',
  role_changed: 'zmiana roli',
  invite_accepted: 'przyjęcie zaproszenia',
  grant_access: 'nadanie dostępu do danych wrażliwych',
  revoke_access: 'odebranie dostępu do danych wrażliwych',
  key_recovered: 'odzyskanie dostępu do klucza',
  key_rotation_started: 'początek zmiany klucza',
  key_rotated: 'zmiana klucza organizacji',
  reveal_sensitive: 'odsłonięcie danych wrażliwych',
  download_attachment: 'pobranie załącznika',
  anonymize: 'anonimizacja osoby',
  export: 'eksport',
  backup_create: 'kopia zapasowa (ręczna)',
  backup_download: 'pobranie kopii zapasowej',
  backup_verify: 'sprawdzenie kopii zapasowej',
  backup_restore: 'odtworzenie z kopii zapasowej'
}

export const ACCESS_TARGET_LABELS: Record<string, string> = {
  user: 'użytkownik',
  contact: 'osoba',
  attachment: 'załącznik',
  contacts_list: 'lista osób i instytucji',
  actions_list: 'lista działań',
  participants_list: 'uczestnicy działania',
  access_log: 'dziennik dostępu',
  backup: 'kopia zapasowa'
}
