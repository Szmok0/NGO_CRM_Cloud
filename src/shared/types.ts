// Typy wyników API (wzór: desktopowe src/shared/types.ts). W odróżnieniu od desktopu nie wynikają ze schematu bazy:
// znaczniki czasu przychodzą z serwera jako ISO 8601 (tekst), daty jako RRRR-MM-DD, a tożsamość osoby leży w osobnej tabeli.
import type { ActionStatus, ActionType, ActivityType, AttendanceStatus, Channel, ConsentType, ContactKind, Framework, ParticipantStatus, RelationshipType, Role } from './domain'

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

/** Karta osoby. Zadania dochodzą w kroku 5 ZADANIA_02. */
export interface ContactDetail {
  contact: Contact
  label: string
  roles: ContactRole[]
  relationships: RelationshipView[]
  consents: Consent[]
  participations: ParticipationView[]
  activities: ActivityView[]
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
