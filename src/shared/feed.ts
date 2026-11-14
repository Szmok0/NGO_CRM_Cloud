// „Ostatnio w organizacji”: zamiana wpisów change_log na zdarzenia czytelne dla ludzi.
// Zdania po polsku składa interfejs (client/lib/feedText.ts).
import type { ActionStatus, ActivityType, ConsentType, ContactKind, OpType } from './domain'

export type FeedKind =
  | 'contactAdded'
  | 'contactUpdated'
  | 'contactDeleted'
  | 'actionAdded'
  | 'actionUpdated'
  | 'actionStatus'
  | 'actionDeleted'
  | 'sessionAdded'
  | 'participantsAdded'
  | 'attendance'
  | 'taskAdded'
  | 'taskUpdated'
  | 'taskDone'
  | 'taskDeleted'
  | 'activityAdded'
  | 'consentAdded'
  | 'topicAdded'

export interface FeedItem {
  kind: FeedKind
  userId: string
  userName: string
  /** Czas najnowszej zmiany w serii (ISO). */
  at: string
  /** Liczba zmian połączonych w ten wpis. */
  count: number
  /** Główny obiekt: tytuł zadania / działania, osoba. */
  subject: string
  contactKind?: ContactKind
  actionStatus?: ActionStatus
  activityType?: Exclude<ActivityType, 'system'>
  consentType?: ConsentType
  sessionNo?: number
  /** Dokąd prowadzi klik. */
  target?: { type: 'contact' | 'action' | 'task' | 'topic'; id: string }
}

export interface ChangeLogRow {
  entity: string
  entityId: string
  op: OpType
  changedFields: Record<string, unknown>
  userId: string
  at: string
}

/** Słowniki potrzebne do opisu zmian (wypełnia proces główny). */
export interface FeedLookup {
  userName(id: string): string | undefined
  contact(id: string): { label: string; kind: ContactKind } | undefined
  action(id: string): { title: string } | undefined
  task(id: string): { title: string } | undefined
  session(id: string): { actionId: string; no: number } | undefined
  /** wpis obecności → zajęcia */
  attendanceSession(id: string): string | undefined
  participantAction(id: string): string | undefined
  activity(id: string): { type: ActivityType; contactId: string | null } | undefined
  consent(id: string): { contactId: string; type: ConsentType } | undefined
  topic(id: string): { name: string } | undefined
  /** Wiersz tożsamości → id kontaktu (chmura: contact_identity). */
  identityContact?(id: string): string | undefined
}

interface Described {
  item: Omit<FeedItem, 'userId' | 'userName' | 'at' | 'count'>
  /** Zmiany z tym samym kluczem, następujące po sobie, łączą się w jeden wpis. */
  mergeKey: string
}

function describe(e: ChangeLogRow, l: FeedLookup): Described | null {
  const f = e.changedFields
  switch (e.entity) {
    case 'contacts': {
      const c = l.contact(e.entityId)
      if (!c) return null
      const kind = e.op === 'insert' ? 'contactAdded' : e.op === 'update' ? 'contactUpdated' : e.op === 'delete' ? 'contactDeleted' : null
      if (!kind) return null
      return {
        item: { kind, subject: c.label, contactKind: c.kind, target: { type: 'contact', id: e.entityId } },
        mergeKey: `${kind}:${e.entityId}`
      }
    }
    case 'contact_identity': {
      // w chmurze imię, nazwisko i kontakt leżą w osobnej tabeli: zmiana tożsamości = zmiana danych osoby
      if (e.op !== 'update') return null
      const contactId = l.identityContact?.(e.entityId)
      const c = contactId ? l.contact(contactId) : undefined
      if (!contactId || !c) return null
      return { item: { kind: 'contactUpdated', subject: c.label, contactKind: c.kind, target: { type: 'contact', id: contactId } }, mergeKey: `contactUpdated:${contactId}` }
    }
    case 'actions': {
      const a = l.action(e.entityId)
      if (!a) return null
      const target = { type: 'action' as const, id: e.entityId }
      if (e.op === 'insert') return { item: { kind: 'actionAdded', subject: a.title, target }, mergeKey: `actionAdded:${e.entityId}` }
      if (e.op === 'delete') return { item: { kind: 'actionDeleted', subject: a.title, target }, mergeKey: `actionDeleted:${e.entityId}` }
      if (e.op === 'update' && typeof f['status'] === 'string')
        return { item: { kind: 'actionStatus', subject: a.title, actionStatus: f['status'] as ActionStatus, target }, mergeKey: `actionStatus:${e.entityId}` }
      if (e.op === 'update') return { item: { kind: 'actionUpdated', subject: a.title, target }, mergeKey: `actionUpdated:${e.entityId}` }
      return null
    }
    case 'action_sessions': {
      if (e.op !== 'insert') return null
      const s = l.session(e.entityId)
      const a = s && l.action(s.actionId)
      if (!s || !a) return null
      return { item: { kind: 'sessionAdded', subject: a.title, target: { type: 'action', id: s.actionId } }, mergeKey: `sessionAdded:${s.actionId}` }
    }
    case 'action_participants': {
      if (e.op !== 'insert') return null
      const actionId = l.participantAction(e.entityId)
      const a = actionId && l.action(actionId)
      if (!actionId || !a) return null
      return { item: { kind: 'participantsAdded', subject: a.title, target: { type: 'action', id: actionId } }, mergeKey: `participantsAdded:${actionId}` }
    }
    case 'attendance': {
      const sessionId = l.attendanceSession(e.entityId)
      const s = sessionId && l.session(sessionId)
      const a = s && l.action(s.actionId)
      if (!sessionId || !s || !a) return null
      return {
        item: { kind: 'attendance', subject: a.title, sessionNo: s.no, target: { type: 'action', id: s.actionId } },
        mergeKey: `attendance:${sessionId}`
      }
    }
    case 'tasks': {
      const t = l.task(e.entityId)
      if (!t) return null
      const target = { type: 'task' as const, id: e.entityId }
      if (e.op === 'insert') return { item: { kind: 'taskAdded', subject: t.title, target }, mergeKey: `taskAdded:${e.entityId}` }
      if (e.op === 'delete') return { item: { kind: 'taskDeleted', subject: t.title, target }, mergeKey: `taskDeleted:${e.entityId}` }
      if (e.op === 'update' && f['status'] === 'done') return { item: { kind: 'taskDone', subject: t.title, target }, mergeKey: `taskDone:${e.entityId}` }
      if (e.op === 'update') return { item: { kind: 'taskUpdated', subject: t.title, target }, mergeKey: `taskUpdated:${e.entityId}` }
      return null
    }
    case 'activities': {
      if (e.op !== 'insert') return null
      const act = l.activity(e.entityId)
      if (!act || act.type === 'system') return null // wpisy systemowe dublowałyby inne zdarzenia
      const c = act.contactId ? l.contact(act.contactId) : undefined
      return {
        item: { kind: 'activityAdded', subject: c?.label ?? '', activityType: act.type, ...(act.contactId && { target: { type: 'contact' as const, id: act.contactId } }) },
        mergeKey: `activity:${act.type}:${act.contactId ?? e.entityId}`
      }
    }
    case 'consents': {
      if (e.op !== 'insert') return null
      const cs = l.consent(e.entityId)
      const c = cs && l.contact(cs.contactId)
      if (!cs || !c) return null
      return { item: { kind: 'consentAdded', subject: c.label, consentType: cs.type, target: { type: 'contact', id: cs.contactId } }, mergeKey: `consent:${e.entityId}` }
    }
    case 'topics': {
      if (e.op !== 'insert') return null
      const t = l.topic(e.entityId)
      return t ? { item: { kind: 'topicAdded', subject: t.name }, mergeKey: `topic:${e.entityId}` } : null
    }
    // Notatki wiedzy i pliki dojdą z ZADANIEM_05 (w desktopie: knowledge_notes, file_links).
    // ustawienia, użytkownicy, role, powiązania, checklisty, powiązania wpisów z osobami: techniczne
    default:
      return null
  }
}

/**
 * Najnowsze zdarzenia (najpierw najnowsze). `log` w dowolnej kolejności.
 * Serie zmian tego samego rodzaju przez tę samą osobę, następujące po sobie, łączą się w jeden wpis.
 */
export function buildFeed(log: ChangeLogRow[], lookup: FeedLookup, limit = 8): FeedItem[] {
  const sorted = [...log].sort((a, b) => b.at.localeCompare(a.at))
  const out: (FeedItem & { mergeKey: string })[] = []
  for (const e of sorted) {
    const d = describe(e, lookup)
    if (!d) continue
    const last = out[out.length - 1]
    if (last && last.userId === e.userId && last.mergeKey === d.mergeKey) {
      last.count++
      continue
    }
    if (out.length === limit) break
    out.push({ ...d.item, userId: e.userId, userName: lookup.userName(e.userId) ?? '', at: e.at, count: 1, mergeKey: d.mergeKey })
  }
  return out.map(({ mergeKey: _, ...item }) => item)
}
