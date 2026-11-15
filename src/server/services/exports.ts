// Eksporty (ZADANIE_03, krok 6a; D13, D14). Serwer zwraca dane osoby (art. 15 RODO) i buduje pliki CSV list.
// W CSV nigdy nie ma danych wrażliwych (te są tylko zaszyfrowane w `contact_sensitive`). Każdy eksport zapisuje wpis `export`
// w dzienniku dostępu: same identyfikatory i rodzaj listy, bez filtrów (mogą zawierać nazwisko) i bez liczby wierszy.
import type { ApiParsed, CsvExport, PersonExport } from '@shared/api'
import type { Role } from '@shared/domain'
import { AppError } from '@shared/errors'
import { csvText, toCsv } from '@shared/csv'
import {
  ACTION_COLUMNS,
  ACTION_STATUS_LABELS,
  ACTION_TYPE_LABELS,
  COLUMN_HEADERS,
  CONTACT_COLUMNS,
  FRAMEWORK_LABELS,
  KIND_LABELS,
  PARTICIPANT_COLUMNS,
  PARTICIPANT_STATUS_LABELS,
  ROLE_LABELS,
  type ActionColumn,
  type ParticipantColumn
} from '@shared/exportLabels'
import type { ActionListItem, ContactListItem } from '@shared/types'
import type { Db } from '../db/connection'
import { logAccess } from '../auth/accessLog'
import { getActionDetail, listActions } from './actions'
import { listAttachments } from './attachments'
import { today, type Actor } from './common'
import { getContact, listContacts } from './contacts'
import { getSettings } from './settings'

/**
 * Wszystko o osobie, co zna serwer (D13). Osoba z Kosza da się wyeksportować, zanonimizowana nie (nie ma już czego),
 * instytucja nie (to eksport osoby). Wpis w dzienniku zapisany po odczycie: błąd zapisu wpisu nie wyda danych.
 */
export async function exportPerson(db: Db, { id }: ApiParsed<'contacts.exportData'>, actor: Actor): Promise<PersonExport> {
  const detail = await getContact(db, id)
  if (detail.contact.kind !== 'person') throw new AppError('VALIDATION', 'PERSON_ONLY')
  if (detail.contact.anonymizedAt) throw new AppError('NOT_FOUND')
  const attachments = await listAttachments(db, { targetType: 'contact', targetId: id })
  await logAccess(db, actor.userId, 'export', actor.now, id, 'contact')
  return { exportedAt: actor.now.toISOString(), detail, attachments }
}

/** Kolumny w kolejności kontraktu, bez powtórzeń (kolejność w żądaniu nie ma znaczenia). */
const pick = <T extends string>(all: readonly T[], wanted: readonly string[]): T[] => all.filter((c) => wanted.includes(c))

function contactCell(c: ContactListItem, col: ParticipantColumn, roleLabel: (r: Role) => string): string {
  switch (col) {
    case 'name':
      return csvText(c.label)
    case 'kind':
      return KIND_LABELS[c.kind]
    case 'roles':
      return c.roles.map(roleLabel).join(', ')
    case 'tags':
      return csvText(c.tags.join(', '))
    case 'email':
      return csvText(c.email)
    case 'phone':
      return csvText(c.phone)
    case 'address':
      return csvText(c.address)
    case 'city':
      return csvText(c.city)
    default:
      return ''
  }
}

function actionCell(a: ActionListItem, col: ActionColumn): string | number {
  switch (col) {
    case 'title':
      return csvText(a.title)
    case 'type':
      return ACTION_TYPE_LABELS[a.type]
    case 'framework':
      return FRAMEWORK_LABELS[a.framework]
    case 'status':
      return ACTION_STATUS_LABELS[a.status]
    case 'startDate':
      return a.startDate ?? ''
    case 'endDate':
      return a.endDate ?? ''
    case 'place':
      return csvText(a.place)
    case 'topic':
      return csvText(a.topicName)
    case 'participantCount':
      return a.participantCount
    case 'sessionCount':
      return a.sessionCount
  }
}

/** Plik CSV listy osób, działań albo uczestników działania (D14). Dane wrażliwe nie mają kolumn. */
export async function exportCsv(db: Db, input: ApiParsed<'exports.csv'>, actor: Actor): Promise<CsvExport> {
  const day = today(actor.now)
  const roleLabels = (await getSettings(db)).roleLabels
  const roleLabel = (r: Role) => roleLabels[r] || ROLE_LABELS[r]

  if (input.list === 'actions') {
    const { list: _l, columns, ...filter } = input
    const cols = pick(ACTION_COLUMNS, columns)
    const items = await listActions(db, filter)
    await logAccess(db, actor.userId, 'export', actor.now, undefined, 'actions_list')
    return { filename: `dzialania-${day}.csv`, csv: toCsv(cols.map((c) => COLUMN_HEADERS[c]), items.map((a) => cols.map((c) => actionCell(a, c)))), rows: items.length }
  }

  if (input.list === 'contacts') {
    const { list: _l, columns, ...filter } = input
    const cols = pick(CONTACT_COLUMNS, columns)
    // osoby zanonimizowane zostają tylko ze statystykami: pusty wiersz bez nazwy nic nie wnosi
    const items = (await listContacts(db, filter, actor.now)).filter((c) => !c.anonymizedAt)
    await logAccess(db, actor.userId, 'export', actor.now, undefined, 'contacts_list')
    return { filename: `osoby-${day}.csv`, csv: toCsv(cols.map((c) => COLUMN_HEADERS[c]), items.map((c) => cols.map((col) => contactCell(c, col, roleLabel)))), rows: items.length }
  }

  const cols = pick(PARTICIPANT_COLUMNS, input.columns)
  const detail = await getActionDetail(db, input.actionId, actor.now)
  if (detail.action.deletedAt) throw new AppError('NOT_FOUND')
  const byId = new Map((await listContacts(db, { kind: 'all' }, actor.now)).map((c) => [c.id, c]))
  const rows = detail.participants.flatMap((p) => {
    const c = byId.get(p.contactId)
    // osoba w Koszu albo zanonimizowana: poza listą
    if (!c || c.anonymizedAt) return []
    return [
      cols.map((col) => {
        if (col === 'status') return PARTICIPANT_STATUS_LABELS[p.status]
        if (col === 'attendance') return p.attendancePct ?? ''
        return contactCell(c, col, roleLabel)
      })
    ]
  })
  await logAccess(db, actor.userId, 'export', actor.now, input.actionId, 'participants_list')
  return { filename: `uczestnicy-${day}.csv`, csv: toCsv(cols.map((c) => COLUMN_HEADERS[c]), rows), rows: rows.length }
}
