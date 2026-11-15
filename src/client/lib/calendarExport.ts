// Wpisy kalendarza → wydarzenia .ics (bez danych osobowych: tytuł, miejsce, liczba uczestników).
import { pl } from '../i18n/pl'
import type { CalendarEntry } from '@shared/calendar'
import type { IcsEvent } from '@shared/ics'

const recordId = (key: string) => key.split(':')[1]!

export function toIcsEvents(entries: CalendarEntry[], includeTasks: boolean): IcsEvent[] {
  const out: IcsEvent[] = []
  const actionsDone = new Set<string>()
  for (const e of entries) {
    const description = e.participantCount ? pl.calendar.icsParticipants(e.participantCount) : null
    if (e.kind === 'session') {
      out.push({
        id: recordId(e.key),
        summary: pl.calendar.icsSession(e.title, e.sessionNo ?? 0, e.sessionTotal ?? 0),
        location: e.place,
        description,
        date: e.date,
        startTime: e.startTime,
        endTime: e.endTime
      })
    } else if (e.kind === 'task') {
      if (includeTasks) out.push({ id: e.taskId!, summary: pl.calendar.icsTask(e.title), date: e.date })
    } else if (!actionsDone.has(e.actionId!)) {
      // działanie bez zajęć: jeden wpis całodniowy na cały czas trwania (UID = id działania)
      actionsDone.add(e.actionId!)
      out.push({
        id: e.actionId!,
        summary: e.title,
        location: e.place,
        description,
        date: e.actionStartDate ?? e.date,
        endDate: e.actionEndDate
      })
    }
  }
  return out
}
