// Kolory i etykiety wpisów kalendarza (wspólne dla „Dziś”, mini-kalendarza i Kalendarza).
import { pl } from '../i18n/pl'
import type { ActionType } from '@shared/domain'
import type { CalendarCategory, CalendarEntry } from '@shared/calendar'

export interface EntryTone {
  /** tło + tekst chipa */
  chip: string
  /** kolor kropki */
  dot: string
}

const TYPE_TONE: Record<ActionType, EntryTone> = {
  training: { chip: 'bg-primary-soft text-primary-soft-foreground', dot: 'bg-primary' },
  workshop: { chip: 'bg-primary-soft text-primary-soft-foreground', dot: 'bg-primary' },
  event: { chip: 'bg-violet-soft text-violet', dot: 'bg-violet-strong' },
  meeting: { chip: 'bg-info-soft text-info', dot: 'bg-info' },
  fundraiser: { chip: 'bg-warning-soft text-orange', dot: 'bg-orange-strong' },
  other: { chip: 'bg-muted text-secondary-foreground', dot: 'bg-faint' }
}

export const CATEGORY_TONE: Record<CalendarCategory, EntryTone & { border: string }> = {
  sessions: { ...TYPE_TONE.training, border: 'border-primary' },
  events: { ...TYPE_TONE.event, border: 'border-violet-strong' },
  meetings: { ...TYPE_TONE.meeting, border: 'border-info' },
  fundraisers: { ...TYPE_TONE.fundraiser, border: 'border-orange-strong' },
  tasks: { chip: 'bg-muted text-secondary-foreground', dot: 'bg-faint', border: 'border-faint' },
  overdue: { chip: 'bg-destructive-soft text-destructive', dot: 'bg-destructive', border: 'border-destructive' }
}

export const typeTone = (type: ActionType): EntryTone => TYPE_TONE[type]

export function entryTone(e: CalendarEntry): EntryTone {
  if (e.kind === 'task') return e.taskDone ? { chip: 'bg-muted text-faint line-through', dot: 'bg-faint' } : CATEGORY_TONE[e.category]
  if (e.kind === 'fundraiserEnd') return TYPE_TONE.fundraiser
  return TYPE_TONE[e.actionType ?? 'other']
}

/** Rodzaj wpisu na chipie: „zajęcia” dla szkoleń i warsztatów, inaczej typ działania. */
export function entryKindLabel(e: CalendarEntry): string {
  if (e.kind === 'task') return pl.calendar.kindTask
  const type = e.actionType ?? 'other'
  return e.kind === 'session' && (type === 'training' || type === 'workshop') ? pl.calendar.kindSession : pl.actionTypes[type]
}

/** Krótka etykieta wpisu w komórce kalendarza. */
export function entryLabel(e: CalendarEntry): string {
  switch (e.kind) {
    case 'session':
      return pl.calendar.sessionLabel(e.startTime, e.title, e.sessionNo ?? 0, e.sessionTotal ?? 0)
    case 'actionStart':
      return pl.calendar.timed(e.startTime, e.title)
    case 'actionEnd':
      return pl.calendar.actionEnd(e.title)
    case 'fundraiserEnd':
      return pl.calendar.fundraiserEnd(e.title)
    case 'task':
      return e.title
  }
}
