// Typy wyników API (wzór: desktopowe src/shared/types.ts). W odróżnieniu od desktopu nie wynikają ze schematu bazy:
// znaczniki czasu przychodzą z serwera jako ISO 8601 (tekst), daty jako RRRR-MM-DD, a tożsamość osoby leży w osobnej tabeli.
import type { ActivityType, Channel, ConsentType, ContactKind, RelationshipType, Role } from './domain'

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

/** Karta osoby. Udział w działaniach i zadania dochodzą w krokach 4–5 ZADANIA_02. */
export interface ContactDetail {
  contact: Contact
  label: string
  roles: ContactRole[]
  relationships: RelationshipView[]
  consents: Consent[]
  activities: ActivityView[]
}

export interface SearchHit {
  type: 'person' | 'institution'
  id: string
  label: string
  sub: string | null
}
