// Typy wyników API (wzór: desktopowe src/shared/types.ts). W odróżnieniu od desktopu nie wynikają ze schematu bazy:
// znaczniki czasu przychodzą z serwera jako ISO 8601 (tekst), daty jako RRRR-MM-DD, a tożsamość osoby leży w osobnej tabeli.
import type { CalendarEntry } from './calendar'
import type { FeedItem } from './feed'
import type { ActionStatus, ActionType, ActivityType, AttendanceStatus, Channel, ConsentType, ContactKind, Framework, ParticipantStatus, Priority, RelationshipType, Role, TargetType, TaskStatus } from './domain'

/** Pola techniczne rekordu widoczne dla klienta (`version` odsyłany przy zapisie: blokada optymistyczna). */
export interface RecordMeta {
  id: string
  version: number
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

/** Tożsamość osoby lub instytucji (tabela contact_identity). */
export interface IdentityFields {
  firstName: string | null
  lastName: string | null
  name: string | null
  email: string | null
  phone: string | null
  address: string | null
  city: string | null
  notes: string | null
}

/** Kontakt z tożsamością. `identityVersion` = null: brak tożsamości (osoba zanonimizowana, ZADANIE_03). */
export interface Contact extends RecordMeta, IdentityFields {
  kind: ContactKind
  tags: string[]
  anonymizedAt: string | null
  identityVersion: number | null
}

export interface ContactRef {
  id: string
  kind: ContactKind
  /** Imię i nazwisko albo nazwa instytucji; pusty tekst = osoba zanonimizowana. */
  label: string
  deleted: boolean
}

export interface ContactListItem extends Contact {
  label: string
  roles: Role[]
}

export interface ContactRole extends RecordMeta {
  contactId: string
  role: Role
  since: string | null
  until: string | null
  note: string | null
}

export interface Consent extends RecordMeta {
  contactId: string
  type: ConsentType
  basis: string | null
  givenAt: string
  validUntil: string | null
  withdrawnAt: string | null
  note: string | null
}

export interface RelationshipView {
  id: string
  version: number
  type: RelationshipType
  note: string | null
  /** true: ta osoba jest stroną A (np. „pracuje w” → druga strona). */
  isA: boolean
  other: ContactRef
}

/** Wpis na osi aktywności z autorem i osobami. */
export interface ActivityView extends RecordMeta {
  type: ActivityType
  channel: Channel | null
  form: string | null
  durationMinutes: number | null
  occurredAt: string
  /** treść; przy wpisie systemowym JSON zdarzenia (tekst składa klient) */
  content: string
  actionId: string | null
  authorName: string
  actionTitle: string | null
  contacts: ContactRef[]
}

/** Udział osoby w działaniu (karta osoby). */
export interface ParticipationView {
  participantId: string
  status: ParticipantStatus
  action: Pick<Action, 'id' | 'title' | 'type' | 'status' | 'startDate' | 'endDate'>
}

export interface ContactDetail {
  contact: Contact
  label: string
  roles: ContactRole[]
  relationships: RelationshipView[]
  consents: Consent[]
  participations: ParticipationView[]
  tasks: TaskListItem[]
  activities: ActivityView[]
  /** Czy osoba ma zapisane dane wrażliwe; sam szyfrogram daje dopiero `sensitive.reveal` (D6). */
  hasSensitive: boolean
  /** Wersja klucza organizacji, którą zaszyfrowano dane wrażliwe; null bez danych. */
  sensitiveKeyVersion: number | null
}

// ---------- tematy i działania (krok 4) ----------

export interface Topic extends RecordMeta {
  name: string
  description: string | null
  program: string | null
  durationHours: number | null
}

export interface Action extends RecordMeta {
  type: ActionType
  framework: Framework
  title: string
  status: ActionStatus
  startDate: string | null
  endDate: string | null
  place: string | null
  topicId: string | null
  description: string | null
  expectedParticipants: number | null
}

export interface ActionListItem extends Action {
  topicName: string | null
  participantCount: number
  sessionCount: number
}

export interface ActionSession extends RecordMeta {
  actionId: string
  date: string
  startTime: string | null
  endTime: string | null
  leaderContactId: string | null
  note: string | null
}

export interface SessionView extends ActionSession {
  leader: ContactRef | null
  presentCount: number
}

export interface ParticipantView extends RecordMeta {
  actionId: string
  contactId: string
  status: ParticipantStatus
  note: string | null
  contact: ContactRef
  attendancePct: number | null
}

/** Zaznaczenie obecności (z wersją: zmiana odsyła `version`, którą widział klient). */
export interface AttendanceMark {
  id: string
  version: number
  sessionId: string
  contactId: string
  status: AttendanceStatus
}

export interface ActionDetail {
  action: Action
  topic: Topic | null
  participants: ParticipantView[]
  sessions: SessionView[]
  attendance: AttendanceMark[]
  heldCount: number
  tasks: TaskListItem[]
  activities: ActivityView[]
}

export interface PastePreviewRow {
  line: number
  raw: string
  firstName: string
  lastName: string
  email: string | null
  phone: string | null
  error: 'NAME_INCOMPLETE' | null
  matches: ContactListItem[]
  /** Dopasowanie pewne: dokładnie jedna osoba o tym imieniu i nazwisku, bez sprzecznych danych. */
  suggestedContactId: string | null
  alreadyInAction: boolean
}

export interface TopicDetail {
  topic: Topic
  actions: ActionListItem[]
}

export interface SearchHit {
  type: 'person' | 'institution' | 'action' | 'topic'
  id: string
  label: string
  sub: string | null
}

// ---------- zadania (krok 5) ----------

export interface Task extends RecordMeta {
  title: string
  dueDate: string | null
  assigneeUserId: string | null
  status: TaskStatus
  priority: Priority
  targetType: TargetType | null
  targetId: string | null
  description: string | null
}

export interface TaskItem extends RecordMeta {
  taskId: string
  label: string
  done: boolean
  position: number
}

export interface TaskListItem extends Task {
  assigneeName: string | null
  targetLabel: string | null
  itemsDone: number
  itemsTotal: number
}

export interface TaskDetail {
  task: Task
  items: TaskItem[]
  assigneeName: string | null
  targetLabel: string | null
}

/** Aktywny użytkownik do wyboru (np. osoba odpowiedzialna za zadanie). */
export interface UserOption {
  id: string
  name: string
}

// ---------- „Dziś”, kosz (krok 6) ----------

export interface StaleContact {
  contact: ContactRef
  days: number
  lastTouch: string | null
  /** Działanie, w którym osoba uczestniczy (najwcześniej dopisana). */
  actionTitle: string | null
}

/** Ekran „Dziś” (bez karty kopii zapasowej — ZADANIE_04, i bez alertów przygotowania — ZADANIE_05). */
export interface TodayData {
  tasksToday: TaskListItem[]
  tasksOverdue: TaskListItem[]
  /** Moje zadania (termin dziś lub wcześniej) odhaczone dziś — zostają na liście przekreślone. */
  tasksDoneToday: TaskListItem[]
  /** Zajęcia i działania z najbliższych 30 dni (maks. 5). */
  upcoming: CalendarEntry[]
  /** Zajęcia w tym tygodniu (pn–nd) i najbliższe zajęcia od dziś. */
  week: { sessions: number; next: { date: string; startTime: string | null } | null }
  stale: StaleContact[]
  feed: FeedItem[]
}

export interface TrashItem {
  entity: 'contacts' | 'actions' | 'tasks' | 'topics'
  id: string
  version: number
  label: string
  kind: ContactKind | null
  deletedAt: string
  deletedBy: string
}
