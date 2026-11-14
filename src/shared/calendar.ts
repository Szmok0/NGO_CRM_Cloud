// Wpisy kalendarza liczone z istniejących danych (zajęcia, działania, zadania) — bez osobnej tabeli.
import type { ActionStatus, ActionType, Priority, TaskStatus } from './domain'

/** Kategorie filtrów kalendarza. */
export const CALENDAR_CATEGORIES = ['sessions', 'events', 'meetings', 'fundraisers', 'tasks', 'overdue'] as const
export type CalendarCategory = (typeof CALENDAR_CATEGORIES)[number]

export interface CalendarEntry {
  /** Klucz unikalny w kalendarzu (rekord + rodzaj wpisu). */
  key: string
  kind: 'session' | 'actionStart' | 'actionEnd' | 'fundraiserEnd' | 'task'
  category: CalendarCategory
  date: string
  startTime: string | null
  endTime: string | null
  title: string
  actionId: string | null
  actionType: ActionType | null
  /** Zajęcia: numer i liczba wszystkich zajęć działania. */
  sessionNo: number | null
  sessionTotal: number | null
  place: string | null
  participantCount: number | null
  /** Daty całego działania (wpisy działań bez zajęć; do eksportu .ics). */
  actionStartDate: string | null
  actionEndDate: string | null
  /** Zadanie. */
  taskId: string | null
  taskDone: boolean
  overdue: boolean
  assigneeName: string | null
  itemsDone: number
  itemsTotal: number
  priority: Priority | null
}

/** Działanie wielodniowe trwające w danym zakresie (panel „Trwa w tym miesiącu”). */
export interface OngoingAction {
  actionId: string
  title: string
  type: ActionType
  startDate: string
  endDate: string
}

export interface CalendarData {
  entries: CalendarEntry[]
  ongoing: OngoingAction[]
}

export interface CalActionRow {
  id: string
  title: string
  type: ActionType
  status: ActionStatus
  startDate: string | null
  endDate: string | null
  place: string | null
  deletedAt: string | null
}
export interface CalSessionRow {
  id: string
  actionId: string
  date: string
  startTime: string | null
  endTime: string | null
  deletedAt: string | null
}
export interface CalTaskRow {
  id: string
  title: string
  dueDate: string | null
  status: TaskStatus
  priority: Priority
  deletedAt: string | null
  assigneeName: string | null
  itemsDone: number
  itemsTotal: number
}

export interface CalendarInput {
  actions: CalActionRow[]
  sessions: CalSessionRow[]
  tasks: CalTaskRow[]
  /** Liczba uczestników (bez rezygnacji) wg id działania. */
  participantCounts: Map<string, number>
  today: string
}

export function categoryOfType(type: ActionType): CalendarCategory {
  if (type === 'event') return 'events'
  if (type === 'meeting') return 'meetings'
  if (type === 'fundraiser') return 'fundraisers'
  return 'sessions'
}

const base = {
  startTime: null,
  endTime: null,
  actionId: null,
  actionType: null,
  sessionNo: null,
  sessionTotal: null,
  place: null,
  participantCount: null,
  actionStartDate: null,
  actionEndDate: null,
  taskId: null,
  taskDone: false,
  overdue: false,
  assigneeName: null,
  itemsDone: 0,
  itemsTotal: 0,
  priority: null
} satisfies Partial<CalendarEntry>

const byTime = (a: CalendarEntry, b: CalendarEntry) =>
  a.date.localeCompare(b.date) || (a.startTime ?? '99').localeCompare(b.startTime ?? '99') || a.title.localeCompare(b.title, 'pl')

/** Wpisy z zakresu dat [from, to]. Odwołane działania i usunięte rekordy są pomijane. */
export function buildCalendar(input: CalendarInput, from: string, to: string): CalendarData {
  const inRange = (d: string | null): d is string => !!d && d >= from && d <= to
  const actions = input.actions.filter((a) => !a.deletedAt && a.status !== 'cancelled')
  const byId = new Map(actions.map((a) => [a.id, a]))
  const entries: CalendarEntry[] = []

  // zajęcia: numeracja w obrębie działania wg daty i godziny
  const sessionsByAction = new Map<string, CalSessionRow[]>()
  for (const s of input.sessions) {
    if (s.deletedAt || !byId.has(s.actionId)) continue
    sessionsByAction.set(s.actionId, [...(sessionsByAction.get(s.actionId) ?? []), s])
  }
  for (const [actionId, list] of sessionsByAction) {
    const a = byId.get(actionId)!
    list.sort((x, y) => x.date.localeCompare(y.date) || (x.startTime ?? '').localeCompare(y.startTime ?? ''))
    list.forEach((s, i) => {
      if (!inRange(s.date)) return
      entries.push({
        ...base,
        key: `session:${s.id}`,
        kind: 'session',
        category: categoryOfType(a.type),
        date: s.date,
        startTime: s.startTime,
        endTime: s.endTime,
        title: a.title,
        actionId: a.id,
        actionType: a.type,
        sessionNo: i + 1,
        sessionTotal: list.length,
        place: a.place,
        participantCount: input.participantCounts.get(a.id) ?? 0
      })
    })
  }

  const ongoing: OngoingAction[] = []
  for (const a of actions) {
    const common = {
      ...base,
      title: a.title,
      actionId: a.id,
      actionType: a.type,
      place: a.place,
      participantCount: input.participantCounts.get(a.id) ?? 0,
      actionStartDate: a.startDate,
      actionEndDate: a.endDate
    }
    const multiDay = !!a.startDate && !!a.endDate && a.endDate > a.startDate
    // działania bez zajęć: w dniu rozpoczęcia i zakończenia
    if (!sessionsByAction.has(a.id)) {
      if (inRange(a.startDate)) entries.push({ ...common, key: `action:${a.id}:start`, kind: 'actionStart', category: categoryOfType(a.type), date: a.startDate })
      if (multiDay && a.type !== 'fundraiser' && inRange(a.endDate))
        entries.push({ ...common, key: `action:${a.id}:end`, kind: 'actionEnd', category: categoryOfType(a.type), date: a.endDate! })
    }
    if (a.type === 'fundraiser' && a.endDate && a.endDate !== a.startDate && inRange(a.endDate))
      entries.push({ ...common, key: `action:${a.id}:fundraiserEnd`, kind: 'fundraiserEnd', category: 'fundraisers', date: a.endDate })
    if (multiDay && a.startDate! <= to && a.endDate! >= from)
      ongoing.push({ actionId: a.id, title: a.title, type: a.type, startDate: a.startDate!, endDate: a.endDate! })
  }

  for (const t of input.tasks) {
    if (t.deletedAt || !inRange(t.dueDate)) continue
    const done = t.status === 'done'
    const overdue = !done && t.dueDate < input.today
    entries.push({
      ...base,
      key: `task:${t.id}`,
      kind: 'task',
      category: overdue ? 'overdue' : 'tasks',
      date: t.dueDate,
      title: t.title,
      taskId: t.id,
      taskDone: done,
      overdue,
      assigneeName: t.assigneeName,
      itemsDone: t.itemsDone,
      itemsTotal: t.itemsTotal,
      priority: t.priority
    })
  }

  return { entries: entries.sort(byTime), ongoing: ongoing.sort((a, b) => a.startDate.localeCompare(b.startDate)) }
}
